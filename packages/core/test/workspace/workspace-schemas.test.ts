// Workspace schema-registry members (list, create, bulk create, update, bulk
// update, delete) over the injected fetch seam. Mirrors all six classes of
// tests/unit/test_workspace_schemas.py. Additive: the facade-to-client
// delegation contracts the wire suite cannot see — argument spelling, the
// exclude_none + by_alias dump, `endpoint=` strings and the response-validation seam.

import { describe, expect, it } from "vitest";

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
import {
  type CapturedFetchRequest,
  ok,
} from "../../test-support/client-test-helpers.js";
import { makeFacadeWorkspace } from "../../test-support/workspace-test-helpers.js";

/**
 * A minimal schema entry dict matching the API shape
 * (`_schema_entry_json`).
 *
 * @param entityType - Entity type ("event", "custom_event", "profile").
 * @param name - Entity name.
 * @param schemaDefinition - JSON Schema definition (Python default).
 * @param version - Schema version, or `null` to omit the key.
 * @returns The payload record.
 */
function schemaEntryJson(
  entityType = "event",
  name = "Purchase",
  schemaDefinition?: Record<string, unknown>,
  version: string | null = "2025-01-15",
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    entityType,
    name,
    schemaJson: schemaDefinition ?? {
      properties: { amount: { type: "number" } },
      required: ["amount"],
    },
  };
  if (version !== null) {
    result["version"] = version;
  }
  return result;
}

// --- listSchemaRegistry (TestListSchemaRegistry) ---

describe("Workspace.listSchemaRegistry", () => {
  it("returns all schemas as SchemaEntry list", async () => {
    const { ws } = makeFacadeWorkspace(() =>
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

  it("returns empty list when no schemas exist", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));

    await expect(ws.listSchemaRegistry()).resolves.toStrictEqual([]);
  });

  it("passes the entity_type filter to the API", async () => {
    const capturedUrl: string[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
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

  it("preserves the schemaJson field content", async () => {
    const customSchema = {
      type: "object",
      properties: {
        amount: { type: "number" },
        currency: { type: "string", enum: ["USD", "EUR"] },
      },
      required: ["amount", "currency"],
    };
    const { ws } = makeFacadeWorkspace(() =>
      ok([schemaEntryJson("event", "Purchase", customSchema)]),
    );

    const schemas = await ws.listSchemaRegistry();

    expect(schemas).toHaveLength(1);
    expect(schemas[0]?.schema_definition).toStrictEqual(customSchema);
  });

  it("preserves the version field", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([schemaEntryJson("event", "Purchase", undefined, "2025-03-20")]),
    );

    const schemas = await ws.listSchemaRegistry();

    expect(schemas[0]?.version).toBe("2025-03-20");
  });

  it("preserves unknown fields (extra='allow', :271)", async () => {
    const entry = schemaEntryJson("event", "Purchase");
    entry["customField"] = "extra-value";
    const { ws } = makeFacadeWorkspace(() => ok([entry]));

    const schemas = await ws.listSchemaRegistry();

    expect(schemas).toHaveLength(1);
    expect(schemas[0]?.__extras["customField"]).toBe("extra-value");
  });
});

// --- createSchema (TestCreateSchema) ---

describe("Workspace.createSchema", () => {
  it("returns the raw dict from the API", async () => {
    const schemaDef = {
      properties: { amount: { type: "number" } },
      required: ["amount"],
    };
    const { ws } = makeFacadeWorkspace(() =>
      ok({ entityType: "event", name: "Purchase", schemaJson: schemaDef }),
    );

    const result = await ws.createSchema("event", "Purchase", schemaDef);

    expect(result).toBeTypeOf("object");
    expect(result["entityType"]).toBe("event");
    expect(result["name"]).toBe("Purchase");
  });

  it("constructs the correct API path", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
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

  it("percent-encodes entity names with special chars", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      captured.push(request);
      return ok({ entityType: "event", name: "My Event / Test" });
    });

    await ws.createSchema("event", "My Event / Test", { properties: {} });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).not.toContain("My Event / Test");
  });
});

// --- createSchemasBulk (TestCreateSchemasBulk) ---

describe("Workspace.createSchemasBulk", () => {
  it("returns a BulkCreateSchemasResponse", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({ added: 3, deleted: 0 }));
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

  it("reports the deleted count with truncate=True", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({ added: 2, deleted: 5 }));
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

  it("returns zero counts for empty entries", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({ added: 0, deleted: 0 }));

    const result = await ws.createSchemasBulk(
      new BulkCreateSchemasParams({ entries: [] }),
    );

    expect(result).toBeInstanceOf(BulkCreateSchemasResponse);
    expect(result.added).toBe(0);
    expect(result.deleted).toBe(0);
  });

  it("sends POST to the schemas endpoint", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
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

// --- updateSchema (TestUpdateSchema) ---

describe("Workspace.updateSchema", () => {
  it("returns the raw dict from the API", async () => {
    const { ws } = makeFacadeWorkspace(() =>
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

  it("sends PATCH to the correct path", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      captured.push(request);
      return ok({ entityType: "event", name: "Purchase" });
    });

    await ws.updateSchema("event", "Purchase", { properties: {} });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe("PATCH");
    expect(captured[0]?.url).toContain("schemas/event/Purchase");
  });

  it("percent-encodes $user for profile schemas", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      captured.push(request);
      return ok({ entityType: "profile", name: "$user" });
    });

    await ws.updateSchema("profile", "$user", { properties: {} });

    expect(captured).toHaveLength(1);
    const url = captured[0]?.url ?? "";
    expect(!url.includes("$user") || url.includes("%24user")).toBe(true);
  });
});

// --- updateSchemasBulk (TestUpdateSchemasBulk) ---

describe("Workspace.updateSchemasBulk", () => {
  it("returns a list of BulkPatchResult", async () => {
    const { ws } = makeFacadeWorkspace(() =>
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

  it("returns error status for failed entries", async () => {
    const { ws } = makeFacadeWorkspace(() =>
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

  it("returns an empty list for empty entries", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));

    const results = await ws.updateSchemasBulk(
      new BulkCreateSchemasParams({ entries: [] }),
    );

    expect(results).toStrictEqual([]);
  });

  it("sends PATCH to the schemas endpoint", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      captured.push(request);
      return ok([]);
    });

    await ws.updateSchemasBulk(new BulkCreateSchemasParams({ entries: [] }));

    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe("PATCH");
    expect(captured[0]?.url).toContain("schemas");
  });
});

// --- deleteSchemas (TestDeleteSchemas) ---

describe("Workspace.deleteSchemas", () => {
  it("deletes all and returns the count with no args", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({ deleteCount: 10 }));

    const result = await ws.deleteSchemas();

    expect(result).toBeInstanceOf(DeleteSchemasResponse);
    expect(result.delete_count).toBe(10);
  });

  it("deletes all schemas of one entity type", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
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

  it("deletes a single schema by type + name", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
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

  it("returns a zero count when nothing matches", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({ deleteCount: 0 }));

    const result = await ws.deleteSchemas({ entity_type: "custom_event" });

    expect(result).toBeInstanceOf(DeleteSchemasResponse);
    expect(result.delete_count).toBe(0);
  });

  it("sends the DELETE HTTP method", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      captured.push(request);
      return ok({ deleteCount: 0 });
    });

    await ws.deleteSchemas();

    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe("DELETE");
  });

  it("raises when entity_name is given without entity_type", async () => {
    const captured: CapturedFetchRequest[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      captured.push(request);
      return ok({ deleteCount: 0 });
    });

    // `pytest.raises(MixpanelHeadlessError, match="entity_name requires
    // entity_type")` — the class is the contract; the message is
    // additionally asserted because Python's `match=` does.
    await expect(
      ws.deleteSchemas({ entity_name: "Purchase" }),
    ).rejects.toBeInstanceOf(MixpanelHeadlessError);
    await expect(ws.deleteSchemas({ entity_name: "Purchase" })).rejects.toThrow(
      /entity_name requires entity_type/,
    );
    // The guard fires before any request.
    expect(captured).toStrictEqual([]);
  });
});

// --- Additive: facade-local delegation contracts Python's wire suite cannot
// observe — which client method each member calls, the request-body dump
// spelling, the `endpoint=` string carried into `validate_response_model(s)`,
// and the guard code ---

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

    expect(calls).toStrictEqual([
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

    expect(calls).toStrictEqual([
      { method: "createSchema", args: ["event", "Purchase", schema] },
      { method: "updateSchema", args: ["profile", "$user", schema] },
    ]);
  });

  it("the bulk writers dump with exclude_none + by_alias", async () => {
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
    expect(calls.map((call) => call.args[0])).toStrictEqual([
      expected,
      expected,
    ]);
  });

  it("deleteSchemas forwards both filters and never pre-shapes", async () => {
    const { client, calls } = delegationStub({
      deleteSchemas: { deleteCount: 3 },
    });

    const result = await deleteSchemasMember(client, {
      entity_type: "event",
      entity_name: "Purchase",
    });

    expect(calls).toStrictEqual([
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
    expect(calls).toStrictEqual([]);
  });

  it("malformed 200 payloads surface RESPONSE_VALIDATION_ERROR", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));

    await expect(ws.deleteSchemas()).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
    await expect(ws.deleteSchemas()).rejects.toMatchObject({
      code: "RESPONSE_VALIDATION_ERROR",
      details: { model: "DeleteSchemasResponse" },
    });
  });

  it("list/bulk validation failures name their own model", async () => {
    const list = makeFacadeWorkspace(() => ok([{ name: "no-entity-type" }]));
    await expect(list.ws.listSchemaRegistry()).rejects.toMatchObject({
      code: "RESPONSE_VALIDATION_ERROR",
      details: { model: "SchemaEntry" },
    });

    const bulk = makeFacadeWorkspace(() => ok([{ name: "x" }]));
    await expect(
      bulk.ws.updateSchemasBulk(new BulkCreateSchemasParams({ entries: [] })),
    ).rejects.toMatchObject({
      code: "RESPONSE_VALIDATION_ERROR",
      details: { model: "BulkPatchResult" },
    });
  });
});
