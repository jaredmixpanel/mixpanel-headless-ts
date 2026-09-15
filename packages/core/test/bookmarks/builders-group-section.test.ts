// `buildGroupSection` (string / GroupBy / listItem / data_group_id / coded
// guards) and `buildComposedProperties` from `bookmarks/builders`. Mirrors the
// group-section classes of `tests/unit/test_bookmark_builders.py` plus
// `TestBuildComposedProperties` and `TestBuildGroupSectionCustomProperties`
// from `tests/test_custom_property_builders.py`; codes asserted, not messages.
import { describe, expect, it } from "vitest";

import {
  buildComposedProperties,
  buildGroupSection,
} from "../../src/bookmarks/builders.js";
import { ParamTypeError } from "../../src/errors.js";
import {
  CohortBreakdown,
  CustomPropertyRef,
  GroupBy,
  InlineCustomProperty,
  ListItemGroupMode,
  PropertyInput,
} from "../../src/types/index.js";
import { expectThrows } from "../../test-support/raises.js";

// --- Group section (TestBuildGroupSection) ---

describe("buildGroupSection", () => {
  it("none returns empty", () => {
    expect(buildGroupSection(null)).toStrictEqual([]);
  });

  it("string group by", () => {
    const result = buildGroupSection("country");
    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry["value"]).toBe("country");
    expect(entry["propertyName"]).toBe("country");
    expect(entry["resourceType"]).toBe("events");
    expect(entry["propertyType"]).toBe("string");
    expect(entry["propertyDefaultType"]).toBe("string");
  });

  it("groupby object", () => {
    const g = new GroupBy({ property: "revenue", property_type: "number" });
    const result = buildGroupSection(g);
    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry["value"]).toBe("revenue");
    expect(entry["propertyName"]).toBe("revenue");
    expect(entry["propertyType"]).toBe("number");
    expect(entry["propertyDefaultType"]).toBe("number");
  });

  it("groupby with buckets", () => {
    const g = new GroupBy({
      property: "amount",
      property_type: "number",
      bucket_size: 10,
      bucket_min: 0,
      bucket_max: 100,
    });
    const entry = buildGroupSection(g)[0]!;
    expect(Object.hasOwn(entry, "customBucket")).toBe(true);
    const bucket = entry["customBucket"] as Record<string, unknown>;
    expect(bucket["bucketSize"]).toBe(10);
    expect(bucket["min"]).toBe(0);
    expect(bucket["max"]).toBe(100);
  });

  it("groupby bucket size only", () => {
    const g = new GroupBy({
      property: "amount",
      property_type: "number",
      bucket_size: 10,
    });
    const entry = buildGroupSection(g)[0]!;
    expect(Object.hasOwn(entry, "customBucket")).toBe(true);
    const bucket = entry["customBucket"] as Record<string, unknown>;
    expect(bucket["bucketSize"]).toBe(10);
    expect(Object.hasOwn(bucket, "min")).toBe(false);
    expect(Object.hasOwn(bucket, "max")).toBe(false);
  });

  it("multiple groups mixed", () => {
    const groups = [
      "country",
      new GroupBy({ property: "revenue", property_type: "number" }),
    ];
    const result = buildGroupSection(groups);
    expect(result).toHaveLength(2);
    expect(result[0]!["value"]).toBe("country");
    expect(result[0]!["propertyType"]).toBe("string");
    expect(result[1]!["value"]).toBe("revenue");
    expect(result[1]!["propertyType"]).toBe("number");
  });

  it("invalid type raises type error", () => {
    expect(() => buildGroupSection(123 as never)).toThrow(ParamTypeError);
    expect(() => buildGroupSection(123 as never)).toThrow(
      /group_by elements must be str, GroupBy, CohortBreakdown, or FrequencyBreakdown/,
    );
  });

  it("invalid element in list raises type error", () => {
    expect(() => buildGroupSection(["country", 42] as never)).toThrow(
      ParamTypeError,
    );
    expect(() => buildGroupSection(["country", 42] as never)).toThrow(
      /group_by elements must be str, GroupBy, CohortBreakdown, or FrequencyBreakdown/,
    );
  });
});

// --- data_group_id threading (TestBuildGroupSectionDataGroupId) ---

describe("buildGroupSection — data_group_id threading", () => {
  it("custom property ref group with data group id", () => {
    const gb = new GroupBy({ property: new CustomPropertyRef({ id: 42 }) });
    const result = buildGroupSection(gb, { data_group_id: 5 });
    expect(result).toHaveLength(1);
    expect(result[0]!["dataGroupId"]).toBe("5");
  });

  it("custom property ref group without data group id", () => {
    const gb = new GroupBy({ property: new CustomPropertyRef({ id: 42 }) });
    const result = buildGroupSection(gb);
    expect(result).toHaveLength(1);
    expect(result[0]!["dataGroupId"]).toBeNull();
  });

  it("inline custom property group with data group id", () => {
    const prop = new InlineCustomProperty({
      formula: "A",
      inputs: {
        A: new PropertyInput({ name: "price", resource_type: "event" }),
      },
    });
    const gb = new GroupBy({ property: prop, property_type: "number" });
    const result = buildGroupSection(gb, { data_group_id: 3 });
    expect(result).toHaveLength(1);
    expect(result[0]!["dataGroupId"]).toBe("3");
  });

  it("cohort breakdown group with data group id", () => {
    const cb = new CohortBreakdown({ cohort: 123, name: "Power Users" });
    const result = buildGroupSection(cb, { data_group_id: 7 });
    expect(result).toHaveLength(1);
    // Contract: GroupClause.dataGroupId is string | null.
    expect(result[0]!["dataGroupId"]).toBe("7");
    // Contract: GroupByCohort.data_group_id is string | null.
    for (const cohort of result[0]!["cohorts"] as Array<
      Record<string, unknown>
    >) {
      expect(cohort["data_group_id"]).toBe("7");
    }
  });

  it("string group unaffected by data group id", () => {
    const result = buildGroupSection("country", { data_group_id: 5 });
    expect(result).toHaveLength(1);
    expect(Object.hasOwn(result[0]!, "dataGroupId")).toBe(false);
  });

  it("none group returns empty", () => {
    expect(buildGroupSection(null, { data_group_id: 5 })).toStrictEqual([]);
  });
});

// --- GroupBy.listItem (TestGroupByListItem) ---

describe("GroupBy.listItem → buildGroupSection", () => {
  it("basic string sub emits listItemGroup", () => {
    const section = buildGroupSection(GroupBy.listItem("cart", "Brand"));
    expect(section).toHaveLength(1);
    const entry = section[0]!;
    expect(entry["dataset"]).toBe("$mixpanel");
    expect(entry["value"]).toBe("cart");
    expect(entry["resourceType"]).toBe("events");
    expect(entry["joinPropertyType"]).toBe("list");
    expect(entry["propertyType"]).toBe("object");
    expect(entry["listItemGroup"]).toStrictEqual({
      resourceType: "event",
      propertyName: "Brand",
      propertyDefaultType: "string",
      propertyType: "string",
    });
  });

  it("number sub type", () => {
    const entry = buildGroupSection(
      GroupBy.listItem("cart", "Price", { sub_type: "number" }),
    )[0]!;
    const lig = entry["listItemGroup"] as Record<string, unknown>;
    expect(lig["propertyType"]).toBe("number");
    expect(lig["propertyDefaultType"]).toBe("number");
  });

  it("pins list item mode set", () => {
    const g = GroupBy.listItem("cart", "Brand");
    expect(g._list_item_mode).not.toBeNull();
    expect(g._list_item_mode!.sub).toBe("Brand");
    expect(g._list_item_mode!.sub_type).toBe("string");
    expect(g.property_type).toBe("string");
  });

  it("rejects bucketing", () => {
    expect(
      () =>
        new GroupBy({
          property: "cart",
          bucket_size: 10,
          _list_item_mode: new ListItemGroupMode({
            sub: "Price",
            sub_type: "number",
          }),
        }),
    ).toThrow(/bucketing/);
  });

  it("rejects non string property on list item", () => {
    expect(
      () =>
        new GroupBy({
          property: new CustomPropertyRef({ id: 42 }),
          _list_item_mode: new ListItemGroupMode({
            sub: "Brand",
            sub_type: "string",
          }),
        }),
    ).toThrow(/plain str/);
  });

  it("list item mode validates empty sub", () => {
    expect(
      () => new ListItemGroupMode({ sub: "", sub_type: "string" }),
    ).toThrow(/non-empty/);
    expect(
      () => new ListItemGroupMode({ sub: " ".repeat(3), sub_type: "string" }),
    ).toThrow(/non-empty/);
  });

  it("list item mode validates sub type content", () => {
    expect(
      () => new ListItemGroupMode({ sub: "Brand", sub_type: "bogus" as never }),
    ).toThrow(/sub_type/);
  });

  it("list item runtime rejects bad sub type", () => {
    expect(() =>
      GroupBy.listItem("cart", "Brand", { sub_type: "bogus" as never }),
    ).toThrow(/sub_type/);
  });

  it("list item runtime rejects empty sub", () => {
    expect(() => GroupBy.listItem("cart", "")).toThrow(/non-empty/);
  });

  it("via build group section in list", () => {
    const section = buildGroupSection([
      "platform",
      GroupBy.listItem("cart", "Brand"),
    ]);
    expect(section).toHaveLength(2);
    expect(section[0]!["value"]).toBe("platform");
    expect(Object.hasOwn(section[1]!, "listItemGroup")).toBe(true);
  });
});

// --- Coded guards (TestCodedGroupSectionCodes) ---

describe("coded guards — buildGroupSection (BB1)", () => {
  it("bb1 scalar element raises coded error", () => {
    const error = expectThrows(
      () => buildGroupSection(123 as never),
      "expected ParamTypeError",
    );
    expect(error).toBeInstanceOf(ParamTypeError);
    expect((error as ParamTypeError).code).toBe("BB1_GROUP_BY_ELEMENT_TYPE");
  });

  it("bb1 invalid element in list raises coded error", () => {
    const error = expectThrows(
      () => buildGroupSection(["country", 42] as never),
      "expected ParamTypeError",
    );
    expect(error).toBeInstanceOf(ParamTypeError);
    expect((error as ParamTypeError).code).toBe("BB1_GROUP_BY_ELEMENT_TYPE");
  });

  it("bb1 stays catchable as type error", () => {
    // Python: `pytest.raises(TypeError)` + `isinstance(exc, ParamTypeError)`.
    // TS twin: ParamTypeError IS the ported TypeError analogue; the
    // base-class half of the assert is `instanceof Error`.
    const error = expectThrows(
      () => buildGroupSection([null] as never),
      "expected ParamTypeError",
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ParamTypeError);
    expect((error as ParamTypeError).code).toBe("BB1_GROUP_BY_ELEMENT_TYPE");
  });
});

// --- Composed properties (TestBuildComposedProperties) ---

describe("buildComposedProperties", () => {
  it("single input", () => {
    const result = buildComposedProperties({
      A: new PropertyInput({ name: "price", type: "number" }),
    });
    expect(result).toStrictEqual({
      A: { value: "price", type: "number", resourceType: "event" },
    });
  });

  it("multiple inputs", () => {
    const result = buildComposedProperties({
      A: new PropertyInput({ name: "price", type: "number" }),
      B: new PropertyInput({ name: "quantity", type: "number" }),
    });
    expect(Object.keys(result)).toHaveLength(2);
    expect(result["A"]!["value"]).toBe("price");
    expect(result["B"]!["value"]).toBe("quantity");
    expect(result["A"]!["type"]).toBe("number");
    expect(result["B"]!["type"]).toBe("number");
    expect(result["A"]!["resourceType"]).toBe("event");
    expect(result["B"]!["resourceType"]).toBe("event");
  });

  it("user resource type preserved", () => {
    const result = buildComposedProperties({
      A: new PropertyInput({
        name: "email",
        type: "string",
        resource_type: "user",
      }),
    });
    expect(result["A"]!["resourceType"]).toBe("user");
  });

  it("default values", () => {
    const result = buildComposedProperties({
      A: new PropertyInput({ name: "country" }),
    });
    expect(result["A"]).toStrictEqual({
      value: "country",
      type: "string",
      resourceType: "event",
    });
  });
});

// --- Custom properties (TestBuildGroupSectionCustomProperties) ---

describe("buildGroupSection — custom properties", () => {
  it("T017 plain string unchanged", () => {
    const result = buildGroupSection("country");
    expect(result).toHaveLength(1);
    expect(result[0]!["value"]).toBe("country");
    expect(result[0]!["propertyName"]).toBe("country");
    expect(result[0]!["resourceType"]).toBe("events");
  });

  it("T018 custom property ref", () => {
    const g = new GroupBy({
      property: new CustomPropertyRef({ id: 42 }),
      property_type: "number",
    });
    const result = buildGroupSection(g);
    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry["customPropertyId"]).toBe(42);
    expect(entry["propertyType"]).toBe("number");
    expect(entry["resourceType"]).toBe("events");
    expect(entry["dataset"]).toBe("$mixpanel");
    expect(entry["isHidden"]).toBe(false);
    expect(Object.hasOwn(entry, "propertyName")).toBe(false);
  });

  it("T019 inline custom property", () => {
    const icp = InlineCustomProperty.numeric("A * B", {
      A: "price",
      B: "quantity",
    });
    const g = new GroupBy({ property: icp, property_type: "number" });
    const entry = buildGroupSection(g)[0]!;
    expect(Object.hasOwn(entry, "customProperty")).toBe(true);
    const cp = entry["customProperty"] as Record<string, unknown>;
    expect(cp["displayFormula"]).toBe("A * B");
    const composed = cp["composedProperties"] as Record<
      string,
      Record<string, string>
    >;
    expect(Object.hasOwn(composed, "A")).toBe(true);
    expect(Object.hasOwn(composed, "B")).toBe(true);
    expect(composed["A"]!["value"]).toBe("price");
    expect(cp["propertyType"]).toBe("number");
    expect(cp["resourceType"]).toBe("events");
    expect(entry["propertyType"]).toBe("number");
    expect(entry["resourceType"]).toBe("events");
    expect(entry["dataset"]).toBe("$mixpanel");
    expect(entry["isHidden"]).toBe(false);
    expect(Object.hasOwn(entry, "propertyName")).toBe(false);
  });

  it("T020 bucketing with custom property ref", () => {
    const g = new GroupBy({
      property: new CustomPropertyRef({ id: 42 }),
      property_type: "number",
      bucket_size: 100,
      bucket_min: 0,
      bucket_max: 1000,
    });
    const entry = buildGroupSection(g)[0]!;
    expect(entry["customPropertyId"]).toBe(42);
    expect(entry["customBucket"]).toStrictEqual({
      bucketSize: 100,
      min: 0,
      max: 1000,
    });
  });

  it("T020 bucketing with inline custom property", () => {
    const icp = InlineCustomProperty.numeric("A * B", {
      A: "price",
      B: "qty",
    });
    const g = new GroupBy({
      property: icp,
      property_type: "number",
      bucket_size: 50,
      bucket_min: 0,
      bucket_max: 500,
    });
    const entry = buildGroupSection(g)[0]!;
    expect(Object.hasOwn(entry, "customProperty")).toBe(true);
    expect(entry["customBucket"]).toStrictEqual({
      bucketSize: 50,
      min: 0,
      max: 500,
    });
  });

  it("T021 inline property type overrides group by", () => {
    const icp = new InlineCustomProperty({
      formula: 'IFS(A > 1000, "Enterprise", TRUE, "Free")',
      inputs: { A: new PropertyInput({ name: "amount", type: "number" }) },
      property_type: "string",
    });
    const g = new GroupBy({ property: icp, property_type: "number" });
    const entry = buildGroupSection(g)[0]!;
    expect(
      (entry["customProperty"] as Record<string, unknown>)["propertyType"],
    ).toBe("string");
    expect(entry["propertyType"]).toBe("string");
  });

  it("T021b inline property type none falls back", () => {
    const icp = new InlineCustomProperty({
      formula: "A",
      inputs: { A: new PropertyInput({ name: "revenue", type: "number" }) },
      property_type: null,
    });
    const g = new GroupBy({ property: icp, property_type: "number" });
    const entry = buildGroupSection(g)[0]!;
    expect(
      (entry["customProperty"] as Record<string, unknown>)["propertyType"],
    ).toBe("number");
    expect(entry["propertyType"]).toBe("number");
  });

  it("T022 mixed group by list", () => {
    const groups = [
      "country",
      new GroupBy({
        property: new CustomPropertyRef({ id: 42 }),
        property_type: "number",
      }),
      new GroupBy({
        property: InlineCustomProperty.numeric("A", { A: "revenue" }),
        property_type: "number",
      }),
    ];
    const result = buildGroupSection(groups);
    expect(result).toHaveLength(3);
    expect(result[0]!["value"]).toBe("country");
    expect(result[1]!["customPropertyId"]).toBe(42);
    expect(Object.hasOwn(result[2]!, "customProperty")).toBe(true);
  });
});
