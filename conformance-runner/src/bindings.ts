/**
 * Central wiring of ported TS entry points into the conformance runner.
 *
 * This is the ONE place port batches register their bindings: an
 * {@link ImplementationRegistry} entry per Python dotted api name (flipping
 * those vectors from `UNPORTED` to live replay, R10.5) and a
 * {@link CodecRegistry} decoder per rich `$type` tag their signatures
 * consume (D4.4). Both the vitest corpus harness and the standalone
 * `npm run conformance` CLI build their dependencies here, so the two
 * entry points can never disagree about what is ported.
 *
 * TS-5 state: NO modules with corpus presence are ported, so no bindings
 * are registered — every corpus vector replays as `UNPORTED`. TS-6 (the
 * D13 gate) adds the `compat.*` / wire-stub bindings when the authored
 * compat vectors land in the snapshot (Python PR-7).
 */

import { CodecRegistry } from "./codecs.js";
import type { RunnerDeps } from "./runner.js";
import { ImplementationRegistry } from "./runner.js";

/**
 * Build the runner dependencies with every current port-batch binding.
 *
 * @param recordEpoch - The frozen record instant (corpus config /
 *   manifest `record_epoch`).
 * @returns Fresh {@link RunnerDeps} carrying all registered bindings.
 *
 * @example
 * ```typescript
 * const deps = createRunnerDeps("2026-01-15T12:00:00Z");
 * const results = await runCorpus(corpus, deps);
 * ```
 */
export function createRunnerDeps(recordEpoch: string): RunnerDeps {
  const implementations = new ImplementationRegistry();
  const codecs = new CodecRegistry();
  // Port-batch registrations go here (TS-6+): e.g.
  //   implementations.register("compat.zfill", ({ kwargs }) => ...);
  //   codecs.register("Filter", decodeFilter);
  return { implementations, codecs, recordEpoch };
}
