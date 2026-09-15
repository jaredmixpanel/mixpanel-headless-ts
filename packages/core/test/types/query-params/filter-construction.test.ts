// Guard + factory tests for the P2-5a filter family (phase2-design C7):
// translated from tests/unit/test_query_types.py and
// tests/unit/test_bookmark_builders.py guard cases, plus Risk #1
// guard-ORDER probes (multi-invalid inputs must produce the FIRST
// failing code in Python source order) and a C9 fast-check guard-
// totality property.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { buildFilterEntry } from "../../../src/bookmarks/builders.js";
import { ValueError } from "../../../src/compat/python-builtins.js";
import {
  MixpanelHeadlessError,
  ParamValidationError,
} from "../../../src/errors.js";
import { FILTER_OPERATOR_VALUES } from "../../../src/types/literals.js";
import {
  Filter,
  FILTER_OPERATOR_ALIASES,
  type FilterFields,
  filterUnchecked,
  InlineCustomProperty,
  ListItemGroupMode,
  PropertyInput,
} from "../../../src/types/query-params/filter.js";
import { expectThrows } from "../../../test-support/raises.js";
import { expectGuard, LEGAL_CODES } from "./filter-fixtures.js";

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
  return expect.unreachable("expected ValueError");
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
    for (const subtype of ["bogus", "list", "object"]) {
      expectGuard(
        () =>
          new ListItemGroupMode({
            sub: "Brand",
            sub_type: subtype as "string",
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
    )[0]!["cohort"]!;
    expect(entry["negated"]).toBe(true);
    expect(entry["name"]).toBe("Churn risk");
    expect(entry["raw_cohort"]).toBeDefined();
    expect(entry["id"]).toBeUndefined();
  });
});

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
    const error = expectThrows(
      () => direct("gold", "bigger_than", 10, "number"),
      "expected ValueError",
    );
    expect(error).toBeInstanceOf(ValueError);
    expect(error).not.toBeInstanceOf(MixpanelHeadlessError);
    expect((error as { code?: unknown }).code).toBeUndefined();
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
      () => direct("cart", "list_contains", null, "object"),
      ParamValidationError,
      "LC1_MISSING_ITEM_FILTERS",
    );
  });

  // --- Alias table is derived from the factory methods on the class ---

  it("every alias key is a public factory name (camelized) or 'is equal to'", () => {
    const camel = (name: string): string =>
      name.replaceAll(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
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
