// Layer-3 translation — Python PR #235 (AIE-925):
// tests/unit/test_api_base_url_override.py (1,091 lines, 11 classes).
//
// Python drives the override through `MP_API_BASE_URL` / `MP_APP_BASE_URL`
// in `os.environ`, read PER REQUEST by `_endpoints_for`. `packages/core`
// never reads `process.env` (R9.1), so the TS twin injects the same two
// values through `MixpanelClientOptions.endpointOverrides` — a static bag
// or a per-call PROVIDER (the node package wires the `process.env`
// reader; `packages/node/test/endpoint-overrides.test.ts` covers that
// half). Mechanism substitutions (R10.2, header-cited):
//
// - `monkeypatch.setenv(...)` → the `endpointOverrides` option (a
//   mutable provider where Python flips the var mid-test).
// - `httpx.MockTransport` recorder → `createMockClient` over the injected
//   fetch (`client-test-helpers.ts`); `request.url.params` → the captured
//   `params` map.
// - `request.extensions["timeout"]["read"]` → the `timeoutSeconds` the
//   request executor receives (the `server-deadline.test.ts` vi.mock
//   pattern).
// - `_endpoints_for` / `_api_family_for` / `_build_url` → `endpointsFor`
//   / `apiFamilyFor` / `client.core.buildUrl`; dict equality → Map entry
//   equality; `is ENDPOINTS[region]` → `toBe(ENDPOINTS.get(region))`.
// - `TestCliInheritsOverride` (typer CliRunner) has no TS twin — there is
//   no CLI in this port; the shared-client property it locks is covered
//   by `TestWorkspaceFacadeHitsOverride`.
//
// The 31 override-SET Python tests are corpus-excluded upstream
// (`env_base_url_override` bucket — host-dependent URLs), so this file is
// the only lock on the override; the 4 override-UNSET vectors replay in
// the conformance corpus.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMixpanelClient } from "../../src/client/client.js";
import type {
  RequestExecutor,
  TransportRequestOptions,
} from "../../src/client/internals.js";
import {
  apiFamilyFor,
  DEFAULT_APP_TIMEOUT_S,
  DEFAULT_QUERY_TIMEOUT_S,
  type EndpointKind,
  type EndpointOverrides,
  ENDPOINTS,
  endpointsFor,
  type Region,
} from "../../src/client/url.js";
import { Workspace } from "../../src/workspace.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  fakeTransport,
  makeSession,
  staticTokenResolver,
} from "../../test-support/client-test-helpers.js";

/** The per-request `extensions["timeout"]["read"]` capture log. */
const capturedTimeouts: number[] = [];

vi.mock(import("../../src/client/transport.js"), async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    createRequestExecutor: (
      fetchImpl: typeof fetch,
      signal?: AbortSignal,
    ): RequestExecutor => {
      const real = mod.createRequestExecutor(fetchImpl, signal);
      return (options: TransportRequestOptions) => {
        capturedTimeouts.push(options.timeoutSeconds);
        return real(options);
      };
    },
  };
});

beforeEach(() => {
  capturedTimeouts.length = 0;
});

/** Override base used throughout; a plain-`http` loopback host. */
const BASE = "http://127.0.0.1:8080";

/** The prefix table from the work order, anchored at `BASE`. */
const EXPECTED: Readonly<Record<EndpointKind, string>> = {
  query: `${BASE}/api/query`,
  export: `${BASE}/api/2.0`,
  engage: `${BASE}/api/query/engage`,
  app: `${BASE}/api/app`,
};

const REGIONS: readonly Region[] = ["us", "eu", "in"];
const FAMILIES: readonly EndpointKind[] = ["query", "export", "engage", "app"];

/** The `override_env` fixture: `MP_API_BASE_URL=BASE`. */
const OVERRIDE: EndpointOverrides = { apiBaseUrl: BASE };

/** Snapshot of the live table (the `_LIVE_SNAPSHOT` twin). */
function snapshotLive(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [region, table] of ENDPOINTS) {
    out[region] = Object.fromEntries(table);
  }
  return out;
}
const LIVE_SNAPSHOT = snapshotLive();

/** Map → plain record (Python dict equality). */
function asRecord(
  table: ReadonlyMap<EndpointKind, string>,
): Record<string, string> {
  return Object.fromEntries(table);
}

/** A bare 200 `{"results": []}` handler. */
function okResults(): CannedResponse {
  return { status: 200, json: { results: [] } };
}

/** The `_Recorder` twin: canned per-path bodies + the captured requests. */
function recorder(): (request: CapturedFetchRequest) => CannedResponse {
  return (request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/events/names")) {
      return { status: 200, json: ["Login"] };
    }
    if (path.endsWith("/api/2.0/export")) {
      return { status: 200, text: '{"event":"A","properties":{}}\n' };
    }
    if (path.endsWith("/engage/stats")) {
      return { status: 200, json: { results: [], total: 0 } };
    }
    return okResults();
  };
}

/** Drain an async generator (the `list(...)` analog). */
async function drain<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) {
    out.push(item);
  }
  return out;
}

/** Strip the query string (Python `str(request.url.copy_with(query=None))`). */
function urlSansQuery(url: string): string {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
}

// =============================================================================
// _endpoints_for — override vs live table
// =============================================================================

describe("TestEndpointsForResolver", () => {
  it("test_unset_returns_live_table_object", () => {
    for (const region of REGIONS) {
      expect(endpointsFor(region)).toBe(ENDPOINTS.get(region));
      expect(endpointsFor(region, {})).toBe(ENDPOINTS.get(region));
      expect(endpointsFor(region, { apiBaseUrl: null, appBaseUrl: null })).toBe(
        ENDPOINTS.get(region),
      );
    }
  });

  it("test_override_ignores_region", () => {
    for (const region of REGIONS) {
      expect(asRecord(endpointsFor(region, OVERRIDE))).toEqual(EXPECTED);
    }
  });

  it("test_trailing_slashes_are_stripped", () => {
    for (const suffix of ["/", "//", "///"]) {
      expect(
        asRecord(endpointsFor("us", { apiBaseUrl: `${BASE}${suffix}` })),
      ).toEqual(EXPECTED);
    }
  });

  it("test_empty_or_slash_only_value_means_unset", () => {
    for (const value of ["", "/", "//"]) {
      expect(endpointsFor("eu", { apiBaseUrl: value })).toBe(
        ENDPOINTS.get("eu"),
      );
      expect(endpointsFor("eu", { appBaseUrl: value })).toBe(
        ENDPOINTS.get("eu"),
      );
    }
  });

  it("test_path_prefixed_base_is_preserved", () => {
    const table = endpointsFor("us", {
      apiBaseUrl: "https://proxy.example/mp/",
    });
    expect(table.get("query")).toBe("https://proxy.example/mp/api/query");
    expect(table.get("export")).toBe("https://proxy.example/mp/api/2.0");
    expect(table.get("engage")).toBe(
      "https://proxy.example/mp/api/query/engage",
    );
    expect(table.get("app")).toBe("https://proxy.example/mp/api/app");
  });

  it("test_live_table_is_never_mutated", () => {
    const before = snapshotLive();
    endpointsFor("us", OVERRIDE);
    endpointsFor("eu", OVERRIDE);
    endpointsFor("us", { appBaseUrl: "http://app.internal:9000" });
    expect(snapshotLive()).toEqual(before);
    expect(ENDPOINTS.get("us")?.get("query")).toBe(
      "https://mixpanel.com/api/query",
    );
  });

  it("test_app_base_alone_overrides_only_app_family", () => {
    const table = endpointsFor("eu", {
      appBaseUrl: "http://app.internal:9000/",
    });
    expect(table.get("app")).toBe("http://app.internal:9000/api/app");
    for (const family of ["query", "export", "engage"] as const) {
      expect(table.get(family)).toBe(ENDPOINTS.get("eu")?.get(family));
    }
    // The live table itself is untouched.
    expect(ENDPOINTS.get("eu")?.get("app")).toBe(
      "https://eu.mixpanel.com/api/app",
    );
  });

  it("test_app_base_wins_over_api_base_for_app_family", () => {
    const table = endpointsFor("us", {
      apiBaseUrl: BASE,
      appBaseUrl: "http://app.internal:9000",
    });
    expect(table.get("app")).toBe("http://app.internal:9000/api/app");
    expect(table.get("query")).toBe(EXPECTED.query);
    expect(table.get("export")).toBe(EXPECTED.export);
    expect(table.get("engage")).toBe(EXPECTED.engage);
  });
});

// =============================================================================
// _build_url — read at request time
// =============================================================================

describe("TestBuildUrlUnderOverride", () => {
  it("test_each_family_uses_prefix", () => {
    const client = createMixpanelClient({
      session: makeSession(),
      endpointOverrides: OVERRIDE,
    });
    for (const family of FAMILIES) {
      expect(client.core.buildUrl(family, "/x")).toBe(`${EXPECTED[family]}/x`);
    }
  });

  it("test_env_is_read_per_call_not_at_construction", () => {
    // `monkeypatch.setenv` after construction → a mutable provider the
    // client consults on every call (the node package's process.env
    // reader has exactly this shape).
    let current: EndpointOverrides = {};
    const client = createMixpanelClient({
      session: makeSession(),
      endpointOverrides: () => current,
    });
    const live = client.core.buildUrl("query", "/segmentation");
    expect(live).toBe("https://mixpanel.com/api/query/segmentation");
    current = OVERRIDE;
    expect(client.core.buildUrl("query", "/segmentation")).toBe(
      `${BASE}/api/query/segmentation`,
    );
    current = {};
    expect(client.core.buildUrl("query", "/segmentation")).toBe(live);
  });

  it("test_eu_session_is_redirected_too", () => {
    const client = createMixpanelClient({
      session: makeSession({ region: "eu" }),
      endpointOverrides: OVERRIDE,
    });
    expect(client.core.buildUrl("export", "/export")).toBe(
      `${BASE}/api/2.0/export`,
    );
  });
});

// =============================================================================
// Full request URL per family through the client
// =============================================================================

describe("TestClientRequestsHitOverride", () => {
  it("test_get_events_hits_query_prefix", async () => {
    const { client, transport } = createMockClient(makeSession(), recorder(), {
      endpointOverrides: OVERRIDE,
    });
    await client.getEvents();
    expect(transport.captures.map((r) => urlSansQuery(r.url))).toEqual([
      `${BASE}/api/query/events/names`,
    ]);
  });

  it("test_export_events_hits_export_prefix", async () => {
    const { client, transport } = createMockClient(makeSession(), recorder(), {
      endpointOverrides: OVERRIDE,
    });
    await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    expect(transport.captures.map((r) => urlSansQuery(r.url))).toEqual([
      `${BASE}/api/2.0/export`,
    ]);
  });

  it("test_engage_stats_hits_engage_prefix", async () => {
    const { client, transport } = createMockClient(makeSession(), recorder(), {
      endpointOverrides: OVERRIDE,
    });
    await client.engageStats();
    expect(transport.captures.map((r) => urlSansQuery(r.url))).toEqual([
      `${BASE}/api/query/engage/stats`,
    ]);
  });

  it("test_app_request_hits_app_prefix", async () => {
    const { client, transport } = createMockClient(makeSession(), recorder(), {
      endpointOverrides: OVERRIDE,
    });
    await client.appRequest("GET", "/projects/12345/dashboards");
    expect(transport.captures.map((r) => urlSansQuery(r.url))).toEqual([
      `${BASE}/api/app/projects/12345/dashboards`,
    ]);
  });

  it("test_trailing_slash_base_yields_clean_urls", async () => {
    const { client, transport } = createMockClient(makeSession(), recorder(), {
      endpointOverrides: { apiBaseUrl: `${BASE}/` },
    });
    await client.getEvents();
    await client.appRequest("GET", "/projects/12345/dashboards");
    const urls = transport.captures.map((r) => urlSansQuery(r.url));
    expect(urls).toEqual([
      `${BASE}/api/query/events/names`,
      `${BASE}/api/app/projects/12345/dashboards`,
    ]);
    for (const url of urls) {
      expect(url.slice(BASE.length)).not.toContain("//");
    }
  });
});

// =============================================================================
// Route-aware timeout + workspace_id injection under the override
// =============================================================================

describe("TestTimeoutSelectionUnderOverride", () => {
  it("test_app_request_keeps_app_timeout", async () => {
    const { client } = createMockClient(makeSession(), okResults, {
      endpointOverrides: OVERRIDE,
    });
    await client.appRequest("GET", "/projects/12345/dashboards");
    expect(capturedTimeouts[0]).toBe(DEFAULT_APP_TIMEOUT_S);
  });

  it("test_query_request_keeps_query_timeout", async () => {
    const { client } = createMockClient(makeSession(), recorder(), {
      endpointOverrides: OVERRIDE,
    });
    await client.getEvents();
    expect(capturedTimeouts[0]).toBe(DEFAULT_QUERY_TIMEOUT_S);
    await client.request("GET", `${BASE}/api/query/segmentation`);
    expect(capturedTimeouts[1]).toBe(DEFAULT_QUERY_TIMEOUT_S);
  });

  it("test_split_app_host_still_selects_app_timeout", async () => {
    const { client } = createMockClient(makeSession(), okResults, {
      endpointOverrides: {
        apiBaseUrl: BASE,
        appBaseUrl: "http://app.internal:9000",
      },
    });
    await client.appRequest("GET", "/projects/12345/dashboards");
    expect(capturedTimeouts[0]).toBe(DEFAULT_APP_TIMEOUT_S);
  });
});

describe("TestWorkspaceIdInjectionUnderOverride", () => {
  const pinned = (): ReturnType<typeof makeSession> =>
    makeSession({ workspaceId: 777 });

  it("test_pinned_query_request_carries_workspace_id", async () => {
    const { client, transport } = createMockClient(pinned(), recorder(), {
      endpointOverrides: OVERRIDE,
    });
    await client.getEvents();
    const params = transport.captures[0]?.params ?? {};
    expect(params["workspace_id"]).toBe("777");
    expect(params["project_id"]).toBe("12345");
  });

  it("test_pinned_app_request_does_not_carry_workspace_id", async () => {
    const { client, transport } = createMockClient(pinned(), okResults, {
      endpointOverrides: OVERRIDE,
    });
    await client.appRequest("GET", "/projects/12345/dashboards");
    expect(
      Object.hasOwn(transport.captures[0]?.params ?? {}, "workspace_id"),
    ).toBe(false);
  });

  it("test_unpinned_query_request_has_no_workspace_id", async () => {
    const { client, transport } = createMockClient(makeSession(), recorder(), {
      endpointOverrides: OVERRIDE,
    });
    await client.getEvents();
    expect(
      Object.hasOwn(transport.captures[0]?.params ?? {}, "workspace_id"),
    ).toBe(false);
  });
});

// =============================================================================
// _api_family_for — longest-prefix family classification
// =============================================================================

describe("TestApiFamilyFor", () => {
  it("test_live_table_classification", () => {
    const cases: ReadonlyArray<readonly [string, EndpointKind | null]> = [
      ["https://mixpanel.com/api/query/insights", "query"],
      ["https://mixpanel.com/api/query/engage/", "engage"],
      ["https://mixpanel.com/api/query/engage/stats", "engage"],
      ["https://data.mixpanel.com/api/2.0/export", "export"],
      ["https://mixpanel.com/api/app/projects/1/dashboards", "app"],
      ["https://example.com/api/query/insights", null],
    ];
    const us = ENDPOINTS.get("us");
    expect(us).toBeDefined();
    for (const [url, family] of cases) {
      expect(apiFamilyFor(url, us as ReadonlyMap<EndpointKind, string>)).toBe(
        family,
      );
    }
  });

  it("test_longest_prefix_wins_under_collision", () => {
    const table = new Map<EndpointKind, string>([
      ["query", "https://proxy/api/query"],
      ["export", "https://proxy/api/2.0"],
      ["engage", "https://proxy/api/query/engage"],
      ["app", "https://proxy/api/query/api/app"],
    ]);
    expect(apiFamilyFor("https://proxy/api/query/api/app/x", table)).toBe(
      "app",
    );
    expect(apiFamilyFor("https://proxy/api/query/insights", table)).toBe(
      "query",
    );
    expect(apiFamilyFor("https://proxy/api/query/engage/", table)).toBe(
      "engage",
    );
  });
});

describe("TestPrefixCollisionConfigs", () => {
  /** App base nested under the query prefix (reviewer config 1). */
  const APP_UNDER_QUERY: EndpointOverrides = {
    apiBaseUrl: "https://proxy",
    appBaseUrl: "https://proxy/api/query",
  };
  /** Query prefix nested under the app base (the colliding reverse). */
  const QUERY_UNDER_APP: EndpointOverrides = {
    apiBaseUrl: "https://proxy/api/app",
    appBaseUrl: "https://proxy",
  };
  /** The literal reverse of config 1 (no textual overlap; must still be right). */
  const REVERSE_LITERAL: EndpointOverrides = {
    apiBaseUrl: "https://proxy/api/query",
    appBaseUrl: "https://proxy",
  };
  const CONFIGS = [APP_UNDER_QUERY, QUERY_UNDER_APP, REVERSE_LITERAL];

  /** The `_seen_for` twin: one request under `overrides`, captured. */
  async function seenFor(
    call: "app" | "query",
    overrides: EndpointOverrides,
  ): Promise<{ request: CapturedFetchRequest; timeout: number }> {
    capturedTimeouts.length = 0;
    const { client, transport } = createMockClient(
      makeSession({ workspaceId: 777 }),
      recorder(),
      { endpointOverrides: overrides },
    );
    if (call === "app") {
      await client.appRequest("GET", "/projects/12345/dashboards");
    } else {
      await client.getEvents();
    }
    expect(transport.captures).toHaveLength(1);
    const request = transport.captures[0] as CapturedFetchRequest;
    return { request, timeout: capturedTimeouts[0] as number };
  }

  it("test_app_request_is_app_family", async () => {
    for (const overrides of CONFIGS) {
      const { request, timeout } = await seenFor("app", overrides);
      expect(
        new URL(request.url).pathname.endsWith(
          "/api/app/projects/12345/dashboards",
        ),
      ).toBe(true);
      expect(timeout).toBe(DEFAULT_APP_TIMEOUT_S);
      expect(Object.hasOwn(request.params, "workspace_id")).toBe(false);
    }
  });

  it("test_query_request_is_query_family", async () => {
    for (const overrides of CONFIGS) {
      const { request, timeout } = await seenFor("query", overrides);
      expect(
        new URL(request.url).pathname.endsWith("/api/query/events/names"),
      ).toBe(true);
      expect(timeout).toBe(DEFAULT_QUERY_TIMEOUT_S);
      expect(request.params["workspace_id"]).toBe("777");
    }
  });

  it("test_live_engage_request_still_carries_workspace_id", async () => {
    const { client, transport } = createMockClient(
      makeSession({ workspaceId: 777 }),
      recorder(),
    );
    await client.engageStats();
    const request = transport.captures[0] as CapturedFetchRequest;
    expect(
      request.url.startsWith("https://mixpanel.com/api/query/engage/stats"),
    ).toBe(true);
    expect(request.params["workspace_id"]).toBe("777");
    expect(capturedTimeouts[0]).toBe(DEFAULT_QUERY_TIMEOUT_S);
  });
});

// =============================================================================
// Workspace() — the acceptance list (the `env_workspace` fixture twin:
// the facade builds its own client from `clientOptions`, the path
// `createNodeWorkspace()` / `createBrowserWorkspace()` take).
// =============================================================================

describe("TestWorkspaceFacadeHitsOverride", () => {
  const INSIGHTS_BODY = {
    computed_at: "2025-01-15T12:00:00",
    date_range: { from_date: "2025-01-01", to_date: "2025-01-31" },
    headers: ["$event"],
    series: { "A. Login": { "2025-01-01": 10 } },
    meta: { sampling_factor: 1.0 },
  };

  function envWorkspace(): {
    ws: Workspace;
    urls: () => string[];
  } {
    const transport = fakeTransport((request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/api/query/insights")) {
        return { status: 200, json: INSIGHTS_BODY };
      }
      return recorder()(request);
    });
    const ws = new Workspace({
      session: makeSession(),
      clientOptions: {
        fetch: transport.fetch,
        tokenResolver: staticTokenResolver(),
        endpointOverrides: OVERRIDE,
      },
    });
    return {
      ws,
      urls: () => transport.captures.map((r) => urlSansQuery(r.url)),
    };
  }

  it("test_events", async () => {
    const { ws, urls } = envWorkspace();
    expect(await ws.events()).toEqual(["Login"]);
    expect(urls()).toEqual([`${BASE}/api/query/events/names`]);
  });

  it("test_query", async () => {
    const { ws, urls } = envWorkspace();
    await ws.query("Login", { last: 30 });
    expect(urls()).toEqual([`${BASE}/api/query/insights`]);
  });

  it("test_stream_events", async () => {
    const { ws, urls } = envWorkspace();
    const rows = await drain(
      ws.streamEvents({ from_date: "2024-01-01", to_date: "2024-01-31" }),
    );
    expect(rows).toHaveLength(1);
    expect(urls()).toEqual([`${BASE}/api/2.0/export`]);
  });
});

// =============================================================================
// Unset → byte-identical live behaviour
// =============================================================================

describe("TestUnsetIsLive", () => {
  it("test_query_url_matches_live_region", async () => {
    const cases: ReadonlyArray<readonly [Region, string]> = [
      ["us", "https://mixpanel.com/api/query/events/names"],
      ["eu", "https://eu.mixpanel.com/api/query/events/names"],
      ["in", "https://in.mixpanel.com/api/query/events/names"],
    ];
    for (const [region, expected] of cases) {
      const { client, transport } = createMockClient(
        makeSession({ region }),
        recorder(),
      );
      await client.getEvents();
      expect(transport.captures.map((r) => urlSansQuery(r.url))).toEqual([
        expected,
      ]);
    }
  });

  it("unset ⇒ every family's live URL is unchanged (all regions)", () => {
    for (const region of REGIONS) {
      const client = createMixpanelClient({ session: makeSession({ region }) });
      for (const family of FAMILIES) {
        expect(client.core.buildUrl(family, "/x")).toBe(
          `${LIVE_SNAPSHOT[region]?.[family]}/x`,
        );
      }
    }
  });
});
