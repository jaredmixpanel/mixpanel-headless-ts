// Translated Lexicon-schemas tests (B5-S1, packet §4): assertion-for-
// assertion port of tests/unit/test_lexicon_schemas.py (R10.2) — ALL 13
// classes: TestEndpointsApp :44, TestParseLexiconMetadata :68,
// TestParseLexiconProperty :121, TestParseLexiconDefinition :157,
// TestParseLexiconSchema :199, TestLexiconMetadata :241,
// TestLexiconProperty :281, TestLexiconDefinition :307,
// TestLexiconSchema :333, TestAPIClientGetSchemas :401,
// TestAPIClientGetSchema :467, TestDiscoveryServiceListSchemas :533,
// TestDiscoveryServiceGetSchema :644.
//
// The three client-direct classes translate HERE by packet assignment:
// B4-C5's scope did not take this file (`b4-packets.md:862-870`) and
// the app-endpoint rows are un-asserted in `client/url.test.ts`.
//
// Translation notes:
// - `ENDPOINTS["us"]["app"]` -> the `ReadonlyMap` lookup (R4.8).
// - The four `test_frozen` cases (`:244`, `:284`, `:310`, `:336`) have
//   no TS runtime analog — `readonly` is compile-time only. Same
//   exclusion (and reason) as the Phase-2 result-class translation,
//   `test/types/results/types.test.ts:12-13`.
// - `to_dict()` -> `toJSON()` (R4.7). Python's `LexiconProperty.to_dict`
//   drops absent optionals, which the Phase-2 class already mirrors.
// - `discovery_factory` -> the B4 `createMockClient` transport analog,
//   as in `discovery.test.ts`.

import { describe, expect, it } from "vitest";

import { ENDPOINTS } from "../../src/client/url.js";
import { AuthenticationError, QueryError } from "../../src/errors.js";
import {
  DiscoveryService,
  parseLexiconDefinition,
  parseLexiconMetadata,
  parseLexiconProperty,
  parseLexiconSchema,
} from "../../src/services/discovery.js";
import {
  LexiconDefinition,
  LexiconMetadata,
  LexiconProperty,
  LexiconSchema,
} from "../../src/types/results/discovery.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** A canned-response handler (the httpx.MockTransport handler twin). */
type Handler = (request: CapturedFetchRequest) => CannedResponse;

/** The `discovery_factory` fixture (test_lexicon_schemas.py:375-398). */
function discoveryFactory(handler: Handler): DiscoveryService {
  const { client } = createMockClient(makeSession(), handler);
  return new DiscoveryService(client);
}

describe("TestEndpointsApp", () => {
  it("defines the US app endpoint", () => {
    expect(ENDPOINTS.get("us")?.has("app")).toBe(true);
    expect(ENDPOINTS.get("us")?.get("app")).toBe(
      "https://mixpanel.com/api/app",
    );
  });

  it("defines the EU app endpoint", () => {
    expect(ENDPOINTS.get("eu")?.has("app")).toBe(true);
    expect(ENDPOINTS.get("eu")?.get("app")).toBe(
      "https://eu.mixpanel.com/api/app",
    );
  });

  it("defines the India app endpoint", () => {
    expect(ENDPOINTS.get("in")?.has("app")).toBe(true);
    expect(ENDPOINTS.get("in")?.get("app")).toBe(
      "https://in.mixpanel.com/api/app",
    );
  });
});

describe("TestParseLexiconMetadata", () => {
  it("parses metadata from the com.mixpanel key", () => {
    const data = {
      "com.mixpanel": {
        $source: "api",
        displayName: "Purchase Event",
        tags: ["core", "monetization"],
        hidden: false,
        dropped: false,
        contacts: ["owner@example.com"],
        teamContacts: ["analytics"],
      },
    };
    const result = parseLexiconMetadata(data);
    expect(result).not.toBeNull();
    expect(result?.source).toBe("api");
    expect(result?.display_name).toBe("Purchase Event");
    expect(result?.tags).toEqual(["core", "monetization"]);
    expect(result?.hidden).toBe(false);
    expect(result?.dropped).toBe(false);
    expect(result?.contacts).toEqual(["owner@example.com"]);
    expect(result?.team_contacts).toEqual(["analytics"]);
  });

  it("uses defaults for missing fields", () => {
    const result = parseLexiconMetadata({
      "com.mixpanel": { displayName: "Test" },
    });
    expect(result).not.toBeNull();
    expect(result?.source).toBeNull();
    expect(result?.display_name).toBe("Test");
    expect(result?.tags).toEqual([]);
    expect(result?.hidden).toBe(false);
    expect(result?.dropped).toBe(false);
    expect(result?.contacts).toEqual([]);
    expect(result?.team_contacts).toEqual([]);
  });

  it("returns null for a null input", () => {
    expect(parseLexiconMetadata(null)).toBeNull();
  });

  it("returns null for an empty dict", () => {
    expect(parseLexiconMetadata({})).toBeNull();
  });

  it("returns null when there is no com.mixpanel key", () => {
    expect(parseLexiconMetadata({ other: "value" })).toBeNull();
  });
});

describe("TestParseLexiconProperty", () => {
  it("parses a basic property definition", () => {
    const result = parseLexiconProperty({
      type: "string",
      description: "User's country",
    });
    expect(result.type).toBe("string");
    expect(result.description).toBe("User's country");
    expect(result.metadata).toBeNull();
  });

  it("parses a property with metadata", () => {
    const result = parseLexiconProperty({
      type: "number",
      description: "Purchase amount",
      metadata: { "com.mixpanel": { displayName: "Amount", hidden: false } },
    });
    expect(result.type).toBe("number");
    expect(result.metadata).not.toBeNull();
    expect(result.metadata?.display_name).toBe("Amount");
  });

  it("defaults the type to string", () => {
    const result = parseLexiconProperty({});
    expect(result.type).toBe("string");
    expect(result.description).toBeNull();
  });
});

describe("TestParseLexiconDefinition", () => {
  it("parses a definition with properties", () => {
    const result = parseLexiconDefinition({
      description: "User completed a purchase",
      properties: {
        amount: { type: "number", description: "Purchase amount" },
        currency: { type: "string", description: "Currency code" },
      },
    });
    expect(result.description).toBe("User completed a purchase");
    expect(Object.keys(result.properties)).toHaveLength(2);
    expect(Object.hasOwn(result.properties, "amount")).toBe(true);
    expect(result.properties["amount"]?.type).toBe("number");
  });

  it("parses a definition with metadata", () => {
    const result = parseLexiconDefinition({
      properties: {},
      metadata: {
        "com.mixpanel": { displayName: "Purchase", tags: ["core"] },
      },
    });
    expect(result.metadata).not.toBeNull();
    expect(result.metadata?.display_name).toBe("Purchase");
    expect(result.metadata?.tags).toEqual(["core"]);
  });

  it("parses an empty definition", () => {
    const result = parseLexiconDefinition({});
    expect(result.description).toBeNull();
    expect(result.properties).toEqual({});
    expect(result.metadata).toBeNull();
  });
});

describe("TestParseLexiconSchema", () => {
  it("parses an event schema", () => {
    const result = parseLexiconSchema({
      entityType: "event",
      name: "Purchase",
      schemaJson: {
        description: "User completed a purchase",
        properties: { amount: { type: "number" } },
      },
    });
    expect(result.entity_type).toBe("event");
    expect(result.name).toBe("Purchase");
    expect(result.schema_json.description).toBe("User completed a purchase");
    expect(Object.hasOwn(result.schema_json.properties, "amount")).toBe(true);
  });

  it("parses a profile schema", () => {
    const result = parseLexiconSchema({
      entityType: "profile",
      name: "Plan Type",
      schemaJson: { properties: { plan: { type: "string" } } },
    });
    expect(result.entity_type).toBe("profile");
    expect(result.name).toBe("Plan Type");
  });
});

describe("TestLexiconMetadata", () => {
  it("serializes all fields", () => {
    const metadata = new LexiconMetadata({
      source: "api",
      display_name: "Test Event",
      tags: ["core"],
      hidden: true,
      dropped: false,
      contacts: ["test@example.com"],
      team_contacts: ["analytics"],
    });
    expect(metadata.toJSON()).toEqual({
      source: "api",
      display_name: "Test Event",
      tags: ["core"],
      hidden: true,
      dropped: false,
      contacts: ["test@example.com"],
      team_contacts: ["analytics"],
    });
  });
});

describe("TestLexiconProperty", () => {
  it("includes only type for a minimal property", () => {
    const prop = new LexiconProperty({
      type: "boolean",
      description: null,
      metadata: null,
    });
    expect(prop.toJSON()).toEqual({ type: "boolean" });
  });

  it("includes the description when present", () => {
    const prop = new LexiconProperty({
      type: "string",
      description: "User's country",
      metadata: null,
    });
    expect(prop.toJSON()).toEqual({
      type: "string",
      description: "User's country",
    });
  });
});

describe("TestLexiconDefinition", () => {
  it("serializes correctly", () => {
    const prop = new LexiconProperty({
      type: "number",
      description: "Amount",
      metadata: null,
    });
    const definition = new LexiconDefinition({
      description: "Purchase event",
      properties: { amount: prop },
      metadata: null,
    });
    expect(definition.toJSON()).toEqual({
      description: "Purchase event",
      properties: { amount: { type: "number", description: "Amount" } },
    });
  });
});

describe("TestLexiconSchema", () => {
  it("serializes correctly", () => {
    const definition = new LexiconDefinition({
      description: "Test event",
      properties: {},
      metadata: null,
    });
    const schema = new LexiconSchema({
      entity_type: "event",
      name: "Test Event",
      schema_json: definition,
    });
    expect(schema.toJSON()).toEqual({
      entity_type: "event",
      name: "Test Event",
      schema_json: { description: "Test event", properties: {} },
    });
  });
});

describe("TestAPIClientGetSchemas", () => {
  it("returns the list of schema dicts", async () => {
    const { client } = createMockClient(makeSession(), () => ({
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
    }));
    const schemas = (await client.getSchemas()) as Array<
      Record<string, unknown>
    >;
    expect(schemas).toHaveLength(1);
    expect(schemas[0]?.["name"]).toBe("Purchase");
  });

  it("includes entityType in the URL path", async () => {
    let seenUrl = "";
    const { client } = createMockClient(makeSession(), (request) => {
      seenUrl = request.url;
      return { status: 200, json: { results: [] } };
    });
    await client.getSchemas({ entity_type: "event" });
    // entity_type is a path parameter, not a query parameter
    expect(seenUrl).toContain("/schemas/event");
  });

  it("handles empty results", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: { results: [] },
    }));
    expect(await client.getSchemas()).toEqual([]);
  });
});

describe("TestAPIClientGetSchema", () => {
  it("returns the normalized schema dict", async () => {
    // API returns: {status: "ok", results: <schemaJson>}
    // Client normalizes to: {entityType, name, schemaJson}
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: { status: "ok", results: { properties: {} } },
    }));
    const schema = await client.getSchema("event", "Purchase");
    expect(schema["entityType"]).toBe("event");
    expect(schema["name"]).toBe("Purchase");
    expect(schema["schemaJson"]).toEqual({ properties: {} });
  });

  it("passes entity_name as a query param", async () => {
    let seenUrl = "";
    const { client } = createMockClient(makeSession(), (request) => {
      seenUrl = request.url;
      return {
        status: 200,
        json: { status: "ok", results: { properties: {} } },
      };
    });
    await client.getSchema("event", "Added To Cart");
    expect(seenUrl).toContain("/schemas/event");
    // the encoder may render spaces as + or %20
    expect(
      seenUrl.includes("entity_name=Added+To+Cart") ||
        seenUrl.includes("entity_name=Added%20To%20Cart"),
    ).toBe(true);
  });
});

describe("TestDiscoveryServiceListSchemas", () => {
  it("returns schemas sorted by (entity_type, name)", async () => {
    const discovery = discoveryFactory(() => ({
      status: 200,
      json: {
        results: [
          {
            entityType: "profile",
            name: "Plan",
            schemaJson: { properties: {} },
          },
          {
            entityType: "event",
            name: "Purchase",
            schemaJson: { properties: {} },
          },
          {
            entityType: "event",
            name: "Login",
            schemaJson: { properties: {} },
          },
        ],
      },
    }));
    const schemas = await discovery.listSchemas();

    expect(schemas).toHaveLength(3);
    expect(schemas[0]?.entity_type).toBe("event");
    expect(schemas[0]?.name).toBe("Login");
    expect(schemas[1]?.entity_type).toBe("event");
    expect(schemas[1]?.name).toBe("Purchase");
    expect(schemas[2]?.entity_type).toBe("profile");
    expect(schemas[2]?.name).toBe("Plan");
  });

  it("caches results", async () => {
    let callCount = 0;
    const discovery = discoveryFactory(() => {
      callCount += 1;
      return { status: 200, json: { results: [] } };
    });

    await discovery.listSchemas();
    expect(callCount).toBe(1);

    await discovery.listSchemas();
    expect(callCount).toBe(1);
  });

  it("caches per entity_type filter", async () => {
    let callCount = 0;
    const discovery = discoveryFactory(() => {
      callCount += 1;
      return { status: 200, json: { results: [] } };
    });

    await discovery.listSchemas();
    expect(callCount).toBe(1);

    await discovery.listSchemas({ entity_type: "event" });
    expect(callCount).toBe(2); // Different cache key

    await discovery.listSchemas({ entity_type: "event" });
    expect(callCount).toBe(2); // Cached
  });

  it("propagates AuthenticationError", async () => {
    const discovery = discoveryFactory(() => ({
      status: 401,
      json: { error: "Invalid credentials" },
    }));
    await expect(discovery.listSchemas()).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });
});

describe("TestDiscoveryServiceGetSchema", () => {
  it("returns a LexiconSchema", async () => {
    const discovery = discoveryFactory(() => ({
      status: 200,
      json: {
        status: "ok",
        results: { description: "User made a purchase", properties: {} },
      },
    }));
    const schema = await discovery.getSchema("event", "Purchase");

    expect(schema).toBeInstanceOf(LexiconSchema);
    expect(schema.entity_type).toBe("event");
    expect(schema.name).toBe("Purchase");
    expect(schema.schema_json.description).toBe("User made a purchase");
  });

  it("caches results", async () => {
    let callCount = 0;
    const discovery = discoveryFactory(() => {
      callCount += 1;
      return {
        status: 200,
        json: { status: "ok", results: { properties: {} } },
      };
    });

    await discovery.getSchema("event", "Test");
    expect(callCount).toBe(1);

    await discovery.getSchema("event", "Test");
    expect(callCount).toBe(1); // Cached
  });

  it("propagates QueryError for a not-found schema", async () => {
    const discovery = discoveryFactory(() => ({
      status: 400,
      json: { error: "Schema not found" },
    }));
    await expect(
      discovery.getSchema("event", "NonExistent"),
    ).rejects.toBeInstanceOf(QueryError);
  });
});
