// Guard + factory tests for Metric/Formula/CohortMetric/TimeComparison
// (phase2-design C7, packet P2-5a): translated from
// tests/unit/test_query_types.py guard cases plus Risk #1 guard-order
// probes and a C9 fast-check guard-totality property. The minimal
// CohortDefinition shells (pulled forward for the CM5 vectors) are
// exercised here too.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  type MixpanelHeadlessError,
  ParamValidationError,
} from "../../../src/errors.js";
import {
  CohortCriteria,
  CohortDefinition,
} from "../../../src/types/query-params/cohort.js";
import { MATH_REQUIRING_PROPERTY } from "../../../src/types/query-params/guards.js";
import {
  CohortMetric,
  Formula,
  Metric,
  TimeComparison,
} from "../../../src/types/query-params/metric.js";

/**
 * Assert a thunk throws the exact guard `{class, code}` pair.
 *
 * @param thunk - The construction under test.
 * @param code - Expected registry code.
 */
function expectGuard(thunk: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    thunk();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected ${code}`).toBeInstanceOf(ParamValidationError);
  expect((thrown as MixpanelHeadlessError).code).toBe(code);
}

/** An inline definition for the CM5 cases (corpus CM5 payload shape). */
function inlineDefinition(): CohortDefinition {
  return CohortDefinition.allOf(
    new CohortCriteria({
      _selector_node: {
        property: "behaviors",
        value: "bhvr_0",
        operator: ">=",
        operand: 1,
      },
      _behavior_key: "bhvr_0",
      _behavior: {
        count: {
          event_selector: { event: "Purchase", selector: null },
          type: "absolute",
        },
        window: { unit: "day", value: 30 },
      },
    }),
  );
}

describe("Metric guards (source order)", () => {
  it("EV1_EMPTY_EVENT on empty/blank events", () => {
    for (const event of ["a\x00b", "a\x07b", "a\x1Fb", "a\x7Fb"]) {
      expectGuard(() => new Metric({ event }), "EV2_CONTROL_CHAR_EVENT");
    }
  });

  it("V13_METRIC_MATH_PROPERTY for every property-requiring math type", () => {
    for (const math of MATH_REQUIRING_PROPERTY) {
      expectGuard(
        () => new Metric({ event: "Login", math: math as "average" }),
        "V13_METRIC_MATH_PROPERTY",
      );
    }
    // `total`/`unique`/`dau` are NOT in the property-requiring set.
    expect(
      new Metric({ event: "Login", math: "unique", property: null }),
    ).toBeInstanceOf(Metric);
    expect(new Metric({ event: "Login" }).math).toBe("total");
  });

  it("V26_PERCENTILE_REQUIRES_VALUE when percentile math lacks its value", () => {
    expectGuard(
      () => new Metric({ event: "e", math: "percentile", property: "p" }),
      "V26_PERCENTILE_REQUIRES_VALUE",
    );
    // Explicit null is Python None — still missing.
    expectGuard(
      () =>
        new Metric({
          event: "e",
          math: "percentile",
          property: "q",
          percentile_value: null,
        }),
      "V26_PERCENTILE_REQUIRES_VALUE",
    );
    expect(
      new Metric({
        event: "e",
        math: "percentile",
        property: "p",
        percentile_value: 95,
      }).percentile_value,
    ).toBe(95);
  });

  it("MT2_INVALID_SEGMENT_METHOD on unknown segment methods", () => {
    for (const segmentMethod of ["bogus", "last"]) {
      expectGuard(
        () =>
          new Metric({
            event: "e",
            segment_method: segmentMethod as "all",
          }),
        "MT2_INVALID_SEGMENT_METHOD",
      );
    }
    expect(
      new Metric({ event: "e", segment_method: "first" }).segment_method,
    ).toBe("first");
  });

  it("guard order: EV1 -> V13 -> V26 -> MT2 (first failing wins)", () => {
    expectGuard(
      () => new Metric({ event: " ", math: "average" }),
      "EV1_EMPTY_EVENT",
    );
    expectGuard(
      () =>
        new Metric({
          event: "e",
          math: "average",
          segment_method: "bogus" as "all",
        }),
      "V13_METRIC_MATH_PROPERTY",
    );
    expectGuard(
      () =>
        new Metric({
          event: "e",
          math: "percentile",
          property: "p",
          segment_method: "bogus" as "all",
        }),
      "V26_PERCENTILE_REQUIRES_VALUE",
    );
  });

  it("applies the Python field defaults", () => {
    const metric = new Metric({ event: "Login" });
    expect(metric.math).toBe("total");
    expect(metric.property).toBeNull();
    expect(metric.per_user).toBeNull();
    expect(metric.percentile_value).toBeNull();
    expect(metric.filters).toBeNull();
    expect(metric.filters_combinator).toBe("all");
    expect(metric.segment_method).toBeNull();
  });
});

describe("Formula guards", () => {
  it("FM1_EMPTY_EXPRESSION on empty/blank expressions", () => {
    for (const expression of ["", " ".repeat(3)]) {
      expectGuard(() => new Formula({ expression }), "FM1_EMPTY_EXPRESSION");
    }
  });

  it("constructs with a default null label", () => {
    const formula = new Formula({ expression: "(B / A) * 100" });
    expect(formula.label).toBeNull();
    expect(new Formula({ expression: "A", label: "Conversion %" }).label).toBe(
      "Conversion %",
    );
  });
});

describe("CohortMetric guards (source order)", () => {
  it("CM1_COHORT_ID_NOT_POSITIVE on zero/negative ids", () => {
    for (const cohort of [0, -7, -3]) {
      expectGuard(
        () => new CohortMetric({ cohort }),
        "CM1_COHORT_ID_NOT_POSITIVE",
      );
    }
  });

  it("CM2_COHORT_NAME_EMPTY on blank provided names", () => {
    for (const name of ["", " ".repeat(3), "  \t "]) {
      expectGuard(
        () => new CohortMetric({ cohort: 5, name }),
        "CM2_COHORT_NAME_EMPTY",
      );
    }
  });

  it("CM5_INLINE_COHORT_METRIC on inline definitions", () => {
    expectGuard(
      () => new CohortMetric({ cohort: inlineDefinition(), name: "Active" }),
      "CM5_INLINE_COHORT_METRIC",
    );
    expectGuard(
      () => new CohortMetric({ cohort: inlineDefinition() }),
      "CM5_INLINE_COHORT_METRIC",
    );
  });

  it("guard order: CM1 wins over CM2; CM2 wins over CM5", () => {
    expectGuard(
      () => new CohortMetric({ cohort: 0, name: "  " }),
      "CM1_COHORT_ID_NOT_POSITIVE",
    );
    // The shared cohort-args guard runs BEFORE the CM5 instanceof check.
    expectGuard(
      () => new CohortMetric({ cohort: inlineDefinition(), name: "  " }),
      "CM2_COHORT_NAME_EMPTY",
    );
  });

  it("constructs from a saved cohort id", () => {
    const metric = new CohortMetric({ cohort: 123, name: "Power Users" });
    expect(metric.cohort).toBe(123);
    expect(metric.name).toBe("Power Users");
    expect(new CohortMetric({ cohort: 123 }).name).toBeNull();
  });
});

describe("CohortDefinition shells (P2-5a subset)", () => {
  it("CD9_EMPTY_CRITERIA on empty construction", () => {
    expectGuard(() => new CohortDefinition(), "CD9_EMPTY_CRITERIA");
    expectGuard(() => CohortDefinition.allOf(), "CD9_EMPTY_CRITERIA");
    expectGuard(() => CohortDefinition.anyOf(), "CD9_EMPTY_CRITERIA");
  });

  it("stores the and/or combinators exactly as Python does", () => {
    const criterion = new CohortCriteria({
      _selector_node: { property: "plan" },
      _behavior_key: null,
      _behavior: null,
    });
    expect(new CohortDefinition(criterion)._operator).toBe("and");
    expect(CohortDefinition.allOf(criterion)._operator).toBe("and");
    expect(CohortDefinition.anyOf(criterion)._operator).toBe("or");
    expect(CohortDefinition.anyOf(criterion)._criteria).toHaveLength(1);
  });
});

describe("TimeComparison guards (rules TC0-TC3b, source order)", () => {
  it("TC0_INVALID_TYPE on unknown types", () => {
    for (const type of ["bogus", "weekly"]) {
      expectGuard(
        () => new TimeComparison({ type: type as "relative" }),
        "TC0_INVALID_TYPE",
      );
    }
  });

  it("TC1_REQUIRES_UNIT / TC1B_INVALID_UNIT / TC1_REJECTS_DATE", () => {
    expectGuard(
      () => new TimeComparison({ type: "relative" }),
      "TC1_REQUIRES_UNIT",
    );
    expectGuard(
      () => new TimeComparison({ type: "relative", unit: null, date: null }),
      "TC1_REQUIRES_UNIT",
    );
    for (const unit of ["fortnight", "hours"]) {
      expectGuard(
        () => new TimeComparison({ type: "relative", unit: unit as "day" }),
        "TC1B_INVALID_UNIT",
      );
    }
    expectGuard(
      () =>
        new TimeComparison({
          type: "relative",
          unit: "day",
          date: "2025-12-31",
        }),
      "TC1_REJECTS_DATE",
    );
  });

  it("TC2_REQUIRES_DATE / TC2_REJECTS_UNIT / TC3 / TC3B", () => {
    expectGuard(
      () => new TimeComparison({ type: "absolute-start" }),
      "TC2_REQUIRES_DATE",
    );
    expectGuard(
      () =>
        new TimeComparison({
          type: "absolute-end",
          unit: "day",
          date: "2026-01-01",
        }),
      "TC2_REJECTS_UNIT",
    );
    for (const date of ["01-01-2026", "2026-1-1", "2026/01/01", "not-a-date"]) {
      expectGuard(
        () => new TimeComparison({ type: "absolute-start", date }),
        "TC3_DATE_FORMAT",
      );
    }
    for (const date of ["2026-02-30", "2025-13-01"]) {
      expectGuard(
        () => new TimeComparison({ type: "absolute-end", date }),
        "TC3B_DATE_INVALID",
      );
    }
  });

  it("guard order: TC0 first; unit checks precede date checks per branch", () => {
    expectGuard(
      () => new TimeComparison({ type: "bogus" as "relative", unit: "day" }),
      "TC0_INVALID_TYPE",
    );
    // relative: invalid unit wins over the rejected date.
    expectGuard(
      () =>
        new TimeComparison({
          type: "relative",
          unit: "fortnight" as "day",
          date: "2026-01-01",
        }),
      "TC1B_INVALID_UNIT",
    );
    // absolute: missing date wins over the rejected unit...
    expectGuard(
      () => new TimeComparison({ type: "absolute-end", unit: "month" }),
      "TC2_REQUIRES_DATE",
    );
    // ...and the rejected unit wins over a malformed date.
    expectGuard(
      () =>
        new TimeComparison({
          type: "absolute-end",
          unit: "day",
          date: "bad",
        }),
      "TC2_REJECTS_UNIT",
    );
  });

  it("factories mirror the Python classmethods", () => {
    const relative = TimeComparison.relative("month");
    expect(relative.type).toBe("relative");
    expect(relative.unit).toBe("month");
    expect(relative.date).toBeNull();
    const start = TimeComparison.absoluteStart("2026-01-01");
    expect(start.type).toBe("absolute-start");
    expect(start.unit).toBeNull();
    expect(start.date).toBe("2026-01-01");
    expect(TimeComparison.absoluteEnd("2026-12-31").type).toBe("absolute-end");
  });
});

describe("C9 guard-totality property (fast-check #4)", () => {
  it("unknown comparison types always raise the TC0 registry code", () => {
    fc.assert(
      fc.property(
        fc
          .string()
          .filter(
            (value) =>
              !["relative", "absolute-start", "absolute-end"].includes(value),
          ),
        (type) => {
          try {
            new TimeComparison({ type: type as "relative" });
            return false;
          } catch (error) {
            return (
              error instanceof ParamValidationError &&
              error.code === "TC0_INVALID_TYPE"
            );
          }
        },
      ),
    );
  });

  it("every valid relative unit constructs", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("day", "week", "month", "quarter", "year"),
        (unit) => TimeComparison.relative(unit).unit === unit,
      ),
    );
  });
});
