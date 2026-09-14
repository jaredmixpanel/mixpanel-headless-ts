// B6-W8 Layer-3 translation (packet `b6-packets.md` §10) — the WHOLE
// of `tests/unit/test_workspace_schemas.py` (877 lines, 6 classes):
//
//   `TestListSchemaRegistry` (:151), `TestCreateSchema` (:298),
//   `TestCreateSchemasBulk` (:383), `TestUpdateSchema` (:519),
//   `TestUpdateSchemasBulk` (:604), `TestDeleteSchemas` (:746)
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)` (:71-88)
// becomes `makeWorkspace(handler)` — the client is built over the
// OAuth session (`_make_oauth_credentials`, :57) while the facade
// carries the service-account `_TEST_SESSION` (:41-50), exactly as
// Python does. `temp_dir` has no TS analog (no config file is ever
// touched) and is dropped; the W6/W7 precedent.
//
// ADDITIVE sections (clearly headed, never substituting for a
// translated Python assertion — B5 Caution #13 / packet §0.2): the
// facade-local delegation contracts Python's wire suite cannot see —
// which client method each member calls, with which arguments, the
// `model_dump(exclude_none=True, by_alias=True)` body spelling
// (`workspace.py:8754`, `:8824`), the `validate_response_model(s)`
// `endpoint=` strings, and the `RESPONSE_VALIDATION_ERROR` seam.

import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
import {
  createMockClient,
  makeSession,
  type CannedResponse,
  type CapturedFetchRequest,
  type FakeTransport,
} from "../../test-support/client-test-helpers.js";
import type { MixpanelClient } from "../../src/client/client.js";
import {
  MixpanelHeadlessError,
  ResponseValidationError,
} from "../../src/errors.js";
import {
  BulkCreateSchemasParams,
  BulkCreateSchemasResponse,
  BulkPatchResult,
  DeleteSchemasResponse,
  SchemaEntry,
} from "../../src/types/entities/schemas.js";
import {
  createSchema as createSchemaMember,
  createSchemasBulk as createSchemasBulkMember,
  deleteSchemas as deleteSchemasMember,
  listSchemaRegistry as listSchemaRegistryMember,
  updateSchema as updateSchemaMember,
  updateSchemasBulk as updateSchemasBulkMember,
} from "../../src/workspace-members/schemas-audit.js";

/** A canned-response handler (the `httpx.MockTransport` handler twin). */
type Handler = (request: CapturedFetchRequest) => CannedResponse;

/** The OAuth session the mock client is built over (`:57-63`). */
const CLIENT_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  oauthToken: "test-token",
});

/** The canonical service-account facade session (`_TEST_SESSION`, :41-50). */
const FACADE_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  username: "test_user",
  secret: "test_secret",
});

/**
 * Build a Workspace whose client routes through `handler`
 * (`_make_workspace`, :71-88).
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
 * A minimal schema entry dict matching the API shape
 * (`_schema_entry_json`, :96-120).
 *
 * @param entityType - Entity type ("event", "custom_event", "profile").
 * @param name - Entity name.
 * @param schemaDefinition - JSON Schema definition (Python default).
 * @param version - Schema version, or `undefined` to omit the key.
 * @returns The payload record.
 */
function schemaEntryJson(
  entityType = "event",
  name = "Purchase",
  schemaDefinition?: Record<string, unknown>,
  version: string | undefined = "2025-01-15",
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    entityType,
    name,
    schemaJson: schemaDefinition ?? {
      properties: { amount: { type: "number" } },
      required: ["amount"],
    },
  };
  if (version !== undefined) {
    result["version"] = version;
  }
  return result;
}

/**
 * The App-API envelope every handler in the Python file returns.
 *
 * @param results - The `results` member.
 * @returns The canned 200 response.
 */
function ok(results: unknown): CannedResponse {
  return { status: 200, json: { status: "ok", results } };
}

// ===========================================================================
// Tests: list_schema_registry (`TestListSchemaRegistry`, :151-286)
// ===========================================================================

describe("Workspace.listSchemaRegistry", () => {
  it("returns all schemas as SchemaEntry list (:154)", async () => {
    const { ws } = makeWorkspace(() =>
      ok([
        schemaEntryJson("event", "Purchase"),
        schemaEntryJson("event", "Login"),
        schemaEntryJson("profile", "$user"),
      ]),
    );

    const schemas = await ws.listSchemaRegistry();

    expect(schemas).toHaveLength(3);
    expect(schemas[0]).toBeInstanceOf(SchemaEntry);
    expect(schemas[0]?.entity_type).toBe("event");
    expect(schemas[0]?.name).toBe("Purchase");
    expect(schemas[1]?.name).toBe("Login");
    expect(schemas[2]?.entity_type).toBe("profile");
    expect(schemas[2]?.name).toBe("$user");
  });

  it("returns empty list when no schemas exist (:182)", async () => {
    const { ws } = makeWorkspace(() => ok([]));

    expect(await ws.listSchemaRegistry()).toEqual([]);
  });

  it("passes the entity_type filter to the API (:194)", async () => {
    const capturedUrl: string[] = [];
    const { ws } = makeWorkspace((request) => {
      capturedUrl.push(request.url);
      return ok([schemaEntryJson("event", "Purchase")]);
    });

    const schemas = await ws.listSchemaRegistry({ entity_type: "event" });

    expect(schemas).toHaveLength(1);
    expect(schemas[0]).toBeInstanceOf(SchemaEntry);
    expect(schemas[0]?.entity_type).toBe("event");
    expect(capturedUrl).toHaveLength(1);
    expect(capturedUrl[0]).toContain("schemas/event");
  });

  it("preserves the schemaJson field content (:220)", async () => {
    const customSchema = {
      type: "object",
      properties: {
        amount: { type: "number" },
        currency: { type: "string", enum: ["USD", "EUR"] },
      },
      required: ["amount", "currency"],
    };
    const { ws } = makeWorkspace(() =>
      ok([schemaEntryJson("event", "Purchase", customSchema)]),
    );

    const schemas = await ws.listSchemaRegistry();

    expect(schemas).toHaveLength(1);
    expect(schemas[0]?.schema_definition).toEqual(customSchema);
  });

  it("preserves the version field (:251)", async () => {
    const { ws } = makeWorkspace(() =>
      ok([schemaEntryJson("event", "Purchase", undefined, "2025-03-20")]),
    );

    const schemas = await ws.listSchemaRegistry();

    expect(schemas[0]?.version).toBe("2025-03-20");
  });

  it("preserves unknown fields (extra='allow', :271)", async () => {
    const entry = schemaEntryJson("event", "Purchase");
    entry["customField"] = "extra-value";
    const { ws } = makeWorkspace(() => ok([entry]));

    const schemas = await ws.listSchemaRegistry();

    expect(schemas).toHaveLength(1);
    expect(schemas[0]?.__extras["customField"]).toBe("extra-value");
  });
});

// ===========================================================================
// Tests: create_schema (`TestCreateSchema`, :298-379)
// ===========================================================================

describe("Workspace.createSchema", () => {
  it("returns the raw dict from the API (:301)", async () => {
    const schemaDef = {
      properties: { amount: { type: "number" } },
      required: ["amount"],
    };
    const { ws } = makeWorkspace(() =>
      ok({ entityType: "event", name: "Purchase", schemaJson: schemaDef }),
    );

    const result = await ws.createSchema("event", "Purchase", schemaDef);

    expect(result).toBeTypeOf("object");
    expect(result["entityType"]).toBe("event");
    expect(result["name"]).toBe("Purchase");
  });

  it("constructs the correct API path (:329)", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
      captured.push(request);
      return ok({ entityType: "event", name: "Purchase" });
    });

    await ws.createSchema("event", "Purchase", {
      properties: { x: { type: "string" } },
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toContain("schemas/event/Purchase");
    expect(captured[0]?.method).toBe("POST");
  });

  it("percent-encodes entity names with special chars (:351)", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
      captured.push(request);
      return ok({ entityType: "event", name: "My Event / Test" });
    });

    await ws.createSchema("event", "My Event / Test", { properties: {} });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).not.toContain("My Event / Test");
  });
});

// ===========================================================================
// Tests: create_schemas_bulk (`TestCreateSchemasBulk`, :383-515)
// ===========================================================================

describe("Workspace.createSchemasBulk", () => {
  it("returns a BulkCreateSchemasResponse (:386)", async () => {
    const { ws } = makeWorkspace(() => ok({ added: 3, deleted: 0 }));
    const params = new BulkCreateSchemasParams({
      entries: [
        new SchemaEntry({
          entity_type: "event",
          name: "Purchase",
          schema_definition: { properties: { amount: { type: "number" } } },
        }),
        new SchemaEntry({
          entity_type: "event",
          name: "Login",
          schema_definition: { properties: {} },
        }),
        new SchemaEntry({
          entity_type: "event",
          name: "Signup",
          schema_definition: { properties: {} },
        }),
      ],
    });

    const result = await ws.createSchemasBulk(params);

    expect(result).toBeInstanceOf(BulkCreateSchemasResponse);
    expect(result.added).toBe(3);
    expect(result.deleted).toBe(0);
  });

  it("reports the deleted count with truncate=True (:425)", async () => {
    const { ws } = makeWorkspace(() => ok({ added: 2, deleted: 5 }));
    const params = new BulkCreateSchemasParams({
      entries: [
        new SchemaEntry({
          entity_type: "event",
          name: "Purchase",
          schema_definition: { properties: {} },
        }),
        new SchemaEntry({
          entity_type: "event",
          name: "Login",
          schema_definition: { properties: {} },
        }),
      ],
      truncate: true,
      entity_type: "event",
    });

    const result = await ws.createSchemasBulk(params);

    expect(result).toBeInstanceOf(BulkCreateSchemasResponse);
    expect(result.added).toBe(2);
    expect(result.deleted).toBe(5);
  });

  it("returns zero counts for empty entries (:461)", async () => {
    const { ws } = makeWorkspace(() => ok({ added: 0, deleted: 0 }));

    const result = await ws.createSchemasBulk(
      new BulkCreateSchemasParams({ entries: [] }),
    );

    expect(result).toBeInstanceOf(BulkCreateSchemasResponse);
    expect(result.added).toBe(0);
    expect(result.deleted).toBe(0);
  });

  it("sends POST to the schemas endpoint (:482)", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
      captured.push(request);
      return ok({ added: 1, deleted: 0 });
    });

    await ws.createSchemasBulk(
      new BulkCreateSchemasParams({
        entries: [
          new SchemaEntry({
            entity_type: "event",
            name: "Test",
            schema_definition: { properties: {} },
          }),
        ],
      }),
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe("POST");
    expect(captured[0]?.url).toContain("schemas");
  });
});

// ===========================================================================
// Tests: update_schema (`TestUpdateSchema`, :519-600)
// ===========================================================================

describe("Workspace.updateSchema", () => {
  it("returns the raw dict from the API (:522)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({
        entityType: "event",
        name: "Purchase",
        schemaJson: {
          properties: { amount: { type: "number" }, tax: { type: "number" } },
        },
      }),
    );

    const result = await ws.updateSchema("event", "Purchase", {
      properties: { tax: { type: "number" } },
    });

    expect(result).toBeTypeOf("object");
    expect(result["entityType"]).toBe("event");
    expect(result["name"]).toBe("Purchase");
    const schemaJson = result["schemaJson"] as {
      properties: Record<string, unknown>;
    };
    expect(Object.hasOwn(schemaJson.properties, "tax")).toBe(true);
  });

  it("sends PATCH to the correct path (:553)", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
      captured.push(request);
      return ok({ entityType: "event", name: "Purchase" });
    });

    await ws.updateSchema("event", "Purchase", { properties: {} });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe("PATCH");
    expect(captured[0]?.url).toContain("schemas/event/Purchase");
  });

  it("percent-encodes $user for profile schemas (:575)", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
      captured.push(request);
      return ok({ entityType: "profile", name: "$user" });
    });

    await ws.updateSchema("profile", "$user", { properties: {} });

    expect(captured).toHaveLength(1);
    const url = captured[0]?.url ?? "";
    expect(!url.includes("$user") || url.includes("%24user")).toBe(true);
  });
});

// ===========================================================================
// Tests: update_schemas_bulk (`TestUpdateSchemasBulk`, :604-742)
// ===========================================================================

describe("Workspace.updateSchemasBulk", () => {
  it("returns a list of BulkPatchResult (:607)", async () => {
    const { ws } = makeWorkspace(() =>
      ok([
        { entityType: "event", name: "Purchase", status: "ok" },
        { entityType: "event", name: "Login", status: "ok" },
      ]),
    );
    const params = new BulkCreateSchemasParams({
      entries: [
        new SchemaEntry({
          entity_type: "event",
          name: "Purchase",
          schema_definition: { properties: { amount: { type: "number" } } },
        }),
        new SchemaEntry({
          entity_type: "event",
          name: "Login",
          schema_definition: { properties: {} },
        }),
      ],
    });

    const results = await ws.updateSchemasBulk(params);

    expect(results).toHaveLength(2);
    expect(results[0]).toBeInstanceOf(BulkPatchResult);
    expect(results[0]?.entity_type).toBe("event");
    expect(results[0]?.name).toBe("Purchase");
    expect(results[0]?.status).toBe("ok");
    expect(results[1]?.name).toBe("Login");
    expect(results[1]?.status).toBe("ok");
  });

  it("returns error status for failed entries (:656)", async () => {
    const { ws } = makeWorkspace(() =>
      ok([
        { entityType: "event", name: "Purchase", status: "ok" },
        {
          entityType: "event",
          name: "NonExistent",
          status: "error",
          error: "Entity not found",
        },
      ]),
    );
    const params = new BulkCreateSchemasParams({
      entries: [
        new SchemaEntry({
          entity_type: "event",
          name: "Purchase",
          schema_definition: { properties: {} },
        }),
        new SchemaEntry({
          entity_type: "event",
          name: "NonExistent",
          schema_definition: { properties: {} },
        }),
      ],
    });

    const results = await ws.updateSchemasBulk(params);

    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe("ok");
    expect(results[0]?.error).toBeNull();
    expect(results[1]?.status).toBe("error");
    expect(results[1]?.error).toBe("Entity not found");
  });

  it("returns an empty list for empty entries (:704)", async () => {
    const { ws } = makeWorkspace(() => ok([]));

    const results = await ws.updateSchemasBulk(
      new BulkCreateSchemasParams({ entries: [] }),
    );

    expect(results).toEqual([]);
  });

  it("sends PATCH to the schemas endpoint (:720)", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
      captured.push(request);
      return ok([]);
    });

    await ws.updateSchemasBulk(new BulkCreateSchemasParams({ entries: [] }));

    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe("PATCH");
    expect(captured[0]?.url).toContain("schemas");
  });
});

// ===========================================================================
// Tests: delete_schemas (`TestDeleteSchemas`, :746-877)
// ===========================================================================

describe("Workspace.deleteSchemas", () => {
  it("deletes all and returns the count with no args (:749)", async () => {
    const { ws } = makeWorkspace(() => ok({ deleteCount: 10 }));

    const result = await ws.deleteSchemas();

    expect(result).toBeInstanceOf(DeleteSchemasResponse);
    expect(result.delete_count).toBe(10);
  });

  it("deletes all schemas of one entity type (:768)", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
      captured.push(request);
      return ok({ deleteCount: 5 });
    });

    const result = await ws.deleteSchemas({ entity_type: "event" });

    expect(result).toBeInstanceOf(DeleteSchemasResponse);
    expect(result.delete_count).toBe(5);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toContain("schemas/event");
    expect(captured[0]?.method).toBe("DELETE");
  });

  it("deletes a single schema by type + name (:792)", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
      captured.push(request);
      return ok({ deleteCount: 1 });
    });

    const result = await ws.deleteSchemas({
      entity_type: "event",
      entity_name: "Purchase",
    });

    expect(result).toBeInstanceOf(DeleteSchemasResponse);
    expect(result.delete_count).toBe(1);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toContain("schemas/event/Purchase");
  });

  it("returns a zero count when nothing matches (:815)", async () => {
    const { ws } = makeWorkspace(() => ok({ deleteCount: 0 }));

    const result = await ws.deleteSchemas({ entity_type: "custom_event" });

    expect(result).toBeInstanceOf(DeleteSchemasResponse);
    expect(result.delete_count).toBe(0);
  });

  it("sends the DELETE HTTP method (:834)", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
      captured.push(request);
      return ok({ deleteCount: 0 });
    });

    await ws.deleteSchemas();

    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe("DELETE");
  });

  it("raises when entity_name is given without entity_type (:855)", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeWorkspace((request) => {
      captured.push(request);
      return ok({ deleteCount: 0 });
    });

    // `pytest.raises(MixpanelHeadlessError, match="entity_name requires
    // entity_type")` — the CLASS is the contract (R5.4); the message is
    // additionally asserted because Python's `match=` does.
    await expect(
      ws.deleteSchemas({ entity_name: "Purchase" }),
    ).rejects.toBeInstanceOf(MixpanelHeadlessError);
    await expect(ws.deleteSchemas({ entity_name: "Purchase" })).rejects.toThrow(
      /entity_name requires entity_type/,
    );
    // The guard fires BEFORE any request (packet Caution #4 twin).
    expect(captured).toEqual([]);
  });
});

// ===========================================================================
// ADDITIVE (B5 Caution #13): facade-local delegation contracts. These do
// NOT substitute for any translated Python assertion — they lock the
// seams Python's wire-level suite cannot observe: which client method
// each member calls, the request-body dump spelling, the `endpoint=`
// string carried into `validate_response_model(s)`, and the guard code.
// ===========================================================================

/** One recorded delegation call. */
interface DelegationCall {
  /** The client method name. */
  readonly method: string;
  /** The positional arguments, verbatim. */
  readonly args: readonly unknown[];
}

/**
 * A client stub recording every W8 schema-registry call.
 *
 * @param returns - Per-method canned return values.
 * @returns The stub plus its call log.
 */
function delegationStub(returns: Readonly<Record<string, unknown>>): {
  client: MixpanelClient;
  calls: DelegationCall[];
} {
  const calls: DelegationCall[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]): Promise<unknown> => {
      calls.push({ method, args });
      return Promise.resolve(returns[method]);
    };
  const stub = {
    listSchemaRegistry: record("listSchemaRegistry"),
    createSchema: record("createSchema"),
    createSchemasBulk: record("createSchemasBulk"),
    updateSchema: record("updateSchema"),
    updateSchemasBulk: record("updateSchemasBulk"),
    deleteSchemas: record("deleteSchemas"),
  };
  return { client: stub as unknown as MixpanelClient, calls };
}

describe("ADDITIVE: schema-registry delegation contracts", () => {
  it("listSchemaRegistry forwards the options bag verbatim", async () => {
    const { client, calls } = delegationStub({ listSchemaRegistry: [] });

    await listSchemaRegistryMember(client, { entity_type: "profile" });
    await listSchemaRegistryMember(client);

    expect(calls).toEqual([
      { method: "listSchemaRegistry", args: [{ entity_type: "profile" }] },
      { method: "listSchemaRegistry", args: [{ entity_type: null }] },
    ]);
  });

  it("createSchema/updateSchema forward all three positionals verbatim", async () => {
    const { client, calls } = delegationStub({
      createSchema: { ok: 1 },
      updateSchema: { ok: 2 },
    });
    const schema = { properties: { a: { type: "string" } } };

    await createSchemaMember(client, "event", "Purchase", schema);
    await updateSchemaMember(client, "profile", "$user", schema);

    expect(calls).toEqual([
      { method: "createSchema", args: ["event", "Purchase", schema] },
      { method: "updateSchema", args: ["profile", "$user", schema] },
    ]);
  });

  it("the bulk writers dump with exclude_none + by_alias (:8754, :8824)", async () => {
    const { client, calls } = delegationStub({
      createSchemasBulk: { added: 1, deleted: 0 },
      updateSchemasBulk: [],
    });
    const params = new BulkCreateSchemasParams({
      entries: [
        new SchemaEntry({
          entity_type: "event",
          name: "Test",
          schema_definition: { properties: {} },
        }),
      ],
    });

    await createSchemasBulkMember(client, params);
    await updateSchemasBulkMember(client, params);

    // `truncate`/`entity_type`/`version` are None and DROP; the kept
    // keys carry their camelCase aliases, recursively into each entry.
    const expected = {
      entries: [
        { entityType: "event", name: "Test", schemaJson: { properties: {} } },
      ],
    };
    expect(calls.map((call) => call.args[0])).toEqual([expected, expected]);
  });

  it("deleteSchemas forwards both filters and never pre-shapes", async () => {
    const { client, calls } = delegationStub({
      deleteSchemas: { deleteCount: 3 },
    });

    const result = await deleteSchemasMember(client, {
      entity_type: "event",
      entity_name: "Purchase",
    });

    expect(calls).toEqual([
      {
        method: "deleteSchemas",
        args: [{ entity_type: "event", entity_name: "Purchase" }],
      },
    ]);
    expect(result.delete_count).toBe(3);
  });

  it("the guard raises code UNKNOWN_ERROR before the client is touched", async () => {
    const { client, calls } = delegationStub({ deleteSchemas: {} });

    await expect(
      deleteSchemasMember(client, { entity_name: "Purchase" }),
    ).rejects.toMatchObject({ code: "UNKNOWN_ERROR" });
    expect(calls).toEqual([]);
  });

  it("malformed 200 payloads surface RESPONSE_VALIDATION_ERROR", async () => {
    const { ws } = makeWorkspace(() => ok({}));

    await expect(ws.deleteSchemas()).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
    await expect(ws.deleteSchemas()).rejects.toMatchObject({
      code: "RESPONSE_VALIDATION_ERROR",
      details: { model: "DeleteSchemasResponse" },
    });
  });

  it("list/bulk validation failures name their own model", async () => {
    const list = makeWorkspace(() => ok([{ name: "no-entity-type" }]));
    await expect(list.ws.listSchemaRegistry()).rejects.toMatchObject({
      code: "RESPONSE_VALIDATION_ERROR",
      details: { model: "SchemaEntry" },
    });

    const bulk = makeWorkspace(() => ok([{ name: "x" }]));
    await expect(
      bulk.ws.updateSchemasBulk(new BulkCreateSchemasParams({ entries: [] })),
    ).rejects.toMatchObject({
      code: "RESPONSE_VALIDATION_ERROR",
      details: { model: "BulkPatchResult" },
    });
  });
});
