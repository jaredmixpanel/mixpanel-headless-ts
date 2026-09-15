// Layer-3 translation — Phase-3 packet B4-C5 data-governance locks.
// Source: tests/unit/test_api_client_data_governance.py (ALL classes —
// lexicon definitions/tags/metadata/history/export, custom properties,
// drop filters, lookup tables incl. upload/download wiring, custom
// events incl. the form-body + envelope-peeling + echo-mismatch
// branches, and the error-path classes).
import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import { toNativeJson } from "../../src/client/json-value.js";
import { MixpanelHeadlessError, QueryError } from "../../src/errors.js";
import {
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** The `oauth_credentials` fixture twin (:30-33). */
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

/** `urllib.parse.parse_qs` analog over a form-encoded body. */
function parseQs(bodyText: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of new URLSearchParams(bodyText)) {
    (out[key] ??= []).push(value);
  }
  return out;
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
    expect(captured[0]?.[1]).toEqual({ name: "Signup" });
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
    expect(captured[0]?.[1]).toEqual({ delete: true, name: "old-tag" });
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
// Domain 10 — Custom Properties (US4)
// ---------------------------------------------------------------------------

describe("TestListCustomProperties", () => {
  it("test_returns_list", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [{ name: "Lifetime Value" }, { name: "Engagement Score" }],
      },
    }));
    const result = toNativeJson(await client.listCustomProperties()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["name"]).toBe("Lifetime Value");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listCustomProperties();
    expect(capturedUrls[0]).toContain("/custom_properties/");
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listCustomProperties();
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("TestCreateCustomProperty", () => {
  it("test_returns_dict", async () => {
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: { id: "cp-new", name: "New Prop" } },
      };
    });
    const result = toNativeJson(
      await client.createCustomProperty({ name: "New Prop" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(result["id"]).toBe("cp-new");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: { id: "cp-1" } } };
    });
    await client.createCustomProperty({ name: "X" });
    expect(capturedUrls[0]).toContain("/custom_properties/");
  });
});

describe("TestGetCustomProperty", () => {
  it("test_returns_dict", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { id: "cp-42", name: "My Prop" } },
    }));
    const result = toNativeJson(
      await client.getCustomProperty("cp-42"),
    ) as Record<string, unknown>;
    expect(result["id"]).toBe("cp-42");
    expect(result["name"]).toBe("My Prop");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: { id: "cp-42" } } };
    });
    await client.getCustomProperty("cp-42");
    expect(capturedUrls[0]).toContain("/custom_properties/cp-42/");
  });
});

describe("TestUpdateCustomProperty", () => {
  it("test_returns_dict", async () => {
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: { id: "cp-42", name: "Updated Prop" } },
      };
    });
    const result = toNativeJson(
      await client.updateCustomProperty("cp-42", { name: "Updated Prop" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PUT");
    expect(result["name"]).toBe("Updated Prop");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: { id: "cp-42" } } };
    });
    await client.updateCustomProperty("cp-42", { name: "X" });
    expect(capturedUrls[0]).toContain("/custom_properties/cp-42/");
  });
});

describe("TestDeleteCustomProperty", () => {
  it("test_returns_none", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 204 };
    });
    await client.deleteCustomProperty("cp-42");
    expect(capturedMethods[0]).toBe("DELETE");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 204 };
    });
    await client.deleteCustomProperty("cp-42");
    expect(capturedUrls[0]).toContain("/custom_properties/cp-42/");
  });
});

describe("TestValidateCustomProperty", () => {
  it("test_returns_dict", async () => {
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return { status: 200, json: { status: "ok", results: { valid: true } } };
    });
    const result = toNativeJson(
      await client.validateCustomProperty({ name: "Test Prop" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(result["valid"]).toBe(true);
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: { valid: true } } };
    });
    await client.validateCustomProperty({ name: "X" });
    expect(capturedUrls[0]).toContain("/custom_properties/validate/");
  });
});

// ---------------------------------------------------------------------------
// Domain 11 — Drop Filters (US5)
// ---------------------------------------------------------------------------

describe("TestListDropFilters", () => {
  it("test_returns_list", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [{ event_name: "debug_event" }, { event_name: "test_event" }],
      },
    }));
    const result = toNativeJson(await client.listDropFilters()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["event_name"]).toBe("debug_event");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listDropFilters();
    expect(capturedUrls[0]).toContain("/data-definitions/events/drop-filters/");
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listDropFilters();
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("TestCreateDropFilter", () => {
  it("test_returns_list", async () => {
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: [{ event_name: "existing" }, { event_name: "new_filter" }],
        },
      };
    });
    const result = toNativeJson(
      await client.createDropFilter({ event_name: "new_filter" }),
    ) as unknown[];
    expect(captured[0]?.[0]).toBe("POST");
    expect(result).toHaveLength(2);
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.createDropFilter({ event_name: "x" });
    expect(capturedUrls[0]).toContain("/data-definitions/events/drop-filters/");
  });
});

describe("TestUpdateDropFilter", () => {
  it("test_returns_list", async () => {
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: [{ id: 1, event_name: "updated" }] },
      };
    });
    const result = toNativeJson(
      await client.updateDropFilter({ id: 1, event_name: "updated" }),
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
    await client.updateDropFilter({ id: 1 });
    expect(capturedUrls[0]).toContain("/data-definitions/events/drop-filters/");
  });
});

describe("TestDeleteDropFilter", () => {
  it("test_returns_list", async () => {
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: [{ id: 2, event_name: "remaining" }] },
      };
    });
    const result = toNativeJson(await client.deleteDropFilter(1)) as unknown[];
    expect(captured[0]?.[0]).toBe("DELETE");
    expect(captured[0]?.[1]).toEqual({ id: 1 });
    expect(result).toHaveLength(1);
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.deleteDropFilter(1);
    expect(capturedUrls[0]).toContain("/data-definitions/events/drop-filters/");
  });
});

describe("TestGetDropFilterLimits", () => {
  it("test_returns_dict", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { max_filters: 10, current_count: 3 } },
    }));
    const result = toNativeJson(await client.getDropFilterLimits()) as Record<
      string,
      unknown
    >;
    expect(result["max_filters"]).toBe(10);
    expect(result["current_count"]).toBe(3);
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.getDropFilterLimits();
    expect(capturedUrls[0]).toContain(
      "/data-definitions/events/drop-filters/limits/",
    );
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.getDropFilterLimits();
    expect(capturedMethods[0]).toBe("GET");
  });
});

// ---------------------------------------------------------------------------
// Domain 12 — Lookup Tables (US6)
// ---------------------------------------------------------------------------

describe("TestListLookupTables", () => {
  it("test_returns_list", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [{ name: "Plans" }, { name: "Countries" }],
      },
    }));
    const result = toNativeJson(await client.listLookupTables()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["name"]).toBe("Plans");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listLookupTables();
    expect(capturedUrls[0]).toContain("/data-definitions/lookup-tables/");
  });

  it("test_data_group_id_param", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listLookupTables({ data_group_id: 5 });
    expect(capturedUrls[0]).toContain("data-group-id=5");
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listLookupTables();
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("TestGetLookupUploadUrl", () => {
  it("test_returns_dict", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          url: "https://storage.googleapis.com/upload",
          path: "/uploads/abc",
          key: "abc-123",
        },
      },
    }));
    const result = toNativeJson(await client.getLookupUploadUrl()) as Record<
      string,
      unknown
    >;
    expect(Object.keys(result)).toContain("url");
    expect(Object.keys(result)).toContain("path");
    expect(Object.keys(result)).toContain("key");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { url: "", path: "", key: "" } },
      };
    });
    await client.getLookupUploadUrl();
    expect(capturedUrls[0]).toContain(
      "/data-definitions/lookup-tables/upload-url/",
    );
  });

  it("test_content_type_param", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { url: "", path: "", key: "" } },
      };
    });
    await client.getLookupUploadUrl("text/csv");
    const url = capturedUrls[0] ?? "";
    expect(
      url.includes("content-type=text") ||
        url.includes("content-type=text%2Fcsv"),
    ).toBe(true);
  });
});

describe("TestUploadToSignedUrl", () => {
  it("test_returns_none", async () => {
    const captured: Array<[string, string]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url]);
      return { status: 200 };
    });
    await client.uploadToSignedUrl(
      "https://storage.googleapis.com/upload",
      new TextEncoder().encode("col1,col2\na,b"),
    );
    expect(captured[0]?.[0]).toBe("PUT");
  });

  it("test_targets_external_url", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200 };
    });
    await client.uploadToSignedUrl(
      "https://storage.googleapis.com/bucket/key",
      new TextEncoder().encode("data"),
    );
    expect(capturedUrls[0]).toContain("storage.googleapis.com");
  });
});

describe("TestRegisterLookupTable", () => {
  it("test_returns_dict", async () => {
    const captured: Array<[string, string]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.headers["content-type"] ?? ""]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { data_group_id: 10, name: "New Table" },
        },
      };
    });
    const result = toNativeJson(
      await client.registerLookupTable({
        name: "New Table",
        gcs_path: "/uploads/abc",
      }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(result["data_group_id"]).toBe(10);
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { data_group_id: 1 } },
      };
    });
    await client.registerLookupTable({ name: "X" });
    expect(capturedUrls[0]).toContain("/data-definitions/lookup-tables/");
  });
});

// ---------------------------------------------------------------------------
// Custom Events — create / update / delete
// ---------------------------------------------------------------------------

describe("TestCreateCustomEvent", () => {
  it("test_posts_form_encoded_body", async () => {
    const captured: Array<{
      method: string;
      url: string;
      contentType: string;
      bodyText: string;
    }> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push({
        method: request.method,
        url: request.url,
        contentType: request.headers["content-type"] ?? "",
        bodyText: request.bodyText,
      });
      return {
        status: 200,
        json: {
          custom_event: {
            id: 99,
            name: "Page View",
            alternatives: [{ event: "Home" }],
          },
        },
      };
    });
    const result = toNativeJson(
      await client.createCustomEvent({
        name: "Page View",
        alternatives: '[{"event": "Home"}]',
      }),
    ) as Record<string, unknown>;
    const req = captured[0];
    expect(req?.method).toBe("POST");
    expect(req?.url.split("?", 1)[0]?.endsWith("/custom_events/")).toBe(true);
    expect(
      req?.contentType.startsWith("application/x-www-form-urlencoded"),
    ).toBe(true);
    const body = parseQs(req?.bodyText ?? "");
    expect(body["name"]).toEqual(["Page View"]);
    expect(JSON.parse(body["alternatives"]?.[0] ?? "")).toEqual([
      { event: "Home" },
    ]);
    expect(result["id"]).toBe(99);
    expect(result["name"]).toBe("Page View");
  });

  it("test_unwraps_custom_event_envelope", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { custom_event: { id: 1, name: "X", alternatives: [] } },
    }));
    const result = toNativeJson(
      await client.createCustomEvent({ name: "X", alternatives: "[]" }),
    );
    expect(result).toEqual({ id: 1, name: "X", alternatives: [] });
  });

  it("test_unwraps_results_then_custom_event_envelope", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        results: { custom_event: { id: 2, name: "Y", alternatives: [] } },
      },
    }));
    const result = toNativeJson(
      await client.createCustomEvent({ name: "Y", alternatives: "[]" }),
    ) as Record<string, unknown>;
    expect(result["id"]).toBe(2);
    expect(result["name"]).toBe("Y");
  });

  it("test_uses_maybe_scoped_path_project_default", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { custom_event: { id: 1, name: "X", alternatives: [] } },
      };
    });
    await client.createCustomEvent({ name: "X", alternatives: "[]" });
    expect(capturedUrls[0]).toContain("/projects/12345/custom_events/");
  });

  it("test_workspace_scoped_path_when_workspace_id_set", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { custom_event: { id: 1, name: "X", alternatives: [] } },
      };
    });
    client.setWorkspaceId(77);
    await client.createCustomEvent({ name: "X", alternatives: "[]" });
    expect(capturedUrls[0]).toContain("/workspaces/77/custom_events/");
  });

  it("test_400_raises_query_error", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 400,
      json: { error: "duplicate name" },
    }));
    await expect(
      client.createCustomEvent({ name: "X", alternatives: "[]" }),
    ).rejects.toBeInstanceOf(QueryError);
  });

  it("test_422_raises_query_error_with_form_body_in_context", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 422,
      json: { error: "alternative not found" },
    }));
    let caught: unknown;
    try {
      await client.createCustomEvent({
        name: "X",
        alternatives: '[{"event": "Unknown"}]',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QueryError);
    // Form-body callers should still get the form payload echoed in
    // the exception so debugging the rejected request is possible.
    expect((caught as QueryError).details["request_body"]).toEqual({
      name: "X",
      alternatives: '[{"event": "Unknown"}]',
    });
  });

  it("test_non_dict_response_raises_mixpanel_headless_error", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: [1, 2, 3],
    }));
    await expect(
      client.createCustomEvent({ name: "X", alternatives: "[]" }),
    ).rejects.toBeInstanceOf(MixpanelHeadlessError);
  });

  it("test_non_json_response_raises_mixpanel_headless_error", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      text: "not json at all",
    }));
    let caught: unknown;
    try {
      await client.createCustomEvent({ name: "X", alternatives: "[]" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MixpanelHeadlessError);
    expect((caught as MixpanelHeadlessError).code).toBe("INVALID_RESPONSE");
    const message = (caught as MixpanelHeadlessError).message;
    expect(message).toContain("POST");
    expect(message).toContain("/custom_events/");
  });

  it("test_retries_on_429", async () => {
    const attempts: number[] = [];
    const { client } = createMockClient(oauthCredentials(), () => {
      attempts.push(1);
      if (attempts.length === 1) {
        return {
          status: 429,
          headers: { "Retry-After": "0" },
          json: { error: "rate limited" },
        };
      }
      return {
        status: 200,
        json: { custom_event: { id: 1, name: "X", alternatives: [] } },
      };
    });
    const result = toNativeJson(
      await client.createCustomEvent({ name: "X", alternatives: "[]" }),
    ) as Record<string, unknown>;
    expect(attempts).toHaveLength(2); // one retry then success
    expect(result["id"]).toBe(1);
  });

  it("test_wraps_httpx_transport_error", async () => {
    const { client } = createMockClient(oauthCredentials(), () => {
      throw new TypeError("connection refused");
    });
    await expect(
      client.createCustomEvent({ name: "X", alternatives: "[]" }),
    ).rejects.toBeInstanceOf(MixpanelHeadlessError);
  });
});

describe("TestUpdateCustomEvent", () => {
  it("test_patch_body_uses_custom_event_id_not_name", async () => {
    const capturedBodies: Array<Record<string, unknown>> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedBodies.push(
        parseBody(request.bodyText) as Record<string, unknown>,
      );
      return {
        status: 200,
        json: { status: "ok", results: { id: 1, name: "X" } },
      };
    });
    await client.updateCustomEvent(2044168, { description: "Updated" });
    expect(capturedBodies[0]?.["customEventId"]).toBe(2044168);
    expect(Object.keys(capturedBodies[0] ?? {})).not.toContain("name");
  });

  it("test_422_raises_query_error", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 422,
      json: { error: "unknown customEventId" },
    }));
    await expect(
      client.updateCustomEvent(999999999, { description: "X" }),
    ).rejects.toBeInstanceOf(QueryError);
  });

  it("test_returns_target_mismatch_when_response_id_differs", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: { id: 1, name: "X", customEventId: 99999 },
      },
    }));
    let caught: unknown;
    try {
      await client.updateCustomEvent(2044168, { description: "X" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MixpanelHeadlessError);
    expect((caught as MixpanelHeadlessError).code).toBe(
      "UPDATE_TARGET_MISMATCH",
    );
    expect((caught as MixpanelHeadlessError).message).toContain("99999");
    expect((caught as MixpanelHeadlessError).message).toContain("2044168");
  });

  it("test_returns_dict_when_response_id_matches", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: { id: 1, name: "X", customEventId: 2044168 },
      },
    }));
    const result = toNativeJson(
      await client.updateCustomEvent(2044168, { description: "X" }),
    ) as Record<string, unknown>;
    expect(result["customEventId"]).toBe(2044168);
  });
});

describe("TestDeleteCustomEvent", () => {
  it("test_body_uses_custom_event_id_not_name", async () => {
    const captured: Array<[string, Record<string, unknown>]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.method,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteCustomEvent(2044168);
    expect(captured[0]?.[0]).toBe("DELETE");
    expect(captured[0]?.[1]["customEventId"]).toBe(2044168);
    expect(Object.keys(captured[0]?.[1] ?? {})).not.toContain("name");
  });

  it("test_uses_maybe_scoped_path_project_default", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteCustomEvent(42);
    expect(capturedUrls[0]).toContain(
      "/projects/12345/data-definitions/events/",
    );
  });

  it("test_workspace_scoped_path_when_workspace_id_set", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok" } };
    });
    client.setWorkspaceId(77);
    await client.deleteCustomEvent(42);
    expect(capturedUrls[0]).toContain(
      "/workspaces/77/data-definitions/events/",
    );
  });

  it("test_404_raises_query_error", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 404,
      json: { error: "not found" },
    }));
    await expect(client.deleteCustomEvent(999999999)).rejects.toBeInstanceOf(
      QueryError,
    );
  });
});

describe("TestMarkLookupTableReady", () => {
  it("test_returns_dict", async () => {
    const captured: Array<[string, string]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.headers["content-type"] ?? ""]);
      return {
        status: 200,
        json: { status: "ok", results: { data_group_id: 10, status: "ready" } },
      };
    });
    const result = toNativeJson(
      await client.markLookupTableReady({
        data_group_id: "10",
        status: "ready",
      }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(result["status"]).toBe("ready");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { data_group_id: 1 } },
      };
    });
    await client.markLookupTableReady({ data_group_id: "1" });
    expect(capturedUrls[0]).toContain("/data-definitions/lookup-tables/");
  });
});

describe("TestGetLookupUploadStatus", () => {
  it("test_returns_dict", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: { upload_id: "u-123", state: "complete" },
      },
    }));
    const result = toNativeJson(
      await client.getLookupUploadStatus("u-123"),
    ) as Record<string, unknown>;
    expect(result["upload_id"]).toBe("u-123");
    expect(result["state"]).toBe("complete");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    await client.getLookupUploadStatus("u-123");
    expect(capturedUrls[0]).toContain(
      "/data-definitions/lookup-tables/upload-status/",
    );
    expect(capturedUrls[0]).toContain("upload-id=u-123");
  });
});

describe("TestUpdateLookupTable", () => {
  it("test_returns_dict", async () => {
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { data_group_id: 5, name: "Updated Table" },
        },
      };
    });
    const result = toNativeJson(
      await client.updateLookupTable(5, { name: "Updated Table" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(result["name"]).toBe("Updated Table");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const captured: Array<[string, Record<string, unknown>]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.url,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return {
        status: 200,
        json: { status: "ok", results: { data_group_id: 5 } },
      };
    });
    await client.updateLookupTable(5, { name: "X" });
    expect(captured[0]?.[0]).toContain("/data-definitions/lookup-tables/");
    expect(captured[0]?.[1]["data-group-id"]).toBe(5);
    expect(captured[0]?.[1]["name"]).toBe("X");
  });
});

describe("TestDeleteLookupTables", () => {
  it("test_returns_none", async () => {
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteLookupTables([1, 2, 3]);
    expect(captured[0]?.[0]).toBe("DELETE");
    expect(captured[0]?.[1]).toEqual({ "data-group-ids": [1, 2, 3] });
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteLookupTables([1]);
    expect(capturedUrls[0]).toContain("/data-definitions/lookup-tables/");
  });
});

describe("TestDownloadLookupTable", () => {
  it("test_returns_bytes", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      text: "col1,col2\nval1,val2",
      headers: { "content-type": "text/csv" },
    }));
    const result = await client.downloadLookupTable(5);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result)).toContain("col1,col2");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, text: "data" };
    });
    await client.downloadLookupTable(5);
    expect(capturedUrls[0]).toContain(
      "/data-definitions/lookup-tables/download/",
    );
    expect(capturedUrls[0]).toContain("data-group-id=5");
  });

  it("test_optional_params", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, text: "data" };
    });
    await client.downloadLookupTable(5, {
      file_name: "export.csv",
      limit: 100,
    });
    const url = capturedUrls[0] ?? "";
    expect(url).toContain("file-name=export.csv");
    expect(url).toContain("limit=100");
  });
});

describe("TestGetLookupDownloadUrl", () => {
  it("test_returns_str", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: "https://storage.googleapis.com/download/abc",
      },
    }));
    const result = await client.getLookupDownloadUrl(5);
    expect(typeof result).toBe("string");
    expect(result).toContain("storage.googleapis.com");
  });

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: "https://example.com" },
      };
    });
    await client.getLookupDownloadUrl(5);
    expect(capturedUrls[0]).toContain(
      "/data-definitions/lookup-tables/download-url/",
    );
    expect(capturedUrls[0]).toContain("data-group-id=5");
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return {
        status: 200,
        json: { status: "ok", results: "https://example.com" },
      };
    });
    await client.getLookupDownloadUrl(5);
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
    expect(result).toEqual({
      status: "pending",
      message: "Export in progress",
    });
  });
});

describe("TestGetLookupUploadUrlMissingKeys", () => {
  it("test_get_lookup_upload_url_missing_keys", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: { url: "https://example.com" } },
    }));
    await expect(client.getLookupUploadUrl()).rejects.toBeInstanceOf(
      MixpanelHeadlessError,
    );
  });
});

describe("TestUploadToSignedUrlNetworkFailure", () => {
  it("test_upload_to_signed_url_network_failure", async () => {
    const { client } = createMockClient(oauthCredentials(), () => {
      throw new TypeError("Connection refused");
    });
    await expect(
      client.uploadToSignedUrl(
        "https://storage.example.com/upload",
        new TextEncoder().encode("col1,col2\na,b"),
      ),
    ).rejects.toBeInstanceOf(MixpanelHeadlessError);
  });
});

describe("TestRegisterLookupTableNonJsonResponse", () => {
  it("test_register_lookup_table_non_json_response", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      text: "<html>Server Error</html>",
      headers: { "content-type": "text/html" },
    }));
    await expect(
      client.registerLookupTable({ name: "Test Table" }),
    ).rejects.toBeInstanceOf(MixpanelHeadlessError);
  });
});
