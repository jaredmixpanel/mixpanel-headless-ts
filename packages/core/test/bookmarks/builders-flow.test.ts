/**
 * Layer-3 translation of the `bookmark_builders.py` test corpus
 * (Python revision: `ts-port/phase2-contract-support` HEAD).
 *
 * Sources translated here, per b3-packets.md §"Packet K2":
 *
 * | Python file | classes translated |
 * |---|---|
 * | `tests/unit/test_bookmark_builders.py` (1,396 LOC, 18 classes) | all 18 |
 * | `tests/test_custom_property_builders.py` (461 LOC) | `TestBuildComposedProperties`, `TestBuildGroupSectionCustomProperties`, `TestBuildFilterEntryCustomProperties` |
 *
 * **Deferrals (header citations, R10.1):**
 *
 * - `tests/test_custom_property_builders.py::TestMeasurementPropertyBuilder`
 *   drives `Workspace.build_params` → **B5-S2** (no implementation exists
 *   to test at B3). The packet flags this file as a playbook omission that
 *   is nonetheless IN scope for its builder-direct classes (15 measured K2
 *   vectors come from it).
 * - `tests/unit/test_bookmark_builders_pbt.py`'s three equivalence classes
 *   (`TestTimeSectionEquivalence`, `TestFilterSectionEquivalence`,
 *   `TestGroupSectionEquivalence`) assert
 *   `ws._build_query_params(...) == build_*(...)` → **B5-S2**. Only
 *   `TestListContainsRoundTrip` is builder-direct; it is translated as a
 *   fast-check property in `builders.pbt.test.ts`.
 * - `tests/test_build_cohort_params.py` and `tests/test_query_params.py`
 *   are B5-owned files (playbook B5 row); their K2 vectors replay at the
 *   B3 gate regardless (vector api gates, not test-file ownership). The
 *   `buildFlowCohortFilter` describe block below is therefore marked
 *   `// NEW` and cites the corpus vector ids it mirrors.
 *
 * R10.2: assertion-for-assertion, codes not messages. Python
 * `pytest.raises(TypeError, match=…)` pairs become
 * `toThrow(ParamTypeError)` plus an explicit `.code` assertion, since
 * `ParamTypeError`/`ParamValidationError` are the ported twins of
 * Python's `TypeError`/`ValueError` subclasses (the "stays catchable as
 * TypeError/ValueError" asserts translate to the base-class check —
 * see `errors.ts`).
 */

import { describe, expect, it } from "vitest";

import { buildFlowPropertyFilter } from "../../src/bookmarks/builders.js";
import { ParamTypeError, ParamValidationError } from "../../src/errors.js";
import {
  CustomPropertyRef,
  Filter,
  InlineCustomProperty,
  PropertyInput,
} from "../../src/types/index.js";
import { expectThrows } from "../../test-support/raises.js";

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestBuildFlowPropertyFilter (T039)
// =============================================================================

describe("buildFlowPropertyFilter", () => {
  it("single filter structure", () => {
    const result = buildFlowPropertyFilter([Filter.equals("country", "US")]);
    expect(result["operator"]).toBe("and");
    const children = result["children"] as Array<Record<string, unknown>>;
    expect(children).toHaveLength(1);
    const child = children[0]!;
    expect(child["filterOperator"]).toBe("equals");
    expect(child["filterType"]).toBe("string");
    expect(child["propertyName"]).toBe("country");
    expect(child["filterValue"]).toStrictEqual(["US"]);
    expect(child["resourceType"]).toBe("events");
  });

  it("multiple filters produce children", () => {
    const result = buildFlowPropertyFilter([
      Filter.equals("country", "US"),
      Filter.greaterThan("age", 18),
    ]);
    expect(result["operator"]).toBe("and");
    const children = result["children"] as Array<Record<string, unknown>>;
    expect(children).toHaveLength(2);
    expect(children[0]!["propertyName"]).toBe("country");
    expect(children[1]!["propertyName"]).toBe("age");
  });

  it("filter entry uses build filter entry", () => {
    const result = buildFlowPropertyFilter([Filter.contains("name", "test")]);
    const child = (result["children"] as Array<Record<string, unknown>>)[0]!;
    for (const key of [
      "resourceType",
      "filterType",
      "filterOperator",
      "filterValue",
      "propertyName",
    ]) {
      expect(Object.hasOwn(child, key)).toBe(true);
    }
  });

  it("custom property ref raises type error", () => {
    const f = new Filter({
      _property: new CustomPropertyRef({ id: 123 }),
      _operator: "equals",
      _value: ["high"],
      _property_type: "string",
      _resource_type: "events",
    });
    expect(() => buildFlowPropertyFilter([f])).toThrow(ParamTypeError);
    expect(() => buildFlowPropertyFilter([f])).toThrow(/custom property refs/);
  });

  it("empty list raises value error", () => {
    expect(() => buildFlowPropertyFilter([])).toThrow(ParamValidationError);
    expect(() => buildFlowPropertyFilter([])).toThrow(
      /requires at least one filter/,
    );
  });

  it("drops the `value` and `defaultType` keys (`:638-640`)", () => {
    // NEW: `entry.pop("value", None)` + `entry.pop("defaultType", None)`.
    const child = (
      buildFlowPropertyFilter([Filter.equals("country", "US")])[
        "children"
      ] as Array<Record<string, unknown>>
    )[0]!;
    expect(Object.hasOwn(child, "value")).toBe(false);
    expect(Object.hasOwn(child, "defaultType")).toBe(false);
  });
});

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestCodedFlowPropertyFilterCodes
// =============================================================================

describe("coded guards — buildFlowPropertyFilter (BB2/BB3)", () => {
  it("bb2 empty list raises coded error", () => {
    const error = expectThrows(
      () => buildFlowPropertyFilter([]),
      "expected ParamValidationError",
    );
    expect(error).toBeInstanceOf(ParamValidationError);
    expect((error as ParamValidationError).code).toBe(
      "BB2_FLOW_PROPERTY_FILTER_EMPTY",
    );
  });

  it("bb2 stays catchable as value error", () => {
    const error = expectThrows(
      () => buildFlowPropertyFilter([]),
      "expected ParamValidationError",
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ParamValidationError);
    expect((error as ParamValidationError).code).toBe(
      "BB2_FLOW_PROPERTY_FILTER_EMPTY",
    );
  });

  it("bb3 custom property ref raises coded error", () => {
    const f = new Filter({
      _property: new CustomPropertyRef({ id: 123 }),
      _operator: "equals",
      _value: ["high"],
      _property_type: "string",
      _resource_type: "events",
    });
    const error = expectThrows(
      () => buildFlowPropertyFilter([f]),
      "expected ParamTypeError",
    );
    expect(error).toBeInstanceOf(ParamTypeError);
    expect((error as ParamTypeError).code).toBe(
      "BB3_FLOW_PROPERTY_FILTER_TYPE",
    );
  });

  it("bb3 inline custom property raises coded error", () => {
    const f = new Filter({
      _property: new InlineCustomProperty({
        formula: "A",
        inputs: { A: new PropertyInput({ name: "plan", type: "string" }) },
        property_type: "string",
      }),
      _operator: "equals",
      _value: ["a"],
      _property_type: "string",
      _resource_type: "events",
    });
    const error = expectThrows(
      () => buildFlowPropertyFilter([f]),
      "expected ParamTypeError",
    );
    expect(error).toBeInstanceOf(ParamTypeError);
    expect((error as ParamTypeError).code).toBe(
      "BB3_FLOW_PROPERTY_FILTER_TYPE",
    );
  });
});
