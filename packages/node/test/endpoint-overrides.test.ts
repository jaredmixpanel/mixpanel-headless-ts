// Python PR #235 (AIE-925) — the node half of the `MP_API_BASE_URL` /
// `MP_APP_BASE_URL` alternate-host override. Python reads both variables
// from `os.environ` on EVERY request (`api_client._endpoints_for`); the
// core client takes an injected provider, and `createNodeEndpointOverrides`
// is that provider over `process.env`, read at call time (the `env.ts`
// module rule: never at construction, never at module load).
//
// Sources: tests/unit/test_api_base_url_override.py::
// TestBuildUrlUnderOverride::test_env_is_read_per_call_not_at_construction
// (the per-request semantics lock), TestEndpointsForResolver (env-value
// normalisation through the real `process.env` path), and the
// `env_workspace` fixture (Workspace built from env inherits the
// override with no extra flag) — here via `createNodeWorkspace()`.
//
// Fixture pattern per `create-node-workspace.test.ts`: isolated `$HOME`,
// `MP_*` env scrub.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createMixpanelClient,
  ENDPOINTS,
  Secret,
} from "@mixpanel-headless/core";
import type { Session } from "@mixpanel-headless/core";
import {
  createNodeEndpointOverrides,
  createNodeEnv,
  createNodeWorkspace,
} from "../src/index.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

const BASE = "http://127.0.0.1:8080";

const cleanups: (() => void)[] = [];
let restoreEnv: () => void = () => undefined;
let savedHome: string | undefined;

beforeEach(() => {
  restoreEnv = scrubMpEnv();
  savedHome = process.env["HOME"];
  process.env["HOME"] = makeTempDir(cleanups);
});

afterEach(() => {
  if (savedHome === undefined) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = savedHome;
  }
  restoreEnv();
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/** A US service-account session (the `us_session` fixture twin). */
function usSession(): Session {
  return {
    account: {
      type: "service_account",
      name: "test_account",
      region: "us",
      username: "test_user",
      secret: new Secret("test_secret"),
    },
    project: { id: "12345" },
    workspace: null,
    headers: new Map<string, string>(),
  };
}

/** Export the SA quad so `createNodeWorkspace()` resolves from env. */
function exportSaQuad(region = "us"): void {
  process.env["MP_USERNAME"] = "test_user";
  process.env["MP_SECRET"] = "test_secret";
  process.env["MP_PROJECT_ID"] = "12345";
  process.env["MP_REGION"] = region;
}

describe("createNodeEndpointOverrides", () => {
  it("reads MP_API_BASE_URL / MP_APP_BASE_URL at call time (raw values)", () => {
    const provider = createNodeEndpointOverrides();
    expect(provider()).toEqual({
      apiBaseUrl: undefined,
      appBaseUrl: undefined,
    });
    process.env["MP_API_BASE_URL"] = `${BASE}/`;
    expect(provider()).toEqual({
      apiBaseUrl: `${BASE}/`,
      appBaseUrl: undefined,
    });
    process.env["MP_APP_BASE_URL"] = "http://app.internal:9000";
    expect(provider()).toEqual({
      apiBaseUrl: `${BASE}/`,
      appBaseUrl: "http://app.internal:9000",
    });
    delete process.env["MP_API_BASE_URL"];
    expect(provider()).toEqual({
      apiBaseUrl: undefined,
      appBaseUrl: "http://app.internal:9000",
    });
  });

  it("test_env_is_read_per_call_not_at_construction", () => {
    // Python: `MixpanelAPIClient(session)` built BEFORE the var is set
    // still redirects the next `_build_url`; unsetting restores live.
    const client = createMixpanelClient({
      session: usSession(),
      endpointOverrides: createNodeEndpointOverrides(),
    });
    const live = client.core.buildUrl("query", "/segmentation");
    expect(live).toBe("https://mixpanel.com/api/query/segmentation");
    process.env["MP_API_BASE_URL"] = BASE;
    expect(client.core.buildUrl("query", "/segmentation")).toBe(
      `${BASE}/api/query/segmentation`,
    );
    delete process.env["MP_API_BASE_URL"];
    expect(client.core.buildUrl("query", "/segmentation")).toBe(live);
  });

  it("every family resolves to {base}{prefix}; trailing slashes stripped", () => {
    const client = createMixpanelClient({
      session: usSession(),
      endpointOverrides: createNodeEndpointOverrides(),
    });
    for (const suffix of ["", "/", "//", "///"]) {
      process.env["MP_API_BASE_URL"] = `${BASE}${suffix}`;
      expect(Object.fromEntries(client.core.endpoints())).toEqual({
        query: `${BASE}/api/query`,
        export: `${BASE}/api/2.0`,
        engage: `${BASE}/api/query/engage`,
        app: `${BASE}/api/app`,
      });
    }
  });

  it("test_empty_or_slash_only_value_means_unset", () => {
    const client = createMixpanelClient({
      session: usSession(),
      endpointOverrides: createNodeEndpointOverrides(),
    });
    for (const value of ["", "/", "//"]) {
      process.env["MP_API_BASE_URL"] = value;
      expect(client.core.endpoints()).toBe(ENDPOINTS.get("us"));
    }
  });

  it("MP_APP_BASE_URL alone re-homes only the App API", () => {
    const client = createMixpanelClient({
      session: usSession(),
      endpointOverrides: createNodeEndpointOverrides(),
    });
    process.env["MP_APP_BASE_URL"] = "http://app.internal:9000/";
    const table = client.core.endpoints();
    expect(table.get("app")).toBe("http://app.internal:9000/api/app");
    expect(table.get("query")).toBe("https://mixpanel.com/api/query");
    expect(table.get("export")).toBe("https://data.mixpanel.com/api/2.0");
    expect(table.get("engage")).toBe("https://mixpanel.com/api/query/engage");
  });

  it("the generic env bag `get` sees the two variables too (auth flows)", () => {
    // `accounts-ops` / the region probe read the override through
    // `effects.env.get` (the `os.environ.get` twin) — same call-time rule.
    const env = createNodeEnv();
    expect(env.get("MP_API_BASE_URL")).toBeUndefined();
    process.env["MP_API_BASE_URL"] = BASE;
    expect(env.get("MP_API_BASE_URL")).toBe(BASE);
  });
});

describe("createNodeWorkspace inherits the override (env_workspace twin)", () => {
  it("Workspace() from env routes every family at MP_API_BASE_URL", async () => {
    exportSaQuad("eu");
    process.env["MP_API_BASE_URL"] = `${BASE}/`;
    const urls: string[] = [];
    const recordingFetch: typeof fetch = (input) => {
      const url = new URL(String(input));
      urls.push(`${url.origin}${url.pathname}`);
      return Promise.resolve(
        new Response('["Login"]', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };
    // `clientOptions.fetch` is the client transport seam (`fetchImpl`
    // feeds the auth effects) — no request may leave the process.
    const ws = createNodeWorkspace({
      clientOptions: { fetch: recordingFetch },
    });
    // Region resolved from env is `eu`; the URL is region-independent.
    expect(ws.session.account.region).toBe("eu");
    expect(await ws.events()).toEqual(["Login"]);
    expect(urls).toEqual([`${BASE}/api/query/events/names`]);
    // Flip mid-life: the same facade follows the current value.
    // (`ws.events()` is cached by the discovery service — go through the
    // wire client so a second request is actually issued.)
    delete process.env["MP_API_BASE_URL"];
    await ws.client.getEvents();
    expect(urls[1]).toBe("https://eu.mixpanel.com/api/query/events/names");
  });

  it("an explicit clientOptions.endpointOverrides wins over process.env", () => {
    exportSaQuad();
    process.env["MP_API_BASE_URL"] = BASE;
    const ws = createNodeWorkspace({
      clientOptions: { endpointOverrides: { apiBaseUrl: "http://pinned:1" } },
    });
    expect(ws.client.core.buildUrl("app", "/me")).toBe(
      "http://pinned:1/api/app/me",
    );
  });

  it("unset ⇒ live per-region hosts, byte-identical", () => {
    exportSaQuad("in");
    const ws = createNodeWorkspace();
    expect(ws.client.core.endpoints()).toBe(ENDPOINTS.get("in"));
    expect(ws.client.core.buildUrl("export", "/export")).toBe(
      "https://data-in.mixpanel.com/api/2.0/export",
    );
  });
});
