// Verdict/report tests (src/verdicts.ts, task TS-5): D12 report shape and
// failure classification.
import { describe, expect, it } from "vitest";

import {
  isFailingVerdict,
  summarizeResults,
  type VectorResult,
} from "../src/verdicts.js";

describe("isFailingVerdict", () => {
  it("classifies the taxonomy per design D12", () => {
    expect(isFailingVerdict("PASS")).toBe(false);
    expect(isFailingVerdict("UNPORTED")).toBe(false);
    expect(isFailingVerdict("FAIL_OUTPUT")).toBe(true);
    expect(isFailingVerdict("FAIL_REQUEST")).toBe(true);
    expect(isFailingVerdict("FAIL_ERROR")).toBe(true);
    expect(isFailingVerdict("PRECISION_LOSS")).toBe(true);
    expect(isFailingVerdict("UNMAPPED_API")).toBe(true);
  });
});

describe("summarizeResults", () => {
  it("produces the D12 JSON report shape", () => {
    const results: VectorResult[] = [
      { id: "compat/z/a", capability: "compat", verdict: "PASS" },
      { id: "filters/f/b", capability: "filters", verdict: "UNPORTED" },
      {
        id: "funnels/f/c",
        capability: "funnels",
        verdict: "FAIL_OUTPUT",
        diff: "output x != expected y",
      },
      {
        id: "engage/e/d",
        capability: "engage",
        verdict: "UNMAPPED_API",
        diff: "api unknown",
      },
    ];
    expect(summarizeResults(results)).toStrictEqual({
      total: 4,
      passed: 1,
      failed: 2,
      skipped_unported: 1,
      failures: [
        {
          id: "funnels/f/c",
          verdict: "FAIL_OUTPUT",
          diff: "output x != expected y",
        },
        { id: "engage/e/d", verdict: "UNMAPPED_API", diff: "api unknown" },
      ],
    });
  });

  it("handles an empty run", () => {
    expect(summarizeResults([])).toStrictEqual({
      total: 0,
      passed: 0,
      failed: 0,
      skipped_unported: 0,
      failures: [],
    });
  });
});
