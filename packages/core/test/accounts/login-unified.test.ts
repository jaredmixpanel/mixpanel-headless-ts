// Layer-3 translation of `tests/unit/test_accounts_namespace.py` — the
// six `TestLoginUnified*` classes (:993-1685; B7-A1 packet §3.4,
// `b7-packets.md`).
//
// Mechanism substitutions (header-cited per R10.2), matching
// `accounts-namespace.test.ts`:
// - `monkeypatch.setenv` becomes the bundle's env bag (`setEnv`);
// - the `MixpanelAPIClient.me` stub becomes `meFetch(payload)`;
// - the me-cache write assertions (`MeCache(...).get()` against
//   `~/.mp/accounts/{name}/me.json`) re-express over the injected
//   `meCache.put` capture map — the on-disk store is B8-N2;
// - the Python progress CONTEXT MANAGER becomes the
//   `(msg) => ProgressHandle` factory (enter = call, exit = `end()`;
//   packet §3.3 "Disposable-style callback");
// - the `_fetch_me` spy (`monkeypatch.setattr(accounts_mod,
//   "_fetch_me", …)`) becomes an event recorded INSIDE the injected
//   fetch — the same "progress CM is open AT the moment /me runs"
//   ordering lock.

import { describe, expect, it } from "vitest";
import { createAccountsNamespace } from "../../src/accounts/namespace.js";
import { createSessionNamespace } from "../../src/accounts/session-namespace.js";
import type { ProgressFactory } from "../../src/accounts/accounts-ops.js";
import { ConfigError, InvalidArgumentError } from "../../src/errors.js";
import { OAuthTokens } from "../../src/auth/token.js";
import { Secret } from "../../src/secret.js";
import {
  makeEffects,
  meFetch,
  setEnv,
  type EffectsBundle,
} from "./fake-auth-effects.js";

/** A tracking progress factory (the `_make_tracking_progress` twin). */
function makeTrackingProgress(): {
  messages: string[];
  events: string[];
  factory: ProgressFactory;
} {
  const messages: string[] = [];
  const events: string[] = [];
  const factory: ProgressFactory = (msg: string) => {
    messages.push(msg);
    events.push("enter");
    return {
      end: (): void => {
        events.push("exit");
      },
    };
  };
  return { messages, events, factory };
}

/** Wire a bundle's fetch to a payload AND record a "fetch" event. */
function bundleWithSpiedMe(
  payload: Record<string, unknown>,
  events: string[],
  env: Readonly<Record<string, string>>,
): EffectsBundle {
  const inner = meFetch(payload);
  const spied = (async (
    ...args: Parameters<typeof fetch>
  ): Promise<Response> => {
    events.push("fetch");
    return inner(...args);
  }) as typeof fetch;
  return makeEffects({ env, fetchImpl: spied });
}

describe("TestLoginUnifiedActivation (test_accounts_namespace.py:993)", () => {
  it("new credential account promotes to active", async () => {
    const bundle = makeEffects({
      env: { MP_USERNAME: "svc", MP_SECRET: "secret" },
      fetchImpl: meFetch({
        user_id: 1,
        user_email: "svc@example.com",
        organizations: { "100": { id: 100, name: "Acme Corp" } },
        projects: { "42": { name: "Demo", organization_id: 100 } },
      }),
    });
    const accounts = createAccountsNamespace(bundle.effects);
    const session = createSessionNamespace(bundle.effects);

    const summary = await accounts.loginUnified({
      account_type: "service_account",
      region: "us",
      name: "newbie",
    });

    expect(summary.name).toBe("newbie");
    expect(session.show().account).toBe("newbie");
  });

  it("a second credential account is activated", async () => {
    const bundle = makeEffects({
      env: { MP_USERNAME: "u2", MP_SECRET: "s2" },
      fetchImpl: meFetch({
        user_id: 2,
        user_email: "u2@example.com",
        organizations: { "200": { id: 200, name: "Beta" } },
        projects: {},
      }),
    });
    const accounts = createAccountsNamespace(bundle.effects);
    const session = createSessionNamespace(bundle.effects);
    await accounts.add("first", {
      type: "service_account",
      region: "us",
      username: "u1",
      secret: new Secret("s1"),
    });
    expect(session.show().account).toBe("first");

    const summary = await accounts.loginUnified({
      account_type: "service_account",
      region: "us",
      name: "second",
    });

    expect(summary.name).toBe("second");
    expect(session.show().account).toBe("second");
  });

  it("re-login on a non-active account flips [active].account", async () => {
    const bundle = makeEffects({
      env: { MP_USERNAME: "u2", MP_SECRET: "rotated" },
      fetchImpl: meFetch({
        user_id: 2,
        user_email: "u2@example.com",
        organizations: { "200": { id: 200, name: "Beta" } },
        projects: {},
      }),
    });
    const accounts = createAccountsNamespace(bundle.effects);
    const session = createSessionNamespace(bundle.effects);
    await accounts.add("first", {
      type: "service_account",
      region: "us",
      username: "u1",
      secret: new Secret("s1"),
    });
    await accounts.add("secondary", {
      type: "service_account",
      region: "us",
      username: "u2",
      secret: new Secret("s2"),
    });
    expect(session.show().account).toBe("first");

    await accounts.loginUnified({
      account_type: "service_account",
      region: "us",
      name: "secondary",
    });

    expect(session.show().account).toBe("secondary");
  });
});

describe("TestLoginUnifiedMeCacheWrite (test_accounts_namespace.py:1137)", () => {
  it("the credential path persists /me to the account cache", async () => {
    const bundle = makeEffects({
      env: { MP_USERNAME: "svc", MP_SECRET: "secret" },
      fetchImpl: meFetch({
        user_id: 9,
        user_email: "svc@example.com",
        organizations: { "100": { id: 100, name: "Acme" } },
        projects: { "42": { name: "Demo", organization_id: 100 } },
      }),
    });
    const accounts = createAccountsNamespace(bundle.effects);

    await accounts.loginUnified({
      account_type: "service_account",
      region: "us",
      name: "acme-sa",
    });

    const cached = bundle.meCachePuts.get("acme-sa");
    expect(cached).toBeDefined();
    expect(cached?.user_email).toBe("svc@example.com");
  });

  it("the relogin path also persists /me", async () => {
    const bundle = makeEffects({
      env: { MP_USERNAME: "u-new", MP_SECRET: "new-secret" },
      fetchImpl: meFetch({
        user_id: 9,
        user_email: "team@example.com",
        organizations: { "100": { id: 100, name: "Team" } },
        projects: {},
      }),
    });
    const accounts = createAccountsNamespace(bundle.effects);
    await accounts.add("team", {
      type: "service_account",
      region: "us",
      username: "u-old",
      secret: new Secret("old-secret"),
    });
    expect(bundle.meCachePuts.has("team")).toBe(false);

    await accounts.loginUnified({
      account_type: "service_account",
      region: "us",
      name: "team",
    });

    const cached = bundle.meCachePuts.get("team");
    expect(cached).toBeDefined();
    expect(cached?.user_email).toBe("team@example.com");
  });
});

describe("TestLoginUnifiedFlagValidation (test_accounts_namespace.py:1228)", () => {
  it("service_account + token_env → mutually_exclusive", async () => {
    const bundle = makeEffects();
    const accounts = createAccountsNamespace(bundle.effects);

    let caught: unknown = null;
    try {
      await accounts.loginUnified({
        service_account: true,
        token_env: "MY_TOKEN",
      });
    } catch (exc) {
      caught = exc;
    }
    expect(caught).toBeInstanceOf(InvalidArgumentError);
    expect((caught as InvalidArgumentError).violation).toBe(
      "mutually_exclusive",
    );
    expect((caught as InvalidArgumentError).detectedAuthType).toBe(
      "service_account",
    );
  });

  it("no_browser against a non-browser type → no_browser_misuse", async () => {
    const bundle = makeEffects();
    const accounts = createAccountsNamespace(bundle.effects);

    let caught: unknown = null;
    try {
      await accounts.loginUnified({ service_account: true, no_browser: true });
    } catch (exc) {
      caught = exc;
    }
    expect(caught).toBeInstanceOf(InvalidArgumentError);
    expect((caught as InvalidArgumentError).violation).toBe(
      "no_browser_misuse",
    );
    expect((caught as InvalidArgumentError).detectedAuthType).toBe(
      "service_account",
    );
  });

  it("secret_stdin against a non-SA type → secret_stdin_misuse", async () => {
    const bundle = makeEffects();
    const accounts = createAccountsNamespace(bundle.effects);

    let caught: unknown = null;
    try {
      await accounts.loginUnified({
        token_env: "MY_TOKEN",
        secret_stdin: true,
      });
    } catch (exc) {
      caught = exc;
    }
    expect(caught).toBeInstanceOf(InvalidArgumentError);
    expect((caught as InvalidArgumentError).violation).toBe(
      "secret_stdin_misuse",
    );
    expect((caught as InvalidArgumentError).detectedAuthType).toBe(
      "oauth_token",
    );
  });

  it("service_account flag vs explicit oauth_token → mutually_exclusive", async () => {
    const bundle = makeEffects();
    const accounts = createAccountsNamespace(bundle.effects);

    let caught: unknown = null;
    try {
      await accounts.loginUnified({
        service_account: true,
        account_type: "oauth_token",
      });
    } catch (exc) {
      caught = exc;
    }
    expect(caught).toBeInstanceOf(InvalidArgumentError);
    expect((caught as InvalidArgumentError).violation).toBe(
      "mutually_exclusive",
    );
    expect((caught as InvalidArgumentError).detectedAuthType).toBe(
      "oauth_token",
    );
  });
});

describe("TestLoginUnifiedSummaryFields (test_accounts_namespace.py:1285)", () => {
  it("SA login populates user_email + project_id + project_name", async () => {
    const bundle = makeEffects({
      env: { MP_USERNAME: "svc", MP_SECRET: "secret" },
      fetchImpl: meFetch({
        user_id: 1,
        user_email: "svc@example.com",
        organizations: { "100": { id: 100, name: "Acme" } },
        projects: { "42": { name: "Acme Demo", organization_id: 100 } },
      }),
    });
    const accounts = createAccountsNamespace(bundle.effects);

    const summary = await accounts.loginUnified({
      account_type: "service_account",
      region: "us",
      name: "prod",
      project: "42",
    });

    expect(summary.user_email).toBe("svc@example.com");
    expect(summary.project_id).toBe("42");
    expect(summary.project_name).toBe("Acme Demo");
  });

  it("empty /me.projects → project_id and project_name both null", async () => {
    const bundle = makeEffects({
      env: { MP_USERNAME: "svc", MP_SECRET: "secret" },
      fetchImpl: meFetch({
        user_id: 1,
        user_email: "svc@example.com",
        organizations: { "100": { id: 100, name: "Empty" } },
        projects: {},
      }),
    });
    const accounts = createAccountsNamespace(bundle.effects);

    const summary = await accounts.loginUnified({
      account_type: "service_account",
      region: "us",
      name: "emptyacct",
    });

    expect(summary.user_email).toBe("svc@example.com");
    expect(summary.project_id).toBeNull();
    expect(summary.project_name).toBeNull();
  });
});

describe("TestLoginUnifiedProgressHook (test_accounts_namespace.py:1358)", () => {
  it("progress wraps /me on the credential path (enter → fetch → exit)", async () => {
    const { messages, events, factory } = makeTrackingProgress();
    const bundle = bundleWithSpiedMe(
      {
        user_id: 1,
        user_email: "svc@example.com",
        organizations: { "100": { id: 100, name: "Acme" } },
        projects: { "42": { name: "Demo", organization_id: 100 } },
      },
      events,
      { MP_USERNAME: "svc", MP_SECRET: "secret" },
    );
    const accounts = createAccountsNamespace(bundle.effects);

    await accounts.loginUnified({
      account_type: "service_account",
      region: "us",
      name: "prod",
      project: "42",
      progress: factory,
    });

    expect(events).toEqual(["enter", "fetch", "exit"]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).not.toBe("");
    // No numeric duration in the message (043 cli-feedback rule).
    expect(/\d/.test(messages[0] as string)).toBe(false);
  });

  it("progress=null keeps the silent default behavior", async () => {
    const bundle = makeEffects({
      env: { MP_USERNAME: "svc", MP_SECRET: "secret" },
      fetchImpl: meFetch({
        user_id: 1,
        user_email: "svc@example.com",
        organizations: { "100": { id: 100, name: "Acme" } },
        projects: { "42": { name: "Demo", organization_id: 100 } },
      }),
    });
    const accounts = createAccountsNamespace(bundle.effects);

    const summary = await accounts.loginUnified({
      account_type: "service_account",
      region: "us",
      name: "prod",
      project: "42",
    });

    expect(summary.name).toBe("prod");
  });

  it("progress wraps /me on the relogin path too", async () => {
    const { messages, events, factory } = makeTrackingProgress();
    const bundle = bundleWithSpiedMe(
      {
        user_id: 1,
        user_email: "u@example.com",
        organizations: { "100": { id: 100, name: "Acme" } },
        projects: { "42": { name: "Demo", organization_id: 100 } },
      },
      events,
      {},
    );
    const accounts = createAccountsNamespace(bundle.effects);
    await accounts.add("prod", {
      type: "service_account",
      region: "us",
      username: "u",
      secret: new Secret("s"),
    });
    setEnv(bundle, "MP_USERNAME", "u");
    setEnv(bundle, "MP_SECRET", "s");

    await accounts.loginUnified({
      account_type: "service_account",
      region: "us",
      name: "prod",
      progress: factory,
    });

    expect(events).toEqual(["enter", "fetch", "exit"]);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).not.toBe("");
  });
});

describe("TestLoginUnifiedPickerSortOrder (test_accounts_namespace.py:1544)", () => {
  it("picker receives projects grouped by org name, alphabetized within", async () => {
    const bundle = makeEffects({
      env: { MP_USERNAME: "svc", MP_SECRET: "secret" },
      fetchImpl: meFetch({
        user_id: 1,
        user_email: "u@example.com",
        organizations: {
          "300": { id: 300, name: "Charlie" },
          "100": { id: 100, name: "Acme" },
          "200": { id: 200, name: "Beta" },
        },
        projects: {
          "1": { name: "zebra", organization_id: 100 },
          "2": { name: "alpha", organization_id: 200 },
          "3": { name: "yak", organization_id: 300 },
          "4": { name: "wolf", organization_id: 100 },
          "5": { name: "middle", organization_id: 200 },
          "6": { name: "apple", organization_id: 300 },
        },
      }),
    });
    const accounts = createAccountsNamespace(bundle.effects);
    const captured: string[][] = [];

    await accounts.loginUnified({
      account_type: "service_account",
      region: "us",
      name: "acct",
      project_picker: (_me, sortedProjects) => {
        captured.push(sortedProjects.map(([, info]) => String(info.name)));
        return (sortedProjects[0] as readonly [string, unknown])[0];
      },
    });

    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]).toEqual([
      "wolf",
      "zebra",
      "alpha",
      "middle",
      "apple",
      "yak",
    ]);
  });

  it("the picker sort is case-insensitive on both axes", async () => {
    const bundle = makeEffects({
      env: { MP_USERNAME: "svc", MP_SECRET: "secret" },
      fetchImpl: meFetch({
        user_id: 1,
        user_email: "u@example.com",
        organizations: {
          "100": { id: 100, name: "acme" },
          "200": { id: 200, name: "Beta" },
        },
        projects: {
          "1": { name: "betaproj", organization_id: 200 },
          "2": { name: "acmeproj", organization_id: 100 },
        },
      }),
    });
    const accounts = createAccountsNamespace(bundle.effects);
    const captured: string[][] = [];

    await accounts.loginUnified({
      account_type: "service_account",
      region: "us",
      name: "acct",
      project_picker: (_me, sortedProjects) => {
        captured.push(sortedProjects.map(([, info]) => String(info.name)));
        return (sortedProjects[0] as readonly [string, unknown])[0];
      },
    });

    expect(captured[0]).toEqual(["acmeproj", "betaproj"]);
  });
});

// Spec-cited ADDITIONS (not Python translations) — pair-A arbiter
// locks, `b7-reviewA-resolution.md` SEM-F1 / SEM-F2. Expected values
// live-verified against CPython 2026-08-16 (arbiter probe:
// `login_unified(token_env="")` with MP_OAUTH_TOKEN set raises
// ConfigError "--token-env '' is unset; cannot probe region.").
describe("B7-ARB-A resolution locks (b7-reviewA-resolution.md SEM-F1/SEM-F2)", () => {
  it('token_env="" falls back to MP_OAUTH_TOKEN and fails at the PROBE like Python (accounts.py:1812)', async () => {
    const bundle = makeEffects({ env: { MP_OAUTH_TOKEN: "tok-x" } });
    const accounts = createAccountsNamespace(bundle.effects);

    let caught: unknown = null;
    try {
      await accounts.loginUnified({ token_env: "" });
    } catch (exc) {
      caught = exc;
    }
    // NOT the `Env var '' is unset` collection error — the bearer read
    // falls back to MP_OAUTH_TOKEN (`token_env or "MP_OAUTH_TOKEN"`),
    // then the region probe rejects the EMPTY token_env pointer
    // exactly as Python does (`region_probe.py:252-256`).
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).toBe(
      "--token-env '' is unset; cannot probe region.",
    );
  });

  it("browser flow refuses an ORPHANED per-account state for the final name (accounts.py:1704-1708)", async () => {
    const orphaned = new OAuthTokens({
      access_token: new Secret("orphan-tok"),
      refresh_token: new Secret("orphan-refresh"),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      scope: "read:project",
      token_type: "Bearer",
    });
    const bundle = makeEffects({
      oauthFlow: {
        login: (): Promise<OAuthTokens> =>
          Promise.resolve(
            new OAuthTokens({
              access_token: new Secret("brw-tok"),
              refresh_token: new Secret("brw-refresh"),
              expires_at: new Date(Date.now() + 3600_000).toISOString(),
              scope: "read:project",
              token_type: "Bearer",
            }),
          ),
      },
      fetchImpl: meFetch({
        user_id: 1,
        user_email: "u@example.com",
        organizations: { "100": { id: 100, name: "Acme" } },
        projects: { "42": { name: "Demo", organization_id: 100 } },
      }),
    });
    // The orphan state: per-account tokens exist but NO config record
    // (Python: a leftover `~/.mp/accounts/personal/` directory).
    bundle.tokenStore.store.writeTokens("personal", orphaned);
    const accounts = createAccountsNamespace(bundle.effects);

    let caught: unknown = null;
    try {
      await accounts.loginUnified({ name: "personal" });
    } catch (exc) {
      caught = exc;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).toContain("already exists");
    expect((caught as ConfigError).message).toContain(
      "mp account remove personal",
    );
    // Python raises BEFORE the rename publishes anything — the orphan
    // state must be untouched (no silent overwrite).
    expect(bundle.tokenStore.written.get("personal")).toBe(orphaned);
    expect(bundle.config.state.accounts.has("personal")).toBe(false);
  });
});
