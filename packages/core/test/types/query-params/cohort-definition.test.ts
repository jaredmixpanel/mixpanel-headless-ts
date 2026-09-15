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

import { ParamValidationError } from "../../../src/errors.js";
import {
  buildEventSelector,
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
} from "../../../src/types/query-params/cohort.js";
import { Filter } from "../../../src/types/query-params/filter.js";
import { sanitizeRawCohort } from "../../../src/types/query-params/guards.js";
import { expectGuard } from "../../../test-support/raises.js";

/** Read a nested plain-object path from a serialized cohort payload. */
function at(value: unknown, ...path: Array<string | number>): unknown {
  let cursor: unknown = value;
  for (const key of path) {
    cursor = (cursor as Record<string | number, unknown>)[key];
  }
  return cursor;
}

describe("CohortDefinition composition + toDict", () => {
  it("constructor stores criteria with the AND combinator", () => {
    const c = CohortCriteria.didEvent("Login", {
      at_least: 1,
      within_days: 30,
    });
    const d = new CohortDefinition(c);
    expect(d._criteria).toStrictEqual([c]);
    expect(d._operator).toBe("and");
  });

  it("toDict produces selector + behaviors with a combinator root", () => {
    const d = new CohortDefinition(
      CohortCriteria.didEvent("Login", { at_least: 1, within_days: 30 }),
    );
    const result = d.toDict();
    expect(Object.keys(result)).toStrictEqual(["selector", "behaviors"]);
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
    expect(Object.keys(behaviors)).toStrictEqual(["bhvr_0", "bhvr_1"]);
    const children = at(result, "selector", "children") as Array<
      Record<string, unknown>
    >;
    expect(new Set(children.map((child) => child["value"]))).toStrictEqual(
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
    expect(Object.keys(result["behaviors"] as object)).toStrictEqual([
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
    expect(keys).toStrictEqual(["bhvr_0", "bhvr_1", "bhvr_2", "bhvr_3"]);
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
    expect(result["behaviors"]).toStrictEqual({});
    expect(at(result, "selector", "operator")).toBe("and");
    expect(at(result, "selector", "children")).toHaveLength(2);
  });

  it("cohort-reference definitions have empty behaviors", () => {
    const result = new CohortDefinition(CohortCriteria.inCohort(456)).toDict();
    expect(result["behaviors"]).toStrictEqual({});
    expect(at(result, "selector", "children", 0)).toStrictEqual({
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
    expect(c._selector_node["operand"]).toStrictEqual(["premium", "active"]);
  });
});

describe("sanitizeRawCohort", () => {
  // python: TestSanitizeRawCohort
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
    ).toStrictEqual({ type: "and", children: [] });
  });

  it("returns an independent copy when behaviors is absent", () => {
    const raw = { name: "Test", version: 1 };
    const result = sanitizeRawCohort(raw);
    expect(result).toStrictEqual(raw);
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
    ).toStrictEqual({ type: "or" });
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

describe("CohortBreakdown", () => {
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
    expect(children.map((child) => child["filterOperator"])).toStrictEqual([
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
