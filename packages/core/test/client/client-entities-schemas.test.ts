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
} from "../../test-support/client-test-helpers.js";

/** The `oauth_credentials` fixture twin. */
function oauthCredentials(): Session {
  return makeSession({
    projectId: "12345",
    region: "us",
    oauthToken: "test-oauth-token",
  });
}

/** Parse a captured JSON request body (json.loads(request.content)). */
function parseBody(bodyText: string): unknown {
  return JSON.parse(bodyText) as unknown;
}

describe("TestListSchemaRegistry", () => {
  it("test_returns_list_all_schemas", async () => {
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

  it("test_returns_list_filtered_by_entity_type", async () => {
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

  it("test_uses_base_path_when_no_entity_type", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listSchemaRegistry();
    const path = capturedUrls[0]?.split("?", 1)[0] ?? "";
    expect(path.replace(/\/+$/, "").endsWith("schemas")).toBe(true);
  });

  it("test_uses_entity_type_path_segment", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listSchemaRegistry({ entity_type: "event" });
    expect(capturedUrls[0]).toContain("/schemas/event");
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listSchemaRegistry();
    expect(capturedMethods[0]).toBe("GET");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listSchemaRegistry();
    expect(capturedUrls[0]).toContain("/projects/12345/");
  });

  it("test_empty_result", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    const result = await client.listSchemaRegistry();
    expect(result).toStrictEqual([]);
  });
});

describe("TestCreateSchema", () => {
  it("test_returns_created_schema", async () => {
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

  it("test_path_includes_entity_type_and_name", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.createSchema("event", "Purchase", { properties: {} });
    expect(capturedUrls[0]).toContain("/schemas/event/Purchase");
  });

  it("test_special_chars_percent_encoded", async () => {
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

  it("test_uses_post_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.createSchema("event", "Signup", { properties: {} });
    expect(capturedMethods[0]).toBe("POST");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.createSchema("event", "Signup", { properties: {} });
    expect(capturedUrls[0]).toContain("/projects/12345/");
  });

  it("test_sends_schema_json_in_body", async () => {
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

describe("TestCreateSchemasBulk", () => {
  it("test_returns_added_and_deleted_counts", async () => {
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

  it("test_truncate_mode", async () => {
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

  it("test_empty_entries", async () => {
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

  it("test_truncate_with_empty_entries", async () => {
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

  it("test_duplicate_entries", async () => {
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

  it("test_uses_base_schemas_path", async () => {
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

  it("test_uses_post_method", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
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

describe("TestUpdateSchema", () => {
  it("test_returns_updated_schema", async () => {
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

  it("test_path_includes_entity_type_and_name", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.updateSchema("event", "Purchase", { properties: {} });
    expect(capturedUrls[0]).toContain("/schemas/event/Purchase");
  });

  it("test_uses_patch_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.updateSchema("event", "Signup", { properties: {} });
    expect(capturedMethods[0]).toBe("PATCH");
  });

  it("test_sends_schema_json_in_body", async () => {
    const capturedBodies: unknown[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedBodies.push(parseBody(request.bodyText));
      return { status: 200, json: { status: "ok", results: {} } };
    });
    const schema = { properties: { plan: { type: "string" } } };
    await client.updateSchema("event", "Signup", schema);
    expect(capturedBodies[0]).toStrictEqual(schema);
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.updateSchema("event", "Signup", { properties: {} });
    expect(capturedUrls[0]).toContain("/projects/12345/");
  });
});

describe("TestUpdateSchemasBulk", () => {
  it("test_returns_list_of_results", async () => {
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

  it("test_mixed_ok_and_error_results", async () => {
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

  it("test_uses_base_schemas_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.updateSchemasBulk({ entries: [] });
    const path = capturedUrls[0]?.split("?", 1)[0] ?? "";
    expect(path.replace(/\/+$/, "").endsWith("schemas")).toBe(true);
  });

  it("test_uses_patch_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.updateSchemasBulk({ entries: [] });
    expect(capturedMethods[0]).toBe("PATCH");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.updateSchemasBulk({ entries: [] });
    expect(capturedUrls[0]).toContain("/projects/12345/");
  });
});

describe("TestDeleteSchemas", () => {
  it("test_delete_all_schemas", async () => {
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

  it("test_delete_by_entity_type", async () => {
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

  it("test_delete_by_entity_type_and_name", async () => {
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

  it("test_delete_all_path", async () => {
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

  it("test_delete_with_entity_name_only_raises", async () => {
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

  it("test_uses_delete_method", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
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

describe("TestCreateSchemaAlreadyExists", () => {
  it("test_api_error_for_existing_schema", async () => {
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

describe("TestCreateSchemasBulkDuplicateEntries", () => {
  it("test_sends_duplicates_to_api", async () => {
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
