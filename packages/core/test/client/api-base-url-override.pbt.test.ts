// Layer-3 translation — Python PR #235 (AIE-925):
// tests/unit/test_api_base_url_override_pbt.py → fast-check.
//
// Properties (verbatim from the Python module docstring):
// - For any well-formed base URL and any run of trailing slashes, every
//   API family resolves to `base.rstrip("/") + prefix` — no double
//   slashes, no region influence, and `_build_url` appends the
//   normalised path after it.
// - With the override unset, `_endpoints_for` returns the live table
//   object and the live table is never modified by resolving an override.
//
// Mechanism substitution: `mock.patch.dict(os.environ, {...})` → the
// injected `endpointOverrides` bag (R9.1: core reads no env).

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createMixpanelClient } from "../../src/client/client.js";
import {
  type EndpointKind,
  ENDPOINTS,
  endpointsFor,
  type Region,
} from "../../src/client/url.js";
import { makeSession } from "../../test-support/client-test-helpers.js";

/** The documented per-family path prefixes. */
const PREFIXES: Readonly<Record<EndpointKind, string>> = {
  query: "/api/query",
  export: "/api/2.0",
  engage: "/api/query/engage",
  app: "/api/app",
};

/** Deep copy of the live table at import, to detect any later mutation. */
const LIVE_SNAPSHOT: Record<string, Record<string, string>> = {};
for (const [region, table] of ENDPOINTS) {
  LIVE_SNAPSHOT[region] = Object.fromEntries(table);
}

// ── Strategies ────────────────────────────────────────────────────────

const regions = fc.constantFrom<Region>("us", "eu", "in");
const apiTypes = fc.constantFrom<EndpointKind>(
  ...(Object.keys(PREFIXES).sort() as EndpointKind[]),
);

const label = fc.stringMatching(/^[a-z0-9]{1,8}$/);
const hosts = fc.oneof(
  fc.constant("127.0.0.1"),
  fc.constant("localhost"),
  fc.array(label, { minLength: 1, maxLength: 3 }).map((xs) => xs.join(".")),
);
const ports = fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 65535 }));
const pathSegments = fc.array(fc.stringMatching(/^[a-z0-9_-]{1,8}$/), {
  maxLength: 3,
});

/** A normalised base URL like `http://host:port/seg/seg`, no trailing slash. */
const baseUrls = fc
  .record({
    scheme: fc.constantFrom("http", "https"),
    host: hosts,
    port: ports,
    segments: pathSegments,
  })
  .map(({ scheme, host, port, segments }) => {
    const netloc = port === null ? host : `${host}:${port}`;
    const path = segments.map((seg) => `/${seg}`).join("");
    return `${scheme}://${netloc}${path}`;
  });

const slashRuns = fc.integer({ min: 0, max: 5 }).map((n) => "/".repeat(n));

/** Current live table as a plain nested record. */
function liveNow(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [region, table] of ENDPOINTS) {
    out[region] = Object.fromEntries(table);
  }
  return out;
}

// ── Properties ────────────────────────────────────────────────────────

describe("test_api_base_url_override_pbt", () => {
  it("test_override_table_is_base_plus_prefix", () => {
    fc.assert(
      fc.property(baseUrls, slashRuns, regions, (base, slashes, region) => {
        const table = endpointsFor(region, {
          apiBaseUrl: `${base}${slashes}`,
        });
        const expected: Record<string, string> = {};
        for (const [family, prefix] of Object.entries(PREFIXES)) {
          expected[family] = `${base}${prefix}`;
        }
        expect(Object.fromEntries(table)).toStrictEqual(expected);
        for (const url of table.values()) {
          expect(url.startsWith(base)).toBe(true);
          expect(url.slice(base.length)).not.toContain("//");
        }
      }),
    );
  });

  it("test_build_url_appends_normalised_path", () => {
    fc.assert(
      fc.property(
        baseUrls,
        slashRuns,
        regions,
        apiTypes,
        (base, slashes, region, apiType) => {
          const client = createMixpanelClient({
            session: makeSession({ region }),
            endpointOverrides: { apiBaseUrl: `${base}${slashes}` },
          });
          const withSlash = client.core.buildUrl(apiType, "/segmentation");
          const withoutSlash = client.core.buildUrl(apiType, "segmentation");
          const expected = `${base}${PREFIXES[apiType]}/segmentation`;
          expect(withSlash).toBe(expected);
          expect(withoutSlash).toBe(expected);
        },
      ),
    );
  });

  it("test_unset_returns_live_table_untouched", () => {
    fc.assert(
      fc.property(regions, (region) => {
        const table = endpointsFor(region, {});
        expect(table).toBe(ENDPOINTS.get(region));
        expect(Object.fromEntries(table)).toStrictEqual(LIVE_SNAPSHOT[region]);
      }),
    );
  });

  it("test_resolving_override_never_mutates_live_table", () => {
    fc.assert(
      fc.property(baseUrls, slashRuns, regions, (base, slashes, region) => {
        endpointsFor(region, { apiBaseUrl: `${base}${slashes}` });
        endpointsFor(region, { appBaseUrl: `${base}${slashes}` });
        expect(liveNow()).toStrictEqual(LIVE_SNAPSHOT);
      }),
    );
  });
});
