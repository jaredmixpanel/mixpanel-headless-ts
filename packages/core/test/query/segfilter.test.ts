/**
 * Layer-3 translation of `tests/unit/test_segfilter.py` (634 LOC, 10
 * classes; Python revision: `ts-port/phase2-contract-support` HEAD),
 * per `b3-packets.md` §"Packet K3" — ALL classes translate here, no
 * deferrals.
 *
 * R10.2 notes (assertion-for-assertion, codes not messages):
 *
 * - Python's `pytest.raises(ValueError, match="Unknown string operator")`
 *   asserts on MESSAGE text, which is explicitly out of contract (R5.4).
 *   Each such assert translates to the exception CLASS
 *   (`ParamValidationError` — the ported twin of Python's
 *   `ParamValidationError(MixpanelHeadlessError, ValueError)`) plus the
 *   registry `.code` that identifies the same guard. No assertion is
 *   dropped: the `match=` string and the `.code` name the same branch.
 * - `test_sg_guards_stay_catchable_as_value_error` asserts Python's dual
 *   inheritance (`except ValueError` reachability). TS has no
 *   `ValueError`; the ported invariant is descent from
 *   `MixpanelHeadlessError` (errors.ts header: "in TS the conformance key
 *   is class name + code, so plain MixpanelHeadlessError descent
 *   suffices"), asserted as such.
 * - Python's `# type: ignore[arg-type]` deliberate-invalid inputs become
 *   `as FilterOperator` / `as FilterPropertyType` casts at the same call
 *   sites.
 * - `isinstance(result["filter"]["operand"], str)` →
 *   `typeof … === "string"`.
 * - `"operator" not in result["filter"]` → `Object.hasOwn(...) === false`
 *   (watchlist #7 — `in` would also see prototype keys).
 */

import { describe, expect, it } from "vitest";

import {
  MixpanelHeadlessError,
  ParamValidationError,
} from "../../src/errors.js";
import { Filter } from "../../src/types/index.js";
import type {
  FilterOperator,
  FilterPropertyType,
} from "../../src/types/literals.js";
import {
  RESOURCE_TYPE_MAP,
  buildDatetimeFilter,
  buildNumberFilter,
  buildSegfilterEntry,
  buildStringFilter,
  convertDateFormat,
} from "../../src/query/segfilter.js";

/** Narrow the `filter` sub-dict of a segfilter entry for assertions. */
function filterOf(entry: Record<string, unknown>): Record<string, unknown> {
  return entry["filter"] as Record<string, unknown>;
}

/** Narrow the `property` sub-dict of a segfilter entry for assertions. */
function propertyOf(entry: Record<string, unknown>): Record<string, unknown> {
  return entry["property"] as Record<string, unknown>;
}

// =============================================================================
// String Operators (TestSegfilterStringOperators)
// =============================================================================

describe("segfilter string operators", () => {
  it("Filter.equals produces operator '==' with list operand", () => {
    const f = Filter.equals("country", "US");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("==");
    expect(filterOf(result)["operand"]).toEqual(["US"]);
  });

  it("Filter.equals with a list produces operator '==' with list operand", () => {
    const f = Filter.equals("country", ["US", "UK"]);
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("==");
    expect(filterOf(result)["operand"]).toEqual(["US", "UK"]);
  });

  it("Filter.notEquals produces operator '!=' with list operand", () => {
    const f = Filter.notEquals("country", "US");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("!=");
    expect(filterOf(result)["operand"]).toEqual(["US"]);
  });

  it("Filter.contains produces operator 'in' with string operand", () => {
    const f = Filter.contains("name", "john");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("in");
    expect(filterOf(result)["operand"]).toBe("john");
  });

  it("Filter.notContains produces operator 'not in' with string operand", () => {
    const f = Filter.notContains("name", "john");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("not in");
    expect(filterOf(result)["operand"]).toBe("john");
  });

  it("Filter.isSet produces operator 'set' with empty string operand", () => {
    const f = Filter.isSet("email");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("set");
    expect(filterOf(result)["operand"]).toBe("");
  });

  it("Filter.isNotSet produces operator 'not set' with empty string operand", () => {
    const f = Filter.isNotSet("email");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("not set");
    expect(filterOf(result)["operand"]).toBe("");
  });
});

// =============================================================================
// Number Operators (TestSegfilterNumberOperators)
// =============================================================================

describe("segfilter number operators", () => {
  it("Filter.greaterThan produces operator '>' with stringified operand", () => {
    const f = Filter.greaterThan("amount", 50);
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe(">");
    expect(filterOf(result)["operand"]).toBe("50");
  });

  it("Filter.lessThan produces operator '<' with stringified operand", () => {
    const f = Filter.lessThan("amount", 50);
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("<");
    expect(filterOf(result)["operand"]).toBe("50");
  });

  it("numeric integer values are stringified in segfilter output", () => {
    const f = Filter.greaterThan("count", 100);
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operand"]).toBe("100");
    expect(typeof filterOf(result)["operand"]).toBe("string");
  });

  it("numeric float values are stringified in segfilter output", () => {
    const f = Filter.greaterThan("price", 9.99);
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operand"]).toBe("9.99");
    expect(typeof filterOf(result)["operand"]).toBe("string");
  });

  it("Filter.between produces operator '><' with stringified list operand", () => {
    const f = Filter.between("amount", 10, 100);
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("><");
    expect(filterOf(result)["operand"]).toEqual(["10", "100"]);
  });

  it("number is set uses 'is set' operator with empty string operand", () => {
    const f = new Filter({
      _property: "score",
      _operator: "is set",
      _value: null,
      _property_type: "number",
      _resource_type: "events",
    });
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("is set");
    expect(filterOf(result)["operand"]).toBe("");
  });

  it("number is not set uses 'is not set' operator with empty string operand", () => {
    const f = new Filter({
      _property: "score",
      _operator: "is not set",
      _value: null,
      _property_type: "number",
      _resource_type: "events",
    });
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("is not set");
    expect(filterOf(result)["operand"]).toBe("");
  });

  it("number 'equals' maps to '==' with stringified operand", () => {
    const f = new Filter({
      _property: "count",
      _operator: "equals",
      _value: 42,
      _property_type: "number",
      _resource_type: "events",
    });
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("==");
    expect(filterOf(result)["operand"]).toBe("42");
  });

  it("number 'is equal to' maps to '==' with stringified operand", () => {
    // Backward-compat dispatch alias; no Filter factory produces it
    // (Python marks the same line `# type: ignore[arg-type]`).
    const f = new Filter({
      _property: "count",
      _operator: "is equal to" as FilterOperator,
      _value: 42,
      _property_type: "number",
      _resource_type: "events",
    });
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("==");
    expect(filterOf(result)["operand"]).toBe("42");
  });

  it("number 'does not equal' maps to '!=' with stringified operand", () => {
    const f = new Filter({
      _property: "count",
      _operator: "does not equal",
      _value: 7,
      _property_type: "number",
      _resource_type: "events",
    });
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("!=");
    expect(filterOf(result)["operand"]).toBe("7");
  });

  it("number 'is at least' maps to '>=' with stringified operand", () => {
    const f = new Filter({
      _property: "count",
      _operator: "is at least",
      _value: 5,
      _property_type: "number",
      _resource_type: "events",
    });
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe(">=");
    expect(filterOf(result)["operand"]).toBe("5");
  });

  it("number 'is at most' maps to '<=' with stringified operand", () => {
    const f = new Filter({
      _property: "count",
      _operator: "is at most",
      _value: 10,
      _property_type: "number",
      _resource_type: "events",
    });
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("<=");
    expect(filterOf(result)["operand"]).toBe("10");
  });

  it("number 'not between' maps to '!><' with stringified list operand", () => {
    const f = new Filter({
      _property: "amount",
      _operator: "not between",
      _value: [10, 100],
      _property_type: "number",
      _resource_type: "events",
    });
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("!><");
    expect(filterOf(result)["operand"]).toEqual(["10", "100"]);
  });
});

// =============================================================================
// Boolean Operators (TestSegfilterBooleanOperators)
// =============================================================================

describe("segfilter boolean operators", () => {
  it("Filter.isTrue produces operand 'true' with NO 'operator' key", () => {
    const f = Filter.isTrue("verified");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operand"]).toBe("true");
    expect(Object.hasOwn(filterOf(result), "operator")).toBe(false);
  });

  it("Filter.isFalse produces operand 'false' with NO 'operator' key", () => {
    const f = Filter.isFalse("verified");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operand"]).toBe("false");
    expect(Object.hasOwn(filterOf(result), "operator")).toBe(false);
  });
});

// =============================================================================
// Datetime Operators (TestSegfilterDatetimeOperators)
// =============================================================================

describe("segfilter datetime operators", () => {
  it("Filter.on produces operator '==' with MM/DD/YYYY operand", () => {
    const f = Filter.on("$time", "2026-01-15");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("==");
    expect(filterOf(result)["operand"]).toBe("01/15/2026");
  });

  it("Filter.notOn produces operator '!=' with MM/DD/YYYY operand", () => {
    const f = Filter.notOn("$time", "2026-01-15");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("!=");
    expect(filterOf(result)["operand"]).toBe("01/15/2026");
  });

  it("Filter.before produces operator '>' with MM/DD/YYYY operand", () => {
    const f = Filter.before("$time", "2026-01-15");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe(">");
    expect(filterOf(result)["operand"]).toBe("01/15/2026");
  });

  it("Filter.since produces operator '<' with MM/DD/YYYY operand", () => {
    const f = Filter.since("$time", "2026-01-15");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("<");
    expect(filterOf(result)["operand"]).toBe("01/15/2026");
  });

  it("Filter.inTheLast produces operator '>' with quantity and unit", () => {
    const f = Filter.inTheLast("$time", 7, "day");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe(">");
    expect(filterOf(result)["operand"]).toBe(7);
    expect(filterOf(result)["unit"]).toBe("days");
  });

  it("Filter.notInTheLast produces operator '>' with quantity and unit", () => {
    const f = Filter.notInTheLast("$time", 3, "week");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe(">");
    expect(filterOf(result)["operand"]).toBe(3);
    expect(filterOf(result)["unit"]).toBe("weeks");
  });

  it("Filter.dateBetween produces operator '><' with MM/DD/YYYY list", () => {
    const f = Filter.dateBetween("$time", "2026-01-01", "2026-01-31");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operator"]).toBe("><");
    expect(filterOf(result)["operand"]).toEqual(["01/01/2026", "01/31/2026"]);
  });

  it("YYYY-MM-DD dates are converted to MM/DD/YYYY in output", () => {
    const f = Filter.on("$time", "2026-03-05");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["operand"]).toBe("03/05/2026");
  });

  it("absolute date filters do NOT have a 'unit' key in filter dict", () => {
    const f = Filter.on("$time", "2026-01-15");
    const result = buildSegfilterEntry(f);

    expect(Object.hasOwn(filterOf(result), "unit")).toBe(false);
  });

  it("relative date with hour unit pluralizes to 'hours'", () => {
    const f = Filter.inTheLast("$time", 24, "hour");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["unit"]).toBe("hours");
  });

  it("relative date with month unit pluralizes to 'months'", () => {
    const f = Filter.inTheLast("$time", 3, "month");
    const result = buildSegfilterEntry(f);

    expect(filterOf(result)["unit"]).toBe("months");
  });
});

// =============================================================================
// Resource Type Mapping (TestSegfilterResourceTypeMapping)
// =============================================================================

describe("segfilter resource-type mapping", () => {
  it("resource_type 'events' maps to property.source 'properties'", () => {
    const f = Filter.equals("country", "US", { resource_type: "events" });
    const result = buildSegfilterEntry(f);

    expect(propertyOf(result)["source"]).toBe("properties");
  });

  it("resource_type 'people' maps to property.source 'user'", () => {
    const f = Filter.equals("plan", "premium", { resource_type: "people" });
    const result = buildSegfilterEntry(f);

    expect(propertyOf(result)["source"]).toBe("user");
  });

  it("RESOURCE_TYPE_MAP contains expected entries", () => {
    expect(RESOURCE_TYPE_MAP.get("events")).toBe("properties");
    expect(RESOURCE_TYPE_MAP.get("people")).toBe("user");
  });
});

// =============================================================================
// Output Structure (TestSegfilterStructure)
// =============================================================================

describe("segfilter output structure", () => {
  it("output dict has 'property', 'type', 'selected_property_type', 'filter'", () => {
    const f = Filter.equals("country", "US");
    const result = buildSegfilterEntry(f);

    expect(Object.hasOwn(result, "property")).toBe(true);
    expect(Object.hasOwn(result, "type")).toBe(true);
    expect(Object.hasOwn(result, "selected_property_type")).toBe(true);
    expect(Object.hasOwn(result, "filter")).toBe(true);
  });

  it("property dict contains 'name', 'source', 'type'", () => {
    const f = Filter.equals("country", "US");
    const result = buildSegfilterEntry(f);

    const prop = propertyOf(result);
    expect(prop["name"]).toBe("country");
    expect(prop["source"]).toBe("properties");
    expect(prop["type"]).toBe("string");
  });

  it("type, selected_property_type, and property.type are all the same", () => {
    const f = Filter.greaterThan("amount", 50);
    const result = buildSegfilterEntry(f);

    expect(result["type"]).toBe("number");
    expect(result["selected_property_type"]).toBe("number");
    expect(propertyOf(result)["type"]).toBe("number");
  });

  it("boolean filters have 'boolean' in all type fields", () => {
    const f = Filter.isTrue("verified");
    const result = buildSegfilterEntry(f);

    expect(result["type"]).toBe("boolean");
    expect(result["selected_property_type"]).toBe("boolean");
    expect(propertyOf(result)["type"]).toBe("boolean");
  });

  it("datetime filters have 'datetime' in all type fields", () => {
    const f = Filter.on("$time", "2026-01-15");
    const result = buildSegfilterEntry(f);

    expect(result["type"]).toBe("datetime");
    expect(result["selected_property_type"]).toBe("datetime");
    expect(propertyOf(result)["type"]).toBe("datetime");
  });

  it("the property name from the Filter is used as-is", () => {
    const f = Filter.equals("$browser", "Chrome");
    const result = buildSegfilterEntry(f);

    expect(propertyOf(result)["name"]).toBe("$browser");
  });
});

// =============================================================================
// Helper Functions (TestConvertDateFormat)
// =============================================================================

describe("convertDateFormat", () => {
  it("YYYY-MM-DD converts to MM/DD/YYYY", () => {
    expect(convertDateFormat("2026-01-15")).toBe("01/15/2026");
  });

  it("month and day leading zeros are preserved", () => {
    expect(convertDateFormat("2026-03-05")).toBe("03/05/2026");
  });

  it("December date converts correctly", () => {
    expect(convertDateFormat("2025-12-31")).toBe("12/31/2025");
  });
});

// =============================================================================
// Edge Cases (TestSegfilterEdgeCases)
// =============================================================================

describe("segfilter edge cases", () => {
  it("unknown operator for a property type raises the string guard", () => {
    const f = new Filter({
      _property: "x",
      _operator: "magical_unicorn" as FilterOperator,
      _value: "y",
      _property_type: "string",
      _resource_type: "events",
    });

    expect(() => buildSegfilterEntry(f)).toThrow(ParamValidationError);
    // R5.4: `match="Unknown string operator"` is message text; the code
    // names the same guard.
    try {
      buildSegfilterEntry(f);
      expect.unreachable("expected SG1");
    } catch (exc) {
      expect((exc as ParamValidationError).code).toBe(
        "SG1_UNKNOWN_STRING_OPERATOR",
      );
    }
  });

  it("unknown number operator raises the number guard", () => {
    const f = new Filter({
      _property: "x",
      _operator: "magical_unicorn" as FilterOperator,
      _value: 1,
      _property_type: "number",
      _resource_type: "events",
    });

    expect(() => buildSegfilterEntry(f)).toThrow(ParamValidationError);
    try {
      buildSegfilterEntry(f);
      expect.unreachable("expected SG2");
    } catch (exc) {
      expect((exc as ParamValidationError).code).toBe(
        "SG2_UNKNOWN_NUMBER_OPERATOR",
      );
    }
  });

  it("unknown datetime operator raises the datetime guard", () => {
    const f = new Filter({
      _property: "x",
      _operator: "magical_unicorn" as FilterOperator,
      _value: "2026-01-01",
      _property_type: "datetime",
      _resource_type: "events",
    });

    expect(() => buildSegfilterEntry(f)).toThrow(ParamValidationError);
    try {
      buildSegfilterEntry(f);
      expect.unreachable("expected SG3");
    } catch (exc) {
      expect((exc as ParamValidationError).code).toBe(
        "SG3_UNKNOWN_DATETIME_OPERATOR",
      );
    }
  });

  it("unknown property type raises the property-type guard", () => {
    const f = new Filter({
      _property: "x",
      _operator: "equals",
      _value: "y",
      _property_type: "list",
      _resource_type: "events",
    });

    expect(() => buildSegfilterEntry(f)).toThrow(ParamValidationError);
    try {
      buildSegfilterEntry(f);
      expect.unreachable("expected SG4");
    } catch (exc) {
      expect((exc as ParamValidationError).code).toBe(
        "SG4_UNSUPPORTED_PROPERTY_TYPE",
      );
    }
  });
});

// =============================================================================
// Coded guard errors (TestCodedSegfilterCodes)
// =============================================================================

/**
 * Build a directly-constructed Filter for coded-guard seam tests
 * (`test_segfilter.py::_filter_with`).
 *
 * @param operator - Raw `_operator` value (may be deliberately invalid).
 * @param value - Raw `_value` payload.
 * @param propertyType - Raw `_property_type` value (may be invalid).
 * @returns A `Filter` bypassing the factory constructors.
 */
function filterWith(
  operator: string,
  value: unknown,
  propertyType: string,
): Filter {
  return new Filter({
    _property: "x",
    _operator: operator as FilterOperator,
    _value: value as string,
    _property_type: propertyType as FilterPropertyType,
    _resource_type: "events",
  });
}

describe("coded segfilter guards", () => {
  it.each(["magical_unicorn", "was on"])(
    "buildStringFilter with unknown operator %s raises SG1",
    (operator) => {
      try {
        buildStringFilter(operator, "y");
        expect.unreachable("expected SG1");
      } catch (exc) {
        expect(exc).toBeInstanceOf(ParamValidationError);
        expect((exc as ParamValidationError).code).toBe(
          "SG1_UNKNOWN_STRING_OPERATOR",
        );
      }
    },
  );

  it("buildSegfilterEntry surfaces SG1 for unknown string operators", () => {
    const f = filterWith("magical_unicorn", "y", "string");
    try {
      buildSegfilterEntry(f);
      expect.unreachable("expected SG1");
    } catch (exc) {
      expect(exc).toBeInstanceOf(ParamValidationError);
      expect((exc as ParamValidationError).code).toBe(
        "SG1_UNKNOWN_STRING_OPERATOR",
      );
    }
  });

  it.each(["magical_unicorn", "contains"])(
    "buildNumberFilter with unknown operator %s raises SG2",
    (operator) => {
      try {
        buildNumberFilter(operator, 1);
        expect.unreachable("expected SG2");
      } catch (exc) {
        expect(exc).toBeInstanceOf(ParamValidationError);
        expect((exc as ParamValidationError).code).toBe(
          "SG2_UNKNOWN_NUMBER_OPERATOR",
        );
      }
    },
  );

  it("buildSegfilterEntry surfaces SG2 for unknown number operators", () => {
    const f = filterWith("magical_unicorn", 1, "number");
    try {
      buildSegfilterEntry(f);
      expect.unreachable("expected SG2");
    } catch (exc) {
      expect(exc).toBeInstanceOf(ParamValidationError);
      expect((exc as ParamValidationError).code).toBe(
        "SG2_UNKNOWN_NUMBER_OPERATOR",
      );
    }
  });

  it.each(["magical_unicorn", "is at least"])(
    "buildDatetimeFilter with unknown operator %s raises SG3",
    (operator) => {
      try {
        buildDatetimeFilter(operator, "2026-01-01", null);
        expect.unreachable("expected SG3");
      } catch (exc) {
        expect(exc).toBeInstanceOf(ParamValidationError);
        expect((exc as ParamValidationError).code).toBe(
          "SG3_UNKNOWN_DATETIME_OPERATOR",
        );
      }
    },
  );

  it("buildSegfilterEntry surfaces SG3 for unknown datetime operators", () => {
    const f = filterWith("magical_unicorn", "2026-01-01", "datetime");
    try {
      buildSegfilterEntry(f);
      expect.unreachable("expected SG3");
    } catch (exc) {
      expect(exc).toBeInstanceOf(ParamValidationError);
      expect((exc as ParamValidationError).code).toBe(
        "SG3_UNKNOWN_DATETIME_OPERATOR",
      );
    }
  });

  it.each(["list", "object"])(
    "buildSegfilterEntry raises SG4 for unsupported property type %s",
    (propertyType) => {
      const f = filterWith("equals", "y", propertyType);
      try {
        buildSegfilterEntry(f);
        expect.unreachable("expected SG4");
      } catch (exc) {
        expect(exc).toBeInstanceOf(ParamValidationError);
        expect((exc as ParamValidationError).code).toBe(
          "SG4_UNSUPPORTED_PROPERTY_TYPE",
        );
      }
    },
  );

  it("converted SG* guards stay catchable as the library base error", () => {
    // Python: `pytest.raises(ValueError)` + `isinstance(exc,
    // ParamValidationError)` — the dual-inheritance reachability assert.
    // TS twin: descent from `MixpanelHeadlessError` (errors.ts header).
    const f = filterWith("equals", "y", "object");
    try {
      buildSegfilterEntry(f);
      expect.unreachable("expected SG4");
    } catch (exc) {
      expect(exc).toBeInstanceOf(MixpanelHeadlessError);
      expect(exc).toBeInstanceOf(ParamValidationError);
      expect((exc as ParamValidationError).code).toBe(
        "SG4_UNSUPPORTED_PROPERTY_TYPE",
      );
    }
  });
});
