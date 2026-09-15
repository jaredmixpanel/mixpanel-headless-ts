// ADDITIVE (no Python twin beyond `TestFacadeAndCli::test_facade_delegates`,
// ported in `test/services/schema-graph.test.ts`): the delegation contract
// of the 12 discovery/lexicon `Workspace` members — which service method
// each calls, with which arguments — plus the two with a real facade body,
// `clearDiscoveryCache` (guarded on the lazy service) and `subproperties`.

import { describe, expect, it } from "vitest";

import type { MixpanelClient } from "../../src/client/client.js";
import {
  BookmarkInfo,
  FunnelInfo,
  LexiconSchema,
  SavedCohort,
  SchemaGraphResult,
  SubPropertyInfo,
  TopEvent,
} from "../../src/types/results/discovery.js";
import { Workspace } from "../../src/workspace.js";
import {
  type CannedHandler,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** Build a facade over the mock transport. */
function workspaceWith(
  handler: CannedHandler,
  extra: { warn?: (message: string) => void } = {},
): { ws: Workspace; client: MixpanelClient } {
  const { client } = createMockClient(makeSession(), handler);
  return {
    ws: new Workspace({
      session: makeSession(),
      client,
      ...(extra.warn === undefined ? {} : { warn: extra.warn }),
    }),
    client,
  };
}

describe("Workspace discovery members", () => {
  it("memoizes the discovery service across members", () => {
    const { ws } = workspaceWith(() => ({ status: 200, json: [] }));
    expect(ws.discoveryService).toBe(ws.discoveryService);
  });

  it("events() delegates and forwards the kwargs", async () => {
    const seen: Record<string, string> = {};
    const { ws } = workspaceWith((request) => {
      Object.assign(seen, request.params);
      return { status: 200, json: ["b", "a"] };
    });
    await expect(
      ws.events({
        limit: 3,
        from_date: "2024-01-01",
        to_date: "2024-01-31",
      }),
    ).resolves.toStrictEqual(["a", "b"]);
    expect(seen["limit"]).toBe("3");
    expect(seen["from_date"]).toBe("2024-01-01");
    expect(seen["to_date"]).toBe("2024-01-31");
  });

  it("events() shares the service cache with the facade", async () => {
    let callCount = 0;
    const { ws } = workspaceWith(() => {
      callCount += 1;
      return { status: 200, json: ["a"] };
    });
    await ws.events();
    await ws.events();
    expect(callCount).toBe(1);
  });

  it("properties() delegates", async () => {
    const { ws } = workspaceWith(() => ({
      status: 200,
      json: { b: 1, a: 1 },
    }));
    await expect(ws.properties("Purchase")).resolves.toStrictEqual(["a", "b"]);
  });

  it("propertyValues() delegates with event + limit", async () => {
    const seen: Record<string, string> = {};
    const { ws } = workspaceWith((request) => {
      Object.assign(seen, request.params);
      return { status: 200, json: ["US", "CA"] };
    });
    await expect(
      ws.propertyValues("country", { event: "Purchase", limit: 7 }),
    ).resolves.toStrictEqual(["US", "CA"]);
    expect(seen["event"]).toBe("Purchase");
    expect(seen["limit"]).toBe("7");
  });

  it("subproperties() delegates and threads the warning sink", async () => {
    const captured: string[] = [];
    const { ws } = workspaceWith(
      () => ({
        status: 200,
        json: [JSON.stringify({ id: "abc" }), JSON.stringify({ id: 123 })],
      }),
      {
        warn: (message) => {
          captured.push(message);
        },
      },
    );
    const subs = await ws.subproperties("cart", { event: "X" });
    expect(subs[0]).toBeInstanceOf(SubPropertyInfo);
    expect(subs[0]?.type).toBe("string");
    expect(captured.some((m) => m.includes("mixed value types"))).toBe(true);
  });

  it("subproperties() forwards sample_size as the value limit", async () => {
    const seen: Record<string, string> = {};
    const { ws } = workspaceWith((request) => {
      Object.assign(seen, request.params);
      return { status: 200, json: [] };
    });
    await ws.subproperties("cart", { event: "X", sample_size: 12 });
    expect(seen["limit"]).toBe("12");
  });

  it("funnels() delegates", async () => {
    const { ws } = workspaceWith(() => ({
      status: 200,
      json: [{ funnel_id: 1, name: "F" }],
    }));
    const funnels = await ws.funnels();
    expect(funnels[0]).toBeInstanceOf(FunnelInfo);
    expect(funnels[0]?.funnel_id).toBe(1);
  });

  it("cohorts() delegates", async () => {
    const { ws } = workspaceWith(() => ({
      status: 200,
      json: [
        {
          id: 1,
          name: "C",
          count: 2,
          description: "",
          created: "2024-01-01 00:00:00",
          is_visible: 1,
        },
      ],
    }));
    const cohorts = await ws.cohorts();
    expect(cohorts[0]).toBeInstanceOf(SavedCohort);
    expect(cohorts[0]?.is_visible).toBe(true);
  });

  it("listBookmarks() delegates and forwards the type filter", async () => {
    const seen: Record<string, string> = {};
    const { ws } = workspaceWith((request) => {
      Object.assign(seen, request.params);
      return {
        status: 200,
        json: {
          results: [
            {
              id: 1,
              name: "R",
              type: "insights",
              project_id: 2,
              created: "c",
              modified: "m",
            },
          ],
        },
      };
    });
    const bookmarks = await ws.listBookmarks("insights");
    expect(bookmarks[0]).toBeInstanceOf(BookmarkInfo);
    expect(seen["type"]).toBe("insights");
  });

  it("topEvents() delegates and is never cached", async () => {
    let callCount = 0;
    const { ws } = workspaceWith(() => {
      callCount += 1;
      return {
        status: 200,
        json: {
          events: [{ event: "E", amount: 5, percent_change: 0.5 }],
          type: "general",
        },
      };
    });
    const events = await ws.topEvents({ type: "unique", limit: 4 });
    expect(events[0]).toBeInstanceOf(TopEvent);
    expect(events[0]?.count).toBe(5);
    await ws.topEvents();
    expect(callCount).toBe(2);
  });

  it("clearDiscoveryCache() drops the cache so the next call refetches", async () => {
    let callCount = 0;
    const { ws } = workspaceWith(() => {
      callCount += 1;
      return { status: 200, json: ["a"] };
    });
    await ws.events();
    await ws.events();
    expect(callCount).toBe(1);
    await ws.clearDiscoveryCache();
    await ws.events();
    expect(callCount).toBe(2);
  });

  it("clearDiscoveryCache() does not construct the service (Python's guard)", async () => {
    const { ws } = workspaceWith(() => ({ status: 200, json: [] }));
    await ws.clearDiscoveryCache();
    // The lazy field is still unset: the first `events()` call is the
    // one that builds the service and populates the cache.
    await ws.events();
    expect(ws.discoveryService.cache.size).toBe(1);
  });

  it("lexiconSchemas() delegates with the entity_type filter", async () => {
    const seen: string[] = [];
    const { ws } = workspaceWith((request) => {
      seen.push(request.url);
      return {
        status: 200,
        json: {
          results: [
            {
              entityType: "event",
              name: "Purchase",
              schemaJson: { properties: {} },
            },
          ],
        },
      };
    });
    const schemas = await ws.lexiconSchemas({ entity_type: "event" });
    expect(schemas[0]).toBeInstanceOf(LexiconSchema);
    expect(seen[0]).toContain("/schemas/event");
  });

  it("lexiconSchema() delegates", async () => {
    const { ws } = workspaceWith(() => ({
      status: 200,
      json: { status: "ok", results: { description: "d", properties: {} } },
    }));
    const schema = await ws.lexiconSchema("event", "Purchase");
    expect(schema.entity_type).toBe("event");
    expect(schema.name).toBe("Purchase");
    expect(schema.schema_json.description).toBe("d");
  });

  it("schemaGraph() delegates and stamps computed_at from the clock seam", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: [],
    }));
    const ws = new Workspace({ session: makeSession(), client });
    const result = await ws.schemaGraph({ include_user_properties: false });
    expect(result).toBeInstanceOf(SchemaGraphResult);
    // `datetime.now(timezone.utc).isoformat()` renders `+00:00`, never `Z`.
    expect(result.computed_at.endsWith("+00:00")).toBe(true);
  });

  it("schemaGraph() honours a deterministic injected clock", async () => {
    const { client } = createMockClient(
      makeSession(),
      () => ({ status: 200, json: [] }),
      { now: () => new Date("2026-08-16T12:34:56.000Z") },
    );
    const ws = new Workspace({ session: makeSession(), client });
    const result = await ws.schemaGraph({ include_user_properties: false });
    expect(result.computed_at).toBe("2026-08-16T12:34:56+00:00");
  });

  // `use()` with no axes is a no-throw no-op swap; `close()` resolves
  // idempotently.
  it("use() with no axes resolves to the facade and close() is idempotent", async () => {
    const { ws } = workspaceWith(() => ({ status: 200, json: [] }));
    await expect(ws.use()).resolves.toBe(ws);
    await expect(ws.close()).resolves.toBeUndefined();
    await expect(ws.close()).resolves.toBeUndefined();
  });
});
