// Layer-3 translation of `tests/unit/test_resolver.py` (443 lines, 31
// tests, 7 classes) + `tests/unit/test_042_edge_cases.py::
// TestResolverEdgeCases` (:325-393) — B7-A2 packet §2.4
// (`b7-packets.md`).
//
// Mechanism substitutions (header-cited per R10.2 / packet §2.2, §2.4):
// - The tmp-dir `ConfigManager` fixtures translate to an in-memory
//   `ResolverConfigSource` fake (`FakeConfig`) — the TS resolver core
//   takes injected sources and does no I/O (R9.4).
// - `monkeypatch.setenv` translates to env-bag literals passed in
//   `ResolverSources.env`; the `_isolated_home` fixture has no TS twin
//   because the core NEVER loads a default bridge (`bridge` is an
//   explicit member of the sources bag; B8 wires `load_bridge`).
// - `TestNoSideEffects.test_does_not_mutate_environ` re-expresses as a
//   no-source-mutation assert (packet §2.2: "the TS twin cannot mutate
//   `process.env` by construction, but the sources object must come
//   back untouched").
// - Python `ValueError` on the target guard is the coded
//   `ParamValidationError` `WS1_TARGET_MUTUALLY_EXCLUSIVE` twin (packet
//   §2.2; R5 codes-not-messages — same code as the W1 guard, no second
//   code minted).
// - Pydantic `ValidationError`/`ConfigError` from `ConfigManager` load
//   paths surface here as the fake's thrown `AccountNotFoundError` /
//   `ConfigError` (the coded twins config.py already uses).
import { describe, expect, it } from "vitest";

import { type Account, parseAccount } from "../../src/auth/account.js";
import {
  type BridgeView,
  envWorkspaceId,
  type ResolverConfigSource,
  type ResolverEnv,
  type ResolverSources,
  resolveSession,
} from "../../src/auth/resolver.js";
import type { ActiveSession } from "../../src/auth/session.js";
import {
  AccountNotFoundError,
  ConfigError,
  ParamValidationError,
} from "../../src/errors.js";
import { Target } from "../../src/types/entities/accounts.js";

// ---- fixtures --------------------------------------------------------

/** In-memory `ResolverConfigSource` (the tmp-dir ConfigManager twin). */
class FakeConfig implements ResolverConfigSource {
  readonly accounts = new Map<string, Account>();
  readonly targets = new Map<string, Target>();
  active: ActiveSession = {};
  customHeader: readonly [string, string] | null = null;

  /**
   * Register an account (the `cm.add_account` twin).
   *
   * @param account - The parsed account to store.
   */
  addAccount(account: Account): void {
    this.accounts.set(account.name, account);
  }

  /**
   * Register a target (the `cm.add_target` twin).
   *
   * @param target - The target to store.
   */
  addTarget(target: Target): void {
    this.targets.set(target.name, target);
  }

  /**
   * Look up an account by name.
   *
   * @param name - Account name.
   * @returns The stored account.
   * @throws AccountNotFoundError - Unknown name (the ConfigManager
   *   coded error).
   */
  getAccount(name: string): Account {
    const account = this.accounts.get(name);
    if (account === undefined) {
      throw new AccountNotFoundError(name, [...this.accounts.keys()]);
    }
    return account;
  }

  /**
   * Read the `[active]` block.
   *
   * @returns The active session (may be empty).
   */
  getActive(): ActiveSession {
    return this.active;
  }

  /**
   * Look up a target by name.
   *
   * @param name - Target name.
   * @returns The stored target.
   * @throws ConfigError - Unknown name.
   */
  getTarget(name: string): Target {
    const target = this.targets.get(name);
    if (target === undefined) {
      throw new ConfigError(`Unknown target: ${name}`, { target: name });
    }
    return target;
  }

  /**
   * Read `[settings].custom_header`.
   *
   * @returns The single custom header entry, or null.
   */
  getCustomHeader(): readonly [string, string] | null {
    return this.customHeader;
  }
}

/**
 * Build the `cm` fixture: one SA account "team" with default_project.
 *
 * @returns The fake config.
 */
function cm(): FakeConfig {
  const config = new FakeConfig();
  config.addAccount(
    parseAccount({
      type: "service_account",
      name: "team",
      region: "us",
      default_project: "3713224",
      username: "team.sa",
      secret: "team-secret",
    }),
  );
  return config;
}

/**
 * Build the `cm_with_active` fixture: `[active].account = "team"`.
 *
 * @returns The fake config.
 */
function cmWithActive(): FakeConfig {
  const config = cm();
  config.active = { account: "team" };
  return config;
}

/**
 * Assemble a `ResolverSources` bag (env defaults empty; bridge null).
 *
 * @param config - The config source.
 * @param env - Optional env bag.
 * @param bridge - Optional bridge view.
 * @returns The sources bag.
 */
function sources(
  config: ResolverConfigSource,
  env: ResolverEnv = {},
  bridge: BridgeView | null = null,
): ResolverSources {
  return { env, config, bridge };
}

/**
 * Construct a `BridgeView` pointing at a fresh service account (the
 * `TestCrossSourceOrdering._make_bridge` twin).
 *
 * @param options - Optional project / workspace axes.
 * @returns The bridge view.
 */
function makeBridge(options: {
  project?: string | null;
  workspace?: number | null;
}): BridgeView {
  return {
    account: parseAccount({
      type: "service_account",
      name: "bridge-account",
      region: "us",
      username: "bridge.user",
      secret: "bridge-secret",
      default_project: null,
    }),
    project: options.project ?? null,
    workspace: options.workspace ?? null,
    headers: {},
  };
}

/** The full SA env quad used across the env-priority tests. */
const SA_QUAD: ResolverEnv = {
  MP_USERNAME: "env.user",
  MP_SECRET: "env-secret",
  MP_PROJECT_ID: "999",
  MP_REGION: "us",
};

// ---- tests -----------------------------------------------------------

describe("TestAccountAxisPriority", () => {
  it("test_explicit_param_beats_active", () => {
    const config = cmWithActive();
    config.addAccount(
      parseAccount({
        type: "service_account",
        name: "other",
        region: "us",
        default_project: "9999999",
        username: "o",
        secret: "o",
      }),
    );
    const s = resolveSession({ account: "other" }, sources(config));
    expect(s.account.name).toBe("other");
  });

  it("test_active_used_when_no_param", () => {
    const s = resolveSession({}, sources(cmWithActive()));
    expect(s.account.name).toBe("team");
  });

  it("test_env_quad_synthesizes_service_account", () => {
    const config = cm();
    config.active = { account: "team" };
    const s = resolveSession(
      {},
      sources(config, {
        MP_USERNAME: "env.user",
        MP_SECRET: "env-secret",
        MP_PROJECT_ID: "999",
        MP_REGION: "eu",
      }),
    );
    expect(s.account.type).toBe("service_account");
    expect(s.account.region).toBe("eu");
    expect(
      s.account.type === "service_account" ? s.account.username : null,
    ).toBe("env.user");
  });

  it("test_oauth_token_env_synthesizes", () => {
    const s = resolveSession(
      {},
      sources(cm(), {
        MP_OAUTH_TOKEN: "env-bearer-tok",
        MP_PROJECT_ID: "999",
        MP_REGION: "us",
      }),
    );
    expect(s.account.type).toBe("oauth_token");
  });

  it("test_sa_env_quad_beats_oauth_token_env", () => {
    const s = resolveSession(
      {},
      sources(cm(), { ...SA_QUAD, MP_OAUTH_TOKEN: "env-bearer" }),
    );
    expect(s.account.type).toBe("service_account");
  });
});

describe("TestProjectAxisPriority", () => {
  it("test_explicit_param_beats_active", () => {
    const s = resolveSession({ project: "888" }, sources(cmWithActive()));
    expect(s.project.id).toBe("888");
  });

  it("test_env_beats_param", () => {
    const s = resolveSession(
      { project: "888" },
      sources(cmWithActive(), { MP_PROJECT_ID: "777" }),
    );
    expect(s.project.id).toBe("777");
  });

  it("test_active_used_when_no_param", () => {
    const s = resolveSession({}, sources(cmWithActive()));
    expect(s.project.id).toBe("3713224");
  });

  it("test_missing_project_axis_raises", () => {
    const config = new FakeConfig();
    // An oauth_browser account (default_project optional) so the
    // account axis resolves but the project axis cannot.
    config.addAccount(
      parseAccount({ type: "oauth_browser", name: "personal", region: "us" }),
    );
    config.active = { account: "personal" };
    expect(() => resolveSession({}, sources(config))).toThrow(ConfigError);
  });
});

describe("TestWorkspaceAxisPriority", () => {
  it("test_param_overrides_active", () => {
    const config = cmWithActive();
    config.active = { ...config.active, workspace: 99 };
    const s = resolveSession({ workspace: 42 }, sources(config));
    expect(s.workspace).not.toBeNull();
    expect(s.workspace?.id).toBe(42);
  });

  it("test_env_overrides_param", () => {
    const s = resolveSession(
      { workspace: 42 },
      sources(cmWithActive(), { MP_WORKSPACE_ID: "100" }),
    );
    expect(s.workspace).not.toBeNull();
    expect(s.workspace?.id).toBe(100);
  });

  it("test_workspace_none_when_unset", () => {
    const s = resolveSession({}, sources(cmWithActive()));
    expect(s.workspace ?? null).toBeNull();
  });
});

describe("TestTargetMutualExclusion", () => {
  /**
   * Build the `ecom` target fixture on a config.
   *
   * @param config - The fake config.
   * @param workspace - Optional workspace axis for the target.
   */
  function addEcom(config: FakeConfig, workspace?: number): void {
    config.addTarget(
      new Target({
        name: "ecom",
        account: "team",
        project: "3018488",
        ...(workspace === undefined ? {} : { workspace }),
      }),
    );
  }

  it("test_target_with_account_raises", () => {
    const config = cmWithActive();
    addEcom(config);
    expect(() =>
      resolveSession({ target: "ecom", account: "team" }, sources(config)),
    ).toThrow(ParamValidationError);
  });

  it("test_target_with_project_raises", () => {
    const config = cmWithActive();
    addEcom(config);
    expect(() =>
      resolveSession({ target: "ecom", project: "999" }, sources(config)),
    ).toThrow(ParamValidationError);
  });

  it("test_target_with_workspace_raises", () => {
    const config = cmWithActive();
    addEcom(config);
    expect(() =>
      resolveSession({ target: "ecom", workspace: 42 }, sources(config)),
    ).toThrow(ParamValidationError);
  });

  it("target guard carries the W1 code (packet §2.2 — no second code)", () => {
    const config = cmWithActive();
    addEcom(config);
    try {
      resolveSession({ target: "ecom", account: "team" }, sources(config));
      expect.unreachable();
    } catch (error) {
      expect((error as ParamValidationError).code).toBe(
        "WS1_TARGET_MUTUALLY_EXCLUSIVE",
      );
    }
  });

  it("test_target_alone_resolves", () => {
    const config = cmWithActive();
    addEcom(config, 42);
    const s = resolveSession({ target: "ecom" }, sources(config));
    expect(s.account.name).toBe("team");
    expect(s.project.id).toBe("3018488");
    expect(s.workspace).not.toBeNull();
    expect(s.workspace?.id).toBe(42);
  });
});

describe("TestNoSideEffects", () => {
  it("test_does_not_mutate_environ (re-expressed: sources untouched)", () => {
    const env: ResolverEnv = { MP_PROJECT_ID: "777" };
    const config = cmWithActive();
    const bag = sources(config, env);
    const envBefore = { ...env };
    const activeBefore = { ...config.active };
    const accountNamesBefore = [...config.accounts.keys()];
    resolveSession({}, bag);
    expect(env).toEqual(envBefore);
    expect(config.active).toEqual(activeBefore);
    expect([...config.accounts.keys()]).toEqual(accountNamesBefore);
  });

  it("test_does_not_read_oauth_tokens", () => {
    const config = cm();
    config.addAccount(
      parseAccount({
        type: "oauth_browser",
        name: "personal",
        region: "us",
        default_project: "3713224",
      }),
    );
    config.active = { account: "personal" };
    // No token store anywhere — should still construct a Session.
    const s = resolveSession({}, sources(config));
    expect(s.account.name).toBe("personal");
  });
});

describe("TestErrorMessages", () => {
  it("test_no_account_lists_options", () => {
    // cm has accounts but no [active].account; no env vars set.
    try {
      resolveSession({}, sources(cm()));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      // Should mention every fix path (per spec FR-024).
      expect((error as ConfigError).message.toLowerCase()).toContain("account");
    }
  });
});

describe("TestCrossSourceOrdering", () => {
  // ── Account axis ──────────────────────────────────────────────────

  it("test_bridge_account_beats_config_active", () => {
    const bridge = makeBridge({ project: "3713224" });
    const s = resolveSession({}, sources(cmWithActive(), {}, bridge));
    expect(s.account.name).toBe("bridge-account");
  });

  it("test_target_account_beats_bridge", () => {
    const config = cmWithActive();
    config.addTarget(
      new Target({
        name: "ecom",
        account: "team",
        project: "3713224",
        workspace: 42,
      }),
    );
    const bridge = makeBridge({ project: "3713224" });
    const s = resolveSession({ target: "ecom" }, sources(config, {}, bridge));
    expect(s.account.name).toBe("team");
  });

  it("test_env_sa_quad_beats_target", () => {
    const config = cmWithActive();
    config.addTarget(
      new Target({
        name: "ecom",
        account: "team",
        project: "3713224",
        workspace: 42,
      }),
    );
    const s = resolveSession({ target: "ecom" }, sources(config, SA_QUAD));
    expect(s.account.name).not.toBe("team");
  });

  it("test_env_sa_quad_beats_bridge", () => {
    const bridge = makeBridge({ project: "3713224" });
    const s = resolveSession({}, sources(cmWithActive(), SA_QUAD, bridge));
    expect(s.account.name).not.toBe("bridge-account");
  });

  // ── Project axis ──────────────────────────────────────────────────

  it("test_bridge_project_beats_account_default", () => {
    const bridge = makeBridge({ project: "3018488" });
    const s = resolveSession({}, sources(cmWithActive(), {}, bridge));
    expect(s.project.id).toBe("3018488");
  });

  it("test_target_project_beats_bridge", () => {
    const config = cmWithActive();
    config.addTarget(
      new Target({
        name: "ecom",
        account: "team",
        project: "3018488",
        workspace: 42,
      }),
    );
    const bridge = makeBridge({ project: "9999999" });
    const s = resolveSession({ target: "ecom" }, sources(config, {}, bridge));
    expect(s.project.id).toBe("3018488");
  });

  it("test_env_project_beats_target", () => {
    const config = cmWithActive();
    config.addTarget(
      new Target({
        name: "ecom",
        account: "team",
        project: "3018488",
        workspace: 42,
      }),
    );
    const s = resolveSession(
      { target: "ecom" },
      sources(config, { MP_PROJECT_ID: "5555555" }),
    );
    expect(s.project.id).toBe("5555555");
  });

  it("test_env_project_beats_bridge", () => {
    const bridge = makeBridge({ project: "3018488" });
    const s = resolveSession(
      {},
      sources(cmWithActive(), { MP_PROJECT_ID: "5555555" }, bridge),
    );
    expect(s.project.id).toBe("5555555");
  });

  // ── Workspace axis ────────────────────────────────────────────────

  it("test_bridge_workspace_beats_active", () => {
    const config = cmWithActive();
    config.active = { ...config.active, workspace: 99 };
    const bridge = makeBridge({ project: "3713224", workspace: 42 });
    const s = resolveSession({}, sources(config, {}, bridge));
    expect(s.workspace).not.toBeNull();
    expect(s.workspace?.id).toBe(42);
  });

  it("test_target_workspace_beats_bridge", () => {
    const config = cmWithActive();
    config.addTarget(
      new Target({
        name: "ecom",
        account: "team",
        project: "3713224",
        workspace: 77,
      }),
    );
    const bridge = makeBridge({ project: "3713224", workspace: 42 });
    const s = resolveSession({ target: "ecom" }, sources(config, {}, bridge));
    expect(s.workspace).not.toBeNull();
    expect(s.workspace?.id).toBe(77);
  });

  it("test_env_workspace_beats_target", () => {
    const config = cmWithActive();
    config.addTarget(
      new Target({
        name: "ecom",
        account: "team",
        project: "3713224",
        workspace: 77,
      }),
    );
    const s = resolveSession(
      { target: "ecom" },
      sources(config, { MP_WORKSPACE_ID: "999" }),
    );
    expect(s.workspace).not.toBeNull();
    expect(s.workspace?.id).toBe(999);
  });

  it("test_env_workspace_beats_bridge", () => {
    const bridge = makeBridge({ project: "3713224", workspace: 42 });
    const s = resolveSession(
      {},
      sources(cmWithActive(), { MP_WORKSPACE_ID: "999" }, bridge),
    );
    expect(s.workspace).not.toBeNull();
    expect(s.workspace?.id).toBe(999);
  });
});

// ---- test_042_edge_cases.py::TestResolverEdgeCases (:325-393) --------

describe("TestResolverEdgeCases (test_042_edge_cases.py)", () => {
  /**
   * Fresh empty config (the `empty_cm` fixture twin — no bridge by
   * construction, see file header).
   *
   * @returns An empty fake config.
   */
  function emptyCm(): FakeConfig {
    return new FakeConfig();
  }

  it("test_partial_sa_quad_no_secret_falls_through", () => {
    // No MP_SECRET → quad incomplete → no env account → no fallback →
    // raise.
    expect(() =>
      resolveSession(
        {},
        sources(emptyCm(), {
          MP_USERNAME: "u",
          MP_PROJECT_ID: "1",
          MP_REGION: "us",
        }),
      ),
    ).toThrow(ConfigError);
  });

  it("test_partial_sa_quad_no_username_falls_through", () => {
    expect(() =>
      resolveSession(
        {},
        sources(emptyCm(), {
          MP_SECRET: "s",
          MP_PROJECT_ID: "1",
          MP_REGION: "us",
        }),
      ),
    ).toThrow(ConfigError);
  });

  it.each(["abc", "0", "-1", "1.5"])(
    "test_workspace_id_invalid_raises_config_error[%s]",
    (badWorkspace) => {
      try {
        resolveSession(
          {},
          sources(emptyCm(), {
            MP_USERNAME: "u",
            MP_SECRET: "s",
            MP_PROJECT_ID: "1",
            MP_REGION: "us",
            MP_WORKSPACE_ID: badWorkspace,
          }),
        );
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        // pytest.raises(..., match="MP_WORKSPACE_ID")
        expect((error as ConfigError).message).toContain("MP_WORKSPACE_ID");
      }
    },
  );

  it("test_workspace_id_empty_string_treated_as_unset", () => {
    const s = resolveSession(
      {},
      sources(emptyCm(), {
        MP_USERNAME: "u",
        MP_SECRET: "s",
        MP_PROJECT_ID: "1",
        MP_REGION: "us",
        MP_WORKSPACE_ID: "",
      }),
    );
    expect(s.workspace ?? null).toBeNull();
  });
});

// ---- packet §2.2 rule locks (no Python-test counterpart; cited) ------

describe("packet §2.2 byte-for-byte rules", () => {
  it("invalid MP_REGION aborts even with an explicit account param", () => {
    // Caution #2: the raise position — env-account synthesis runs
    // before the explicit-param rung and raises unconditionally.
    const config = cmWithActive();
    try {
      resolveSession(
        { account: "team" },
        sources(config, { MP_REGION: "mars" }),
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).details).toEqual({
        env_var: "MP_REGION",
        value: "mars",
      });
    }
  });

  it("MP_PROJECT_ID non-digit raises with {env_var, value} details", () => {
    try {
      resolveSession({}, sources(cmWithActive(), { MP_PROJECT_ID: "12a" }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).details).toEqual({
        env_var: "MP_PROJECT_ID",
        value: "12a",
      });
    }
  });

  it("empty-string env values fall through for every var (watchlist #6)", () => {
    const s = resolveSession(
      {},
      sources(cmWithActive(), {
        MP_USERNAME: "",
        MP_SECRET: "",
        MP_PROJECT_ID: "",
        MP_REGION: "",
        MP_OAUTH_TOKEN: "",
        MP_WORKSPACE_ID: "",
      }),
    );
    expect(s.account.name).toBe("team");
    expect(s.project.id).toBe("3713224");
    expect(s.workspace ?? null).toBeNull();
  });

  it("header merge: settings entry first, bridge overrides on collision", () => {
    const config = cmWithActive();
    config.customHeader = ["X-Custom", "from-settings"];
    const bridge: BridgeView = {
      ...makeBridge({ project: "3713224" }),
      headers: { "X-Custom": "from-bridge", "X-Extra": "b" },
    };
    const s = resolveSession({}, sources(config, {}, bridge));
    expect(s.headers.get("X-Custom")).toBe("from-bridge");
    expect(s.headers.get("X-Extra")).toBe("b");
    const settingsOnly = resolveSession({}, sources(config));
    expect(settingsOnly.headers.get("X-Custom")).toBe("from-settings");
  });

  it("explicit workspace 0 / negative → ConfigError 'Invalid workspace ID'", () => {
    for (const bad of [0, -1]) {
      try {
        resolveSession({ workspace: bad }, sources(cmWithActive()));
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as ConfigError).message).toContain(
          "Invalid workspace ID",
        );
      }
    }
  });

  it("explicit non-digit project → ConfigError 'Invalid project ID'", () => {
    try {
      resolveSession({ project: "not-digits" }, sources(cmWithActive()));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).message).toContain("Invalid project ID");
    }
  });

  it("envWorkspaceId parses via the pythonInt twin (R11.7)", () => {
    // CPython int() grammar: underscores between digits, surrounding
    // whitespace, sign.
    expect(envWorkspaceId({ MP_WORKSPACE_ID: "1_0" })).toBe(10);
    expect(envWorkspaceId({ MP_WORKSPACE_ID: " 42 " })).toBe(42);
    expect(envWorkspaceId({ MP_WORKSPACE_ID: "+7" })).toBe(7);
    expect(envWorkspaceId({})).toBeNull();
    expect(envWorkspaceId({ MP_WORKSPACE_ID: "" })).toBeNull();
    expect(() => envWorkspaceId({ MP_WORKSPACE_ID: "0" })).toThrow(ConfigError);
    // PY_INT_UNSAFE_INTEGER beyond 2^53−1 maps to the same coded
    // ConfigError (packet §2.2; Discrepancy #6/#7 family).
    expect(() =>
      envWorkspaceId({ MP_WORKSPACE_ID: "9007199254740993" }),
    ).toThrow(ConfigError);
  });
});
