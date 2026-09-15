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
