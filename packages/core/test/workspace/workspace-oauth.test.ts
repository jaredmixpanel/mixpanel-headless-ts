// Workspace over an OAuth session: construction with an injected token
// resolver, listWorkspaces and resolveWorkspaceId. Mirrors
// tests/unit/test_workspace_oauth.py; the httpx MockTransport handler becomes
// the createMockClient canned handler and `make_session(oauth_token=…)`
// becomes `makeSession({oauthToken})`. `set_workspace_id` is gone by design.

import { describe, expect, it } from "vitest";

import { PublicWorkspace } from "../../src/types/entities/common.js";
import { Workspace } from "../../src/workspace.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** The `_TEST_SESSION` twin. */
const TEST_SESSION = makeSession({
  name: "test_account",
  region: "us",
  projectId: "12345",
  username: "test_user",
  secret: "test_secret",
});

/** `_workspaces_json`. */
function workspacesJson(): unknown[] {
  return [
    {
      id: 100,
      name: "Default Workspace",
      project_id: 12345,
      is_default: true,
      description: "The default workspace",
      is_global: false,
      is_restricted: false,
      is_visible: true,
      created_iso: "2024-01-01T00:00:00Z",
      creator_name: "Admin",
    },
    {
      id: 200,
      name: "Dev Workspace",
      project_id: 12345,
      is_default: false,
      description: "Development workspace",
      is_global: false,
      is_restricted: false,
      is_visible: true,
      created_iso: "2024-02-01T00:00:00Z",
      creator_name: "Dev",
    },
  ];
}

/** `_make_workspace_handler`. */
function workspaceHandler(request: CapturedFetchRequest): CannedResponse {
  if (new URL(request.url).pathname.includes("workspaces/public")) {
    return { status: 200, json: { results: workspacesJson(), status: "ok" } };
  }
  return { status: 404, json: { error: "not found" } };
}

describe("Workspace construction with OAuth", () => {
  // python: TestWorkspaceConstructionWithOAuth
  it("an OAuth-typed session resolves through the oauth_token account path", () => {
    const oauthSession = makeSession({
      name: "test_account",
      region: "us",
      projectId: "12345",
      oauthToken: "test-oauth-token",
    });
    const { client } = createMockClient(oauthSession, workspaceHandler);

    const ws = new Workspace({ session: oauthSession, client });

    expect(ws.session.account.type).toBe("oauth_token");
  });

  it("a service-account session resolves through the ServiceAccount path", () => {
    const { client } = createMockClient(TEST_SESSION, () => ({
      status: 200,
      json: [],
    }));

    const ws = new Workspace({ session: TEST_SESSION, client });

    expect(ws.session.account.type).toBe("service_account");
    expect(
      ws.session.account.type === "service_account"
        ? ws.session.account.username
        : null,
    ).toBe("test_user");
  });
});

describe("Workspace list workspaces", () => {
  // python: TestWorkspaceListWorkspaces
  it("listWorkspaces() returns PublicWorkspace models", async () => {
    const { client } = createMockClient(TEST_SESSION, workspaceHandler);
    const ws = new Workspace({ session: TEST_SESSION, client });

    const workspaces = await ws.listWorkspaces();

    expect(workspaces).toHaveLength(2);
    expect(workspaces[0]).toBeInstanceOf(PublicWorkspace);
    expect(workspaces[0]?.name).toBe("Default Workspace");
    expect(workspaces[0]?.id).toBe(100);
    expect(workspaces[0]?.is_default).toBe(true);
    expect(workspaces[1]?.id).toBe(200);
  });

  it("listWorkspaces() returns an empty list when none exist", async () => {
    const { client } = createMockClient(TEST_SESSION, () => ({
      status: 200,
      json: { results: [], status: "ok" },
    }));
    const ws = new Workspace({ session: TEST_SESSION, client });

    await expect(ws.listWorkspaces()).resolves.toStrictEqual([]);
  });
});

describe("Workspace resolve workspace ID", () => {
  // python: TestWorkspaceResolveWorkspaceId
  it("resolveWorkspaceId() returns the default workspace ID", async () => {
    const { client } = createMockClient(TEST_SESSION, workspaceHandler);
    const ws = new Workspace({ session: TEST_SESSION, client });

    await expect(ws.resolveWorkspaceId()).resolves.toBe(100); // the default view
  });
});
