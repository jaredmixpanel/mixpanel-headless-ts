/**
 * Layer-3 translation of `tests/unit/test_live_query_pbt.py` (B5-S2,
 * packet §3) — BOTH classes: TestTransformFunnelProperties :127,
 * TestTransformRetentionProperties :314.
 *
 * Hypothesis `@settings(max_examples=100)` → fast-check `numRuns: 100`
 * (the un-settinged cases keep Hypothesis's own 100 default).
 *
 * Fidelity notes:
 * - `st.dates().map(strftime("%Y-%m-%d"))` becomes a generated
 *   proleptic-Gregorian `YYYY-MM-DD` string over the same 1..9999 year
 *   span; the values are only ever compared/ordered, never parsed.
 * - `event_names` (`st.characters(categories=("L","N","P","S"))`)
 *   becomes an explicit alphabet spanning Latin / Greek / Cyrillic /
 *   CJK letters, ASCII + non-ASCII digits, punctuation and symbols
 *   (strictly inside the Python categories; the B2 ASSERT-F1
 *   convention).
 * - `dates == sorted(dates)` is CODE-POINT ordered (R11.5), so the
 *   assertion uses {@link sortedByCodepoint} rather than JS `.sort()`.
 * - `_transform_funnel` / `_transform_retention` are
 *   {@link transformFunnel} / {@link transformRetention} in
 *   `services/live-query-transforms.ts` (R7.2 split).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  transformFunnel,
  transformRetention,
} from "../../src/services/live-query-transforms.js";
import { sortedByCodepoint } from "../../src/compat/index.js";
import type { TimeUnit } from "../../src/types/literals.js";

// ===========================================================================
// Custom strategies (test_live_query_pbt.py:23-118)
// ===========================================================================

/** `date_strings` — `st.dates().map(lambda d: d.strftime("%Y-%m-%d"))`. */
const dateStrings: fc.Arbitrary<string> = fc
  .date({
    min: new Date(Date.UTC(1, 0, 1)),
    max: new Date(Date.UTC(9999, 11, 31)),
    noInvalidDate: true,
  })
  .map((d) => {
    const year = `${d.getUTCFullYear()}`.padStart(4, "0");
    const month = `${d.getUTCMonth() + 1}`.padStart(2, "0");
    const day = `${d.getUTCDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  });

/**
 * `event_names` — `st.text(alphabet=st.characters(categories=("L","N",
 * "P","S")), min_size=1, max_size=50)`.
 */
const eventNames: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(
      // L (letters), including a non-BMP letter
      "a",
      "Z",
      "é",
      "Δ",
      "Ж",
      "漢",
      "𝒳",
      // N (numbers), ASCII and non-ASCII decimal digits
      "0",
      "9",
      "٣",
      "۵",
      // P (punctuation)
      ".",
      "-",
      "_",
      "(",
      // S (symbols)
      "+",
      "$",
      "€",
      "→",
    ),
    { minLength: 1, maxLength: 50 },
  )
  .map((chars) => chars.join(""));

/** `step_counts` — non-negative integers up to 1,000,000. */
const stepCounts: fc.Arbitrary<number> = fc.integer({ min: 0, max: 1_000_000 });

/** `cohort_sizes` — non-negative integers up to 1,000,000. */
const cohortSizes: fc.Arbitrary<number> = fc.integer({
  min: 0,
  max: 1_000_000,
});

/** `time_units` — `st.sampled_from(["day", "week", "month"])`. */
const timeUnits: fc.Arbitrary<TimeUnit> = fc.constantFrom<TimeUnit>(
  "day",
  "week",
  "month",
);

/** `funnel_step()` — one API funnel step. */
const funnelStep: fc.Arbitrary<Record<string, unknown>> = fc.record({
  event: eventNames,
  count: stepCounts,
});

/** `raw_funnel_response()` — the `{data: {date: {steps, analysis}}}` shape. */
const rawFunnelResponse: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(
    fc.integer({ min: 0, max: 5 }),
    fc.integer({ min: 0, max: 10 }),
    fc.uniqueArray(dateStrings, { minLength: 0, maxLength: 5 }),
    fc.array(fc.array(funnelStep, { minLength: 0, maxLength: 10 }), {
      minLength: 0,
      maxLength: 5,
    }),
  )
  .map(([numDates, numSteps, allDates, allSteps]) => {
    const dates = allDates.slice(0, numDates);
    const data: Record<string, unknown> = {};
    dates.forEach((date, index) => {
      const drawn = allSteps[index] ?? [];
      // Python draws exactly `num_steps` steps per date; the mapped
      // pool is padded/trimmed to the same length.
      const steps: Array<Record<string, unknown>> = [];
      for (let i = 0; i < numSteps; i += 1) {
        steps.push(drawn[i % Math.max(drawn.length, 1)] ?? { event: "e", count: 0 });
      }
      data[date] = { steps, analysis: {} };
    });
    return { data };
  });

/** `raw_retention_response()` — the `{date: {first, counts}}` shape. */
const rawRetentionResponse: fc.Arbitrary<Record<string, unknown>> = fc
  .tuple(
    fc.integer({ min: 0, max: 10 }),
    fc.integer({ min: 0, max: 20 }),
    fc.uniqueArray(dateStrings, { minLength: 0, maxLength: 10 }),
    fc.array(cohortSizes, { minLength: 10, maxLength: 10 }),
    fc.array(fc.integer({ min: 0, max: 2_000_000 }), {
      minLength: 20,
      maxLength: 20,
    }),
  )
  .map(([numCohorts, numPeriods, allDates, sizes, rawCounts]) => {
    const dates = allDates.slice(0, numCohorts);
    const result: Record<string, unknown> = {};
    dates.forEach((date, index) => {
      const cohortSize = sizes[index] ?? 0;
      const cap = Math.max(1, cohortSize * 2);
      const counts = rawCounts
        .slice(0, numPeriods)
        .map((value) => Math.min(value, cap));
      result[date] = { first: cohortSize, counts };
    });
    return result;
  });

// ===========================================================================
// _transform_funnel property tests
// ===========================================================================

describe("TestTransformFunnelProperties", () => {
  it("first step conversion is always 1.0", () => {
    fc.assert(
      fc.property(
        rawFunnelResponse,
        fc.integer({ min: 1, max: 1_000_000 }),
        dateStrings,
        dateStrings,
        (raw, funnelId, fromDate, toDate) => {
          const result = transformFunnel(raw, funnelId, fromDate, toDate);
          if (result.steps.length > 0) {
            expect(result.steps[0]!.conversion_rate).toBe(1.0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("conversion rates are non-negative", () => {
    fc.assert(
      fc.property(
        rawFunnelResponse,
        fc.integer({ min: 1, max: 1_000_000 }),
        dateStrings,
        dateStrings,
        (raw, funnelId, fromDate, toDate) => {
          const result = transformFunnel(raw, funnelId, fromDate, toDate);
          for (const step of result.steps) {
            expect(step.conversion_rate).toBeGreaterThanOrEqual(0.0);
          }
          expect(result.conversion_rate).toBeGreaterThanOrEqual(0.0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("overall conversion is last/first, or 0.0", () => {
    fc.assert(
      fc.property(
        rawFunnelResponse,
        fc.integer({ min: 1, max: 1_000_000 }),
        dateStrings,
        dateStrings,
        (raw, funnelId, fromDate, toDate) => {
          const result = transformFunnel(raw, funnelId, fromDate, toDate);
          if (result.steps.length > 0) {
            const firstCount = result.steps[0]!.count;
            const lastCount = result.steps[result.steps.length - 1]!.count;
            if (firstCount > 0) {
              const expected = lastCount / firstCount;
              expect(Math.abs(result.conversion_rate - expected)).toBeLessThan(
                1e-9,
              );
            } else {
              expect(result.conversion_rate).toBe(0.0);
            }
          } else {
            expect(result.conversion_rate).toBe(0.0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("empty funnels have a zero conversion rate", () => {
    fc.assert(
      fc.property(
        rawFunnelResponse,
        fc.integer({ min: 1, max: 1_000_000 }),
        dateStrings,
        dateStrings,
        (raw, funnelId, fromDate, toDate) => {
          const result = transformFunnel(raw, funnelId, fromDate, toDate);
          if (result.steps.length === 0) {
            expect(result.conversion_rate).toBe(0.0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a zero previous count yields a zero conversion rate", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        dateStrings,
        dateStrings,
        dateStrings,
        fc.integer({ min: 2, max: 5 }),
        (funnelId, fromDate, toDate, date, numSteps) => {
          // Create a funnel where one middle step has count=0
          const steps: Array<Record<string, unknown>> = [];
          for (let i = 0; i < numSteps; i += 1) {
            steps.push({ event: `Step ${String(i)}`, count: 100 });
          }
          const zeroStepIdx = Math.floor(numSteps / 2);
          steps[zeroStepIdx]!["count"] = 0;

          const raw = { data: { [date]: { steps, analysis: {} } } };
          const result = transformFunnel(raw, funnelId, fromDate, toDate);

          if (zeroStepIdx + 1 < result.steps.length) {
            expect(result.steps[zeroStepIdx + 1]!.conversion_rate).toBe(0.0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ===========================================================================
// _transform_retention property tests
// ===========================================================================

describe("TestTransformRetentionProperties", () => {
  it("retention values are non-negative", () => {
    fc.assert(
      fc.property(
        rawRetentionResponse,
        eventNames,
        eventNames,
        dateStrings,
        dateStrings,
        timeUnits,
        (raw, bornEvent, returnEvent, fromDate, toDate, unit) => {
          const result = transformRetention(
            raw,
            bornEvent,
            returnEvent,
            fromDate,
            toDate,
            unit,
          );
          for (const cohort of result.cohorts) {
            for (const retentionValue of cohort.retention) {
              expect(retentionValue).toBeGreaterThanOrEqual(0.0);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("cohorts are sorted by date", () => {
    fc.assert(
      fc.property(
        rawRetentionResponse,
        eventNames,
        eventNames,
        dateStrings,
        dateStrings,
        timeUnits,
        (raw, bornEvent, returnEvent, fromDate, toDate, unit) => {
          const result = transformRetention(
            raw,
            bornEvent,
            returnEvent,
            fromDate,
            toDate,
            unit,
          );
          const dates = result.cohorts.map((cohort) => cohort.date);
          expect(dates).toEqual(sortedByCodepoint(dates));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a zero cohort size yields zero retention", () => {
    fc.assert(
      fc.property(
        eventNames,
        eventNames,
        dateStrings,
        dateStrings,
        timeUnits,
        dateStrings,
        fc.integer({ min: 1, max: 10 }),
        (bornEvent, returnEvent, fromDate, toDate, unit, date, numPeriods) => {
          // Cohort with size 0 but non-zero counts (the edge case)
          const raw = {
            [date]: { first: 0, counts: Array<number>(numPeriods).fill(10) },
          };

          const result = transformRetention(
            raw,
            bornEvent,
            returnEvent,
            fromDate,
            toDate,
            unit,
          );

          expect(result.cohorts.length).toBe(1);
          for (const retentionValue of result.cohorts[0]!.retention) {
            expect(retentionValue).toBe(0.0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("retention equals count / cohort_size", () => {
    fc.assert(
      fc.property(
        eventNames,
        eventNames,
        dateStrings,
        dateStrings,
        timeUnits,
        dateStrings,
        fc.integer({ min: 1, max: 1000 }),
        fc.array(fc.integer({ min: 0, max: 1000 }), {
          minLength: 1,
          maxLength: 10,
        }),
        (
          bornEvent,
          returnEvent,
          fromDate,
          toDate,
          unit,
          date,
          cohortSize,
          counts,
        ) => {
          const raw = { [date]: { first: cohortSize, counts } };

          const result = transformRetention(
            raw,
            bornEvent,
            returnEvent,
            fromDate,
            toDate,
            unit,
          );

          expect(result.cohorts.length).toBe(1);
          const cohort = result.cohorts[0]!;
          counts.forEach((count, i) => {
            const expected = count / cohortSize;
            expect(Math.abs(cohort.retention[i]! - expected)).toBeLessThan(
              1e-9,
            );
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it("an empty response yields empty cohorts", () => {
    fc.assert(
      fc.property(
        eventNames,
        eventNames,
        dateStrings,
        dateStrings,
        timeUnits,
        (bornEvent, returnEvent, fromDate, toDate, unit) => {
          const result = transformRetention(
            {},
            bornEvent,
            returnEvent,
            fromDate,
            toDate,
            unit,
          );
          expect(result.cohorts).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
