/**
 * Pure-functional region probe for `/api/app/me` — TS port of
 * `mixpanel_headless/_internal/auth/region_probe.py` (whole file, B7-A2
 * packet §2.3, `b7-packets.md`).
 *
 * Walks a configurable region ordering (default `us → eu → in`),
 * issuing GET `/api/app/me` against each region's API base URL via a
 * caller-supplied {@link ClientFactory}. Returns the first 200 as a
 * {@link RegionProbeResult}; throws {@link RegionProbeError} carrying
 * the full attempt list when no region accepts the credential, or the
 * {@link RegionProbeNetworkError} subclass when EVERY attempt failed at
 * the network layer (including the `all([])` vacuous-truth edge for an
 * empty `order` — `region_probe.py:182-187`, packet Caution #9).
 *
 * Design constraints (ported from `region_probe.py` module docstring +
 * R9.1/R9.4):
 *
 * - **No I/O of its own.** All HTTP work goes through `clientFactory`;
 *   the real client construction ({@link probeClientFromFetch}) runs
 *   over an INJECTED fetch (R2.4) — no `node:*`, no `process.env`.
 * - **`probeRegion` itself takes no environment access.** Python's
 *   `probe_region_for_credential` reads `os.environ[token_env]`; the TS
 *   twin takes a `getEnv` seam (R9.4 — B8 wires `process.env`).
 * - **No logging.** Progress narration is the caller's `narrate` hook.
 */

import { cpSlice } from "../compat/codepoint.js";
import { pythonRepr } from "../compat/python-str.js";
import { MixpanelHttpError } from "../client/internals.js";
import { createRequestExecutor } from "../client/transport.js";
import { endpointBase } from "../client/url.js";
import {
  ConfigError,
  RegionProbeError,
  RegionProbeNetworkError,
  type RegionProbeAttempt,
} from "../errors.js";
import type { Secret } from "../secret.js";
import { base64EncodeUtf8, type AccountType, type Region } from "./account.js";

/** One probe response as the probe consumes it (httpx `Response` slice). */
export interface ProbeResponse {
  /** HTTP status code. */
  readonly status: number;
  /** Complete body text. */
  readonly text: string;
}

/**
 * A region-scoped HTTP client (the `httpx.Client` seam the Python probe
 * receives from its `client_factory`).
 */
export interface ProbeClient {
  /**
   * Issue a GET request.
   *
   * @param path - Request path (relative to the client's base URL).
   * @param opts - Headers + per-request timeout (seconds, R2.12 —
   *   Python spelling of the unit; ms conversion lives inside
   *   {@link probeClientFromFetch} at the transport call).
   * @returns The buffered response.
   */
  get(
    path: string,
    opts: {
      headers: Readonly<Record<string, string>>;
      timeoutSeconds: number;
    },
  ): Promise<ProbeResponse>;

  /** Release the client (Python `httpx.Client.close`). */
  close(): void;
}

/** Builds a {@link ProbeClient} bound to a region's API base URL. */
export type ClientFactory = (region: Region) => ProbeClient;

/** GET path probed on every region (`region_probe.py:48`). */
const ME_PATH = "/api/app/me";

/**
 * Cap each captured response body so a misconfigured server returning
 * multi-MB HTML cannot bloat the in-memory {@link RegionProbeError}
 * (`region_probe.py:55`). Codepoint-counted (R11.6).
 */
const MAX_RESPONSE_BODY_CHARS = 4096;

/**
 * Outcome of a sequential region probe (`region_probe.py:58-82`).
 *
 * `attempts` mirrors the failure tail (as 2-tuples, bodies DROPPED)
 * plus the successful `[region, 200]` entry — the error-path 3-tuple
 * shape lives on {@link RegionProbeError.attempts} instead (packet
 * Caution #5: two distinct tuple shapes).
 */
export interface RegionProbeResult {
  /** The first region whose `/me` returned 200. */
  readonly region: Region;
  /** Ordered `(region, statusCode)` log of every attempt. */
  readonly attempts: ReadonlyArray<readonly [Region, number]>;
}

/**
 * The `cause.code → httpx class` reverse table (packet §2.3 item 5 /
 * Caution #8 — the D12 table's dual, committed in the LIBRARY).
 *
 * The transport adapter normalizes fetch rejections to
 * {@link MixpanelHttpError} (R2.10) whose cause chain is
 * `TypeError("fetch failed") → Error{code}`; Python renders
 * `f"{type(exc).__name__}: {exc}"` (`region_probe.py:156`), so the
 * httpx class name must be recovered from the cause code (the
 * ConnectError cause's `name` is just `"Error"`). Vector-locked for
 * `ECONNREFUSED` only; the rest is principled best-effort, disclosed in
 * the shard RUN record.
 */
const HTTPX_CLASS_BY_CAUSE_CODE: Readonly<Record<string, string>> = {
  ECONNREFUSED: "ConnectError",
  UND_ERR_CONNECT_TIMEOUT: "ConnectTimeout",
  UND_ERR_SOCKET: "ReadError",
};

/**
 * Render a transport failure as `<httpx-equivalent class>: <message>`
 * (the `f"{type(exc).__name__}: {exc}"` twin, `region_probe.py:156`).
 *
 * @param error - The normalized transport error.
 * @returns The rendered attempt body.
 */
function renderTransportFailure(error: MixpanelHttpError): string {
  const outer = error.cause;
  const inner =
    outer instanceof Error ? (outer as { cause?: unknown }).cause : undefined;
  let httpxClass: string | undefined;
  if (inner instanceof Error) {
    const code = (inner as { code?: unknown }).code;
    if (typeof code === "string") {
      httpxClass = HTTPX_CLASS_BY_CAUSE_CODE[code];
    }
    httpxClass ??= inner.name;
  } else if (outer instanceof Error || outer instanceof DOMException) {
    httpxClass = outer.name;
  }
  httpxClass ??= error.name;
  return `${httpxClass}: ${error.message}`;
}

/** Options bag for {@link probeRegion} (Python kwonly params, R3.8). */
export interface ProbeRegionOptions {
  /**
   * Per-region request timeout (float seconds). Default `5.0`. Each
   * region gets its own timeout budget.
   */
  readonly timeoutSeconds?: number | undefined;
  /**
   * Probe ordering. Default `["us", "eu", "in"]` per spec R-1. Pass a
   * custom array to skip regions or change the sequence.
   */
  readonly order?: readonly Region[] | undefined;
}

/**
 * Sequentially probe regions until one accepts the credential (port of
 * `probe_region`, `region_probe.py:85-191`).
 *
 * For each region in `order`, builds a client via
 * `clientFactory(region)`, issues GET `/api/app/me` carrying `headers`,
 * and returns on the first 200 — subsequent regions are NOT probed
 * (their factories are never invoked). Network errors are recorded as
 * status code `0` with the failure reason in the attempt body. Every
 * client is closed in a `finally` per region — including the 200 path
 * (close BEFORE returning) and the network-error `continue` path
 * (packet Caution #6).
 *
 * @param clientFactory - Region → client builder (injection seam).
 * @param headers - Request headers carrying the credential.
 * @param options - `timeoutSeconds` (default 5.0) + `order`.
 * @returns The resolved region and the ordered attempt list.
 * @throws RegionProbeNetworkError - Every attempt failed at the network
 *   layer (`all(status == 0)` — vacuously true for an EMPTY `order`:
 *   `attempts: []`, packet Caution #9).
 * @throws RegionProbeError - Every region failed with at least one
 *   HTTP (non-network) rejection.
 *
 * @example
 * ```typescript
 * const result = await probeRegion(factory, {
 *   Authorization: "Basic xxx",
 * });
 * // result.region === "us"; result.attempts === [["us", 200]]
 * ```
 */
export async function probeRegion(
  clientFactory: ClientFactory,
  headers: Readonly<Record<string, string>>,
  options: ProbeRegionOptions = {},
): Promise<RegionProbeResult> {
  const timeoutSeconds = options.timeoutSeconds ?? 5.0;
  const order: readonly Region[] = options.order ?? ["us", "eu", "in"];

  const successAttempts: Array<readonly [Region, number]> = [];
  const failureAttempts: Array<readonly [Region, number, string]> = [];

  for (const region of order) {
    const client = clientFactory(region);
    try {
      let response: ProbeResponse;
      try {
        response = await client.get(ME_PATH, { headers, timeoutSeconds });
      } catch (exc) {
        if (exc instanceof MixpanelHttpError) {
          // Network-layer failure: DNS, TLS, connect refused, etc.
          // Recorded as status 0 so callers can render it consistently
          // with HTTP failures in the same table (:152-157).
          failureAttempts.push([region, 0, renderTransportFailure(exc)]);
          continue;
        }
        throw exc;
      }
      if (response.status === 200) {
        successAttempts.push([region, 200]);
        // Mirror the failure tail back into the success attempts so the
        // caller sees the full probe history (US 401 → EU 200 appears
        // as [["us", 401], ["eu", 200]]) — bodies dropped (:163-166).
        const fullAttempts = failureAttempts
          .map(([r, s]) => [r, s] as const)
          .concat(successAttempts);
        return { region, attempts: fullAttempts };
      }
      failureAttempts.push([
        region,
        response.status,
        cpSlice(response.text, 0, MAX_RESPONSE_BODY_CHARS),
      ]);
    } finally {
      client.close();
    }
  }

  // Every region failed. Distinguish "credential rejected" from "could
  // not reach any region at the network layer" (:182-191). Python
  // `all([])` is True — an empty order raises the network subclass with
  // an empty attempt list.
  const attempts: readonly RegionProbeAttempt[] = failureAttempts;
  if (failureAttempts.every(([, status]) => status === 0)) {
    throw new RegionProbeNetworkError(
      "Could not reach any Mixpanel region — every probe failed at " +
        "the network layer (DNS, TLS, or connect refused).",
      { attempts },
    );
  }
  throw new RegionProbeError("Credential not valid in any region.", {
    attempts,
  });
}

/**
 * The real {@link ProbeClient} construction over an injected fetch —
 * consumed by {@link probeRegionForCredential} (and the conformance
 * binding, packet §2.7).
 *
 * Request assembly is string concatenation only (R2.13); every
 * transport failure surfaces as {@link MixpanelHttpError} via the B0
 * adapter (R2.10 — `client/transport.ts`); the seconds → ms conversion
 * happens inside the adapter (R2.12).
 *
 * @param fetchImpl - The injected fetch (R2.4).
 * @param baseUrl - Scheme+host base (e.g. `https://mixpanel.com`).
 * @returns A probe client issuing `GET baseUrl + path`.
 */
export function probeClientFromFetch(
  fetchImpl: typeof fetch,
  baseUrl: string,
): ProbeClient {
  const executor = createRequestExecutor(fetchImpl);
  return {
    get: async (path, opts) => {
      const wire = await executor({
        method: "GET",
        url: baseUrl + path,
        params: {},
        jsonBody: null,
        formBody: null,
        headers: { ...opts.headers },
        timeoutSeconds: opts.timeoutSeconds,
      });
      return { status: wire.status, text: wire.text };
    },
    close: () => {
      // fetch has no connection handle to release; the Python
      // `httpx.Client.close()` contract is a no-op here.
    },
  };
}

/**
 * Pure URL-stripping twin of the Python `_factory` base derivation
 * (`region_probe.py:276-277`): `urlsplit` → `urlunsplit((scheme,
 * netloc, "", "", ""))` — scheme+host only, path/query/fragment
 * dropped. The URL parser's `origin` is equivalent for CANONICAL
 * http(s) URLs — the three `ENDPOINTS[*].app` values, the only in-repo
 * inputs. Disclosed skew for NON-canonical inputs
 * (`b7-reviewA-resolution.md` SEM-F3): `origin` drops default ports
 * (`:443`/`:80`) and userinfo and lowercases scheme/host, where
 * Python's `urlunsplit` preserves all three. R2.13's concat-only rule
 * governs REQUEST path assembly, not this read-only parse (packet §2.3
 * item 7 / Caution #11).
 *
 * @param appUrl - The `ENDPOINTS[region]["app"]` URL.
 * @returns The scheme+host base URL.
 *
 * @example
 * ```typescript
 * probeBaseUrl("https://mixpanel.com/api/app");
 * // "https://mixpanel.com"
 * ```
 */
export function probeBaseUrl(appUrl: string): string {
  return new URL(appUrl).origin;
}

/** Options bag for {@link probeRegionForCredential} (packet §2.3). */
export interface ProbeRegionForCredentialOptions {
  /** `"service_account"` or `"oauth_token"`; other types are rejected. */
  readonly account_type: AccountType;
  /** Service-account username (required for `service_account`). */
  readonly username: string | null;
  /** Service-account secret (required for `service_account`). */
  readonly secret: Secret | null;
  /** Inline `oauth_token` bearer (mutually exclusive with `token_env`). */
  readonly token: Secret | null;
  /** Env-var NAME carrying the bearer (read via `getEnv` at call time). */
  readonly token_env: string | null;
  /** Optional per-step progress hook (CLI narration; default silent). */
  readonly narrate?: ((msg: string) => void) | null | undefined;
  /** R9.4 seam for the single env read — B8 wires `process.env`. */
  readonly getEnv: (name: string) => string | undefined;
  /** The injected fetch the real probe clients run over (R2.4). */
  readonly fetchImpl: typeof fetch;
}

/**
 * Build the credential header, probe `us → eu → in`, return the region
 * (port of `probe_region_for_credential`, `region_probe.py:194-287`).
 *
 * @param options - Credential material + seams (see the field docs).
 * @returns The first region whose `/me` returned 200.
 * @throws ConfigError - Missing credential material for the given
 *   `account_type`, or `token_env` points at an unset/empty variable.
 * @throws RegionProbeError - Propagated from {@link probeRegion} when
 *   no region accepts the credential.
 * @throws RegionProbeNetworkError - Propagated from {@link probeRegion}
 *   when every probe failed at the network layer.
 *
 * @example
 * ```typescript
 * const region = await probeRegionForCredential({
 *   account_type: "service_account",
 *   username: "sa.user",
 *   secret: new Secret("hunter2"),
 *   token: null,
 *   token_env: null,
 *   getEnv: (name) => process.env[name], // B8 wiring
 *   fetchImpl: fetch,
 * });
 * ```
 */
export async function probeRegionForCredential(
  options: ProbeRegionForCredentialOptions,
): Promise<Region> {
  const { account_type, username, secret, token, token_env, getEnv } = options;
  const narrate = options.narrate ?? null;

  let headers: Record<string, string>;
  if (account_type === "service_account") {
    if (username === null || secret === null) {
      throw new ConfigError(
        "service_account region probe requires `username` and `secret`.",
      );
    }
    // UTF-8 bytes then base64 — never `btoa` on raw UTF-16 (packet
    // Caution #10; `region_probe.py:246-247`).
    const raw = `${username}:${secret.reveal()}`;
    headers = { Authorization: `Basic ${base64EncodeUtf8(raw)}` };
  } else if (account_type === "oauth_token") {
    let bearer: string;
    if (token !== null) {
      bearer = token.reveal();
    } else if (token_env !== null) {
      bearer = getEnv(token_env) ?? "";
      if (bearer === "") {
        // Python `if not bearer` — unset AND empty both reject
        // (:252-260).
        throw new ConfigError(
          `--token-env ${pythonRepr(token_env)} is unset; cannot probe region.`,
        );
      }
    } else {
      throw new ConfigError(
        "oauth_token region probe requires `token` or `token_env`.",
      );
    }
    headers = { Authorization: `Bearer ${bearer}` };
  } else {
    throw new ConfigError(
      `Region probe is not defined for account type ${pythonRepr(account_type)}.`,
    );
  }

  /**
   * Build a region-scoped probe client bound to the API host root
   * (the Python `_factory` twin, `region_probe.py:267-278`).
   *
   * @param region - The region to probe.
   * @returns The real probe client.
   */
  const factory: ClientFactory = (region: Region): ProbeClient => {
    const appUrl = endpointBase(region, "app");
    return probeClientFromFetch(options.fetchImpl, probeBaseUrl(appUrl));
  };

  if (narrate !== null) {
    narrate("Probing regions for /me access ...");
  }
  const result = await probeRegion(factory, headers);
  if (narrate !== null) {
    for (const [regionName, status] of result.attempts) {
      const marker = status === 200 ? "✓" : "✗";
      narrate(`  ${regionName}: ${String(status)} ${marker}`);
    }
  }
  return result.region;
}
