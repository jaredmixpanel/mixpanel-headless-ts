/**
 * B7-A2 R10.9 harness (1/2) — resolver precedence truth table,
 * EXHAUSTIVE, per `b7-packets.md` §2.6:
 *
 *   (i)   account axis 2^6 presence bitmap (env-SA-quad, env-OT-triple,
 *         explicit, target, bridge, [active].account) = 64 rows;
 *   (ii)  project axis 2^4 (env, explicit, target, bridge-project) ×
 *         3 account states (null / no-default / with-default) = 48 rows
 *         (superset of the packet's 32);
 *   (iii) workspace axis 2^5 (env, explicit, target, bridge-ws,
 *         [active].workspace) = 32 rows incl. the all-absent → null
 *         terminal;
 *   (iv)  every error row (invalid MP_REGION ± lower-rung winner,
 *         MP_PROJECT_ID non-digit + the Nd/No two-stage split,
 *         MP_WORKSPACE_ID non-int/"0"/negative/>2^53, empty-string env
 *         for every var, partial SA quad ×4, both env sets → SA,
 *         unknown account/target, target+axis guard, header-merge
 *         collision, no-account, no-project both shapes);
 *   (v)   mandatory edge set through every annotation-admitting param;
 *   (vi)  fast-check fuzz ≥500 randomized source bags vs the
 *         independent mini-model below.
 *
 * Winner oracle = the 10-line mini-model `firstPresent` (independent of
 * the library's chain code). Run: `npx vite-node throwaway/b7-a2/resolver-truth.ts`
 *
 * THROWAWAY: deleted at the B7 gate; the RUN record survives in
 * `context/phase3/notes/B7-A2-notes.md`.
 */

import fc from "fast-check";
import {
  envWorkspaceId,
  resolveAccountAxis,
  resolveProjectAxis,
  resolveSession,
  formatNoAccountError,
  formatNoProjectError,
  type BridgeView,
  type ResolverConfigSource,
  type ResolverEnv,
  type ResolverSources,
} from "../../packages/core/src/auth/resolver.js";
import {
  parseAccount,
  type Account,
} from "../../packages/core/src/auth/account.js";
import type { ActiveSession } from "../../packages/core/src/auth/session.js";
import { Target } from "../../packages/core/src/types/entities/accounts.js";
import {
  AccountNotFoundError,
  ConfigError,
  MixpanelHeadlessError,
  ParamValidationError,
} from "../../packages/core/src/errors.js";

let checks = 0;
let failures = 0;

/**
 * Record one expectation (JSON-compared).
 *
 * @param label - What is being checked.
 * @param actual - Observed value.
 * @param expected - Expected value.
 */
function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const a = JSON.stringify(actual) ?? "undefined";
  const b = JSON.stringify(expected) ?? "undefined";
  if (a !== b) {
    failures += 1;
    console.log(`FAIL ${label}\n  actual   ${a}\n  expected ${b}`);
  }
}

/**
 * Run a thunk, capture the thrown error's class + code.
 *
 * @param thunk - The call under test.
 * @returns `{cls, code}` or `{ok: value}`.
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

// ---- shared fixture material ------------------------------------------

/** Minimal in-memory config source. */
class HarnessConfig implements ResolverConfigSource {
  readonly accounts = new Map<string, Account>();
  readonly targets = new Map<string, Target>();
  active: ActiveSession = {};
  customHeader: readonly [string, string] | null = null;

  getAccount(name: string): Account {
    const account = this.accounts.get(name);
    if (account === undefined) {
      throw new AccountNotFoundError(name, [...this.accounts.keys()]);
    }
    return account;
  }
  getActive(): ActiveSession {
    return this.active;
  }
  getTarget(name: string): Target {
    const target = this.targets.get(name);
    if (target === undefined) {
      throw new ConfigError(`Unknown target: ${name}`);
    }
    return target;
  }
  getCustomHeader(): readonly [string, string] | null {
    return this.customHeader;
  }
}

/**
 * Build a service account.
 *
 * @param name - Account name.
 * @param defaultProject - Optional default project.
 * @returns The account.
 */
function sa(name: string, defaultProject?: string): Account {
  return parseAccount({
    type: "service_account",
    name,
    region: "us",
    username: "u",
    secret: "s",
    ...(defaultProject !== undefined
      ? { default_project: defaultProject }
      : {}),
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

// ---- (i) account axis: 2^6 exhaustive ----------------------------------

const SA_QUAD: ResolverEnv = {
  MP_USERNAME: "env.user",
  MP_SECRET: "env-secret",
  MP_PROJECT_ID: "999",
  MP_REGION: "us",
};
const OT_TRIPLE: ResolverEnv = {
  MP_OAUTH_TOKEN: "env-tok",
  MP_PROJECT_ID: "999",
  MP_REGION: "us",
};

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
  check(
    `account-axis mask=${mask}`,
    resolved === null ? null : resolved.name,
    winner,
  );
}

// ---- (ii) project axis: 2^4 × 3 account states --------------------------

const accountStates: ReadonlyArray<readonly [string, Account | null]> = [
  ["account-null", null],
  ["account-no-default", sa("plain")],
  ["account-with-default", sa("plain", "555555")],
];

for (const [stateName, account] of accountStates) {
  for (let mask = 0; mask < 16; mask++) {
    const envP = (mask & 1) !== 0;
    const explicitP = (mask & 2) !== 0;
    const targetP = (mask & 4) !== 0;
    const bridgeP = (mask & 8) !== 0;
    const bridgeView: BridgeView | null = bridgeP
      ? { account: sa("b"), project: "444444", workspace: null, headers: {} }
      : null;
    const winner = firstPresent<string>([
      [envP, "111111"],
      [explicitP, "222222"],
      [targetP, "333333"],
      [bridgeP, "444444"],
      [account !== null && account.default_project != null, "555555"],
    ]);
    const resolved = resolveProjectAxis({
      explicit: explicitP ? "222222" : null,
      target_project: targetP ? "333333" : null,
      bridge: bridgeView,
      account,
      env: envP ? { MP_PROJECT_ID: "111111" } : {},
    });
    check(`project-axis ${stateName} mask=${mask}`, resolved, winner);
  }
}

// ---- (iii) workspace axis: 2^5 exhaustive (via resolveSession) ----------

for (let mask = 0; mask < 32; mask++) {
  const envW = (mask & 1) !== 0;
  const explicitW = (mask & 2) !== 0;
  const targetW = (mask & 4) !== 0;
  const bridgeW = (mask & 8) !== 0;
  const activeW = (mask & 16) !== 0;
  // target= and explicit workspace= are mutually exclusive at the
  // resolve_session boundary; when both bits are up, drive the target
  // axis through the target and skip the explicit kwarg (the axis
  // function itself has no guard — the guard rows are in (iv)).
  const config = new HarnessConfig();
  config.accounts.set("team", sa("team", "1"));
  config.active = {
    account: "team",
    ...(activeW ? { workspace: 50 } : {}),
  };
  if (targetW) {
    config.targets.set(
      "t",
      new Target({ name: "t", account: "team", project: "1", workspace: 30 }),
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
  check(
    `workspace-axis mask=${mask} (explicit ${useExplicit ? "on" : "off"})`,
    session.workspace?.id ?? null,
    winner,
  );
}

// ---- (iv) error rows ----------------------------------------------------

{
  const config = new HarnessConfig();
  config.accounts.set("team", sa("team", "1"));
  config.active = { account: "team" };
  const src = (env: ResolverEnv): ResolverSources => ({
    env,
    config,
    bridge: null,
  });

  // invalid MP_REGION — with and without a lower-rung winner.
  check(
    "err MP_REGION invalid, lower-rung winner present",
    outcomeOf(() =>
      resolveSession({ account: "team" }, src({ MP_REGION: "mars" })),
    ),
    { cls: "ConfigError", code: "CONFIG_ERROR" },
  );
  check(
    "err MP_REGION invalid, nothing else",
    outcomeOf(() => resolveSession({}, src({ MP_REGION: "zz" }))),
    { cls: "ConfigError", code: "CONFIG_ERROR" },
  );

  // MP_PROJECT_ID non-digit.
  check(
    "err MP_PROJECT_ID non-digit",
    outcomeOf(() => resolveSession({}, src({ MP_PROJECT_ID: "12a" }))),
    { cls: "ConfigError", code: "CONFIG_ERROR" },
  );
  // Nd-digit MP_PROJECT_ID: RESOLVES in BOTH languages (verified live
  // vs CPython 2026-08-16 — supersedes the packet §2.2 example; see
  // RUN.md §disclosures).
  check(
    "Nd MP_PROJECT_ID '٤٢' resolves",
    resolveSession({}, src({ MP_PROJECT_ID: "٤٢" })).project.id,
    "٤٢",
  );
  // No/Digit codepoint '²': ConfigError in both languages; the failing
  // GUARD differs (disclosed divergence — message only, class+code
  // identical).
  check(
    "err MP_PROJECT_ID '²' → ConfigError (guard split disclosed)",
    outcomeOf(() => resolveSession({}, src({ MP_PROJECT_ID: "²" }))),
    { cls: "ConfigError", code: "CONFIG_ERROR" },
  );

  // MP_WORKSPACE_ID rows.
  for (const bad of ["abc", "0", "-1", "1.5", "9007199254740993"]) {
    check(
      `err MP_WORKSPACE_ID ${JSON.stringify(bad)}`,
      outcomeOf(() => resolveSession({}, src({ MP_WORKSPACE_ID: bad }))),
      { cls: "ConfigError", code: "CONFIG_ERROR" },
    );
  }
  // pythonInt grammar acceptances (R11.7).
  check(
    "MP_WORKSPACE_ID '1_0' → 10",
    envWorkspaceId({ MP_WORKSPACE_ID: "1_0" }),
    10,
  );
  check(
    "MP_WORKSPACE_ID ' +42 ' → 42",
    envWorkspaceId({ MP_WORKSPACE_ID: " +42 " }),
    42,
  );
  check(
    "MP_WORKSPACE_ID Nd '٤٢' → 42",
    envWorkspaceId({ MP_WORKSPACE_ID: "٤٢" }),
    42,
  );

  // Empty-string env for EVERY var → falls through, never errors.
  const allEmpty: ResolverEnv = {
    MP_USERNAME: "",
    MP_SECRET: "",
    MP_PROJECT_ID: "",
    MP_REGION: "",
    MP_OAUTH_TOKEN: "",
    MP_WORKSPACE_ID: "",
  };
  const emptyEnvSession = resolveSession({}, src(allEmpty));
  check(
    "empty-string env all-vars falls through",
    [emptyEnvSession.account.name, emptyEnvSession.project.id],
    ["team", "1"],
  );

  // Partial SA quad ×4 (each member missing) → silent fall-through to
  // [active].
  const quad: Record<string, string> = { ...SA_QUAD } as Record<string, string>;
  for (const missing of Object.keys(quad)) {
    const partial = { ...quad };
    delete partial[missing];
    const s = resolveSession({}, src(partial as ResolverEnv));
    check(
      `partial SA quad missing ${missing} falls through`,
      s.account.name,
      "team",
    );
  }

  // Both env sets complete → SA wins.
  check(
    "SA quad beats OT triple",
    resolveSession({}, src({ ...SA_QUAD, MP_OAUTH_TOKEN: "t" })).account.type,
    "service_account",
  );

  // Unknown account / target names.
  check(
    "unknown account name",
    outcomeOf(() => resolveSession({ account: "nope" }, src({}))),
    { cls: "AccountNotFoundError", code: "ACCOUNT_NOT_FOUND" },
  );
  check(
    "unknown target name",
    outcomeOf(() => resolveSession({ target: "nope" }, src({}))),
    { cls: "ConfigError", code: "CONFIG_ERROR" },
  );

  // target + axis kwarg guard (all three kwargs).
  config.targets.set(
    "t",
    new Target({ name: "t", account: "team", project: "1" }),
  );
  for (const extra of [
    { account: "team" },
    { project: "1" },
    { workspace: 1 },
  ]) {
    check(
      `target guard ${JSON.stringify(extra)}`,
      outcomeOf(() => resolveSession({ target: "t", ...extra }, src({}))),
      { cls: "ParamValidationError", code: "WS1_TARGET_MUTUALLY_EXCLUSIVE" },
    );
  }

  // Header merge collision — bridge wins.
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
  check(
    "header merge bridge wins",
    [merged.headers.get("X-H"), merged.headers.get("X-B")],
    ["bridge", "only"],
  );
  config.customHeader = null;

  // No-account error (message shape locked by substring).
  const emptyConfig = new HarnessConfig();
  const noAccount = outcomeOf(() =>
    resolveSession({}, { env: {}, config: emptyConfig, bridge: null }),
  );
  check("no-account error", noAccount, {
    cls: "ConfigError",
    code: "CONFIG_ERROR",
  });
  check(
    "no-account message lists env + account-add + target paths",
    [
      formatNoAccountError().includes("MP_USERNAME"),
      formatNoAccountError().includes("mp account add"),
      formatNoAccountError().includes("--target NAME"),
    ],
    [true, true, true],
  );

  // No-project error — two message shapes (:333-359).
  check(
    "no-project message WITH account names it",
    formatNoProjectError(sa("teamx")).includes("'teamx'"),
    true,
  );
  check(
    "no-project message WITHOUT account is the generic shape",
    formatNoProjectError(null).startsWith("No project configured.\n"),
    true,
  );

  // Invalid explicit workspace / project constructor paths.
  check(
    "explicit workspace 0",
    outcomeOf(() => resolveSession({ workspace: 0 }, src({}))),
    { cls: "ConfigError", code: "CONFIG_ERROR" },
  );
  check(
    "explicit workspace -5",
    outcomeOf(() => resolveSession({ workspace: -5 }, src({}))),
    { cls: "ConfigError", code: "CONFIG_ERROR" },
  );
  check(
    "explicit project non-digit",
    outcomeOf(() => resolveSession({ project: "abc" }, src({}))),
    { cls: "ConfigError", code: "CONFIG_ERROR" },
  );
  check(
    "explicit project empty string",
    outcomeOf(() => resolveSession({ project: "" }, src({}))),
    { cls: "ConfigError", code: "CONFIG_ERROR" },
  );
}

// ---- (v) mandatory edge set ---------------------------------------------

{
  const config = new HarnessConfig();
  config.accounts.set("team", sa("team", "1"));
  config.active = { account: "team" };
  const src: ResolverSources = { env: {}, config, bridge: null };
  // String-typed params (account/project/target) take "" and "𝒳"; both
  // are out-of-config values → coded errors, never crashes.
  for (const value of ["", "𝒳"]) {
    check(
      `edge account=${JSON.stringify(value)}`,
      outcomeOf(() => resolveSession({ account: value }, src)),
      { cls: "AccountNotFoundError", code: "ACCOUNT_NOT_FOUND" },
    );
    check(
      `edge target=${JSON.stringify(value)}`,
      outcomeOf(() => resolveSession({ target: value }, src)),
      { cls: "ConfigError", code: "CONFIG_ERROR" },
    );
    check(
      `edge project=${JSON.stringify(value)}`,
      outcomeOf(() => resolveSession({ project: value }, src)),
      { cls: "ConfigError", code: "CONFIG_ERROR" },
    );
  }
  // Number-typed param (workspace): integral float 18.0 === 18 in JS
  // (in-annotation); fractional 1.5 violates the int annotation →
  // ConfigError via the WorkspaceRef constructor path.
  check(
    "edge workspace=18.0",
    resolveSession({ workspace: 18.0 }, src).workspace?.id ?? null,
    18,
  );
  check(
    "edge workspace=1.5",
    outcomeOf(() => resolveSession({ workspace: 1.5 }, src)),
    { cls: "ConfigError", code: "CONFIG_ERROR" },
  );
  // Env values: edge strings through every env var (annotation: str).
  check(
    "edge MP_WORKSPACE_ID '𝒳'",
    outcomeOf(() =>
      resolveSession({}, { ...src, env: { MP_WORKSPACE_ID: "𝒳" } }),
    ),
    { cls: "ConfigError", code: "CONFIG_ERROR" },
  );
  check(
    "edge MP_REGION '𝒳'",
    outcomeOf(() => resolveSession({}, { ...src, env: { MP_REGION: "𝒳" } })),
    { cls: "ConfigError", code: "CONFIG_ERROR" },
  );
  check(
    "edge MP_PROJECT_ID '18.0' (non-digit → error)",
    outcomeOf(() =>
      resolveSession({}, { ...src, env: { MP_PROJECT_ID: "18.0" } }),
    ),
    { cls: "ConfigError", code: "CONFIG_ERROR" },
  );
}

// ---- (vi) fast-check fuzz vs the mini-model -------------------------------

const FUZZ_SEED = 20260816;
const FUZZ_RUNS = 600;

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

const digitsArb = fc
  .tuple(
    fc.integer({ min: 1, max: 9 }),
    fc.array(fc.integer({ min: 0, max: 9 }), { maxLength: 8 }),
  )
  .map(([h, t]) => `${String(h)}${t.join("")}`);

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

let fuzzDivergences = 0;
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
      ...(c.envWorkspace ? { MP_WORKSPACE_ID: String(c.workspaceValue) } : {}),
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
      if (error instanceof ParamValidationError) {
        actual = { error: error.code };
      } else if (error instanceof ConfigError) {
        actual = { error: error.code };
      } else {
        actual = { error: String(error) };
      }
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fuzzDivergences += 1;
      console.log(
        `FUZZ DIVERGENCE case=${JSON.stringify(c)}\n  actual   ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`,
      );
      return false;
    }
    return true;
  }),
  { seed: FUZZ_SEED, numRuns: FUZZ_RUNS },
);
checks += FUZZ_RUNS;

console.log(
  `resolver-truth: checks ${checks} (incl. ${FUZZ_RUNS} fuzz runs, seed ${FUZZ_SEED})  failures ${failures}  fuzz-divergences ${fuzzDivergences}`,
);
if (failures > 0 || fuzzDivergences > 0) {
  process.exitCode = 1;
}
