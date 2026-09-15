// Schema graph: SchemaGraphResult.toGraph(), the client's bulk lexicon and
// per-event property calls, canonicalResourceType, DiscoveryService.
// get_schema_graph and the Workspace facade delegation. Mirrors
// tests/unit/test_schema_graph.py minus the two CLI cases. networkx has no
// TS twin: toGraph() returns the adjacency object; caching = deep equality.

import { describe, expect, it } from "vitest";

import type { MixpanelClient } from "../../src/client/client.js";
import type { JsonValue } from "../../src/client/json-value.js";
import { MixpanelHeadlessError } from "../../src/errors.js";
import {
  type DiscoveryLogger,
  DiscoveryService,
} from "../../src/services/discovery.js";
import { canonicalResourceType } from "../../src/services/entities/lexicon.js";
import {
  type SchemaGraph,
  SchemaGraphResult,
} from "../../src/types/results/discovery.js";
import { Workspace } from "../../src/workspace.js";
import {
  type CannedHandler,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** `_client(handler)` (test_schema_graph.py). */
function mockClient(handler: CannedHandler): MixpanelClient {
  return createMockClient(makeSession(), handler).client;
}

/** `g.nodes[name]["kind"]`. */
function nodeKind(graph: SchemaGraph, name: string): string | undefined {
  return graph.nodes.find((node) => node.name === name)?.kind;
}

/** `list(g.successors(name))`. */
function successors(graph: SchemaGraph, name: string): string[] {
  return graph.edges
    .filter((edge) => edge.source === name)
    .map((edge) => edge.target);
}

/** `g.edges[source, target]["density_local"]`. */
function edgeDensity(
  graph: SchemaGraph,
  source: string,
  target: string,
): unknown {
  return graph.edges.find(
    (edge) => edge.source === source && edge.target === target,
  )?.density_local;
}

/** `_sample_result()`. */
function sampleResult(): SchemaGraphResult {
  return new SchemaGraphResult({
    computed_at: "2026-06-03T00:00:00+00:00",
    events: [{ name: "Purchase", displayName: "Purchase", count: 10 }],
    properties: [
      // densityLocal is a property-level field; it repeats onto each edge.
      { name: "amount", densityLocal: 0.9, events: [{ name: "Purchase" }] },
      { name: "orphan", events: [] },
    ],
    user_properties: [
      { name: "plan", resourceType: "User", displayName: "Plan" },
    ],
    include_density: true,
  });
}

/** A recording {@link DiscoveryLogger} (the `caplog` twin). */
function recordingLogger(): { logger: DiscoveryLogger; messages: string[] } {
  const messages: string[] = [];
  return {
    logger: {
      debug(message: string): void {
        messages.push(message);
      },
    },
    messages,
  };
}

/** The lexicon-stub client shape used by the DiscoveryService suites. */
interface LexiconStub {
  readonly client: MixpanelClient;
  /** `list_event_definitions.call_count`. */
  readonly eventDefinitionCalls: { count: number };
  /** The `resource_type` of each `list_property_definitions` call. */
  readonly resourceTypes: Array<string | undefined>;
  /** The `include_events` of each `list_property_definitions` call. */
  readonly includeEventsFlags: Array<boolean | undefined>;
  /** `list_per_event_properties.call_count`. */
  readonly perEventCalls: { count: number };
  /** Mutable `list_per_event_properties.return_value`. */
  readonly perEvent: { rows: JsonValue[] };
}

/**
 * `TestDiscoveryGetSchemaGraph._mock_api`
 * generalized over the response triple. The flat property rows carry no
 * `events` lists; the relationship edges come from the query-API
 * per-event gather and are inverted client-side.
 *
 * @param events - The `list_event_definitions` return.
 * @param properties - The `list_property_definitions` return, either a
 *   fixed list or a `resource_type`-dispatching function.
 * @param perEventRows - The `list_per_event_properties` return.
 * @returns The stub client plus its call logs.
 */
function lexiconStub(
  events: JsonValue[],
  properties: JsonValue[] | ((resourceType: string) => JsonValue[]),
  perEventRows: JsonValue[] = [],
): LexiconStub {
  const eventDefinitionCalls = { count: 0 };
  const perEventCalls = { count: 0 };
  const resourceTypes: Array<string | undefined> = [];
  const includeEventsFlags: Array<boolean | undefined> = [];
  const perEvent = { rows: perEventRows };
  const client = {
    listEventDefinitions: (): Promise<JsonValue[]> => {
      eventDefinitionCalls.count += 1;
      return Promise.resolve(events);
    },
    listPropertyDefinitions: (
      options: { resource_type?: string; include_events?: boolean } = {},
    ): Promise<JsonValue[]> => {
      resourceTypes.push(options.resource_type);
      includeEventsFlags.push(options.include_events);
      const resourceType = options.resource_type ?? "Event";
      return Promise.resolve(
        typeof properties === "function"
          ? properties(resourceType)
          : properties,
      );
    },
    listPerEventProperties: (): Promise<JsonValue[]> => {
      perEventCalls.count += 1;
      return Promise.resolve(perEvent.rows);
    },
    core: { now: (): Date => new Date("2026-06-03T00:00:00.000Z") },
    // The facade constructor installs the workspace resolver
    // (`workspace.py`); `MagicMock(spec=…)` covers it in Python.
    hasWorkspaceResolver: false,
    setWorkspaceResolver: (): void => {},
    close: (): Promise<void> => Promise.resolve(),
  } as unknown as MixpanelClient;
  return {
    client,
    eventDefinitionCalls,
    resourceTypes,
    includeEventsFlags,
    perEventCalls,
    perEvent,
  };
}

/** The default `_mock_api` payloads. */
function defaultMockApi(): LexiconStub {
  return lexiconStub(
    [{ name: "Purchase", displayName: "Purchase" }, { name: "Login" }],
    (resourceType) =>
      resourceType === "User"
        ? [{ name: "plan", resourceType: "User" }]
        : [{ name: "amount" }, { name: "ts" }],
    [
      {
        name: "Purchase",
        properties: [{ name: "amount" }, { name: "ts" }],
      },
      { name: "Login", properties: [{ name: "ts" }] },
    ],
  );
}

describe("Schema graph result (to_graph half)", () => {
  // python: TestSchemaGraphResult
  it("yields a directed event->property graph with node kinds", () => {
    const g = sampleResult().toGraph();
    expect(nodeKind(g, "Purchase")).toBe("event");
    expect(nodeKind(g, "amount")).toBe("property");
    expect(nodeKind(g, "orphan")).toBe("property");
    expect(successors(g, "Purchase")).toStrictEqual(["amount"]);
    expect(edgeDensity(g, "Purchase", "amount")).toBe(0.9);
    // no property->anything edges
    expect(successors(g, "amount")).toStrictEqual([]);
    expect(successors(g, "orphan")).toStrictEqual([]);
  });

  it("rebuilds an identical graph on repeated calls", () => {
    const result = sampleResult();
    expect(result.toGraph()).toStrictEqual(result.toGraph());
  });

  it("has zero nodes for an empty result", () => {
    const result = new SchemaGraphResult({ computed_at: "t" });
    expect(result.toGraph().nodes).toHaveLength(0);
  });

  it("carries a null edge density when density was not requested", () => {
    const result = new SchemaGraphResult({
      computed_at: "t",
      events: [{ name: "Purchase" }],
      properties: [{ name: "amount", events: [{ name: "Purchase" }] }],
    });
    expect(result.include_density).toBe(false);
    expect(edgeDensity(result.toGraph(), "Purchase", "amount")).toBeNull();
  });

  it("filters non-dict / nameless entries out of the graph", () => {
    const result = new SchemaGraphResult({
      computed_at: "t",
      properties: [
        {
          name: "amount",
          events: ["NotADict", { no: "name" }, { name: "Purchase" }],
        },
      ],
    });
    expect(successors(result.toGraph(), "Purchase")).toStrictEqual(["amount"]);
  });

  it("seeds property-less events as graph nodes", () => {
    const result = new SchemaGraphResult({
      computed_at: "t",
      events: [{ name: "Purchase" }, { name: "Login" }],
      properties: [{ name: "amount", events: [{ name: "Purchase" }] }],
    });
    expect(nodeKind(result.toGraph(), "Login")).toBe("event");
  });
});

describe("API client bulk lexicon", () => {
  // python: TestApiClientBulkLexicon
  it("adds includeEvents=true and resourceType for include_events", async () => {
    let seen: Record<string, string> = {};
    const client = mockClient((request) => {
      seen = { ...request.params };
      return {
        status: 200,
        json: [{ name: "amount", events: [{ name: "Purchase" }] }],
      };
    });
    const rows = await client.listPropertyDefinitions({
      resource_type: "Event",
      include_events: true,
    });
    expect(seen["resourceType"]).toBe("Event");
    expect(seen["includeEvents"]).toBe("true");
    const first = rows[0] as { events: Array<{ name: string }> };
    expect(first.events[0]?.name).toBe("Purchase");
  });

  it("adds includeDensity=true only when requested", async () => {
    let seen: Record<string, string> = {};
    const client = mockClient((request) => {
      seen = { ...request.params };
      return { status: 200, json: [] };
    });
    await client.listPropertyDefinitions({ include_density: true });
    expect(seen["includeDensity"]).toBe("true");
  });

  it("returns the bare list the API sends", async () => {
    const client = mockClient(() => ({
      status: 200,
      json: [{ name: "Purchase" }],
    }));
    await expect(client.listEventDefinitions()).resolves.toStrictEqual([
      { name: "Purchase" },
    ]);
  });

  it("rejects a non-list event-definitions response", async () => {
    const client = mockClient(() => ({
      status: 200,
      json: { unexpected: "shape" },
    }));
    await expect(client.listEventDefinitions()).rejects.toThrow(
      MixpanelHeadlessError,
    );
    await expect(client.listEventDefinitions()).rejects.toThrow(
      /expected list/,
    );
  });

  it("rejects a non-list property-definitions response", async () => {
    const client = mockClient(() => ({
      status: 200,
      json: { unexpected: "shape" },
    }));
    await expect(client.listPropertyDefinitions()).rejects.toThrow(
      MixpanelHeadlessError,
    );
    await expect(client.listPropertyDefinitions()).rejects.toThrow(
      /expected list/,
    );
  });

  it("pins the canonical bulk params and omits the toggles", async () => {
    let seen: Record<string, string> = {};
    const client = mockClient((request) => {
      seen = { ...request.params };
      return { status: 200, json: [] };
    });
    await client.listPropertyDefinitions();
    expect(seen["resourceType"]).toBe("Event");
    expect(seen["includeCustom"]).toBe("true");
    expect(seen["includeZeroCounts"]).toBe("true");
    expect(Object.hasOwn(seen, "includeEvents")).toBe(false);
    expect(Object.hasOwn(seen, "includeDensity")).toBe(false);
  });

  it("normalizes the resourceType on the get_* path", async () => {
    let seen: Record<string, string> = {};
    const client = mockClient((request) => {
      seen = { ...request.params };
      return { status: 200, json: [] };
    });
    await client.getPropertyDefinitions(["amount"], "user");
    expect(seen["name[]"]).toBe("amount");
    expect(seen["resourceType"]).toBe("User");
    // get_* must not send the bulk-only include toggles.
    expect(Object.hasOwn(seen, "includeCustom")).toBe(false);
    expect(Object.hasOwn(seen, "includeZeroCounts")).toBe(false);
  });

  it("sends a name[] filter from get_event_definitions", async () => {
    let seen: Record<string, string> = {};
    const client = mockClient((request) => {
      seen = { ...request.params };
      return { status: 200, json: [] };
    });
    await client.getEventDefinitions(["Purchase"]);
    expect(seen["name[]"]).toBe("Purchase");
  });
});

describe("API client per event properties", () => {
  // python: TestApiClientPerEventProperties
  // The query-API per-event properties gather (the relationship
  // source). The App API's `includeEvents=true` bulk call computes this
  // same join behind a ~120s gateway deadline it cannot meet on large
  // projects, so the schema graph fetches the edges from the query API
  // instead. (`test_uses_export_timeout` lives in
  // `client/server-deadline.test.ts` — it needs the transport-timeout
  // capture seam.)

  it("URL params and unwrap", async () => {
    // python: test_url_params_and_unwrap
    let seenUrl = "";
    let seenParams: Record<string, string> = {};
    const client = mockClient((request) => {
      seenUrl = request.url.split("?", 1)[0] ?? "";
      seenParams = { ...request.params };
      return {
        status: 200,
        json: {
          results: [{ name: "Purchase", properties: [{ name: "amount" }] }],
        },
      };
    });
    const rows = await client.listPerEventProperties();
    expect(seenUrl).toBe(
      "https://mixpanel.com/api/query/data_definitions/events",
    );
    expect(seenParams["fetch_per_event_properties"]).toBe("true");
    expect(seenParams["project_id"]).toBe("12345");
    expect(rows).toStrictEqual([
      { name: "Purchase", properties: [{ name: "amount" }] },
    ]);
  });

  it("raises on unexpected shape", async () => {
    // python: test_raises_on_unexpected_shape
    const client = mockClient(() => ({
      status: 200,
      json: { results: { unexpected: "shape" } },
    }));
    await expect(client.listPerEventProperties()).rejects.toThrow(
      MixpanelHeadlessError,
    );
    await expect(client.listPerEventProperties()).rejects.toThrow(
      /expected list/,
    );
  });
});

describe("Canonical resource type", () => {
  // python: TestCanonicalResourceType
  it.each([
    ["event", "Event"],
    ["events", "Event"],
    ["Event", "Event"],
    ["user", "User"],
    ["people", "User"],
    ["User", "User"],
    ["groupprofile", "groupprofile"], // unknown spelling passes through
  ])("normalizes %s -> %s", (given, expected) => {
    expect(canonicalResourceType(given)).toBe(expected);
  });
});

describe("Discovery get schema graph", () => {
  // python: TestDiscoveryGetSchemaGraph
  it("builds the adjacency maps from the inverted per-event gather", async () => {
    const stub = defaultMockApi();
    const result = await new DiscoveryService(stub.client).getSchemaGraph();
    expect(result.event_to_properties["Purchase"]).toStrictEqual([
      "amount",
      "ts",
    ]);
    expect(result.event_to_properties["Login"]).toStrictEqual(["ts"]);
    expect(result.property_to_events["amount"]).toStrictEqual(["Purchase"]);
    expect(result.property_to_events["ts"]).toStrictEqual([
      "Purchase",
      "Login",
    ]);
    expect(result.user_properties).toStrictEqual([
      { name: "plan", resourceType: "User" },
    ]);
    expect(result.meta["event_count"]).toBe(2);
  });

  it("omits include_events from every flat properties call", async () => {
    // No list_property_definitions call may request the App API join:
    // the `includeEvents=true` join times out server-side on large
    // projects; the edges must come from list_per_event_properties.
    const stub = defaultMockApi();
    await new DiscoveryService(stub.client).getSchemaGraph();
    expect(stub.perEventCalls.count).toBe(1);
    for (const flag of stub.includeEventsFlags) {
      expect(flag ?? false).toBe(false);
    }
  });

  it("skips nameless events and malformed per-event property entries", async () => {
    const stub = defaultMockApi();
    stub.perEvent.rows = [
      { properties: [{ name: "amount" }] }, // nameless event -> dropped
      { name: "Purchase", properties: ["bad", { no: "name" }] },
      { name: "Login", properties: [{ name: "ts" }] },
      { name: "NoProps" }, // no properties key -> no edges
    ];
    const result = await new DiscoveryService(stub.client).getSchemaGraph();
    expect(result.property_to_events["amount"]).toStrictEqual([]);
    expect(result.property_to_events["ts"]).toStrictEqual(["Login"]);
  });

  it("ignores per-event properties absent from the flat list", async () => {
    // A per-event property absent from the flat list creates no node.
    const stub = defaultMockApi();
    stub.perEvent.rows = [
      { name: "Purchase", properties: [{ name: "ghost" }] },
    ];
    const result = await new DiscoveryService(stub.client).getSchemaGraph();
    expect(Object.hasOwn(result.property_to_events, "ghost")).toBe(false);
    expect(result.event_to_properties["Purchase"]).toStrictEqual([]);
  });

  it("caches results; force_refresh re-fetches", async () => {
    const stub = defaultMockApi();
    const svc = new DiscoveryService(stub.client);
    await svc.getSchemaGraph();
    await svc.getSchemaGraph();
    expect(stub.eventDefinitionCalls.count).toBe(1);
    await svc.getSchemaGraph({ force_refresh: true });
    expect(stub.eventDefinitionCalls.count).toBe(2);
  });

  it("skips the user call when include_user_properties is false", async () => {
    const stub = defaultMockApi();
    const result = await new DiscoveryService(stub.client).getSchemaGraph({
      include_user_properties: false,
    });
    expect(result.user_properties).toStrictEqual([]);
    // only the Event resource_type call was made
    expect(stub.resourceTypes).not.toContain("User");
  });

  it("clear_cache resets the schema-graph cache", async () => {
    const stub = defaultMockApi();
    const svc = new DiscoveryService(stub.client);
    await svc.getSchemaGraph();
    expect(stub.eventDefinitionCalls.count).toBe(1);
    svc.clearCache();
    await svc.getSchemaGraph();
    expect(stub.eventDefinitionCalls.count).toBe(2);
  });

  it("flows a property-level densityLocal onto every edge", async () => {
    const stub = lexiconStub(
      [{ name: "Purchase" }],
      [{ name: "amount", densityLocal: 0.75 }],
      [{ name: "Purchase", properties: [{ name: "amount" }] }],
    );
    const result = await new DiscoveryService(stub.client).getSchemaGraph({
      include_density: true,
      include_user_properties: false,
    });
    expect(result.include_density).toBe(true);
    expect(result.toRelationshipsRows()[0]?.["density_local"]).toBe(0.75);
    expect(edgeDensity(result.toGraph(), "Purchase", "amount")).toBe(0.75);
  });

  it("emits a debug summary for dropped (nameless) rows", async () => {
    const stub = lexiconStub(
      [{ name: "Purchase" }, { count: 1 }],
      [{ name: "amount" }, { description: "nameless" }],
      [{ name: "Purchase", properties: [{ name: "amount" }] }],
    );
    const { logger, messages } = recordingLogger();
    await new DiscoveryService(stub.client, { logger }).getSchemaGraph({
      include_user_properties: false,
    });
    expect(messages.some((m) => m.includes("schema_graph dropped"))).toBe(true);
  });

  it("emits no drop summary for a clean gather", async () => {
    const stub = lexiconStub(
      [{ name: "Purchase" }],
      [{ name: "amount" }],
      [{ name: "Purchase", properties: [{ name: "amount" }] }],
    );
    const { logger, messages } = recordingLogger();
    await new DiscoveryService(stub.client, { logger }).getSchemaGraph({
      include_user_properties: false,
    });
    expect(messages.some((m) => m.includes("schema_graph dropped"))).toBe(
      false,
    );
  });
});

describe("Facade and CLI (facade half)", () => {
  // python: TestFacadeAndCli
  it("delegates Workspace.schema_graph to the discovery service", async () => {
    const stub = lexiconStub([{ name: "Purchase" }], []);
    const ws = new Workspace({ session: makeSession(), client: stub.client });
    const result = await ws.schemaGraph({ include_user_properties: false });
    expect(result).toBeInstanceOf(SchemaGraphResult);
    expect(Object.hasOwn(result.event_to_properties, "Purchase")).toBe(true);
  });
});
