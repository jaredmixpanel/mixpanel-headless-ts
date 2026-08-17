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

import { ENDPOINTS } from "../../core/src/client/url.js";
import {
  BROWSER_EXPORT_UNSUPPORTED,
  BrowserUnsupportedError,
  createBrowserWorkspace,
} from "../src/index.js";
import { fakeTransport, type FakeTransport } from "./helpers.js";

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
    expect(new Set(EXPORT_ORIGINS)).toEqual(
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
