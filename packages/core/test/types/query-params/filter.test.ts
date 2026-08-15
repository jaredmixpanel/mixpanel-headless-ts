// Guard + factory tests for the P2-5a filter family (phase2-design C7):
// translated from tests/unit/test_query_types.py and
// tests/unit/test_bookmark_builders.py guard cases, plus Risk #1
// guard-ORDER probes (multi-invalid inputs must produce the FIRST
// failing code in Python source order) and a C9 fast-check guard-
// totality property.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CODED_GUARD_REGISTRY,
  CODED_GUARD_TWIN_CODES,
  MixpanelHeadlessError,
  ParamTypeError,
  ParamValidationError,
} from "../../../src/errors.js";
import {
  CustomPropertyRef,
  Filter,
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
  } catch (cause) {
    thrown = cause;
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
    expect(Filter.equals("country", "US")._value).toEqual(["US"]);
    expect(Filter.equals("country", ["US", "CA"])._value).toEqual(["US", "CA"]);
    expect(Filter.equals("country", "US")._operator).toBe("equals");
  });

  it("notEquals maps to 'does not equal'", () => {
    const filter = Filter.notEquals("country", "US");
    expect(filter._operator).toBe("does not equal");
    expect(filter._value).toEqual(["US"]);
  });

  it("numeric factories set number property type", () => {
    expect(Filter.greaterThan("age", 18)._operator).toBe("is greater than");
    expect(Filter.greaterThan("age", 18)._property_type).toBe("number");
    expect(Filter.lessThan("age", 65)._operator).toBe("is less than");
    expect(Filter.atLeast("score", 80)._operator).toBe("is at least");
    expect(Filter.atMost("errors", 5)._operator).toBe("is at most");
    expect(Filter.between("amount", 10, 100)._value).toEqual([10, 100]);
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
    ).toEqual(["2024-01-01", "2024-01-01"]);
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
    for (const name of ["", "   "]) {
      expectGuard(
        () => Filter.inCohort(123, name),
        ParamValidationError,
        "CF2_COHORT_NAME_EMPTY",
      );
    }
  });

  it("guard order: non-positive id wins over blank name", () => {
    expectGuard(
      () => Filter.inCohort(0, "   "),
      ParamValidationError,
      "CF1_COHORT_ID_NOT_POSITIVE",
    );
  });

  it("builds the cohort value structure (id branch)", () => {
    const filter = Filter.inCohort(123, "Power Users");
    expect(filter._property).toBe("$cohorts");
    expect(filter._operator).toBe("contains");
    expect(filter._property_type).toBe("list");
    expect(filter._value).toEqual([
      { cohort: { negated: false, name: "Power Users", id: 123 } },
    ]);
    // Absent name serializes as "" (Python `name or ""`).
    expect(Filter.notInCohort(9)._value).toEqual([
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
    for (const key of ["", "   "]) {
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
    expect(brand?._value).toEqual(["nike"]);
    expect(brand?._resource_type).toBe("people");
    expect(category?._value).toEqual(["hats", "shoes"]);
  });
});

describe("property-spec helper types", () => {
  it("PropertyInput applies Python defaults", () => {
    const input = new PropertyInput({ name: "price" });
    expect(input.type).toBe("string");
    expect(input.resource_type).toBe("event");
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
    for (const sub of ["", "   "]) {
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
        } catch (cause) {
          return (
            cause instanceof ParamValidationError &&
            cause.code === "FD1_QUANTITY_NOT_POSITIVE" &&
            LEGAL_CODES.has(cause.code)
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
          } catch (cause) {
            return (
              cause instanceof ParamValidationError &&
              cause.code === "LC4_INVALID_QUANTIFIER"
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
    expect(filter._value).toEqual([
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
