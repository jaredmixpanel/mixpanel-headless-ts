import { describe, expect, it } from "vitest";

import {
  CohortCriteria,
  FILTER_TO_SELECTOR_SUPPORTED,
  PROPERTY_OPERATOR_MAP,
} from "../../../src/types/query-params/cohort.js";
import { Filter } from "../../../src/types/query-params/filter.js";
import { expectGuard } from "../../../test-support/raises.js";

/** Read a nested plain-object path from a serialized cohort payload. */
function at(value: unknown, ...path: Array<string | number>): unknown {
  let cursor: unknown = value;
  for (const key of path) {
    cursor = (cursor as Record<string | number, unknown>)[key];
  }
  return cursor;
}

describe("operator maps", () => {
  // python: TestOperatorMaps
  it("PROPERTY_OPERATOR_MAP maps all expected CohortCriteria operators", () => {
    expect(Object.fromEntries(PROPERTY_OPERATOR_MAP)).toStrictEqual({
      equals: "==",
      not_equals: "!=",
      contains: "in",
      not_contains: "not in",
      greater_than: ">",
      less_than: "<",
      is_set: "defined",
      is_not_set: "not defined",
    });
  });

  it("FILTER_TO_SELECTOR_SUPPORTED contains all expected Filter._operator strings", () => {
    expect(new Set(FILTER_TO_SELECTOR_SUPPORTED)).toStrictEqual(
      new Set([
        "equals",
        "does not equal",
        "contains",
        "does not contain",
        "is greater than",
        "is less than",
        "is set",
        "is not set",
        "is between",
      ]),
    );
  });
});

describe("CohortCriteria.didEvent shapes", () => {
  it("at_least + within_days produces correct selector and behavior", () => {
    const c = CohortCriteria.didEvent("Purchase", {
      at_least: 3,
      within_days: 30,
    });
    expect(c._selector_node["property"]).toBe("behaviors");
    expect(c._selector_node["operator"]).toBe(">=");
    expect(c._selector_node["operand"]).toBe(3);
    expect(c._behavior_key).not.toBeNull();
    expect(c._behavior).not.toBeNull();
    expect(at(c._behavior, "count", "event_selector", "event")).toBe(
      "Purchase",
    );
    expect(at(c._behavior, "count", "event_selector", "selector")).toBeNull();
    expect(at(c._behavior, "count", "type")).toBe("absolute");
    expect(at(c._behavior, "window")).toStrictEqual({ unit: "day", value: 30 });
  });

  it("at_most maps to <= and exactly maps to ==", () => {
    const atMost = CohortCriteria.didEvent("Login", {
      at_most: 5,
      within_days: 7,
    });
    expect(atMost._selector_node["operator"]).toBe("<=");
    expect(atMost._selector_node["operand"]).toBe(5);
    const exactly = CohortCriteria.didEvent("Signup", {
      exactly: 1,
      within_days: 14,
    });
    expect(exactly._selector_node["operator"]).toBe("==");
    expect(exactly._selector_node["operand"]).toBe(1);
  });

  it("within_weeks / within_months use week / month units", () => {
    const weeks = CohortCriteria.didEvent("Purchase", {
      at_least: 1,
      within_weeks: 4,
    });
    expect(at(weeks._behavior, "window")).toStrictEqual({
      unit: "week",
      value: 4,
    });
    const months = CohortCriteria.didEvent("Purchase", {
      at_least: 1,
      within_months: 3,
    });
    expect(at(months._behavior, "window")).toStrictEqual({
      unit: "month",
      value: 3,
    });
  });

  it("absolute date range stores from_date/to_date and no window", () => {
    const c = CohortCriteria.didEvent("Purchase", {
      at_least: 1,
      from_date: "2024-01-01",
      to_date: "2024-03-31",
    });
    expect(c._behavior).not.toBeNull();
    expect(Object.keys(c._behavior ?? {})).not.toContain("window");
    expect(at(c._behavior, "from_date")).toBe("2024-01-01");
    expect(at(c._behavior, "to_date")).toBe("2024-03-31");
  });

  it("single where filter builds an Insights bookmark filter node", () => {
    const c = CohortCriteria.didEvent("Purchase", {
      at_least: 1,
      within_days: 30,
      where: Filter.equals("plan", "premium"),
    });
    const selector = at(c._behavior, "count", "event_selector", "selector");
    expect(selector).not.toBeNull();
    expect(at(selector, "operator")).toBe("and");
    const children = at(selector, "children") as unknown[];
    expect(children).toHaveLength(1);
    const child = children[0] as Record<string, unknown>;
    expect(child["resourceType"]).toBe("events");
    expect(child["value"]).toBe("plan");
    expect(child["filterOperator"]).toBe("equals");
    expect(child["filterValue"]).toStrictEqual(["premium"]);
    expect(child["filterType"]).toBe("string");
    expect(child["defaultType"]).toBe("string");
  });

  it("multiple where filters produce AND-combined children", () => {
    const c = CohortCriteria.didEvent("Purchase", {
      at_least: 1,
      within_days: 30,
      where: [
        Filter.equals("plan", "premium"),
        Filter.greaterThan("amount", 100),
      ],
    });
    const selector = at(c._behavior, "count", "event_selector", "selector");
    expect(at(selector, "operator")).toBe("and");
    const children = at(selector, "children") as Array<Record<string, unknown>>;
    expect(children).toHaveLength(2);
    expect(children[0]?.["value"]).toBe("plan");
    expect(children[0]?.["filterOperator"]).toBe("equals");
    expect(children[1]?.["value"]).toBe("amount");
    expect(children[1]?.["filterOperator"]).toBe("is greater than");
    expect(children[1]?.["filterValue"]).toBe(100);
    expect(children[1]?.["filterType"]).toBe("number");
  });

  it("exactly=0 is valid (the didNotDoEvent form)", () => {
    const c = CohortCriteria.didEvent("Login", {
      exactly: 0,
      within_days: 30,
    });
    expect(c._selector_node["operator"]).toBe("==");
    expect(c._selector_node["operand"]).toBe(0);
  });

  it("where=[] is treated as no filter (selector stays null)", () => {
    const noFilter = CohortCriteria.didEvent("Login", {
      at_least: 1,
      within_days: 30,
    });
    const empty = CohortCriteria.didEvent("Login", {
      at_least: 1,
      within_days: 30,
      where: [],
    });
    expect(
      at(noFilter._behavior, "count", "event_selector", "selector"),
    ).toBeNull();
    expect(
      at(empty._behavior, "count", "event_selector", "selector"),
    ).toBeNull();
  });
});

describe("CohortCriteria.didEvent guards (source order)", () => {
  it("CD1_FREQUENCY_PARAM_REQUIRED on conflicting or missing frequency", () => {
    expectGuard(
      () =>
        CohortCriteria.didEvent("Login", {
          at_least: 1,
          at_most: 5,
          within_days: 30,
        }),
      "CD1_FREQUENCY_PARAM_REQUIRED",
    );
    expectGuard(
      () => CohortCriteria.didEvent("Login", { within_days: 30 }),
      "CD1_FREQUENCY_PARAM_REQUIRED",
    );
  });

  it("CD2_FREQUENCY_NEGATIVE on negative frequency", () => {
    expectGuard(
      () => CohortCriteria.didEvent("Login", { at_least: -1, within_days: 30 }),
      "CD2_FREQUENCY_NEGATIVE",
    );
  });

  it("CD3_TIME_CONSTRAINT_REQUIRED on missing/conflicting time constraints", () => {
    expectGuard(
      () => CohortCriteria.didEvent("Login", { at_least: 1 }),
      "CD3_TIME_CONSTRAINT_REQUIRED",
    );
    expectGuard(
      () =>
        CohortCriteria.didEvent("Login", {
          at_least: 1,
          within_days: 30,
          from_date: "2024-01-01",
          to_date: "2024-03-31",
        }),
      "CD3_TIME_CONSTRAINT_REQUIRED",
    );
    expectGuard(
      () =>
        CohortCriteria.didEvent("Login", {
          at_least: 1,
          within_days: 30,
          within_weeks: 4,
        }),
      "CD3_TIME_CONSTRAINT_REQUIRED",
    );
  });

  it("CD3_WINDOW_NOT_POSITIVE on non-positive rolling windows", () => {
    for (const options of [
      { within_days: 0 },
      { within_days: -5 },
      { within_weeks: 0 },
      { within_months: -1 },
    ]) {
      expectGuard(
        () => CohortCriteria.didEvent("Login", { at_least: 1, ...options }),
        "CD3_WINDOW_NOT_POSITIVE",
      );
    }
  });

  it("CD4_EMPTY_EVENT on empty/blank event names", () => {
    expectGuard(
      () => CohortCriteria.didEvent("", { at_least: 1, within_days: 30 }),
      "CD4_EMPTY_EVENT",
    );
    expectGuard(
      () =>
        CohortCriteria.didEvent(" ".repeat(3), {
          at_least: 1,
          within_days: 30,
        }),
      "CD4_EMPTY_EVENT",
    );
  });

  it("CD5 pair guards on one-sided date ranges", () => {
    expectGuard(
      () =>
        CohortCriteria.didEvent("Login", {
          at_least: 1,
          from_date: "2024-01-01",
        }),
      "CD5_FROM_REQUIRES_TO",
    );
    expectGuard(
      () =>
        CohortCriteria.didEvent("Login", {
          at_least: 1,
          to_date: "2024-03-31",
        }),
      "CD5_TO_REQUIRES_FROM",
    );
  });

  it("CD6 date guards: format, calendar validity, order", () => {
    expectGuard(
      () =>
        CohortCriteria.didEvent("Login", {
          at_least: 1,
          from_date: "01-01-2024",
          to_date: "03-31-2024",
        }),
      "CD6_DATE_FORMAT",
    );
    expectGuard(
      () =>
        CohortCriteria.didEvent("Login", {
          at_least: 1,
          from_date: "2024-02-30",
          to_date: "2024-03-01",
        }),
      "CD6_DATE_INVALID",
    );
    expectGuard(
      () =>
        CohortCriteria.didEvent("Login", {
          at_least: 1,
          from_date: "2024-03-31",
          to_date: "2024-01-01",
        }),
      "CD6_DATE_ORDER",
    );
  });

  it("CD10_UNSUPPORTED_FILTER_OPERATOR on unsupported where operators", () => {
    expectGuard(
      () =>
        CohortCriteria.didEvent("Login", {
          at_least: 1,
          within_days: 30,
          where: Filter.isTrue("flag"),
        }),
      "CD10_UNSUPPORTED_FILTER_OPERATOR",
    );
  });

  it("CA1/CA2 aggregation pair guards", () => {
    expectGuard(
      () =>
        CohortCriteria.didEvent("Purchase", {
          aggregation: "average",
          at_least: 50,
          within_days: 30,
        }),
      "CA1_AGGREGATION_PAIR",
    );
    expectGuard(
      () =>
        CohortCriteria.didEvent("Purchase", {
          aggregation_property: "amount",
          at_least: 50,
          within_days: 30,
        }),
      "CA1_AGGREGATION_PAIR",
    );
    expectGuard(
      () =>
        CohortCriteria.didEvent("Purchase", {
          aggregation: "average",
          aggregation_property: " ".repeat(3),
          at_least: 50,
          within_days: 30,
        }),
      "CA2_EMPTY_AGGREGATION_PROPERTY",
    );
  });

  it("guard order (Risk #1): CD4 -> CA1 -> CD1 -> CD2 -> CD3 -> CD10 -> CD5/CD6", () => {
    // Empty event wins over everything else.
    expectGuard(() => CohortCriteria.didEvent("", {}), "CD4_EMPTY_EVENT");
    // Broken aggregation pair wins over the missing frequency param.
    expectGuard(
      () => CohortCriteria.didEvent("Login", { aggregation: "average" }),
      "CA1_AGGREGATION_PAIR",
    );
    // Missing frequency wins over the missing time constraint.
    expectGuard(
      () => CohortCriteria.didEvent("Login", {}),
      "CD1_FREQUENCY_PARAM_REQUIRED",
    );
    // Negative frequency wins over the missing time constraint.
    expectGuard(
      () => CohortCriteria.didEvent("Login", { at_least: -1 }),
      "CD2_FREQUENCY_NEGATIVE",
    );
    // Missing time constraint wins over the unsupported where operator.
    expectGuard(
      () =>
        CohortCriteria.didEvent("Login", {
          at_least: 1,
          where: Filter.isTrue("flag"),
        }),
      "CD3_TIME_CONSTRAINT_REQUIRED",
    );
    // The unsupported where operator wins over the window guard...
    expectGuard(
      () =>
        CohortCriteria.didEvent("Login", {
          at_least: 1,
          within_days: 0,
          where: Filter.isTrue("flag"),
        }),
      "CD10_UNSUPPORTED_FILTER_OPERATOR",
    );
    // ...and over the one-sided date-range guard.
    expectGuard(
      () =>
        CohortCriteria.didEvent("Login", {
          at_least: 1,
          from_date: "01-01-2024",
          where: Filter.isTrue("flag"),
        }),
      "CD10_UNSUPPORTED_FILTER_OPERATOR",
    );
    // from_date is validated before to_date.
    expectGuard(
      () =>
        CohortCriteria.didEvent("Login", {
          at_least: 1,
          from_date: "bad",
          to_date: "also-bad",
        }),
      "CD6_DATE_FORMAT",
    );
  });
});

describe("CohortCriteria.didNotDoEvent", () => {
  it("is equivalent to didEvent(exactly: 0) for every time-constraint form", () => {
    for (const options of [
      { within_days: 30 },
      { within_weeks: 4 },
      { within_months: 3 },
      { from_date: "2024-01-01", to_date: "2024-03-31" },
    ]) {
      const a = CohortCriteria.didNotDoEvent("Login", options);
      const b = CohortCriteria.didEvent("Login", { exactly: 0, ...options });
      expect(a._selector_node).toStrictEqual(b._selector_node);
      expect(a._behavior).toStrictEqual(b._behavior);
    }
  });

  it("propagates the didEvent guard codes", () => {
    expectGuard(() => CohortCriteria.didNotDoEvent(""), "CD4_EMPTY_EVENT");
    expectGuard(
      () => CohortCriteria.didNotDoEvent("Login"),
      "CD3_TIME_CONSTRAINT_REQUIRED",
    );
    expectGuard(
      () => CohortCriteria.didNotDoEvent("Login", { within_days: 0 }),
      "CD3_WINDOW_NOT_POSITIVE",
    );
  });
});

describe("CohortCriteria.hasProperty / propertyIsSet / propertyIsNotSet", () => {
  it("default operator produces an equals selector node", () => {
    const c = CohortCriteria.hasProperty("plan", "premium");
    expect(c._selector_node["property"]).toBe("user");
    expect(c._selector_node["value"]).toBe("plan");
    expect(c._selector_node["operator"]).toBe("==");
    expect(c._selector_node["operand"]).toBe("premium");
    expect(c._selector_node["type"]).toBe("string");
    expect(c._behavior_key).toBeNull();
    expect(c._behavior).toBeNull();
  });

  it("maps every operator via PROPERTY_OPERATOR_MAP", () => {
    const cases = [
      ["equals", "=="],
      ["not_equals", "!="],
      ["contains", "in"],
      ["not_contains", "not in"],
      ["greater_than", ">"],
      ["less_than", "<"],
    ] as const;
    for (const [operator, expected] of cases) {
      const c = CohortCriteria.hasProperty("age", 25, { operator });
      expect(c._selector_node["operator"]).toBe(expected);
    }
  });

  it("property_type='number' sets the type field", () => {
    const c = CohortCriteria.hasProperty("age", 25, {
      operator: "greater_than",
      property_type: "number",
    });
    expect(c._selector_node["type"]).toBe("number");
  });

  it("propertyIsSet / propertyIsNotSet produce defined operators", () => {
    const set = CohortCriteria.propertyIsSet("email");
    expect(set._selector_node["property"]).toBe("user");
    expect(set._selector_node["value"]).toBe("email");
    expect(set._selector_node["operator"]).toBe("defined");
    expect(set._behavior_key).toBeNull();
    expect(set._behavior).toBeNull();
    expect(
      CohortCriteria.propertyIsNotSet("phone")._selector_node["operator"],
    ).toBe("not defined");
  });

  it("CD7_EMPTY_PROPERTY on empty/blank property names (all three factories)", () => {
    expectGuard(
      () => CohortCriteria.hasProperty("", "value"),
      "CD7_EMPTY_PROPERTY",
    );
    expectGuard(
      () => CohortCriteria.hasProperty(" ".repeat(3), "value"),
      "CD7_EMPTY_PROPERTY",
    );
    expectGuard(() => CohortCriteria.propertyIsSet(""), "CD7_EMPTY_PROPERTY");
    expectGuard(
      () => CohortCriteria.propertyIsNotSet(" ".repeat(3)),
      "CD7_EMPTY_PROPERTY",
    );
  });
});

describe("CohortCriteria.inCohort / notInCohort", () => {
  it("produce cohort reference selector nodes", () => {
    const inC = CohortCriteria.inCohort(456);
    expect(inC._selector_node).toStrictEqual({
      property: "cohort",
      value: 456,
      operator: "in",
    });
    expect(inC._behavior_key).toBeNull();
    expect(inC._behavior).toBeNull();
    const notIn = CohortCriteria.notInCohort(456);
    expect(notIn._selector_node).toStrictEqual({
      property: "cohort",
      value: 456,
      operator: "not in",
    });
    expect(notIn._behavior_key).toBeNull();
    expect(notIn._behavior).toBeNull();
  });

  it("CD8_COHORT_ID_NOT_POSITIVE on zero/negative ids", () => {
    expectGuard(() => CohortCriteria.inCohort(0), "CD8_COHORT_ID_NOT_POSITIVE");
    expectGuard(
      () => CohortCriteria.inCohort(-1),
      "CD8_COHORT_ID_NOT_POSITIVE",
    );
    expectGuard(
      () => CohortCriteria.notInCohort(0),
      "CD8_COHORT_ID_NOT_POSITIVE",
    );
  });
});

describe("CohortCriteria aggregation serialization", () => {
  it("includes aggregationOperator and property when both are set", () => {
    for (const aggregation of [
      "total",
      "unique",
      "average",
      "min",
      "max",
      "median",
    ] as const) {
      const c = CohortCriteria.didEvent("Purchase", {
        aggregation,
        aggregation_property: "amount",
        at_least: 1,
        within_days: 30,
      });
      expect(at(c._behavior, "count", "aggregationOperator")).toBe(aggregation);
      expect(at(c._behavior, "count", "property")).toBe("amount");
    }
  });

  it("omits aggregation keys when not set", () => {
    const c = CohortCriteria.didEvent("Purchase", {
      at_least: 1,
      within_days: 30,
    });
    const count = at(c._behavior, "count") as Record<string, unknown>;
    expect(Object.keys(count)).not.toContain("aggregationOperator");
    expect(Object.keys(count)).not.toContain("property");
  });
});

describe("CohortCriteria.hasProperty unknown-operator parity (P2-9 gate finding)", () => {
  it("raises KeyError-by-name for operators outside the map", () => {
    // Python: `_PROPERTY_OPERATOR_MAP[operator]` raises a bare KeyError
    // (uncoded, R5.5); the pre-fix port silently constructed with an
    // `undefined` selector operator — a real cross-language divergence
    // found by the P2-9 differential gate. Class NAME is the comparison
    // key (oracle-protocol.md §4.1 bare-class encoding).
    let thrown: unknown;
    try {
      CohortCriteria.hasProperty("plan", "premium", {
        operator: "junk" as never,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("KeyError");
    expect((thrown as Error).constructor.name).toBe("KeyError");
  });

  it("fires AFTER the CD7 empty-property guard (Python check order)", () => {
    // types.py ~8952: CD7 raises first; the map lookup comes second.
    let thrown: unknown;
    try {
      CohortCriteria.hasProperty("", "premium", { operator: "junk" as never });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { code?: string }).code).toBe("CD7_EMPTY_PROPERTY");
  });
});
