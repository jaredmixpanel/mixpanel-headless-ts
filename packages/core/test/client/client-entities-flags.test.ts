// Layer-3 translation — Phase-3 packet B4-C4 feature-flag locks.
// Source: tests/unit/test_api_client_flags.py (ALL classes — flag CRUD,
// lifecycle archive/restore/duplicate, set_test_users/history/limits).
//
// The Python fixture builds an oauth_token session and pre-sets
// workspace_id=100 (feature flags use require_scoped_path, which needs
// a workspace ID; the pin avoids mocking the workspace list endpoint).
import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import type { MixpanelClient } from "../../src/client/client.js";
import { toNativeJson } from "../../src/client/json-value.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  type FakeTransport,
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

/**
 * The flags-file `create_mock_client` twin
 * (test_api_client_flags.py) — workspace ID pre-set to 100.
 */
function createFlagsClient(
  handler: (request: CapturedFetchRequest) => CannedResponse,
  workspaceId = 100,
): { client: MixpanelClient; transport: FakeTransport } {
  const { client, transport } = createMockClient(oauthCredentials(), handler);
  client.setWorkspaceId(workspaceId);
  return { client, transport };
}

/** The `_flag_result` helper twin. */
function flagResult(
  id = "abc-123",
  name = "Test Flag",
  key = "test_flag",
): Record<string, unknown> {
  return {
    id,
    project_id: 12345,
    name,
    key,
    status: "disabled",
    context: "default",
    serving_method: "client",
    ruleset: {},
    created: "2026-01-01T00:00:00Z",
    modified: "2026-01-01T00:00:00Z",
  };
}

/** Parse a captured JSON request body (json.loads(request.content)). */
function parseBody(bodyText: string): unknown {
  return JSON.parse(bodyText) as unknown;
}

describe("TestListFeatureFlags", () => {
  it("test_returns_flag_list", async () => {
    const { client } = createFlagsClient(() => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          flagResult("id-1", "Flag A", "flag_a"),
          flagResult("id-2", "Flag B", "flag_b"),
        ],
      },
    }));
    const result = toNativeJson(await client.listFeatureFlags()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["id"]).toBe("id-1");
    expect(result[1]?.["name"]).toBe("Flag B");
  });

  it("test_uses_require_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listFeatureFlags();
    expect(capturedUrls[0]).toContain("/feature-flags");
  });

  it("test_include_archived", async () => {
    const capturedUrls: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listFeatureFlags({ include_archived: true });
    expect(capturedUrls[0]?.toLowerCase()).toContain("include_archived=true");
  });

  it("test_empty_result", async () => {
    const { client } = createFlagsClient(() => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    const result = await client.listFeatureFlags();
    expect(result).toStrictEqual([]);
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listFeatureFlags();
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("TestCreateFeatureFlag", () => {
  it("test_creates_flag", async () => {
    const captured: Array<[string, unknown]> = [];
    const { client } = createFlagsClient((request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: flagResult("new-id", "New Flag", "new_flag"),
        },
      };
    });
    const result = toNativeJson(
      await client.createFeatureFlag({ name: "New Flag", key: "new_flag" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]).toStrictEqual({
      name: "New Flag",
      key: "new_flag",
    });
    expect(result["id"]).toBe("new-id");
  });

  it("test_url_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: flagResult() } };
    });
    await client.createFeatureFlag({ name: "X", key: "x" });
    expect(capturedUrls[0]).toContain("/feature-flags");
  });
});

describe("TestGetFeatureFlag", () => {
  it("test_gets_flag_by_id", async () => {
    const capturedUrls: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: flagResult("abc-123", "Test", "test") },
      };
    });
    const result = toNativeJson(
      await client.getFeatureFlag("abc-123"),
    ) as Record<string, unknown>;
    expect(capturedUrls[0]).toContain("/feature-flags/abc-123");
    expect(result["id"]).toBe("abc-123");
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: flagResult() } };
    });
    await client.getFeatureFlag("abc-123");
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("TestUpdateFeatureFlag", () => {
  it("test_updates_flag", async () => {
    const captured: Array<[string, Record<string, unknown>]> = [];
    const { client } = createFlagsClient((request) => {
      captured.push([
        request.method,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: flagResult("abc-123", "Updated", "test"),
        },
      };
    });
    const result = toNativeJson(
      await client.updateFeatureFlag("abc-123", {
        name: "Updated",
        key: "test",
        status: "enabled",
        ruleset: {},
      }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PUT");
    expect(captured[0]?.[1]["name"]).toBe("Updated");
    expect(result["name"]).toBe("Updated");
  });

  it("test_url_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: flagResult() } };
    });
    await client.updateFeatureFlag("abc-123", {
      name: "X",
      key: "x",
      status: "disabled",
      ruleset: {},
    });
    expect(capturedUrls[0]).toContain("/feature-flags/abc-123");
  });
});

describe("TestDeleteFeatureFlag", () => {
  it("test_deletes_flag", async () => {
    const capturedMethods: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedMethods.push(request.method);
      return { status: 204 };
    });
    await client.deleteFeatureFlag("abc-123");
    expect(capturedMethods[0]).toBe("DELETE");
  });

  it("test_url_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedUrls.push(request.url);
      return { status: 204 };
    });
    await client.deleteFeatureFlag("abc-123");
    expect(capturedUrls[0]).toContain("/feature-flags/abc-123");
  });
});

describe("TestArchiveFeatureFlag", () => {
  it("test_archives_flag", async () => {
    const captured: Array<[string, string]> = [];
    const { client } = createFlagsClient((request) => {
      captured.push([request.method, request.url]);
      return { status: 204 };
    });
    await client.archiveFeatureFlag("abc-123");
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]).toContain("/feature-flags/abc-123/archive");
  });
});

describe("TestRestoreFeatureFlag", () => {
  it("test_restores_flag", async () => {
    const captured: Array<[string, string]> = [];
    const { client } = createFlagsClient((request) => {
      captured.push([request.method, request.url]);
      return { status: 200, json: { status: "ok", results: flagResult() } };
    });
    const result = toNativeJson(
      await client.restoreFeatureFlag("abc-123"),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("DELETE");
    expect(captured[0]?.[1]).toContain("/feature-flags/abc-123/archive");
    expect(result["id"]).toBe("abc-123");
  });
});

describe("TestDuplicateFeatureFlag", () => {
  it("test_duplicates_flag", async () => {
    const captured: Array<[string, string]> = [];
    const { client } = createFlagsClient((request) => {
      captured.push([request.method, request.url]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: flagResult("dup-456", "Copy of Test", "test_copy"),
        },
      };
    });
    const result = toNativeJson(
      await client.duplicateFeatureFlag("abc-123"),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]).toContain("/feature-flags/abc-123/duplicate");
    expect(result["id"]).toBe("dup-456");
    expect(result["name"]).toBe("Copy of Test");
  });
});

describe("TestSetFlagTestUsers", () => {
  it("test_sets_test_users", async () => {
    const captured: Array<[string, string, Record<string, unknown>]> = [];
    const { client } = createFlagsClient((request) => {
      captured.push([
        request.method,
        request.url,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return { status: 204 };
    });
    await client.setFlagTestUsers("abc-123", {
      users: { on: "user-1", off: "user-2" },
    });
    expect(captured[0]?.[0]).toBe("PUT");
    expect(captured[0]?.[1]).toContain("/feature-flags/abc-123/test-users");
    expect(captured[0]?.[2]["users"]).toStrictEqual({
      on: "user-1",
      off: "user-2",
    });
  });
});

describe("TestGetFlagHistory", () => {
  it("test_gets_history", async () => {
    const capturedUrls: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { events: [[1, "created"]], count: 1 },
        },
      };
    });
    const result = toNativeJson(
      await client.getFlagHistory("abc-123"),
    ) as Record<string, unknown>;
    expect(capturedUrls[0]).toContain("/feature-flags/abc-123/history");
    expect(result["events"]).toStrictEqual([[1, "created"]]);
    expect(result["count"]).toBe(1);
  });

  it("test_with_pagination_params", async () => {
    const capturedUrls: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { events: [], count: 0 } },
      };
    });
    await client.getFlagHistory("abc-123", {
      params: { page_size: "50", page: "cursor-abc" },
    });
    const url = capturedUrls[0] ?? "";
    expect(url.includes("page_size=50") || url.includes("page_size")).toBe(
      true,
    );
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedMethods.push(request.method);
      return {
        status: 200,
        json: { status: "ok", results: { events: [], count: 0 } },
      };
    });
    await client.getFlagHistory("abc-123");
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("TestGetFlagLimits", () => {
  it("test_gets_limits", async () => {
    const capturedUrls: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          status: "ok",
          results: {
            limit: 100,
            is_trial: false,
            current_usage: 42,
            contract_status: "active",
          },
        },
      };
    });
    const result = toNativeJson(await client.getFlagLimits()) as Record<
      string,
      unknown
    >;
    expect(capturedUrls[0]).toContain("/feature-flags/limits");
    expect(result["limit"]).toBe(100);
    expect(result["current_usage"]).toBe(42);
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedMethods.push(request.method);
      return {
        status: 200,
        json: {
          status: "ok",
          results: {
            limit: 10,
            is_trial: true,
            current_usage: 0,
            contract_status: "active",
          },
        },
      };
    });
    await client.getFlagLimits();
    expect(capturedMethods[0]).toBe("GET");
  });

  it("test_always_uses_project_scoped_path", async () => {
    const capturedUrls: string[] = [];
    // Client has workspace_id=100 set, but limits should still be
    // project-scoped.
    const { client } = createFlagsClient((request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          status: "ok",
          results: {
            limit: 100,
            is_trial: false,
            current_usage: 0,
            contract_status: "active",
          },
        },
      };
    });
    await client.getFlagLimits();
    expect(capturedUrls[0]).toContain("/projects/12345/feature-flags/limits");
    expect(capturedUrls[0]).not.toContain("/workspaces/");
  });
});
