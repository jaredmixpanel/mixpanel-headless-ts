// Full env > param > target > bridge > config precedence lock for the
// resolver: exhaustive per-axis presence bitmaps plus a 15-dimension
// randomized full-chain fuzz, each judged by the independent `firstPresent`
// mini-model, never the library's own chain code. TS addition — the Python
// `test_resolver_pbt.py` properties live in `resolver.pbt.test.ts`.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { type Account, parseAccount } from "../../src/auth/account.js";
import {
  type BridgeView,
  envWorkspaceId,
  resolveAccountAxis,
  resolveProjectAxis,
  type ResolverConfigSource,
  type ResolverEnv,
  type ResolverSources,
  resolveSession,
} from "../../src/auth/resolver.js";
import type { ActiveSession } from "../../src/auth/session.js";
import {
  AccountNotFoundError,
  ConfigError,
  MixpanelHeadlessError,
  ParamValidationError,
} from "../../src/errors.js";
import { Target } from "../../src/types/entities/accounts.js";

/**
 * Run a thunk, capture the thrown error's class + code.
 *
 * @param thunk - The call under test.
 * @returns `{cls, code}` on a coded throw, `{cls}` on a plain throw,
 *   or `{ok: true}` when the call returns.
 */
function outcomeOf(thunk: () => unknown): Record<string, unknown> {
  try {
    return { ok: thunk() !== undefined };
  } catch (error) {
    if (error instanceof MixpanelHeadlessError) {
      return { cls: error.constructor.name, code: error.code };
    }
    return { cls: (error as Error).constructor.name };
  }
}

/** Minimal in-memory config source (the tmp-dir ConfigManager twin). */
class HarnessConfig implements ResolverConfigSource {
  /** Account records keyed by name. */
  readonly accounts = new Map<string, Account>();
  /** Target records keyed by name. */
  readonly targets = new Map<string, Target>();
  /** The `[active]` block. */
  active: ActiveSession = {};
  /** The `[settings].custom_header` entry. */
  customHeader: readonly [string, string] | null = null;

  /**
   * Look up an account by name.
   *
   * @param name - Account name.
   * @returns The account.
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
   * @returns The active session block.
   */
  getActive(): ActiveSession {
    return this.active;
  }

  /**
   * Look up a target by name.
   *
   * @param name - Target name.
   * @returns The target.
   * @throws ConfigError - Unknown name.
   */
  getTarget(name: string): Target {
    const target = this.targets.get(name);
    if (target === undefined) {
      throw new ConfigError(`Unknown target: ${name}`);
    }
    return target;
  }

  /**
   * Read the custom header entry.
   *
   * @returns The `[name, value]` pair, or `null`.
   */
  getCustomHeader(): readonly [string, string] | null {
    return this.customHeader;
  }
}

/**
 * Build a service account.
 *
 * @param name - Account name.
 * @param defaultProject - Optional default project.
 * @returns The parsed account.
 */
function sa(name: string, defaultProject?: string): Account {
  return parseAccount({
    type: "service_account",
    name,
    region: "us",
    username: "u",
    secret: "s",
    ...(defaultProject === undefined
      ? {}
      : { default_project: defaultProject }),
  });
}

/**
 * THE mini-model: winner = highest-priority present source.
 *
 * @param entries - `[present, value]` pairs in priority order.
 * @returns The first present value, or null.
 */
function firstPresent<T>(
  entries: ReadonlyArray<readonly [boolean, T]>,
): T | null {
  for (const [present, value] of entries) {
    if (present) {
      return value;
    }
  }
  return null;
}

/** The complete SA env quad. */
const SA_QUAD: ResolverEnv = {
  MP_USERNAME: "env.user",
  MP_SECRET: "env-secret",
  MP_PROJECT_ID: "999",
  MP_REGION: "us",
};
/** The complete OAuth-token env triple. */
const OT_TRIPLE: ResolverEnv = {
  MP_OAUTH_TOKEN: "env-tok",
  MP_PROJECT_ID: "999",
  MP_REGION: "us",
};

describe("account axis — 2^6 exhaustive presence bitmap vs firstPresent", () => {
  it("the winner is the highest-priority present source, all 64 masks", () => {
    for (let mask = 0; mask < 64; mask++) {
      const envSA = (mask & 1) !== 0;
      const envOT = (mask & 2) !== 0;
      const explicit = (mask & 4) !== 0;
      const target = (mask & 8) !== 0;
      const bridge = (mask & 16) !== 0;
      const active = (mask & 32) !== 0;

      const config = new HarnessConfig();
      config.accounts.set("acc-explicit", sa("acc-explicit"));
      config.accounts.set("acc-target", sa("acc-target"));
      config.accounts.set("acc-active", sa("acc-active"));
      if (active) {
        config.active = { account: "acc-active" };
      }
      const bridgeView: BridgeView | null = bridge
        ? {
            account: sa("bridge-account"),
            project: null,
            workspace: null,
            headers: {},
          }
        : null;
      const env: ResolverEnv = {
        ...(envSA ? SA_QUAD : {}),
        ...(envOT ? OT_TRIPLE : {}),
      };

      const winner = firstPresent<string>([
        [envSA, "env-service-account"],
        [envOT, "env-oauth-token"],
        [explicit, "acc-explicit"],
        [target, "acc-target"],
        [bridge, "bridge-account"],
        [active, "acc-active"],
      ]);

      const resolved = resolveAccountAxis({
        explicit: explicit ? "acc-explicit" : null,
        target_account_name: target ? "acc-target" : null,
        bridge: bridgeView,
        config,
        env,
      });
      expect(
        resolved === null ? null : resolved.name,
        `account-axis mask=${String(mask)}`,
      ).toStrictEqual(winner);
    }
  });
});

describe("project axis — 2^4 bitmap × 3 account states vs firstPresent", () => {
  const accountStates: ReadonlyArray<readonly [string, Account | null]> = [
    ["account-null", null],
    ["account-no-default", sa("plain")],
    ["account-with-default", sa("plain", "555555")],
  ];

  it.each(accountStates.map(([label, account]) => ({ label, account })))(
    "the winner is the highest-priority present source ($label)",
    ({ account }) => {
      for (let mask = 0; mask < 16; mask++) {
        const envP = (mask & 1) !== 0;
        const explicitP = (mask & 2) !== 0;
        const targetP = (mask & 4) !== 0;
        const bridgeP = (mask & 8) !== 0;
        const bridgeView: BridgeView | null = bridgeP
          ? {
              account: sa("b"),
              project: "444444",
              workspace: null,
              headers: {},
            }
          : null;
        const winner = firstPresent<string>([
          [envP, "111111"],
          [explicitP, "222222"],
          [targetP, "333333"],
          [bridgeP, "444444"],
          [account?.default_project != null, "555555"],
        ]);
        const resolved = resolveProjectAxis({
          explicit: explicitP ? "222222" : null,
          target_project: targetP ? "333333" : null,
          bridge: bridgeView,
          account,
          env: envP ? { MP_PROJECT_ID: "111111" } : {},
        });
        expect(resolved, `project-axis mask=${String(mask)}`).toStrictEqual(
          winner,
        );
      }
    },
  );
});

describe("workspace axis — 2^5 exhaustive via the full resolveSession", () => {
  it("the winner is the highest-priority present source, all 32 masks", () => {
    for (let mask = 0; mask < 32; mask++) {
      const envW = (mask & 1) !== 0;
      const explicitW = (mask & 2) !== 0;
      const targetW = (mask & 4) !== 0;
      const bridgeW = (mask & 8) !== 0;
      const activeW = (mask & 16) !== 0;
      // target= and explicit workspace= are mutually exclusive at the
      // resolve_session boundary; when both bits are up, drive the
      // target axis through the target and skip the explicit kwarg
      // (the guard rows live in the deterministic error-row suite,
      // `resolver.test.ts`).
      const config = new HarnessConfig();
      config.accounts.set("team", sa("team", "1"));
      config.active = {
        account: "team",
        ...(activeW ? { workspace: 50 } : {}),
      };
      if (targetW) {
        config.targets.set(
          "t",
          new Target({
            name: "t",
            account: "team",
            project: "1",
            workspace: 30,
          }),
        );
      }
      const bridgeView: BridgeView | null = bridgeW
        ? { account: sa("team", "1"), project: "1", workspace: 40, headers: {} }
        : null;
      const useExplicit = explicitW && !targetW;
      const winner = firstPresent<number>([
        [envW, 10],
        [useExplicit, 20],
        [targetW, 30],
        [bridgeW, 40],
        [activeW, 50],
      ]);
      const session = resolveSession(
        {
          ...(useExplicit ? { workspace: 20 } : {}),
          ...(targetW ? { target: "t" } : {}),
        },
        {
          env: envW ? { MP_WORKSPACE_ID: "10" } : {},
          config,
          bridge: bridgeView,
        },
      );
      expect(
        session.workspace?.id ?? null,
        `workspace-axis mask=${String(mask)}`,
      ).toStrictEqual(winner);
    }
  });
});

describe("cross-axis rule locks the exhaustive tables lean on", () => {
  /**
   * Build sources over a one-account config.
   *
   * @param env - The env bag.
   * @param config - The config fake.
   * @returns The resolver sources.
   */
  function src(env: ResolverEnv, config: HarnessConfig): ResolverSources {
    return { env, config, bridge: null };
  }

  /**
   * Build the standard one-account config (`team`, default project 1).
   *
   * @returns The config fake.
   */
  function teamConfig(): HarnessConfig {
    const config = new HarnessConfig();
    config.accounts.set("team", sa("team", "1"));
    config.active = { account: "team" };
    return config;
  }

  it("invalid MP_REGION aborts even with a lower-rung winner", () => {
    const config = teamConfig();
    expect(
      outcomeOf(() =>
        resolveSession({ account: "team" }, src({ MP_REGION: "mars" }, config)),
      ),
    ).toStrictEqual({ cls: "ConfigError", code: "CONFIG_ERROR" });
  });

  it("empty-string env for EVERY var falls through, never errors", () => {
    const config = teamConfig();
    const allEmpty: ResolverEnv = {
      MP_USERNAME: "",
      MP_SECRET: "",
      MP_PROJECT_ID: "",
      MP_REGION: "",
      MP_OAUTH_TOKEN: "",
      MP_WORKSPACE_ID: "",
    };
    const session = resolveSession({}, src(allEmpty, config));
    expect([session.account.name, session.project.id]).toStrictEqual([
      "team",
      "1",
    ]);
  });

  it("a partial SA quad falls through silently, each member missing", () => {
    const config = teamConfig();
    const quad = { ...SA_QUAD } as Record<string, string>;
    for (const missing of Object.keys(quad)) {
      const partial = Object.fromEntries(
        Object.entries(quad).filter(([key]) => key !== missing),
      );
      const session = resolveSession({}, src(partial, config));
      expect(session.account.name, `missing ${missing}`).toBe("team");
    }
  });

  it("a complete SA quad beats a complete OT triple", () => {
    const config = teamConfig();
    expect(
      resolveSession({}, src({ ...SA_QUAD, MP_OAUTH_TOKEN: "t" }, config))
        .account.type,
    ).toBe("service_account");
  });

  it("pythonInt grammar acceptances reach the workspace axis", () => {
    expect(envWorkspaceId({ MP_WORKSPACE_ID: "1_0" })).toBe(10);
    expect(envWorkspaceId({ MP_WORKSPACE_ID: " +42 " })).toBe(42);
    expect(envWorkspaceId({ MP_WORKSPACE_ID: "٤٢" })).toBe(42);
  });

  it("header merge: settings entry first, bridge wins on collision", () => {
    const config = teamConfig();
    config.customHeader = ["X-H", "settings"];
    const merged = resolveSession(
      {},
      {
        env: {},
        config,
        bridge: {
          account: sa("bridge-account"),
          project: "1",
          workspace: null,
          headers: { "X-H": "bridge", "X-B": "only" },
        },
      },
    );
    expect([
      merged.headers.get("X-H"),
      merged.headers.get("X-B"),
    ]).toStrictEqual(["bridge", "only"]);
  });
});

// ---- the 15-dimension full-chain fuzz vs the mini-model -----------------

/** One randomized source-bag configuration. */
interface FuzzCase {
  readonly envSA: boolean;
  readonly envOT: boolean;
  readonly envProject: boolean;
  readonly envWorkspace: boolean;
  readonly explicitAccount: boolean;
  readonly explicitProject: boolean;
  readonly explicitWorkspace: boolean;
  readonly useTarget: boolean;
  readonly targetHasWorkspace: boolean;
  readonly bridgePresent: boolean;
  readonly bridgeHasProject: boolean;
  readonly bridgeHasWorkspace: boolean;
  readonly activeAccount: boolean;
  readonly activeWorkspace: boolean;
  readonly accountsHaveDefault: boolean;
  readonly envProjectValue: string;
  readonly explicitProjectValue: string;
  readonly workspaceValue: number;
}

/** Digit-string arbitrary matching the Python PBT domain `^[1-9][0-9]{0,8}$`. */
const digitsArb = fc
  .tuple(
    fc.integer({ min: 1, max: 9 }),
    fc.array(fc.integer({ min: 0, max: 9 }), { maxLength: 8 }),
  )
  .map(([h, t]) => `${String(h)}${t.join("")}`);

/** The 15-boolean-dimension source bag plus value dimensions. */
const fuzzArb: fc.Arbitrary<FuzzCase> = fc.record({
  envSA: fc.boolean(),
  envOT: fc.boolean(),
  envProject: fc.boolean(),
  envWorkspace: fc.boolean(),
  explicitAccount: fc.boolean(),
  explicitProject: fc.boolean(),
  explicitWorkspace: fc.boolean(),
  useTarget: fc.boolean(),
  targetHasWorkspace: fc.boolean(),
  bridgePresent: fc.boolean(),
  bridgeHasProject: fc.boolean(),
  bridgeHasWorkspace: fc.boolean(),
  activeAccount: fc.boolean(),
  activeWorkspace: fc.boolean(),
  accountsHaveDefault: fc.boolean(),
  envProjectValue: digitsArb,
  explicitProjectValue: digitsArb,
  workspaceValue: fc.integer({ min: 1, max: 2 ** 31 - 1 }),
});

/**
 * Independent mini-model of the FULL resolveSession over a fuzz case.
 *
 * @param c - The fuzz case.
 * @returns Expected `{account, project, workspace}` or `{error}`.
 */
function miniModel(c: FuzzCase): Record<string, unknown> {
  if (
    c.useTarget &&
    (c.explicitAccount || c.explicitProject || c.explicitWorkspace)
  ) {
    return { error: "WS1_TARGET_MUTUALLY_EXCLUSIVE" };
  }
  const accountName = firstPresent<string>([
    [c.envSA, "env-service-account"],
    [c.envOT, "env-oauth-token"],
    [c.explicitAccount, "acc-explicit"],
    [c.useTarget, "acc-target"],
    [c.bridgePresent, "bridge-account"],
    [c.activeAccount, "acc-active"],
  ]);
  if (accountName === null) {
    return { error: "CONFIG_ERROR" };
  }
  const envSynth = accountName.startsWith("env-");
  const winnerHasDefault =
    !envSynth && accountName !== "bridge-account" && c.accountsHaveDefault;
  const project = firstPresent<string>([
    [c.envSA || c.envOT || c.envProject, c.envProjectValue],
    [c.explicitProject, c.explicitProjectValue],
    [c.useTarget, "333333"],
    [c.bridgePresent && c.bridgeHasProject, "444444"],
    [winnerHasDefault, "555555"],
  ]);
  if (project === null) {
    return { error: "CONFIG_ERROR" };
  }
  const workspace = firstPresent<number>([
    [c.envWorkspace, c.workspaceValue],
    [c.explicitWorkspace, 20],
    [c.useTarget && c.targetHasWorkspace, 30],
    [c.bridgePresent && c.bridgeHasWorkspace, 40],
    [c.activeWorkspace, 50],
  ]);
  return { account: accountName, project, workspace };
}

describe("full-chain fuzz — resolveSession vs the mini-model", () => {
  it("agrees with firstPresent across randomized source bags (seed 20260816)", () => {
    fc.assert(
      fc.property(fuzzArb, (c) => {
        const config = new HarnessConfig();
        config.accounts.set(
          "acc-explicit",
          sa("acc-explicit", c.accountsHaveDefault ? "555555" : undefined),
        );
        config.accounts.set(
          "acc-target",
          sa("acc-target", c.accountsHaveDefault ? "555555" : undefined),
        );
        config.accounts.set(
          "acc-active",
          sa("acc-active", c.accountsHaveDefault ? "555555" : undefined),
        );
        config.targets.set(
          "t",
          new Target({
            name: "t",
            account: "acc-target",
            project: "333333",
            ...(c.targetHasWorkspace ? { workspace: 30 } : {}),
          }),
        );
        config.active = {
          ...(c.activeAccount ? { account: "acc-active" } : {}),
          ...(c.activeWorkspace ? { workspace: 50 } : {}),
        };
        const env: ResolverEnv = {
          ...(c.envSA
            ? {
                MP_USERNAME: "env.user",
                MP_SECRET: "env-secret",
                MP_REGION: "us",
              }
            : {}),
          ...(c.envOT ? { MP_OAUTH_TOKEN: "tok", MP_REGION: "us" } : {}),
          ...(c.envSA || c.envOT || c.envProject
            ? { MP_PROJECT_ID: c.envProjectValue }
            : {}),
          ...(c.envWorkspace
            ? { MP_WORKSPACE_ID: String(c.workspaceValue) }
            : {}),
        };
        const sources: ResolverSources = {
          env,
          config,
          bridge: c.bridgePresent
            ? {
                account: sa("bridge-account"),
                project: c.bridgeHasProject ? "444444" : null,
                workspace: c.bridgeHasWorkspace ? 40 : null,
                headers: {},
              }
            : null,
        };
        const expected = miniModel(c);
        let actual: Record<string, unknown>;
        try {
          const s = resolveSession(
            {
              ...(c.explicitAccount ? { account: "acc-explicit" } : {}),
              ...(c.explicitProject ? { project: c.explicitProjectValue } : {}),
              ...(c.explicitWorkspace ? { workspace: 20 } : {}),
              ...(c.useTarget ? { target: "t" } : {}),
            },
            sources,
          );
          actual = {
            account: s.account.name,
            project: s.project.id,
            workspace: s.workspace?.id ?? null,
          };
        } catch (error) {
          if (
            error instanceof ParamValidationError ||
            error instanceof ConfigError
          ) {
            actual = { error: error.code };
          } else {
            actual = { error: String(error) };
          }
        }
        expect(actual).toStrictEqual(expected);
      }),
      { seed: 20260816, numRuns: 600 },
    );
  });
});
