// Layer-3 translation — B4-ARB resolution of the assertions-review
// MAJOR finding (b4-review-assertions.md F1): the three
// tests/unit/test_api_client.py classes the C1 shard dropped without an
// exclusion header. Sources:
//
// - tests/unit/test_api_client.py::TestAuthenticatedRequests
// - tests/unit/test_api_client.py::TestWithProject
// - tests/unit/test_api_client.py::TestClientIdentificationHeaders
//
// Entry-point substitutions (B0-notes decision 13 + packet C1 table):
// httpx.MockTransport → the injected-fetch fake (client-test-helpers);
// `client._session` → `client.core.session()`; `client._timeout` /
// `client._export_timeout` / `client._max_retries` →
// `client.core.timeoutSeconds` / `.exportTimeoutSeconds` /
// `.maxRetries`; `client._transport is transport` → injected-fetch
// identity through `client.core.http().fetchImpl`; the
// `monkeypatch.setenv(MP_CUSTOM_HEADER_*)` pair → the injected
// `getCustomHeaderEnv` provider (R9.1 env boundary); the Python UA
// runtime tag `python/<x.y>` → `ts` (B0-notes decision 8 — the UA is
// telemetry, never vector-byte-locked). Every other assertion is
// preserved 1:1.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMixpanelClient } from "../../src/client/client.js";
import {
  type EntryPoint,
  getEntryPoint,
  setEntryPoint,
} from "../../src/client/headers.js";
import { AuthenticationError } from "../../src/errors.js";
import {
  createMockClient,
  drain,
  fakeTransport,
  makeSession,
  staticTokenResolver,
} from "../../test-support/client-test-helpers.js";

/** The `eu_credentials` fixture. */
function euCredentials(): ReturnType<typeof makeSession> {
  return makeSession({ region: "eu" });
}

/** The `india_credentials` fixture. */
function indiaCredentials(): ReturnType<typeof makeSession> {
  return makeSession({ region: "in" });
}

describe("Authenticated requests", () => {
  // python: TestAuthenticatedRequests
  it("auth header sent", async () => {
    // python: test_auth_header_sent
    const { client, transport } = createMockClient(makeSession(), () => ({
      status: 200,
      json: ["event1"],
    }));
    await client.getEvents();
    const captured = transport.captures[0];
    expect(captured).toBeDefined();
    expect(Object.hasOwn(captured?.headers ?? {}, "authorization")).toBe(true);
    expect(captured?.headers["authorization"]?.startsWith("Basic ")).toBe(true);
  });

  it("project ID in query params", async () => {
    // python: test_project_id_in_query_params
    const { client, transport } = createMockClient(makeSession(), () => ({
      status: 200,
      json: ["event1"],
    }));
    await client.getEvents();
    expect(transport.captures[0]?.url).toContain("project_id=12345");
  });

  it("authentication error on 401", async () => {
    // python: test_authentication_error_on_401
    const { client } = createMockClient(makeSession(), () => ({
      status: 401,
      json: { error: "Invalid credentials" },
    }));
    let raised: unknown = null;
    try {
      await client.getEvents();
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(AuthenticationError);
    expect(String(raised).toLowerCase()).toContain("credentials");
  });

  it("credentials not in error messages", async () => {
    // python: test_credentials_not_in_error_messages
    const { client } = createMockClient(makeSession(), () => ({
      status: 401,
      json: { error: "Auth failed" },
    }));
    let raised: unknown = null;
    try {
      await client.getEvents();
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(AuthenticationError);
    const errorStr = String(raised);
    expect(errorStr).not.toContain("test_secret");
    expect(errorStr).not.toContain("test_user");
  });

  it("regional routing us", async () => {
    // python: test_regional_routing_us
    const { client, transport } = createMockClient(makeSession(), () => ({
      status: 200,
      json: ["event1"],
    }));
    await client.getEvents();
    expect(transport.captures[0]?.url).toContain("mixpanel.com");
  });

  it("regional routing EU", async () => {
    // python: test_regional_routing_eu
    const { client, transport } = createMockClient(euCredentials(), () => ({
      status: 200,
      json: ["event1"],
    }));
    await client.getEvents();
    expect(transport.captures[0]?.url).toContain("eu.mixpanel.com");
  });

  it("regional routing india", async () => {
    // python: test_regional_routing_india
    const { client, transport } = createMockClient(indiaCredentials(), () => ({
      status: 200,
      json: ["event1"],
    }));
    await client.getEvents();
    expect(transport.captures[0]?.url).toContain("in.mixpanel.com");
  });
});

describe("With project", () => {
  // python: TestWithProject
  it("with project creates new client", () => {
    // python: test_with_project_creates_new_client
    const original = createMixpanelClient({ session: makeSession() });
    const newClient = original.withProject("9999999");
    expect(newClient).not.toBe(original);
    expect(newClient.core.session().project.id).toBe("9999999");
  });

  it("with project preserves auth", () => {
    // python: test_with_project_preserves_auth
    const session = makeSession();
    const original = createMixpanelClient({ session });
    const newClient = original.withProject("9999999");
    const newAccount = newClient.core.session().account;
    expect(newAccount.type).toBe("service_account");
    expect(session.account.type).toBe("service_account");
    if (
      newAccount.type !== "service_account" ||
      session.account.type !== "service_account"
    ) {
      throw new Error("unreachable — narrowed above");
    }
    expect(newAccount.username).toBe(session.account.username);
    expect(newAccount.secret.reveal()).toBe(session.account.secret.reveal());
  });

  it("with project preserves region", () => {
    // python: test_with_project_preserves_region
    const original = createMixpanelClient({ session: euCredentials() });
    const newClient = original.withProject("9999999");
    expect(newClient.core.session().account.region).toBe("eu");
  });

  it("with project sets workspace ID", () => {
    // python: test_with_project_sets_workspace_id
    const original = createMixpanelClient({ session: makeSession() });
    const newClient = original.withProject("9999999", 42);
    expect(newClient.workspaceId).toBe(42);
  });

  it("with project no workspace ID", () => {
    // python: test_with_project_no_workspace_id
    const original = createMixpanelClient({ session: makeSession() });
    const newClient = original.withProject("9999999");
    expect(newClient.workspaceId).toBeNull();
  });

  it("with project preserves timeouts", () => {
    // python: test_with_project_preserves_timeouts
    const original = createMixpanelClient({
      session: makeSession(),
      timeoutSeconds: 30.0,
      exportTimeoutSeconds: 300.0,
    });
    const newClient = original.withProject("9999999");
    expect(newClient.core.timeoutSeconds).toBe(30.0);
    expect(newClient.core.exportTimeoutSeconds).toBe(300.0);
  });

  it("with project preserves max retries", () => {
    // python: test_with_project_preserves_max_retries
    const original = createMixpanelClient({
      session: makeSession(),
      maxRetries: 5,
    });
    const newClient = original.withProject("9999999");
    expect(newClient.core.maxRetries).toBe(5);
  });

  it("with project shares transport", () => {
    // python: test_with_project_shares_transport
    const transport = fakeTransport(() => ({
      status: 200,
      json: { ok: true },
    }));
    const original = createMixpanelClient({
      session: makeSession(),
      fetch: transport.fetch,
    });
    const newClient = original.withProject("9999999");
    expect(newClient.core.http().fetchImpl).toBe(transport.fetch);
  });

  it("with project preserves OAuth credentials", () => {
    // python: test_with_project_preserves_oauth_credentials
    const oauthCreds = makeSession({
      projectId: "12345",
      region: "us",
      oauthToken: "my-oauth-token",
    });
    const original = createMixpanelClient({
      session: oauthCreds,
      tokenResolver: staticTokenResolver(),
    });
    const newClient = original.withProject("9999999");
    const account = newClient.core.session().account;
    expect(account.type).toBe("oauth_token");
    if (account.type !== "oauth_token") {
      throw new Error("unreachable — narrowed above");
    }
    expect(account.token).not.toBeNull();
    expect(account.token?.reveal()).toBe("my-oauth-token");
  });
});

describe("Client identification headers", () => {
  // python: TestClientIdentificationHeaders
  // The autouse `_reset_entry_point` fixture: pin "lib"
  // for deterministic assertions; restore the prior value on teardown.
  let originalEntryPoint: EntryPoint;
  beforeEach(() => {
    originalEntryPoint = getEntryPoint();
    setEntryPoint("lib");
  });
  afterEach(() => {
    setEntryPoint(originalEntryPoint);
  });

  it("user agent set on standard request", async () => {
    // python: test_user_agent_set_on_standard_request
    const { client, transport } = createMockClient(makeSession(), () => ({
      status: 200,
      json: ["event1"],
    }));
    await client.getEvents();
    const ua = transport.captures[0]?.headers["user-agent"] ?? "";
    expect(ua.startsWith("mixpanel-headless/")).toBe(true);
    expect(ua).toContain("entry=lib");
    // Python asserts `"python/" in ua`; the TS runtime tag is `ts`
    // (B0-notes decision 8 — documented substitution).
    expect(ua).toContain("ts");
  });

  it("user agent set on app request", async () => {
    // python: test_user_agent_set_on_app_request
    const { client, transport } = createMockClient(makeSession(), () => ({
      status: 200,
      json: { results: [] },
    }));
    await client.appRequest("GET", "/projects/12345/dashboards");
    const ua = transport.captures[0]?.headers["user-agent"] ?? "";
    expect(ua.startsWith("mixpanel-headless/")).toBe(true);
  });

  it("user agent set on export stream", async () => {
    // python: test_user_agent_set_on_export_stream
    const { client, transport } = createMockClient(makeSession(), () => ({
      status: 200,
      text: '{"event":"A","properties":{"time":1}}\n',
    }));
    await drain(client.exportEvents("2024-01-01", "2024-01-31"));
    const ua = transport.captures[0]?.headers["user-agent"] ?? "";
    expect(ua.startsWith("mixpanel-headless/")).toBe(true);
  });

  it("user agent reflects CLI entry point", async () => {
    // python: test_user_agent_reflects_cli_entry_point
    const { client, transport } = createMockClient(makeSession(), () => ({
      status: 200,
      json: ["event1"],
    }));
    setEntryPoint("cli");
    await client.getEvents();
    expect(transport.captures[0]?.headers["user-agent"]).toContain("entry=cli");
  });

  it("session headers override user agent", async () => {
    // python: test_session_headers_override_user_agent
    const session = makeSession({
      name: "team",
      username: "team.sa",
      secret: "team-secret",
      headers: new Map([["User-Agent", "custom-tester/1.0"]]),
    });
    const { client, transport } = createMockClient(session, () => ({
      status: 200,
      json: ["event1"],
    }));
    await client.getEvents();
    expect(transport.captures[0]?.headers["user-agent"]).toBe(
      "custom-tester/1.0",
    );
  });

  it("mp custom header can override user agent", async () => {
    // python: test_mp_custom_header_can_override_user_agent
    // `monkeypatch.setenv(MP_CUSTOM_HEADER_*)` → the injected env
    // provider (R9.1: `core` never reads process.env).
    const { client, transport } = createMockClient(
      makeSession(),
      () => ({ status: 200, json: ["event1"] }),
      {
        getCustomHeaderEnv: () => ({ name: "User-Agent", value: "env-ua/2.0" }),
      },
    );
    await client.getEvents();
    expect(transport.captures[0]?.headers["user-agent"]).toBe("env-ua/2.0");
  });

  it("caller extra header overrides default user agent", async () => {
    // python: test_caller_extra_header_overrides_default_user_agent
    const { client, transport } = createMockClient(makeSession(), () => ({
      status: 200,
      json: {},
    }));
    await client.request("GET", "https://mixpanel.com/api/app/test", {
      headers: { "User-Agent": "caller-ua/3.0" },
    });
    expect(transport.captures[0]?.headers["user-agent"]).toBe("caller-ua/3.0");
  });
});
