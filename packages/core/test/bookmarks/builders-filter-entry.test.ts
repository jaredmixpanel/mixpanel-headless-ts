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

import {
  buildFilterEntry,
  buildFilterSection,
  patchCustomPropertyFiltersForTransform,
} from "../../src/bookmarks/builders.js";
import { ParamTypeError, ParamValidationError } from "../../src/errors.js";
import {
  CustomPropertyRef,
  Filter,
  InlineCustomProperty,
  PropertyInput,
} from "../../src/types/index.js";

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestBuildFilterSection
// =============================================================================

describe("buildFilterSection", () => {
  it("none returns empty", () => {
    expect(buildFilterSection(null)).toStrictEqual([]);
  });

  it("single filter", () => {
    const f = Filter.equals("country", "US");
    const result = buildFilterSection(f);
    expect(result).toHaveLength(1);
    expect(result[0]!["value"]).toBe("country");
    expect(result[0]!["filterOperator"]).toBe("equals");
  });

  it("multiple filters", () => {
    const filters = [
      Filter.equals("country", "US"),
      Filter.greaterThan("age", 18),
    ];
    const result = buildFilterSection(filters);
    expect(result).toHaveLength(2);
    expect(result[0]!["value"]).toBe("country");
    expect(result[0]!["filterOperator"]).toBe("equals");
    expect(result[1]!["value"]).toBe("age");
    expect(result[1]!["filterOperator"]).toBe("is greater than");
  });

  it("single filter entry structure", () => {
    const f = Filter.equals("country", "US");
    const entry = buildFilterSection(f)[0]!;
    for (const key of [
      "resourceType",
      "filterType",
      "defaultType",
      "value",
      "filterValue",
      "filterOperator",
    ]) {
      expect(Object.hasOwn(entry, key)).toBe(true);
    }
  });

  it("silently skips foreign elements (no else branch, :200-204)", () => {
    // NEW (packet §K2 range 173-205): Python has NO else clause, so a
    // non-Filter element is DROPPED, not rejected.
    const result = buildFilterSection([
      Filter.equals("country", "US"),
      42 as unknown as Filter,
      null as unknown as Filter,
      { filterOperator: "equals" } as unknown as Filter,
      Filter.greaterThan("age", 18),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]!["value"]).toBe("country");
    expect(result[1]!["value"]).toBe("age");
  });
});

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestBuildFilterEntry
// =============================================================================

describe("buildFilterEntry", () => {
  it("string filter", () => {
    const entry = buildFilterEntry(Filter.equals("country", "US"));
    expect(entry["resourceType"]).toBe("events");
    expect(entry["filterType"]).toBe("string");
    expect(entry["defaultType"]).toBe("string");
    expect(entry["value"]).toBe("country");
    expect(entry["filterValue"]).toStrictEqual(["US"]);
    expect(entry["filterOperator"]).toBe("equals");
    expect(Object.hasOwn(entry, "filterDateUnit")).toBe(false);
  });

  it("number filter", () => {
    const entry = buildFilterEntry(Filter.greaterThan("age", 18));
    expect(entry["filterType"]).toBe("number");
    expect(entry["defaultType"]).toBe("number");
    expect(entry["value"]).toBe("age");
    // R10.12: native JSON number, never the string "18".
    expect(entry["filterValue"]).toBe(18);
    expect(entry["filterOperator"]).toBe("is greater than");
    expect(Object.hasOwn(entry, "filterDateUnit")).toBe(false);
  });

  it("boolean filter", () => {
    const entry = buildFilterEntry(Filter.isTrue("verified"));
    expect(entry["filterType"]).toBe("boolean");
    expect(entry["defaultType"]).toBe("boolean");
    expect(entry["value"]).toBe("verified");
    expect(entry["filterValue"]).toBeNull();
    expect(entry["filterOperator"]).toBe("true");
    expect(Object.hasOwn(entry, "filterDateUnit")).toBe(false);
  });

  it("datetime filter with date unit", () => {
    const entry = buildFilterEntry(Filter.inTheLast("$time", 7, "day"));
    expect(entry["filterType"]).toBe("datetime");
    expect(entry["defaultType"]).toBe("datetime");
    expect(entry["value"]).toBe("$time");
    expect(entry["filterValue"]).toBe(7);
    expect(entry["filterOperator"]).toBe("was in the");
    expect(entry["filterDateUnit"]).toBe("day");
  });

  it("datetime filter without date unit", () => {
    const entry = buildFilterEntry(Filter.on("created", "2025-01-15"));
    expect(entry["filterType"]).toBe("datetime");
    expect(entry["filterOperator"]).toBe("was on");
    expect(Object.hasOwn(entry, "filterDateUnit")).toBe(false);
  });

  it("people resource type", () => {
    const entry = buildFilterEntry(
      Filter.equals("plan", "premium", { resource_type: "people" }),
    );
    expect(entry["resourceType"]).toBe("people");
  });

  it("custom property ref omits value", () => {
    const ref = new CustomPropertyRef({ id: 90553 });
    const entry = buildFilterEntry(Filter.isSet(ref));
    expect(entry["customPropertyId"]).toBe(90553);
    expect(Object.hasOwn(entry, "value")).toBe(false);
    expect(entry["dataset"]).toBe("$mixpanel");
  });

  it("inline custom property omits value", () => {
    const icp = new InlineCustomProperty({
      formula: "A",
      inputs: { A: new PropertyInput({ name: "price", type: "number" }) },
      property_type: "number",
    });
    const entry = buildFilterEntry(Filter.greaterThan(icp, 1000));
    expect(Object.hasOwn(entry, "customProperty")).toBe(true);
    expect(Object.hasOwn(entry, "value")).toBe(false);
    expect(entry["dataset"]).toBe("$mixpanel");
  });
});

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestNewFilterOperatorsInBuilder
// =============================================================================

describe("buildFilterEntry — new filter operators (T030)", () => {
  it("not between filter operator", () => {
    const entry = buildFilterEntry(Filter.notBetween("age", 18, 65));
    expect(entry["filterOperator"]).toBe("not between");
    expect(entry["filterType"]).toBe("number");
    expect(entry["filterValue"]).toStrictEqual([18, 65]);
  });

  it("starts with filter operator", () => {
    const entry = buildFilterEntry(Filter.startsWith("url", "https://"));
    expect(entry["filterOperator"]).toBe("starts with");
    expect(entry["filterType"]).toBe("string");
    expect(entry["filterValue"]).toBe("https://");
  });

  it("ends with filter operator", () => {
    const entry = buildFilterEntry(Filter.endsWith("email", "@example.com"));
    expect(entry["filterOperator"]).toBe("ends with");
    expect(entry["filterType"]).toBe("string");
    expect(entry["filterValue"]).toBe("@example.com");
  });

  it("date not between filter operator", () => {
    const entry = buildFilterEntry(
      Filter.dateNotBetween("created", "2024-01-01", "2024-06-30"),
    );
    expect(entry["filterOperator"]).toBe("was not between");
    expect(entry["filterType"]).toBe("datetime");
    expect(entry["filterValue"]).toStrictEqual(["2024-01-01", "2024-06-30"]);
    expect(Object.hasOwn(entry, "filterDateUnit")).toBe(false);
  });

  it("in the next filter operator", () => {
    const entry = buildFilterEntry(Filter.inTheNext("expires", 7, "day"));
    expect(entry["filterOperator"]).toBe("was in the next");
    expect(entry["filterType"]).toBe("datetime");
    expect(entry["filterValue"]).toBe(7);
    expect(entry["filterDateUnit"]).toBe("day");
  });

  it("at least filter operator", () => {
    const entry = buildFilterEntry(Filter.atLeast("score", 80));
    expect(entry["filterOperator"]).toBe("is at least");
    expect(entry["filterType"]).toBe("number");
    expect(entry["filterValue"]).toBe(80);
  });

  it("at most filter operator", () => {
    const entry = buildFilterEntry(Filter.atMost("errors", 5));
    expect(entry["filterOperator"]).toBe("is at most");
    expect(entry["filterType"]).toBe("number");
    expect(entry["filterValue"]).toBe(5);
  });
});

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestPatchCustomPropertyFiltersForTransform
// =============================================================================

describe("patchCustomPropertyFiltersForTransform", () => {
  it("adds value to custom property ref", () => {
    const entries = [{ customPropertyId: 90553, filterOperator: "is set" }];
    const result = patchCustomPropertyFiltersForTransform(entries);
    expect(result[0]!["value"]).toBeNull();
  });

  it("adds value to inline custom property", () => {
    const entries = [{ customProperty: { formula: "A" }, filterOperator: ">" }];
    const result = patchCustomPropertyFiltersForTransform(entries);
    expect(result[0]!["value"]).toBeNull();
  });

  it("does not overwrite existing value", () => {
    const entries: Array<Record<string, unknown>> = [
      { value: "country", filterOperator: "equals" },
    ];
    patchCustomPropertyFiltersForTransform(entries);
    expect(entries[0]!["value"]).toBe("country");
  });

  it("leaves regular filters alone", () => {
    const entries: Array<Record<string, unknown>> = [
      { value: "country", filterOperator: "equals" },
      { customPropertyId: 42, filterOperator: "is set" },
    ];
    patchCustomPropertyFiltersForTransform(entries);
    expect(entries[0]!["value"]).toBe("country");
    expect(entries[1]!["value"]).toBeNull();
  });

  it("empty list", () => {
    expect(patchCustomPropertyFiltersForTransform([])).toStrictEqual([]);
  });

  it("mutates in place and returns the SAME array (caution 14)", () => {
    // NEW: Python returns `filter_entries` itself; B5 consumers chain
    // `patch_custom_property_filters_for_transform(build_filter_section(...))`
    // (`workspace.py`), so the aliasing is contract.
    const entries: Array<Record<string, unknown>> = [
      { customPropertyId: 1, filterOperator: "is set" },
    ];
    const result = patchCustomPropertyFiltersForTransform(entries);
    expect(result).toBe(entries);
  });

  it("an entry whose own `value` is null is left alone (`in`, not truthiness)", () => {
    // NEW (watchlist #7): Python's guard is `"value" not in entry`, a
    // KEY-PRESENCE test → `Object.hasOwn`, never `entry.value == null`.
    const entries: Array<Record<string, unknown>> = [
      { value: null, customPropertyId: 7 },
    ];
    patchCustomPropertyFiltersForTransform(entries);
    expect(entries[0]!["value"]).toBeNull();
    expect(Object.keys(entries[0]!)).toStrictEqual([
      "value",
      "customPropertyId",
    ]);
  });
});

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestFilterListContains
// =============================================================================

describe("Filter.listContains → buildFilterEntry", () => {
  it("kwargs shorthand produces two inner equals", () => {
    const f = Filter.listContains("cart", [], {
      equals: { Brand: "nike", Category: "hats" },
    });
    const entry = buildFilterEntry(f);
    expect(entry["filterType"]).toBe("object");
    expect(entry["filterJoinType"]).toBe("list");
    const inner = entry["listItemFilters"] as Array<Record<string, unknown>>;
    expect(inner).toHaveLength(2);
    const subValues = new Set(
      inner.map(
        (s) =>
          `${String(s["value"])}|${(s["filterValue"] as string[]).join(",")}`,
      ),
    );
    expect(subValues).toStrictEqual(new Set(["Brand|nike", "Category|hats"]));
    for (const sub of inner) {
      expect(sub["filterOperator"]).toBe("equals");
      expect(sub["filterType"]).toBe("string");
    }
  });

  it("positional filter instances preserve operators", () => {
    const f = Filter.listContains("cart", [
      Filter.equals("Brand", "nike"),
      Filter.greaterThan("Price", 50),
    ]);
    const entry = buildFilterEntry(f);
    const inner = entry["listItemFilters"] as Array<Record<string, unknown>>;
    expect(inner).toHaveLength(2);
    expect(new Set(inner.map((s) => s["filterOperator"]))).toStrictEqual(
      new Set(["equals", "is greater than"]),
    );
  });

  it("default quantifier is any", () => {
    const f = Filter.listContains("cart", [], { equals: { Brand: "nike" } });
    expect(buildFilterEntry(f)["listQuantifier"]).toBe("any");
  });

  it("quantifier all", () => {
    const f = Filter.listContains("cart", [], {
      equals: { Brand: "nike" },
      quantifier: "all",
    });
    expect(buildFilterEntry(f)["listQuantifier"]).toBe("all");
  });

  it("inner items have dataset", () => {
    const f = Filter.listContains("cart", [], {
      equals: { Brand: "nike", Category: "hats" },
    });
    const inner = buildFilterEntry(f)["listItemFilters"] as Array<
      Record<string, unknown>
    >;
    for (const sub of inner) {
      expect(sub["dataset"]).toBe("$mixpanel");
    }
  });

  it("outer constants", () => {
    const f = Filter.listContains("cart", [], { equals: { Brand: "nike" } });
    const entry = buildFilterEntry(f);
    expect(entry["dataset"]).toBe("$mixpanel");
    expect(entry["value"]).toBe("cart");
    expect(entry["resourceType"]).toBe("events");
    expect(entry["filterType"]).toBe("object");
    expect(entry["defaultType"]).toBe("object");
    expect(entry["filterJoinType"]).toBe("list");
    expect(entry["filterOperator"]).toBe("true");
    // R10.12's boolean cousin: JSON `true`, never the string "true".
    expect(entry["filterValue"]).toBe(true);
  });

  it("resource type propagates", () => {
    const f = Filter.listContains("attrs", [], {
      equals: { role: "admin" },
      resource_type: "people",
    });
    expect(buildFilterEntry(f)["resourceType"]).toBe("people");
  });

  it("zero conditions raises", () => {
    expect(() => Filter.listContains("cart")).toThrow(ParamValidationError);
    expect(() => Filter.listContains("cart")).toThrow(/at least one/);
  });

  it("mixing kwargs and positional raises", () => {
    expect(() =>
      Filter.listContains("cart", [Filter.equals("Brand", "nike")], {
        equals: { Category: "hats" },
      }),
    ).toThrow(/either/);
  });

  it("nested list contains raises", () => {
    const inner = Filter.listContains("inner", [], { equals: { X: "y" } });
    expect(() => Filter.listContains("cart", [inner])).toThrow(/nested/);
  });

  it("via build filter section", () => {
    const f = Filter.listContains("cart", [], { equals: { Brand: "nike" } });
    const section = buildFilterSection(f);
    expect(section).toHaveLength(1);
    expect(section[0]!["filterType"]).toBe("object");
    expect(
      section[0]!["listItemFilters"] as Array<Record<string, unknown>>,
    ).toHaveLength(1);
  });

  it("kwargs inherit outer resource type people", () => {
    const f = Filter.listContains("addresses", [], {
      resource_type: "people",
      equals: { City: "Brooklyn" },
    });
    expect(f._resource_type).toBe("people");
    expect(f._list_item_filters).not.toBeNull();
    for (const sub of f._list_item_filters!) {
      expect(sub._resource_type).toBe("people");
    }
    const section = buildFilterSection(f);
    expect(section[0]!["resourceType"]).toBe("people");
    for (const subEntry of section[0]!["listItemFilters"] as Array<
      Record<string, unknown>
    >) {
      expect(subEntry["resourceType"]).toBe("people");
    }
  });

  it("post init rejects list contains without filters", () => {
    expect(
      () =>
        new Filter({
          _property: "cart",
          _operator: "list_contains",
          _value: null,
          _property_type: "object",
          _resource_type: "events",
          _list_item_filters: null,
          _list_item_quantifier: "any",
        }),
    ).toThrow(/_list_item_filters/);
  });

  it("post init rejects list contains without quantifier", () => {
    expect(
      () =>
        new Filter({
          _property: "cart",
          _operator: "list_contains",
          _value: null,
          _property_type: "object",
          _resource_type: "events",
          _list_item_filters: [Filter.equals("Brand", "nike")],
          _list_item_quantifier: null,
        }),
    ).toThrow(/_list_item_quantifier/);
  });

  it("quantifier runtime rejects invalid", () => {
    expect(() =>
      Filter.listContains("cart", [], {
        quantifier: "nope" as never,
        equals: { X: "y" },
      }),
    ).toThrow(/quantifier/);
  });

  it("kwargs value must be str or list", () => {
    expect(() =>
      Filter.listContains("cart", [], { equals: { Price: 99.99 as never } }),
    ).toThrow(ParamTypeError);
    expect(() =>
      Filter.listContains("cart", [], { equals: { Price: 99.99 as never } }),
    ).toThrow(/Price/);
  });

  it("kwargs empty key rejected", () => {
    expect(() =>
      Filter.listContains("cart", [], { equals: { "": "value" } }),
    ).toThrow(/non-empty/);
  });

  it("setdefault does NOT overwrite an inner dataset (`:567`)", () => {
    // NEW: the inner entry of a CustomPropertyRef sub-filter already
    // carries `dataset`; `setdefault` must leave it alone.
    const f = Filter.listContains("cart", [
      Filter.equals(new CustomPropertyRef({ id: 7 }), "nike"),
    ]);
    const inner = buildFilterEntry(f)["listItemFilters"] as Array<
      Record<string, unknown>
    >;
    expect(inner[0]!["dataset"]).toBe("$mixpanel");
    expect(inner[0]!["customPropertyId"]).toBe(7);
  });
});

// =============================================================================
// tests/test_custom_property_builders.py::TestBuildFilterEntryCustomProperties
// =============================================================================

describe("buildFilterEntry — custom properties", () => {
  it("T026 plain string unchanged", () => {
    const entry = buildFilterEntry(Filter.equals("country", "US"));
    expect(entry["value"]).toBe("country");
    expect(entry["filterOperator"]).toBe("equals");
    expect(Object.hasOwn(entry, "customPropertyId")).toBe(false);
    expect(Object.hasOwn(entry, "customProperty")).toBe(false);
  });

  it("T027 custom property ref", () => {
    const entry = buildFilterEntry(
      Filter.greaterThan(new CustomPropertyRef({ id: 42 }), 100),
    );
    expect(entry["customPropertyId"]).toBe(42);
    expect(entry["filterOperator"]).toBe("is greater than");
    expect(entry["filterValue"]).toBe(100);
    expect(Object.hasOwn(entry, "value")).toBe(false);
  });

  it("T028 inline custom property", () => {
    const icp = InlineCustomProperty.numeric("A * B", {
      A: "price",
      B: "quantity",
    });
    const entry = buildFilterEntry(Filter.greaterThan(icp, 1000));
    expect(Object.hasOwn(entry, "customProperty")).toBe(true);
    const cp = entry["customProperty"] as Record<string, unknown>;
    expect(cp["displayFormula"]).toBe("A * B");
    expect(
      Object.hasOwn(cp["composedProperties"] as Record<string, unknown>, "A"),
    ).toBe(true);
    expect(cp["propertyType"]).toBe("number");
    expect(cp["resourceType"]).toBe("events");
    expect(entry["filterValue"]).toBe(1000);
    expect(entry["filterOperator"]).toBe("is greater than");
    expect(Object.hasOwn(entry, "value")).toBe(false);
  });

  it("T029 inline filter type uses property type", () => {
    const icp = new InlineCustomProperty({
      formula: "A",
      inputs: { A: new PropertyInput({ name: "email", type: "string" }) },
      property_type: "string",
    });
    const entry = buildFilterEntry(Filter.equals(icp, "test"));
    expect(entry["filterType"]).toBe("string");
    expect(entry["defaultType"]).toBe("string");
  });

  it("T030 custom property ref preserves resource type", () => {
    const entry = buildFilterEntry(
      Filter.equals(new CustomPropertyRef({ id: 42 }), "admin", {
        resource_type: "people",
      }),
    );
    expect(entry["resourceType"]).toBe("people");
    expect(entry["customPropertyId"]).toBe(42);
  });

  it("T031 inline uses own resource type", () => {
    const icp = new InlineCustomProperty({
      formula: "A",
      inputs: {
        A: new PropertyInput({ name: "email", resource_type: "user" }),
      },
      property_type: "string",
      resource_type: "people",
    });
    const entry = buildFilterEntry(Filter.equals(icp, "test"));
    expect(
      (entry["customProperty"] as Record<string, unknown>)["resourceType"],
    ).toBe("people");
    expect(entry["resourceType"]).toBe("people");
  });

  it("inline property type none uses filter default", () => {
    const icp = new InlineCustomProperty({
      formula: "A",
      inputs: { A: new PropertyInput({ name: "price", type: "number" }) },
      property_type: null,
    });
    const entry = buildFilterEntry(Filter.greaterThan(icp, 100));
    expect(entry["filterType"]).toBe("number");
    expect(entry["defaultType"]).toBe("number");
  });
});
