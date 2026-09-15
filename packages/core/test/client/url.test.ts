// The regional endpoint table and `buildUrl` (query/export/engage prefixes,
// leading-slash normalisation). Mirrors TestEndpoints and TestBuildUrl from
// tests/unit/test_api_client.py; Python drives `client._build_url` on a
// Session-bound client, here the pure `buildUrl(region, kind, path)` is
// called with the fixture's region literal — every expected value is verbatim.
import { describe, expect, it } from "vitest";

import { buildUrl, ENDPOINTS } from "../../src/client/url.js";

describe("Endpoints", () => {
  // python: TestEndpoints
  it("us endpoints defined", () => {
    // python: test_us_endpoints_defined
    // Python: `"us" in ENDPOINTS` + per-key membership.
    const us = ENDPOINTS.get("us");
    expect(us).toBeDefined();
    expect(us?.has("query")).toBe(true);
    expect(us?.has("export")).toBe(true);
    expect(us?.has("engage")).toBe(true);
  });

  it("EU endpoints defined", () => {
    // python: test_eu_endpoints_defined
    const eu = ENDPOINTS.get("eu");
    expect(eu).toBeDefined();
    expect(eu?.has("query")).toBe(true);
    expect(eu?.has("export")).toBe(true);
  });

  it("india endpoints defined", () => {
    // python: test_india_endpoints_defined
    const india = ENDPOINTS.get("in");
    expect(india).toBeDefined();
    expect(india?.has("query")).toBe(true);
    expect(india?.has("export")).toBe(true);
  });

  it("engage uses query API path", () => {
    // python: test_engage_uses_query_api_path
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

describe("Build URL", () => {
  // python: TestBuildUrl
  it("build query URL us", () => {
    // python: test_build_query_url_us
    expect(buildUrl("us", "query", "/segmentation")).toBe(
      "https://mixpanel.com/api/query/segmentation",
    );
  });

  it("build query URL EU", () => {
    // python: test_build_query_url_eu
    expect(buildUrl("eu", "query", "/segmentation")).toBe(
      "https://eu.mixpanel.com/api/query/segmentation",
    );
  });

  it("build query URL india", () => {
    // python: test_build_query_url_india
    expect(buildUrl("in", "query", "/segmentation")).toBe(
      "https://in.mixpanel.com/api/query/segmentation",
    );
  });

  it("build export URL us", () => {
    // python: test_build_export_url_us
    expect(buildUrl("us", "export", "/export")).toBe(
      "https://data.mixpanel.com/api/2.0/export",
    );
  });

  it("build export URL EU", () => {
    // python: test_build_export_url_eu
    expect(buildUrl("eu", "export", "/export")).toBe(
      "https://data-eu.mixpanel.com/api/2.0/export",
    );
  });

  it("build URL adds leading slash", () => {
    // python: test_build_url_adds_leading_slash
    expect(buildUrl("us", "query", "segmentation")).toBe(
      "https://mixpanel.com/api/query/segmentation",
    );
  });
});
