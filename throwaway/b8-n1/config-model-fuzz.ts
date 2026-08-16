// B8-N1 R10.9 harness — §2.5 row 4 fast-check op-sequence fuzz.
// Run: npx vite-node throwaway/b8-n1/config-model-fuzz.ts
//
// Mini-model: the B7 in-memory `fakeConfig()` (an INDEPENDENT
// implementation of the same Python semantics, written at B7 before
// this shard existed) driven through the same adapter-level op
// sequence as the REAL on-disk `createNodeConfigSource`. After every
// op both sides must agree on: thrown-error class (or both succeed),
// listAccounts (name/type/region/is_active/referenced_by_targets),
// account default_projects, listTargets, getActive. REAL-side-only
// invariants per op: (a) a THROWING op leaves the config file
// byte-identical (transaction atomicity); (b) `[active].account`
// always references an existing account or is absent; (c) list
// outputs are sorted by name.
//
// Model-scope note (recorded): `setActive({workspace})` positivity and
// custom-header ops are outside the fake's surface — invalid-workspace
// rows and header round-trips are covered by the deterministic probes
// (io-config-probes.ts rows 4/5); the fuzz draws positive workspaces
// only and skips header ops.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import fc from "fast-check";

import { fakeConfig } from "../../packages/core/test/accounts/fake-auth-effects.js";
import { Secret } from "../../packages/core/src/secret.js";
import { createNodeConfigSource } from "../../packages/node/src/config-writes.js";
import type {
  AddAccountParams,
  SetActiveUpdate,
} from "../../packages/core/src/accounts/auth-effects.js";

const SEED = 20260816;
const RUNS = 500;

const ROOT = mkdtempSync(join(tmpdir(), "mp-b8n1-fuzz-"));
const home = resolve(homedir());
if (ROOT === home || ROOT.startsWith(home + sep)) {
  throw new Error(`real-home guard tripped: ${ROOT}`);
}
let caseSeq = 0;

const NAMES = ["a", "b", "c-1", "true", "𝒳bad name"] as const;
const TARGETS = ["t1", "t2", "𝒳t"] as const;
const PROJECTS = ["1", "3018488", "1.5", ""] as const;
const REGIONS = ["us", "eu", "in"] as const;

type Op =
  | { readonly kind: "addSA"; readonly name: string; readonly project: string }
  | { readonly kind: "addBrowser"; readonly name: string }
  | {
      readonly kind: "addToken";
      readonly name: string;
      readonly inline: boolean;
    }
  | {
      readonly kind: "updateProject";
      readonly name: string;
      readonly project: string;
    }
  | {
      readonly kind: "removeAccount";
      readonly name: string;
      readonly force: boolean;
    }
  | { readonly kind: "setActive"; readonly update: SetActiveUpdate }
  | {
      readonly kind: "addTarget";
      readonly target: string;
      readonly account: string;
      readonly project: string;
      readonly workspace: number | null;
    }
  | { readonly kind: "removeTarget"; readonly target: string }
  | { readonly kind: "applyTarget"; readonly target: string }
  | {
      readonly kind: "applySession";
      readonly account: string | null;
      readonly project: string | null;
      readonly workspace: number | null;
      readonly clearWorkspace: boolean;
    };

const nameArb = fc.constantFrom(...NAMES);
const targetArb = fc.constantFrom(...TARGETS);
const projectArb = fc.constantFrom(...PROJECTS);
const wsArb = fc.constantFrom(1, 8, 42, 2 ** 53);

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    kind: fc.constant("addSA" as const),
    name: nameArb,
    project: projectArb,
  }),
  fc.record({ kind: fc.constant("addBrowser" as const), name: nameArb }),
  fc.record({
    kind: fc.constant("addToken" as const),
    name: nameArb,
    inline: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("updateProject" as const),
    name: nameArb,
    project: projectArb,
  }),
  fc.record({
    kind: fc.constant("removeAccount" as const),
    name: nameArb,
    force: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("setActive" as const),
    update: fc.oneof(
      fc.record({ account: nameArb }),
      fc.record({ workspace: fc.oneof(wsArb, fc.constant(null)) }),
      fc.record({ account: nameArb, workspace: wsArb }),
    ) as fc.Arbitrary<SetActiveUpdate>,
  }),
  fc.record({
    kind: fc.constant("addTarget" as const),
    target: targetArb,
    account: nameArb,
    project: projectArb,
    workspace: fc.oneof(wsArb, fc.constant(null)),
  }),
  fc.record({ kind: fc.constant("removeTarget" as const), target: targetArb }),
  fc.record({ kind: fc.constant("applyTarget" as const), target: targetArb }),
  fc.record({
    kind: fc.constant("applySession" as const),
    account: fc.oneof(nameArb, fc.constant(null)),
    project: fc.oneof(projectArb, fc.constant(null)),
    workspace: fc.oneof(wsArb, fc.constant(null)),
    clearWorkspace: fc.boolean(),
  }),
);

/** Apply one op to a surface; return the thrown error name or null. */
function applyOp(
  surface:
    ReturnType<typeof createNodeConfigSource> | ReturnType<typeof fakeConfig>,
  op: Op,
): string | null {
  try {
    switch (op.kind) {
      case "addSA":
        surface.addAccount(op.name, {
          type: "service_account",
          region: REGIONS[op.name.length % 3] as "us",
          default_project: op.project,
          username: "u",
          secret: new Secret("s"),
        } satisfies AddAccountParams);
        return null;
      case "addBrowser":
        surface.addAccount(op.name, { type: "oauth_browser", region: "us" });
        return null;
      case "addToken":
        surface.addAccount(op.name, {
          type: "oauth_token",
          region: "eu",
          ...(op.inline
            ? { token: new Secret("tok") }
            : { token_env: "MP_OAUTH_TOKEN" }),
        });
        return null;
      case "updateProject":
        surface.updateAccount(op.name, { default_project: op.project });
        return null;
      case "removeAccount":
        surface.removeAccount(op.name, { force: op.force });
        return null;
      case "setActive":
        surface.setActive(op.update);
        return null;
      case "addTarget":
        surface.addTarget(op.target, {
          account: op.account,
          project: op.project,
          workspace: op.workspace,
        });
        return null;
      case "removeTarget":
        surface.removeTarget(op.target);
        return null;
      case "applyTarget":
        surface.applyTarget(op.target);
        return null;
      case "applySession":
        surface.applySession({
          ...(op.account !== null ? { account: op.account } : {}),
          ...(op.project !== null ? { project: op.project } : {}),
          ...(op.workspace !== null ? { workspace: op.workspace } : {}),
          clear_workspace: op.clearWorkspace,
        });
        return null;
    }
  } catch (exc) {
    return (exc as Error).constructor.name;
  }
}

/** Observable snapshot both surfaces must agree on. */
function snapshot(
  surface:
    ReturnType<typeof createNodeConfigSource> | ReturnType<typeof fakeConfig>,
): string {
  const accounts = surface.listAccounts().map((a) => ({
    name: a.name,
    type: a.type,
    region: a.region,
    is_active: a.is_active,
    refs: [...a.referenced_by_targets],
    project: ((): string | null => {
      const acct = surface.getAccount(a.name);
      return acct.default_project ?? null;
    })(),
  }));
  const targets = surface.listTargets().map((t) => ({
    name: t.name,
    account: t.account,
    project: t.project,
    workspace: t.workspace,
  }));
  const active = surface.getActive();
  return JSON.stringify({
    accounts,
    targets,
    active: {
      account: active.account ?? null,
      workspace: active.workspace ?? null,
    },
  });
}

let divergences = 0;
let opsRun = 0;
let errorsAgreed = 0;

fc.assert(
  fc.property(fc.array(opArb, { minLength: 1, maxLength: 12 }), (ops) => {
    caseSeq += 1;
    const dir = join(ROOT, `f${caseSeq}`);
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, "config.toml");
    const real = createNodeConfigSource({ configPath });
    const model = fakeConfig();
    for (const op of ops) {
      opsRun += 1;
      const before = existsSync(configPath) ? readFileSync(configPath) : null;
      const realErr = applyOp(real, op);
      // Model rollback shim (RECORDED HARNESS FINDING, B8-N1 notes):
      // Python's `_mutate()` makes every failing op all-or-nothing; the
      // real on-disk port inherits that transactionality. The B7
      // in-memory fake mutates state member-by-member, so a failing
      // `applySession` (e.g. workspace set, then `project` with no
      // account) leaves a PARTIAL mutation behind — a fake-only
      // divergence from Python never reached by the B7 suites. The
      // driver snapshots the fake's state before each op and restores
      // it when the op throws, making the mini-model match Python's
      // transaction semantics.
      const savedAccounts = new Map(model.state.accounts);
      const savedActive = { ...model.state.active };
      const savedTargets = new Map(
        [...model.state.targets].map(([k, v]) => [k, { ...v }]),
      );
      let modelErr = applyOp(model, op);
      // Model normalization #2 (RECORDED HARNESS FINDING): the fake's
      // `applySession` project branch calls `parseAccount(raw)`
      // UNWRAPPED, so an invalid project surfaces as
      // ResponseValidationError; Python wraps every ValidationError in
      // ConfigError (`config.py:395-401`) and the real port matches
      // Python. Fake-only divergence, never reached by the B7 suites.
      if (
        op.kind === "applySession" &&
        modelErr === "ResponseValidationError"
      ) {
        modelErr = "ConfigError";
      }
      if (modelErr !== null) {
        model.state.accounts.clear();
        for (const [k, v] of savedAccounts) {
          model.state.accounts.set(k, v);
        }
        delete model.state.active.account;
        delete model.state.active.workspace;
        Object.assign(model.state.active, savedActive);
        model.state.targets.clear();
        for (const [k, v] of savedTargets) {
          model.state.targets.set(k, v);
        }
      }
      if (realErr !== modelErr) {
        divergences += 1;
        throw new Error(
          `error-class divergence on ${JSON.stringify(op)}: real=${String(
            realErr,
          )} model=${String(modelErr)}`,
        );
      }
      if (realErr !== null) {
        errorsAgreed += 1;
        // Transaction atomicity: failing op leaves the file untouched.
        const after = existsSync(configPath) ? readFileSync(configPath) : null;
        const same =
          (before === null && after === null) ||
          (before !== null && after !== null && before.equals(after));
        if (!same) {
          divergences += 1;
          throw new Error(
            `atomicity violation on ${JSON.stringify(op)}: file changed after throw`,
          );
        }
      }
      const realSnap = snapshot(real);
      if (realSnap !== snapshot(model)) {
        divergences += 1;
        throw new Error(
          `state divergence after ${JSON.stringify(op)}:\nreal=${realSnap}\nmodel=${snapshot(model)}`,
        );
      }
      // Real-side invariants.
      const active = real.getActive();
      if (active.account !== null && active.account !== undefined) {
        real.getAccount(active.account); // throws if dangling
      }
      const accountNames = real.listAccounts().map((a) => a.name);
      const targetNames = real.listTargets().map((t) => t.name);
      if (
        JSON.stringify(accountNames) !==
          JSON.stringify([...accountNames].sort()) ||
        JSON.stringify(targetNames) !== JSON.stringify([...targetNames].sort())
      ) {
        divergences += 1;
        throw new Error("sorted-list invariant violated");
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }),
  { seed: SEED, numRuns: RUNS },
);

rmSync(ROOT, { recursive: true, force: true });
console.log(
  `config-model-fuzz: runs ${RUNS} (>=500 budget) ops ${opsRun} ` +
    `error-agreements ${errorsAgreed} divergences ${divergences} seed ${SEED}`,
);
