// Feature-flag client methods: CRUD, archive/restore/duplicate,
// set-test-users, history and limits (paths, methods, bodies). Mirrors
// every class of tests/unit/test_api_client_flags.py; like the Python
// fixture, the client pre-sets workspace_id=100 because flags use
// `requireScopedPath`, which would otherwise discover a workspace over the wire.

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

describe("List feature flags", () => {
  // python: TestListFeatureFlags
  it("returns flag list", async () => {
    // python: test_returns_flag_list
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

  it("uses require scoped path", async () => {
    // python: test_uses_require_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listFeatureFlags();
    expect(capturedUrls[0]).toContain("/feature-flags");
  });

  it("include archived", async () => {
    // python: test_include_archived
    const capturedUrls: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listFeatureFlags({ include_archived: true });
    expect(capturedUrls[0]?.toLowerCase()).toContain("include_archived=true");
  });

  it("empty result", async () => {
    // python: test_empty_result
    const { client } = createFlagsClient(() => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    const result = await client.listFeatureFlags();
    expect(result).toStrictEqual([]);
  });

  it("uses get method", async () => {
    // python: test_uses_get_method
    const capturedMethods: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listFeatureFlags();
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("Create feature flag", () => {
  // python: TestCreateFeatureFlag
  it("creates flag", async () => {
    // python: test_creates_flag
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

  it("URL path", async () => {
    // python: test_url_path
    const capturedUrls: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: flagResult() } };
    });
    await client.createFeatureFlag({ name: "X", key: "x" });
    expect(capturedUrls[0]).toContain("/feature-flags");
  });
});

describe("Get feature flag", () => {
  // python: TestGetFeatureFlag
  it("gets flag by ID", async () => {
    // python: test_gets_flag_by_id
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

  it("uses get method", async () => {
    // python: test_uses_get_method
    const capturedMethods: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: flagResult() } };
    });
    await client.getFeatureFlag("abc-123");
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("Update feature flag", () => {
  // python: TestUpdateFeatureFlag
  it("updates flag", async () => {
    // python: test_updates_flag
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

  it("URL path", async () => {
    // python: test_url_path
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

describe("Delete feature flag", () => {
  // python: TestDeleteFeatureFlag
  it("deletes flag", async () => {
    // python: test_deletes_flag
    const capturedMethods: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedMethods.push(request.method);
      return { status: 204 };
    });
    await client.deleteFeatureFlag("abc-123");
    expect(capturedMethods[0]).toBe("DELETE");
  });

  it("URL path", async () => {
    // python: test_url_path
    const capturedUrls: string[] = [];
    const { client } = createFlagsClient((request) => {
      capturedUrls.push(request.url);
      return { status: 204 };
    });
    await client.deleteFeatureFlag("abc-123");
    expect(capturedUrls[0]).toContain("/feature-flags/abc-123");
  });
});

describe("Archive feature flag", () => {
  // python: TestArchiveFeatureFlag
  it("archives flag", async () => {
    // python: test_archives_flag
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

describe("Restore feature flag", () => {
  // python: TestRestoreFeatureFlag
  it("restores flag", async () => {
    // python: test_restores_flag
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

describe("Duplicate feature flag", () => {
  // python: TestDuplicateFeatureFlag
  it("duplicates flag", async () => {
    // python: test_duplicates_flag
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

describe("Set flag test users", () => {
  // python: TestSetFlagTestUsers
  it("sets test users", async () => {
    // python: test_sets_test_users
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

describe("Get flag history", () => {
  // python: TestGetFlagHistory
  it("gets history", async () => {
    // python: test_gets_history
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

  it("with pagination params", async () => {
    // python: test_with_pagination_params
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

  it("uses get method", async () => {
    // python: test_uses_get_method
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

describe("Get flag limits", () => {
  // python: TestGetFlagLimits
  it("gets limits", async () => {
    // python: test_gets_limits
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

  it("uses get method", async () => {
    // python: test_uses_get_method
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

  it("always uses project scoped path", async () => {
    // python: test_always_uses_project_scoped_path
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
