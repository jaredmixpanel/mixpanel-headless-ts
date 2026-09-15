// Layer-3 translation — Phase-3 packet B4-C1 workspace-resolution locks.
// Sources:
//
// - tests/unit/test_app_api_client.py::TestWorkspaceScoping (:411-516),
//   ::TestResolveWorkspaceId (:523-609), ::TestListWorkspaces
//   (:612-663), ::TestResolveWorkspace (:666-749),
//   ::TestAppApiEdgeCases (:752-784), ::TestListWorkspacesEdgeCases
//   (:792-870)
// - tests/unit/test_workspace_resolution.py::
//   TestResolveWorkspaceIdWithResolver (:228-456) and
//   ::TestProjectsMetadataIndex (:459-608). TestSelectWorkspaceId lives
//   in me.test.ts; ::TestMeServiceResolveWorkspace (:154) is translated
//   in `test/services/me-service.test.ts` and ::TestFacadeResolverWiring
//   (:611) in `test/workspace/workspace-facade.test.ts` — both landed
//   at B7-A1 (`b7-packets.md` §3.4; the original "B8"/"B6" assignments
//   here were STALE post-W1, corrected per packet Caution #17).
//
// Entry-point substitutions as in client-core.test.ts; MagicMock
// resolvers translate to counting closures.
import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  MixpanelHeadlessError,
  QueryError,
  RateLimitError,
  ResponseValidationError,
  ServerError,
  WorkspaceScopeError,
} from "../../src/errors.js";
import { PublicWorkspace } from "../../src/types/entities/common.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** oauth_credentials fixture (test_app_api_client.py:40-42). */
function oauthSession(): ReturnType<typeof makeSession> {
  return makeSession({
    projectId: "12345",
    region: "us",
    oauthToken: "test-oauth-token",
  });
}

/** `_session_no_ws` (test_workspace_resolution.py:217-225). */
function sessionNoWs(projectId = "4025120"): ReturnType<typeof makeSession> {
  return makeSession({ name: "demo", projectId });
}

/** URL path of a captured request (httpx `request.url.path`). */
function pathOf(request: CapturedFetchRequest): string {
  return new URL(request.url).pathname;
}

const emptyResults: CannedResponse = { status: 200, json: { results: [] } };

describe("TestWorkspaceScoping", () => {
  it("test_maybe_scoped_path_without_workspace", () => {
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {},
    }));
    expect(client.maybeScopedPath("dashboards")).toBe(
      "/projects/12345/dashboards",
    );
  });

  it("test_maybe_scoped_path_with_workspace", () => {
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {},
    }));
    client.setWorkspaceId(789);
    expect(client.maybeScopedPath("dashboards")).toBe(
      "/workspaces/789/dashboards",
    );
  });

  it("test_maybe_scoped_path_with_workspace_none_resets", () => {
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {},
    }));
    client.setWorkspaceId(789);
    client.setWorkspaceId(null);
    expect(client.maybeScopedPath("dashboards")).toBe(
      "/projects/12345/dashboards",
    );
  });

  it("test_require_scoped_path_with_explicit_workspace", async () => {
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {},
    }));
    client.setWorkspaceId(789);
    expect(await client.requireScopedPath("feature-flags")).toBe(
      "/projects/12345/workspaces/789/feature-flags",
    );
  });

  it("test_require_scoped_path_auto_discovers_workspace", async () => {
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          { id: 100, name: "Main", project_id: 12345, is_default: true },
        ],
      },
    }));
    expect(await client.requireScopedPath("feature-flags")).toBe(
      "/projects/12345/workspaces/100/feature-flags",
    );
  });

  it("test_require_scoped_path_raises_on_no_workspaces", async () => {
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    await expect(
      client.requireScopedPath("feature-flags"),
    ).rejects.toBeInstanceOf(WorkspaceScopeError);
  });

  it("test_require_scoped_path_caches_resolved_workspace", async () => {
    let callCount = 0;
    const { client } = createMockClient(oauthSession(), () => {
      callCount += 1;
      return {
        status: 200,
        json: {
          status: "ok",
          results: [
            { id: 100, name: "Main", project_id: 12345, is_default: true },
          ],
        },
      };
    });
    await client.requireScopedPath("feature-flags");
    await client.requireScopedPath("experiments");
    // Only one HTTP call for workspace resolution.
    expect(callCount).toBe(1);
  });
});

describe("TestResolveWorkspaceId", () => {
  it("test_returns_explicit_workspace_id", async () => {
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {},
    }));
    client.setWorkspaceId(42);
    expect(await client.resolveWorkspaceId()).toBe(42);
  });

  it("test_auto_discovers_default_workspace", async () => {
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          { id: 10, name: "Other", project_id: 12345, is_default: false },
          { id: 20, name: "Main", project_id: 12345, is_default: true },
        ],
      },
    }));
    expect(await client.resolveWorkspaceId()).toBe(20);
  });

  it("test_falls_back_to_first_workspace", async () => {
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          { id: 10, name: "First", project_id: 12345, is_default: false },
          { id: 20, name: "Second", project_id: 12345, is_default: false },
        ],
      },
    }));
    expect(await client.resolveWorkspaceId()).toBe(10);
  });

  it("test_raises_on_empty_workspaces", async () => {
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    let thrown: unknown;
    try {
      await client.resolveWorkspaceId();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WorkspaceScopeError);
    expect((thrown as WorkspaceScopeError).code).toBe("NO_WORKSPACES");
  });

  it("test_caches_resolved_id", async () => {
    let callCount = 0;
    const { client } = createMockClient(oauthSession(), () => {
      callCount += 1;
      return {
        status: 200,
        json: {
          status: "ok",
          results: [
            { id: 100, name: "Main", project_id: 12345, is_default: true },
          ],
        },
      };
    });
    const first = await client.resolveWorkspaceId();
    const second = await client.resolveWorkspaceId();
    expect(first).toBe(100);
    expect(second).toBe(100);
    expect(callCount).toBe(1);
  });
});

describe("TestListWorkspaces", () => {
  it("test_returns_public_workspace_list", async () => {
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          { id: 1, name: "Default", project_id: 12345, is_default: true },
          { id: 2, name: "Staging", project_id: 12345, is_default: false },
        ],
      },
    }));
    const workspaces = await client.listWorkspaces();
    expect(workspaces).toHaveLength(2);
    expect(workspaces[0]).toBeInstanceOf(PublicWorkspace);
    expect(workspaces[0]?.id).toBe(1);
    expect(workspaces[0]?.name).toBe("Default");
    expect(workspaces[0]?.is_default).toBe(true);
    expect(workspaces[1]?.id).toBe(2);
    expect(workspaces[1]?.is_default).toBe(false);
  });

  it("test_calls_correct_endpoint", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthSession(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listWorkspaces();
    expect(
      capturedUrls[0]?.startsWith(
        "https://mixpanel.com/api/app/projects/12345/workspaces/public",
      ),
    ).toBe(true);
  });
});

describe("TestResolveWorkspace", () => {
  it("test_calls_correct_endpoint_no_double_prefix", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthSession(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          status: "ok",
          results: [
            { id: 7, name: "Default", project_id: 12345, is_default: true },
          ],
        },
      };
    });
    await client.resolveWorkspace();
    const expected =
      "https://mixpanel.com/api/app/projects/12345/workspaces/public";
    expect(capturedUrls).toStrictEqual([expected]);
    expect(capturedUrls[0]?.includes("/api/app/api/app")).toBe(false);
  });

  it("test_writes_to_resolve_workspace_id_cache", async () => {
    let callCount = 0;
    const { client } = createMockClient(oauthSession(), () => {
      callCount += 1;
      return {
        status: 200,
        json: {
          status: "ok",
          results: [
            { id: 99, name: "Default", project_id: 12345, is_default: true },
          ],
        },
      };
    });
    const ref = await client.resolveWorkspace();
    const wsId = await client.resolveWorkspaceId();
    expect(ref.id).toBe(99);
    expect(wsId).toBe(99);
    expect(callCount).toBe(1);
  });
});

describe("TestAppApiEdgeCases", () => {
  it("test_set_workspace_id_zero", () => {
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {},
    }));
    client.setWorkspaceId(0);
    expect(
      client.maybeScopedPath("dashboards").includes("/workspaces/0/"),
    ).toBe(true);
  });

  it("test_set_workspace_id_negative", () => {
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {},
    }));
    client.setWorkspaceId(-1);
    expect(
      client.maybeScopedPath("dashboards").includes("/workspaces/-1/"),
    ).toBe(true);
  });
});

describe("TestListWorkspacesEdgeCases", () => {
  it("test_list_workspaces_string_response", async () => {
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: { results: "unexpected_string", status: "ok" },
    }));
    let thrown: unknown;
    try {
      await client.listWorkspaces();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MixpanelHeadlessError);
    expect(String(thrown)).toContain("Unexpected response format");
  });

  it("test_list_workspaces_missing_required_fields", async () => {
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: { results: [{ name: "missing_id" }], status: "ok" },
    }));
    let thrown: unknown;
    try {
      await client.listWorkspaces();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ResponseValidationError);
    expect((thrown as ResponseValidationError).code).toBe(
      "RESPONSE_VALIDATION_ERROR",
    );
  });

  it("test_list_workspaces_missing_name_raises_coded_error", async () => {
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: { results: [{ id: 1 }], status: "ok" },
    }));
    let thrown: unknown;
    try {
      await client.listWorkspaces();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ResponseValidationError);
    expect((thrown as ResponseValidationError).code).toBe(
      "RESPONSE_VALIDATION_ERROR",
    );
  });
});

// ---------------------------------------------------------------------------
// tests/unit/test_workspace_resolution.py — the client-side classes.
// ---------------------------------------------------------------------------

describe("TestResolveWorkspaceIdWithResolver", () => {
  it("test_resolver_hit_skips_public_endpoint_and_caches", async () => {
    const calls: string[] = [];
    const { client } = createMockClient(sessionNoWs(), (request) => {
      calls.push(pathOf(request));
      return emptyResults;
    });
    let resolverCalls = 0;
    client.setWorkspaceResolver(() => {
      resolverCalls += 1;
      return 4521297;
    });
    expect(await client.resolveWorkspaceId()).toBe(4521297);
    expect(await client.resolveWorkspaceId()).toBe(4521297);
    expect(resolverCalls).toBe(1);
    expect(calls.some((p) => p.includes("workspaces/public"))).toBe(false);
  });

  it("test_explicit_workspace_skips_resolver", async () => {
    let resolverCalls = 0;
    const { client } = createMockClient(sessionNoWs(), () => emptyResults);
    client.setWorkspaceId(4521297);
    client.setWorkspaceResolver(() => {
      resolverCalls += 1;
      return null;
    });
    expect(await client.resolveWorkspaceId()).toBe(4521297);
    expect(resolverCalls).toBe(0);
  });

  it("test_falls_back_to_public_when_resolver_returns_none", async () => {
    const { client } = createMockClient(sessionNoWs(), (request) => {
      if (pathOf(request).includes("workspaces/public")) {
        return {
          status: 200,
          json: {
            results: [
              {
                id: 10,
                name: "Console",
                project_id: 4025120,
                is_default: true,
              },
              {
                id: 11,
                name: "All Project Data",
                project_id: 4025120,
                is_default: false,
                is_global: true,
              },
            ],
          },
        };
      }
      return emptyResults;
    });
    client.setWorkspaceResolver(() => null);
    expect(await client.resolveWorkspaceId()).toBe(11);
  });

  it("test_metadata_fallback_when_public_empty", async () => {
    const { client } = createMockClient(sessionNoWs(), (request) => {
      const path = pathOf(request);
      if (path.includes("workspaces/public")) {
        return emptyResults;
      }
      if (path.includes("metadata/index")) {
        return {
          status: 200,
          json: {
            results: {
              "4025120": {
                workspaces: {
                  "4521297": {
                    id: 4521297,
                    name: "All Project Data",
                    is_default: true,
                    is_global: true,
                  },
                },
              },
            },
          },
        };
      }
      return emptyResults;
    });
    expect(await client.resolveWorkspaceId()).toBe(4521297);
  });

  it("test_raises_when_nothing_resolves", async () => {
    const { client } = createMockClient(sessionNoWs(), (request) => {
      if (pathOf(request).includes("metadata/index")) {
        return { status: 200, json: { results: {} } };
      }
      return emptyResults;
    });
    await expect(client.resolveWorkspaceId()).rejects.toBeInstanceOf(
      WorkspaceScopeError,
    );
  });

  it("test_no_resolver_preserves_public_path", async () => {
    const { client } = createMockClient(sessionNoWs(), () => ({
      status: 200,
      json: {
        results: [
          { id: 55, name: "Default", project_id: 4025120, is_default: true },
        ],
      },
    }));
    expect(await client.resolveWorkspaceId()).toBe(55);
  });

  it("test_public_403_falls_through_to_metadata", async () => {
    const { client } = createMockClient(sessionNoWs(), (request) => {
      const path = pathOf(request);
      if (path.includes("workspaces/public")) {
        return { status: 403, json: { error: "forbidden" } };
      }
      if (path.includes("metadata/index")) {
        return {
          status: 200,
          json: {
            results: {
              "4025120": {
                workspaces: {
                  "4521297": {
                    id: 4521297,
                    name: "All Project Data",
                    is_global: true,
                  },
                },
              },
            },
          },
        };
      }
      return emptyResults;
    });
    expect(await client.resolveWorkspaceId()).toBe(4521297);
  });

  it("test_public_server_error_propagates", async () => {
    const calls: string[] = [];
    const { client } = createMockClient(
      sessionNoWs(),
      (request) => {
        calls.push(pathOf(request));
        if (pathOf(request).includes("workspaces/public")) {
          return { status: 503, json: { error: "down" } };
        }
        return emptyResults;
      },
      { maxRetries: 0 },
    );
    await expect(client.resolveWorkspaceId()).rejects.toBeInstanceOf(
      ServerError,
    );
    expect(calls.some((p) => p.includes("metadata/index"))).toBe(false);
  });

  it("test_metadata_result_is_cached", async () => {
    const calls: string[] = [];
    const { client } = createMockClient(sessionNoWs(), (request) => {
      calls.push(pathOf(request));
      if (pathOf(request).includes("metadata/index")) {
        return {
          status: 200,
          json: {
            results: {
              "4025120": {
                workspaces: {
                  "7": { id: 7, name: "Main", is_default: true },
                },
              },
            },
          },
        };
      }
      return emptyResults;
    });
    expect(await client.resolveWorkspaceId()).toBe(7);
    expect(await client.resolveWorkspaceId()).toBe(7);
    expect(calls.filter((p) => p.includes("metadata/index"))).toHaveLength(1);
  });

  it("test_maybe_scoped_path_stays_project_scoped_without_workspace", () => {
    const { client } = createMockClient(sessionNoWs(), () => emptyResults);
    expect(client.maybeScopedPath("data-definitions/events/")).toBe(
      "/projects/4025120/data-definitions/events/",
    );
  });
});

describe("TestProjectsMetadataIndex", () => {
  it("test_returns_project_keyed_mapping", async () => {
    const { client } = createMockClient(sessionNoWs(), () => ({
      status: 200,
      json: { results: { "4025120": { name: "demo" } } },
    }));
    expect(await client.projectsMetadataIndex()).toStrictEqual({
      "4025120": { name: "demo" },
    });
  });

  it("test_resolver_prefers_default_when_no_global", async () => {
    const { client } = createMockClient(sessionNoWs(), (request) => {
      if (pathOf(request).includes("workspaces/public")) {
        return emptyResults;
      }
      return {
        status: 200,
        json: {
          results: {
            "4025120": {
              workspaces: {
                "1": { id: 1, name: "Console", is_default: false },
                "2": { id: 2, name: "Main", is_default: true },
              },
            },
          },
        },
      };
    });
    expect(await client.resolveWorkspaceId()).toBe(2);
  });

  it("test_resolver_none_when_project_absent", async () => {
    const { client } = createMockClient(sessionNoWs(), () => ({
      status: 200,
      json: { results: { "9999": { workspaces: {} } } },
    }));
    expect(await client.resolveWorkspaceFromMetadata()).toBeNull();
  });

  it("test_resolver_none_when_workspaces_missing", async () => {
    const { client } = createMockClient(sessionNoWs(), () => ({
      status: 200,
      json: { results: { "4025120": { name: "demo" } } },
    }));
    expect(await client.resolveWorkspaceFromMetadata()).toBeNull();
  });

  it("test_resolver_skips_non_numeric_ids", async () => {
    const { client } = createMockClient(sessionNoWs(), () => ({
      status: 200,
      json: {
        results: {
          "4025120": {
            workspaces: {
              bad: { id: "not-an-int", name: "x" },
              good: { id: 42, name: "y", is_default: true },
            },
          },
        },
      },
    }));
    expect(await client.resolveWorkspaceFromMetadata()).toBe(42);
  });

  it("test_resolver_propagates_server_error", async () => {
    const { client } = createMockClient(
      sessionNoWs(),
      () => ({ status: 500, json: { error: "boom" } }),
      // Python's fixture uses the default max_retries=3; 5xx never
      // retries (R2.5), so the default stays.
    );
    await expect(client.resolveWorkspaceFromMetadata()).rejects.toBeInstanceOf(
      ServerError,
    );
  });

  it("test_resolver_returns_none_on_404", async () => {
    const { client } = createMockClient(sessionNoWs(), () => ({
      status: 404,
      json: { error: "not found" },
    }));
    expect(await client.resolveWorkspaceFromMetadata()).toBeNull();
  });

  it("test_resolver_propagates_unexpected_query_error", async () => {
    const { client } = createMockClient(sessionNoWs(), () => ({
      status: 400,
      json: { error: "bad request" },
    }));
    await expect(client.resolveWorkspaceFromMetadata()).rejects.toBeInstanceOf(
      QueryError,
    );
  });

  it("test_resolver_none_when_all_ids_invalid", async () => {
    const { client } = createMockClient(sessionNoWs(), () => ({
      status: 200,
      json: {
        results: {
          "4025120": {
            workspaces: {
              a: "not-a-dict",
              b: { id: "nope", name: "x" },
            },
          },
        },
      },
    }));
    expect(await client.resolveWorkspaceFromMetadata()).toBeNull();
  });

  it("test_resolver_propagates_auth_error", async () => {
    const { client } = createMockClient(sessionNoWs(), () => ({
      status: 401,
      json: { error: "unauthorized" },
    }));
    await expect(client.resolveWorkspaceFromMetadata()).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("test_resolver_propagates_rate_limit_error", async () => {
    const { client } = createMockClient(
      sessionNoWs(),
      () => ({ status: 429, json: { error: "slow down" } }),
      { maxRetries: 0 },
    );
    await expect(client.resolveWorkspaceFromMetadata()).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });
});
