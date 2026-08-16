/**
 * B7-A1 R10.9 harness (2/2) — fast-check fuzz over namespace op
 * sequences against an INDEPENDENT in-memory model of config state,
 * per `b7-packets.md` §3.6 item 5 (≥500 examples; invariants:
 * active-account consistency, workspace-clear-on-account-switch,
 * target atomicity).
 *
 * Run: `npx vite-node throwaway/b7-a1/ops-fuzz.ts`
 * Seed: 20260818 (recorded in the RUN record + shard notes).
 *
 * THROWAWAY: deleted at the B7 gate.
 */

import fc from "fast-check";
import {
  createAccountsNamespace,
  createSessionNamespace,
  createTargetsNamespace,
} from "../../packages/core/src/accounts/index.js";
import { MixpanelHeadlessError } from "../../packages/core/src/errors.js";
import { Secret } from "../../packages/core/src/secret.js";
import { makeEffects } from "../../packages/core/test/accounts/fake-auth-effects.js";

/** The op vocabulary. */
type Op =
  | { kind: "addAccount"; name: string; project: string | null }
  | { kind: "useAccount"; name: string }
  | { kind: "removeAccount"; name: string; force: boolean }
  | {
      kind: "addTarget";
      target: string;
      account: string;
      project: string;
      workspace: number | null;
    }
  | { kind: "removeTarget"; target: string }
  | { kind: "useTarget"; target: string }
  | { kind: "sessionUseWorkspace"; workspace: number }
  | { kind: "sessionUseProject"; project: string };

/** The independent mini-model (ConfigManager state, ~40 lines). */
interface Model {
  accounts: Map<string, { project: string | null }>;
  active: { account?: string; workspace?: number };
  targets: Map<
    string,
    { account: string; project: string; workspace: number | null }
  >;
}

/**
 * Apply an op to the model; return whether it should SUCCEED.
 *
 * @param model - The model (mutated on success only).
 * @param op - The op.
 * @returns `true` when the real system must succeed too.
 */
function applyModel(model: Model, op: Op): boolean {
  switch (op.kind) {
    case "addAccount": {
      if (model.accounts.has(op.name)) {
        return false;
      }
      const first = model.accounts.size === 0;
      model.accounts.set(op.name, { project: op.project });
      if (first) {
        model.active.account = op.name;
      }
      return true;
    }
    case "useAccount": {
      if (!model.accounts.has(op.name)) {
        return false;
      }
      model.active.account = op.name;
      delete model.active.workspace; // workspace-clear-on-switch
      return true;
    }
    case "removeAccount": {
      if (!model.accounts.has(op.name)) {
        return false;
      }
      const refs = [...model.targets.values()].some(
        (t) => t.account === op.name,
      );
      if (refs && !op.force) {
        return false;
      }
      model.accounts.delete(op.name);
      if (model.active.account === op.name) {
        delete model.active.account;
        delete model.active.workspace;
      }
      return true;
    }
    case "addTarget": {
      if (!model.accounts.has(op.account) || model.targets.has(op.target)) {
        return false;
      }
      model.targets.set(op.target, {
        account: op.account,
        project: op.project,
        workspace: op.workspace,
      });
      return true;
    }
    case "removeTarget": {
      if (!model.targets.has(op.target)) {
        return false;
      }
      model.targets.delete(op.target);
      return true;
    }
    case "useTarget": {
      const t = model.targets.get(op.target);
      if (t === undefined || !model.accounts.has(t.account)) {
        return false;
      }
      const account = model.accounts.get(t.account);
      if (account !== undefined) {
        account.project = t.project;
      }
      // Wholesale [active] replace (target atomicity).
      model.active = { account: t.account };
      if (t.workspace !== null) {
        model.active.workspace = t.workspace;
      }
      return true;
    }
    case "sessionUseWorkspace": {
      model.active.workspace = op.workspace;
      return true;
    }
    case "sessionUseProject": {
      const active = model.active.account;
      if (active === undefined) {
        return false;
      }
      const account = model.accounts.get(active);
      if (account === undefined) {
        return false;
      }
      account.project = op.project;
      return true;
    }
  }
}

const names = fc.constantFrom("a", "b", "c", "d");
const targetNames = fc.constantFrom("t1", "t2", "t3");
const projectIds = fc.constantFrom("1", "42", "3713224");
const workspaces = fc.integer({ min: 1, max: 2 ** 31 - 1 });

const ops: fc.Arbitrary<Op> = fc.oneof(
  fc
    .tuple(names, fc.option(projectIds, { nil: null }))
    .map(([name, project]) => ({ kind: "addAccount" as const, name, project })),
  names.map((name) => ({ kind: "useAccount" as const, name })),
  fc
    .tuple(names, fc.boolean())
    .map(([name, force]) => ({ kind: "removeAccount" as const, name, force })),
  fc
    .tuple(targetNames, names, projectIds, fc.option(workspaces, { nil: null }))
    .map(([target, account, project, workspace]) => ({
      kind: "addTarget" as const,
      target,
      account,
      project,
      workspace,
    })),
  targetNames.map((target) => ({ kind: "removeTarget" as const, target })),
  targetNames.map((target) => ({ kind: "useTarget" as const, target })),
  workspaces.map((workspace) => ({
    kind: "sessionUseWorkspace" as const,
    workspace,
  })),
  projectIds.map((project) => ({
    kind: "sessionUseProject" as const,
    project,
  })),
);

let sequences = 0;
let opsRun = 0;
let divergences = 0;

await fc.assert(
  fc.asyncProperty(
    fc.array(ops, { minLength: 1, maxLength: 14 }),
    async (sequence) => {
      sequences += 1;
      const bundle = makeEffects();
      const accounts = createAccountsNamespace(bundle.effects);
      const targets = createTargetsNamespace(bundle.effects);
      const session = createSessionNamespace(bundle.effects);
      const model: Model = {
        accounts: new Map(),
        active: {},
        targets: new Map(),
      };

      for (const op of sequence) {
        opsRun += 1;
        const wantOk = applyModel(model, op);
        let gotOk = true;
        try {
          switch (op.kind) {
            case "addAccount":
              await accounts.add(op.name, {
                type: "service_account",
                region: "us",
                default_project: op.project,
                username: "u",
                secret: new Secret("s"),
              });
              break;
            case "useAccount":
              accounts.use(op.name);
              break;
            case "removeAccount":
              accounts.remove(op.name, { force: op.force });
              break;
            case "addTarget":
              targets.add(op.target, {
                account: op.account,
                project: op.project,
                workspace: op.workspace,
              });
              break;
            case "removeTarget":
              targets.remove(op.target);
              break;
            case "useTarget":
              targets.use(op.target);
              break;
            case "sessionUseWorkspace":
              session.use({ workspace: op.workspace });
              break;
            case "sessionUseProject":
              session.use({ project: op.project });
              break;
          }
        } catch (exc) {
          gotOk = false;
          if (!(exc instanceof MixpanelHeadlessError)) {
            divergences += 1;
            throw new Error(
              `non-coded error for ${JSON.stringify(op)}: ${String(exc)}`,
            );
          }
        }
        if (wantOk !== gotOk) {
          divergences += 1;
          throw new Error(
            `outcome divergence for ${JSON.stringify(op)}: model=${String(wantOk)} real=${String(gotOk)}`,
          );
        }
      }

      // Post-sequence state comparison.
      const realNames = accounts.list().map((s) => s.name);
      const modelNames = [...model.accounts.keys()].sort();
      if (JSON.stringify(realNames) !== JSON.stringify(modelNames)) {
        divergences += 1;
        throw new Error(
          `account set divergence: real=${JSON.stringify(realNames)} model=${JSON.stringify(modelNames)}`,
        );
      }
      const active = session.show();
      if ((active.account ?? null) !== (model.active.account ?? null)) {
        divergences += 1;
        throw new Error("active.account divergence");
      }
      if ((active.workspace ?? null) !== (model.active.workspace ?? null)) {
        divergences += 1;
        throw new Error("active.workspace divergence");
      }
      const realTargets = targets
        .list()
        .map((t) => [t.name, t.account, t.project, t.workspace]);
      const modelTargets = [...model.targets.keys()].sort().map((name) => {
        const t = model.targets.get(name) as {
          account: string;
          project: string;
          workspace: number | null;
        };
        return [name, t.account, t.project, t.workspace];
      });
      if (JSON.stringify(realTargets) !== JSON.stringify(modelTargets)) {
        divergences += 1;
        throw new Error("targets divergence");
      }
      // default_project follows the model.
      for (const [name, entry] of model.accounts) {
        const real = bundle.config.getAccount(name);
        if ((real.default_project ?? null) !== entry.project) {
          divergences += 1;
          throw new Error(`default_project divergence for '${name}'`);
        }
      }
      // Invariant: [active].account, when set, names an existing account.
      if (
        model.active.account !== undefined &&
        !model.accounts.has(model.active.account)
      ) {
        divergences += 1;
        throw new Error("model invariant broken: dangling active account");
      }
    },
  ),
  { numRuns: 600, seed: 20260818 },
);

console.log(
  `ops-fuzz: sequences ${String(sequences)} (>=500 budget)  ops ${String(opsRun)}  divergences ${String(divergences)}  seed 20260818`,
);
if (divergences > 0) {
  process.exitCode = 1;
}
