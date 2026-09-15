// Layer-3 suite for the first-class oauth_token mode (b9-packets.md
// §2.2; contract arbiter R9.3 "oauth_token mode first-class" + plan
// §4.3 Tier C). Where behavior HAS a Python twin the twin rules:
// - account/session assembly goes through core `parseAccount` /
//   `parseSession` (auth_types twins — never hand-assembled unions);
// - the Authorization header is built by the CORE header path
//   (`accountAuthHeader` — Python `_get_auth_header`);
// - workspace-scoped App-API paths come from the core client's
//   `maybe_scoped_path` twin (no browser re-implementation).

import { describe, expect, it } from "vitest";

import {
  ParamValidationError,
  parseAccount,
  parseSession,
  ResponseValidationError,
  type Session,
} from "@mixpanel-headless/core";

import { fakeTransport } from "../../core/test-support/client-test-helpers.js";
import {
  browserSession,
  createBrowserWorkspace,
  createBrowserWorkspaceFromStore,
  CREDENTIAL_KEYS,
  InMemoryCredentialStore,
} from "../src/index.js";

describe("browserSession (§2.2) — real parseAccount/parseSession output", () => {
  it("builds an oauth_token account with default name 'browser' (field spellings per R7.6)", () => {
    const session = browserSession({
      token: "tok-123",
      projectId: "12345",
      region: "us",
    });
    expect(session.account.type).toBe("oauth_token");
    expect(session.account.name).toBe("browser");
    expect(session.account.region).toBe("us");
    const token =
      session.account.type === "oauth_token"
        ? session.account.token?.reveal()
        : undefined;
    expect(token).toBe("tok-123");
    expect(session.project.id).toBe("12345");
    expect(session.workspace ?? null).toBeNull();
    expect(session.headers.size).toBe(0);
  });

  it("honors accountName and workspaceId", () => {
    const session = browserSession({
      token: "tok-123",
      projectId: "12345",
      region: "eu",
      workspaceId: 789,
      accountName: "ci-bot",
    });
    expect(session.account.name).toBe("ci-bot");
    expect(session.account.region).toBe("eu");
    expect(session.workspace).toStrictEqual({ id: 789 });
  });

  it("rejects a non-digit projectId at the param boundary", () => {
    let thrown: unknown;
    try {
      browserSession({ token: "t", projectId: "abc", region: "us" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ParamValidationError);
  });
});

describe("createBrowserWorkspace (§2.2) — core Workspace over a guarded transport", () => {
  it("Query-host call carries Authorization: Bearer <token> built by the core header path (byte-exact)", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: [] }));
    const ws = createBrowserWorkspace({
      token: "tok-123",
      projectId: "12345",
      region: "us",
      fetch: transport.fetch,
    });
    await ws.client.getEvents();
    expect(transport.captures.length).toBeGreaterThan(0);
    const capture = transport.captures[0]!;
    expect(capture.headers["authorization"]).toBe("Bearer tok-123");
    expect(new URL(capture.url).origin).toBe("https://mixpanel.com");
    expect(capture.params["project_id"]).toBe("12345");
  });

  it("workspace-scoped App-API path when workspaceId is set (maybe_scoped_path via the core client)", async () => {
    const transport = fakeTransport(() => ({
      status: 200,
      json: { results: [] },
    }));
    const ws = createBrowserWorkspace({
      token: "tok-123",
      projectId: "12345",
      region: "us",
      workspaceId: 789,
      fetch: transport.fetch,
    });
    await ws.client.listDashboards();
    const capture = transport.captures[0]!;
    // Python `maybe_scoped_path`: `/workspaces/{wid}/{domain}` when a
    // workspace is pinned (core `scope.ts` twin — no re-implementation).
    expect(capture.url).toContain("/api/app/workspaces/789/dashboards");
    expect(capture.headers["authorization"]).toBe("Bearer tok-123");
  });

  // B9-ARB-A SEM-F1 (b9-reviewA-resolution.md): the "static token
  // unresolvable" condition matches the Python twin's code + details
  // (`OnDiskTokenResolver.get_static_token`, token_resolver.py
  // → OAUTH_TOKEN_ERROR {account_name, env_var}) so the condition is
  // uniform across runtimes; the MESSAGE stays browser-explanatory
  // (env reading is node-only, R9.4 — out of contract per R5.4).
  it("token_env account (hand-built session) refuses with the Python-coded OAUTH_TOKEN_ERROR {account_name, env_var} (token_resolver.py:273-282 twin)", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: [] }));
    const session = parseSession(
      {
        account: parseAccount(
          {
            type: "oauth_token",
            name: "env-acct",
            region: "us",
            token_env: "MP_OAUTH_TOKEN",
          },
          { boundary: "param" },
        ),
        project: { id: "12345" },
      },
      { boundary: "param" },
    );
    const ws = createBrowserWorkspace({
      session,
      token: "unused",
      projectId: "12345",
      region: "us",
      fetch: transport.fetch,
    });
    await expect(ws.client.getEvents()).rejects.toMatchObject({
      code: "OAUTH_TOKEN_ERROR",
      details: { account_name: "env-acct", env_var: "MP_OAUTH_TOKEN" },
    });
    expect(transport.captures).toHaveLength(0);
  });

  it("neither-token-nor-token_env (model-invariant arm) refuses with OAUTH_TOKEN_ERROR {account_name} (token_resolver.py:267-272 twin)", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: [] }));
    // The XOR invariant makes this account shape unbuildable through
    // `parseAccount` — hand-built literal, exactly the Python
    // `pragma: no cover` model-invariant arm (survives without asserts).
    const session: Session = {
      account: { type: "oauth_token", name: "bare-acct", region: "us" },
      project: { id: "12345" },
      workspace: null,
      headers: new Map(),
    };
    const ws = createBrowserWorkspace({
      session,
      token: "unused",
      projectId: "12345",
      region: "us",
      fetch: transport.fetch,
    });
    await expect(ws.client.getEvents()).rejects.toMatchObject({
      code: "OAUTH_TOKEN_ERROR",
      details: { account_name: "bare-acct" },
    });
    expect(transport.captures).toHaveLength(0);
  });

  it("returns the REAL core Workspace facade (not a wrapper class)", () => {
    const ws = createBrowserWorkspace({
      token: "tok-123",
      projectId: "12345",
      region: "us",
      fetch: fakeTransport(() => ({ status: 200, json: [] })).fetch,
    });
    expect(ws.session.account.type).toBe("oauth_token");
    expect(ws.client.region).toBe("us");
    expect(typeof ws.use).toBe("function");
    expect(typeof ws.close).toBe("function");
  });
});

describe("createBrowserWorkspaceFromStore (§2.2) — PKCE-persisted tokens path", () => {
  /**
   * Seed a store with a tokens payload under the per-region key.
   *
   * @param expiresAt - Expiry text for the persisted tokens.
   * @returns The seeded store.
   */
  function seededStore(expiresAt: string): InMemoryCredentialStore {
    const store = new InMemoryCredentialStore();
    store.set(
      CREDENTIAL_KEYS.tokens("us"),
      JSON.stringify({
        access_token: "stored-tok",
        expires_at: expiresAt,
        scope: "projects analysis",
        token_type: "Bearer",
      }),
    );
    return store;
  }

  it("reads CREDENTIAL_KEYS.tokens(region), parses strictly, and issues Bearer <stored token>", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: [] }));
    const ws = await createBrowserWorkspaceFromStore({
      region: "us",
      projectId: "12345",
      store: seededStore("2030-01-01T00:00:00+00:00"),
      fetch: transport.fetch,
      now: () => Date.parse("2026-01-01T00:00:00Z"),
    });
    expect(ws.session.account.type).toBe("oauth_browser");
    await ws.client.getEvents();
    expect(transport.captures[0]!.headers["authorization"]).toBe(
      "Bearer stored-tok",
    );
  });

  it("refuses expired-with-no-refresh with the Python-coded OAUTH_TOKEN_ERROR", async () => {
    await expect(
      createBrowserWorkspaceFromStore({
        region: "us",
        projectId: "12345",
        store: seededStore("2020-01-01T00:00:00+00:00"),
        fetch: fakeTransport(() => ({ status: 200, json: [] })).fetch,
        now: () => Date.parse("2026-01-01T00:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "OAUTH_TOKEN_ERROR" });
  });

  it("refuses an ABSENT tokens record with OAUTH_TOKEN_ERROR", async () => {
    await expect(
      createBrowserWorkspaceFromStore({
        region: "us",
        projectId: "12345",
        store: new InMemoryCredentialStore(),
        fetch: fakeTransport(() => ({ status: 200, json: [] })).fetch,
      }),
    ).rejects.toMatchObject({ code: "OAUTH_TOKEN_ERROR" });
  });

  it("rejects malformed persisted tokens (strict parse — no lax read path)", async () => {
    const store = new InMemoryCredentialStore();
    store.set(
      CREDENTIAL_KEYS.tokens("us"),
      JSON.stringify({ access_token: "x" }), // missing required fields
    );
    await expect(
      createBrowserWorkspaceFromStore({
        region: "us",
        projectId: "12345",
        store,
        fetch: fakeTransport(() => ({ status: 200, json: [] })).fetch,
      }),
    ).rejects.toThrow(ResponseValidationError);
  });
});
