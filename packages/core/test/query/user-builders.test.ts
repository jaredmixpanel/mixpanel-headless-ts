/**
 * Layer-3 translation of `tests/test_user_builders.py` (710 LOC, 18
 * classes `:27-710`; Python revision: `ts-port/phase2-contract-support`
 * HEAD), per `b3-packets.md` §"Packet K4" — the WHOLE file translates
 * here, no deferrals.
 *
 * **Split-file citation** (packet K4 Layer-3 table): two classes of
 * `tests/test_query_user_structural.py` also belong to this shard and
 * are appended at the bottom of this file —
 * `TestPbtFormatValueSpecialChars` (`:416`) and
 * `TestFiltersToSelectorOrAndPrecedence` (`:461`). The rest of that
 * file is B5 Layer-3 except its two `transform_profile` classes, which
 * K3 already translated into `transforms.test.ts`.
 * `tests/test_query_user_edge_cases.py` is likewise B5 Layer-3
 * (b2-packets §V2 precedent); its 3 K4 vectors replay at B3 regardless
 * (vectors gate on the api, not on test-file ownership).
 *
 * R10.2 notes (assertion-for-assertion; codes, not messages):
 *
 * - `pytest.raises(ValueError, match="int or float for lower bound")`
 *   asserts on MESSAGE text, which is out of contract (R5.4). Each such
 *   assert translates to the exception CLASS (`ParamValidationError` —
 *   the twin of Python's `ParamValidationError(MixpanelHeadlessError,
 *   ValueError)`) plus the registry `.code` that identifies the same
 *   guard. Nothing is dropped: the `match=` fragment and the `.code`
 *   name the same branch.
 * - EXCEPTION to the line above:
 *   `TestNotEqualsErrorMessage::test_error_references_correct_method_name`
 *   exists specifically to assert that the message names
 *   `Filter.not_equals()` (a PR-review regression guard, not a contract
 *   assert). The TS port carries the message verbatim, so the assert
 *   translates as a real `toContain("Filter.not_equals")` — translating
 *   it to class+code only would be the weakening R10.2 forbids.
 * - `test_es_guards_stay_catchable_as_value_error` asserts Python's dual
 *   inheritance (`except ValueError` reachability). TS has no
 *   `ValueError` in the error hierarchy; the ported invariant is descent
 *   from `MixpanelHeadlessError` (errors.ts header: "in TS the
 *   conformance key is class name + code"), asserted as such alongside
 *   the `instanceof ParamValidationError` + `.code` asserts the Python
 *   test also makes.
 * - Python's `# type: ignore[arg-type]` deliberate-invalid inputs become
 *   `as unknown as X` casts at the same call sites. Python's
 *   `Filter(("tup",), "is set", None)` uses a TUPLE property; the ported
 *   value domain has no tuple, so the twin uses a one-element ARRAY —
 *   the same "not a `str`" ES1 branch, which is what the assert is about.
 * - `assert cohort is cohort_filter` (identity) → `toBe` (reference
 *   equality), the exact JS twin.
 * - `assert remaining == [f1, f2, f3]` compares Filter INSTANCES by
 *   Python `__eq__` (dataclass field equality). The stronger, faithful
 *   twin here is element-wise `toBe` (identity), since
 *   `extract_cohort_filter` forwards the very objects it received —
 *   locked separately by `test_cohort_filter_identity_preserved`.
 * - `TestPbtFormatValueSpecialChars` (Hypothesis) → fast-check twins with
 *   the same alphabets: `st.characters(whitelist_categories=("L","N",
 *   "P","S","Z"), whitelist_characters='"\\' + "\n\r\0")` and the
 *   unrestricted `st.text()` (drawn as `unit: "binary"`, the full
 *   code-point domain incl. non-BMP — an ASCII-only twin would be a
 *   silent narrowing, B2 ASSERT-F1).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  MixpanelHeadlessError,
  ParamValidationError,
} from "../../src/errors.js";
import {
  extractCohortFilter,
  filtersToSelector,
  filterToSelector,
  formatValue,
} from "../../src/query/user-builders.js";
import {
  CohortCriteria,
  CohortDefinition,
  Filter,
  type FilterFields,
} from "../../src/types/index.js";
import { filterUnchecked } from "../../src/types/query-params/filter.js";
import { expectThrows } from "../../test-support/raises.js";

/**
 * Build a Filter straight from its fields — the twin of Python's
 * positional `Filter("prop", "is between", [...])` construction used by
 * the deliberate-invalid-input tests.
 *
 * @param property - The `_property` field (any value; ES1 inputs are
 *   deliberately non-string).
 * @param operator - The `_operator` field (any string; ES13 inputs are
 *   deliberately unsupported).
 * @param value - The `_value` field (any shape).
 * @param extra - Optional remaining field overrides.
 * @returns The constructed Filter.
 */
function rawFilter(
  property: unknown,
  operator: string,
  value: unknown,
  extra?: Partial<FilterFields>,
): Filter {
  // Python PR #236: the constructor now rejects unknown operators, so the
  // ES13 probes rebuild through the unchecked path (Python
  // `make_unchecked_filter`), exactly as the conformance codec does.
  return filterUnchecked({
    _property: property,
    _operator: operator,
    _value: value,
    ...extra,
  });
}

// =============================================================================
// filter_to_selector — individual operator mapping
// =============================================================================

describe("filterToSelector equals (TestFilterToSelectorEquals)", () => {
  it("single string value", () => {
    const f = Filter.equals("plan", "premium");
    expect(filterToSelector(f)).toBe('properties["plan"] == "premium"');
  });

  it("multi value produces OR chain", () => {
    const f = Filter.equals("country", ["US", "CA", "UK"]);
    expect(filterToSelector(f)).toBe(
      '(properties["country"] == "US"' +
        " or " +
        'properties["country"] == "CA"' +
        " or " +
        'properties["country"] == "UK")',
    );
  });

  it("two values produce a single OR", () => {
    const f = Filter.equals("status", ["active", "trial"]);
    expect(filterToSelector(f)).toBe(
      '(properties["status"] == "active" or properties["status"] == "trial")',
    );
  });

  it("single value in list produces simple equality (no OR)", () => {
    const f = Filter.equals("plan", ["premium"]);
    expect(filterToSelector(f)).toBe('properties["plan"] == "premium"');
  });
});

describe("filterToSelector not-equals (TestFilterToSelectorNotEquals)", () => {
  it("single value", () => {
    const f = Filter.notEquals("plan", "free");
    expect(filterToSelector(f)).toBe('properties["plan"] != "free"');
  });

  it("multi value AND-combines the inequalities", () => {
    const f = Filter.notEquals("status", ["banned", "deleted"]);
    const result = filterToSelector(f);

    // Each value must not match -- AND semantics for not-equals.
    expect(result).toContain('properties["status"] != "banned"');
    expect(result).toContain('properties["status"] != "deleted"');
  });
});

describe("filterToSelector contains (TestFilterToSelectorContains)", () => {
  it("contains string", () => {
    const f = Filter.contains("email", "gmail");
    expect(filterToSelector(f)).toBe('"gmail" in properties["email"]');
  });
});

describe("filterToSelector not-contains (TestFilterToSelectorNotContains)", () => {
  it("not-contains string", () => {
    const f = Filter.notContains("email", "spam");
    expect(filterToSelector(f)).toBe('not "spam" in properties["email"]');
  });
});

describe("filterToSelector greater-than (TestFilterToSelectorGreaterThan)", () => {
  it("integer value", () => {
    const f = Filter.greaterThan("age", 18);
    expect(filterToSelector(f)).toBe('properties["age"] > 18');
  });

  it("float value", () => {
    const f = Filter.greaterThan("score", 9.5);
    expect(filterToSelector(f)).toBe('properties["score"] > 9.5');
  });
});

describe("filterToSelector less-than (TestFilterToSelectorLessThan)", () => {
  it("integer value", () => {
    const f = Filter.lessThan("age", 65);
    expect(filterToSelector(f)).toBe('properties["age"] < 65');
  });

  it("float value", () => {
    const f = Filter.lessThan("price", 19.99);
    expect(filterToSelector(f)).toBe('properties["price"] < 19.99');
  });
});

describe("filterToSelector between (TestFilterToSelectorBetween)", () => {
  it("integer range", () => {
    const f = Filter.between("age", 18, 65);
    expect(filterToSelector(f)).toBe(
      'properties["age"] >= 18 and properties["age"] <= 65',
    );
  });

  it("float range", () => {
    const f = Filter.between("score", 1.5, 9.5);
    expect(filterToSelector(f)).toBe(
      'properties["score"] >= 1.5 and properties["score"] <= 9.5',
    );
  });

  it("mixed int/float range", () => {
    const f = Filter.between("amount", 0, 99.99);
    expect(filterToSelector(f)).toBe(
      'properties["amount"] >= 0 and properties["amount"] <= 99.99',
    );
  });
});

describe("filterToSelector is-set (TestFilterToSelectorIsSet)", () => {
  it("is set", () => {
    expect(filterToSelector(Filter.isSet("email"))).toBe(
      'defined(properties["email"])',
    );
  });
});

describe("filterToSelector is-not-set (TestFilterToSelectorIsNotSet)", () => {
  it("is not set", () => {
    expect(filterToSelector(Filter.isNotSet("phone"))).toBe(
      'not defined(properties["phone"])',
    );
  });
});

describe("filterToSelector booleans (TestFilterToSelectorBooleans)", () => {
  it("is true", () => {
    expect(filterToSelector(Filter.isTrue("verified"))).toBe(
      'properties["verified"] == true',
    );
  });

  it("is false", () => {
    expect(filterToSelector(Filter.isFalse("opted_out"))).toBe(
      'properties["opted_out"] == false',
    );
  });
});

// =============================================================================
// filter_to_selector — value formatting
// =============================================================================

describe("filterToSelector value formatting (TestFilterToSelectorValueFormatting)", () => {
  it("string value is quoted", () => {
    const f = Filter.equals("city", "New York");
    expect(filterToSelector(f)).toBe('properties["city"] == "New York"');
  });

  it("integer value is unquoted", () => {
    const result = filterToSelector(Filter.greaterThan("count", 100));

    expect(result).toContain("100");
    expect(result).not.toContain('"100"');
  });

  it("float value is unquoted", () => {
    const result = filterToSelector(Filter.lessThan("ratio", 0.5));

    expect(result).toContain("0.5");
    expect(result).not.toContain('"0.5"');
  });

  it("boolean true is lowercase and unquoted", () => {
    const result = filterToSelector(Filter.isTrue("active"));

    expect(result).toContain("true");
    expect(result).not.toContain('"true"');
  });

  it("boolean false is lowercase and unquoted", () => {
    const result = filterToSelector(Filter.isFalse("disabled"));

    expect(result).toContain("false");
    expect(result).not.toContain('"false"');
  });

  it("zero integer", () => {
    expect(filterToSelector(Filter.greaterThan("balance", 0))).toBe(
      'properties["balance"] > 0',
    );
  });

  it("negative integer", () => {
    expect(filterToSelector(Filter.greaterThan("offset", -10))).toBe(
      'properties["offset"] > -10',
    );
  });
});

// =============================================================================
// filter_to_selector — edge cases
// =============================================================================

describe("filterToSelector edge cases (TestFilterToSelectorEdgeCases)", () => {
  it("dollar-prefixed property name", () => {
    expect(filterToSelector(Filter.equals("$city", "London"))).toBe(
      'properties["$city"] == "London"',
    );
  });

  it("property name with spaces", () => {
    expect(filterToSelector(Filter.equals("first name", "Alice"))).toBe(
      'properties["first name"] == "Alice"',
    );
  });

  it("value with double quotes is escaped", () => {
    const result = filterToSelector(
      Filter.contains("description", 'say "hello"'),
    );

    // The value must be present in the selector without breaking syntax.
    expect(result).toContain("say");
    expect(result).toContain("hello");
  });

  it("value with backslash is handled", () => {
    const result = filterToSelector(
      Filter.contains("path", String.raw`C:\Users`),
    );

    expect(
      result.includes("C:\\") || result.includes(String.raw`C:\\Users`),
    ).toBe(true);
  });

  it("empty string value", () => {
    expect(filterToSelector(Filter.equals("tag", ""))).toContain('""');
  });
});

// =============================================================================
// filters_to_selector — AND combination
// =============================================================================

describe("filtersToSelector (TestFiltersToSelector)", () => {
  it("empty list returns empty string", () => {
    expect(filtersToSelector([])).toBe("");
  });

  it("single filter", () => {
    expect(filtersToSelector([Filter.equals("plan", "premium")])).toBe(
      'properties["plan"] == "premium"',
    );
  });

  it("two filters AND-combined", () => {
    const result = filtersToSelector([
      Filter.equals("plan", "premium"),
      Filter.isSet("email"),
    ]);

    expect(result).toBe(
      'properties["plan"] == "premium" and defined(properties["email"])',
    );
  });

  it("three filters produce two AND operators", () => {
    const result = filtersToSelector([
      Filter.equals("plan", "premium"),
      Filter.greaterThan("age", 18),
      Filter.isSet("email"),
    ]);

    expect(result).toContain(" and ");
    expect(result.split(" and ").length - 1).toBe(2);
    expect(result).toContain('properties["plan"] == "premium"');
    expect(result).toContain('properties["age"] > 18');
    expect(result).toContain('defined(properties["email"])');
  });

  it("preserves filter order", () => {
    const result = filtersToSelector([
      Filter.isSet("a"),
      Filter.isSet("b"),
      Filter.isSet("c"),
    ]);
    const parts = result.split(" and ");

    expect(parts[0]).toBe('defined(properties["a"])');
    expect(parts[1]).toBe('defined(properties["b"])');
    expect(parts[2]).toBe('defined(properties["c"])');
  });

  it("mixed operator types combine correctly", () => {
    const result = filtersToSelector([
      Filter.equals("country", "US"),
      Filter.greaterThan("age", 21),
      Filter.isTrue("verified"),
      Filter.isNotSet("banned_at"),
    ]);

    expect(result.split(" and ")).toHaveLength(4);
  });
});

// =============================================================================
// extract_cohort_filter
// =============================================================================

describe("extractCohortFilter (TestExtractCohortFilter)", () => {
  it("no cohort filter", () => {
    const filters = [Filter.equals("plan", "premium"), Filter.isSet("email")];
    const [remaining, cohort] = extractCohortFilter(filters);

    expect(remaining).toHaveLength(2);
    expect(cohort).toBeNull();
  });

  it("empty list", () => {
    const [remaining, cohort] = extractCohortFilter([]);

    expect(remaining).toStrictEqual([]);
    expect(cohort).toBeNull();
  });

  it("only a cohort filter", () => {
    const [remaining, cohort] = extractCohortFilter([
      Filter.inCohort(123, "Power Users"),
    ]);

    expect(remaining).toStrictEqual([]);
    expect(cohort).not.toBeNull();
  });

  it("cohort filter with saved id", () => {
    const filters = [
      Filter.equals("plan", "premium"),
      Filter.inCohort(456, "VIPs"),
      Filter.isSet("email"),
    ];
    const [remaining, cohort] = extractCohortFilter(filters);

    expect(remaining).toHaveLength(2);
    expect(cohort).not.toBeNull();
    // Remaining must not contain the cohort filter.
    for (const f of remaining) {
      expect(f._property).not.toBe("$cohorts");
    }
  });

  it("cohort filter with inline definition", () => {
    const cohortDef = CohortDefinition.allOf(
      CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
    );
    const filters = [
      Filter.equals("plan", "premium"),
      Filter.inCohort(cohortDef, "Buyers"),
    ];
    const [remaining, cohort] = extractCohortFilter(filters);

    expect(remaining).toHaveLength(1);
    expect(cohort).not.toBeNull();
  });

  it("not-in-cohort is also extracted", () => {
    const filters = [
      Filter.equals("plan", "free"),
      Filter.notInCohort(789, "Bots"),
    ];
    const [remaining, cohort] = extractCohortFilter(filters);

    expect(remaining).toHaveLength(1);
    expect(cohort).not.toBeNull();
  });

  it("remaining filters preserve order", () => {
    const f1 = Filter.equals("plan", "premium");
    const f2 = Filter.greaterThan("age", 18);
    const f3 = Filter.isSet("email");
    const [remaining] = extractCohortFilter([f1, Filter.inCohort(123), f2, f3]);

    expect(remaining).toHaveLength(3);
    expect(remaining[0]).toBe(f1);
    expect(remaining[1]).toBe(f2);
    expect(remaining[2]).toBe(f3);
  });

  it("cohort filter identity is preserved", () => {
    const cohortFilter = Filter.inCohort(123, "Power Users");
    const [, cohort] = extractCohortFilter([
      Filter.equals("plan", "free"),
      cohortFilter,
    ]);

    expect(cohort).toBe(cohortFilter);
  });

  it("original list is not mutated", () => {
    const filters = [
      Filter.equals("plan", "premium"),
      Filter.inCohort(123),
      Filter.isSet("email"),
    ];
    const originalLen = filters.length;

    extractCohortFilter(filters);

    expect(filters).toHaveLength(originalLen);
  });
});

// =============================================================================
// PR #118 review fixes — property escaping and between bounds
// =============================================================================

describe("filterToSelector property escaping (TestFilterToSelectorPropertyEscaping)", () => {
  it("property name containing a double quote is escaped", () => {
    const f = Filter.equals('weird"prop', "val");
    expect(filterToSelector(f)).toBe(
      String.raw`properties["weird\"prop"] == "val"`,
    );
  });

  it("property name containing a backslash is escaped", () => {
    const f = Filter.equals(String.raw`back\slash`, "val");
    expect(filterToSelector(f)).toBe(
      String.raw`properties["back\\slash"] == "val"`,
    );
  });
});

describe("filterToSelector between bounds (TestFilterToSelectorBetweenBoundsValidation)", () => {
  it("string lower bound is rejected", () => {
    const f = rawFilter("prop", "is between", ["low", 10]);

    // Python: `pytest.raises(ValueError, match="int or float for lower bound")`
    // — class + code twin (R5.4).
    expect(() => filterToSelector(f)).toThrow(ParamValidationError);
    const error = expectThrows(() => filterToSelector(f));
    expect((error as ParamValidationError).code).toBe(
      "ES11_BETWEEN_LOWER_NOT_NUMBER",
    );
  });

  it("string upper bound is rejected", () => {
    const f = rawFilter("prop", "is between", [0, "high"]);

    expect(() => filterToSelector(f)).toThrow(ParamValidationError);
    const error = expectThrows(() => filterToSelector(f));
    expect((error as ParamValidationError).code).toBe(
      "ES12_BETWEEN_UPPER_NOT_NUMBER",
    );
  });
});

describe("not-equals error message (TestNotEqualsErrorMessage)", () => {
  it("error references Filter.not_equals(), not does_not_equal()", () => {
    const f = rawFilter("prop", "does not equal", [{ nested: true }]);

    const error = expectThrows(() => filterToSelector(f));
    // The message text is out of contract (R5.4) but ported verbatim;
    // this Python test exists ONLY to assert the method name in it, so
    // the assert translates literally rather than being weakened.
    expect((error as Error).message).toContain("Filter.not_equals");
    expect((error as ParamValidationError).code).toBe(
      "ES5_NOT_EQUALS_NO_TERMS",
    );
  });
});

// =============================================================================
// Coded guard errors — ES* family (E2 coding pass, design §1.6)
// =============================================================================

/**
 * Assert that a thunk raises `ParamValidationError` with `code`.
 *
 * @param thunk - The call under test.
 * @param code - The expected registry code.
 */
function expectCode(thunk: () => unknown, code: string): void {
  const error = expectThrows(() => thunk(), `expected ${code}`);
  expect(error).toBeInstanceOf(ParamValidationError);
  expect((error as ParamValidationError).code).toBe(code);
}

describe("coded engage-selector codes (TestCodedEngageSelectorCodes)", () => {
  it("ES1 direct", () => {
    const f = rawFilter(123, "is set", null);
    expectCode(() => filterToSelector(f), "ES1_PROPERTY_NOT_STRING");
  });

  it("ES1 seam", () => {
    // Python draws a TUPLE `("tup",)`; the ported value domain has no
    // tuple — an array hits the identical "not a str" branch.
    const f = rawFilter(["tup"], "is set", null);
    expectCode(() => filtersToSelector([f]), "ES1_PROPERTY_NOT_STRING");
  });

  it("ES2 direct", () => {
    const f = rawFilter("p", "equals", "notalist");
    expectCode(() => filterToSelector(f), "ES2_EQUALS_EXPECTS_LIST");
  });

  it("ES2 seam", () => {
    const f = rawFilter("p", "equals", 7);
    expectCode(() => filtersToSelector([f]), "ES2_EQUALS_EXPECTS_LIST");
  });

  it("ES3 direct", () => {
    const f = rawFilter("p", "equals", [null]);
    expectCode(() => filterToSelector(f), "ES3_EQUALS_NO_TERMS");
  });

  it("ES3 seam", () => {
    const f = rawFilter("p", "equals", [[1, 2]]);
    expectCode(() => filtersToSelector([f]), "ES3_EQUALS_NO_TERMS");
  });

  it("ES4 direct", () => {
    const f = rawFilter("p", "does not equal", "notalist");
    expectCode(() => filterToSelector(f), "ES4_NOT_EQUALS_EXPECTS_LIST");
  });

  it("ES4 seam", () => {
    const f = rawFilter("p", "does not equal", 3.5);
    expectCode(() => filtersToSelector([f]), "ES4_NOT_EQUALS_EXPECTS_LIST");
  });

  it("ES5 direct", () => {
    const f = rawFilter("p", "does not equal", [null]);
    expectCode(() => filterToSelector(f), "ES5_NOT_EQUALS_NO_TERMS");
  });

  it("ES5 seam", () => {
    const f = rawFilter("p", "does not equal", [[1]]);
    expectCode(() => filtersToSelector([f]), "ES5_NOT_EQUALS_NO_TERMS");
  });

  it("ES6 direct", () => {
    const f = rawFilter("p", "contains", 5);
    expectCode(() => filterToSelector(f), "ES6_CONTAINS_EXPECTS_STR");
  });

  it("ES6 seam", () => {
    const f = rawFilter("p", "contains", ["list"]);
    expectCode(() => filtersToSelector([f]), "ES6_CONTAINS_EXPECTS_STR");
  });

  it("ES7 direct", () => {
    const f = rawFilter("p", "does not contain", 5);
    expectCode(() => filterToSelector(f), "ES7_NOT_CONTAINS_EXPECTS_STR");
  });

  it("ES7 seam", () => {
    const f = rawFilter("p", "does not contain", 0.5);
    expectCode(() => filtersToSelector([f]), "ES7_NOT_CONTAINS_EXPECTS_STR");
  });

  it("ES8 direct", () => {
    const f = rawFilter("p", "is greater than", "x");
    expectCode(() => filterToSelector(f), "ES8_GT_EXPECTS_NUMBER");
  });

  it("ES8 seam", () => {
    const f = rawFilter("p", "is greater than", [1]);
    expectCode(() => filtersToSelector([f]), "ES8_GT_EXPECTS_NUMBER");
  });

  it("ES9 direct", () => {
    const f = rawFilter("p", "is less than", "x");
    expectCode(() => filterToSelector(f), "ES9_LT_EXPECTS_NUMBER");
  });

  it("ES9 seam", () => {
    const f = rawFilter("p", "is less than", null);
    expectCode(() => filtersToSelector([f]), "ES9_LT_EXPECTS_NUMBER");
  });

  it("ES10 direct", () => {
    const f = rawFilter("p", "is between", [1]);
    expectCode(() => filterToSelector(f), "ES10_BETWEEN_EXPECTS_PAIR");
  });

  it("ES10 seam", () => {
    const f = rawFilter("p", "is between", "nope");
    expectCode(() => filtersToSelector([f]), "ES10_BETWEEN_EXPECTS_PAIR");
  });

  it("ES11 direct", () => {
    const f = rawFilter("p", "is between", ["low", 10]);
    expectCode(() => filterToSelector(f), "ES11_BETWEEN_LOWER_NOT_NUMBER");
  });

  it("ES11 seam", () => {
    const f = rawFilter("p", "is between", [null, 10]);
    expectCode(() => filtersToSelector([f]), "ES11_BETWEEN_LOWER_NOT_NUMBER");
  });

  it("ES12 direct", () => {
    const f = rawFilter("p", "is between", [0, "high"]);
    expectCode(() => filterToSelector(f), "ES12_BETWEEN_UPPER_NOT_NUMBER");
  });

  it("ES12 seam", () => {
    const f = rawFilter("p", "is between", [0, null]);
    expectCode(() => filtersToSelector([f]), "ES12_BETWEEN_UPPER_NOT_NUMBER");
  });

  it("ES13 direct", () => {
    const f = rawFilter("p", "was frobnicated", null);
    expectCode(() => filterToSelector(f), "ES13_UNSUPPORTED_OPERATOR");
  });

  it("ES13 seam", () => {
    const f = rawFilter("p", "is within", null);
    expectCode(() => filtersToSelector([f]), "ES13_UNSUPPORTED_OPERATOR");
  });

  it("ES* guards stay catchable as the shared base error", () => {
    const f = rawFilter("p", "was frobnicated", null);

    const error = expectThrows(() => filterToSelector(f));
    // Python: `pytest.raises(ValueError)` + isinstance
    // ParamValidationError. TS twin: descent from the shared base
    // (`MixpanelHeadlessError`) + the same class + the same code.
    expect(error).toBeInstanceOf(MixpanelHeadlessError);
    expect(error).toBeInstanceOf(ParamValidationError);
    expect((error as ParamValidationError).code).toBe(
      "ES13_UNSUPPORTED_OPERATOR",
    );
  });
});

// =============================================================================
// Split-file translations from `tests/test_query_user_structural.py`
// (packet K4 Layer-3 table): TIER 5 edge cases / PBT.
// =============================================================================

/** Twin of the Python `whitelist_characters='"\\' + "\n\r\0"` set. */
const SPECIAL_CHARS = ['"', "\\", "\n", "\r", "\0"] as const;

/**
 * Twin of `st.characters(whitelist_categories=("L","N","P","S","Z"),
 * whitelist_characters='"\\' + "\n\r\0")`.
 *
 * fast-check has no Unicode-category filter, so the category half is
 * drawn from the full code-point domain (`unit: "binary"`, which is a
 * SUPERSET of L/N/P/S/Z — never a narrowing, B2 ASSERT-F1) and the five
 * whitelisted characters are mixed in explicitly so they are reached
 * with high probability, exactly as Hypothesis's whitelist does.
 */
const specialCharText = fc
  .array(
    fc.oneof(
      { weight: 2, arbitrary: fc.constantFrom(...SPECIAL_CHARS) },
      {
        weight: 3,
        arbitrary: fc.string({ minLength: 1, maxLength: 1, unit: "binary" }),
      },
    ),
    { minLength: 0, maxLength: 50 },
  )
  .map((chars) => chars.join(""));

describe("formatValue special characters (TestPbtFormatValueSpecialChars)", () => {
  it("never crashes on special characters", () => {
    fc.assert(
      fc.property(specialCharText, (s) => {
        const result = formatValue(s);

        expect(typeof result).toBe("string");
        expect(result.startsWith('"')).toBe(true);
        expect(result.endsWith('"')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("handles arbitrary Unicode text without crashing", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 100, unit: "binary" }), (s) => {
        const result = formatValue(s);

        expect(typeof result).toBe("string");
        expect(result.startsWith('"')).toBe(true);
        expect(result.endsWith('"')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

// =============================================================================
// NEW (no Python source test) — watchlist #2 multi-occurrence escaping.
//
// Every escaping assert in the Python suite uses a value or property
// name with exactly ONE backslash / ONE quote, where `str.replace` and
// `replaceAll` agree. The single riskiest translation in the port would
// therefore pass its translated tests with a first-occurrence-only
// `String.prototype.replace`. These cases close that hole; the R10.9
// harness's escaping-biased alphabet is the second lock.
// =============================================================================

describe("formatValue / propRef escape ALL occurrences (NEW)", () => {
  it("formatValue escapes every backslash", () => {
    expect(formatValue(String.raw`a\b\c`)).toBe(String.raw`"a\\b\\c"`);
  });

  it("formatValue escapes every double quote", () => {
    expect(formatValue('a"b"c')).toBe(String.raw`"a\"b\"c"`);
  });

  it("formatValue escapes backslashes BEFORE quotes", () => {
    // Input:  \"   (backslash, quote)
    // Python: '\\' -> '\\\\' first, then '"' -> '\\"'  =>  \\\"
    expect(formatValue(String.raw`\"`)).toBe(String.raw`"\\\""`);
  });

  it("formatValue handles a trailing backslash", () => {
    expect(formatValue("a\\")).toBe(String.raw`"a\\"`);
  });

  it("propRef escapes every backslash and quote in the property name", () => {
    const f = Filter.equals(String.raw`a\b"c\d"e`, "v");
    expect(filterToSelector(f)).toBe(
      String.raw`properties["a\\b\"c\\d\"e"] == "v"`,
    );
  });

  it("a selector-injection value stays inert", () => {
    const f = Filter.contains("p", 'properties["x"] == "y" or ');
    expect(filterToSelector(f)).toBe(
      String.raw`"properties[\"x\"] == \"y\" or " in properties["p"]`,
    );
  });
});

describe("formatValue escaping round-trips (NEW, PBT)", () => {
  it("unescaping the quoted body returns the input", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60, unit: "binary" }), (s) => {
        const result = formatValue(s);
        const inner = result.slice(1, -1);
        const unescaped = inner
          .replaceAll(String.raw`\"`, '"')
          .replaceAll("\\\\", "\\");

        expect(unescaped).toBe(s);
      }),
      { numRuns: 500 },
    );
  });
});

describe("filtersToSelector OR/AND precedence (TestFiltersToSelectorOrAndPrecedence)", () => {
  it("multi-value equals stays parenthesized inside an AND chain", () => {
    const f1 = Filter.equals("plan", ["free", "trial"]);
    const f2 = Filter.isSet("email");

    const result = filtersToSelector([f1, f2]);

    expect(result).toBe(
      '(properties["plan"] == "free" or ' +
        'properties["plan"] == "trial") and ' +
        'defined(properties["email"])',
    );
  });
});
