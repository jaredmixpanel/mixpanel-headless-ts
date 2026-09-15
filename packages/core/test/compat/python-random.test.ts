// `PythonRandom.getrandbits` / `pythonSample` — CPython `random.Random` parity
// (Mersenne Twister seeding, getrandbits, `sample`) behind `ReplayBundle.sample`.
// No Python test file behind this suite: the probe matrix is generated in the
// Python repo (`conformance/goldens/rrweb/generate.py`) and copied here as
// `python-random-probe.json`; regenerate there, never hand-edit it.
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
    expect(() => pythonSample(["a", "b"], 3, 42)).toThrow(
      /Sample larger than population/,
    );
  });

  it("rejects a negative k", () => {
    expect(() => pythonSample(["a", "b"], -1, 42)).toThrow(
      /Sample larger than population/,
    );
  });
});
