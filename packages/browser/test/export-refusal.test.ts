// Layer-3 suite for the Export-API browser exclusion (b9-packets.md
// §2.4; contract arbiter plan §4.3 tier table: "Export is Node-only" —
// the D2 spike found data.mixpanel.com / data-eu / data-in serve NO
// CORS headers, so browser calls are dead on arrival). The exclusion
// is enforced at the TRANSPORT: the factory wraps the injected fetch
// with a guard that refuses any request to an export-host origin with
// a coded BrowserUnsupportedError BEFORE any network attempt — one
// documented error instead of an opaque CORS TypeError.
// R5: assertions key on the CODE.

import { describe, expect, it } from "vitest";

import {
  type EndpointOverrides,
  type EndpointOverridesSource,
  ENDPOINTS,
} from "@mixpanel-headless/core";

import {
  BROWSER_EXPORT_UNSUPPORTED,
  BrowserUnsupportedError,
  createBrowserWorkspace,
} from "../src/index.js";
import { type FakeTransport, fakeTransport } from "./helpers.js";

/**
 * Build a workspace over a canned transport.
 *
 * @param transport - The canned transport to inject.
 * @returns The browser workspace.
 */
function makeWorkspace(
  transport: FakeTransport,
): ReturnType<typeof createBrowserWorkspace> {
  return createBrowserWorkspace({
    token: "tok-123",
    projectId: "12345",
    region: "us",
    fetch: transport.fetch,
  });
}

/** Every export-host origin in the core ENDPOINTS table (all regions). */
const EXPORT_ORIGINS: string[] = [...ENDPOINTS.values()].map(
  (table) => new URL(table.get("export")!).origin,
);

describe("§2.4 (b) — every export host is refused with BROWSER_EXPORT_UNSUPPORTED", () => {
  it("the region table yields the three known export origins", () => {
    expect(EXPORT_ORIGINS).toHaveLength(3);
    expect(new Set(EXPORT_ORIGINS)).toStrictEqual(
      new Set([
        "https://data.mixpanel.com",
        "https://data-eu.mixpanel.com",
        "https://data-in.mixpanel.com",
      ]),
    );
  });

  it.each(EXPORT_ORIGINS)(
    "refuses %s before any network attempt",
    async (origin) => {
      const transport = fakeTransport(() => ({ status: 200, json: {} }));
      const ws = makeWorkspace(transport);
      let thrown: unknown;
      try {
        await ws.client.request("GET", `${origin}/api/2.0/export`);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(BrowserUnsupportedError);
      expect((thrown as BrowserUnsupportedError).code).toBe(
        BROWSER_EXPORT_UNSUPPORTED,
      );
      // Fail-fast: the guard threw before the transport saw anything.
      expect(transport.captures).toHaveLength(0);
    },
  );
});

describe("§2.4 (a) — Query-host and App-host requests pass through untouched", () => {
  it("Query-host traffic flows (getEvents)", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: [] }));
    const ws = makeWorkspace(transport);
    await ws.client.getEvents();
    expect(transport.captures.length).toBeGreaterThan(0);
    expect(new URL(transport.captures[0]!.url).origin).toBe(
      "https://mixpanel.com",
    );
  });

  it("App-host traffic flows (escape-hatch request to /api/app)", async () => {
    const transport = fakeTransport(() => ({
      status: 200,
      json: { ok: true },
    }));
    const ws = makeWorkspace(transport);
    await ws.client.request("GET", "https://mixpanel.com/api/app/me");
    expect(transport.captures).toHaveLength(1);
  });
});

describe("§2.4 (c) — the guard wraps WHATEVER fetch the caller injected (R2.4 preserved)", () => {
  it("allowed requests reach the injected double; refused ones never do", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: [] }));
    const ws = makeWorkspace(transport);
    await ws.client.getEvents();
    const seen = transport.captures.length;
    expect(seen).toBeGreaterThan(0);
    await expect(
      ws.client.request("GET", "https://data.mixpanel.com/api/2.0/export"),
    ).rejects.toMatchObject({ code: BROWSER_EXPORT_UNSUPPORTED });
    expect(transport.captures).toHaveLength(seen);
  });
});

// ── AIE-926 (PR #11 follow-up): the verdict derives from the EFFECTIVE
// endpoint table per request. `endpointOverrides.apiBaseUrl` re-homes
// the export family at `{apiBaseUrl}/api/2.0` — a user-controlled host
// (normally a CORS-capable proxy), which is exactly where browser export
// CAN work — so those requests are admitted, while the live export
// origins (the hosts with no CORS headers) stay refused in every
// configuration. A provider-form override is consulted on every call.

const PROXY = "https://proxy.example.test";

/**
 * Origin + pathname of a captured URL (the core appends its
 * `query_origin` marker to every request).
 *
 * @param url - The captured absolute URL.
 * @returns The URL without its query string.
 */
function pathOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

/**
 * Build a workspace over a canned transport with endpoint overrides.
 *
 * @param transport - The canned transport to inject.
 * @param endpointOverrides - Static bag or per-call provider.
 * @param region - The session region (default `us`).
 * @returns The browser workspace.
 */
function makeOverrideWorkspace(
  transport: FakeTransport,
  endpointOverrides: EndpointOverridesSource,
  region: "us" | "eu" | "in" = "us",
): ReturnType<typeof createBrowserWorkspace> {
  return createBrowserWorkspace({
    token: "tok-123",
    projectId: "12345",
    region,
    fetch: transport.fetch,
    clientOptions: { endpointOverrides },
  });
}

/**
 * Await a request and return the thrown error (or `undefined`).
 *
 * @param ws - The workspace.
 * @param url - The absolute URL to request.
 * @returns Whatever the request threw.
 */
async function requestError(
  ws: ReturnType<typeof createBrowserWorkspace>,
  url: string,
): Promise<unknown> {
  try {
    await ws.client.request("GET", url);
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("AIE-926 — the export guard evaluates the EFFECTIVE endpoint table", () => {
  it("no overrides: the effective export base IS a live origin and is refused", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    const ws = makeWorkspace(transport);
    const exportBase = ws.client.core.endpoints().get("export")!;
    expect(EXPORT_ORIGINS).toContain(new URL(exportBase).origin);
    const thrown = await requestError(ws, `${exportBase}/export`);
    expect(thrown).toBeInstanceOf(BrowserUnsupportedError);
    expect((thrown as BrowserUnsupportedError).code).toBe(
      BROWSER_EXPORT_UNSUPPORTED,
    );
    expect((thrown as BrowserUnsupportedError).details).toStrictEqual({
      origin: "https://data.mixpanel.com",
    });
    expect(transport.captures).toHaveLength(0);
  });

  it("no overrides: the refusal message hints at endpointOverrides.apiBaseUrl", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    const ws = makeWorkspace(transport);
    const thrown = (await requestError(
      ws,
      "https://data.mixpanel.com/api/2.0/export",
    )) as BrowserUnsupportedError;
    expect(thrown.message).toContain("is Node-only");
    expect(thrown.message).toContain("Use @mixpanel-headless/node");
    expect(thrown.message).toContain("CORS-capable proxy");
    expect(thrown.message).toContain("endpointOverrides.apiBaseUrl");
  });

  it("apiBaseUrl set: export is re-homed and the override-host request reaches the inner fetch", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    const ws = makeOverrideWorkspace(transport, { apiBaseUrl: PROXY });
    const exportBase = ws.client.core.endpoints().get("export");
    expect(exportBase).toBe(`${PROXY}/api/2.0`);
    await ws.client.request("GET", `${exportBase!}/export`);
    expect(transport.captures).toHaveLength(1);
    expect(pathOf(transport.captures[0]!.url)).toBe(`${PROXY}/api/2.0/export`);
  });

  it("apiBaseUrl set: the client's own export paths route to the override host and are admitted", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    const ws = makeOverrideWorkspace(transport, { apiBaseUrl: PROXY });
    const url = ws.client.core.buildUrl("export", "/export");
    expect(url).toBe(`${PROXY}/api/2.0/export`);
    await ws.client.request("GET", url);
    expect(transport.captures.map((c) => new URL(c.url).origin)).toStrictEqual([
      PROXY,
    ]);
  });

  it.each(EXPORT_ORIGINS)(
    "apiBaseUrl set: the live origin %s is STILL refused (defence in depth)",
    async (origin) => {
      const transport = fakeTransport(() => ({ status: 200, json: {} }));
      const ws = makeOverrideWorkspace(transport, { apiBaseUrl: PROXY });
      const thrown = await requestError(ws, `${origin}/api/2.0/export`);
      expect(thrown).toBeInstanceOf(BrowserUnsupportedError);
      expect((thrown as BrowserUnsupportedError).code).toBe(
        BROWSER_EXPORT_UNSUPPORTED,
      );
      expect((thrown as BrowserUnsupportedError).details).toStrictEqual({
        origin,
      });
      expect(transport.captures).toHaveLength(0);
    },
  );

  it("apiBaseUrl set: the refusal for a live origin says export is re-homed", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    const ws = makeOverrideWorkspace(transport, { apiBaseUrl: PROXY });
    const thrown = (await requestError(
      ws,
      "https://data-eu.mixpanel.com/api/2.0/export",
    )) as BrowserUnsupportedError;
    expect(thrown.code).toBe(BROWSER_EXPORT_UNSUPPORTED);
    expect(thrown.message).toContain("is Node-only");
    expect(thrown.message).toContain(
      `re-homed at ${PROXY}/api/2.0 by endpointOverrides.apiBaseUrl`,
    );
  });

  it.each(["us", "eu", "in"] as const)(
    "apiBaseUrl set: the re-homed allowance keys on the %s client's effective table",
    async (region) => {
      const transport = fakeTransport(() => ({ status: 200, json: {} }));
      const ws = makeOverrideWorkspace(
        transport,
        { apiBaseUrl: PROXY },
        region,
      );
      expect(ws.client.core.endpoints().get("export")).toBe(`${PROXY}/api/2.0`);
      await ws.client.request("GET", `${PROXY}/api/2.0/export`);
      expect(transport.captures).toHaveLength(1);
      // Every live export origin — this region's and the others' — stays
      // refused regardless of which region the client is bound to.
      for (const origin of EXPORT_ORIGINS) {
        await expect(
          ws.client.request("GET", `${origin}/api/2.0/export`),
        ).rejects.toMatchObject({ code: BROWSER_EXPORT_UNSUPPORTED });
      }
      expect(transport.captures).toHaveLength(1);
    },
  );

  it("appBaseUrl only: export stays on the live host and is still refused", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    const ws = makeOverrideWorkspace(transport, { appBaseUrl: PROXY });
    const effective = ws.client.core.endpoints();
    expect(effective.get("app")).toBe(`${PROXY}/api/app`);
    const exportBase = effective.get("export")!;
    expect(exportBase).toBe("https://data.mixpanel.com/api/2.0");
    const thrown = await requestError(ws, `${exportBase}/export`);
    expect(thrown).toBeInstanceOf(BrowserUnsupportedError);
    expect((thrown as BrowserUnsupportedError).code).toBe(
      BROWSER_EXPORT_UNSUPPORTED,
    );
    // The message must NOT claim export is re-homed (only App moved).
    expect((thrown as BrowserUnsupportedError).message).not.toContain(
      "re-homed at",
    );
    expect(transport.captures).toHaveLength(0);
    // The re-homed App host itself flows.
    await ws.client.request("GET", `${PROXY}/api/app/me`);
    expect(transport.captures).toHaveLength(1);
  });

  it("provider-form overrides are consulted on EVERY request (flip without re-wrapping)", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    let overrides: EndpointOverrides = {};
    let providerCalls = 0;
    const ws = makeOverrideWorkspace(transport, () => {
      providerCalls += 1;
      return overrides;
    });

    // 1. Unset: the client builds live export URLs; refused.
    let exportUrl = ws.client.core.buildUrl("export", "/export");
    expect(exportUrl).toBe("https://data.mixpanel.com/api/2.0/export");
    await expect(ws.client.request("GET", exportUrl)).rejects.toMatchObject({
      code: BROWSER_EXPORT_UNSUPPORTED,
    });
    expect(transport.captures).toHaveLength(0);
    const callsAfterRefusal = providerCalls;
    expect(callsAfterRefusal).toBeGreaterThan(0);

    // 2. Flip ON between calls: the SAME client/fetch now builds and
    //    admits the override-host URL.
    overrides = { apiBaseUrl: PROXY };
    exportUrl = ws.client.core.buildUrl("export", "/export");
    expect(exportUrl).toBe(`${PROXY}/api/2.0/export`);
    await ws.client.request("GET", exportUrl);
    expect(transport.captures).toHaveLength(1);
    expect(pathOf(transport.captures[0]!.url)).toBe(`${PROXY}/api/2.0/export`);
    expect(providerCalls).toBeGreaterThan(callsAfterRefusal);

    // 3. Live origin still refused while the override is active — and
    //    the diagnostic reflects the CURRENT provider value.
    const thrown = (await requestError(
      ws,
      "https://data.mixpanel.com/api/2.0/export",
    )) as BrowserUnsupportedError;
    expect(thrown.code).toBe(BROWSER_EXPORT_UNSUPPORTED);
    expect(thrown.message).toContain(`re-homed at ${PROXY}/api/2.0`);

    // 4. Flip OFF: back to the live table; refused again, plain hint.
    overrides = {};
    exportUrl = ws.client.core.buildUrl("export", "/export");
    expect(exportUrl).toBe("https://data.mixpanel.com/api/2.0/export");
    const thrownAgain = (await requestError(
      ws,
      exportUrl,
    )) as BrowserUnsupportedError;
    expect(thrownAgain.code).toBe(BROWSER_EXPORT_UNSUPPORTED);
    expect(thrownAgain.message).not.toContain("re-homed at");
    expect(transport.captures).toHaveLength(1);
  });

  it("derived clients (withProject) keep the per-request verdict", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: {} }));
    let overrides: EndpointOverrides = { apiBaseUrl: PROXY };
    const ws = makeOverrideWorkspace(transport, () => overrides);
    const derived = ws.client.withProject("67890");
    await derived.request("GET", `${PROXY}/api/2.0/export`);
    expect(transport.captures).toHaveLength(1);
    await expect(
      derived.request("GET", "https://data-in.mixpanel.com/api/2.0/export"),
    ).rejects.toMatchObject({ code: BROWSER_EXPORT_UNSUPPORTED });
    overrides = {};
    expect(derived.core.buildUrl("export", "/export")).toBe(
      "https://data.mixpanel.com/api/2.0/export",
    );
    await expect(
      derived.request("GET", derived.core.buildUrl("export", "/export")),
    ).rejects.toMatchObject({ code: BROWSER_EXPORT_UNSUPPORTED });
    expect(transport.captures).toHaveLength(1);
  });

  it("relative / unparseable URLs pass through to the inner fetch untouched", async () => {
    const seen: unknown[] = [];
    const rawFetch = ((input: RequestInfo | URL): Promise<Response> => {
      seen.push(input);
      return Promise.resolve(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch;
    const ws = createBrowserWorkspace({
      token: "tok-123",
      projectId: "12345",
      region: "us",
      fetch: rawFetch,
      clientOptions: { endpointOverrides: { apiBaseUrl: PROXY } },
    });
    await ws.client.request("GET", "/api/2.0/export");
    await ws.client.request("GET", "not a url at all");
    // The core appends its `query_origin` marker; the guard itself
    // neither rejected nor rewrote either input.
    expect(seen.map((s) => String(s).split("?", 1)[0])).toStrictEqual([
      "/api/2.0/export",
      "not a url at all",
    ]);
  });
});
