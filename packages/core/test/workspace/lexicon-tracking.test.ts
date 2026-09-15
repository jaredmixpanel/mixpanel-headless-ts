// B6-W6 Layer-3 translation (packet `b6-packets.md` §8) — the class
// split of `tests/unit/test_workspace_data_governance.py` (1,842 lines)
// that W6 owns:
//
//   lexicon definitions + tags : `TestGetEventDefinitions` (:259),
//     `TestUpdateEventDefinition` (:315), `TestDeleteEventDefinition`
//     (:341), `TestBulkUpdateEventDefinitions` (:355),
//     `TestGetPropertyDefinitions` (:394),
//     `TestUpdatePropertyDefinition` (:450),
//     `TestBulkUpdatePropertyDefinitions` (:474),
//     `TestListLexiconTags` (:513), `TestCreateLexiconTag` (:555),
//     `TestUpdateLexiconTag` (:580), `TestDeleteLexiconTag` (:604)
//   tracking & history : `TestGetTrackingMetadata` (:1190),
//     `TestGetEventHistory` (:1217), `TestGetPropertyHistory` (:1256),
//     `TestExportLexicon` (:1287)
//
// The drop-filter / custom-property / custom-event / lookup-table
// classes in the same Python file belong to W7 (`b6-packets.md` §9)
// and are deliberately NOT translated here.
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)` (:97-110)
// becomes `makeWorkspace(handler)` — the client is built over the
// OAuth session (`_make_oauth_credentials`, :82) while the facade
// carries the service-account `_TEST_SESSION` (:64-72), exactly as
// Python does. `temp_dir` has no TS analog (no config file is ever
// touched) and is dropped.
//
// ADDITIVE sections (clearly headed, never substituting for a
// translated Python assertion — B5 Caution #13 / packet §0.2): the
// facade-local delegation contracts Python's wire suite cannot see —
// which client method each member calls, with which arguments, the
// `model_dump(exclude_none=True, by_alias=True)` body spelling
// (`workspace.py:7266`, `:7325`, `:7406`, `:7452`) vs the PLAIN
// `model_dump(exclude_none=True)` the two tag writers use (`:7526`,
// `:7557`), and the `list_lexicon_tags` string-entry sentinel branch
// (`:7491-7499`).

import { describe, expect, it } from "vitest";

import type { MixpanelClient } from "../../src/client/client.js";
import {
  BulkEventUpdate,
  BulkPropertyUpdate,
  BulkUpdateEventsParams,
  BulkUpdatePropertiesParams,
  CreateTagParams,
  EventDefinition,
  LexiconTag,
  PropertyDefinition,
  UpdateEventDefinitionParams,
  UpdatePropertyDefinitionParams,
  UpdateTagParams,
} from "../../src/types/entities/lexicon.js";
import { Workspace } from "../../src/workspace.js";
import {
  bulkUpdateEventDefinitions as bulkUpdateEventDefinitionsMember,
  bulkUpdatePropertyDefinitions as bulkUpdatePropertyDefinitionsMember,
  createLexiconTag as createLexiconTagMember,
  deleteEventDefinition as deleteEventDefinitionMember,
  deleteLexiconTag as deleteLexiconTagMember,
  exportLexicon as exportLexiconMember,
  getEventDefinitions as getEventDefinitionsMember,
  getEventHistory as getEventHistoryMember,
  getPropertyDefinitions as getPropertyDefinitionsMember,
  getPropertyHistory as getPropertyHistoryMember,
  getTrackingMetadata as getTrackingMetadataMember,
  listLexiconTags as listLexiconTagsMember,
  updateEventDefinition as updateEventDefinitionMember,
  updateLexiconTag as updateLexiconTagMember,
  updatePropertyDefinition as updatePropertyDefinitionMember,
} from "../../src/workspace-members/lexicon-tracking.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  type FakeTransport,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** A canned-response handler (the `httpx.MockTransport` handler twin). */
type Handler = (request: CapturedFetchRequest) => CannedResponse;

/** The OAuth session the mock client is built over (`:82-95`). */
const CLIENT_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  oauthToken: "test-token",
});

/** The canonical service-account facade session (`_TEST_SESSION`, :64-72). */
const FACADE_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  username: "test_user",
  secret: "test_secret",
});

/**
 * Build a Workspace whose client routes through `handler`
 * (`_make_workspace`, :97-110).
 *
 * @param handler - The canned-response handler.
 * @returns The facade plus the transport capture log.
 */
function makeWorkspace(handler: Handler): {
  ws: Workspace;
  transport: FakeTransport;
} {
  const { client, transport } = createMockClient(CLIENT_SESSION, handler);
  return { ws: new Workspace({ session: FACADE_SESSION, client }), transport };
}

/**
 * A minimal event definition dict matching the API shape
 * (`_event_def_json`, :124-143).
 *
 * @param id - Event definition ID.
 * @param name - Event name.
 * @returns The payload record.
 */
function eventDefJson(id = 1, name = "Purchase"): Record<string, unknown> {
  return {
    id,
    name,
    description: `Description for ${name}`,
    hidden: false,
    dropped: false,
  };
}

/**
 * A minimal property definition dict matching the API shape
 * (`_property_def_json`, :146-165).
 *
 * @param id - Property definition ID.
 * @param name - Property name.
 * @returns The payload record.
 */
function propertyDefJson(id = 1, name = "$browser"): Record<string, unknown> {
  return {
    id,
    name,
    resource_type: "event",
    description: `Description for ${name}`,
    hidden: false,
  };
}

/**
 * A minimal Lexicon tag dict matching the API shape (`_tag_json`,
 * :168-184).
 *
 * @param id - Tag ID.
 * @param name - Tag name.
 * @returns The payload record.
 */
function tagJson(id = 1, name = "core-metrics"): Record<string, unknown> {
  return { id, name };
}

/**
 * A 200 App-API envelope wrapping `results`.
 *
 * @param results - The `results` payload.
 * @returns The canned response.
 */
function ok(results: unknown): CannedResponse {
  return { status: 200, json: { status: "ok", results } };
}

/**
 * A 200 App-API envelope with NO `results` key (the Python
 * `{"status": "ok"}` delete responses).
 *
 * @returns The canned response.
 */
function okBare(): CannedResponse {
  return { status: 200, json: { status: "ok" } };
}

/**
 * A client stub whose single method returns `value` (the additive
 * delegation probes).
 *
 * @param method - The client method name to stub.
 * @param value - The value the stub resolves to.
 * @param calls - Optional log receiving each argument list.
 * @returns The stub cast to the client type.
 */
function stubClient(
  method: string,
  value: unknown,
  calls: unknown[][] = [],
): MixpanelClient {
  return {
    [method]: (...args: unknown[]): Promise<unknown> => {
      calls.push(args);
      return Promise.resolve(value);
    },
  } as unknown as MixpanelClient;
}

// =============================================================================
// US1: Data Definitions — Events
// =============================================================================

describe("TestGetEventDefinitions", () => {
  it("get_event_definitions() returns list of EventDefinition objects", async () => {
    const { ws } = makeWorkspace(() => ok([eventDefJson()]));
    const result = await ws.getEventDefinitions({ names: ["Purchase"] });

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(EventDefinition);
    expect(result[0]?.name).toBe("Purchase");
  });

  it("get_event_definitions() handles multiple events", async () => {
    const { ws } = makeWorkspace(() =>
      ok([eventDefJson(1, "Purchase"), eventDefJson(2, "Signup")]),
    );
    const result = await ws.getEventDefinitions({
      names: ["Purchase", "Signup"],
    });

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(1);
    expect(result[1]?.name).toBe("Signup");
  });

  it("get_event_definitions() returns empty list when no matches", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    await expect(
      ws.getEventDefinitions({ names: ["NonExistent"] }),
    ).resolves.toStrictEqual([]);
  });
});

describe("TestUpdateEventDefinition", () => {
  it("update_event_definition() returns the updated EventDefinition", async () => {
    const { ws } = makeWorkspace(() => ok(eventDefJson(1, "Purchase")));
    const params = new UpdateEventDefinitionParams({
      description: "Updated description",
      verified: true,
    });
    const result = await ws.updateEventDefinition("Purchase", params);

    expect(result).toBeInstanceOf(EventDefinition);
    expect(result.name).toBe("Purchase");
  });
});

describe("TestDeleteEventDefinition", () => {
  it("delete_event_definition() returns None on success", async () => {
    const { ws } = makeWorkspace(() => okBare());
    await expect(ws.deleteEventDefinition("OldEvent")).resolves.toBeUndefined();
  });
});

describe("TestBulkUpdateEventDefinitions", () => {
  it("bulk_update_event_definitions() returns list of EventDefinition", async () => {
    const { ws } = makeWorkspace(() =>
      ok([eventDefJson(1, "E1"), eventDefJson(2, "E2")]),
    );
    const params = new BulkUpdateEventsParams({
      events: [
        new BulkEventUpdate({ name: "E1", hidden: true }),
        new BulkEventUpdate({ name: "E2", verified: true }),
      ],
    });
    const result = await ws.bulkUpdateEventDefinitions(params);

    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(EventDefinition);
    expect(result[0]?.name).toBe("E1");
    expect(result[1]?.name).toBe("E2");
  });
});

// =============================================================================
// US1: Data Definitions — Properties
// =============================================================================

describe("TestGetPropertyDefinitions", () => {
  it("get_property_definitions() returns list of PropertyDefinition", async () => {
    const { ws } = makeWorkspace(() => ok([propertyDefJson()]));
    const result = await ws.getPropertyDefinitions({ names: ["$browser"] });

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(PropertyDefinition);
    expect(result[0]?.name).toBe("$browser");
  });

  it("get_property_definitions() passes resource_type to API", async () => {
    const capturedUrls: string[] = [];
    const { ws } = makeWorkspace((request) => {
      capturedUrls.push(request.url);
      return ok([propertyDefJson()]);
    });
    const result = await ws.getPropertyDefinitions({
      names: ["$browser"],
      resource_type: "event",
    });

    expect(result).toHaveLength(1);
    // ADDITIVE: Python captures the URL but only asserts the length
    // (:417-435); the canonicalization contract lives in the B4 client
    // (`canonicalResourceType`, "event" -> "Event").
    expect(capturedUrls[0]).toContain("resourceType=Event");
  });

  it("get_property_definitions() returns empty list when no matches", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    await expect(
      ws.getPropertyDefinitions({ names: ["nonexistent"] }),
    ).resolves.toStrictEqual([]);
  });
});

describe("TestUpdatePropertyDefinition", () => {
  it("update_property_definition() returns the updated PropertyDefinition", async () => {
    const { ws } = makeWorkspace(() => ok(propertyDefJson(1, "$browser")));
    const params = new UpdatePropertyDefinitionParams({ sensitive: true });
    const result = await ws.updatePropertyDefinition("$browser", params);

    expect(result).toBeInstanceOf(PropertyDefinition);
    expect(result.name).toBe("$browser");
  });
});

describe("TestBulkUpdatePropertyDefinitions", () => {
  it("bulk_update_property_definitions() returns list of PropertyDefinition", async () => {
    const { ws } = makeWorkspace(() =>
      ok([propertyDefJson(1, "$browser"), propertyDefJson(2, "$city")]),
    );
    const params = new BulkUpdatePropertiesParams({
      properties: [
        new BulkPropertyUpdate({
          name: "$browser",
          resource_type: "Event",
          hidden: true,
        }),
        new BulkPropertyUpdate({
          name: "$city",
          resource_type: "Event",
          sensitive: true,
        }),
      ],
    });
    const result = await ws.bulkUpdatePropertyDefinitions(params);

    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(PropertyDefinition);
    expect(result[0]?.name).toBe("$browser");
    expect(result[1]?.name).toBe("$city");
  });
});

// =============================================================================
// US2: Tags
// =============================================================================

describe("TestListLexiconTags", () => {
  it("list_lexicon_tags() returns list of LexiconTag objects", async () => {
    const { ws } = makeWorkspace(() =>
      ok([
        { id: 1, name: "core-metrics" },
        { id: 2, name: "growth" },
      ]),
    );
    const tags = await ws.listLexiconTags();

    expect(tags).toHaveLength(2);
    expect(tags[0]).toBeInstanceOf(LexiconTag);
    expect(tags[0]?.id).toBe(1);
    expect(tags[0]?.name).toBe("core-metrics");
    expect(tags[1]?.id).toBe(2);
    expect(tags[1]?.name).toBe("growth");
  });

  it("list_lexicon_tags() returns empty list when no tags exist", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    await expect(ws.listLexiconTags()).resolves.toStrictEqual([]);
  });
});

describe("TestCreateLexiconTag", () => {
  it("create_lexicon_tag() returns the created LexiconTag", async () => {
    const { ws } = makeWorkspace(() => ok(tagJson(99, "new-tag")));
    const tag = await ws.createLexiconTag(
      new CreateTagParams({ name: "new-tag" }),
    );

    expect(tag).toBeInstanceOf(LexiconTag);
    expect(tag.id).toBe(99);
    expect(tag.name).toBe("new-tag");
  });
});

describe("TestUpdateLexiconTag", () => {
  it("update_lexicon_tag() returns the updated LexiconTag", async () => {
    const { ws } = makeWorkspace(() => ok(tagJson(1, "renamed-tag")));
    const tag = await ws.updateLexiconTag(
      1,
      new UpdateTagParams({ name: "renamed-tag" }),
    );

    expect(tag).toBeInstanceOf(LexiconTag);
    expect(tag.name).toBe("renamed-tag");
  });
});

describe("TestDeleteLexiconTag", () => {
  it("delete_lexicon_tag() returns None on success", async () => {
    const { ws } = makeWorkspace(() => okBare());
    await expect(ws.deleteLexiconTag("core-metrics")).resolves.toBeUndefined();
  });
});

// =============================================================================
// US7: Tracking & History
// =============================================================================

describe("TestGetTrackingMetadata", () => {
  it("get_tracking_metadata() returns an opaque dict", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ last_seen: "2026-01-01", platforms: ["web", "ios"] }),
    );
    const result = await ws.getTrackingMetadata("Purchase");

    expect(typeof result).toBe("object");
    expect(result["last_seen"]).toBe("2026-01-01");
    expect(result["platforms"]).toContain("web");
  });
});

describe("TestGetEventHistory", () => {
  it("get_event_history() returns a list of history dicts", async () => {
    const { ws } = makeWorkspace(() =>
      ok([
        { action: "created", timestamp: "2026-01-01" },
        { action: "updated", timestamp: "2026-02-01" },
      ]),
    );
    const result = await ws.getEventHistory("Purchase");

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0]?.["action"]).toBe("created");
  });

  it("get_event_history() returns empty list when no history", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    await expect(ws.getEventHistory("Purchase")).resolves.toStrictEqual([]);
  });
});

describe("TestGetPropertyHistory", () => {
  it("get_property_history() returns a list of history dicts", async () => {
    const { ws } = makeWorkspace(() =>
      ok([{ action: "hidden", timestamp: "2026-03-01" }]),
    );
    const result = await ws.getPropertyHistory("$browser", "event");

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]?.["action"]).toBe("hidden");
  });
});

// =============================================================================
// US8: Export
// =============================================================================

describe("TestExportLexicon", () => {
  it("export_lexicon() returns an opaque dict with export data", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ events: [eventDefJson()], properties: [propertyDefJson()] }),
    );
    const result = await ws.exportLexicon();

    expect(typeof result).toBe("object");
    expect(Object.hasOwn(result, "events")).toBe(true);
    expect(Object.hasOwn(result, "properties")).toBe(true);
  });

  it("export_lexicon(export_types=['events']) passes filter to API", async () => {
    const capturedUrls: string[] = [];
    const { ws } = makeWorkspace((request) => {
      capturedUrls.push(request.url);
      return ok({ events: [eventDefJson()] });
    });
    const result = await ws.exportLexicon({ export_types: ["events"] });

    expect(typeof result).toBe("object");
    // ADDITIVE: Python captures the body but only asserts the type
    // (:1309-1330); the `export_type` JSON-encoding contract is B4's.
    expect(capturedUrls[0]).toContain("export_type=");
    expect(decodeURIComponent(capturedUrls[0] ?? "")).toContain('["events"]');
  });

  it("export_lexicon() with no filter returns all types", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ events: [], properties: [], tags: [] }),
    );
    const result = await ws.exportLexicon();

    expect(typeof result).toBe("object");
  });
});

// =============================================================================
// ADDITIVE — facade delegation contracts (B5 Caution #13 / packet §0.2).
// These do NOT substitute for a translated Python assertion; they lock
// the seam Python's wire-level suite cannot observe: which client
// method each member calls, with which arguments, and how the params
// model is dumped.
// =============================================================================

describe("ADDITIVE: W6 delegation contracts", () => {
  it("get_event_definitions forwards the names list positionally", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("getEventDefinitions", [], calls);
    await getEventDefinitionsMember(client, { names: ["A", "B"] });
    expect(calls[0]).toStrictEqual([["A", "B"]]);
  });

  it("get_property_definitions forwards resource_type as `null` when absent", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("getPropertyDefinitions", [], calls);
    await getPropertyDefinitionsMember(client, { names: ["p"] });
    expect(calls[0]).toStrictEqual([["p"], null]);
  });

  it("get_property_definitions forwards resource_type verbatim when given", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("getPropertyDefinitions", [], calls);
    await getPropertyDefinitionsMember(client, {
      names: ["p"],
      resource_type: "people",
    });
    expect(calls[0]).toStrictEqual([["p"], "people"]);
  });

  it("update_event_definition dumps by_alias and drops None (`workspace.py:7266`)", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("updateEventDefinition", eventDefJson(), calls);
    await updateEventDefinitionMember(
      client,
      "Purchase",
      new UpdateEventDefinitionParams({
        display_name: "Bought",
        description: null,
      }),
    );
    expect(calls[0]?.[0]).toBe("Purchase");
    expect(calls[0]?.[1]).toStrictEqual({ displayName: "Bought" });
  });

  it("bulk_update_event_definitions dumps by_alias recursively (`:7325`)", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("bulkUpdateEventDefinitions", [], calls);
    await bulkUpdateEventDefinitionsMember(
      client,
      new BulkUpdateEventsParams({
        events: [new BulkEventUpdate({ name: "E1", display_name: "One" })],
      }),
    );
    expect(calls[0]?.[0]).toStrictEqual({
      events: [{ name: "E1", displayName: "One" }],
    });
  });

  it("update_property_definition dumps by_alias and drops None (`:7406`)", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "updatePropertyDefinition",
      propertyDefJson(),
      calls,
    );
    await updatePropertyDefinitionMember(
      client,
      "$browser",
      new UpdatePropertyDefinitionParams({
        example_value: "Chrome",
        resource_type: "Event",
        hidden: null,
      }),
    );
    expect(calls[0]?.[0]).toBe("$browser");
    expect(calls[0]?.[1]).toStrictEqual({
      exampleValue: "Chrome",
      resourceType: "Event",
    });
  });

  it("bulk_update_property_definitions dumps by_alias recursively (`:7452`)", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("bulkUpdatePropertyDefinitions", [], calls);
    await bulkUpdatePropertyDefinitionsMember(
      client,
      new BulkUpdatePropertiesParams({
        properties: [
          new BulkPropertyUpdate({
            name: "$city",
            resource_type: "Event",
            display_name: "City",
          }),
        ],
      }),
    );
    expect(calls[0]?.[0]).toStrictEqual({
      properties: [
        { name: "$city", resourceType: "Event", displayName: "City" },
      ],
    });
  });

  it("create_lexicon_tag dumps WITHOUT by_alias (`:7526`)", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("createLexiconTag", tagJson(), calls);
    await createLexiconTagMember(client, new CreateTagParams({ name: "t" }));
    expect(calls[0]?.[0]).toStrictEqual({ name: "t" });
  });

  it("update_lexicon_tag forwards the INT id then the plain dump (`:7557`)", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("updateLexiconTag", tagJson(), calls);
    await updateLexiconTagMember(client, 7, new UpdateTagParams({ name: "t" }));
    expect(calls[0]).toStrictEqual([7, { name: "t" }]);
  });

  it("update_lexicon_tag drops a None name (exclude_none)", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("updateLexiconTag", tagJson(), calls);
    await updateLexiconTagMember(client, 7, new UpdateTagParams({}));
    expect(calls[0]?.[1]).toStrictEqual({});
  });

  it("list_lexicon_tags wraps plain STRING entries with the id=0 sentinel (`:7491-7499`)", async () => {
    const client = stubClient("listLexiconTags", [
      "plain-name",
      { id: 4, name: "structured" },
    ]);
    const tags = await listLexiconTagsMember(client);

    expect(tags).toHaveLength(2);
    expect(tags[0]).toBeInstanceOf(LexiconTag);
    expect(tags[0]?.id).toBe(0);
    expect(tags[0]?.name).toBe("plain-name");
    expect(tags[1]?.id).toBe(4);
    expect(tags[1]?.name).toBe("structured");
  });

  it("delete_event_definition / delete_lexicon_tag forward the NAME (never an id)", async () => {
    const eventCalls: unknown[][] = [];
    await deleteEventDefinitionMember(
      stubClient("deleteEventDefinition", undefined, eventCalls),
      "OldEvent",
    );
    expect(eventCalls[0]).toStrictEqual(["OldEvent"]);

    const tagCalls: unknown[][] = [];
    await deleteLexiconTagMember(
      stubClient("deleteLexiconTag", undefined, tagCalls),
      "core-metrics",
    );
    expect(tagCalls[0]).toStrictEqual(["core-metrics"]);
  });

  it("export_lexicon forwards `null` when export_types is absent (`:8648`)", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("exportLexicon", {}, calls);
    await exportLexiconMember(client, {});
    expect(calls[0]).toStrictEqual([null]);
  });

  it("export_lexicon forwards the caller's list verbatim", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("exportLexicon", {}, calls);
    await exportLexiconMember(client, { export_types: ["events"] });
    expect(calls[0]).toStrictEqual([["events"]]);
  });

  it("the three opaque passthroughs return native values, unvalidated", async () => {
    const metadata = await getTrackingMetadataMember(
      stubClient("getTrackingMetadata", { volume: 12 }),
      "Purchase",
    );
    expect(metadata).toStrictEqual({ volume: 12 });

    const eventHistory = await getEventHistoryMember(
      stubClient("getEventHistory", [{ action: "created" }]),
      "Purchase",
    );
    expect(eventHistory).toStrictEqual([{ action: "created" }]);

    const propertyHistory = await getPropertyHistoryMember(
      stubClient("getPropertyHistory", [{ action: "hidden" }]),
      "$browser",
      "event",
    );
    expect(propertyHistory).toStrictEqual([{ action: "hidden" }]);
  });

  it("get_property_history forwards BOTH positional args (`:8614`)", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("getPropertyHistory", [], calls);
    await getPropertyHistoryMember(client, "$browser", "user");
    expect(calls[0]).toStrictEqual(["$browser", "user"]);
  });
});
