// Layer-3 translation — Phase-3 packet B4-C1 workspace-resolution locks.
// Sources:
//
// - tests/unit/test_app_api_client.py::TestWorkspaceScoping,
//   ::TestResolveWorkspaceId (:523-609), ::TestListWorkspaces
//   (:612-663), ::TestResolveWorkspace (:666-749),
//   ::TestAppApiEdgeCases (:752-784), ::TestListWorkspacesEdgeCases
// - tests/unit/test_workspace_resolution.py::
//   TestResolveWorkspaceIdWithResolver and
//   ::TestProjectsMetadataIndex (:459-608). TestSelectWorkspaceId lives
//   in me.test.ts; ::TestMeServiceResolveWorkspace is translated
//   in `test/services/me-service.test.ts` and ::TestFacadeResolverWiring
//   in `test/workspace/workspace-facade.test.ts` — both landed
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

/** oauth_credentials fixture (test_app_api_client.py). */
function oauthSession(): ReturnType<typeof makeSession> {
  return makeSession({
    projectId: "12345",
    region: "us",
    oauthToken: "test-oauth-token",
  });
}

/** `_session_no_ws`. */
function sessionNoWs(projectId = "4025120"): ReturnType<typeof makeSession> {
  return makeSession({ name: "demo", projectId });
}

/** URL path of a captured request (httpx `request.url.path`). */
function pathOf(request: CapturedFetchRequest): string {
  return new URL(request.url).pathname;
}

const emptyResults: CannedResponse = { status: 200, json: { results: [] } };

describe("Workspace scoping", () => {
  // python: TestWorkspaceScoping
  it("maybe scoped path without workspace", () => {
    // python: test_maybe_scoped_path_without_workspace
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {},
    }));
    expect(client.maybeScopedPath("dashboards")).toBe(
      "/projects/12345/dashboards",
    );
  });

  it("maybe scoped path with workspace", () => {
    // python: test_maybe_scoped_path_with_workspace
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {},
    }));
    client.setWorkspaceId(789);
    expect(client.maybeScopedPath("dashboards")).toBe(
      "/workspaces/789/dashboards",
    );
  });

  it("maybe scoped path with workspace null resets", () => {
    // python: test_maybe_scoped_path_with_workspace_none_resets
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

  it("require scoped path with explicit workspace", async () => {
    // python: test_require_scoped_path_with_explicit_workspace
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {},
    }));
    client.setWorkspaceId(789);
    await expect(client.requireScopedPath("feature-flags")).resolves.toBe(
      "/projects/12345/workspaces/789/feature-flags",
    );
  });

  it("require scoped path auto discovers workspace", async () => {
    // python: test_require_scoped_path_auto_discovers_workspace
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          { id: 100, name: "Main", project_id: 12345, is_default: true },
        ],
      },
    }));
    await expect(client.requireScopedPath("feature-flags")).resolves.toBe(
      "/projects/12345/workspaces/100/feature-flags",
    );
  });

  it("require scoped path raises on no workspaces", async () => {
    // python: test_require_scoped_path_raises_on_no_workspaces
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    await expect(
      client.requireScopedPath("feature-flags"),
    ).rejects.toBeInstanceOf(WorkspaceScopeError);
  });

  it("require scoped path caches resolved workspace", async () => {
    // python: test_require_scoped_path_caches_resolved_workspace
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

describe("Resolve workspace ID", () => {
  // python: TestResolveWorkspaceId
  it("returns explicit workspace ID", async () => {
    // python: test_returns_explicit_workspace_id
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {},
    }));
    client.setWorkspaceId(42);
    await expect(client.resolveWorkspaceId()).resolves.toBe(42);
  });

  it("auto discovers default workspace", async () => {
    // python: test_auto_discovers_default_workspace
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
    await expect(client.resolveWorkspaceId()).resolves.toBe(20);
  });

  it("falls back to first workspace", async () => {
    // python: test_falls_back_to_first_workspace
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
    await expect(client.resolveWorkspaceId()).resolves.toBe(10);
  });

  it("raises on empty workspaces", async () => {
    // python: test_raises_on_empty_workspaces
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

  it("caches resolved ID", async () => {
    // python: test_caches_resolved_id
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

describe("List workspaces", () => {
  // python: TestListWorkspaces
  it("returns public workspace list", async () => {
    // python: test_returns_public_workspace_list
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

  it("calls correct endpoint", async () => {
    // python: test_calls_correct_endpoint
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

describe("Resolve workspace", () => {
  // python: TestResolveWorkspace
  it("calls correct endpoint no double prefix", async () => {
    // python: test_calls_correct_endpoint_no_double_prefix
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

  it("writes to resolve workspace ID cache", async () => {
    // python: test_writes_to_resolve_workspace_id_cache
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

describe("App API edge cases", () => {
  // python: TestAppApiEdgeCases
  it("set workspace ID zero", () => {
    // python: test_set_workspace_id_zero
    const { client } = createMockClient(oauthSession(), () => ({
      status: 200,
      json: {},
    }));
    client.setWorkspaceId(0);
    expect(
      client.maybeScopedPath("dashboards").includes("/workspaces/0/"),
    ).toBe(true);
  });

  it("set workspace ID negative", () => {
    // python: test_set_workspace_id_negative
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

describe("List workspaces edge cases", () => {
  // python: TestListWorkspacesEdgeCases
  it("list workspaces string response", async () => {
    // python: test_list_workspaces_string_response
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

  it("list workspaces missing required fields", async () => {
    // python: test_list_workspaces_missing_required_fields
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

  it("list workspaces missing name raises coded error", async () => {
    // python: test_list_workspaces_missing_name_raises_coded_error
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

describe("Resolve workspace ID with resolver", () => {
  // python: TestResolveWorkspaceIdWithResolver
  it("resolver hit skips public endpoint and caches", async () => {
    // python: test_resolver_hit_skips_public_endpoint_and_caches
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
    await expect(client.resolveWorkspaceId()).resolves.toBe(4521297);
    await expect(client.resolveWorkspaceId()).resolves.toBe(4521297);
    expect(resolverCalls).toBe(1);
    expect(calls.some((p) => p.includes("workspaces/public"))).toBe(false);
  });

  it("explicit workspace skips resolver", async () => {
    // python: test_explicit_workspace_skips_resolver
    let resolverCalls = 0;
    const { client } = createMockClient(sessionNoWs(), () => emptyResults);
    client.setWorkspaceId(4521297);
    client.setWorkspaceResolver(() => {
      resolverCalls += 1;
      return null;
    });
    await expect(client.resolveWorkspaceId()).resolves.toBe(4521297);
    expect(resolverCalls).toBe(0);
  });

  it("falls back to public when resolver returns null", async () => {
    // python: test_falls_back_to_public_when_resolver_returns_none
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
    await expect(client.resolveWorkspaceId()).resolves.toBe(11);
  });

  it("metadata fallback when public empty", async () => {
    // python: test_metadata_fallback_when_public_empty
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
    await expect(client.resolveWorkspaceId()).resolves.toBe(4521297);
  });

  it("raises when nothing resolves", async () => {
    // python: test_raises_when_nothing_resolves
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

  it("no resolver preserves public path", async () => {
    // python: test_no_resolver_preserves_public_path
    const { client } = createMockClient(sessionNoWs(), () => ({
      status: 200,
      json: {
        results: [
          { id: 55, name: "Default", project_id: 4025120, is_default: true },
        ],
      },
    }));
    await expect(client.resolveWorkspaceId()).resolves.toBe(55);
  });

  it("public 403 falls through to metadata", async () => {
    // python: test_public_403_falls_through_to_metadata
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
    await expect(client.resolveWorkspaceId()).resolves.toBe(4521297);
  });

  it("public server error propagates", async () => {
    // python: test_public_server_error_propagates
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

  it("metadata result is cached", async () => {
    // python: test_metadata_result_is_cached
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
    await expect(client.resolveWorkspaceId()).resolves.toBe(7);
    await expect(client.resolveWorkspaceId()).resolves.toBe(7);
    expect(calls.filter((p) => p.includes("metadata/index"))).toHaveLength(1);
  });

  it("maybe scoped path stays project scoped without workspace", () => {
    // python: test_maybe_scoped_path_stays_project_scoped_without_workspace
    const { client } = createMockClient(sessionNoWs(), () => emptyResults);
    expect(client.maybeScopedPath("data-definitions/events/")).toBe(
      "/projects/4025120/data-definitions/events/",
    );
  });
});

describe("Projects metadata index", () => {
  // python: TestProjectsMetadataIndex
  it("returns project keyed mapping", async () => {
    // python: test_returns_project_keyed_mapping
    const { client } = createMockClient(sessionNoWs(), () => ({
      status: 200,
      json: { results: { "4025120": { name: "demo" } } },
    }));
    await expect(client.projectsMetadataIndex()).resolves.toStrictEqual({
      "4025120": { name: "demo" },
    });
  });

  it("resolver prefers default when no global", async () => {
    // python: test_resolver_prefers_default_when_no_global
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
    await expect(client.resolveWorkspaceId()).resolves.toBe(2);
  });

  it("resolver null when project absent", async () => {
    // python: test_resolver_none_when_project_absent
    const { client } = createMockClient(sessionNoWs(), () => ({
      status: 200,
      json: { results: { "9999": { workspaces: {} } } },
    }));
    await expect(client.resolveWorkspaceFromMetadata()).resolves.toBeNull();
  });

  it("resolver null when workspaces missing", async () => {
    // python: test_resolver_none_when_workspaces_missing
    const { client } = createMockClient(sessionNoWs(), () => ({
      status: 200,
      json: { results: { "4025120": { name: "demo" } } },
    }));
    await expect(client.resolveWorkspaceFromMetadata()).resolves.toBeNull();
  });

  it("resolver skips non numeric IDs", async () => {
    // python: test_resolver_skips_non_numeric_ids
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
    await expect(client.resolveWorkspaceFromMetadata()).resolves.toBe(42);
  });

  it("resolver propagates server error", async () => {
    // python: test_resolver_propagates_server_error
    const { client } = createMockClient(
      sessionNoWs(),
      () => ({ status: 500, json: { error: "boom" } }),
      // Python's fixture uses the default max_retries=3; 5xx never
      // retries, so the default stays.
    );
    await expect(client.resolveWorkspaceFromMetadata()).rejects.toBeInstanceOf(
      ServerError,
    );
  });

  it("resolver returns null on 404", async () => {
    // python: test_resolver_returns_none_on_404
    const { client } = createMockClient(sessionNoWs(), () => ({
      status: 404,
      json: { error: "not found" },
    }));
    await expect(client.resolveWorkspaceFromMetadata()).resolves.toBeNull();
  });

  it("resolver propagates unexpected query error", async () => {
    // python: test_resolver_propagates_unexpected_query_error
    const { client } = createMockClient(sessionNoWs(), () => ({
      status: 400,
      json: { error: "bad request" },
    }));
    await expect(client.resolveWorkspaceFromMetadata()).rejects.toBeInstanceOf(
      QueryError,
    );
  });

  it("resolver null when all IDs invalid", async () => {
    // python: test_resolver_none_when_all_ids_invalid
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
    await expect(client.resolveWorkspaceFromMetadata()).resolves.toBeNull();
  });

  it("resolver propagates auth error", async () => {
    // python: test_resolver_propagates_auth_error
    const { client } = createMockClient(sessionNoWs(), () => ({
      status: 401,
      json: { error: "unauthorized" },
    }));
    await expect(client.resolveWorkspaceFromMetadata()).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("resolver propagates rate limit error", async () => {
    // python: test_resolver_propagates_rate_limit_error
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
