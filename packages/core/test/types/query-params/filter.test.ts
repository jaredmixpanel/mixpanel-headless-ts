// Guard + factory tests for the P2-5a filter family (phase2-design C7):
// translated from tests/unit/test_query_types.py and
// tests/unit/test_bookmark_builders.py guard cases, plus Risk #1
// guard-ORDER probes (multi-invalid inputs must produce the FIRST
// failing code in Python source order) and a C9 fast-check guard-
// totality property.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { buildFilterEntry } from "../../../src/bookmarks/builders.js";
import {
  CODED_GUARD_REGISTRY,
  CODED_GUARD_TWIN_CODES,
  MixpanelHeadlessError,
  ParamTypeError,
  ParamValidationError,
} from "../../../src/errors.js";
import { ValueError } from "../../../src/query/python-builtins.js";
import { FILTER_OPERATOR_VALUES } from "../../../src/types/literals.js";
import {
  CustomPropertyRef,
  Filter,
  FILTER_OPERATOR_ALIASES,
  type FilterFields,
  filterUnchecked,
  InlineCustomProperty,
  ListItemGroupMode,
  PropertyInput,
} from "../../../src/types/query-params/filter.js";

/** Every code a P2-5a guard may legally raise (C9 property #4 domain). */
const LEGAL_CODES: ReadonlySet<string> = new Set([
  ...CODED_GUARD_REGISTRY,
  ...CODED_GUARD_TWIN_CODES,
]);

/**
 * Assert a thunk throws the exact guard `{class, code}` pair.
 *
 * @param thunk - The construction under test.
 * @param cls - Expected error class.
 * @param code - Expected registry code.
 */
function expectGuard(
  thunk: () => unknown,
  cls: typeof MixpanelHeadlessError,
  code: string,
): void {
  let thrown: unknown;
  try {
    thunk();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected ${code}`).toBeInstanceOf(cls);
  expect((thrown as MixpanelHeadlessError).code).toBe(code);
  expect(LEGAL_CODES.has(code), `${code} in registry/twins`).toBe(true);
}

describe("Filter constructor (__post_init__ parity)", () => {
  it("LC1: list_contains without item filters", () => {
    expectGuard(
      () =>
        new Filter({
          _property: "cart",
          _operator: "list_contains",
          _value: null,
          _list_item_quantifier: "any",
        }),
      ParamValidationError,
      "LC1_MISSING_ITEM_FILTERS",
    );
  });

  it("LC2: list_contains without quantifier", () => {
    expectGuard(
      () =>
        new Filter({
          _property: "cart",
          _operator: "list_contains",
          _value: null,
          _list_item_filters: [Filter.equals("Brand", "nike")],
        }),
      ParamValidationError,
      "LC2_MISSING_QUANTIFIER",
    );
  });

  it("guard order: both list-contains fields missing fires LC1 first", () => {
    expectGuard(
      () =>
        new Filter({
          _property: "cart",
          _operator: "list_contains",
          _value: null,
        }),
      ParamValidationError,
      "LC1_MISSING_ITEM_FILTERS",
    );
  });

  it("applies the Python field defaults on absent optionals", () => {
    const filter = new Filter({
      _property: "plan",
      _operator: "equals",
      _value: ["pro"],
    });
    expect(filter._property_type).toBe("string");
    expect(filter._resource_type).toBe("events");
    expect(filter._date_unit).toBeNull();
    expect(filter._list_item_filters).toBeNull();
    expect(filter._list_item_quantifier).toBeNull();
  });
});

describe("Filter scalar factories (operator/value/type mapping)", () => {
  it("equals wraps a bare string into a one-element list", () => {
    expect(Filter.equals("country", "US")._value).toStrictEqual(["US"]);
    expect(Filter.equals("country", ["US", "CA"])._value).toStrictEqual([
      "US",
      "CA",
    ]);
    expect(Filter.equals("country", "US")._operator).toBe("equals");
  });

  it("notEquals maps to 'does not equal'", () => {
    const filter = Filter.notEquals("country", "US");
    expect(filter._operator).toBe("does not equal");
    expect(filter._value).toStrictEqual(["US"]);
  });

  it("numeric factories set number property type", () => {
    expect(Filter.greaterThan("age", 18)._operator).toBe("is greater than");
    expect(Filter.greaterThan("age", 18)._property_type).toBe("number");
    expect(Filter.lessThan("age", 65)._operator).toBe("is less than");
    expect(Filter.atLeast("score", 80)._operator).toBe("is at least");
    expect(Filter.atMost("errors", 5)._operator).toBe("is at most");
    expect(Filter.between("amount", 10, 100)._value).toStrictEqual([10, 100]);
    expect(Filter.notBetween("age", 18, 65)._operator).toBe("not between");
  });

  it("existence/boolean factories carry null values", () => {
    expect(Filter.isSet("email")._value).toBeNull();
    expect(Filter.isNotSet("email")._operator).toBe("is not set");
    expect(Filter.isTrue("active")._property_type).toBe("boolean");
    expect(Filter.isFalse("active")._operator).toBe("false");
  });

  it("string-match factories keep the raw string value", () => {
    expect(Filter.contains("url", "shop")._value).toBe("shop");
    expect(Filter.notContains("url", "spam")._operator).toBe(
      "does not contain",
    );
    expect(Filter.startsWith("url", "https://")._operator).toBe("starts with");
    expect(Filter.endsWith("email", "@x.com")._operator).toBe("ends with");
  });

  it("factories thread the kw-only resource_type", () => {
    expect(
      Filter.equals("plan", "pro", { resource_type: "people" })._resource_type,
    ).toBe("people");
  });
});

describe("Filter date factories", () => {
  it("V8_DATE_FORMAT: malformed date shapes", () => {
    for (const bad of ["2024/01/01", "06/15/2024", "2026-1-1", "not-a-date"]) {
      expectGuard(
        () => Filter.on("created", bad),
        ParamValidationError,
        "V8_DATE_FORMAT",
      );
    }
  });

  it("V8_DATE_INVALID: format-valid but nonexistent dates", () => {
    for (const bad of [
      "2024-02-30",
      "2025-13-01",
      "2024-00-10",
      "0000-01-01",
    ]) {
      expectGuard(
        () => Filter.since("created", bad),
        ParamValidationError,
        "V8_DATE_INVALID",
      );
    }
  });

  it("guard order: format is checked before calendar validity", () => {
    // "2024/02/30" fails BOTH; the format guard must win.
    expectGuard(
      () => Filter.before("created", "2024/02/30"),
      ParamValidationError,
      "V8_DATE_FORMAT",
    );
  });

  it("accepts leap-day and sets datetime fields", () => {
    const filter = Filter.on("created", "2024-02-29");
    expect(filter._operator).toBe("was on");
    expect(filter._property_type).toBe("datetime");
    expect(Filter.notOn("created", "2024-02-29")._operator).toBe("was not on");
    expect(Filter.before("created", "2024-02-29")._operator).toBe("was before");
    expect(Filter.since("created", "2024-02-29")._operator).toBe("was since");
  });

  it("FD1_QUANTITY_NOT_POSITIVE on the three relative factories", () => {
    for (const quantity of [0, -5]) {
      expectGuard(
        () => Filter.inTheLast("created", quantity, "day"),
        ParamValidationError,
        "FD1_QUANTITY_NOT_POSITIVE",
      );
      expectGuard(
        () => Filter.notInTheLast("created", quantity, "week"),
        ParamValidationError,
        "FD1_QUANTITY_NOT_POSITIVE",
      );
      expectGuard(
        () => Filter.inTheNext("expires", quantity, "month"),
        ParamValidationError,
        "FD1_QUANTITY_NOT_POSITIVE",
      );
    }
  });

  it("relative factories set the date unit and operators", () => {
    expect(Filter.inTheLast("created", 7, "day")._date_unit).toBe("day");
    expect(Filter.inTheLast("created", 7, "day")._operator).toBe("was in the");
    expect(Filter.notInTheLast("created", 7, "day")._operator).toBe(
      "was not in the",
    );
    expect(Filter.inTheNext("expires", 7, "day")._operator).toBe(
      "was in the next",
    );
  });

  it("FD2_DATE_ORDER after both dates validate; from is checked first", () => {
    expectGuard(
      () => Filter.dateBetween("created", "2024-12-31", "2024-01-01"),
      ParamValidationError,
      "FD2_DATE_ORDER",
    );
    expectGuard(
      () => Filter.dateNotBetween("created", "2025-06-02", "2025-06-01"),
      ParamValidationError,
      "FD2_DATE_ORDER",
    );
    // Guard order: a malformed from_date wins over the reversed range.
    expectGuard(
      () => Filter.dateBetween("created", "bad", "2024-01-01"),
      ParamValidationError,
      "V8_DATE_FORMAT",
    );
    // Guard order: from validates before to.
    expectGuard(
      () => Filter.dateBetween("created", "2024-02-30", "bad"),
      ParamValidationError,
      "V8_DATE_INVALID",
    );
    // Equal endpoints are legal (strictly-greater comparison).
    expect(
      Filter.dateBetween("created", "2024-01-01", "2024-01-01")._value,
    ).toStrictEqual(["2024-01-01", "2024-01-01"]);
  });
});

describe("Filter cohort factories", () => {
  it("CF1_COHORT_ID_NOT_POSITIVE on zero/negative ids", () => {
    for (const cohort of [0, -5]) {
      expectGuard(
        () => Filter.inCohort(cohort),
        ParamValidationError,
        "CF1_COHORT_ID_NOT_POSITIVE",
      );
      expectGuard(
        () => Filter.notInCohort(cohort),
        ParamValidationError,
        "CF1_COHORT_ID_NOT_POSITIVE",
      );
    }
  });

  it("CF2_COHORT_NAME_EMPTY on blank provided names", () => {
    for (const name of ["", " ".repeat(3)]) {
      expectGuard(
        () => Filter.inCohort(123, name),
        ParamValidationError,
        "CF2_COHORT_NAME_EMPTY",
      );
    }
  });

  it("guard order: non-positive id wins over blank name", () => {
    expectGuard(
      () => Filter.inCohort(0, " ".repeat(3)),
      ParamValidationError,
      "CF1_COHORT_ID_NOT_POSITIVE",
    );
  });

  it("builds the cohort value structure (id branch)", () => {
    const filter = Filter.inCohort(123, "Power Users");
    expect(filter._property).toBe("$cohorts");
    expect(filter._operator).toBe("contains");
    expect(filter._property_type).toBe("list");
    expect(filter._value).toStrictEqual([
      { cohort: { negated: false, name: "Power Users", id: 123 } },
    ]);
    // Absent name serializes as "" (Python `name or ""`).
    expect(Filter.notInCohort(9)._value).toStrictEqual([
      { cohort: { negated: true, name: "", id: 9 } },
    ]);
    expect(Filter.notInCohort(9)._operator).toBe("does not contain");
  });
});

describe("Filter.listContains", () => {
  it("LC3_MIXED_ARGS: positional filters plus equals shorthand", () => {
    expectGuard(
      () =>
        Filter.listContains("cart", [Filter.equals("Brand", "nike")], {
          equals: { Category: "hats" },
        }),
      ParamValidationError,
      "LC3_MIXED_ARGS",
    );
  });

  it("LC4_INVALID_QUANTIFIER on unknown quantifiers", () => {
    for (const quantifier of ["every", "some", "nope"]) {
      expectGuard(
        () =>
          Filter.listContains("cart", [], {
            quantifier: quantifier as "any",
            equals: { Brand: "nike" },
          }),
        ParamValidationError,
        "LC4_INVALID_QUANTIFIER",
      );
    }
  });

  it("LC5_EMPTY_KWARG_KEY on blank equals keys", () => {
    for (const key of ["", " ".repeat(3)]) {
      expectGuard(
        () => Filter.listContains("cart", [], { equals: { [key]: "nike" } }),
        ParamValidationError,
        "LC5_EMPTY_KWARG_KEY",
      );
    }
  });

  it("LC6_KWARG_VALUE_TYPE (ParamTypeError) on non-string values", () => {
    for (const value of [42, 4.2, true, { nested: 1 }]) {
      expectGuard(
        () =>
          Filter.listContains("cart", [], {
            equals: { Brand: value as unknown as string },
          }),
        ParamTypeError,
        "LC6_KWARG_VALUE_TYPE",
      );
    }
  });

  it("LC7_NO_CONDITIONS when neither shape is given", () => {
    expectGuard(
      () => Filter.listContains("cart"),
      ParamValidationError,
      "LC7_NO_CONDITIONS",
    );
    expectGuard(
      () => Filter.listContains("items", [], { quantifier: "all" }),
      ParamValidationError,
      "LC7_NO_CONDITIONS",
    );
  });

  it("LC8_NESTED_LIST_CONTAINS on nested inner filters", () => {
    const inner = Filter.listContains("inner", [], {
      equals: { Brand: "x" },
    });
    expectGuard(
      () => Filter.listContains("cart", [inner]),
      ParamValidationError,
      "LC8_NESTED_LIST_CONTAINS",
    );
  });

  it("guard order: LC3 -> LC4 -> LC5 -> LC6 (first failing wins)", () => {
    // Mixed args + bad quantifier: LC3 wins.
    expectGuard(
      () =>
        Filter.listContains("cart", [Filter.equals("Brand", "nike")], {
          quantifier: "every" as "any",
          equals: { Category: "hats" },
        }),
      ParamValidationError,
      "LC3_MIXED_ARGS",
    );
    // Bad quantifier + blank key: LC4 wins.
    expectGuard(
      () =>
        Filter.listContains("cart", [], {
          quantifier: "every" as "any",
          equals: { "": "nike" },
        }),
      ParamValidationError,
      "LC4_INVALID_QUANTIFIER",
    );
    // Blank key + bad value on the SAME first entry: LC5 wins.
    expectGuard(
      () =>
        Filter.listContains("cart", [], {
          equals: { "": 42 as unknown as string },
        }),
      ParamValidationError,
      "LC5_EMPTY_KWARG_KEY",
    );
  });

  it("builds equals shorthand inner filters with the outer resource_type", () => {
    const filter = Filter.listContains("cart", [], {
      resource_type: "people",
      equals: { Brand: "nike", Category: ["hats", "shoes"] },
    });
    expect(filter._operator).toBe("list_contains");
    expect(filter._property_type).toBe("object");
    expect(filter._list_item_quantifier).toBe("any");
    expect(filter._list_item_filters).toHaveLength(2);
    const [brand, category] = filter._list_item_filters ?? [];
    expect(brand?._property).toBe("Brand");
    expect(brand?._value).toStrictEqual(["nike"]);
    expect(brand?._resource_type).toBe("people");
    expect(category?._value).toStrictEqual(["hats", "shoes"]);
  });
});

describe("property-spec helper types", () => {
  it("PropertyInput applies Python defaults", () => {
    const input = new PropertyInput({ name: "price" });
    expect(input.type).toBe("string");
    expect(input.resource_type).toBe("event");
  });

  it("PropertyInput fails EAGERLY on a missing name, like the Python dataclass", () => {
    // Python twin (frozen dataclass): `PropertyInput()` raises
    // `TypeError: PropertyInput.__init__() missing 1 required
    // positional argument: 'name'` AT CONSTRUCTION. Pre-fix, an
    // untyped JS caller (e.g. `{ property: "x" }` typo — QA
    // 2026-08-17 finding #3) sailed through and crashed later, deep
    // in `compat/python-strip.ts`, at first use. Class and timing now
    // match Python; tsc-typed callers are unaffected.
    expect(
      () => new PropertyInput(undefined as unknown as { name: string }),
    ).toThrowError(
      new TypeError(
        "PropertyInput.__init__() missing 1 required positional argument: 'name'",
      ),
    );
    expect(
      () => new PropertyInput({ property: "x" } as unknown as { name: string }),
    ).toThrowError(
      new TypeError(
        "PropertyInput.__init__() missing 1 required positional argument: 'name'",
      ),
    );
    // Parity boundary: Python dataclasses do NOT type-check field
    // values — `PropertyInput(name=123)` constructs fine and fails
    // only at use. The guard must not be stricter than Python.
    expect(
      () => new PropertyInput({ name: 123 } as unknown as { name: string }),
    ).not.toThrow();
  });

  it("CustomPropertyRef holds its id", () => {
    expect(new CustomPropertyRef({ id: 42 }).id).toBe(42);
  });

  it("InlineCustomProperty defaults + numeric factory", () => {
    const inline = new InlineCustomProperty({
      formula: "A * B",
      inputs: { A: new PropertyInput({ name: "price", type: "number" }) },
    });
    expect(inline.property_type).toBeNull();
    expect(inline.resource_type).toBe("events");
    const numeric = InlineCustomProperty.numeric("A * B", {
      A: "price",
      B: "quantity",
    });
    expect(numeric.property_type).toBe("number");
    expect(numeric.inputs["A"]?.type).toBe("number");
    expect(numeric.inputs["B"]?.name).toBe("quantity");
  });
});

describe("ListItemGroupMode guards", () => {
  it("LG1_EMPTY_SUB on blank sub", () => {
    for (const sub of ["", " ".repeat(3)]) {
      expectGuard(
        () => new ListItemGroupMode({ sub, sub_type: "string" }),
        ParamValidationError,
        "LG1_EMPTY_SUB",
      );
    }
  });

  it("LG2_INVALID_SUB_TYPE on unknown scalar types", () => {
    for (const subType of ["bogus", "list", "object"]) {
      expectGuard(
        () =>
          new ListItemGroupMode({
            sub: "Brand",
            sub_type: subType as "string",
          }),
        ParamValidationError,
        "LG2_INVALID_SUB_TYPE",
      );
    }
  });

  it("guard order: blank sub wins over bad sub_type", () => {
    expectGuard(
      () => new ListItemGroupMode({ sub: " ", sub_type: "bogus" as "string" }),
      ParamValidationError,
      "LG1_EMPTY_SUB",
    );
  });
});

describe("C9 guard-totality property (fast-check #4)", () => {
  it("invalid relative quantities always raise the FD1 registry code", () => {
    fc.assert(
      fc.property(fc.integer({ max: 0 }), (quantity) => {
        try {
          Filter.inTheLast("created", quantity, "day");
          return false;
        } catch (error) {
          return (
            error instanceof ParamValidationError &&
            error.code === "FD1_QUANTITY_NOT_POSITIVE" &&
            LEGAL_CODES.has(error.code)
          );
        }
      }),
    );
  });

  it("invalid quantifiers always raise the LC4 registry code", () => {
    fc.assert(
      fc.property(
        fc.string().filter((value) => value !== "any" && value !== "all"),
        (quantifier) => {
          try {
            Filter.listContains("cart", [], {
              quantifier: quantifier as "any",
              equals: { Brand: "nike" },
            });
            return false;
          } catch (error) {
            return (
              error instanceof ParamValidationError &&
              error.code === "LC4_INVALID_QUANTIFIER"
            );
          }
        },
      ),
    );
  });
});

describe("Filter.inCohort with an inline CohortDefinition (P2-9 gate finding)", () => {
  it("embeds the sanitized raw cohort exactly like Python", async () => {
    // The P2-5a stub threw TODO(port, P2-5b) on this branch; the P2-9
    // differential gate surfaced it. Expected shape measured on
    // oracle-py for the shrunken repro input (in_cohort criterion id 1).
    const { CohortCriteria, CohortDefinition } =
      await import("../../../src/types/query-params/cohort.js");
    const definition = CohortDefinition.allOf(CohortCriteria.notInCohort(1));
    const filter = Filter.inCohort(definition);
    expect(filter._property).toBe("$cohorts");
    expect(filter._operator).toBe("contains");
    expect(filter._value).toStrictEqual([
      {
        cohort: {
          negated: false,
          name: "",
          raw_cohort: {
            behaviors: {},
            selector: {
              children: [{ operator: "not in", property: "cohort", value: 1 }],
              operator: "and",
            },
          },
        },
      },
    ]);
  });

  it("negates through notInCohort with an inline definition", async () => {
    const { CohortCriteria, CohortDefinition } =
      await import("../../../src/types/query-params/cohort.js");
    const definition = CohortDefinition.anyOf(CohortCriteria.inCohort(7));
    const filter = Filter.notInCohort(definition, "Churn risk");
    expect(filter._operator).toBe("does not contain");
    const entry = (
      filter._value as ReadonlyArray<Record<string, Record<string, unknown>>>
    )[0]?.["cohort"] as Record<string, unknown>;
    expect(entry["negated"]).toBe(true);
    expect(entry["name"]).toBe("Churn risk");
    expect(entry["raw_cohort"]).toBeDefined();
    expect(entry["id"]).toBeUndefined();
  });
});

// ===========================================================================
// Direct construction (Python PR #236, test_query_types.py::
// TestFilterDirectConstruction): `new Filter({...})` validates and
// normalizes `_operator`. Regression coverage for the MP Bench report
// where the factory-method spelling ("greater_than", "is_set", boolean
// "equals") was serialized verbatim as filterOperator and rejected by the
// query API with HTTP 400.
// ===========================================================================

/**
 * Directly construct a Filter with deliberately loose field types (the
 * Python tests' `_direct` helper).
 *
 * @param property - `_property`.
 * @param operator - Raw `_operator` (may be an alias or invalid).
 * @param value - Raw `_value`.
 * @param propertyType - `_property_type` (default `"string"`).
 * @returns The constructed Filter.
 */
function direct(
  property: FilterFields["_property"],
  operator: unknown,
  value: unknown,
  propertyType: FilterFields["_property_type"] = "string",
): Filter {
  return new Filter({
    _property: property,
    _operator: operator as FilterFields["_operator"],
    _value: value as FilterFields["_value"],
    _property_type: propertyType,
  });
}

/**
 * Capture the message of the `ValueError` a thunk throws.
 *
 * @param thunk - The construction under test.
 * @returns The error message.
 */
function valueErrorMessage(thunk: () => unknown): string {
  try {
    thunk();
  } catch (error) {
    expect(error).toBeInstanceOf(ValueError);
    expect(error).not.toBeInstanceOf(ParamValidationError);
    return (error as Error).message;
  }
  return expect.unreachable("expected ValueError") as never;
}

/**
 * One-input inline custom property with the given declared type (the
 * Python tests' `_inline` helper).
 *
 * @param propertyType - The inline property's `property_type` (or `null`).
 * @returns An InlineCustomProperty over a single `plan` input.
 */
function inline(
  propertyType: "string" | "number" | "boolean" | "datetime" | null,
): InlineCustomProperty {
  return new InlineCustomProperty({
    formula: "A",
    inputs: { A: new PropertyInput({ name: "plan" }) },
    property_type: propertyType,
  });
}

describe("Filter direct construction (PR #236 operator validation)", () => {
  // --- The report's table: factory path == positional path ---

  it("report row: greater_than alias equals Filter.greaterThan", () => {
    const factory = Filter.greaterThan("gold", 10);
    const positional = direct("gold", "greater_than", 10, "number");
    expect(positional).toStrictEqual(factory);
    expect(buildFilterEntry(positional)["filterOperator"]).toBe(
      "is greater than",
    );
    expect(buildFilterEntry(positional)).toStrictEqual(
      buildFilterEntry(factory),
    );
  });

  it("report row: is_set alias equals Filter.isSet", () => {
    const factory = Filter.isSet("class");
    const positional = direct("class", "is_set", null);
    expect(positional).toStrictEqual(factory);
    expect(buildFilterEntry(positional)["filterOperator"]).toBe("is set");
    expect(buildFilterEntry(positional)).toStrictEqual(
      buildFilterEntry(factory),
    );
  });

  it("report row: boolean equals true collapses to Filter.isTrue", () => {
    const factory = Filter.isTrue("flag");
    const positional = direct("flag", "equals", true, "boolean");
    expect(positional).toStrictEqual(factory);
    const entry = buildFilterEntry(positional);
    expect(entry["filterOperator"]).toBe("true");
    expect(entry["filterValue"]).toBeNull();
    expect(entry).toStrictEqual(buildFilterEntry(factory));
  });

  // --- Boolean normalization table ---

  it.each([
    ["equals", true, "true"],
    ["equals", false, "false"],
    ["does not equal", true, "false"],
    ["does not equal", false, "true"],
    ["not_equals", true, "false"],
    ["not_equals", false, "true"],
    ["equals", [true], "true"],
    ["equals", [false], "false"],
    ["is_true", null, "true"],
    ["is_false", null, "false"],
  ] as const)(
    "boolean %s + %j collapses to %s with a null value",
    (operator, value, expected) => {
      const f = direct("flag", operator, value, "boolean");
      expect(f._operator).toBe(expected);
      expect(f._value).toBeNull();
      const twin =
        expected === "true" ? Filter.isTrue("flag") : Filter.isFalse("flag");
      expect(f).toStrictEqual(twin);
      expect(buildFilterEntry(f)).toStrictEqual(buildFilterEntry(twin));
    },
  );

  it.each([
    ["is set", null],
    ["equals", "yes"],
    ["equals", 1],
    ["equals", null],
    ["equals", [true, false]],
    ["contains", "tr"],
  ] as const)(
    "a boolean-typed Filter rejects %s with %j",
    (operator, value) => {
      const message = valueErrorMessage(() =>
        direct("flag", operator, value, "boolean"),
      );
      expect(message).toMatch(/boolean/);
      expect(message).toContain("Filter.is_true");
      expect(message).toContain("Filter.is_false");
    },
  );

  it("boolean wire operators are accepted unchanged", () => {
    expect(direct("flag", "true", null, "boolean")).toStrictEqual(
      Filter.isTrue("flag"),
    );
    expect(direct("flag", "false", null, "boolean")).toStrictEqual(
      Filter.isFalse("flag"),
    );
  });

  const trueFalseSpellings = ["true", "false", "is_true", "is_false"] as const;
  const nonNullValues = ["yes", true, 1, [true]] as const;
  const propertyTypes = ["boolean", "string"] as const;
  it.each(
    trueFalseSpellings.flatMap((operator) =>
      nonNullValues.flatMap((value) =>
        propertyTypes.map(
          (propertyType) => [operator, value, propertyType] as const,
        ),
      ),
    ),
  )(
    "%s with non-null value %j on a %s property is rejected",
    (operator, value, propertyType) => {
      const message = valueErrorMessage(() =>
        direct("flag", operator, value, propertyType),
      );
      expect(message).toMatch(/no value/);
      expect(message).toContain("Filter.is_true");
      expect(message).toContain("Filter.is_false");
    },
  );

  // --- Inline custom properties: the inline type wins ---

  it("a boolean inline custom property is governed by the boolean rules", () => {
    const message = valueErrorMessage(() =>
      direct(inline("boolean"), "contains", "tr", "string"),
    );
    expect(message).toMatch(/boolean/);
  });

  it("equals + true on a boolean inline custom property becomes true/null", () => {
    const f = direct(inline("boolean"), "equals", true, "string");
    expect(f._operator).toBe("true");
    expect(f._value).toBeNull();
    const entry = buildFilterEntry(f);
    expect(entry["filterType"]).toBe("boolean");
    expect(entry["filterOperator"]).toBe("true");
    expect(entry["filterValue"]).toBeNull();
  });

  it("with no inline type declared, the Filter's own _property_type governs", () => {
    const f = direct(inline(null), "equals", ["x"], "string");
    expect(f._operator).toBe("equals");
    expect(f._value).toStrictEqual(["x"]);
    const message = valueErrorMessage(() =>
      direct(inline(null), "contains", "tr", "boolean"),
    );
    expect(message).toMatch(/boolean/);
  });

  // --- Unknown operators ---

  it.each([[["equals"]], [{ op: "equals" }], [null], [7], [undefined]])(
    "non-string operator %j raises ValueError (never TypeError)",
    (operator) => {
      const message = valueErrorMessage(() =>
        direct("gold", operator, 10, "number"),
      );
      expect(message).toMatch(/^Unknown Filter operator/);
      expect(message).toContain("Filter.greater_than");
    },
  );

  it("an unknown operator fails immediately with guidance", () => {
    const message = valueErrorMessage(() =>
      direct("gold", "bigger_than", 10, "number"),
    );
    expect(message).toContain("'bigger_than'");
    for (const wire of FILTER_OPERATOR_VALUES) {
      expect(message).toContain(`'${wire}'`);
    }
    expect(message).toContain("Filter.greater_than");
  });

  it.each(["", "GREATER_THAN", "is greater than ", ">"])(
    "near-miss spelling %j is rejected",
    (operator) => {
      const message = valueErrorMessage(() =>
        direct("gold", operator, 10, "number"),
      );
      expect(message).toMatch(/^Unknown Filter operator/);
    },
  );

  it("the construction guard is a plain ValueError, not a coded guard", () => {
    try {
      direct("gold", "bigger_than", 10, "number");
      expect.unreachable("expected ValueError");
    } catch (error) {
      expect(error).toBeInstanceOf(ValueError);
      expect(error).not.toBeInstanceOf(MixpanelHeadlessError);
      expect((error as { code?: unknown }).code).toBeUndefined();
    }
  });

  // --- Already-valid inputs are untouched ---

  it.each([
    ["is greater than", 18, "number"],
    ["equals", "US", "string"],
    ["equals", ["US"], "string"],
    ["is set", null, "string"],
    ["was on", ["2026-01-01"], "datetime"],
    ["true", null, "string"],
  ] as const)(
    "valid wire operator %s with %j on %s passes through unchanged",
    (operator, value, propertyType) => {
      const f = direct("p", operator, value, propertyType);
      expect(f._operator).toBe(operator);
      expect(f._value).toStrictEqual(value);
      expect(f._property_type).toBe(propertyType);
    },
  );

  it("a bare bool on a non-boolean property is stored as given (no collapse)", () => {
    const f = direct("flag", "equals", true, "string");
    expect(f._operator).toBe("equals");
    expect(f._value).toBe(true);
  });

  it("the LC1 guard still runs after operator normalization", () => {
    expectGuard(
      () => direct("cart", "list_contains", null, "object" as never),
      ParamValidationError,
      "LC1_MISSING_ITEM_FILTERS",
    );
  });

  // --- Alias table is derived from the factory methods on the class ---

  it("every alias key is a public factory name (camelized) or 'is equal to'", () => {
    const camel = (name: string): string =>
      name.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
    for (const key of Object.keys(FILTER_OPERATOR_ALIASES)) {
      if (key === "is equal to") continue;
      expect(
        typeof (Filter as unknown as Record<string, unknown>)[camel(key)],
        `alias ${key} has no Filter.${camel(key)} factory`,
      ).toBe("function");
    }
  });

  it("every alias maps to a FilterOperator member", () => {
    const wire = new Set<string>(FILTER_OPERATOR_VALUES);
    for (const target of Object.values(FILTER_OPERATOR_ALIASES)) {
      expect(wire.has(target), target).toBe(true);
    }
  });

  it.each([
    ["is equal to", "equals"],
    ["between", "is between"],
  ] as const)("segfilter-only spelling %s normalizes to %s", (alias, wire) => {
    const f = direct("count", alias, 42, "number");
    expect(f._operator).toBe(wire);
    expect(f).toStrictEqual(direct("count", wire, 42, "number"));
  });
});

describe("filterUnchecked (codec / guard-probe bypass, Python _filter_unchecked)", () => {
  it("stores the fields verbatim with no validation or normalization", () => {
    const f = filterUnchecked({
      _property: "p",
      _operator: "was frobnicated",
      _value: null,
    });
    expect(f).toBeInstanceOf(Filter);
    expect(f._operator).toBe("was frobnicated");
    expect(f._property_type).toBe("string");
    expect(f._resource_type).toBe("events");
    expect(f._date_unit).toBeNull();
    expect(f._list_item_filters).toBeNull();
    expect(f._list_item_quantifier).toBeNull();
  });

  it("does not rewrite an alias and skips the list_contains guards", () => {
    expect(
      filterUnchecked({ _property: "p", _operator: "greater_than", _value: 1 })
        ._operator,
    ).toBe("greater_than");
    expect(
      filterUnchecked({
        _property: "cart",
        _operator: "list_contains",
        _value: null,
      })._list_item_filters,
    ).toBeNull();
  });

  it("raises TypeError on a missing required field", () => {
    expect(() =>
      filterUnchecked({ _property: "p", _operator: "equals" }),
    ).toThrow(
      new TypeError("_filter_unchecked() missing required field '_value'"),
    );
  });

  it("raises TypeError on unknown field names", () => {
    expect(() =>
      filterUnchecked({
        _property: "p",
        _operator: "equals",
        _value: null,
        _zzz: 1,
        _aaa: 2,
      }),
    ).toThrow(
      new TypeError(
        "_filter_unchecked() got unknown Filter field(s): ['_aaa', '_zzz']",
      ),
    );
  });
});
