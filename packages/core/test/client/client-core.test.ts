// Layer-3 translation — Phase-3 packet B4-C1 client-core locks. Sources:
//
// - tests/unit/test_api_client.py::TestClientInit (:118-143),
//   ::TestClientLifecycle (:146-168), ::TestAuthHeader (:172-278),
//   ::TestAPIClientProperties (:1828-1856)
// - tests/unit/test_api_client_session.py — ALL classes (:56-368)
//
// Entry-point substitutions (documented per packet C1 §Layer-3 /
// B0-notes decision 13): httpx.MockTransport → the injected-fetch fake
// (`client-test-helpers.ts`); `client._client`/`client._http` identity →
// the `HttpHandle` pool token (`isHttpOpen()`/`httpHandle()` — the R6.2
// invariant object); `client._get_auth_header()` /
// `client.current_auth_header` → `client.currentAuthHeader()` (async
// per R3.1: TS token resolution is I/O); `client._timeout` etc. →
// `client.core.timeoutSeconds` etc.; Python `with client:` →
// `ensureHttpOpen()` + `close()`. Every assertion is otherwise
// preserved 1:1 (R10.2).
import { describe, expect, it } from "vitest";

import type {
  OAuthBrowserAccount,
  OAuthTokenAccount,
  TokenResolver,
} from "../../src/auth/account.js";
import type { Session } from "../../src/auth/session.js";
import { createMixpanelClient } from "../../src/client/client.js";
import { OAuthError } from "../../src/errors.js";
import { Secret } from "../../src/secret.js";
import {
  createMockClient,
  makeSession,
  staticTokenResolver,
} from "../../test-support/client-test-helpers.js";

/** The `session_team` fixture (test_api_client_session.py:28-39). */
function sessionTeam(): Session {
  return {
    account: {
      type: "service_account",
      name: "team",
      region: "us",
      username: "team.sa",
      secret: new Secret("team-secret"),
    },
    project: { id: "3713224" },
    headers: new Map(),
  };
}

/** The `session_other` fixture (test_api_client_session.py:42-53). */
function sessionOther(): Session {
  return {
    account: {
      type: "service_account",
      name: "other",
      region: "eu",
      username: "other.sa",
      secret: new Secret("other-secret"),
    },
    project: { id: "9999999" },
    headers: new Map(),
  };
}

/** Decode the Basic payload of an Authorization header value. */
function decodeBasic(header: string): string {
  return atob(header.replace("Basic ", ""));
}

describe("TestClientInit", () => {
  it("test_init_with_credentials", async () => {
    const session = makeSession();
    const client = createMixpanelClient({ session });
    expect(client.session).toBe(session);
    await client.close();
  });

  it("test_init_with_custom_timeout", async () => {
    const client = createMixpanelClient({
      session: makeSession(),
      timeoutSeconds: 60.0,
    });
    expect(client.core.timeoutSeconds).toBe(60.0);
    await client.close();
  });

  it("test_init_with_custom_export_timeout", async () => {
    const client = createMixpanelClient({
      session: makeSession(),
      exportTimeoutSeconds: 600.0,
    });
    expect(client.core.exportTimeoutSeconds).toBe(600.0);
    await client.close();
  });

  it("test_init_with_max_retries", async () => {
    const client = createMixpanelClient({
      session: makeSession(),
      maxRetries: 5,
    });
    expect(client.core.maxRetries).toBe(5);
    await client.close();
  });
});

describe("TestClientLifecycle", () => {
  it("test_context_manager", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: ["event1"],
    }));
    // `with client:` runs __enter__._ensure_client(); asyncDispose is
    // the R6.2 exit analog.
    client.ensureHttpOpen();
    expect(client.isHttpOpen()).toBe(true);
    await client[Symbol.asyncDispose]();
    expect(client.isHttpOpen()).toBe(false);
  });

  it("test_close_releases_resources", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: [],
    }));
    client.ensureHttpOpen();
    expect(client.isHttpOpen()).toBe(true);
    await client.close();
    expect(client.isHttpOpen()).toBe(false);
  });
});

describe("TestAuthHeader", () => {
  it("test_auth_header_format", async () => {
    const client = createMixpanelClient({ session: makeSession() });
    const header = await client.currentAuthHeader();
    expect(header.startsWith("Basic ")).toBe(true);
    expect(decodeBasic(header)).toBe("test_user:test_secret");
    await client.close();
  });

  it("test_oauth_session_resolves_bearer_per_request", async () => {
    let calls = 0;
    const resolver: TokenResolver = {
      getBrowserToken(): Promise<string> {
        calls += 1;
        return Promise.resolve(`tok-${calls}`);
      },
      getStaticToken(): Promise<string> {
        throw new Error("static token path should not be hit");
      },
    };
    const account: OAuthBrowserAccount = {
      type: "oauth_browser",
      name: "alice",
      region: "us",
      default_project: "12345",
    };
    const client = createMixpanelClient({
      session: { account, project: { id: "12345" }, headers: new Map() },
      tokenResolver: resolver,
    });
    try {
      // OAuth bearers are not cached: every resolution hits the
      // resolver, so a refreshed token surfaces on the next request.
      expect(calls).toBe(0);
      const first = await client.currentAuthHeader();
      const second = await client.currentAuthHeader();
      expect(first).toBe("Bearer tok-1");
      expect(second).toBe("Bearer tok-2");
      expect(calls).toBe(2);
      // current_auth_header (public) routes through the same path.
      await expect(client.currentAuthHeader()).resolves.toBe("Bearer tok-3");
      expect(calls).toBe(3);
    } finally {
      await client.close();
    }
  });

  it("test_service_account_session_uses_basic_auth_no_resolver_call", async () => {
    const resolver: TokenResolver = {
      getBrowserToken(): Promise<string> {
        throw new Error("browser token path should not run for SA");
      },
      getStaticToken(): Promise<string> {
        throw new Error("static token path should not run for SA");
      },
    };
    const client = createMixpanelClient({
      session: {
        account: {
          type: "service_account",
          name: "team",
          region: "us",
          username: "sa-user",
          secret: new Secret("sa-secret"),
          default_project: "12345",
        },
        project: { id: "12345" },
        headers: new Map(),
      },
      tokenResolver: resolver,
    });
    try {
      const header = await client.currentAuthHeader();
      expect(header.startsWith("Basic ")).toBe(true);
    } finally {
      await client.close();
    }
  });
});

describe("TestAPIClientProperties", () => {
  it("test_project_id_property", async () => {
    const client = createMixpanelClient({ session: makeSession() });
    expect(client.projectId).toBe("12345");
    await client.close();
  });

  it("test_region_property_us", async () => {
    const client = createMixpanelClient({ session: makeSession() });
    expect(client.region).toBe("us");
    await client.close();
  });

  it("test_region_property_eu", async () => {
    const client = createMixpanelClient({
      session: makeSession({ region: "eu" }),
    });
    expect(client.region).toBe("eu");
    await client.close();
  });

  it("test_region_property_india", async () => {
    const client = createMixpanelClient({
      session: makeSession({ region: "in" }),
    });
    expect(client.region).toBe("in");
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// tests/unit/test_api_client_session.py — ALL classes.
// ---------------------------------------------------------------------------

describe("TestConstruction", () => {
  it("test_construct_with_session", () => {
    const client = createMixpanelClient({ session: sessionTeam() });
    expect(client.session.account.name).toBe("team");
    expect(client.session.project.id).toBe("3713224");
  });

  it("test_auth_header_basic", async () => {
    const client = createMixpanelClient({ session: sessionTeam() });
    expect((await client.currentAuthHeader()).startsWith("Basic ")).toBe(true);
  });
});

describe("TestUse", () => {
  it("test_use_workspace", async () => {
    const client = createMixpanelClient({ session: sessionTeam() });
    await client.use({ workspace: 42 });
    expect(client.session.workspace).toStrictEqual({ id: 42 });
  });

  it("test_use_project", async () => {
    const client = createMixpanelClient({ session: sessionTeam() });
    await client.use({ project: { id: "11111" } });
    expect(client.session.project.id).toBe("11111");
  });

  it("test_use_account_rebuilds_auth_header", async () => {
    const client = createMixpanelClient({ session: sessionTeam() });
    const before = await client.currentAuthHeader();
    await client.use({ account: sessionOther().account });
    await expect(client.currentAuthHeader()).resolves.not.toBe(before);
    expect(client.session.account.name).toBe("other");
  });
});

describe("TestTransportPreservation", () => {
  it("test_workspace_switch", async () => {
    const client = createMixpanelClient({ session: sessionTeam() });
    const before = client.httpHandle();
    await client.use({ workspace: 42 });
    expect(client.httpHandle()).toBe(before);
  });

  it("test_project_switch", async () => {
    const client = createMixpanelClient({ session: sessionTeam() });
    const before = client.httpHandle();
    await client.use({ project: { id: "11111" } });
    expect(client.httpHandle()).toBe(before);
  });

  it("test_account_switch", async () => {
    const client = createMixpanelClient({ session: sessionTeam() });
    const before = client.httpHandle();
    await client.use({ account: sessionOther().account });
    expect(client.httpHandle()).toBe(before);
  });
});

describe("TestUseClearsStaleWorkspaceId", () => {
  it("test_account_swap_clears_workspace_id", async () => {
    const teamWithWs: Session = {
      ...sessionTeam(),
      workspace: { id: 42 },
    };
    const client = createMixpanelClient({ session: teamWithWs });
    expect(client.workspaceId).toBe(42);
    await client.use({ account: sessionOther().account });
    expect(client.workspaceId).toBeNull();
  });

  it("test_project_swap_clears_workspace_id", async () => {
    const teamWithWs: Session = {
      ...sessionTeam(),
      workspace: { id: 42 },
    };
    const client = createMixpanelClient({ session: teamWithWs });
    expect(client.workspaceId).toBe(42);
    await client.use({ project: { id: "11111" } });
    expect(client.workspaceId).toBeNull();
  });

  it("test_account_swap_then_scoped_path_does_not_leak_old_workspace", async () => {
    const teamWithWs: Session = {
      ...sessionTeam(),
      workspace: { id: 42 },
    };
    const client = createMixpanelClient({ session: teamWithWs });
    await client.use({ account: sessionOther().account });
    const path = client.maybeScopedPath("dashboards");
    expect(path.includes("/workspaces/42/")).toBe(false);
    // Project-scoped (not workspace-scoped) is the expected fallback.
    expect(path.startsWith("/projects/")).toBe(true);
  });
});

describe("TestUseOAuthAtomicity", () => {
  /** Always fails — simulates a tokenless OAuth account. */
  const failingResolver: TokenResolver = {
    getBrowserToken(): Promise<string> {
      return Promise.reject(new OAuthError("no tokens on disk"));
    },
    getStaticToken(): Promise<string> {
      return Promise.reject(new OAuthError("no static token"));
    },
  };

  it("test_use_to_oauth_account_without_token_raises_and_preserves_session", async () => {
    const client = createMixpanelClient({
      session: sessionTeam(),
      tokenResolver: failingResolver,
    });
    const priorSession = client.session;
    const priorHeader = await client.currentAuthHeader();

    const oauthAccount: OAuthBrowserAccount = {
      type: "oauth_browser",
      name: "oauth1",
      region: "us",
    };
    await expect(client.use({ account: oauthAccount })).rejects.toBeInstanceOf(
      OAuthError,
    );

    // Atomicity: the prior session and auth header survive.
    expect(client.session).toBe(priorSession);
    await expect(client.currentAuthHeader()).resolves.toBe(priorHeader);
  });

  it("test_use_to_oauth_token_account_without_token_raises", async () => {
    const client = createMixpanelClient({
      session: sessionTeam(),
      tokenResolver: failingResolver,
    });
    const priorSession = client.session;

    const oauthTokenAccount: OAuthTokenAccount = {
      type: "oauth_token",
      name: "ot1",
      region: "us",
      token_env: "MISSING_ENV_VAR",
    };
    await expect(
      client.use({ account: oauthTokenAccount }),
    ).rejects.toBeInstanceOf(OAuthError);
    expect(client.session).toBe(priorSession);
  });
});

describe("TestSessionAccountNameDrivesMeCacheScope", () => {
  it("test_distinct_oauth_browser_accounts_have_distinct_names", () => {
    const sessionA: Session = {
      account: { type: "oauth_browser", name: "account_a", region: "us" },
      project: { id: "3713224" },
      headers: new Map(),
    };
    const sessionB: Session = {
      account: { type: "oauth_browser", name: "account_b", region: "us" },
      project: { id: "3713224" },
      headers: new Map(),
    };
    expect(sessionA.account.name).toBe("account_a");
    expect(sessionB.account.name).toBe("account_b");
    expect(sessionA.account.name).not.toBe(sessionB.account.name);
  });

  it("test_oauth_token_account_name_drives_cache_scope", () => {
    const session: Session = {
      account: {
        type: "oauth_token",
        name: "my_token_account",
        region: "us",
        token: new Secret("xyz"),
      },
      project: { id: "3713224" },
      headers: new Map(),
    };
    expect(session.account.name).toBe("my_token_account");
  });
});

describe("TestAppRequestUsesFreshAuthHeader", () => {
  it("test_oauth_browser_app_request_picks_up_refreshed_token", async () => {
    const capturedHeaders: string[] = [];
    let calls = 0;
    const rotatingResolver: TokenResolver = {
      getBrowserToken(): Promise<string> {
        calls += 1;
        return Promise.resolve(`refreshed-token-${calls}`);
      },
      getStaticToken(): Promise<string> {
        throw new Error("NotImplementedError");
      },
    };
    const session: Session = {
      account: { type: "oauth_browser", name: "rotating", region: "us" },
      project: { id: "3713224" },
      headers: new Map(),
    };
    const { client } = createMockClient(
      session,
      (request) => {
        capturedHeaders.push(request.headers["authorization"] ?? "");
        return { status: 200, json: { status: "ok", results: [] } };
      },
      { tokenResolver: rotatingResolver },
    );
    await client.appRequest("GET", "/projects/3713224/dashboards");
    await client.appRequest("GET", "/projects/3713224/dashboards");
    await client.close();

    // Each app_request resolved a fresh bearer — no caching.
    expect(capturedHeaders).toStrictEqual([
      "Bearer refreshed-token-1",
      "Bearer refreshed-token-2",
    ]);
  });

  it("test_oauth_static_token_app_request_uses_resolver", async () => {
    const capturedHeaders: string[] = [];
    const session: Session = {
      account: {
        type: "oauth_token",
        name: "ci",
        region: "us",
        token_env: "MP_CI_TOKEN",
      },
      project: { id: "3713224" },
      headers: new Map(),
    };
    const { client } = createMockClient(
      session,
      (request) => {
        capturedHeaders.push(request.headers["authorization"] ?? "");
        return { status: 200, json: { status: "ok", results: [] } };
      },
      {
        tokenResolver: {
          getBrowserToken(): Promise<string> {
            throw new Error("NotImplementedError");
          },
          getStaticToken(): Promise<string> {
            return Promise.resolve("ci-bearer");
          },
        },
      },
    );
    await client.appRequest("GET", "/projects/3713224/dashboards");
    await client.close();
    expect(capturedHeaders).toStrictEqual(["Bearer ci-bearer"]);
  });
});

// Static resolver helper sanity (rig-side helper, not a Python twin —
// keeps the fixture honest for the suites above).
describe("staticTokenResolver helper", () => {
  it("resolves inline oauth_token bearers", async () => {
    const session = makeSession({ oauthToken: "test-oauth-token" });
    const resolver = staticTokenResolver();
    const token = await resolver.getStaticToken(
      session.account as OAuthTokenAccount,
    );
    expect(token).toBe("test-oauth-token");
  });
});
