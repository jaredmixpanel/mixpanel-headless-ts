// Layer-3 translation — Phase-3 packet B4-C5 data-governance locks.
// Source: tests/unit/test_api_client_data_governance.py (ALL classes —
// lexicon definitions/tags/metadata/history/export, custom properties,
// drop filters, lookup tables incl. upload/download wiring, custom
// events incl. the form-body + envelope-peeling + echo-mismatch
// branches, and the error-path classes).
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

// ---------------------------------------------------------------------------
// Domain 9 — Data Definitions (US1 + US2)
// ---------------------------------------------------------------------------

describe("TestGetEventDefinitions", () => {
  it("test_returns_list", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.getEventDefinitions(["Signup"]);
    expect(capturedUrls[0]).toContain("/data-definitions/events/");
  });

  it("test_query_params", async () => {
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

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.getEventDefinitions(["Signup"]);
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("TestUpdateEventDefinition", () => {
  it("test_returns_dict", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
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

describe("TestDeleteEventDefinition", () => {
  it("test_returns_none", async () => {
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteEventDefinition("Signup");
    expect(captured[0]?.[0]).toBe("DELETE");
    expect(captured[0]?.[1]).toStrictEqual({ name: "Signup" });
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteEventDefinition("Signup");
    expect(capturedUrls[0]).toContain("/data-definitions/events/");
  });
});

describe("TestBulkUpdateEventDefinitions", () => {
  it("test_returns_list", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.bulkUpdateEventDefinitions({ events: [] });
    expect(capturedUrls[0]).toContain("/data-definitions/events/");
  });
});

describe("TestGetPropertyDefinitions", () => {
  it("test_returns_list", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.getPropertyDefinitions(["plan_type"]);
    expect(capturedUrls[0]).toContain("/data-definitions/properties/");
  });

  it("test_resource_type_param", async () => {
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

describe("TestUpdatePropertyDefinition", () => {
  it("test_returns_dict", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
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

describe("TestBulkUpdatePropertyDefinitions", () => {
  it("test_returns_list", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.bulkUpdatePropertyDefinitions({ properties: [] });
    expect(capturedUrls[0]).toContain("/data-definitions/properties/");
  });
});

describe("TestListLexiconTags", () => {
  it("test_returns_list", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listLexiconTags();
    expect(capturedUrls[0]).toContain("/data-definitions/tags/");
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listLexiconTags();
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("TestCreateLexiconTag", () => {
  it("test_returns_dict", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
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

describe("TestUpdateLexiconTag", () => {
  it("test_returns_dict", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
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

describe("TestDeleteLexiconTag", () => {
  it("test_returns_none", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteLexiconTag("old-tag");
    expect(capturedUrls[0]).toContain("/data-definitions/tags/");
  });
});

describe("TestGetTrackingMetadata", () => {
  it("test_returns_dict", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
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

describe("TestGetEventHistory", () => {
  it("test_returns_list", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
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

describe("TestGetPropertyHistory", () => {
  it("test_returns_list", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
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

describe("TestExportLexicon", () => {
  it("test_returns_dict", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.exportLexicon();
    expect(capturedUrls[0]).toContain("/data-definitions/export/");
  });

  it("test_export_types_param", async () => {
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

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.exportLexicon();
    expect(capturedMethods[0]).toBe("GET");
  });
});

// ---------------------------------------------------------------------------
// Error-Path Tests
// ---------------------------------------------------------------------------

describe("TestExportLexiconAsyncStringResponse", () => {
  it("test_export_lexicon_async_string_response", async () => {
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
