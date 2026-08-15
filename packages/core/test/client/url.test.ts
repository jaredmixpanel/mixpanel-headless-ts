// Layer-3 translation of tests/unit/test_api_client.py::TestEndpoints
// (:83-116) and ::TestBuildUrl (:281-325) — Phase-3 packet B0-2.
//
// Entry-point substitution (B0-notes decision 13): Python drives
// `client._build_url(...)` on a Session-bound client; the TS B0 port is
// the pure `buildUrl(region, kind, path)` (the client class arrives in
// B4-C1). The us/eu/in Session fixtures reduce to their region literal —
// every assertion value is preserved verbatim.
import { describe, expect, it } from "vitest";
import { ENDPOINTS, buildUrl } from "../../src/client/url.js";

describe("TestEndpoints", () => {
  it("test_us_endpoints_defined", () => {
    // Python: `"us" in ENDPOINTS` + per-key membership.
    const us = ENDPOINTS.get("us");
    expect(us).toBeDefined();
    expect(us?.has("query")).toBe(true);
    expect(us?.has("export")).toBe(true);
    expect(us?.has("engage")).toBe(true);
  });

  it("test_eu_endpoints_defined", () => {
    const eu = ENDPOINTS.get("eu");
    expect(eu).toBeDefined();
    expect(eu?.has("query")).toBe(true);
    expect(eu?.has("export")).toBe(true);
  });

  it("test_india_endpoints_defined", () => {
    const india = ENDPOINTS.get("in");
    expect(india).toBeDefined();
    expect(india?.has("query")).toBe(true);
    expect(india?.has("export")).toBe(true);
  });

  it("test_engage_uses_query_api_path", () => {
    expect(ENDPOINTS.get("us")?.get("engage")).toBe(
      "https://mixpanel.com/api/query/engage",
    );
    expect(ENDPOINTS.get("eu")?.get("engage")).toBe(
      "https://eu.mixpanel.com/api/query/engage",
    );
    expect(ENDPOINTS.get("in")?.get("engage")).toBe(
      "https://in.mixpanel.com/api/query/engage",
    );
  });
});

describe("TestBuildUrl", () => {
  it("test_build_query_url_us", () => {
    expect(buildUrl("us", "query", "/segmentation")).toBe(
      "https://mixpanel.com/api/query/segmentation",
    );
  });

  it("test_build_query_url_eu", () => {
    expect(buildUrl("eu", "query", "/segmentation")).toBe(
      "https://eu.mixpanel.com/api/query/segmentation",
    );
  });

  it("test_build_query_url_india", () => {
    expect(buildUrl("in", "query", "/segmentation")).toBe(
      "https://in.mixpanel.com/api/query/segmentation",
    );
  });

  it("test_build_export_url_us", () => {
    expect(buildUrl("us", "export", "/export")).toBe(
      "https://data.mixpanel.com/api/2.0/export",
    );
  });

  it("test_build_export_url_eu", () => {
    expect(buildUrl("eu", "export", "/export")).toBe(
      "https://data-eu.mixpanel.com/api/2.0/export",
    );
  });

  it("test_build_url_adds_leading_slash", () => {
    expect(buildUrl("us", "query", "segmentation")).toBe(
      "https://mixpanel.com/api/query/segmentation",
    );
  });
});
