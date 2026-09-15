// Filter factories: the constructor's __post_init__ guards, scalar / date /
// cohort factories and their operator-value-type mapping, listContains
// guards and order, and the property-spec helper types. Mirrors the Filter
// suites of tests/unit/test_query_types.py and the guard cases of
// tests/unit/test_bookmark_builders.py; guard order follows Python source.
import { describe, expect, it } from "vitest";

import { ParamTypeError, ParamValidationError } from "../../../src/errors.js";
import {
  CustomPropertyRef,
  Filter,
  InlineCustomProperty,
  PropertyInput,
} from "../../../src/types/query-params/filter.js";
import { expectGuard } from "./filter-fixtures.js";

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
    // untyped JS caller (e.g. a `{ property: "x" }` typo) sailed through
    // and crashed later, deep in `compat/python-strip.ts`, at first use.
    // Class and timing now
    // match Python; tsc-typed callers are unaffected.
    expect(
      () => new PropertyInput(undefined as unknown as { name: string }),
    ).toThrow(
      new TypeError(
        "PropertyInput.__init__() missing 1 required positional argument: 'name'",
      ),
    );
    expect(
      () => new PropertyInput({ property: "x" } as unknown as { name: string }),
    ).toThrow(
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
    const prop = new InlineCustomProperty({
      formula: "A * B",
      inputs: { A: new PropertyInput({ name: "price", type: "number" }) },
    });
    expect(prop.property_type).toBeNull();
    expect(prop.resource_type).toBe("events");
    const numeric = InlineCustomProperty.numeric("A * B", {
      A: "price",
      B: "quantity",
    });
    expect(numeric.property_type).toBe("number");
    expect(numeric.inputs["A"]?.type).toBe("number");
    expect(numeric.inputs["B"]?.name).toBe("quantity");
  });
});
