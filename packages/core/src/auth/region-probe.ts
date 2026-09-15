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
 * empty `order` — `region_probe.py`, packet Caution #9).
 *
 * Design constraints (ported from `region_probe.py` module docstring +
 * R9.1/R9.4):
 *
 * - **No I/O of its own.** All HTTP work goes through `clientFactory`;
 *   the real client construction ({@link probeClientFromFetch}) runs
 *   over an INJECTED fetch — no `node:*`, no `process.env`.
 * - **`probeRegion` itself takes no environment access.** Python's
 *   `probe_region_for_credential` reads `os.environ[token_env]`; the TS
 *   twin takes a `getEnv` seam (R9.4 — B8 wires `process.env`).
 * - **No logging.** Progress narration is the caller's `narrate` hook.
 *
 * Alternate-host override (Python PR #235): when `apiBaseUrl` is set,
 * every region maps to the same host, so {@link probeRegionForCredential}
 * collapses the walk to a single probe at that base — the region is the
 * injected region hint (`MP_REGION`) when it names a valid region, else
 * `us`. `appBaseUrl` alone re-homes `/me` but keeps the full `us → eu →
 * in` walk, because the discovered region still routes the live Query /
 * Export / Engage hosts. The overrides arrive injected (a bag or a
 * per-call provider); absent, they are read through the `getEnv` seam
 * (`MP_API_BASE_URL` / `MP_APP_BASE_URL` / `MP_REGION`) — the exact
 * twin of Python's `os.environ` reads, still with no `process` access
 * in `core`.
 */

import { MixpanelHttpError } from "../client/internals.js";
import { createRequestExecutor } from "../client/transport.js";
import {
  API_BASE_URL_ENV,
  APP_BASE_URL_ENV,
  appPathPrefix,
  endpointBase,
  type EndpointOverrides,
  endpointOverridesFromEnv,
  endpointOverridesProvider,
  type EndpointOverridesSource,
  hasApiBaseUrlOverride,
  normalizeBaseUrlOverride,
} from "../client/url.js";
import { cpSlice } from "../compat/codepoint.js";
import { pythonRepr } from "../compat/python-str.js";
import {
  ConfigError,
  type RegionProbeAttempt,
  RegionProbeError,
  RegionProbeNetworkError,
} from "../errors.js";
import type { Secret } from "../secret.js";
import { type AccountType, base64EncodeUtf8, type Region } from "./account.js";

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
  get: (
    path: string,
    opts: {
      headers: Readonly<Record<string, string>>;
      timeoutSeconds: number;
    },
  ) => Promise<ProbeResponse>;

  /** Release the client (Python `httpx.Client.close`). */
  close: () => void;
}

/** Builds a {@link ProbeClient} bound to a region's API base URL. */
export type ClientFactory = (region: Region) => ProbeClient;

/** GET path probed on every region (`region_probe.py`). */
const ME_PATH = "/api/app/me";

/**
 * Cap each captured response body so a misconfigured server returning
 * multi-MB HTML cannot bloat the in-memory {@link RegionProbeError}
 * (`region_probe.py`). Codepoint-counted.
 */
const MAX_RESPONSE_BODY_CHARS = 4096;

/**
 * Outcome of a sequential region probe (`region_probe.py`).
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
 * (the `f"{type(exc).__name__}: {exc}"` twin, `region_probe.py`).
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
 * `probe_region`, `region_probe.py`).
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
      } catch (error) {
        if (error instanceof MixpanelHttpError) {
          // Network-layer failure: DNS, TLS, connect refused, etc.
          // Recorded as status 0 so callers can render it consistently
          // with HTTP failures in the same table.
          failureAttempts.push([region, 0, renderTransportFailure(error)]);
          continue;
        }
        throw error;
      }
      if (response.status === 200) {
        successAttempts.push([region, 200]);
        // Mirror the failure tail back into the success attempts so the
        // caller sees the full probe history (US 401 → EU 200 appears
        // as [["us", 401], ["eu", 200]]) — bodies dropped.
        const fullAttempts = [
          ...failureAttempts.map(([r, s]) => [r, s] as const),
          ...successAttempts,
        ];
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
  // not reach any region at the network layer". Python
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
 * Request assembly is string concatenation only; every
 * transport failure surfaces as {@link MixpanelHttpError} via the B0
 * adapter (R2.10 — `client/transport.ts`); the seconds → ms conversion
 * happens inside the adapter.
 *
 * @param fetchImpl - The injected fetch.
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
 * Derive the probe client base from an App API URL — TS port of
 * `api_client._probe_base_url` (PR #235; formerly the inline `_factory`
 * derivation, `region_probe.py`).
 *
 * {@link probeRegion} issues `/api/app/me` relative to the client base,
 * so the base must be the App API URL MINUS its `/api/app` suffix. That
 * keeps any extra path prefix an override base carries (e.g.
 * `https://proxy.example/mp`) in front of `/api/app/me`. When the URL
 * does not end in `/api/app` the path is dropped entirely and the
 * scheme + host are used (the pre-override behaviour: Python
 * `urlsplit` → `urlunsplit((scheme, netloc, "", "", ""))`; the URL
 * parser's `origin` is equivalent for canonical http(s) URLs — the
 * disclosed skew for NON-canonical inputs, `b7-reviewA-resolution.md`
 * SEM-F3, is unchanged: `origin` drops default ports and userinfo and
 * lowercases scheme/host).
 *
 * @param appUrl - The App API base URL for a region (live or overridden).
 * @returns The base URL to bind the probe client to, without a trailing
 *   slash.
 * @example
 * ```typescript
 * probeBaseUrl("https://mixpanel.com/api/app");
 * // "https://mixpanel.com"
 * probeBaseUrl("https://proxy.example/mp/api/app/");
 * // "https://proxy.example/mp"
 * ```
 */
export function probeBaseUrl(appUrl: string): string {
  const trimmed = appUrl.replace(/\/+$/, "");
  const appPrefix = appPathPrefix();
  if (trimmed.endsWith(appPrefix)) {
    return trimmed.slice(0, trimmed.length - appPrefix.length);
  }
  return new URL(trimmed).origin;
}

/** The three valid region labels, in probe order (`_VALID_REGIONS`). */
const VALID_REGIONS: readonly Region[] = ["us", "eu", "in"];

/**
 * The single-region probe order when `apiBaseUrl` is active — TS port
 * of `api_client._override_probe_order` (PR #235).
 *
 * With `apiBaseUrl` set, every family — and therefore every region —
 * resolves to the same host, so walking `us → eu → in` would hit it
 * three times on failure for no gain. The region label still has to be
 * SOME valid region (it is persisted on the account and used for
 * non-URL purposes), so it is taken from `requestedRegion` (the
 * `MP_REGION` hint) when that is valid, else `us`.
 *
 * `appBaseUrl` on its own deliberately does NOT collapse the walk:
 * Query, Export and Engage still go to the live regional hosts, so the
 * region the probe discovers still decides where those requests land.
 *
 * @param overrides - The override bag.
 * @param requestedRegion - The `MP_REGION` hint (raw; may be anything).
 * @returns A one-element order when `apiBaseUrl` is set; `null`
 *   otherwise (callers then use `probeRegion`'s default order).
 * @example
 * ```typescript
 * overrideProbeOrder({ apiBaseUrl: "http://127.0.0.1:8080" }, "eu");
 * // ["eu"]
 * ```
 */
export function overrideProbeOrder(
  overrides: EndpointOverrides,
  requestedRegion: string | undefined,
): readonly Region[] | null {
  if (!hasApiBaseUrlOverride(overrides)) {
    return null;
  }
  for (const region of VALID_REGIONS) {
    if (requestedRegion === region) {
      return [region];
    }
  }
  return ["us"];
}

/**
 * The first `mp login` probe narration line under an override — TS port
 * of `api_client._override_probe_narration` (PR #235). Names whichever
 * override(s) are active so a user debugging a login failure sees the
 * configuration that actually shaped the probe.
 *
 * @param overrides - The override bag.
 * @returns `null` when neither member is set (the caller emits its
 *   legacy line). With `apiBaseUrl` set: a line naming the single probe
 *   base. With only `appBaseUrl` set: a line saying regions are still
 *   walked, at the App override base.
 * @example
 * ```typescript
 * overrideProbeNarration({ appBaseUrl: "http://app.internal:9000" });
 * // "Probing regions at http://app.internal:9000 (MP_APP_BASE_URL override) for /me access ..."
 * ```
 */
export function overrideProbeNarration(
  overrides: EndpointOverrides,
): string | null {
  const active: string[] = [];
  if (normalizeBaseUrlOverride(overrides.apiBaseUrl) !== "") {
    active.push(API_BASE_URL_ENV);
  }
  if (normalizeBaseUrlOverride(overrides.appBaseUrl) !== "") {
    active.push(APP_BASE_URL_ENV);
  }
  if (active.length === 0) {
    return null;
  }
  // The App URL is region-independent under either override.
  const base = probeBaseUrl(endpointBase("us", "app", overrides));
  const label = `(${active.join(" + ")} override)`;
  if (hasApiBaseUrlOverride(overrides)) {
    return `Probing ${base} ${label} for /me ...`;
  }
  return `Probing regions at ${base} ${label} for /me access ...`;
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
  /** The injected fetch the real probe clients run over. */
  readonly fetchImpl: typeof fetch;
  /**
   * Alternate-host overrides (PR #235) — a bag or per-call provider.
   * Absent → read through `getEnv` (`MP_API_BASE_URL` /
   * `MP_APP_BASE_URL`), Python's own source.
   */
  readonly endpointOverrides?: EndpointOverridesSource | undefined;
  /**
   * The region label to persist under an `apiBaseUrl` override (the
   * `MP_REGION` twin; anything outside `us`/`eu`/`in` falls back to
   * `us`). Absent → `getEnv("MP_REGION")`.
   */
  readonly regionHint?: string | null | undefined;
}

/**
 * Build the credential header, probe `us → eu → in`, return the region
 * (port of `probe_region_for_credential`, `region_probe.py`).
 *
 * Under an `apiBaseUrl` override (PR #235) the walk collapses to one
 * probe at the override base and the returned region is the region
 * hint (when valid) or `us` — see {@link overrideProbeOrder}.
 *
 * @param options - Credential material + seams (see the field docs).
 * @returns The first region whose `/me` returned 200 (under an
 *   override: the single probed region).
 * @throws ConfigError - Missing credential material for the given
 *   `account_type`, or `token_env` points at an unset/empty variable.
 * @throws RegionProbeError - Propagated from {@link probeRegion} when
 *   no region accepts the credential.
 * @throws RegionProbeNetworkError - Propagated from {@link probeRegion}
 *   when every probe failed at the network layer.
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
    // Caution #10; `region_probe.py`).
    const raw = `${username}:${secret.reveal()}`;
    headers = { Authorization: `Basic ${base64EncodeUtf8(raw)}` };
  } else if (account_type === "oauth_token") {
    let bearer: string;
    if (token !== null) {
      bearer = token.reveal();
    } else if (token_env === null) {
      throw new ConfigError(
        "oauth_token region probe requires `token` or `token_env`.",
      );
    } else {
      bearer = getEnv(token_env) ?? "";
      if (bearer === "") {
        // Python `if not bearer` — unset AND empty both reject
        // (:252-260).
        throw new ConfigError(
          `--token-env ${pythonRepr(token_env)} is unset; cannot probe region.`,
        );
      }
    }
    headers = { Authorization: `Bearer ${bearer}` };
  } else {
    throw new ConfigError(
      `Region probe is not defined for account type ${pythonRepr(account_type)}.`,
    );
  }

  // PR #235: overrides injected, else Python's env reads via the seam.
  const getOverrides =
    options.endpointOverrides === undefined
      ? endpointOverridesFromEnv(getEnv)
      : endpointOverridesProvider(options.endpointOverrides);
  const overrides = getOverrides();
  const regionHint =
    options.regionHint === undefined
      ? getEnv("MP_REGION")
      : (options.regionHint ?? undefined);

  /**
   * Build a region-scoped probe client bound to the App API host
   * (the Python `_factory` twin, `region_probe.py`; base via
   * {@link probeBaseUrl} so an override base keeps its path prefix).
   *
   * @param region - The region to probe (ignored for URL purposes when
   *   an `apiBaseUrl` override is active).
   * @returns The real probe client.
   */
  const factory: ClientFactory = (region: Region): ProbeClient => {
    const appUrl = endpointBase(region, "app", overrides);
    return probeClientFromFetch(options.fetchImpl, probeBaseUrl(appUrl));
  };

  const overrideOrder = overrideProbeOrder(overrides, regionHint);
  if (narrate !== null) {
    narrate(
      overrideProbeNarration(overrides) ?? "Probing regions for /me access ...",
    );
  }
  const result =
    overrideOrder === null
      ? await probeRegion(factory, headers)
      : await probeRegion(factory, headers, { order: overrideOrder });
  if (narrate !== null) {
    for (const [regionName, status] of result.attempts) {
      const marker = status === 200 ? "✓" : "✗";
      narrate(`  ${regionName}: ${String(status)} ${marker}`);
    }
  }
  return result.region;
}
