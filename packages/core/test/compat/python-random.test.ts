// CPython `random.Random` parity lock (packet B5-S3 decision S3-D1,
// `b5-packets.md:529-540`). The probe matrix is GENERATED — regenerate
// from the Python repo with the snippet recorded in
// `context/phase3/notes/B5-S3-notes.md` §S3-D1 and copy
// `conformance/goldens/rrweb/python-random-probe.json` here.
//
// There is no Python test file behind this suite: it is the pinned
// CPython evidence the packet mandates in place of a
// sanctioned-deviation filing for `ReplayBundle.sample`.
import { describe, expect, it } from "vitest";

import { PythonRandom, pythonSample } from "../../src/compat/python-random.js";
import probe from "./python-random-probe.json" with { type: "json" };

/** One recorded probe case (discriminated by `kind`). */
type ProbeCase =
  | { kind: "getrandbits"; seed: number; k: number; values: string[] }
  | { kind: "sample"; seed: number; n: number; k: number; result: string[] };

const cases = probe.cases as unknown as readonly ProbeCase[];

describe("PythonRandom.getrandbits matches CPython", () => {
  const bitCases = cases.filter(
    (c): c is Extract<ProbeCase, { kind: "getrandbits" }> =>
      c.kind === "getrandbits",
  );

  it.each(bitCases.map((c, i) => [i, c] as const))(
    "case %i (seed/bit-width from the probe)",
    (_i, testCase) => {
      const rng = new PythonRandom(testCase.seed);
      const got = testCase.values.map(() => rng.getrandbits(testCase.k));
      expect(got).toStrictEqual(testCase.values.map(BigInt));
    },
  );
});

describe("pythonSample matches CPython random.Random(seed).sample", () => {
  const sampleCases = cases.filter(
    (c): c is Extract<ProbeCase, { kind: "sample" }> => c.kind === "sample",
  );

  it.each(sampleCases.map((c, i) => [i, c] as const))(
    "case %i (seed/n/k from the probe)",
    (_i, testCase) => {
      const population = Array.from(
        { length: testCase.n },
        (_v, i) => `r-${String(i)}`,
      );
      expect(pythonSample(population, testCase.k, testCase.seed)).toStrictEqual(
        testCase.result,
      );
    },
  );

  it("rejects k > n with the CPython range code", () => {
    expect(() => pythonSample(["a", "b"], 3, 42)).toThrowError(
      /Sample larger than population/,
    );
  });

  it("rejects a negative k", () => {
    expect(() => pythonSample(["a", "b"], -1, 42)).toThrowError(
      /Sample larger than population/,
    );
  });
});
