// Full-corpus vitest harness (task TS-5, design D12 reporting): one
// dynamic `describe` per capability, one `it` per vector id.
//
// Verdict handling per D12: `UNPORTED` vectors are SKIPPED (counted, never
// failing, until their module's port batch is declared done per R10.5);
// every other non-PASS verdict fails its test. At TS-5 the snapshot
// contains no authored compat vectors (Python PR-7 had not landed at
// sync time), so every vector skips as UNPORTED; TS-6 re-syncs the corpus
// and flips the compat vectors to live PASS assertions.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createRunnerDeps } from "../src/bindings.js";
import { loadCorpus, loadCorpusConfig } from "../src/loader.js";
import { runVector, vectorCapability } from "../src/runner.js";
import type { ConformanceVector } from "../src/vector-types.js";

/** The conformance-runner package root. */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const config = loadCorpusConfig(PACKAGE_DIR);
const corpus = loadCorpus(
  resolve(PACKAGE_DIR, config.vectorsPath),
  config.sourceCommit,
  config.recordEpoch,
);
const deps = createRunnerDeps(config.recordEpoch);

/** Vectors grouped by capability, in corpus order. */
const byCapability = new Map<string, ConformanceVector[]>();
for (const vector of corpus.vectors) {
  const capability = vectorCapability(vector);
  const group = byCapability.get(capability) ?? [];
  group.push(vector);
  byCapability.set(capability, group);
}

for (const [capability, vectors] of byCapability) {
  describe(`conformance: ${capability}`, () => {
    it.for(vectors)("$id", async (vector, { skip }) => {
      const result = await runVector(vector, deps);
      if (result.verdict === "UNPORTED") {
        skip();
        return;
      }
      expect.soft(result.diff ?? "", `verdict ${result.verdict}`).toBe("");
      expect(result.verdict).toBe("PASS");
    });
  });
}
