// Translated schema-graph tests (B5-S1, packet §4): assertion-for-
// assertion port of tests/unit/test_schema_graph.py (R10.2).
//
// Owned here: TestApiClientBulkLexicon :274 (client-direct — translated
// against the B4 client), TestCanonicalResourceType :378,
// TestDiscoveryGetSchemaGraph :398, and the FACADE half of
// TestFacadeAndCli :504.
//
// Header exclusions:
// - TestFacadeAndCli's two CLI cases (`test_cli_json` :518,
//   `test_cli_table_shows_relationships` :530) — the CLI is out of
//   Phase-3 scope (api-map preamble).
// - TestSchemaGraphResult :69 was translated in Phase 2
//   (`test/types/results/schema-graph.test.ts:1-11`) EXCEPT its
//   `to_graph()` assertions, which that header defers to B5. Those come
//   alive here with {@link SchemaGraphResult.toGraph}: the six
//   deferred cases are re-homed in the `TestSchemaGraphResult
//   (to_graph half)` block below, verbatim.
//
// Translation notes:
// - `networkx` has no vendored TS twin, so `toGraph()` returns the
//   adjacency object the graph is built from. The three helpers below
//   express the asserted networkx API: `g.nodes[n]["kind"]`,
//   `list(g.successors(n))`, `g.edges[u, v]["density_local"]`.
// - `to_graph() is to_graph()` (pandas/graph identity caching) becomes
//   repeated-call deep equality — the Phase-2 convention
//   (`test/types/results/types.test.ts:8-11`); the codec-visible
//   `_graph_cache` slot stays `null` by design.
// - `caplog.at_level(DEBUG)` -> the injected {@link DiscoveryLogger}
//   (R9.5); the assertion on the message substring is unchanged.
// - `MagicMock()` api clients -> stub objects carrying only the two
//   lexicon methods, plus a `resource_type` call log for
//   `test_skip_user_properties`.

import { describe, expect, it } from "vitest";
import {
  createMockClient,
  makeSession,
  type CannedResponse,
  type CapturedFetchRequest,
} from "../client/client-test-helpers.js";
import type { MixpanelClient } from "../../src/client/client.js";
import type { JsonValue } from "../../src/client/json-value.js";
import { MixpanelHeadlessError } from "../../src/errors.js";
import { canonicalResourceType } from "../../src/services/entities/lexicon.js";
import {
  DiscoveryService,
  type DiscoveryLogger,
} from "../../src/services/discovery.js";
import {
  SchemaGraphResult,
  type SchemaGraph,
} from "../../src/types/results/discovery.js";
import { Workspace } from "../../src/workspace.js";

/** A canned-response handler (the httpx.MockTransport handler twin). */
type Handler = (request: CapturedFetchRequest) => CannedResponse;

/** `_client(handler)` (test_schema_graph.py:269-271). */
function mockClient(handler: Handler): MixpanelClient {
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

/** `_sample_result()` (test_schema_graph.py:50-66). */
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
}

/**
 * `TestDiscoveryGetSchemaGraph._mock_api` (test_schema_graph.py:401-420)
 * generalized over the response pair.
 *
 * @param events - The `list_event_definitions` return.
 * @param properties - The `list_property_definitions` return, either a
 *   fixed list or a `resource_type`-dispatching function.
 * @returns The stub client plus its call logs.
 */
function lexiconStub(
  events: JsonValue[],
  properties: JsonValue[] | ((resourceType: string) => JsonValue[]),
): LexiconStub {
  const eventDefinitionCalls = { count: 0 };
  const resourceTypes: Array<string | undefined> = [];
  const client = {
    listEventDefinitions: (): Promise<JsonValue[]> => {
      eventDefinitionCalls.count += 1;
      return Promise.resolve(events);
    },
    listPropertyDefinitions: (
      options: { resource_type?: string } = {},
    ): Promise<JsonValue[]> => {
      resourceTypes.push(options.resource_type);
      const resourceType = options.resource_type ?? "Event";
      return Promise.resolve(
        typeof properties === "function"
          ? properties(resourceType)
          : properties,
      );
    },
    core: { now: (): Date => new Date("2026-06-03T00:00:00.000Z") },
  } as unknown as MixpanelClient;
  return { client, eventDefinitionCalls, resourceTypes };
}

/** The default `_mock_api` payloads (test_schema_graph.py:401-420). */
function defaultMockApi(): LexiconStub {
  return lexiconStub(
    [{ name: "Purchase", displayName: "Purchase" }, { name: "Login" }],
    (resourceType) =>
      resourceType === "User"
        ? [{ name: "plan", resourceType: "User" }]
        : [
            { name: "amount", events: [{ name: "Purchase" }] },
            { name: "ts", events: [{ name: "Purchase" }, { name: "Login" }] },
          ],
  );
}

describe("TestSchemaGraphResult (to_graph half — Phase-2 deferral)", () => {
  it("yields a directed event->property graph with node kinds", () => {
    const g = sampleResult().toGraph();
    expect(nodeKind(g, "Purchase")).toBe("event");
    expect(nodeKind(g, "amount")).toBe("property");
    expect(nodeKind(g, "orphan")).toBe("property");
    expect(successors(g, "Purchase")).toEqual(["amount"]);
    expect(edgeDensity(g, "Purchase", "amount")).toBe(0.9);
    // no property->anything edges
    expect(successors(g, "amount")).toEqual([]);
    expect(successors(g, "orphan")).toEqual([]);
  });

  it("rebuilds an identical graph on repeated calls", () => {
    const result = sampleResult();
    expect(result.toGraph()).toEqual(result.toGraph());
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
    expect(successors(result.toGraph(), "Purchase")).toEqual(["amount"]);
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

describe("TestApiClientBulkLexicon", () => {
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
    expect(await client.listEventDefinitions()).toEqual([{ name: "Purchase" }]);
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

describe("TestCanonicalResourceType", () => {
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

describe("TestDiscoveryGetSchemaGraph", () => {
  it("builds the adjacency maps from the property event lists", async () => {
    const stub = defaultMockApi();
    const result = await new DiscoveryService(stub.client).getSchemaGraph();
    expect(result.event_to_properties["Purchase"]).toEqual(["amount", "ts"]);
    expect(result.event_to_properties["Login"]).toEqual(["ts"]);
    expect(result.property_to_events["amount"]).toEqual(["Purchase"]);
    expect(result.user_properties).toEqual([
      { name: "plan", resourceType: "User" },
    ]);
    expect(result.meta["event_count"]).toBe(2);
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
    expect(result.user_properties).toEqual([]);
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
      [
        {
          name: "amount",
          densityLocal: 0.75,
          events: [{ name: "Purchase" }],
        },
      ],
    );
    const result = await new DiscoveryService(stub.client).getSchemaGraph({
      include_density: true,
      include_user_properties: false,
    });
    expect(result.include_density).toBe(true);
    expect(result.toRelationshipsRows()[0]?.["density_local"]).toBe(0.75);
    expect(edgeDensity(result.toGraph(), "Purchase", "amount")).toBe(0.75);
  });

  it("emits a debug summary for dropped rows", async () => {
    const stub = lexiconStub(
      [{ name: "Purchase" }, { count: 1 }],
      [
        { name: "amount", events: ["bad", { name: "Purchase" }] },
        { events: [] },
      ],
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
      [{ name: "amount", events: [{ name: "Purchase" }] }],
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

describe("TestFacadeAndCli (facade half)", () => {
  it("delegates Workspace.schema_graph to the discovery service", async () => {
    const stub = lexiconStub([{ name: "Purchase" }], []);
    const ws = new Workspace({ session: makeSession(), client: stub.client });
    const result = await ws.schemaGraph({ include_user_properties: false });
    expect(result).toBeInstanceOf(SchemaGraphResult);
    expect(Object.hasOwn(result.event_to_properties, "Purchase")).toBe(true);
  });
});
