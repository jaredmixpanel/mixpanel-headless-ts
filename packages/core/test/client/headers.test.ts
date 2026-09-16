// The outbound request-header merge (`requestHeaders`: User-Agent default,
// env custom-header pair, `Session.headers`, caller extras) plus
// `QUERY_ORIGIN` / `getUserAgent`. Mirrors TestSessionHeadersOnOutboundRequests
// from tests/unit/test_settings_headers.py, asserting the merge output directly
// rather than the wire; env monkeypatching becomes the injected `getCustomHeaderEnv`.
import { describe, expect, it } from "vitest";

import {
  getUserAgent,
  QUERY_ORIGIN,
  requestHeaders,
  type RequestHeadersDeps,
  setEntryPoint,
} from "../../src/client/headers.js";

/**
 * Build merge deps mirroring the Python fixtures: `sessionHeaders` is the
 * `Session.headers` layer and `env` the `MP_CUSTOM_HEADER_NAME` /
 * `MP_CUSTOM_HEADER_VALUE` pair.
 *
 * @returns The deps bag for `requestHeaders`.
 */
function deps(
  sessionHeaders: Readonly<Record<string, string>>,
  env?: { name?: string | undefined; value?: string | undefined },
): RequestHeadersDeps {
  return {
    getUserAgent,
    getCustomHeaderEnv: () => env ?? {},
    sessionHeaders,
  };
}

describe("Session headers on outbound requests", () => {
  // python: TestSessionHeadersOnOutboundRequests
  it("session headers included in outbound request", () => {
    // python: test_session_headers_included_in_outbound_request
    // Python: env pre-cleared; Session.headers rides along on the request.
    const headers = requestHeaders(
      deps({ "X-Mixpanel-Cluster": "internal-1", "X-Tenant": "acme" }),
      { Authorization: "Basic dGVhbS5zYTp0ZWFtLXNlY3JldA==" },
    );
    expect(headers["X-Mixpanel-Cluster"]).toBe("internal-1");
    expect(headers["X-Tenant"]).toBe("acme");
  });

  it("session headers take precedence over env on collision", () => {
    // python: test_session_headers_take_precedence_over_env_on_collision
    // Python: MP_CUSTOM_HEADER_NAME=X-Cluster / ..._VALUE=from-env set;
    // Session.headers carries the same name — session wins (layer 3 > 2).
    const headers = requestHeaders(
      deps(
        { "X-Cluster": "from-session" },
        { name: "X-Cluster", value: "from-env" },
      ),
      {},
    );
    expect(headers["X-Cluster"]).toBe("from-session");
  });
});

// Merge-order locks derived from the numbered layers in the
// `mixpanel_headless.api_client._request_headers` docstring — TS-only coverage.
describe("requestHeaders layer order", () => {
  it("layer 1: User-Agent default is always present", () => {
    const headers = requestHeaders(deps({}), {});
    expect(headers["User-Agent"]).toBe(getUserAgent());
  });

  it("layer 2: env pair applies only when BOTH name and value are truthy", () => {
    // Python: `if custom_name and custom_value` — empty strings fail.
    expect(
      requestHeaders(deps({}, { name: "X-E", value: "v" }), {})["X-E"],
    ).toBe("v");
    expect(
      requestHeaders(deps({}, { name: "X-E", value: "" }), {})["X-E"],
    ).toBeUndefined();
    expect(
      requestHeaders(deps({}, { name: "", value: "v" }), {})["X-E"],
    ).toBeUndefined();
  });

  it("layer 4: caller extras override every earlier layer", () => {
    const headers = requestHeaders(
      deps({ "X-C": "session" }, { name: "X-C", value: "env" }),
      { "X-C": "extra" },
    );
    expect(headers["X-C"]).toBe("extra");
  });

  it("caller extras can override the User-Agent default", () => {
    const headers = requestHeaders(deps({}), { "User-Agent": "custom/1" });
    expect(headers["User-Agent"]).toBe("custom/1");
  });

  it("a null User-Agent source omits the header and leaves the other layers intact", () => {
    // The browser package disables layer 1 this way (`User-Agent` is a
    // forbidden request header and Safari forwards it into the CORS
    // preflight); the key must be absent, not empty.
    const headers = requestHeaders(
      {
        ...deps({ "X-Tenant": "acme" }, { name: "X-E", value: "v" }),
        getUserAgent: () => null,
      },
      { Authorization: "Bearer t" },
    );
    expect(Object.hasOwn(headers, "User-Agent")).toBe(false);
    expect(headers).toStrictEqual({
      "X-E": "v",
      "X-Tenant": "acme",
      Authorization: "Bearer t",
    });
  });

  it("a session header named User-Agent still wins over a null source", () => {
    const headers = requestHeaders(
      { ...deps({ "User-Agent": "session-ua/1" }), getUserAgent: () => null },
      {},
    );
    expect(headers["User-Agent"]).toBe("session-ua/1");
  });

  it("returns a NEW dict (Python builds a fresh dict per request)", () => {
    const extra = { Authorization: "Bearer t" };
    const headers = requestHeaders(deps({}), extra);
    expect(headers).not.toBe(extra);
    expect(headers["Authorization"]).toBe("Bearer t");
  });
});

describe("client metadata (client_metadata.py port)", () => {
  it("QUERY_ORIGIN is byte-identical to Python (wire-locked param value)", () => {
    expect(QUERY_ORIGIN).toBe("mixpanel-headless");
  });

  it("getUserAgent reflects the entry point and is re-read per call", () => {
    // Python: set_entry_point("cli") flips the entry= tag on the NEXT call.
    const before = getUserAgent();
    expect(before).toMatch(/^mixpanel-headless\/\d/);
    expect(before).toContain("entry=lib");
    try {
      setEntryPoint("cli");
      expect(getUserAgent()).toContain("entry=cli");
    } finally {
      setEntryPoint("lib");
    }
    expect(getUserAgent()).toBe(before);
  });
});
