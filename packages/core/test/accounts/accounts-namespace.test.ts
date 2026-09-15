// Layer-3 translation of `tests/unit/test_accounts_namespace.py`
// (1,685 lines) — the non-login_unified classes (B7-A1 packet §3.4,
// `b7-packets.md`); the six `TestLoginUnified*` classes live in
// `login-unified.test.ts`.
//
// Mechanism substitutions (header-cited per R10.2):
// - the autouse tmp-`$HOME` / `MP_CONFIG_PATH` fixture becomes the
//   in-memory `makeEffects()` bundle (packet §3.4 row 1: "on-disk
//   fixtures re-express over injected tokenStore/config fakes");
// - `monkeypatch.setattr(MixpanelAPIClient, "me", …)` becomes the
//   injected `meFetch(payload)` fetch answering the REAL client's
//   `/me` request;
// - `monkeypatch.setattr(OAuthFlow, "login", …)` becomes an injected
//   `effects.oauthFlow.login` stub capturing its kwargs;
// - the `TestTestOAuthBrowser` on-disk token fixtures (missing /
//   expired / revoked tokens.json) re-express as `tokenResolver`
//   rejections carrying the same actionable messages (the
//   OnDiskTokenResolver failure surface — packet §3.4);
// - `TestLogoutHonorsStorageOverride`'s `MP_OAUTH_STORAGE_DIR`
//   override assertion re-expresses as "logout removes exactly the
//   injected store's entry" (path override wiring is B8's).
//
// EXCLUDED (decision recorded, packet §3.4 + plan D4):
// - `TestSummaryTableDynamicWidth` drives the CLI formatter
//   `cli.commands.account._format_summary_table` — the CLI is out of
//   the port's scope (plan D4). No library assertion to preserve.
// - `TestPublicSurface` asserts `accounts_ns.__all__`; the TS
//   twin asserts the `AccountsNamespace` object exposes all 13
//   public members (module `__all__` has no TS runtime analog).

import { describe, expect, it } from "vitest";

import { createAccountsNamespace } from "../../src/accounts/namespace.js";
import { OAuthTokens } from "../../src/auth/token.js";
import {
  AccountInUseError,
  ConfigError,
  OAuthError,
  RegionProbeNetworkError,
} from "../../src/errors.js";
import { Secret } from "../../src/secret.js";
import { AccountSummary } from "../../src/types/entities/accounts.js";
import { makeEffects, meFetch } from "./fake-auth-effects.js";

/** Shared SA add options (the `accounts_ns.add("team", …)` fixture). */
const SA_OPTS = {
  type: "service_account",
  region: "us",
  default_project: "3713224",
  username: "u",
  secret: new Secret("s"),
} as const;

/** Fresh tokens for the PKCE stubs (tz-aware, +1h). */
function freshTokens(access = "brw-tok-fresh"): OAuthTokens {
  const expires = new Date(Date.now() + 3600_000).toISOString();
  return new OAuthTokens({
    access_token: new Secret(access),
    refresh_token: new Secret("brw-refresh-fresh"),
    expires_at: expires,
    scope: "read:project",
    token_type: "Bearer",
  });
}

describe("Add", () => {
  // python: TestAdd
  it("adding a service account writes the record with default_project", async () => {
    const { effects, config } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    const result = await accounts.add("team", SA_OPTS);

    expect(result).toBeInstanceOf(AccountSummary);
    expect(result.name).toBe("team");
    expect(result.type).toBe("service_account");
    expect(config.getAccount("team").default_project).toBe("3713224");
  });

  it("SA may omit default_project at add-time (043 FR-001)", async () => {
    const { effects, config } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    const result = await accounts.add("team", {
      type: "service_account",
      region: "us",
      username: "u",
      secret: new Secret("s"),
    });

    expect(result.name).toBe("team");
    expect(result.type).toBe("service_account");
    expect(config.getAccount("team").default_project ?? null).toBeNull();
  });

  it("oauth_browser may omit default_project (backfilled at login)", async () => {
    const { effects, config } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    const result = await accounts.add("personal", {
      type: "oauth_browser",
      region: "eu",
    });

    expect(result.type).toBe("oauth_browser");
    expect(config.getAccount("personal").default_project ?? null).toBeNull();
  });

  it("oauth_browser may also pre-set default_project", async () => {
    const { effects, config } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    const result = await accounts.add("personal", {
      type: "oauth_browser",
      region: "eu",
      default_project: "12345",
    });

    expect(result.type).toBe("oauth_browser");
    expect(config.getAccount("personal").default_project).toBe("12345");
  });

  it("oauth_token with inline token works", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    const result = await accounts.add("ci", {
      type: "oauth_token",
      region: "us",
      default_project: "3713224",
      token: new Secret("ey.x"),
    });

    expect(result.type).toBe("oauth_token");
  });

  it("oauth_token with token_env works", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    const result = await accounts.add("agent", {
      type: "oauth_token",
      region: "us",
      default_project: "3713224",
      token_env: "MP_OAUTH_TOKEN",
    });

    expect(result.type).toBe("oauth_token");
  });

  it("oauth_token may omit default_project (043 FR-001)", async () => {
    const { effects, config } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    const result = await accounts.add("agent", {
      type: "oauth_token",
      region: "us",
      token: new Secret("ey.x"),
    });

    expect(result).toBeInstanceOf(AccountSummary);
    expect(result.type).toBe("oauth_token");
    expect(config.getAccount("agent").default_project ?? null).toBeNull();
  });

  it("first account auto-promotes to [active].account (FR-045)", async () => {
    const { effects, config } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    await accounts.add("first", SA_OPTS);

    expect(config.getActive().account).toBe("first");
  });

  it("a second account does NOT replace the active selection", async () => {
    const { effects, config } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    await accounts.add("first", SA_OPTS);
    await accounts.add("second", { type: "oauth_browser", region: "us" });

    expect(config.getActive().account).toBe("first");
  });

  it("adding an existing name raises ConfigError", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("x", SA_OPTS);

    await expect(
      accounts.add("x", { type: "oauth_browser", region: "us" }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  // B7-ARB-B B-E2E-F1 lock (spec-cited ADDITION, R10.2-safe): Python's
  // duplicate-add path raises PLAIN `ConfigError` (`config.py`,
  // code CONFIG_ERROR); `AccountExistsError` / ACCOUNT_EXISTS is
  // reserved for the login_unified name-collision path
  // (`accounts.py`). R5 makes the CODE the contract — pin it so
  // B8-N1's real ConfigWrites adapter cannot inherit the stronger
  // class from the interface JSDoc (`b7-reviewB-resolution.md`).
  it("duplicate add surfaces plain CONFIG_ERROR, never ACCOUNT_EXISTS", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("team", SA_OPTS);

    let caught: unknown = null;
    try {
      await accounts.add("team", { type: "oauth_browser", region: "us" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const err = caught as ConfigError;
    expect(err.code).toBe("CONFIG_ERROR");
    expect(err.constructor).toBe(ConfigError);
    expect(err.message).toBe("Account 'team' already exists.");
  });

  it("re-add with region null fails fast — no probe, region preserved", async () => {
    const { effects, config } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("x", {
      type: "service_account",
      region: "us",
      username: "u",
      secret: new Secret("s"),
    });

    // region=None must raise before any HTTP attempt (fetchImpl in
    // this bundle rejects, so reaching a probe would fail differently).
    await expect(
      accounts.add("x", {
        type: "service_account",
        region: null,
        username: "u",
        secret: new Secret("s"),
      }),
    ).rejects.toBeInstanceOf(ConfigError);
    expect(config.getAccount("x").region).toBe("us");
  });

  it("SA without region raises an actionable ConfigError naming mp login", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    let caught: unknown = null;
    try {
      await accounts.add("team", {
        type: "service_account",
        region: null,
        username: "u",
        secret: new Secret("s"),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const message = (caught as ConfigError).message;
    expect(message).toMatch(/region/);
    expect(message.includes("mp login") || message.includes("region=")).toBe(
      true,
    );
  });

  it("oauth_token without region raises the same refusal", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    let caught: unknown = null;
    try {
      await accounts.add("ci", {
        type: "oauth_token",
        region: null,
        token: new Secret("ey.x"),
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).toMatch(/region/);
  });
});

describe("Update", () => {
  // python: TestUpdate
  it("updating default_project rewrites the account block", async () => {
    const { effects, config } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("team", SA_OPTS);

    accounts.update("team", { default_project: "9999999" });

    expect(config.getAccount("team").default_project).toBe("9999999");
  });

  it("updating region works for any account type", async () => {
    const { effects, config } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("personal", { type: "oauth_browser", region: "us" });

    accounts.update("personal", { region: "eu" });

    expect(config.getAccount("personal").region).toBe("eu");
  });

  it("updating a non-existent account raises", () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    expect(() => accounts.update("ghost", { default_project: "1" })).toThrow(
      ConfigError,
    );
  });

  it("username= on an oauth_browser account raises", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("personal", { type: "oauth_browser", region: "us" });

    expect(() => accounts.update("personal", { username: "bad" })).toThrow(
      ConfigError,
    );
  });
});

describe("List", () => {
  // python: TestList
  it("no accounts → empty list", () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    expect(accounts.list()).toStrictEqual([]);
  });

  it("each entry is an AccountSummary", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("team", SA_OPTS);

    const result = accounts.list();

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(AccountSummary);
  });
});

describe("Use", () => {
  // python: TestUse
  it("use(name) sets [active].account", async () => {
    const { effects, config } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("first", SA_OPTS);
    await accounts.add("second", { type: "oauth_browser", region: "us" });

    accounts.use("second");

    expect(config.getActive().account).toBe("second");
  });

  it("use(name) drops any prior [active].workspace; project travels with the account", async () => {
    const { effects, config } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("first", SA_OPTS);
    config.setActive({ workspace: 42 });
    await accounts.add("other", {
      type: "service_account",
      region: "us",
      default_project: "9999999",
      username: "o",
      secret: new Secret("o"),
    });

    accounts.use("other");

    const active = config.getActive();
    expect(active.account).toBe("other");
    expect(active.workspace ?? null).toBeNull();
    expect(config.getAccount("other").default_project).toBe("9999999");
  });
});

describe("Show", () => {
  // python: TestShow
  it("show(name) returns that account's summary", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("team", SA_OPTS);

    expect(accounts.show("team").name).toBe("team");
  });

  it("show() (no arg) returns the active account", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("team", SA_OPTS);

    expect(accounts.show().name).toBe("team");
  });

  it("show('ghost') raises ConfigError", () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    expect(() => accounts.show("ghost")).toThrow(ConfigError);
  });
});

describe("Remove", () => {
  // python: TestRemove
  it("an unreferenced account removes cleanly", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("x", SA_OPTS);

    const orphans = accounts.remove("x");

    expect(orphans).toStrictEqual([]);
    expect(accounts.list()).toStrictEqual([]);
  });

  it("without force, removing a referenced account raises", async () => {
    const { effects, config } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("x", SA_OPTS);
    config.addTarget("ecom", { account: "x", project: "3018488" });

    expect(() => accounts.remove("x")).toThrow(AccountInUseError);
  });
});

describe("Token", () => {
  // python: TestToken
  it("service_account has no bearer → null", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("team", SA_OPTS);

    await expect(accounts.token("team")).resolves.toBeNull();
  });

  it("oauth_token inline returns the plaintext bearer", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("ci", {
      type: "oauth_token",
      region: "us",
      default_project: "3713224",
      token: new Secret("ey.tok-123"),
    });

    await expect(accounts.token("ci")).resolves.toBe("ey.tok-123");
  });
});

describe("Test", () => {
  // python: TestTest
  it("unknown account → ok=false with a helpful error string", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    const result = await accounts.test("ghost");

    expect(result.ok).toBe(false);
    expect(result.error).not.toBeNull();
    const lowered = (result.error ?? "").toLowerCase();
    expect(lowered.includes("ghost") || lowered.includes("not found")).toBe(
      true,
    );
  });

  it("no name + no active account → ok=false", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    const result = await accounts.test();

    expect(result.ok).toBe(false);
    expect(result.error).not.toBeNull();
  });

  it("successful /me probe populates user and project count", async () => {
    const { effects } = makeEffects({
      fetchImpl: meFetch({
        user_id: 42,
        user_email: "team@example.com",
        projects: {
          "3713224": { name: "Alpha", organization_id: 1 },
          "3018488": { name: "Beta", organization_id: 1 },
        },
      }),
    });
    const accounts = createAccountsNamespace(effects);
    await accounts.add("team", SA_OPTS);

    const result = await accounts.test("team");

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.user).not.toBeNull();
    expect((result.user as { id: number }).id).toBe(42);
    expect((result.user as { email: string }).email).toBe("team@example.com");
    expect(result.accessible_project_count).toBe(2);
  });

  it("a raising /me is captured, never re-raised — code preserved", async () => {
    // `_fail_me` raising AuthenticationError translates to a 401 from
    // the REAL client (the client maps 401 → AuthenticationError,
    // AUTH_FAILED — same library error class as the Python stub).
    const { effects } = makeEffects({
      fetchImpl: meFetch({ error: "invalid credentials" }, 401),
    });
    const accounts = createAccountsNamespace(effects);
    await accounts.add("team", SA_OPTS);

    const result = await accounts.test("team");

    expect(result.ok).toBe(false);
    expect(result.error).not.toBeNull();
    expect(
      (result.error ?? "").includes("invalid credentials") ||
        (result.error ?? "").includes("/me"),
    ).toBe(true);
    expect(result.error_code).toBe("AUTH_FAILED");
  });

  it("library-exception details survive into error_details", async () => {
    // The RegionProbeNetworkError arm can't arise from a wire response;
    // inject it at the token-resolver seam (the same broad-catch path
    // the Python monkeypatch exercises — mechanism substitution,
    // header note).
    const { effects } = makeEffects({
      tokenResolver: {
        getBrowserToken: () =>
          Promise.reject(
            new RegionProbeNetworkError("Could not reach any Mixpanel region", {
              attempts: [
                ["us", 0, "ConnectError: dns lookup failed"],
                ["eu", 0, "ConnectError: dns lookup failed"],
                ["in", 0, "ConnectError: dns lookup failed"],
              ],
            }),
          ),
        getStaticToken: () => Promise.reject(new OAuthError("unused")),
      },
    });
    const accounts = createAccountsNamespace(effects);
    await accounts.add("personal", {
      type: "oauth_browser",
      region: "us",
      default_project: "3713224",
    });

    const result = await accounts.test("personal");

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("OAUTH_NETWORK_UNREACHABLE");
    expect(result.error_details).not.toBeNull();
    expect(Object.hasOwn(result.error_details ?? {}, "attempts")).toBe(true);
  });

  it("non-library exceptions keep structured fields null", async () => {
    // Python injects a raw OSError below the httpx wrap (a genuine
    // non-library leak). The TS transport normalizes every fetch
    // rejection into the coded HTTP_ERROR wrap (as Python's
    // `except httpx.HTTPError` does, `api_client.py`), so the
    // faithful non-library leak site is the token-resolver seam — a
    // plain Error rejected there reaches the broad catch unwrapped
    // (mechanism substitution, header note).
    const { effects } = makeEffects({
      tokenResolver: {
        getBrowserToken: () =>
          Promise.reject(new Error("simulated low-level network failure")),
        getStaticToken: () =>
          Promise.reject(new Error("simulated low-level network failure")),
      },
    });
    const accounts = createAccountsNamespace(effects);
    await accounts.add("personal", {
      type: "oauth_browser",
      region: "us",
      default_project: "3713224",
    });

    const result = await accounts.test("personal");

    expect(result.ok).toBe(false);
    expect(result.error_code).toBeNull();
    expect(result.error_details).toBeNull();
  });

  it("test() with no name probes the active account", async () => {
    const { effects } = makeEffects({
      fetchImpl: meFetch({
        user_id: 1,
        user_email: "x@example.com",
        projects: {},
      }),
    });
    const accounts = createAccountsNamespace(effects);
    await accounts.add("team", SA_OPTS); // auto-promoted

    const result = await accounts.test();

    expect(result.ok).toBe(true);
    expect(result.account_name).toBe("team");
  });
});

describe("Test OAuth browser", () => {
  // python: TestTestOAuthBrowser
  // The three on-disk failure fixtures (missing tokens.json / expired
  // without refresh / refresh revoked) re-express as tokenResolver
  // rejections carrying the OnDiskTokenResolver's actionable messages
  // (header note above).
  async function seeded(rejection: Error): Promise<{
    accounts: ReturnType<typeof createAccountsNamespace>;
  }> {
    const { effects } = makeEffects({
      tokenResolver: {
        getBrowserToken: () => Promise.reject(rejection),
        getStaticToken: () => Promise.reject(new OAuthError("unused")),
      },
    });
    const accounts = createAccountsNamespace(effects);
    await accounts.add("personal", {
      type: "oauth_browser",
      region: "us",
      default_project: "3713224",
    });
    return { accounts };
  }

  it("no tokens on disk → ok=false mentioning login", async () => {
    const { accounts } = await seeded(
      new OAuthError(
        "No tokens found for account 'personal'. Run `mp account login personal`.",
      ),
    );
    const result = await accounts.test("personal");
    expect(result.ok).toBe(false);
    const lowered = (result.error ?? "").toLowerCase();
    expect(lowered.includes("login") || lowered.includes("personal")).toBe(
      true,
    );
  });

  it("expired tokens with no refresh → ok=false advising re-login", async () => {
    const { accounts } = await seeded(
      new OAuthError(
        "Access token expired and no refresh token is available. " +
          "Run `mp account login personal`.",
      ),
    );
    const result = await accounts.test("personal");
    expect(result.ok).toBe(false);
    const lowered = (result.error ?? "").toLowerCase();
    expect(lowered.includes("login") || lowered.includes("refresh")).toBe(true);
  });

  it("revoked refresh token → ok=false mentioning re-login", async () => {
    const { accounts } = await seeded(
      new OAuthError(
        "Refresh token has been revoked for account 'personal'. " +
          "Re-run `mp account login personal`.",
        "OAUTH_REFRESH_REVOKED",
      ),
    );
    const result = await accounts.test("personal");
    expect(result.ok).toBe(false);
    const lowered = (result.error ?? "").toLowerCase();
    expect(lowered.includes("login") || lowered.includes("revoked")).toBe(true);
  });
});

describe("Login", () => {
  // python: TestLogin
  it("login rejects non-oauth_browser accounts", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("team", SA_OPTS);

    await expect(accounts.login("team")).rejects.toThrow(/oauth_browser/);
  });

  it("login on a missing account raises ConfigError", async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    await expect(accounts.login("ghost")).rejects.toThrow(/not found/);
  });

  it("successful flow persists tokens and backfills default_project", async () => {
    const captured: Record<string, unknown> = {};
    const tokens = freshTokens();
    const { effects, config, tokenStore } = makeEffects({
      fetchImpl: meFetch({
        user_id: 7,
        user_email: "alice@example.com",
        projects: { "3713224": { name: "Demo", organization_id: 1 } },
      }),
      oauthFlow: {
        login: (region, options): Promise<OAuthTokens> => {
          captured["region"] = region;
          captured["open_browser"] = options.openBrowser;
          return Promise.resolve(tokens);
        },
      },
    });
    const accounts = createAccountsNamespace(effects);
    await accounts.add("personal", { type: "oauth_browser", region: "us" });

    const result = await accounts.login("personal");

    // `persist=False` has no TS analog: the flow effect NEVER persists
    // by contract (tokens stay in memory until validation) — the
    // stronger invariant replaces the kwarg capture (header note).
    expect(captured["open_browser"]).toBe(true); // default — interactive
    // Tokens persisted to the per-account path via the injected store.
    const written = tokenStore.written.get("personal");
    expect(written).toBeDefined();
    expect(written?.access_token.reveal()).toBe("brw-tok-fresh");
    expect(written?.refresh_token?.reveal()).toBe("brw-refresh-fresh");
    // default_project backfilled from the /me probe.
    expect(config.getAccount("personal").default_project).toBe("3713224");
    // OAuthLoginResult shape.
    expect(result.account_name).toBe("personal");
    expect(result.user).not.toBeNull();
    expect((result.user as { email: string }).email).toBe("alice@example.com");
    expect(result.expires_at).toBe(tokens.expires_at);
    expect(result.tokens_path).toBe("/fake/.mp/accounts/personal/tokens.json");
  });

  it("login propagates open_browser=false to the flow", async () => {
    const captured: Record<string, unknown> = {};
    const { effects } = makeEffects({
      fetchImpl: meFetch({
        user_id: 1,
        user_email: "u@example.com",
        projects: { "3713224": { name: "Demo", organization_id: 1 } },
      }),
      oauthFlow: {
        login: (_region, options): Promise<OAuthTokens> => {
          captured["open_browser"] = options.openBrowser;
          return Promise.resolve(freshTokens("brw-tok"));
        },
      },
    });
    const accounts = createAccountsNamespace(effects);
    await accounts.add("personal", {
      type: "oauth_browser",
      region: "us",
      default_project: "3713224",
    });

    await accounts.login("personal", { open_browser: false });

    expect(captured["open_browser"]).toBe(false);
  });
});

describe("Public surface", () => {
  // python: TestPublicSurface
  it("login / test (and every __all__ name) resolve on the namespace", () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    // `accounts.py` __all__ → the camelCase method set
    // (naming decision recorded in the module header of namespace.ts).
    const names = [
      "add",
      "exportBridge",
      "list",
      "login",
      "loginUnified",
      "logout",
      "remove",
      "removeBridge",
      "show",
      "test",
      "token",
      "update",
      "use",
    ] as const;
    for (const name of names) {
      expect(typeof accounts[name]).toBe("function");
    }
  });
});

describe("Logout honors storage override", () => {
  // python: TestLogoutHonorsStorageOverride
  it("logout removes exactly the injected store's tokens", async () => {
    const { effects, tokenStore } = makeEffects();
    const accounts = createAccountsNamespace(effects);
    await accounts.add("personal", { type: "oauth_browser", region: "us" });
    // Seed tokens the way `mp account login` would.
    tokenStore.store.writeTokens("personal", freshTokens());
    expect(tokenStore.written.has("personal")).toBe(true);

    accounts.logout("personal");

    expect(tokenStore.written.has("personal")).toBe(false);
  });
});

// TestSummaryTableDynamicWidth — EXCLUDED (CLI formatter; plan
// D4 — see the file header; exclusion RATIFIED by the pair-A arbiter,
// `b7-reviewA-resolution.md` ASR-F1).

// Spec-cited ADDITIONS (not Python translations): empty-string
// falsiness locks for the Python `or`-defaulting parameter sites the
// pair-A semantics review found ported as nullish-`??`
// (`b7-reviewA-resolution.md` SEM-F1; `accounts.py:727`, `:997`).
describe("B7-ARB-A SEM-F1 falsiness locks (b7-reviewA-resolution.md)", () => {
  it('test("") reports account_name "(none)" like Python `name or "(none)"`', async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    const result = await accounts.test("");

    expect(result.ok).toBe(false);
    expect(result.account_name).toBe("(none)");
  });

  it('exportBridge(account="") falls through to the ACTIVE account', async () => {
    const exported: string[] = [];
    const { effects } = makeEffects({
      bridge: {
        load: () => null,
        export: (options): string => {
          exported.push(options.account.name);
          return options.to;
        },
        remove: () => false,
      },
    });
    const accounts = createAccountsNamespace(effects);
    await accounts.add("team", SA_OPTS);

    const path = await accounts.exportBridge({
      to: "/fake/bridge.json",
      account: "",
    });

    expect(path).toBe("/fake/bridge.json");
    expect(exported).toStrictEqual(["team"]);
  });

  it('exportBridge(account="") with no active account raises the no-account ConfigError', async () => {
    const { effects } = makeEffects();
    const accounts = createAccountsNamespace(effects);

    let caught: unknown = null;
    try {
      await accounts.exportBridge({ to: "/fake/bridge.json", account: "" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).toBe(
      "No account specified and no active account configured.",
    );
  });
});

// B8-ARB-A ASR-F1 (b8-reviewA-resolution.md): the COMPOSITION half of
// `test_bridge_export.py::test_export_bridge_attaches_settings_custom_header`
// — the N2 translation split the Python lock and kept only the
// effect-level "supplied headers land verbatim" half
// (packages/node/test/bridge.test.ts `test_export_bridge_attaches_custom_headers`).
// This locks the joining orchestration: `[settings].custom_header` read
// via `getCustomHeader()` becomes the one-entry headers bag handed to
// `effects.bridge.export` (accounts-ops.ts:847-848) — a name/value swap
// or dropped-header regression there now fails here.
describe("B8-ARB-A ASR-F1 custom-header export composition lock", () => {
  it("[settings].custom_header propagates into the exported headers bag through the orchestration", async () => {
    const exportedHeaders: Array<Readonly<Record<string, string>> | null> = [];
    const { effects, config } = makeEffects({
      bridge: {
        load: () => null,
        export: (options): string => {
          exportedHeaders.push(options.headers);
          return options.to;
        },
        remove: () => false,
      },
    });
    config.state.customHeader = ["X-Mixpanel-Cluster", "cell-3"];
    const accounts = createAccountsNamespace(effects);
    await accounts.add("team", SA_OPTS);

    await accounts.exportBridge({ to: "/fake/bridge.json", account: "team" });

    expect(exportedHeaders).toStrictEqual([{ "X-Mixpanel-Cluster": "cell-3" }]);
  });

  it("no custom header configured → the exported headers bag stays null (anti-vacuity companion)", async () => {
    const exportedHeaders: Array<Readonly<Record<string, string>> | null> = [];
    const { effects } = makeEffects({
      bridge: {
        load: () => null,
        export: (options): string => {
          exportedHeaders.push(options.headers);
          return options.to;
        },
        remove: () => false,
      },
    });
    const accounts = createAccountsNamespace(effects);
    await accounts.add("team", SA_OPTS);

    await accounts.exportBridge({ to: "/fake/bridge.json", account: "team" });

    expect(exportedHeaders).toStrictEqual([null]);
  });
});
