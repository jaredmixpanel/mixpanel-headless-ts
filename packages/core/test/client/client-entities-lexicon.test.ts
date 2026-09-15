// Lexicon client methods: event/property definitions (get/update/delete/
// bulk update), lexicon tags, tracking metadata, event/property history and
// export, plus the async string-response error path. Mirrors the lexicon
// classes of tests/unit/test_api_client_data_governance.py; the module's
// other domains live in the sibling `client-entities-*` files.

import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import { toNativeJson } from "../../src/client/json-value.js";
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

// --- Data definitions ---

describe("Get event definitions", () => {
  // python: TestGetEventDefinitions
  it("returns list", async () => {
    // python: test_returns_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          { name: "Signup", description: "User signed up" },
          { name: "Login", description: "User logged in" },
        ],
      },
    }));
    const result = toNativeJson(
      await client.getEventDefinitions(["Signup", "Login"]),
    ) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(2);
    expect(result[0]?.["name"]).toBe("Signup");
    expect(result[1]?.["name"]).toBe("Login");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.getEventDefinitions(["Signup"]);
    expect(capturedUrls[0]).toContain("/data-definitions/events/");
  });

  it("query params", async () => {
    // python: test_query_params
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.getEventDefinitions(["Signup", "Login"]);
    const url = capturedUrls[0] ?? "";
    expect(
      url.includes("name%5B%5D=Signup") || url.includes("name[]=Signup"),
    ).toBe(true);
  });

  it("uses get method", async () => {
    // python: test_uses_get_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.getEventDefinitions(["Signup"]);
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("Update event definition", () => {
  // python: TestUpdateEventDefinition
  it("returns dict", async () => {
    // python: test_returns_dict
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { name: "Signup", description: "Updated" },
        },
      };
    });
    const result = toNativeJson(
      await client.updateEventDefinition("Signup", { description: "Updated" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(result["description"]).toBe("Updated");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { name: "Signup" } },
      };
    });
    await client.updateEventDefinition("Signup", { event_name: "Signup" });
    expect(capturedUrls[0]).toContain("/data-definitions/events/");
  });
});

describe("Delete event definition", () => {
  // python: TestDeleteEventDefinition
  it("returns null", async () => {
    // python: test_returns_none
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteEventDefinition("Signup");
    expect(captured[0]?.[0]).toBe("DELETE");
    expect(captured[0]?.[1]).toStrictEqual({ name: "Signup" });
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteEventDefinition("Signup");
    expect(capturedUrls[0]).toContain("/data-definitions/events/");
  });
});

describe("Bulk update event definitions", () => {
  // python: TestBulkUpdateEventDefinitions
  it("returns list", async () => {
    // python: test_returns_list
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: [{ name: "Signup" }, { name: "Login" }],
        },
      };
    });
    const result = toNativeJson(
      await client.bulkUpdateEventDefinitions({
        events: [
          { event_name: "Signup", description: "Sign up" },
          { event_name: "Login", description: "Log in" },
        ],
      }),
    ) as unknown[];
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(result).toHaveLength(2);
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.bulkUpdateEventDefinitions({ events: [] });
    expect(capturedUrls[0]).toContain("/data-definitions/events/");
  });
});

describe("Get property definitions", () => {
  // python: TestGetPropertyDefinitions
  it("returns list", async () => {
    // python: test_returns_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [{ name: "plan_type" }, { name: "age" }],
      },
    }));
    const result = toNativeJson(
      await client.getPropertyDefinitions(["plan_type", "age"]),
    ) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(2);
    expect(result[0]?.["name"]).toBe("plan_type");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.getPropertyDefinitions(["plan_type"]);
    expect(capturedUrls[0]).toContain("/data-definitions/properties/");
  });

  it("resource type param", async () => {
    // python: test_resource_type_param
    // The App API honors only camelCase `resourceType` with a
    // capitalized value; the lowercase "event" is normalized to
    // "Event" (`_canonical_resource_type`).
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.getPropertyDefinitions(["plan_type"], "event");
    expect(capturedUrls[0]).toContain("resourceType=Event");
    expect(capturedUrls[0]).not.toContain("resource_type=event");
  });
});

describe("Update property definition", () => {
  // python: TestUpdatePropertyDefinition
  it("returns dict", async () => {
    // python: test_returns_dict
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { name: "plan_type", description: "Updated" },
        },
      };
    });
    const result = toNativeJson(
      await client.updatePropertyDefinition("plan_type", {
        description: "Updated",
      }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(result["description"]).toBe("Updated");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { name: "plan_type" } },
      };
    });
    await client.updatePropertyDefinition("plan_type", { name: "plan_type" });
    expect(capturedUrls[0]).toContain("/data-definitions/properties/");
  });
});

describe("Bulk update property definitions", () => {
  // python: TestBulkUpdatePropertyDefinitions
  it("returns list", async () => {
    // python: test_returns_list
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: [{ name: "plan_type" }] },
      };
    });
    const result = toNativeJson(
      await client.bulkUpdatePropertyDefinitions({
        properties: [{ property_name: "plan_type", description: "Plan" }],
      }),
    ) as unknown[];
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(result).toHaveLength(1);
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.bulkUpdatePropertyDefinitions({ properties: [] });
    expect(capturedUrls[0]).toContain("/data-definitions/properties/");
  });
});

describe("List lexicon tags", () => {
  // python: TestListLexiconTags
  it("returns list", async () => {
    // python: test_returns_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          { id: 1, name: "core" },
          { id: 2, name: "deprecated" },
        ],
      },
    }));
    const result = toNativeJson(await client.listLexiconTags()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["name"]).toBe("core");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listLexiconTags();
    expect(capturedUrls[0]).toContain("/data-definitions/tags/");
  });

  it("uses get method", async () => {
    // python: test_uses_get_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listLexiconTags();
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("Create lexicon tag", () => {
  // python: TestCreateLexiconTag
  it("returns dict", async () => {
    // python: test_returns_dict
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: { id: 10, name: "new-tag" } },
      };
    });
    const result = toNativeJson(
      await client.createLexiconTag({ name: "new-tag" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(result["id"]).toBe(10);
    expect(result["name"]).toBe("new-tag");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { id: 1, name: "x" } },
      };
    });
    await client.createLexiconTag({ name: "x" });
    expect(capturedUrls[0]).toContain("/data-definitions/tags/");
  });
});

describe("Update lexicon tag", () => {
  // python: TestUpdateLexiconTag
  it("returns dict", async () => {
    // python: test_returns_dict
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: { id: 5, name: "renamed-tag" } },
      };
    });
    const result = toNativeJson(
      await client.updateLexiconTag(5, { name: "renamed-tag" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(result["name"]).toBe("renamed-tag");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { id: 5, name: "x" } },
      };
    });
    await client.updateLexiconTag(5, { name: "x" });
    expect(capturedUrls[0]).toContain("/data-definitions/tags/5/");
  });
});

describe("Delete lexicon tag", () => {
  // python: TestDeleteLexiconTag
  it("returns null", async () => {
    // python: test_returns_none
    // Tag deletion is a POST with `{"delete": True, "name": ...}` —
    // the API uses POST, not DELETE, for tag removal.
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteLexiconTag("old-tag");
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]).toStrictEqual({ delete: true, name: "old-tag" });
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteLexiconTag("old-tag");
    expect(capturedUrls[0]).toContain("/data-definitions/tags/");
  });
});

describe("Get tracking metadata", () => {
  // python: TestGetTrackingMetadata
  it("returns dict", async () => {
    // python: test_returns_dict
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: { event_name: "Signup", is_tracked: true },
      },
    }));
    const result = toNativeJson(
      await client.getTrackingMetadata("Signup"),
    ) as Record<string, unknown>;
    expect(result["event_name"]).toBe("Signup");
    expect(result["is_tracked"]).toBe(true);
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.getTrackingMetadata("Signup");
    expect(capturedUrls[0]).toContain(
      "/data-definitions/events/tracking-metadata/",
    );
    expect(capturedUrls[0]).toContain("event_name=Signup");
  });
});

describe("Get event history", () => {
  // python: TestGetEventHistory
  it("returns list", async () => {
    // python: test_returns_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [{ action: "created" }, { action: "updated" }],
      },
    }));
    const result = toNativeJson(
      await client.getEventHistory("Signup"),
    ) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(2);
    expect(result[0]?.["action"]).toBe("created");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.getEventHistory("Signup");
    expect(capturedUrls[0]).toContain(
      "/data-definitions/events/Signup/history/",
    );
  });
});

describe("Get property history", () => {
  // python: TestGetPropertyHistory
  it("returns list", async () => {
    // python: test_returns_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [{ action: "created" }] },
    }));
    const result = toNativeJson(
      await client.getPropertyHistory("plan_type", "event"),
    ) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(1);
    expect(result[0]?.["action"]).toBe("created");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.getPropertyHistory("plan_type", "event");
    expect(capturedUrls[0]).toContain(
      "/data-definitions/properties/plan_type/history/",
    );
    expect(capturedUrls[0]).toContain("entity_type=event");
  });
});

describe("Export lexicon", () => {
  // python: TestExportLexicon
  it("returns dict", async () => {
    // python: test_returns_dict
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          events: [{ name: "Signup" }],
          properties: [{ name: "plan_type" }],
        },
      },
    }));
    const result = toNativeJson(await client.exportLexicon()) as Record<
      string,
      unknown
    >;
    expect(Object.keys(result)).toContain("events");
    expect(Object.keys(result)).toContain("properties");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.exportLexicon();
    expect(capturedUrls[0]).toContain("/data-definitions/export/");
  });

  it("export types param", async () => {
    // python: test_export_types_param
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.exportLexicon(["All Events and Properties"]);
    const url = capturedUrls[0] ?? "";
    expect(url).toContain("export_type=");
    expect(url).toContain("All"); // JSON-encoded value in URL
  });

  it("uses get method", async () => {
    // python: test_uses_get_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.exportLexicon();
    expect(capturedMethods[0]).toBe("GET");
  });
});

// --- Error paths ---

describe("Export lexicon async string response", () => {
  // python: TestExportLexiconAsyncStringResponse
  it("export lexicon async string response", async () => {
    // python: test_export_lexicon_async_string_response
    // A plain-string `results` (async export status) wraps into
    // `{status: "pending", message: ...}`.
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: "Export in progress" },
    }));
    const result = toNativeJson(await client.exportLexicon());
    expect(result).toStrictEqual({
      status: "pending",
      message: "Export in progress",
    });
  });
});
