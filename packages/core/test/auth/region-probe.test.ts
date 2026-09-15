// Layer-3 translation of `tests/unit/test_region_probe.py` (486 lines,
// 16 tests, 8 classes) — B7-A2 packet §2.4 (`b7-packets.md`).
//
// Mechanism substitutions (header-cited per R10.2 / packet §2.4):
// - httpx.MockTransport-backed `_client(handler)` fixtures translate to
//   hand-built `ProbeClient` fakes over the SAME per-region handler maps
//   (the `ProbeClient` interface IS the injected seam the TS port
//   defines in place of `httpx.Client` — packet §2.3).
// - `httpx.ConnectError("DNS lookup failed")` raised inside a handler
//   translates to a rejection with the R2.10-normalized
//   `MixpanelHttpError` whose cause chain mirrors the harness shape
//   (`transport-errors.ts` ConnectError row: TypeError("fetch failed")
//   → cause Error{code: ECONNREFUSED, message}) — packet §2.3 item 5.
// - `TestRegionProbeFactoryURLStripping`'s
//   `monkeypatch.setattr(rp_mod, "probe_region", _spy_probe)` spy is not
//   expressible over ESM exports; per packet §2.4 the class translates
//   to direct `probeBaseUrl` asserts PLUS a real
//   `probeRegionForCredential` run over an injected recording fetch
//   (the factory-construction observation point).
// - `request.extensions["timeout"]` introspection (httpx internals)
//   translates to asserting the `timeoutSeconds` the fake client
//   received — same observable (the probe plumbs the value per request).
//
// No assertion dropped; the network-error body assert keeps Python's own
// loosened OR form (`test_region_probe.py`).
import { describe, expect, it } from "vitest";

import type { Region } from "../../src/auth/account.js";
import {
  probeBaseUrl,
  type ProbeClient,
  probeRegion,
  probeRegionForCredential,
  type ProbeResponse,
  type RegionProbeResult,
} from "../../src/auth/region-probe.js";
import { MixpanelHttpError } from "../../src/client/internals.js";
import {
  ConfigError,
  RegionProbeError,
  RegionProbeNetworkError,
} from "../../src/errors.js";
import { Secret } from "../../src/secret.js";

// ---- helpers ---------------------------------------------------------

/** What one fake per-region handler sees for a single GET. */
interface CapturedGet {
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutSeconds: number;
}

/** A per-region handler: return a response or throw/reject. */
type Handler = (captured: CapturedGet) => ProbeResponse;

/**
 * Build a `ProbeClient` over a handler (the `_client(handler)` twin).
 *
 * @param handler - The mock response handler.
 * @returns A probe client whose `get` runs the handler.
 */
function fakeClient(handler: Handler): ProbeClient {
  return {
    get: (path, opts) =>
      Promise.resolve().then(() =>
        handler({
          path,
          headers: opts.headers,
          timeoutSeconds: opts.timeoutSeconds,
        }),
      ),
    close: () => {},
  };
}

/**
 * Build a region → client factory backed by per-region handlers (the
 * `_factory_for` twin). The optional `visited` list captures factory
 * invocation order so tests can assert short-circuit behavior.
 *
 * @param handlers - Per-region handlers.
 * @param visited - Optional invocation log.
 * @returns The client factory.
 */
function factoryFor(
  handlers: Partial<Record<Region, Handler>>,
  visited?: Region[],
): (region: Region) => ProbeClient {
  return (region: Region): ProbeClient => {
    visited?.push(region);
    const handler = handlers[region];
    if (handler === undefined) {
      throw new Error(`no handler for region ${region}`);
    }
    return fakeClient(handler);
  };
}

/** Return 200 with a minimal /me payload (the `_ok_handler` twin). */
const okHandler: Handler = () => ({ status: 200, text: '{"user_id": 1}' });

/** Return 401 Unauthorized (the `_unauth_handler` twin). */
const unauthHandler: Handler = () => ({ status: 401, text: "Unauthorized" });

/**
 * Reject the way the transport adapter rejects for a connect failure
 * (the `_network_error_handler` twin — R2.10 shape, see header note).
 *
 * @param message - The recorded failure message.
 * @returns A `MixpanelHttpError` with the undici-style cause chain.
 */
function networkError(message: string): MixpanelHttpError {
  const inner: Error & { code: string } = Object.assign(new Error(message), {
    code: "ECONNREFUSED",
  });
  const fetchFailure = new TypeError("fetch failed", { cause: inner });
  return new MixpanelHttpError(message, { cause: fetchFailure });
}

/** Handler that raises the network error (DNS lookup failed). */
const networkErrorHandler: Handler = () => {
  throw networkError("DNS lookup failed");
};

// ---- tests -----------------------------------------------------------

describe("Probe region happy paths", () => {
  // python: TestProbeRegionHappyPaths
  it("us succeeds first short circuits", async () => {
    // python: test_us_succeeds_first_short_circuits
    const visited: Region[] = [];
    const factory = factoryFor(
      { us: okHandler, eu: okHandler, in: okHandler },
      visited,
    );
    const result = await probeRegion(factory, { Authorization: "Basic xxx" });
    // `isinstance(result, RegionProbeResult)` → structural shape check.
    expect(result).toHaveProperty("region");
    expect(result).toHaveProperty("attempts");
    expect(result.region).toBe("us");
    expect(result.attempts).toStrictEqual([["us", 200]]);
    // "EU/IN should not be probed after US success"
    expect(visited).toStrictEqual(["us"]);
  });

  it("EU succeeds after us fails", async () => {
    // python: test_eu_succeeds_after_us_fails
    const visited: Region[] = [];
    const factory = factoryFor(
      { us: unauthHandler, eu: okHandler, in: okHandler },
      visited,
    );
    const result = await probeRegion(factory, { Authorization: "Basic xxx" });
    expect(result.region).toBe("eu");
    expect(result.attempts).toStrictEqual([
      ["us", 401],
      ["eu", 200],
    ]);
    expect(visited).toStrictEqual(["us", "eu"]);
  });

  it("in succeeds after us and EU fail", async () => {
    // python: test_in_succeeds_after_us_and_eu_fail
    const visited: Region[] = [];
    const factory = factoryFor(
      { us: unauthHandler, eu: unauthHandler, in: okHandler },
      visited,
    );
    const result = await probeRegion(factory, { Authorization: "Basic xxx" });
    expect(result.region).toBe("in");
    expect(result.attempts).toStrictEqual([
      ["us", 401],
      ["eu", 401],
      ["in", 200],
    ]);
    expect(visited).toStrictEqual(["us", "eu", "in"]);
  });
});

describe("Probe region error paths", () => {
  // python: TestProbeRegionErrorPaths
  it("all regions 401 raises with full attempts", async () => {
    // python: test_all_regions_401_raises_with_full_attempts
    const factory = factoryFor({
      us: unauthHandler,
      eu: unauthHandler,
      in: unauthHandler,
    });
    const thrown = await probeRegion(factory, {
      Authorization: "Basic xxx",
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(RegionProbeError);
    const attempts = (thrown as RegionProbeError).attempts;
    // Three attempts, in order; each carries the response body.
    expect(attempts).toHaveLength(3);
    expect(attempts.map((a) => a[0])).toStrictEqual(["us", "eu", "in"]);
    expect(attempts.map((a) => a[1])).toStrictEqual([401, 401, 401]);
    for (const attempt of attempts) {
      expect(attempt[2]).toContain("Unauthorized");
    }
  });

  it("network error rendered as status zero", async () => {
    // python: test_network_error_rendered_as_status_zero
    const factory = factoryFor({
      us: networkErrorHandler,
      eu: unauthHandler,
      in: unauthHandler,
    });
    const thrown = await probeRegion(factory, {
      Authorization: "Basic xxx",
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(RegionProbeError);
    const attempts = (thrown as RegionProbeError).attempts;
    // First attempt is the network error.
    expect(attempts[0]?.[0]).toBe("us");
    expect(attempts[0]?.[1]).toBe(0);
    // Body carries the network error reason for diagnostic use
    // (Python's own loosened OR assert, test_region_probe.py).
    const body = attempts[0]?.[2] ?? "";
    expect(
      body.includes("DNS lookup failed") || body.includes("ConnectError"),
    ).toBe(true);
  });

  it("all network errors raise network subclass", async () => {
    // python: test_all_network_errors_raise_network_subclass
    const factory = factoryFor({
      us: networkErrorHandler,
      eu: networkErrorHandler,
      in: networkErrorHandler,
    });
    const thrown = await probeRegion(factory, {
      Authorization: "Basic xxx",
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(RegionProbeNetworkError);
    // The subclass must still be a RegionProbeError so existing
    // `except RegionProbeError` callers keep working.
    expect(thrown).toBeInstanceOf(RegionProbeError);
    // Distinct error code so programmatic consumers can branch.
    expect((thrown as RegionProbeNetworkError).code).toBe(
      "OAUTH_NETWORK_UNREACHABLE",
    );
    // Every attempt must be a network error (status 0) — the
    // subclass invariant.
    const attempts = (thrown as RegionProbeNetworkError).attempts;
    expect(attempts).toHaveLength(3);
    for (const [, status] of attempts) {
      expect(status).toBe(0);
    }
  });

  it("mixed network and auth failure raises generic", async () => {
    // python: test_mixed_network_and_auth_failure_raises_generic
    const factory = factoryFor({
      us: networkErrorHandler,
      eu: networkErrorHandler,
      in: unauthHandler,
    });
    const thrown = await probeRegion(factory, {
      Authorization: "Basic xxx",
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(RegionProbeError);
    expect(thrown).not.toBeInstanceOf(RegionProbeNetworkError);
    expect((thrown as RegionProbeError).code).toBe("OAUTH_REGION_PROBE_FAILED");
  });
});

describe("Probe region ordering", () => {
  // python: TestProbeRegionOrdering
  it("custom order EU first", async () => {
    // python: test_custom_order_eu_first
    const visited: Region[] = [];
    const factory = factoryFor(
      { eu: okHandler, us: okHandler, in: okHandler },
      visited,
    );
    const result = await probeRegion(
      factory,
      { Authorization: "Basic xxx" },
      { order: ["eu", "us"] },
    );
    expect(result.region).toBe("eu");
    expect(visited).toStrictEqual(["eu"]);
  });

  it("custom order skips unlisted regions", async () => {
    // python: test_custom_order_skips_unlisted_regions
    const factory = factoryFor({
      eu: unauthHandler,
      us: okHandler,
      in: okHandler,
    });
    const thrown = await probeRegion(
      factory,
      { Authorization: "Basic xxx" },
      { order: ["eu"] },
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(RegionProbeError);
    expect(
      (thrown as RegionProbeError).attempts.map((a) => a[0]),
    ).toStrictEqual(["eu"]);
  });
});

describe("Probe region timeout", () => {
  // python: TestProbeRegionTimeout
  it("timeout is passed to request", async () => {
    // python: test_timeout_is_passed_to_request
    const capturedTimeouts: number[] = [];
    const captureHandler: Handler = (captured) => {
      capturedTimeouts.push(captured.timeoutSeconds);
      return { status: 200, text: '{"user_id": 1}' };
    };
    const factory = factoryFor({
      us: captureHandler,
      eu: okHandler,
      in: okHandler,
    });
    const result = await probeRegion(
      factory,
      { Authorization: "Basic xxx" },
      { timeoutSeconds: 2.5 },
    );
    expect(result.region).toBe("us");
    expect(capturedTimeouts).toHaveLength(1);
    // The 2.5-second figure reaches the per-request call.
    expect(capturedTimeouts[0]).toBe(2.5);
  });
});

describe("Probe region sends headers", () => {
  // python: TestProbeRegionSendsHeaders
  it("authorization header forwarded", async () => {
    // python: test_authorization_header_forwarded
    const captured: Array<string | undefined> = [];
    const captureHandler: Handler = (got) => {
      captured.push(got.headers["Authorization"]);
      return { status: 200, text: '{"user_id": 1}' };
    };
    const factory = factoryFor({
      us: captureHandler,
      eu: okHandler,
      in: okHandler,
    });
    await probeRegion(factory, { Authorization: "Basic SECRET" });
    expect(captured).toStrictEqual(["Basic SECRET"]);
  });

  it("request targets me endpoint", async () => {
    // python: test_request_targets_me_endpoint
    const capturedPaths: string[] = [];
    const captureHandler: Handler = (got) => {
      capturedPaths.push(got.path);
      return { status: 200, text: '{"user_id": 1}' };
    };
    const factory = factoryFor({
      us: captureHandler,
      eu: okHandler,
      in: okHandler,
    });
    await probeRegion(factory, {});
    expect(capturedPaths).toStrictEqual(["/api/app/me"]);
  });
});

describe("Probe region response body cap", () => {
  // python: TestProbeRegionResponseBodyCap
  it("oversized response body truncated to 4kib", async () => {
    // python: test_oversized_response_body_truncated_to_4kib
    const bigBody = "x".repeat(100_000); // 100 KB
    const bigBodyHandler: Handler = () => ({ status: 401, text: bigBody });
    // Every region returns the same oversized 401 — we just want to
    // confirm what lands in attempts, not test ordering here.
    const factory = factoryFor({
      us: bigBodyHandler,
      eu: bigBodyHandler,
      in: bigBodyHandler,
    });
    const thrown = await probeRegion(factory, {}).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(RegionProbeError);
    for (const attempt of (thrown as RegionProbeError).attempts) {
      expect(attempt[2].length).toBeLessThanOrEqual(4096);
    }
  });

  it("small response body preserved verbatim", async () => {
    // python: test_small_response_body_preserved_verbatim
    const smallBody = '{"error": "credential rejected"}';
    const smallBodyHandler: Handler = () => ({ status: 401, text: smallBody });
    const factory = factoryFor({
      us: smallBodyHandler,
      eu: smallBodyHandler,
      in: smallBodyHandler,
    });
    const thrown = await probeRegion(factory, {}).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(RegionProbeError);
    for (const attempt of (thrown as RegionProbeError).attempts) {
      expect(attempt[2]).toBe(smallBody);
    }
  });
});

describe("Region probe factory URL stripping", () => {
  // python: TestRegionProbeFactoryURLStripping
  // Header note: the Python class spies on `probe_region` via
  // monkeypatch to observe the factory's base URL. The TS twin asserts
  // the pure `probeBaseUrl` derivation directly AND observes the real
  // factory through an injected recording fetch (packet §2.4).

  it("factory drops path component for standard endpoint", async () => {
    // python: test_factory_drops_path_component_for_standard_endpoint
    // Pure derivation (the `_factory` base computation, :276-277).
    expect(probeBaseUrl("https://mixpanel.com/api/app")).toBe(
      "https://mixpanel.com",
    );
    // Real-factory observation: probeRegionForCredential's first
    // request must hit the stripped host root + /api/app/me.
    const seenUrls: string[] = [];
    const recordingFetch: typeof fetch = (input) => {
      seenUrls.push(input instanceof Request ? input.url : String(input));
      return Promise.resolve(new Response('{"user_id": 1}', { status: 200 }));
    };
    const region = await probeRegionForCredential({
      account_type: "service_account",
      username: "u",
      secret: new Secret("s"),
      token: null,
      token_env: null,
      getEnv: () => undefined,
      fetchImpl: recordingFetch,
    });
    expect(region).toBe("us");
    expect(seenUrls[0]).toBe("https://mixpanel.com/api/app/me");
  });

  it("factory handles trailing slash endpoint", () => {
    // python: test_factory_handles_trailing_slash_endpoint
    // Future `https://mixpanel.com/api/app/` (trailing slash) still
    // strips to the host root.
    expect(probeBaseUrl("https://mixpanel.com/api/app/")).toBe(
      "https://mixpanel.com",
    );
  });
});

describe("probe_region_for_credential guards (docstring contract)", () => {
  // These lock the ConfigError branches the vectors cannot see
  // (`probe_region_for_credential` is registry-audited-out — packet
  // §2.3 coverage note); the R10.9 harness enumerates the rest.

  it("service_account without username/secret raises ConfigError", async () => {
    await expect(
      probeRegionForCredential({
        account_type: "service_account",
        username: null,
        secret: null,
        token: null,
        token_env: null,
        getEnv: () => undefined,
        fetchImpl: fetch,
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("oauth_token with unset/empty token_env raises ConfigError", async () => {
    for (const value of [undefined, ""]) {
      await expect(
        probeRegionForCredential({
          account_type: "oauth_token",
          username: null,
          secret: null,
          token: null,
          token_env: "MY_TOKEN_VAR",
          getEnv: () => value,
          fetchImpl: fetch,
        }),
      ).rejects.toBeInstanceOf(ConfigError);
    }
  });
});

// Type-level exhaustiveness anchor: RegionProbeResult stays the
// two-field shape the corpus encodes.
it("RegionProbeResult keeps the two-field corpus shape", () => {
  const shape: RegionProbeResult = {
    region: "us",
    attempts: [["us", 200]],
  };
  expect(Object.keys(shape)).toStrictEqual(["region", "attempts"]);
});
