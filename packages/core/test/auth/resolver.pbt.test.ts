// Layer-3 translation of `tests/pbt/test_resolver_pbt.py` (173 lines,
// 5 Hypothesis properties) — B7-A2 packet §2.4 (`b7-packets.md`).
//
// Strategy shapes preserved (packet §2.4): name alphabet
// `[a-zA-Z0-9_-]{1,12}`, project `^[1-9][0-9]{0,9}$`, workspace
// 1..2^31−1. Mechanism substitutions (header-cited per R10.2):
// - the tmp-dir `_build_cm` fixture becomes an in-memory
//   `ResolverConfigSource` fake (fresh per example, as in Python);
// - `monkeypatch.setenv` becomes an env-bag literal in the sources.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { type Account, parseAccount } from "../../src/auth/account.js";
import {
  type ResolverConfigSource,
  type ResolverEnv,
  type ResolverSources,
  resolveSession,
} from "../../src/auth/resolver.js";
import type { ActiveSession } from "../../src/auth/session.js";
import { AccountNotFoundError, ConfigError } from "../../src/errors.js";
import type { Target } from "../../src/types/entities/accounts.js";

/** Characters of the Python `_NAME_ALPHABET`. */
const NAME_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";

/** `account_names = st.text(alphabet=_NAME_ALPHABET, 1..12)`. */
const accountNames = fc
  .array(fc.integer({ min: 0, max: NAME_ALPHABET.length - 1 }), {
    minLength: 1,
    maxLength: 12,
  })
  .map((indexes) => indexes.map((i) => NAME_ALPHABET[i] ?? "a").join(""));

/** `project_ids = st.from_regex(r"^[1-9][0-9]{0,9}$")`. */
const projectIds = fc
  .tuple(
    fc.integer({ min: 1, max: 9 }),
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 0, maxLength: 9 }),
  )
  .map(([head, tail]) => `${String(head)}${tail.join("")}`);

/** `workspace_ids = st.integers(1, 2**31 - 1)`. */
const workspaceIds = fc.integer({ min: 1, max: 2 ** 31 - 1 });

/** Minimal in-memory config source (the `_build_cm` twin). */
class PbtConfig implements ResolverConfigSource {
  readonly accounts = new Map<string, Account>();
  active: ActiveSession = {};

  /**
   * Look up an account by name.
   *
   * @param name - Account name.
   * @returns The stored account.
   * @throws AccountNotFoundError - Unknown name.
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
   * @returns The active session.
   */
  getActive(): ActiveSession {
    return this.active;
  }

  /**
   * Look up a target (unused by these properties).
   *
   * @param name - Target name.
   * @returns Never returns.
   * @throws ConfigError - Always (no targets registered).
   */
  getTarget(name: string): Target {
    throw new ConfigError(`Unknown target: ${name}`);
  }

  /**
   * Read `[settings].custom_header` (none registered).
   *
   * @returns Always null.
   */
  getCustomHeader(): readonly [string, string] | null {
    return null;
  }
}

/**
 * Build a fresh config seeded with one SA + active state (the
 * `_build_cm` twin: project lives on the account as `default_project`,
 * FR-012; only `account` goes to `[active]`).
 *
 * @param name - Account name to register.
 * @param project - Project ID set as the account's `default_project`.
 * @returns The config source.
 */
function buildCm(name: string, project: string): PbtConfig {
  const config = new PbtConfig();
  config.accounts.set(
    name,
    parseAccount({
      type: "service_account",
      name,
      region: "us",
      default_project: project,
      username: "u",
      secret: "s",
    }),
  );
  config.active = { account: name };
  return config;
}

/**
 * Assemble the sources bag (no bridge; env defaults empty).
 *
 * @param config - The config source.
 * @param env - Optional env bag.
 * @returns The sources bag.
 */
function sources(
  config: ResolverConfigSource,
  env: ResolverEnv = {},
): ResolverSources {
  return { env, config, bridge: null };
}

describe("resolver PBT (test_resolver_pbt.py)", () => {
  it("test_resolver_determinism", () => {
    fc.assert(
      fc.property(accountNames, projectIds, (name, project) => {
        const config = buildCm(name, project);
        const s1 = resolveSession({}, sources(config));
        const s2 = resolveSession({}, sources(config));
        expect(s1).toEqual(s2);
      }),
    );
  });

  it("test_axis_independence_project_does_not_change_account", () => {
    fc.assert(
      fc.property(
        accountNames,
        projectIds,
        projectIds,
        (name, baseProject, perturbedProject) => {
          const config = buildCm(name, baseProject);
          const sBase = resolveSession({}, sources(config));
          const sPerturbed = resolveSession(
            { project: perturbedProject },
            sources(config),
          );
          expect(sBase.account).toEqual(sPerturbed.account);
        },
      ),
    );
  });

  it("test_axis_independence_workspace_does_not_change_account_or_project", () => {
    fc.assert(
      fc.property(
        accountNames,
        projectIds,
        workspaceIds,
        (name, project, workspace) => {
          const config = buildCm(name, project);
          const sBase = resolveSession({}, sources(config));
          const sPerturbed = resolveSession({ workspace }, sources(config));
          expect(sBase.account).toEqual(sPerturbed.account);
          expect(sBase.project).toEqual(sPerturbed.project);
        },
      ),
    );
  });

  it("test_env_wins_for_project_axis", () => {
    fc.assert(
      fc.property(
        accountNames,
        projectIds,
        projectIds,
        (name, configProject, envProject) => {
          const config = buildCm(name, configProject);
          const s = resolveSession(
            {},
            sources(config, { MP_PROJECT_ID: envProject }),
          );
          expect(s.project.id).toBe(envProject);
        },
      ),
    );
  });

  it("test_env_wins_for_workspace_axis", () => {
    fc.assert(
      fc.property(
        accountNames,
        projectIds,
        workspaceIds,
        workspaceIds,
        (name, project, configWorkspace, envWorkspace) => {
          const config = buildCm(name, project);
          config.active = { ...config.active, workspace: configWorkspace };
          const s = resolveSession(
            {},
            sources(config, { MP_WORKSPACE_ID: String(envWorkspace) }),
          );
          expect(s.workspace).not.toBeNull();
          expect(s.workspace?.id).toBe(envWorkspace);
        },
      ),
    );
  });
});
