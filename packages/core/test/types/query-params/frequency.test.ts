// Guard + construction tests for FrequencyBreakdown/FrequencyFilter
// (phase2-design C7, packet P2-5c): translated from
// tests/unit/test_query_types.py (TestFrequencyBreakdownConstruction /
// TestFrequencyBreakdownValidation / TestFrequencyFilterConstruction /
// TestFrequencyFilterValidation / TestCodedFrequencyBreakdownCodes /
// TestCodedFrequencyFilterCodes), plus Risk #1 guard-order probes and a
// C9 fast-check guard-totality property. (The Python frozen-dataclass
// immutability/equality tests have no TS runtime analog — `readonly` is
// the compile-time equivalent, and dataclass `==` is Python-only.)
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { VALID_FREQUENCY_FILTER_OPERATORS } from "../../../src/bookmarks/enums.js";
import {
  MixpanelHeadlessError,
  ParamValidationError,
} from "../../../src/errors.js";
import { Filter } from "../../../src/types/query-params/filter.js";
import {
  FrequencyBreakdown,
  FrequencyFilter,
} from "../../../src/types/query-params/frequency.js";
import type { FrequencyFilterOperator } from "../../../src/types/literals.js";

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
  } catch (cause) {
    thrown = cause;
  }
  expect(thrown, `expected ${code}`).toBeInstanceOf(ParamValidationError);
  expect((thrown as MixpanelHeadlessError).code).toBe(code);
}

describe("FrequencyBreakdown construction", () => {
  it("applies the Python bucket defaults", () => {
    const breakdown = new FrequencyBreakdown({ event: "Purchase" });
    expect(breakdown.event).toBe("Purchase");
    expect(breakdown.bucket_size).toBe(1);
    expect(breakdown.bucket_min).toBe(0);
    expect(breakdown.bucket_max).toBe(10);
    expect(breakdown.label).toBeNull();
  });

  it("accepts all fields explicitly", () => {
    const breakdown = new FrequencyBreakdown({
      event: "Purchase",
      bucket_size: 5,
      bucket_min: 0,
      bucket_max: 50,
      label: "Purchase Frequency",
    });
    expect(breakdown.event).toBe("Purchase");
    expect(breakdown.bucket_size).toBe(5);
    expect(breakdown.bucket_min).toBe(0);
    expect(breakdown.bucket_max).toBe(50);
    expect(breakdown.label).toBe("Purchase Frequency");
  });
});

describe("FrequencyBreakdown guards (source order: FB1, FB2, FB4, FB3)", () => {
  it("FB1_EMPTY_EVENT on empty/blank events", () => {
    for (const event of ["", "   "]) {
      expectGuard(() => new FrequencyBreakdown({ event }), "FB1_EMPTY_EVENT");
    }
  });

  it("FB2_BUCKET_SIZE_NOT_POSITIVE on zero/negative bucket_size", () => {
    for (const bucketSize of [0, -1]) {
      expectGuard(
        () =>
          new FrequencyBreakdown({
            event: "Purchase",
            bucket_size: bucketSize,
          }),
        "FB2_BUCKET_SIZE_NOT_POSITIVE",
      );
    }
  });

  it("FB4_BUCKET_MIN_NEGATIVE on negative bucket_min", () => {
    for (const bucketMin of [-1, -10]) {
      expectGuard(
        () =>
          new FrequencyBreakdown({ event: "Purchase", bucket_min: bucketMin }),
        "FB4_BUCKET_MIN_NEGATIVE",
      );
    }
  });

  it("FB3_BUCKET_ORDER when bucket_min >= bucket_max", () => {
    expectGuard(
      () =>
        new FrequencyBreakdown({
          event: "Purchase",
          bucket_min: 10,
          bucket_max: 10,
        }),
      "FB3_BUCKET_ORDER",
    );
    expectGuard(
      () =>
        new FrequencyBreakdown({
          event: "Purchase",
          bucket_min: 20,
          bucket_max: 10,
        }),
      "FB3_BUCKET_ORDER",
    );
  });

  it("guard order: FB1 -> FB2 -> FB4 -> FB3 (FB4 precedes FB3, as Python)", () => {
    expectGuard(
      () => new FrequencyBreakdown({ event: " ", bucket_size: 0 }),
      "FB1_EMPTY_EVENT",
    );
    expectGuard(
      () =>
        new FrequencyBreakdown({
          event: "Purchase",
          bucket_size: 0,
          bucket_min: -1,
        }),
      "FB2_BUCKET_SIZE_NOT_POSITIVE",
    );
    // A negative bucket_min also violates FB3's ordering vs bucket_max=-5,
    // but Python fires FB4 first.
    expectGuard(
      () =>
        new FrequencyBreakdown({
          event: "Purchase",
          bucket_min: -1,
          bucket_max: -5,
        }),
      "FB4_BUCKET_MIN_NEGATIVE",
    );
  });
});

describe("FrequencyFilter construction", () => {
  it("applies the Python defaults with event+value only", () => {
    const filter = new FrequencyFilter({ event: "Login", value: 5 });
    expect(filter.event).toBe("Login");
    expect(filter.operator).toBe("is at least");
    expect(filter.value).toBe(5);
    expect(filter.date_range_value).toBeNull();
    expect(filter.date_range_unit).toBeNull();
    expect(filter.event_filters).toBeNull();
    expect(filter.label).toBeNull();
  });

  it("accepts all fields explicitly", () => {
    const filter = new FrequencyFilter({
      event: "Login",
      operator: "is greater than",
      value: 10,
      date_range_value: 30,
      date_range_unit: "day",
      event_filters: [Filter.equals("country", "US")],
      label: "Active Users",
    });
    expect(filter.event).toBe("Login");
    expect(filter.operator).toBe("is greater than");
    expect(filter.value).toBe(10);
    expect(filter.date_range_value).toBe(30);
    expect(filter.date_range_unit).toBe("day");
    expect(filter.event_filters).toHaveLength(1);
    expect(filter.label).toBe("Active Users");
  });

  it("accepts a float value and multiple event_filters", () => {
    expect(new FrequencyFilter({ event: "Login", value: 3.5 }).value).toBe(3.5);
    const filter = new FrequencyFilter({
      event: "Purchase",
      value: 1,
      event_filters: [
        Filter.equals("country", "US"),
        Filter.greaterThan("amount", 10),
      ],
    });
    expect(filter.event_filters).toHaveLength(2);
  });
});

describe("FrequencyFilter guards (rules FF1-FF5, source order)", () => {
  it("FF1_EMPTY_EVENT on empty/blank events", () => {
    for (const event of ["", "   "]) {
      expectGuard(
        () => new FrequencyFilter({ event, value: 5 }),
        "FF1_EMPTY_EVENT",
      );
    }
  });

  it("FF2_INVALID_OPERATOR on unknown operators", () => {
    for (const operator of ["invalid_op", "bogus", "at least"]) {
      expectGuard(
        () =>
          new FrequencyFilter({
            event: "Login",
            value: 5,
            operator: operator as FrequencyFilterOperator,
          }),
        "FF2_INVALID_OPERATOR",
      );
    }
  });

  it("FF2: all valid operators are accepted", () => {
    for (const operator of VALID_FREQUENCY_FILTER_OPERATORS) {
      const filter = new FrequencyFilter({
        event: "Login",
        value: 5,
        operator: operator as FrequencyFilterOperator,
      });
      expect(filter.operator).toBe(operator);
    }
  });

  it("FF3_VALUE_NEGATIVE on negative values; zero is valid", () => {
    for (const value of [-1, -0.5]) {
      expectGuard(
        () => new FrequencyFilter({ event: "Login", value }),
        "FF3_VALUE_NEGATIVE",
      );
    }
    expect(new FrequencyFilter({ event: "Login", value: 0 }).value).toBe(0);
  });

  it("FF4_DATE_RANGE_PAIR when only one of value/unit is set", () => {
    expectGuard(
      () =>
        new FrequencyFilter({ event: "Login", value: 5, date_range_value: 30 }),
      "FF4_DATE_RANGE_PAIR",
    );
    expectGuard(
      () =>
        new FrequencyFilter({
          event: "Login",
          value: 5,
          date_range_unit: "day",
        }),
      "FF4_DATE_RANGE_PAIR",
    );
    // Both-None and both-set are valid.
    const bothNone = new FrequencyFilter({ event: "Login", value: 5 });
    expect(bothNone.date_range_value).toBeNull();
    expect(bothNone.date_range_unit).toBeNull();
    const bothSet = new FrequencyFilter({
      event: "Login",
      value: 5,
      date_range_value: 30,
      date_range_unit: "day",
    });
    expect(bothSet.date_range_value).toBe(30);
    expect(bothSet.date_range_unit).toBe("day");
  });

  it("FF5_DATE_RANGE_VALUE_NOT_POSITIVE on zero/negative window sizes", () => {
    for (const dateRangeValue of [0, -3, -7]) {
      expectGuard(
        () =>
          new FrequencyFilter({
            event: "Login",
            value: 5,
            date_range_value: dateRangeValue,
            date_range_unit: "week",
          }),
        "FF5_DATE_RANGE_VALUE_NOT_POSITIVE",
      );
    }
  });

  it("guard order: FF1 -> FF2 -> FF3 -> FF4 -> FF5 (first failing wins)", () => {
    expectGuard(
      () =>
        new FrequencyFilter({
          event: " ",
          value: -1,
          operator: "bogus" as FrequencyFilterOperator,
        }),
      "FF1_EMPTY_EVENT",
    );
    expectGuard(
      () =>
        new FrequencyFilter({
          event: "Login",
          value: -1,
          operator: "bogus" as FrequencyFilterOperator,
        }),
      "FF2_INVALID_OPERATOR",
    );
    expectGuard(
      () =>
        new FrequencyFilter({
          event: "Login",
          value: -1,
          date_range_value: 30,
        }),
      "FF3_VALUE_NEGATIVE",
    );
    expectGuard(
      () =>
        new FrequencyFilter({
          event: "Login",
          value: 5,
          date_range_value: 0,
        }),
      "FF4_DATE_RANGE_PAIR",
    );
  });
});

describe("C9 guard-totality property (fast-check #4)", () => {
  it("unknown operators always raise the FF2 registry code", () => {
    fc.assert(
      fc.property(
        fc
          .string()
          .filter((value) => !VALID_FREQUENCY_FILTER_OPERATORS.has(value)),
        (operator) => {
          try {
            new FrequencyFilter({
              event: "Login",
              value: 5,
              operator: operator as FrequencyFilterOperator,
            });
            return false;
          } catch (cause) {
            return (
              cause instanceof ParamValidationError &&
              cause.code === "FF2_INVALID_OPERATOR"
            );
          }
        },
      ),
    );
  });

  it("negative values always raise the FF3 registry code", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: -1e-6, noNaN: true }),
        (value) => {
          try {
            new FrequencyFilter({ event: "Login", value });
            return false;
          } catch (cause) {
            return (
              cause instanceof ParamValidationError &&
              cause.code === "FF3_VALUE_NEGATIVE"
            );
          }
        },
      ),
    );
  });
});
