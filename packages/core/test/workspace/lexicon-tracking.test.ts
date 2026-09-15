// `Workspace` lexicon members: event/property definitions (get, update,
// bulk update, delete), lexicon tags, tracking metadata, history and
// export. Mirrors the lexicon / tags / tracking-history classes of
// `tests/unit/test_workspace_data_governance.py`; `httpx.MockTransport`
// becomes the injected-fetch seam. `ADDITIVE:` locks delegation and dump flags.

import { describe, expect, it } from "vitest";

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
  ok,
} from "../../test-support/client-test-helpers.js";
import {
  makeFacadeWorkspace,
  stubClient,
} from "../../test-support/workspace-test-helpers.js";

/**
 * A minimal event definition dict matching the API shape
 * (`_event_def_json`).
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
 * (`_property_def_json`).
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
 * A minimal Lexicon tag dict matching the API shape (`_tag_json`).
 *
 * @param id - Tag ID.
 * @param name - Tag name.
 * @returns The payload record.
 */
function tagJson(id = 1, name = "core-metrics"): Record<string, unknown> {
  return { id, name };
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

// =============================================================================
// US1: Data Definitions — Events
// =============================================================================

describe("Get event definitions", () => {
  // python: TestGetEventDefinitions
  it("getEventDefinitions() returns list of EventDefinition objects", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([eventDefJson()]));
    const result = await ws.getEventDefinitions({ names: ["Purchase"] });

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(EventDefinition);
    expect(result[0]?.name).toBe("Purchase");
  });

  it("getEventDefinitions() handles multiple events", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([eventDefJson(1, "Purchase"), eventDefJson(2, "Signup")]),
    );
    const result = await ws.getEventDefinitions({
      names: ["Purchase", "Signup"],
    });

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(1);
    expect(result[1]?.name).toBe("Signup");
  });

  it("getEventDefinitions() returns empty list when no matches", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));
    await expect(
      ws.getEventDefinitions({ names: ["NonExistent"] }),
    ).resolves.toStrictEqual([]);
  });
});

describe("Update event definition", () => {
  // python: TestUpdateEventDefinition
  it("updateEventDefinition() returns the updated EventDefinition", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(eventDefJson(1, "Purchase")));
    const params = new UpdateEventDefinitionParams({
      description: "Updated description",
      verified: true,
    });
    const result = await ws.updateEventDefinition("Purchase", params);

    expect(result).toBeInstanceOf(EventDefinition);
    expect(result.name).toBe("Purchase");
  });
});

describe("Delete event definition", () => {
  // python: TestDeleteEventDefinition
  it("deleteEventDefinition() returns None on success", async () => {
    const { ws } = makeFacadeWorkspace(() => okBare());
    await expect(ws.deleteEventDefinition("OldEvent")).resolves.toBeUndefined();
  });
});

describe("Bulk update event definitions", () => {
  // python: TestBulkUpdateEventDefinitions
  it("bulkUpdateEventDefinitions() returns list of EventDefinition", async () => {
    const { ws } = makeFacadeWorkspace(() =>
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

describe("Get property definitions", () => {
  // python: TestGetPropertyDefinitions
  it("getPropertyDefinitions() returns list of PropertyDefinition", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([propertyDefJson()]));
    const result = await ws.getPropertyDefinitions({ names: ["$browser"] });

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(PropertyDefinition);
    expect(result[0]?.name).toBe("$browser");
  });

  it("getPropertyDefinitions() passes resource_type to API", async () => {
    const capturedUrls: string[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      capturedUrls.push(request.url);
      return ok([propertyDefJson()]);
    });
    const result = await ws.getPropertyDefinitions({
      names: ["$browser"],
      resource_type: "event",
    });

    expect(result).toHaveLength(1);
    // ADDITIVE: Python captures the URL but only asserts the length; the
    // canonicalization contract lives in the client
    // (`canonicalResourceType`, "event" -> "Event").
    expect(capturedUrls[0]).toContain("resourceType=Event");
  });

  it("getPropertyDefinitions() returns empty list when no matches", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));
    await expect(
      ws.getPropertyDefinitions({ names: ["nonexistent"] }),
    ).resolves.toStrictEqual([]);
  });
});

describe("Update property definition", () => {
  // python: TestUpdatePropertyDefinition
  it("updatePropertyDefinition() returns the updated PropertyDefinition", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(propertyDefJson(1, "$browser")),
    );
    const params = new UpdatePropertyDefinitionParams({ sensitive: true });
    const result = await ws.updatePropertyDefinition("$browser", params);

    expect(result).toBeInstanceOf(PropertyDefinition);
    expect(result.name).toBe("$browser");
  });
});

describe("Bulk update property definitions", () => {
  // python: TestBulkUpdatePropertyDefinitions
  it("bulkUpdatePropertyDefinitions() returns list of PropertyDefinition", async () => {
    const { ws } = makeFacadeWorkspace(() =>
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

describe("List lexicon tags", () => {
  // python: TestListLexiconTags
  it("listLexiconTags() returns list of LexiconTag objects", async () => {
    const { ws } = makeFacadeWorkspace(() =>
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

  it("listLexiconTags() returns empty list when no tags exist", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));
    await expect(ws.listLexiconTags()).resolves.toStrictEqual([]);
  });
});

describe("Create lexicon tag", () => {
  // python: TestCreateLexiconTag
  it("createLexiconTag() returns the created LexiconTag", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(tagJson(99, "new-tag")));
    const tag = await ws.createLexiconTag(
      new CreateTagParams({ name: "new-tag" }),
    );

    expect(tag).toBeInstanceOf(LexiconTag);
    expect(tag.id).toBe(99);
    expect(tag.name).toBe("new-tag");
  });
});

describe("Update lexicon tag", () => {
  // python: TestUpdateLexiconTag
  it("updateLexiconTag() returns the updated LexiconTag", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(tagJson(1, "renamed-tag")));
    const tag = await ws.updateLexiconTag(
      1,
      new UpdateTagParams({ name: "renamed-tag" }),
    );

    expect(tag).toBeInstanceOf(LexiconTag);
    expect(tag.name).toBe("renamed-tag");
  });
});

describe("Delete lexicon tag", () => {
  // python: TestDeleteLexiconTag
  it("deleteLexiconTag() returns None on success", async () => {
    const { ws } = makeFacadeWorkspace(() => okBare());
    await expect(ws.deleteLexiconTag("core-metrics")).resolves.toBeUndefined();
  });
});

// =============================================================================
// US7: Tracking & History
// =============================================================================

describe("Get tracking metadata", () => {
  // python: TestGetTrackingMetadata
  it("getTrackingMetadata() returns an opaque dict", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ last_seen: "2026-01-01", platforms: ["web", "ios"] }),
    );
    const result = await ws.getTrackingMetadata("Purchase");

    expect(typeof result).toBe("object");
    expect(result["last_seen"]).toBe("2026-01-01");
    expect(result["platforms"]).toContain("web");
  });
});

describe("Get event history", () => {
  // python: TestGetEventHistory
  it("getEventHistory() returns a list of history dicts", async () => {
    const { ws } = makeFacadeWorkspace(() =>
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

  it("getEventHistory() returns empty list when no history", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));
    await expect(ws.getEventHistory("Purchase")).resolves.toStrictEqual([]);
  });
});

describe("Get property history", () => {
  // python: TestGetPropertyHistory
  it("getPropertyHistory() returns a list of history dicts", async () => {
    const { ws } = makeFacadeWorkspace(() =>
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

describe("Export lexicon", () => {
  // python: TestExportLexicon
  it("exportLexicon() returns an opaque dict with export data", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ events: [eventDefJson()], properties: [propertyDefJson()] }),
    );
    const result = await ws.exportLexicon();

    expect(typeof result).toBe("object");
    expect(Object.hasOwn(result, "events")).toBe(true);
    expect(Object.hasOwn(result, "properties")).toBe(true);
  });

  it("exportLexicon(export_types=['events']) passes filter to API", async () => {
    const capturedUrls: string[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      capturedUrls.push(request.url);
      return ok({ events: [eventDefJson()] });
    });
    const result = await ws.exportLexicon({ export_types: ["events"] });

    expect(typeof result).toBe("object");
    // ADDITIVE: Python captures the body but only asserts the type; the
    // `export_type` JSON encoding is the client's contract.
    expect(capturedUrls[0]).toContain("export_type=");
    expect(decodeURIComponent(capturedUrls[0] ?? "")).toContain('["events"]');
  });

  it("exportLexicon() with no filter returns all types", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ events: [], properties: [], tags: [] }),
    );
    const result = await ws.exportLexicon();

    expect(typeof result).toBe("object");
  });
});

// =============================================================================
// ADDITIVE — facade delegation contracts. These do not substitute for a
// translated Python assertion; they lock the seam Python's wire-level
// suite cannot observe: which client method each member calls, with
// which arguments, and how the params model is dumped.
// =============================================================================

describe("ADDITIVE: lexicon delegation contracts", () => {
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

  it("update_event_definition dumps by_alias and drops None", async () => {
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

  it("bulk_update_event_definitions dumps by_alias recursively", async () => {
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

  it("update_property_definition dumps by_alias and drops None", async () => {
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

  it("bulk_update_property_definitions dumps by_alias recursively", async () => {
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

  it("create_lexicon_tag dumps without by_alias", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("createLexiconTag", tagJson(), calls);
    await createLexiconTagMember(client, new CreateTagParams({ name: "t" }));
    expect(calls[0]?.[0]).toStrictEqual({ name: "t" });
  });

  it("update_lexicon_tag forwards the int id then the plain dump", async () => {
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

  it("list_lexicon_tags wraps plain string entries with the id=0 sentinel", async () => {
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

  it("export_lexicon forwards `null` when export_types is absent", async () => {
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

  it("get_property_history forwards both positional args", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("getPropertyHistory", [], calls);
    await getPropertyHistoryMember(client, "$browser", "user");
    expect(calls[0]).toStrictEqual(["$browser", "user"]);
  });
});
