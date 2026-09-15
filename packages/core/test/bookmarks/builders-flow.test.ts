// `buildFlowPropertyFilter` from `bookmarks/builders`, mirroring
// `TestBuildFlowPropertyFilter` and `TestCodedFlowPropertyFilterCodes` from
// `tests/unit/test_bookmark_builders.py`; codes are asserted instead of
// messages. Cases without a Python twin are marked TS-only.
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

// --- Flow property filter (TestBuildFlowPropertyFilter) ---

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

  it("drops the `value` and `defaultType` keys", () => {
    // TS-only: `entry.pop("value", None)` + `entry.pop("defaultType", None)`.
    const child = (
      buildFlowPropertyFilter([Filter.equals("country", "US")])[
        "children"
      ] as Array<Record<string, unknown>>
    )[0]!;
    expect(Object.hasOwn(child, "value")).toBe(false);
    expect(Object.hasOwn(child, "defaultType")).toBe(false);
  });
});

// --- Coded guards (TestCodedFlowPropertyFilterCodes) ---

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
