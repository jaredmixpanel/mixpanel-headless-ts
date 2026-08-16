// B8-N1 swap-in shim (throwaway; b8-packets.md §2.6 done-criteria):
// rebuild the B7 fake effects bundle but with `config` REPLACED by the
// REAL on-disk `createNodeConfigSource` over a fresh tmp-dir
// config.toml. The B7 fake-backed `accounts-namespace.test.ts` suite is
// copied alongside (imports rewritten to this module) and must pass
// UNCHANGED — proving the real `ConfigWrites` honors the same contract
// (FR-045 promotion in the adapter, duplicate-add PLAIN ConfigError,
// setActive workspace-null clear, applyTarget wholesale replace, …).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

import {
  makeEffects as fakeMakeEffects,
  meFetch,
  type MakeEffectsOptions,
} from "../../packages/core/test/accounts/fake-auth-effects.js";
import {
  createNodeConfigSource,
  type NodeConfigSource,
} from "../../packages/node/src/config-writes.js";

export { meFetch };

const RUN_ROOT = mkdtempSync(join(tmpdir(), "mp-b8n1-swapin-"));
const home = resolve(homedir());
if (RUN_ROOT === home || RUN_ROOT.startsWith(home + sep)) {
  throw new Error(`real-home guard: refusing tmp root under home: ${RUN_ROOT}`);
}
process.on("exit", () => {
  rmSync(RUN_ROOT, { recursive: true, force: true });
});
let seq = 0;

/** The fake bundle with the config member swapped for the real one. */
export type SwapInBundle = Omit<
  ReturnType<typeof fakeMakeEffects>,
  "config"
> & {
  /** The REAL on-disk config source (tmp-dir backed). */
  readonly config: NodeConfigSource;
};

/**
 * Build the swap-in bundle: fake everything EXCEPT config, which is the
 * real node TOML-backed source in a fresh tmp dir.
 *
 * @param options - Same overrides the fake accepts.
 * @returns The bundle with `effects.config` and `config` both real.
 */
export function makeEffects(options: MakeEffectsOptions = {}): SwapInBundle {
  const bundle = fakeMakeEffects(options);
  seq += 1;
  const configPath = join(RUN_ROOT, `case-${seq}`, "config.toml");
  // Parent dir is created by ConfigManager.writeRaw (mkdir -p 0o700).
  const config = createNodeConfigSource({ configPath });
  return {
    ...bundle,
    config,
    effects: { ...bundle.effects, config },
  };
}
