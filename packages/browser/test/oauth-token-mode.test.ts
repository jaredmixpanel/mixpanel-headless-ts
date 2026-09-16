// First-class oauth_token mode in the browser. Account/session assembly goes
// through core `parseAccount` / `parseSession`, the Authorization header
// through the core header path, and workspace-scoped App-API paths through
// the core client — no browser re-implementation.

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

describe("browserSession", () => {
  it("builds an oauth_token account with default name 'browser'", () => {
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

describe("createBrowserWorkspace", () => {
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

  it("sends no User-Agent header (a forbidden request header that Safari forwards into the CORS preflight)", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: [] }));
    const ws = createBrowserWorkspace({
      token: "tok-123",
      projectId: "12345",
      region: "us",
      fetch: transport.fetch,
    });
    await ws.client.getEvents();
    await ws.me();
    expect(transport.captures).toHaveLength(2);
    for (const capture of transport.captures) {
      expect(Object.hasOwn(capture.headers, "user-agent")).toBe(false);
      expect(capture.headers["authorization"]).toBe("Bearer tok-123");
    }
  });

  it("honors a caller-supplied clientOptions.getUserAgent", async () => {
    const transport = fakeTransport(() => ({ status: 200, json: [] }));
    const ws = createBrowserWorkspace({
      token: "tok-123",
      projectId: "12345",
      region: "us",
      fetch: transport.fetch,
      clientOptions: { getUserAgent: () => "my-app/1.0" },
    });
    await ws.client.getEvents();
    expect(transport.captures[0]?.headers["user-agent"]).toBe("my-app/1.0");
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

  // The "static token
  // unresolvable" condition matches the Python twin's code + details
  // (`OnDiskTokenResolver.get_static_token`, token_resolver.py
  // → OAUTH_TOKEN_ERROR {account_name, env_var}) so the condition is
  // uniform across runtimes; the MESSAGE stays browser-explanatory
  // (env reading is node-only; messages are out of contract).
  it("a hand-built token_env account refuses with OAUTH_TOKEN_ERROR {account_name, env_var}", async () => {
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

  it("an account with neither token nor token_env refuses with OAUTH_TOKEN_ERROR {account_name}", async () => {
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

describe("createBrowserWorkspaceFromStore", () => {
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
    // The store-backed factory shares the User-Agent omission.
    expect(Object.hasOwn(transport.captures[0]!.headers, "user-agent")).toBe(
      false,
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
