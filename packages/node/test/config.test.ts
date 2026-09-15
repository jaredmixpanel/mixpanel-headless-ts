// ConfigManager. Mirrors tests/unit/test_config.py (all twelve classes) plus
// test_042_edge_cases.py::TestConfigManagerEdgeCases; the tmp-dir
// `config_path` fixtures become `makeTempDir`. Additive: the manager never
// promotes the first account to active (the ConfigWrites adapter does),
// parent-directory modes on write, and errno wrapping at the symlink probe.

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AccountInUseError,
  AccountSummary,
  ConfigError,
  type OAuthTokenAccount,
  ParamValidationError,
  Secret,
  type ServiceAccount,
} from "@mixpanel-headless/core";

import { ConfigManager } from "../src/config.js";
import { atomicWriteBytes } from "../src/io-utils.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

const POSIX = process.platform !== "win32";

const cleanups: Array<() => void> = [];
afterEach(() => {
  vi.unstubAllEnvs();
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/** Fresh manager over a non-existent tmp config path (the `cm` fixture). */
function freshCm(): ConfigManager {
  const dir = makeTempDir(cleanups);
  return new ConfigManager({ configPath: join(dir, "config.toml") });
}

/** Add the standard SA used across the Python fixtures. */
function addSa(
  cm: ConfigManager,
  name = "x",
  defaultProject: string | null = "3713224",
): void {
  cm.addAccount(name, {
    type: "service_account",
    region: "us",
    ...(defaultProject === null ? {} : { default_project: defaultProject }),
    username: "u",
    secret: new Secret("s"),
  });
}

describe("ConfigManager load with an empty or missing file", () => {
  // python: TestLoadEmptyOrMissing
  it("loads an empty account list when the config file is missing", () => {
    // python: test_load_missing_file
    const cm = freshCm();
    expect(cm.listAccounts()).toStrictEqual([]);
    expect(cm.listTargets()).toStrictEqual([]);
    const active = cm.getActive();
    expect(active.account ?? null).toBeNull();
    expect(active.workspace ?? null).toBeNull();
  });

  it("loads an empty account list from an empty config file", () => {
    // python: test_load_empty_file
    const dir = makeTempDir(cleanups);
    const p = join(dir, "config.toml");
    writeFileSync(p, "");
    if (POSIX) {
      chmodSync(p, 0o600);
    }
    const cm = new ConfigManager({ configPath: p });
    expect(cm.listAccounts()).toStrictEqual([]);
    expect(cm.listTargets()).toStrictEqual([]);
    expect(cm.getActive().account ?? null).toBeNull();
  });
});

describe("ConfigManager.addAccount", () => {
  // python: TestAddAccount
  it("persists a service account and reads it back", () => {
    // python: test_service_account
    const cm = freshCm();
    cm.addAccount("team", {
      type: "service_account",
      region: "us",
      default_project: "3713224",
      username: "sa.user",
      secret: new Secret("super-secret"),
    });
    const cm2 = new ConfigManager({ configPath: cm.configPath });
    const accounts = cm2.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.name).toBe("team");
    expect(accounts[0]?.type).toBe("service_account");
    expect(accounts[0]?.region).toBe("us");
    const loaded = cm2.getAccount("team") as ServiceAccount;
    expect(loaded.type).toBe("service_account");
    expect(loaded.username).toBe("sa.user");
    expect(loaded.secret.reveal()).toBe("super-secret");
    expect(loaded.default_project).toBe("3713224");
  });

  it("persists an oauth_browser account with no default project", () => {
    // python: test_oauth_browser_account
    const cm = freshCm();
    cm.addAccount("personal", { type: "oauth_browser", region: "eu" });
    const cm2 = new ConfigManager({ configPath: cm.configPath });
    const loaded = cm2.getAccount("personal");
    expect(loaded.type).toBe("oauth_browser");
    expect(loaded.region).toBe("eu");
    expect(loaded.default_project ?? null).toBeNull();
  });

  it("persists an oauth_token account with an inline token", () => {
    // python: test_oauth_token_with_inline
    const cm = freshCm();
    cm.addAccount("ci", {
      type: "oauth_token",
      region: "us",
      default_project: "3713224",
      token: new Secret("ey.tok"),
    });
    const cm2 = new ConfigManager({ configPath: cm.configPath });
    const loaded = cm2.getAccount("ci") as OAuthTokenAccount;
    expect(loaded.type).toBe("oauth_token");
    expect(loaded.token?.reveal()).toBe("ey.tok");
    expect(loaded.token_env ?? null).toBeNull();
    expect(loaded.default_project).toBe("3713224");
  });

  it("persists an oauth_token account that names a token env var", () => {
    // python: test_oauth_token_with_env
    const cm = freshCm();
    cm.addAccount("agent", {
      type: "oauth_token",
      region: "eu",
      default_project: "3713224",
      token_env: "MP_OAUTH_TOKEN",
    });
    const cm2 = new ConfigManager({ configPath: cm.configPath });
    const loaded = cm2.getAccount("agent") as OAuthTokenAccount;
    expect(loaded.token ?? null).toBeNull();
    expect(loaded.token_env).toBe("MP_OAUTH_TOKEN");
  });

  it("accepts a service account without a default project", () => {
    // python: test_service_account_without_default_project_succeeds
    const cm = freshCm();
    cm.addAccount("team", {
      type: "service_account",
      region: "us",
      username: "u",
      secret: new Secret("s"),
    });
    expect(cm.getAccount("team").default_project ?? null).toBeNull();
  });

  it("accepts an oauth_token account without a default project", () => {
    // python: test_oauth_token_without_default_project_succeeds
    const cm = freshCm();
    cm.addAccount("ci", {
      type: "oauth_token",
      region: "us",
      token: new Secret("ey.tok"),
    });
    expect(cm.getAccount("ci").default_project ?? null).toBeNull();
  });

  it("raises a plain ConfigError for a duplicate account name", () => {
    // python: test_duplicate_name_raises
    const cm = freshCm();
    addSa(cm);
    let error: unknown;
    try {
      cm.addAccount("x", { type: "oauth_browser", region: "us" });
    } catch (error_) {
      error = error_;
    }
    // PLAIN ConfigError / CONFIG_ERROR (`config.py`) — never
    // AccountExistsError (B7-ARB-B B-E2E-F1).
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("CONFIG_ERROR");
    expect((error as ConfigError).name).toBe("ConfigError");
  });

  it("raises ConfigError for an invalid account name", () => {
    // python: test_invalid_name_raises
    const cm = freshCm();
    expect(() =>
      cm.addAccount("bad name", {
        type: "service_account",
        region: "us",
        default_project: "3713224",
        username: "u",
        secret: new Secret("s"),
      }),
    ).toThrow(ConfigError);
  });

  it("never promotes the first account to active", () => {
    // ADDED lock (header note): the MANAGER layer never promotes; the
    // FR-045 first-account promotion happens exactly once, in the
    // `ConfigWrites.addAccount` adapter transaction (config-writes.ts).
    const cm = freshCm();
    addSa(cm, "first");
    expect(cm.getActive().account ?? null).toBeNull();
  });
});

describe("ConfigManager.updateAccount", () => {
  // python: TestUpdateAccount
  it("updates an account's default project", () => {
    // python: test_update_default_project
    const cm = freshCm();
    addSa(cm, "team");
    cm.updateAccount("team", { default_project: "9999999" });
    expect(cm.getAccount("team").default_project).toBe("9999999");
  });

  it("updates an account's region", () => {
    // python: test_update_region
    const cm = freshCm();
    cm.addAccount("personal", { type: "oauth_browser", region: "us" });
    cm.updateAccount("personal", { region: "eu" });
    expect(cm.getAccount("personal").region).toBe("eu");
  });

  it("raises ConfigError when the account does not exist", () => {
    // python: test_update_missing_account_raises
    const cm = freshCm();
    expect(() => cm.updateAccount("ghost", { default_project: "1" })).toThrow(
      ConfigError,
    );
  });

  it("raises ConfigError when setting a username on an oauth_browser account", () => {
    // python: test_update_username_on_browser_raises
    const cm = freshCm();
    cm.addAccount("personal", { type: "oauth_browser", region: "us" });
    expect(() => cm.updateAccount("personal", { username: "u" })).toThrow(
      ConfigError,
    );
  });
});

describe("ConfigManager.setActive", () => {
  // python: TestSetActive
  it("sets the active account and leaves the workspace unset", () => {
    // python: test_set_account_only
    const cm = freshCm();
    addSa(cm);
    cm.setActive({ account: "x" });
    const active = cm.getActive();
    expect(active.account).toBe("x");
    expect(active.workspace ?? null).toBeNull();
  });

  it("sets the active workspace and leaves the account unset", () => {
    // python: test_set_workspace_only
    const cm = freshCm();
    cm.setActive({ workspace: 8 });
    const active = cm.getActive();
    expect(active.account ?? null).toBeNull();
    expect(active.workspace).toBe(8);
  });

  it("sets the active account and workspace together", () => {
    // python: test_set_both
    const cm = freshCm();
    addSa(cm);
    cm.setActive({ account: "x", workspace: 8 });
    const active = cm.getActive();
    expect(active.account).toBe("x");
    expect(active.workspace).toBe(8);
  });

  it("raises ConfigError for an unknown account", () => {
    // python: test_account_must_exist
    const cm = freshCm();
    expect(() => cm.setActive({ account: "nonexistent" })).toThrow(ConfigError);
  });

  it("raises ConfigError for a non-positive workspace id", () => {
    // python: test_workspace_must_be_positive
    const cm = freshCm();
    expect(() => cm.setActive({ workspace: 0 })).toThrow(ConfigError);
    expect(() => cm.setActive({ workspace: -5 })).toThrow(ConfigError);
  });

  it("keeps the other axis when only one is updated", () => {
    // python: test_partial_update_preserves_other_axis
    const cm = freshCm();
    addSa(cm);
    cm.setActive({ account: "x" });
    cm.setActive({ workspace: 8 });
    const active = cm.getActive();
    expect(active.account).toBe("x");
    expect(active.workspace).toBe(8);
  });
});

describe("ConfigManager.applySession", () => {
  // python: TestApplySession
  /** Seed a SA named `name` with default_project 100. */
  function seed(cm: ConfigManager, name = "x"): void {
    cm.addAccount(name, {
      type: "service_account",
      region: "us",
      default_project: "100",
      username: "u",
      secret: new Secret("s"),
    });
  }

  it("writes account, project and workspace in one call", () => {
    // python: test_atomic_three_axis_write
    const cm = freshCm();
    seed(cm);
    cm.applySession({ account: "x", project: "200", workspace: 42 });
    const active = cm.getActive();
    expect(active.account).toBe("x");
    expect(active.workspace).toBe(42);
    expect(cm.getAccount("x").default_project).toBe("200");
  });

  it("drops the active workspace when clear_workspace is set", () => {
    // python: test_clear_workspace_drops_active_workspace_axis
    const cm = freshCm();
    seed(cm);
    cm.setActive({ account: "x", workspace: 99 });
    cm.applySession({ account: "x", project: "100", clear_workspace: true });
    const active = cm.getActive();
    expect(active.account).toBe("x");
    expect(active.workspace ?? null).toBeNull();
  });

  it("rejects workspace together with clear_workspace", () => {
    // python: test_workspace_and_clear_workspace_mutually_exclusive
    const cm = freshCm();
    seed(cm);
    // Python raises bare ValueError; the coded twin is
    // ParamValidationError / VALIDATION_ERROR (fake-auth-effects.ts
    // precedent over `config.py`).
    expect(() =>
      cm.applySession({
        account: "x",
        project: "100",
        workspace: 42,
        clear_workspace: true,
      }),
    ).toThrow(/mutually exclusive/);
    expect(() =>
      cm.applySession({ workspace: 42, clear_workspace: true }),
    ).toThrow(ParamValidationError);
  });

  it("raises when a project is given with no active or explicit account", () => {
    // python: test_project_without_active_or_explicit_account_raises
    const cm = freshCm();
    expect(() => cm.applySession({ project: "100" })).toThrow(
      /no active account/,
    );
  });

  it("writes the project to the explicit account, not the active one", () => {
    // python: test_project_writes_to_explicit_account_not_active
    const cm = freshCm();
    seed(cm, "x");
    seed(cm, "y");
    cm.setActive({ account: "x" });
    cm.applySession({ account: "y", project: "500" });
    expect(cm.getAccount("y").default_project).toBe("500");
    expect(cm.getAccount("x").default_project).toBe("100");
  });

  it("leaves untouched axes alone on a partial update", () => {
    // python: test_partial_update_preserves_untouched_axes
    const cm = freshCm();
    seed(cm);
    cm.setActive({ account: "x", workspace: 10 });
    cm.applySession({ workspace: 99 });
    const active = cm.getActive();
    expect(active.account).toBe("x");
    expect(active.workspace).toBe(99);
    expect(cm.getAccount("x").default_project).toBe("100");
  });
});

describe("ConfigManager targets", () => {
  // python: TestTargets
  it("adds a target with account and project only", () => {
    // python: test_add_target_minimal
    const cm = freshCm();
    addSa(cm);
    cm.addTarget("ecom", { account: "x", project: "3018488" });
    const targets = cm.listTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0]?.name).toBe("ecom");
    expect(targets[0]?.account).toBe("x");
    expect(targets[0]?.project).toBe("3018488");
    expect(targets[0]?.workspace).toBeNull();
  });

  it("adds a target with a workspace", () => {
    // python: test_add_target_with_workspace
    const cm = freshCm();
    addSa(cm);
    cm.addTarget("ecom", { account: "x", project: "3018488", workspace: 42 });
    expect(cm.getTarget("ecom").workspace).toBe(42);
  });

  it("raises ConfigError when the target references an unknown account", () => {
    // python: test_add_target_referencing_missing_account_raises
    const cm = freshCm();
    expect(() =>
      cm.addTarget("ecom", { account: "nonexistent", project: "3018488" }),
    ).toThrow(ConfigError);
  });

  it("removes a target", () => {
    // python: test_remove_target
    const cm = freshCm();
    addSa(cm);
    cm.addTarget("ecom", { account: "x", project: "3018488" });
    cm.removeTarget("ecom");
    expect(() => cm.getTarget("ecom")).toThrow(ConfigError);
  });

  it("applyTarget sets the active account, workspace and default project", () => {
    // python: test_apply_target_writes_account_workspace_and_default_project
    const cm = freshCm();
    addSa(cm);
    cm.addTarget("ecom", { account: "x", project: "3018488", workspace: 8 });
    cm.applyTarget("ecom");
    const active = cm.getActive();
    expect(active.account).toBe("x");
    expect(active.workspace).toBe(8);
    expect(cm.getAccount("x").default_project).toBe("3018488");
  });

  it("applyTarget clears the active workspace when the target has none", () => {
    // python: test_apply_target_missing_workspace_clears_workspace
    const cm = freshCm();
    addSa(cm);
    cm.setActive({ account: "x", workspace: 99 });
    cm.addTarget("nows", { account: "x", project: "3018488" });
    cm.applyTarget("nows");
    expect(cm.getActive().workspace ?? null).toBeNull();
    expect(cm.getAccount("x").default_project).toBe("3018488");
  });

  it("applyTarget raises ConfigError for an unknown target", () => {
    // python: test_apply_missing_target_raises
    const cm = freshCm();
    expect(() => cm.applyTarget("ghost")).toThrow(ConfigError);
  });
});

describe("ConfigManager.listAccounts", () => {
  // python: TestListAccounts
  it("returns AccountSummary instances", () => {
    // python: test_returns_summary_objects
    const cm = freshCm();
    addSa(cm, "team");
    cm.addAccount("personal", { type: "oauth_browser", region: "eu" });
    const summaries = cm.listAccounts();
    expect(summaries.every((a) => a instanceof AccountSummary)).toBe(true);
    expect(summaries.map((a) => a.name).sort()).toStrictEqual([
      "personal",
      "team",
    ]);
  });

  it("flags only the active account", () => {
    // python: test_is_active_flag
    const cm = freshCm();
    addSa(cm, "team");
    cm.addAccount("personal", { type: "oauth_browser", region: "us" });
    cm.setActive({ account: "team" });
    const byName = new Map(cm.listAccounts().map((a) => [a.name, a]));
    expect(byName.get("team")?.is_active).toBe(true);
    expect(byName.get("personal")?.is_active).toBe(false);
  });

  it("lists the targets that reference each account", () => {
    // python: test_referenced_by_targets
    const cm = freshCm();
    addSa(cm);
    cm.addTarget("ecom", { account: "x", project: "3018488" });
    cm.addTarget("ai", { account: "x", project: "3713224" });
    const summary = cm.listAccounts().find((a) => a.name === "x");
    expect([...(summary?.referenced_by_targets ?? [])].sort()).toStrictEqual([
      "ai",
      "ecom",
    ]);
  });
});

describe("ConfigManager.removeAccount", () => {
  // python: TestRemoveAccount
  it("removes an unreferenced account and returns no orphans", () => {
    // python: test_remove_unused
    const cm = freshCm();
    addSa(cm);
    expect(cm.removeAccount("x")).toStrictEqual([]);
    expect(cm.listAccounts()).toStrictEqual([]);
  });

  it("raises AccountInUseError when targets reference the account", () => {
    // python: test_remove_referenced_without_force_raises
    const cm = freshCm();
    addSa(cm);
    cm.addTarget("ecom", { account: "x", project: "3018488" });
    expect(() => cm.removeAccount("x")).toThrow(AccountInUseError);
  });

  it("returns the orphaned target names when forced", () => {
    // python: test_remove_with_force_returns_orphans
    const cm = freshCm();
    addSa(cm);
    cm.addTarget("ecom", { account: "x", project: "3018488" });
    cm.addTarget("ai", { account: "x", project: "3713224" });
    expect(cm.removeAccount("x", { force: true }).sort()).toStrictEqual([
      "ai",
      "ecom",
    ]);
  });

  it("clears the active block when the active account is removed", () => {
    // python: test_remove_active_account_clears_active_block
    const cm = freshCm();
    addSa(cm);
    cm.setActive({ account: "x", workspace: 42 });
    expect(cm.getActive()).toMatchObject({ account: "x", workspace: 42 });
    cm.removeAccount("x");
    const active = cm.getActive();
    expect(active.account ?? null).toBeNull();
    expect(active.workspace ?? null).toBeNull();
  });

  it("keeps the active block when another account is removed", () => {
    // python: test_remove_non_active_account_preserves_active_block
    const cm = freshCm();
    cm.addAccount("active_one", {
      type: "service_account",
      region: "us",
      default_project: "3713224",
      username: "u1",
      secret: new Secret("s"),
    });
    cm.addAccount("other", {
      type: "service_account",
      region: "us",
      default_project: "3018488",
      username: "u2",
      secret: new Secret("s"),
    });
    cm.setActive({ account: "active_one", workspace: 42 });
    cm.removeAccount("other");
    expect(cm.getActive()).toMatchObject({
      account: "active_one",
      workspace: 42,
    });
  });
});

describe("ConfigManager loading the fixture configs", () => {
  // python: TestFixtureLoad
  // Fixture TOML carried VERBATIM from tests/fixtures/configs/ (packet
  // §0.4 — read-side locks over the exact Python bytes).
  function loadFixture(name: string): ConfigManager {
    const src = new URL(`fixtures/configs/${name}`, import.meta.url);
    const dir = makeTempDir(cleanups);
    const dst = join(dir, "config.toml");
    writeFileSync(dst, readFileSync(src));
    if (POSIX) {
      chmodSync(dst, 0o600);
    }
    return new ConfigManager({ configPath: dst });
  }

  it("reads the single-account fixture", () => {
    // python: test_simple
    const cm = loadFixture("simple.toml");
    const accounts = cm.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.name).toBe("demo-sa");
    const active = cm.getActive();
    expect(active.account).toBe("demo-sa");
    expect(active.workspace).toBe(3448413);
    expect(cm.getAccount("demo-sa").default_project).toBe("3713224");
  });

  it("reads the multi-account fixture with targets", () => {
    // python: test_multi
    const cm = loadFixture("multi.toml");
    const accounts = new Map(cm.listAccounts().map((a) => [a.name, a]));
    expect(accounts.get("team")?.type).toBe("service_account");
    expect(accounts.get("personal")?.type).toBe("oauth_browser");
    expect(accounts.get("ci")?.type).toBe("oauth_token");
    const targets = new Map(cm.listTargets().map((t) => [t.name, t]));
    expect(targets.get("ecom")?.workspace).toBe(3448414);
    expect(targets.get("ai")?.workspace).toBeNull();
  });
});

describe("ConfigManager custom header setting", () => {
  // python: TestSettingsCustomHeader
  it("round-trips the custom header through the file", () => {
    // python: test_custom_header_round_trip
    const cm = freshCm();
    cm.setCustomHeader({ name: "X-Mixpanel-Cluster", value: "internal-1" });
    const cm2 = new ConfigManager({ configPath: cm.configPath });
    expect(cm2.getCustomHeader()).toStrictEqual([
      "X-Mixpanel-Cluster",
      "internal-1",
    ]);
  });

  it("returns null when no custom header is set", () => {
    // python: test_get_custom_header_when_absent
    const cm = freshCm();
    expect(cm.getCustomHeader()).toBeNull();
  });
});

describe("ConfigManager.transaction", () => {
  // python: TestMutateTransaction
  it("writes the file once per transaction", () => {
    // python: test_single_write_per_transaction
    const dir = makeTempDir(cleanups);
    const path = join(dir, "config.toml");
    let writes = 0;
    // The `patch("...config.atomic_write_bytes")` twin: the manager's
    // injectable write seam counts calls while delegating to the real
    // helper (documented @internal seam, config.ts).
    const cm = new ConfigManager({
      configPath: path,
      writeBytes: (target, data, options) => {
        writes += 1;
        atomicWriteBytes(target, data, options);
      },
    });
    addSa(cm);
    writes = 0;
    cm.transaction((raw) => {
      ConfigManager.applySetActive(raw, { account: "x", workspace: 42 });
      ConfigManager.applyUpdateAccount(raw, "x", {
        default_project: "456",
      });
    });
    expect(writes).toBe(1);
  });

  it("leaves the file untouched when the transaction throws", () => {
    // python: test_aborted_transaction_does_not_write
    const cm = freshCm();
    addSa(cm);
    const original = readFileSync(cm.configPath);
    expect(() =>
      cm.transaction((raw) => {
        ConfigManager.applySetActive(raw, { account: "x", workspace: 42 });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(readFileSync(cm.configPath)).toStrictEqual(original);
    expect(cm.getActive().account ?? null).toBeNull();
  });

  it("rolls back every step when a later step fails validation", () => {
    // python: test_multi_call_atomicity_on_validation_failure
    const cm = freshCm();
    cm.addAccount("x", {
      type: "service_account",
      region: "us",
      default_project: "123",
      username: "u",
      secret: new Secret("s"),
    });
    expect(() =>
      cm.transaction((raw) => {
        ConfigManager.applyUpdateAccount(raw, "x", {
          default_project: "999",
        });
        ConfigManager.applySetActive(raw, { account: "missing-account" });
      }),
    ).toThrow(/not configured/);
    const cm2 = new ConfigManager({ configPath: cm.configPath });
    expect(cm2.getAccount("x").default_project).toBe("123");
  });

  it("refuses to write over legacy v2 account blocks", () => {
    // python: test_legacy_v2_blocks_block_writes_no_partial_persist
    const dir = makeTempDir(cleanups);
    const p = join(dir, "config.toml");
    writeFileSync(
      p,
      '[accounts.legacy]\nusername = "u"\nsecret = "s"\nproject_id = "111"\nregion = "us"\n',
    );
    if (POSIX) {
      chmodSync(p, 0o600);
    }
    const original = readFileSync(p);
    const cm = new ConfigManager({ configPath: p });
    expect(() =>
      cm.addAccount("fresh", { type: "oauth_browser", region: "us" }),
    ).toThrow(/\[accounts\.legacy\]/);
    expect(readFileSync(p)).toStrictEqual(original);
  });
});

describe("ConfigManager symlink rejection", () => {
  // python: TestSymlinkRejection
  it.skipIf(!POSIX)(
    "raises ConfigError when the config path is a symlink",
    () => {
      // python: test_symlink_config_raises_configerror
      const dir = makeTempDir(cleanups);
      const attacker = join(dir, "attacker.toml");
      writeFileSync(attacker, '[active]\naccount = "evil"\n');
      chmodSync(attacker, 0o600);
      const link = join(dir, "config.toml");
      symlinkSync(attacker, link);
      const cm = new ConfigManager({ configPath: link });
      expect(() => cm.listAccounts()).toThrow(ConfigError);
      expect(() => cm.listAccounts()).toThrow(/symlink/);
    },
  );

  it.skipIf(!POSIX)("raises ConfigError for a dangling config symlink", () => {
    // python: test_dangling_symlink_config_still_rejected
    const dir = makeTempDir(cleanups);
    const link = join(dir, "config.toml");
    symlinkSync(join(dir, "does-not-exist.toml"), link);
    const cm = new ConfigManager({ configPath: link });
    expect(() => cm.listAccounts()).toThrow(ConfigError);
    expect(() => cm.listAccounts()).toThrow(/symlink/);
  });
});

// tests/unit/test_042_edge_cases.py::TestConfigManagerEdgeCases :459
// (inbound deferral — translated against the real node ConfigManager).
describe("ConfigManager edge cases", () => {
  // python: test_042_edge_cases.py::TestConfigManagerEdgeCases
  it("reads a legacy config_version = 2 file as having no accounts", () => {
    // python: test_legacy_v2_config_no_longer_decodes_as_accounts
    const dir = makeTempDir(cleanups);
    const p = join(dir, "config.toml");
    writeFileSync(p, "config_version = 2\n");
    if (POSIX) {
      chmodSync(p, 0o600);
    }
    const cm = new ConfigManager({ configPath: p });
    expect(cm.listAccounts()).toStrictEqual([]);
  });

  it.skipIf(!POSIX)("writes the config 0o600 under a loose umask", () => {
    // python: test_file_permissions_under_loose_umask
    const oldUmask = process.umask(0o022);
    try {
      const dir = makeTempDir(cleanups);
      const cm = new ConfigManager({ configPath: join(dir, "config.toml") });
      addSa(cm, "team");
      expect(statSync(cm.configPath).mode & 0o7777).toBe(0o600);
    } finally {
      process.umask(oldUmask);
    }
  });

  it("setActive is idempotent", () => {
    // python: test_set_active_idempotent
    const cm = freshCm();
    addSa(cm, "team");
    cm.setActive({ account: "team" });
    cm.setActive({ account: "team" });
    expect(cm.getActive().account).toBe("team");
  });
});

// TS-only (CLEANUP-PLAN 8.5): the parent-dir 0o700 tighten applies to
// the default `~/.mp` only; a custom `configPath` parent keeps its mode.
describe("parent directory mode on write", () => {
  it.skipIf(!POSIX)(
    "writeRaw leaves a custom parent directory's mode alone; file is still 0o600",
    () => {
      const custom = join(makeTempDir(cleanups), "shared-config");
      mkdirSync(custom);
      chmodSync(custom, 0o755);
      const cm = new ConfigManager({ configPath: join(custom, "mp.toml") });
      addSa(cm, "team");
      expect(statSync(custom).mode & 0o777).toBe(0o755);
      expect(statSync(cm.configPath).mode & 0o7777).toBe(0o600);
    },
  );

  it.skipIf(!POSIX)(
    "writeRaw still tightens the default ~/.mp parent to 0o700",
    () => {
      scrubMpEnv();
      const home = makeTempDir(cleanups);
      vi.stubEnv("HOME", home);
      const mpDir = join(home, ".mp");
      mkdirSync(mpDir);
      chmodSync(mpDir, 0o755);
      const cm = new ConfigManager();
      expect(cm.configPath).toBe(join(mpDir, "config.toml"));
      addSa(cm, "team");
      expect(statSync(mpDir).mode & 0o777).toBe(0o700);
      expect(statSync(cm.configPath).mode & 0o7777).toBe(0o600);
    },
  );
});

// B8-ARB-A SEM-F6 (b8-reviewA-resolution.md): Python `_read_raw` wraps
// ANY OSError from the symlink probe into ConfigError
// (`config.py` `except OSError`); the pre-fix TS `readRaw`
// rethrew errno-bearing probe failures uncoded (only
// CredentialPathError was wrapped).
describe("ConfigManager symlink-probe errno wrapping", () => {
  it.skipIf(!POSIX || process.getuid?.() === 0)(
    "config under an unreadable parent dir raises ConfigError, not a raw errno error",
    () => {
      const locked = join(makeTempDir(cleanups), "locked");
      mkdirSync(locked);
      chmodSync(locked, 0o000);
      cleanups.push(() => {
        chmodSync(locked, 0o700);
      });
      const cm = new ConfigManager({
        configPath: join(locked, "config.toml"),
      });
      expect(() => cm.listAccounts()).toThrow(ConfigError);
    },
  );

  // SEM-F2 family ripple (arbiter-caught): Python `_read_raw` catches
  // `(tomllib.TOMLDecodeError, OSError)` only (`config.py:186-189`) —
  // an invalid-UTF-8 config file raises UnicodeDecodeError RAW (live
  // CPython probe in the resolution). The TS twin (TextDecoder
  // fatal-mode TypeError) must propagate — it carries the string code
  // ERR_ENCODING_INVALID_ENCODED_DATA, so a code-only OSError-twin
  // predicate would have wrapped it into ConfigError.
  it.skipIf(!POSIX)(
    "invalid-UTF-8 config file (0600) raises the RAW decode TypeError, not ConfigError",
    () => {
      const path = join(makeTempDir(cleanups), "config.toml");
      writeFileSync(path, Buffer.from([0xff, 0xfe]));
      chmodSync(path, 0o600);
      const cm = new ConfigManager({ configPath: path });
      let caught: unknown = null;
      try {
        cm.listAccounts();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TypeError);
      expect(caught).not.toBeInstanceOf(ConfigError);
    },
  );
});
