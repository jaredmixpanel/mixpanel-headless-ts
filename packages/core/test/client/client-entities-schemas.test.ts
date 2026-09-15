// Layer-3 translation — Phase-3 packet B4-C5 schema-registry locks.
// Source: tests/unit/test_api_client_schemas.py (ALL classes — registry
// list/create/create-bulk/update/update-bulk/delete + percent-encoding
// + duplicate-entry edge cases).
import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import { toNativeJson } from "../../src/client/json-value.js";
import { MixpanelHeadlessError } from "../../src/errors.js";
import {
  createMockClient,
  makeSession,
  parseBody,
} from "../../test-support/client-test-helpers.js";

/** The `oauth_credentials` fixture twin. */
function oauthCredentials(): Session {
  return makeSession({
    projectId: "12345",
    region: "us",
    oauthToken: "test-oauth-token",
  });
}

describe("List schema registry", () => {
  // python: TestListSchemaRegistry
  it("returns list all schemas", async () => {
    // python: test_returns_list_all_schemas
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          {
            entity_type: "event",
            entity_name: "Signup",
            schema: { properties: { plan: { type: "string" } } },
          },
          {
            entity_type: "profile",
            entity_name: "$name",
            schema: { type: "string" },
          },
        ],
      },
    }));
    const result = toNativeJson(await client.listSchemaRegistry()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["entity_type"]).toBe("event");
    expect(result[1]?.["entity_type"]).toBe("profile");
  });

  it("returns list filtered by entity type", async () => {
    // python: test_returns_list_filtered_by_entity_type
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          {
            entity_type: "event",
            entity_name: "Signup",
            schema: { properties: {} },
          },
        ],
      },
    }));
    const result = toNativeJson(
      await client.listSchemaRegistry({ entity_type: "event" }),
    ) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(1);
    expect(result[0]?.["entity_type"]).toBe("event");
  });

  it("uses base path when no entity type", async () => {
    // python: test_uses_base_path_when_no_entity_type
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listSchemaRegistry();
    const path = capturedUrls[0]?.split("?", 1)[0] ?? "";
    expect(path.replace(/\/+$/, "").endsWith("schemas")).toBe(true);
  });

  it("uses entity type path segment", async () => {
    // python: test_uses_entity_type_path_segment
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listSchemaRegistry({ entity_type: "event" });
    expect(capturedUrls[0]).toContain("/schemas/event");
  });

  it("uses get method", async () => {
    // python: test_uses_get_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listSchemaRegistry();
    expect(capturedMethods[0]).toBe("GET");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listSchemaRegistry();
    expect(capturedUrls[0]).toContain("/projects/12345/");
  });

  it("empty result", async () => {
    // python: test_empty_result
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    const result = await client.listSchemaRegistry();
    expect(result).toStrictEqual([]);
  });
});

describe("Create schema", () => {
  // python: TestCreateSchema
  it("returns created schema", async () => {
    // python: test_returns_created_schema
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: {
            entity_type: "event",
            entity_name: "Purchase",
            schema: { properties: { amount: { type: "number" } } },
          },
        },
      };
    });
    const result = toNativeJson(
      await client.createSchema("event", "Purchase", {
        properties: { amount: { type: "number" } },
      }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(result["entity_name"]).toBe("Purchase");
    expect(
      (
        result["schema"] as Record<
          string,
          Record<string, Record<string, unknown>>
        >
      )["properties"]?.["amount"]?.["type"],
    ).toBe("number");
  });

  it("path includes entity type and name", async () => {
    // python: test_path_includes_entity_type_and_name
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.createSchema("event", "Purchase", { properties: {} });
    expect(capturedUrls[0]).toContain("/schemas/event/Purchase");
  });

  it("special chars percent encoded", async () => {
    // python: test_special_chars_percent_encoded
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.createSchema("event", "User Sign Up / Login", {
      properties: {},
    });
    const url = capturedUrls[0] ?? "";
    // The entity name should be percent-encoded (spaces and slash).
    expect(decodeURIComponent(url)).toContain("User Sign Up / Login");
    // The raw URL should NOT contain literal spaces or unencoded
    // slashes in the name.
    const pathAfterSchemas =
      url.split("/schemas/", 2)[1]?.split("?", 1)[0] ?? "";
    expect(pathAfterSchemas).not.toContain(" ");
  });

  it("uses post method", async () => {
    // python: test_uses_post_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.createSchema("event", "Signup", { properties: {} });
    expect(capturedMethods[0]).toBe("POST");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.createSchema("event", "Signup", { properties: {} });
    expect(capturedUrls[0]).toContain("/projects/12345/");
  });

  it("sends schema JSON in body", async () => {
    // python: test_sends_schema_json_in_body
    const capturedBodies: unknown[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedBodies.push(parseBody(request.bodyText));
      return { status: 200, json: { status: "ok", results: {} } };
    });
    const schema = {
      properties: { plan: { type: "string" } },
      required: ["plan"],
    };
    await client.createSchema("event", "Signup", schema);
    expect(capturedBodies[0]).toStrictEqual(schema);
  });
});

describe("Create schemas bulk", () => {
  // python: TestCreateSchemasBulk
  it("returns added and deleted counts", async () => {
    // python: test_returns_added_and_deleted_counts
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: { added: 3, deleted: 0 } },
      };
    });
    const body = {
      entries: [
        {
          entity_type: "event",
          entity_name: "Signup",
          schema: { properties: {} },
        },
        {
          entity_type: "event",
          entity_name: "Login",
          schema: { properties: {} },
        },
        {
          entity_type: "event",
          entity_name: "Purchase",
          schema: { properties: {} },
        },
      ],
      truncate: false,
    };
    const result = toNativeJson(await client.createSchemasBulk(body)) as Record<
      string,
      unknown
    >;
    expect(captured[0]?.[0]).toBe("POST");
    expect(result["added"]).toBe(3);
    expect(result["deleted"]).toBe(0);
  });

  it("truncate mode", async () => {
    // python: test_truncate_mode
    const capturedBodies: Array<Record<string, unknown>> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedBodies.push(
        parseBody(request.bodyText) as Record<string, unknown>,
      );
      return {
        status: 200,
        json: { status: "ok", results: { added: 1, deleted: 5 } },
      };
    });
    const body = {
      entries: [
        {
          entity_type: "event",
          entity_name: "Signup",
          schema: { properties: {} },
        },
      ],
      truncate: true,
    };
    const result = toNativeJson(await client.createSchemasBulk(body)) as Record<
      string,
      unknown
    >;
    expect(capturedBodies[0]?.["truncate"]).toBe(true);
    expect(result["deleted"]).toBe(5);
    expect(result["added"]).toBe(1);
  });

  it("empty entries", async () => {
    // python: test_empty_entries
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { added: 0, deleted: 0 } },
    }));
    const result = toNativeJson(
      await client.createSchemasBulk({ entries: [], truncate: false }),
    ) as Record<string, unknown>;
    expect(result["added"]).toBe(0);
    expect(result["deleted"]).toBe(0);
  });

  it("truncate with empty entries", async () => {
    // python: test_truncate_with_empty_entries
    const capturedBodies: Array<Record<string, unknown>> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedBodies.push(
        parseBody(request.bodyText) as Record<string, unknown>,
      );
      return {
        status: 200,
        json: { status: "ok", results: { added: 0, deleted: 10 } },
      };
    });
    const result = toNativeJson(
      await client.createSchemasBulk({ entries: [], truncate: true }),
    ) as Record<string, unknown>;
    expect(capturedBodies[0]?.["truncate"]).toBe(true);
    expect(capturedBodies[0]?.["entries"]).toStrictEqual([]);
    expect(result["deleted"]).toBe(10);
  });

  it("duplicate entries", async () => {
    // python: test_duplicate_entries
    const capturedBodies: Array<Record<string, unknown>> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedBodies.push(
        parseBody(request.bodyText) as Record<string, unknown>,
      );
      return {
        status: 200,
        json: { status: "ok", results: { added: 1, deleted: 0 } },
      };
    });
    const entry = {
      entity_type: "event",
      entity_name: "Signup",
      schema: { properties: {} },
    };
    await client.createSchemasBulk({
      entries: [entry, entry],
      truncate: false,
    });
    expect(capturedBodies[0]?.["entries"]).toHaveLength(2);
  });

  it("uses base schemas path", async () => {
    // python: test_uses_base_schemas_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { added: 0, deleted: 0 } },
      };
    });
    await client.createSchemasBulk({ entries: [], truncate: false });
    const path = capturedUrls[0]?.split("?", 1)[0] ?? "";
    expect(path.replace(/\/+$/, "").endsWith("schemas")).toBe(true);
  });

  it("uses post method", async () => {
    // python: test_uses_post_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return {
        status: 200,
        json: { status: "ok", results: { added: 0, deleted: 0 } },
      };
    });
    await client.createSchemasBulk({ entries: [], truncate: false });
    expect(capturedMethods[0]).toBe("POST");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { added: 0, deleted: 0 } },
      };
    });
    await client.createSchemasBulk({ entries: [], truncate: false });
    expect(capturedUrls[0]).toContain("/projects/12345/");
  });
});

describe("Update schema", () => {
  // python: TestUpdateSchema
  it("returns updated schema", async () => {
    // python: test_returns_updated_schema
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: {
            entity_type: "event",
            entity_name: "Purchase",
            schema: {
              properties: {
                amount: { type: "number" },
                currency: { type: "string" },
              },
            },
          },
        },
      };
    });
    const result = toNativeJson(
      await client.updateSchema("event", "Purchase", {
        properties: {
          amount: { type: "number" },
          currency: { type: "string" },
        },
      }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(result["entity_name"]).toBe("Purchase");
    expect(
      Object.keys(
        (result["schema"] as Record<string, unknown>)["properties"] as Record<
          string,
          unknown
        >,
      ),
    ).toContain("currency");
  });

  it("path includes entity type and name", async () => {
    // python: test_path_includes_entity_type_and_name
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.updateSchema("event", "Purchase", { properties: {} });
    expect(capturedUrls[0]).toContain("/schemas/event/Purchase");
  });

  it("uses patch method", async () => {
    // python: test_uses_patch_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.updateSchema("event", "Signup", { properties: {} });
    expect(capturedMethods[0]).toBe("PATCH");
  });

  it("sends schema JSON in body", async () => {
    // python: test_sends_schema_json_in_body
    const capturedBodies: unknown[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedBodies.push(parseBody(request.bodyText));
      return { status: 200, json: { status: "ok", results: {} } };
    });
    const schema = { properties: { plan: { type: "string" } } };
    await client.updateSchema("event", "Signup", schema);
    expect(capturedBodies[0]).toStrictEqual(schema);
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.updateSchema("event", "Signup", { properties: {} });
    expect(capturedUrls[0]).toContain("/projects/12345/");
  });
});

describe("Update schemas bulk", () => {
  // python: TestUpdateSchemasBulk
  it("returns list of results", async () => {
    // python: test_returns_list_of_results
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: [
            { entity_type: "event", entity_name: "Signup", status: "ok" },
            { entity_type: "event", entity_name: "Login", status: "ok" },
          ],
        },
      };
    });
    const body = {
      entries: [
        {
          entity_type: "event",
          entity_name: "Signup",
          schema: { properties: {} },
        },
        {
          entity_type: "event",
          entity_name: "Login",
          schema: { properties: {} },
        },
      ],
    };
    const result = toNativeJson(await client.updateSchemasBulk(body)) as Array<
      Record<string, unknown>
    >;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(result).toHaveLength(2);
    expect(result[0]?.["status"]).toBe("ok");
  });

  it("mixed ok and error results", async () => {
    // python: test_mixed_ok_and_error_results
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          { entity_type: "event", entity_name: "Signup", status: "ok" },
          {
            entity_type: "event",
            entity_name: "NonExistent",
            status: "error",
            error: "Schema not found",
          },
        ],
      },
    }));
    const body = {
      entries: [
        {
          entity_type: "event",
          entity_name: "Signup",
          schema: { properties: {} },
        },
        {
          entity_type: "event",
          entity_name: "NonExistent",
          schema: { properties: {} },
        },
      ],
    };
    const result = toNativeJson(await client.updateSchemasBulk(body)) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["status"]).toBe("ok");
    expect(result[1]?.["status"]).toBe("error");
    expect(result[1]?.["error"]).toBe("Schema not found");
  });

  it("uses base schemas path", async () => {
    // python: test_uses_base_schemas_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.updateSchemasBulk({ entries: [] });
    const path = capturedUrls[0]?.split("?", 1)[0] ?? "";
    expect(path.replace(/\/+$/, "").endsWith("schemas")).toBe(true);
  });

  it("uses patch method", async () => {
    // python: test_uses_patch_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.updateSchemasBulk({ entries: [] });
    expect(capturedMethods[0]).toBe("PATCH");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.updateSchemasBulk({ entries: [] });
    expect(capturedUrls[0]).toContain("/projects/12345/");
  });
});

describe("Delete schemas", () => {
  // python: TestDeleteSchemas
  it("delete all schemas", async () => {
    // python: test_delete_all_schemas
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return {
        status: 200,
        json: { status: "ok", results: { delete_count: 15 } },
      };
    });
    const result = toNativeJson(await client.deleteSchemas()) as Record<
      string,
      unknown
    >;
    expect(capturedMethods[0]).toBe("DELETE");
    expect(result["delete_count"]).toBe(15);
  });

  it("delete by entity type", async () => {
    // python: test_delete_by_entity_type
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { delete_count: 5 } },
      };
    });
    const result = toNativeJson(
      await client.deleteSchemas({ entity_type: "event" }),
    ) as Record<string, unknown>;
    expect(capturedUrls[0]).toContain("/schemas/event");
    expect(result["delete_count"]).toBe(5);
  });

  it("delete by entity type and name", async () => {
    // python: test_delete_by_entity_type_and_name
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { delete_count: 1 } },
      };
    });
    const result = toNativeJson(
      await client.deleteSchemas({
        entity_type: "event",
        entity_name: "Signup",
      }),
    ) as Record<string, unknown>;
    expect(capturedUrls[0]).toContain("/schemas/event/Signup");
    expect(result["delete_count"]).toBe(1);
  });

  it("delete all path", async () => {
    // python: test_delete_all_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { delete_count: 0 } },
      };
    });
    await client.deleteSchemas();
    const path = capturedUrls[0]?.split("?", 1)[0] ?? "";
    expect(path.replace(/\/+$/, "").endsWith("schemas")).toBe(true);
  });

  it("delete with entity name only raises", async () => {
    // python: test_delete_with_entity_name_only_raises
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { delete_count: 0 } },
    }));
    await expect(
      client.deleteSchemas({ entity_name: "Signup" }),
    ).rejects.toBeInstanceOf(MixpanelHeadlessError);
    await expect(
      client.deleteSchemas({ entity_name: "Signup" }),
    ).rejects.toThrow("entity_name requires entity_type");
  });

  it("uses delete method", async () => {
    // python: test_uses_delete_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return {
        status: 200,
        json: { status: "ok", results: { delete_count: 0 } },
      };
    });
    await client.deleteSchemas();
    expect(capturedMethods[0]).toBe("DELETE");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { delete_count: 0 } },
      };
    });
    await client.deleteSchemas();
    expect(capturedUrls[0]).toContain("/projects/12345/");
  });
});

describe("Create schema already exists", () => {
  // python: TestCreateSchemaAlreadyExists
  it("API error for existing schema", async () => {
    // python: test_api_error_for_existing_schema
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 409,
      json: {
        status: "error",
        error: "Schema already exists for event 'Signup'",
      },
    }));
    await expect(
      client.createSchema("event", "Signup", { properties: {} }),
    ).rejects.toThrow("Schema already exists for event 'Signup'");
  });
});

describe("Create schemas bulk duplicate entries", () => {
  // python: TestCreateSchemasBulkDuplicateEntries
  it("sends duplicates to API", async () => {
    // python: test_sends_duplicates_to_api
    const capturedBodies: Array<Record<string, unknown>> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedBodies.push(
        parseBody(request.bodyText) as Record<string, unknown>,
      );
      return {
        status: 200,
        json: { status: "ok", results: { added: 1, deleted: 0 } },
      };
    });
    const entry = {
      entity_type: "event",
      entity_name: "Signup",
      schema: { properties: { plan: { type: "string" } } },
    };
    await client.createSchemasBulk({
      entries: [entry, entry, entry],
      truncate: false,
    });
    expect(capturedBodies[0]?.["entries"]).toHaveLength(3);
  });
});
