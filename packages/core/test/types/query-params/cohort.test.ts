// Guard + factory + serialization tests for the cohort family
// (phase2-design C7, packet P2-5b): translated assertion-for-assertion
// from tests/unit/test_cohort_definition.py and the CohortBreakdown /
// _sanitize_raw_cohort suites in tests/test_types_cohort_behaviors.py,
// plus Risk #1 guard-order probes and C9 fast-check guard-totality
// properties. (The Python frozen-dataclass immutability tests have no
// TS runtime analog — `readonly` is the compile-time equivalent — and
// the CreateCohortParams CRUD-integration tests belong to P2-7.)
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  type MixpanelHeadlessError,
  ParamValidationError,
} from "../../../src/errors.js";
import {
  buildEventSelector,
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  FILTER_TO_SELECTOR_SUPPORTED,
  PROPERTY_OPERATOR_MAP,
  sanitizeRawCohort,
} from "../../../src/types/query-params/cohort.js";
import { Filter } from "../../../src/types/query-params/filter.js";

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

/** Read a nested plain-object path from a serialized cohort payload. */
function at(value: unknown, ...path: Array<string | number>): unknown {
  let cursor: unknown = value;
  for (const key of path) {
    cursor = (cursor as Record<string | number, unknown>)[key];
  }
  return cursor;
}

describe("operator maps (test_cohort_definition.py::TestOperatorMaps)", () => {
  it("PROPERTY_OPERATOR_MAP maps all expected CohortCriteria operators", () => {
    expect(Object.fromEntries(PROPERTY_OPERATOR_MAP)).toEqual({
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
    expect(new Set(FILTER_TO_SELECTOR_SUPPORTED)).toEqual(
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
    expect(at(c._behavior, "window")).toEqual({ unit: "day", value: 30 });
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
    expect(at(weeks._behavior, "window")).toEqual({ unit: "week", value: 4 });
    const months = CohortCriteria.didEvent("Purchase", {
      at_least: 1,
      within_months: 3,
    });
    expect(at(months._behavior, "window")).toEqual({
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
    expect(child["filterValue"]).toEqual(["premium"]);
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
      expect(a._selector_node).toEqual(b._selector_node);
      expect(a._behavior).toEqual(b._behavior);
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
    expect(inC._selector_node).toEqual({
      property: "cohort",
      value: 456,
      operator: "in",
    });
    expect(inC._behavior_key).toBeNull();
    expect(inC._behavior).toBeNull();
    const notIn = CohortCriteria.notInCohort(456);
    expect(notIn._selector_node).toEqual({
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

describe("CohortDefinition composition + toDict", () => {
  it("constructor stores criteria with the AND combinator", () => {
    const c = CohortCriteria.didEvent("Login", {
      at_least: 1,
      within_days: 30,
    });
    const d = new CohortDefinition(c);
    expect(d._criteria).toEqual([c]);
    expect(d._operator).toBe("and");
  });

  it("toDict produces selector + behaviors with a combinator root", () => {
    const d = new CohortDefinition(
      CohortCriteria.didEvent("Login", { at_least: 1, within_days: 30 }),
    );
    const result = d.toDict();
    expect(Object.keys(result)).toEqual(["selector", "behaviors"]);
    expect(at(result, "selector", "operator")).toBe("and");
    expect(at(result, "selector", "children")).toHaveLength(1);
  });

  it("allOf collects unique behavior keys referenced by the selector", () => {
    const d = CohortDefinition.allOf(
      CohortCriteria.didEvent("Login", { at_least: 1, within_days: 7 }),
      CohortCriteria.didEvent("Purchase", { at_least: 3, within_days: 30 }),
    );
    const result = d.toDict();
    expect(at(result, "selector", "operator")).toBe("and");
    const behaviors = result["behaviors"] as Record<string, unknown>;
    expect(Object.keys(behaviors)).toEqual(["bhvr_0", "bhvr_1"]);
    const children = at(result, "selector", "children") as Array<
      Record<string, unknown>
    >;
    expect(new Set(children.map((child) => child["value"]))).toEqual(
      new Set(Object.keys(behaviors)),
    );
  });

  it("anyOf uses the OR operator", () => {
    const d = CohortDefinition.anyOf(
      CohortCriteria.didEvent("Login", { at_least: 1, within_days: 7 }),
      CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
    );
    expect(d._operator).toBe("or");
    expect(at(d.toDict(), "selector", "operator")).toBe("or");
  });

  it("nesting: anyOf(allOf(A, B), C) re-indexes behaviors globally", () => {
    const nested = CohortDefinition.anyOf(
      CohortDefinition.allOf(
        CohortCriteria.didEvent("Login", { at_least: 1, within_days: 7 }),
        CohortCriteria.didEvent("Purchase", { at_least: 3, within_days: 30 }),
      ),
      CohortCriteria.didEvent("Signup", { at_least: 1, within_days: 14 }),
    );
    const result = nested.toDict();
    expect(at(result, "selector", "operator")).toBe("or");
    const children = at(result, "selector", "children") as Array<
      Record<string, unknown>
    >;
    expect(children).toHaveLength(2);
    expect(children[0]?.["operator"]).toBe("and");
    expect(children[0]?.["children"]).toHaveLength(2);
    expect(children[1]?.["property"]).toBe("behaviors");
    expect(Object.keys(result["behaviors"] as object)).toEqual([
      "bhvr_0",
      "bhvr_1",
      "bhvr_2",
    ]);
  });

  it("three levels of nesting keep behavior keys unique", () => {
    const make = (event: string): CohortCriteria =>
      CohortCriteria.didEvent(event, { at_least: 1, within_days: 7 });
    const deep = CohortDefinition.anyOf(
      CohortDefinition.allOf(
        CohortDefinition.anyOf(make("A"), make("B")),
        make("C"),
      ),
      make("D"),
    );
    const keys = Object.keys(deep.toDict()["behaviors"] as object).sort();
    expect(keys).toEqual(["bhvr_0", "bhvr_1", "bhvr_2", "bhvr_3"]);
  });

  it("CD9_EMPTY_CRITERIA at all three construction sites", () => {
    expectGuard(() => new CohortDefinition(), "CD9_EMPTY_CRITERIA");
    expectGuard(() => CohortDefinition.allOf(), "CD9_EMPTY_CRITERIA");
    expectGuard(() => CohortDefinition.anyOf(), "CD9_EMPTY_CRITERIA");
  });

  it("property-only definitions have empty behaviors", () => {
    const d = CohortDefinition.allOf(
      CohortCriteria.hasProperty("plan", "premium"),
      CohortCriteria.propertyIsSet("email"),
    );
    const result = d.toDict();
    expect(result["behaviors"]).toEqual({});
    expect(at(result, "selector", "operator")).toBe("and");
    expect(at(result, "selector", "children")).toHaveLength(2);
  });

  it("cohort-reference definitions have empty behaviors", () => {
    const result = new CohortDefinition(CohortCriteria.inCohort(456)).toDict();
    expect(result["behaviors"]).toEqual({});
    expect(at(result, "selector", "children", 0)).toEqual({
      property: "cohort",
      value: 456,
      operator: "in",
    });
  });

  it("mixed criteria: only behavioral criteria collect behaviors", () => {
    const d = CohortDefinition.allOf(
      CohortCriteria.hasProperty("plan", "premium"),
      CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
      CohortCriteria.inCohort(456),
    );
    const result = d.toDict();
    expect(Object.keys(result["behaviors"] as object)).toHaveLength(1);
    const children = at(result, "selector", "children") as Array<
      Record<string, unknown>
    >;
    expect(children).toHaveLength(3);
    expect(children[0]?.["property"]).toBe("user");
    expect(children[1]?.["property"]).toBe("behaviors");
    expect(children[1]?.["value"]).toBe("bhvr_0");
  });
});

describe("toDict isolation (deep-copy semantics)", () => {
  it("mutating the output does not corrupt the criterion", () => {
    const c = CohortCriteria.didEvent("Login", {
      at_least: 1,
      within_days: 30,
    });
    const result = new CohortDefinition(c).toDict();
    (at(result, "behaviors", "bhvr_0", "window") as Record<string, unknown>)[
      "value"
    ] = 999;
    expect(at(c._behavior, "window", "value")).toBe(30);
  });

  it("successive toDict calls are independent", () => {
    const d = new CohortDefinition(
      CohortCriteria.didEvent("Login", { at_least: 1, within_days: 30 }),
    );
    const r1 = d.toDict();
    const r2 = d.toDict();
    (at(r1, "behaviors", "bhvr_0", "window") as Record<string, unknown>)[
      "value"
    ] = 888;
    expect(at(r2, "behaviors", "bhvr_0", "window", "value")).toBe(30);
  });

  it("the same criterion used twice gets independent behavior copies", () => {
    const c = CohortCriteria.didEvent("Login", {
      at_least: 1,
      within_days: 30,
    });
    const result = CohortDefinition.allOf(c, c).toDict();
    (at(result, "behaviors", "bhvr_0", "window") as Record<string, unknown>)[
      "value"
    ] = 777;
    expect(at(result, "behaviors", "bhvr_1", "window", "value")).toBe(30);
  });

  it("mutable list operands are not leaked", () => {
    const c = CohortCriteria.hasProperty("tags", ["premium", "active"]);
    const result = new CohortDefinition(c).toDict();
    (at(result, "selector", "children", 0, "operand") as string[]).push(
      "CORRUPTED",
    );
    expect(c._selector_node["operand"]).toEqual(["premium", "active"]);
  });
});

describe("sanitizeRawCohort (tests/test_types_cohort_behaviors.py::TestSanitizeRawCohort)", () => {
  it("removes a null selector from event_selector", () => {
    const raw = {
      behaviors: {
        b1: { count: { event_selector: { selector: null, event: "Login" } } },
      },
    };
    const result = sanitizeRawCohort(raw);
    const es = at(
      result,
      "behaviors",
      "b1",
      "count",
      "event_selector",
    ) as Record<string, unknown>;
    expect(Object.keys(es)).not.toContain("selector");
    expect(es["event"]).toBe("Login");
  });

  it("preserves a non-null selector", () => {
    const raw = {
      behaviors: {
        b1: {
          count: {
            event_selector: {
              selector: { type: "and", children: [] },
              event: "Login",
            },
          },
        },
      },
    };
    expect(
      at(
        sanitizeRawCohort(raw),
        "behaviors",
        "b1",
        "count",
        "event_selector",
        "selector",
      ),
    ).toEqual({ type: "and", children: [] });
  });

  it("returns an independent copy when behaviors is absent", () => {
    const raw = { name: "Test", version: 1 };
    const result = sanitizeRawCohort(raw);
    expect(result).toEqual(raw);
    expect(result).not.toBe(raw);
  });

  it("only removes the null selectors among mixed behaviors", () => {
    const raw = {
      behaviors: {
        b1: { count: { event_selector: { selector: null, event: "A" } } },
        b2: {
          count: { event_selector: { selector: { type: "or" }, event: "B" } },
        },
      },
    };
    const result = sanitizeRawCohort(raw);
    expect(
      Object.keys(
        at(result, "behaviors", "b1", "count", "event_selector") as object,
      ),
    ).not.toContain("selector");
    expect(
      at(result, "behaviors", "b2", "count", "event_selector", "selector"),
    ).toEqual({ type: "or" });
  });

  it("never mutates the input (deep-copy semantics)", () => {
    const raw = {
      behaviors: {
        b1: { count: { event_selector: { selector: null, event: "X" } } },
      },
    };
    sanitizeRawCohort(raw);
    expect(
      at(raw, "behaviors", "b1", "count", "event_selector", "selector"),
    ).toBeNull();
  });
});

describe("CohortBreakdown (tests/test_types_cohort_behaviors.py)", () => {
  it("stores fields with Python defaults", () => {
    const named = new CohortBreakdown({ cohort: 123, name: "Power Users" });
    expect(named.cohort).toBe(123);
    expect(named.name).toBe("Power Users");
    expect(named.include_negated).toBe(true);
    const bare = new CohortBreakdown({ cohort: 123 });
    expect(bare.name).toBeNull();
    expect(bare.include_negated).toBe(true);
    expect(
      new CohortBreakdown({ cohort: 123, name: "PU", include_negated: false })
        .include_negated,
    ).toBe(false);
  });

  it("accepts an inline CohortDefinition (skips the positive-int check)", () => {
    const definition = new CohortDefinition(
      CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
    );
    const cb = new CohortBreakdown({ cohort: definition, name: "Active" });
    expect(cb.cohort).toBe(definition);
    expect(cb.name).toBe("Active");
    expect(new CohortBreakdown({ cohort: definition }).cohort).toBe(definition);
  });

  it("CB1_COHORT_ID_NOT_POSITIVE / CB2_COHORT_NAME_EMPTY guards", () => {
    expectGuard(
      () => new CohortBreakdown({ cohort: 0, name: "Bad" }),
      "CB1_COHORT_ID_NOT_POSITIVE",
    );
    expectGuard(
      () => new CohortBreakdown({ cohort: -10, name: "Bad" }),
      "CB1_COHORT_ID_NOT_POSITIVE",
    );
    expectGuard(
      () => new CohortBreakdown({ cohort: 123, name: "" }),
      "CB2_COHORT_NAME_EMPTY",
    );
    expectGuard(
      () => new CohortBreakdown({ cohort: 123, name: "   \t  " }),
      "CB2_COHORT_NAME_EMPTY",
    );
    expect(new CohortBreakdown({ cohort: 1 }).cohort).toBe(1);
  });

  it("guard order (Risk #1): CB1 fires before CB2", () => {
    expectGuard(
      () => new CohortBreakdown({ cohort: 0, name: "" }),
      "CB1_COHORT_ID_NOT_POSITIVE",
    );
  });
});

describe("buildEventSelector edge behavior", () => {
  it("accepts a single Filter (auto-wrapped in a list)", () => {
    const tree = buildEventSelector(Filter.equals("plan", "premium"));
    expect(tree["operator"]).toBe("and");
    expect(tree["children"]).toHaveLength(1);
  });

  it("emits every supported operator verbatim", () => {
    const filters = [
      Filter.equals("p", "v"),
      Filter.notEquals("p", "v"),
      Filter.contains("p", "v"),
      Filter.notContains("p", "v"),
      Filter.greaterThan("p", 1),
      Filter.lessThan("p", 1),
      Filter.isSet("p"),
      Filter.isNotSet("p"),
      Filter.between("p", 1, 2),
    ];
    const tree = buildEventSelector(filters);
    const children = tree["children"] as Array<Record<string, unknown>>;
    expect(children.map((child) => child["filterOperator"])).toEqual([
      "equals",
      "does not equal",
      "contains",
      "does not contain",
      "is greater than",
      "is less than",
      "is set",
      "is not set",
      "is between",
    ]);
  });
});

describe("C9 guard-totality property (fast-check #4)", () => {
  it("blank properties always raise CD7 across the property factories", () => {
    const blank = fc
      .array(fc.constantFrom(" ", "\t", "\n"), { maxLength: 6 })
      .map((chars) => chars.join(""));
    const factory = fc.constantFrom<(property: string) => CohortCriteria>(
      (property) => CohortCriteria.hasProperty(property, "v"),
      (property) => CohortCriteria.propertyIsSet(property),
      (property) => CohortCriteria.propertyIsNotSet(property),
    );
    fc.assert(
      fc.property(blank, factory, (property, make) => {
        try {
          make(property);
          return false;
        } catch (error) {
          return (
            error instanceof ParamValidationError &&
            error.code === "CD7_EMPTY_PROPERTY"
          );
        }
      }),
    );
  });

  it("non-positive cohort ids always raise CD8", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 0 }),
        fc.boolean(),
        (cohortId, negated) => {
          try {
            if (negated) {
              CohortCriteria.notInCohort(cohortId);
            } else {
              CohortCriteria.inCohort(cohortId);
            }
            return false;
          } catch (error) {
            return (
              error instanceof ParamValidationError &&
              error.code === "CD8_COHORT_ID_NOT_POSITIVE"
            );
          }
        },
      ),
    );
  });

  it("valid didEvent frequency/window combinations always construct", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("at_least", "at_most", "exactly"),
        fc.integer({ min: 0, max: 1000 }),
        fc.constantFrom("within_days", "within_weeks", "within_months"),
        fc.integer({ min: 1, max: 365 }),
        (freqName, freqValue, windowName, windowValue) => {
          const options = {
            [freqName]: freqValue,
            [windowName]: windowValue,
          } as Parameters<typeof CohortCriteria.didEvent>[1];
          const c = CohortCriteria.didEvent("Login", options);
          return (
            c._selector_node["operand"] === freqValue && c._behavior !== null
          );
        },
      ),
    );
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
