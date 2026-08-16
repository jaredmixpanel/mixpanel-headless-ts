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

import { describe, it, expect } from "vitest";

import {
  buildComposedProperties,
  buildDateRange,
  buildFilterEntry,
  buildFilterSection,
  buildFlowCohortFilter,
  buildFlowPropertyFilter,
  buildFrequencyFilterEntry,
  buildFrequencyGroupEntry,
  buildGroupSection,
  buildTimeComparison,
  buildTimeSection,
  patchCustomPropertyFiltersForTransform,
} from "../../src/bookmarks/builders.js";
import { ParamTypeError, ParamValidationError } from "../../src/errors.js";
import {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  CustomPropertyRef,
  Filter,
  FrequencyBreakdown,
  FrequencyFilter,
  GroupBy,
  InlineCustomProperty,
  ListItemGroupMode,
  PropertyInput,
  TimeComparison,
} from "../../src/types/index.js";

/**
 * Frozen `today` seam used wherever Python patches
 * `bookmark_builders.date` (`test_bookmark_builders.py:56-58`).
 *
 * @param iso - The date the seam should report.
 * @returns A zero-arg seam function returning `iso`.
 */
function frozenToday(iso: string): () => string {
  return () => iso;
}

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestBuildTimeSection
// =============================================================================

describe("buildTimeSection", () => {
  it("absolute range from and to", () => {
    const result = buildTimeSection({
      from_date: "2025-01-01",
      to_date: "2025-01-31",
      last: 30,
      unit: "day",
    });
    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry["dateRangeType"]).toBe("between");
    expect(entry["unit"]).toBe("day");
    expect(entry["value"]).toEqual(["2025-01-01", "2025-01-31"]);
    expect(Object.hasOwn(entry, "window")).toBe(false);
  });

  it("from only fills today", () => {
    const result = buildTimeSection({
      from_date: "2025-01-01",
      to_date: null,
      last: 30,
      unit: "week",
      today: frozenToday("2025-06-15"),
    });
    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry["dateRangeType"]).toBe("between");
    expect(entry["unit"]).toBe("week");
    expect(entry["value"]).toEqual(["2025-01-01", "2025-06-15"]);
  });

  it("relative range last n", () => {
    const result = buildTimeSection({
      from_date: null,
      to_date: null,
      last: 30,
      unit: "day",
    });
    expect(result).toHaveLength(1);
    const entry = result[0]!;
    expect(entry["dateRangeType"]).toBe("in the last");
    expect(entry["unit"]).toBe("day");
    expect(entry["window"]).toEqual({ unit: "day", value: 30 });
    expect(Object.hasOwn(entry, "value")).toBe(false);
  });

  it("relative range custom last", () => {
    const result = buildTimeSection({
      from_date: null,
      to_date: null,
      last: 7,
      unit: "hour",
    });
    const entry = result[0]!;
    expect(entry["dateRangeType"]).toBe("in the last");
    expect(entry["unit"]).toBe("hour");
    expect((entry["window"] as Record<string, unknown>)["value"]).toBe(7);
  });

  it("returns single element list", () => {
    const cases = [
      { from_date: "2025-01-01", to_date: "2025-01-31", last: 30 },
      { from_date: "2025-01-01", to_date: null, last: 30 },
      { from_date: null, to_date: null, last: 30 },
    ] as const;
    for (const kwargs of cases) {
      const result = buildTimeSection({
        ...kwargs,
        unit: "day",
        today: frozenToday("2025-06-15"),
      });
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
    }
  });

  it("relative branch never reads the clock (no `today` seam needed)", () => {
    // NEW (packet §"Clock seam"): the from-only branch is the ONLY
    // `date.today()` read (`bookmark_builders.py:115`).
    const seam = (): string => {
      throw new Error("clock must not be read on the relative branch");
    };
    expect(() =>
      buildTimeSection({
        from_date: null,
        to_date: null,
        last: 5,
        unit: "day",
        today: seam,
      }),
    ).not.toThrow();
    expect(() =>
      buildTimeSection({
        from_date: "2025-01-01",
        to_date: "2025-01-31",
        last: 5,
        unit: "day",
        today: seam,
      }),
    ).not.toThrow();
  });
});

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestBuildDateRange
// =============================================================================

describe("buildDateRange", () => {
  it("relative last n", () => {
    const result = buildDateRange({ from_date: null, to_date: null, last: 30 });
    expect(result["type"]).toBe("in the last");
    expect(result["from_date"]).toEqual({ unit: "day", value: 30 });
    expect(result["to_date"]).toBe("$now");
  });

  it("absolute range", () => {
    const result = buildDateRange({
      from_date: "2025-01-01",
      to_date: "2025-03-31",
      last: 30,
    });
    expect(result["type"]).toBe("between");
    expect(result["from_date"]).toBe("2025-01-01");
    expect(result["to_date"]).toBe("2025-03-31");
  });

  it("relative custom last", () => {
    const result = buildDateRange({ from_date: null, to_date: null, last: 7 });
    const fromDate = result["from_date"] as Record<string, unknown>;
    expect(fromDate["value"]).toBe(7);
    expect(fromDate["unit"]).toBe("day");
  });
});

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestBuildFilterSection
// =============================================================================

describe("buildFilterSection", () => {
  it("none returns empty", () => {
    expect(buildFilterSection(null)).toEqual([]);
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
// tests/unit/test_bookmark_builders.py::TestBuildGroupSection
// =============================================================================

describe("buildGroupSection", () => {
  it("none returns empty", () => {
    expect(buildGroupSection(null)).toEqual([]);
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
    expect(entry["filterValue"]).toEqual(["US"]);
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
    expect(entry["filterValue"]).toEqual([18, 65]);
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
    expect(entry["filterValue"]).toEqual(["2024-01-01", "2024-06-30"]);
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
    expect(patchCustomPropertyFiltersForTransform([])).toEqual([]);
  });

  it("mutates in place and returns the SAME array (caution 14)", () => {
    // NEW: Python returns `filter_entries` itself; B5 consumers chain
    // `patch_custom_property_filters_for_transform(build_filter_section(...))`
    // (`workspace.py:2897-2899`), so the aliasing is contract.
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
    expect(Object.keys(entries[0]!)).toEqual(["value", "customPropertyId"]);
  });
});

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestBuildTimeComparison (T015)
// =============================================================================

describe("buildTimeComparison", () => {
  it("relative produces correct dict", () => {
    expect(buildTimeComparison(TimeComparison.relative("month"))).toEqual({
      type: "relative",
      value: "month",
    });
  });

  it("absolute start produces correct dict", () => {
    expect(
      buildTimeComparison(TimeComparison.absoluteStart("2026-01-01")),
    ).toEqual({ type: "absolute-start", value: "2026-01-01" });
  });

  it("absolute end produces correct dict", () => {
    expect(
      buildTimeComparison(TimeComparison.absoluteEnd("2026-12-31")),
    ).toEqual({ type: "absolute-end", value: "2026-12-31" });
  });

  it("relative day unit", () => {
    expect(buildTimeComparison(TimeComparison.relative("day"))["value"]).toBe(
      "day",
    );
  });

  it("relative year unit", () => {
    expect(buildTimeComparison(TimeComparison.relative("year"))["value"]).toBe(
      "year",
    );
  });
});

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestBuildFrequencyGroupEntry (T022)
// =============================================================================

describe("buildFrequencyGroupEntry", () => {
  it("basic structure", () => {
    const result = buildFrequencyGroupEntry(
      new FrequencyBreakdown({ event: "Purchase" }),
    );
    expect(result["dataset"]).toBe("$mixpanel");
    expect(result["resourceType"]).toBe("people");
    expect(result["propertyType"]).toBe("number");
    expect(result["dataGroupId"]).toBeNull();
  });

  it("behavior dict structure", () => {
    const result = buildFrequencyGroupEntry(
      new FrequencyBreakdown({ event: "Purchase" }),
    );
    const behavior = result["behavior"] as Record<string, unknown>;
    expect(behavior["behaviorType"]).toBe("$frequency");
    expect(behavior["aggregationOperator"]).toBe("total");
    expect(behavior["event"]).toEqual({
      label: "Purchase",
      value: "Purchase",
    });
    expect(behavior["filters"]).toEqual([]);
    expect(behavior["filtersOperator"]).toBe("and");
    expect(behavior["dateRange"]).toBeNull();
  });

  it("behaviortype not at top level", () => {
    const result = buildFrequencyGroupEntry(
      new FrequencyBreakdown({ event: "Purchase" }),
    );
    expect(Object.hasOwn(result, "behaviorType")).toBe(false);
    expect(
      (result["behavior"] as Record<string, unknown>)["behaviorType"],
    ).toBe("$frequency");
  });

  it("custom bucket default values", () => {
    const result = buildFrequencyGroupEntry(
      new FrequencyBreakdown({ event: "Purchase" }),
    );
    const bucket = result["customBucket"] as Record<string, unknown>;
    expect(bucket["bucketSize"]).toBe(1);
    expect(bucket["min"]).toBe(0);
    expect(bucket["max"]).toBe(10);
    expect(bucket["disabled"]).toBe(false);
  });

  it("custom bucket values", () => {
    const result = buildFrequencyGroupEntry(
      new FrequencyBreakdown({
        event: "Purchase",
        bucket_size: 5,
        bucket_min: 0,
        bucket_max: 50,
      }),
    );
    const bucket = result["customBucket"] as Record<string, unknown>;
    expect(bucket["bucketSize"]).toBe(5);
    expect(bucket["min"]).toBe(0);
    expect(bucket["max"]).toBe(50);
    expect(bucket["disabled"]).toBe(false);
  });

  it("value label from event name", () => {
    const result = buildFrequencyGroupEntry(
      new FrequencyBreakdown({ event: "Purchase" }),
    );
    expect(result["value"]).toBe("Purchase Frequency");
  });

  it("label overrides value", () => {
    const result = buildFrequencyGroupEntry(
      new FrequencyBreakdown({ event: "Purchase", label: "Buy Count" }),
    );
    expect(result["value"]).toBe("Buy Count");
  });

  it("no top level label key", () => {
    const result = buildFrequencyGroupEntry(
      new FrequencyBreakdown({ event: "Purchase", label: "Buy Count" }),
    );
    expect(Object.hasOwn(result, "label")).toBe(false);
  });

  it("no snake case bucket keys in behavior", () => {
    const result = buildFrequencyGroupEntry(
      new FrequencyBreakdown({
        event: "Purchase",
        bucket_size: 5,
        bucket_min: 0,
        bucket_max: 50,
      }),
    );
    const behavior = result["behavior"] as Record<string, unknown>;
    expect(Object.hasOwn(behavior, "bucket_size")).toBe(false);
    expect(Object.hasOwn(behavior, "bucket_min")).toBe(false);
    expect(Object.hasOwn(behavior, "bucket_max")).toBe(false);
  });

  it("event object uses event name not display label", () => {
    const result = buildFrequencyGroupEntry(
      new FrequencyBreakdown({ event: "Purchase", label: "Buy Count" }),
    );
    expect((result["behavior"] as Record<string, unknown>)["event"]).toEqual({
      label: "Purchase",
      value: "Purchase",
    });
    expect(result["value"]).toBe("Buy Count");
  });

  it("data group id default none", () => {
    const result = buildFrequencyGroupEntry(
      new FrequencyBreakdown({ event: "Purchase" }),
    );
    expect(result["dataGroupId"]).toBeNull();
  });

  it("data group id threaded", () => {
    const result = buildFrequencyGroupEntry(
      new FrequencyBreakdown({ event: "Purchase" }),
      { data_group_id: 5 },
    );
    expect(result["dataGroupId"]).toBe(5);
  });

  it("empty-string label is emitted verbatim (`is not None`, not truthiness)", () => {
    // NEW (watchlist #6): Python's guard is
    // `fb.label if fb.label is not None else f"{fb.event} Frequency"`.
    const result = buildFrequencyGroupEntry(
      new FrequencyBreakdown({ event: "Purchase", label: "" }),
    );
    expect(result["value"]).toBe("");
  });
});

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestBuildFrequencyFilterEntry (T022)
//
// R10.7 BUG-COMPAT LOCK: this clause shape is server-rejected (HTTP 500);
// probe record `context/phase1/addendum/frequency-filter-probe.md`.
// These nine assertions replicate it byte-for-byte. NEVER "fix" the shape.
// =============================================================================

describe("buildFrequencyFilterEntry (R10.7 bug-compat)", () => {
  it("basic structure", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({ event: "Login", value: 5 }),
    );
    expect(result["resourceType"]).toBe("people");
    expect(result["behaviorType"]).toBe("$frequency");
    expect(Object.hasOwn(result, "customProperty")).toBe(true);
    const behavior = (result["customProperty"] as Record<string, unknown>)[
      "behavior"
    ] as Record<string, unknown>;
    expect(behavior["event"]).toBe("Login");
    expect(behavior["aggregation"]).toBe("total");
    expect(behavior["filterOperator"]).toBe("is at least");
    // R10.12: native number, never "5".
    expect(behavior["filterValue"]).toBe(5);
  });

  it("custom operator", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({
        event: "Login",
        operator: "is greater than",
        value: 10,
      }),
    );
    const behavior = (result["customProperty"] as Record<string, unknown>)[
      "behavior"
    ] as Record<string, unknown>;
    expect(behavior["filterOperator"]).toBe("is greater than");
    expect(behavior["filterValue"]).toBe(10);
  });

  it("with date range", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({
        event: "Login",
        value: 5,
        date_range_value: 30,
        date_range_unit: "day",
      }),
    );
    const behavior = (result["customProperty"] as Record<string, unknown>)[
      "behavior"
    ] as Record<string, unknown>;
    expect(Object.hasOwn(behavior, "dateRange")).toBe(true);
    const dateRange = behavior["dateRange"] as Record<string, unknown>;
    expect(dateRange["value"]).toBe(30);
    expect(dateRange["unit"]).toBe("day");
  });

  it("without date range", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({ event: "Login", value: 5 }),
    );
    const behavior = (result["customProperty"] as Record<string, unknown>)[
      "behavior"
    ] as Record<string, unknown>;
    expect(Object.hasOwn(behavior, "dateRange")).toBe(false);
  });

  it("with event filters", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({
        event: "Purchase",
        value: 1,
        event_filters: [Filter.equals("country", "US")],
      }),
    );
    const behavior = (result["customProperty"] as Record<string, unknown>)[
      "behavior"
    ] as Record<string, unknown>;
    expect(Object.hasOwn(behavior, "eventFilters")).toBe(true);
    const eventFilters = behavior["eventFilters"] as Array<
      Record<string, unknown>
    >;
    expect(eventFilters).toHaveLength(1);
    expect(eventFilters[0]!["value"]).toBe("country");
    expect(eventFilters[0]!["filterOperator"]).toBe("equals");
  });

  it("without event filters", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({ event: "Login", value: 5 }),
    );
    const behavior = (result["customProperty"] as Record<string, unknown>)[
      "behavior"
    ] as Record<string, unknown>;
    expect(Object.hasOwn(behavior, "eventFilters")).toBe(false);
  });

  it("label included", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({ event: "Login", value: 5, label: "Active Users" }),
    );
    expect(result["label"]).toBe("Active Users");
  });

  it("label omitted when none", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({ event: "Login", value: 5 }),
    );
    expect(Object.hasOwn(result, "label")).toBe(false);
  });

  it("multiple event filters", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({
        event: "Purchase",
        value: 3,
        event_filters: [
          Filter.equals("country", "US"),
          Filter.greaterThan("amount", 10),
        ],
      }),
    );
    const behavior = (result["customProperty"] as Record<string, unknown>)[
      "behavior"
    ] as Record<string, unknown>;
    const eventFilters = behavior["eventFilters"] as Array<
      Record<string, unknown>
    >;
    expect(eventFilters).toHaveLength(2);
    expect(eventFilters[0]!["filterOperator"]).toBe("equals");
    expect(eventFilters[1]!["filterOperator"]).toBe("is greater than");
  });

  it("emits the probe-recorded key order byte-for-byte", () => {
    // NEW (R10.7 lock, packet §"R10.7 bug-compat"): key order
    // `event, aggregation, filterOperator, filterValue[, dateRange]
    // [, eventFilters]` inside `behavior`, and
    // `resourceType, behaviorType, customProperty[, label]` outside.
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({
        event: "Login",
        value: 5,
        date_range_value: 30,
        date_range_unit: "day",
        event_filters: [Filter.equals("country", "US")],
        label: "L",
      }),
    );
    expect(Object.keys(result)).toEqual([
      "resourceType",
      "behaviorType",
      "customProperty",
      "label",
    ]);
    const behavior = (result["customProperty"] as Record<string, unknown>)[
      "behavior"
    ] as Record<string, unknown>;
    expect(Object.keys(behavior)).toEqual([
      "event",
      "aggregation",
      "filterOperator",
      "filterValue",
      "dateRange",
      "eventFilters",
    ]);
  });

  it("an empty event_filters list still emits the key", () => {
    // NEW: the guard is `is not None`, so `[]` emits `eventFilters: []`.
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({ event: "Login", value: 5, event_filters: [] }),
    );
    const behavior = (result["customProperty"] as Record<string, unknown>)[
      "behavior"
    ] as Record<string, unknown>;
    expect(behavior["eventFilters"]).toEqual([]);
  });
});

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestBuildGroupSectionFrequency (T022)
// =============================================================================

describe("buildGroupSection — FrequencyBreakdown dispatch", () => {
  it("frequency breakdown in group section", () => {
    const result = buildGroupSection(
      new FrequencyBreakdown({ event: "Purchase" }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!["resourceType"]).toBe("people");
    expect(
      (result[0]!["behavior"] as Record<string, unknown>)["behaviorType"],
    ).toBe("$frequency");
  });

  it("mixed groupby and frequency", () => {
    const result = buildGroupSection([
      "country",
      new FrequencyBreakdown({ event: "Purchase" }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]!["value"]).toBe("country");
    expect(result[0]!["propertyType"]).toBe("string");
    expect(result[1]!["resourceType"]).toBe("people");
    expect(
      (result[1]!["behavior"] as Record<string, unknown>)["behaviorType"],
    ).toBe("$frequency");
  });

  it("data group id threaded to frequency", () => {
    const result = buildGroupSection(
      new FrequencyBreakdown({ event: "Purchase" }),
      { data_group_id: 5 },
    );
    expect(result[0]!["dataGroupId"]).toBe(5);
  });
});

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestBuildFilterSectionFrequency (T022)
// =============================================================================

describe("buildFilterSection — FrequencyFilter dispatch", () => {
  it("frequency filter in filter section", () => {
    const result = buildFilterSection(
      new FrequencyFilter({ event: "Login", value: 5 }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!["resourceType"]).toBe("people");
    expect(result[0]!["behaviorType"]).toBe("$frequency");
  });

  it("mixed filter and frequency", () => {
    const result = buildFilterSection([
      Filter.equals("country", "US"),
      new FrequencyFilter({ event: "Login", value: 5 }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]!["value"]).toBe("country");
    expect(result[0]!["filterOperator"]).toBe("equals");
    expect(result[1]!["resourceType"]).toBe("people");
    expect(result[1]!["behaviorType"]).toBe("$frequency");
  });
});

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestBuildGroupSectionDataGroupId (T033)
// =============================================================================

describe("buildGroupSection — data_group_id threading", () => {
  it("custom property ref group with data group id", () => {
    const gb = new GroupBy({ property: new CustomPropertyRef({ id: 42 }) });
    const result = buildGroupSection(gb, { data_group_id: 5 });
    expect(result).toHaveLength(1);
    expect(result[0]!["dataGroupId"]).toBe(5);
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
    expect(result[0]!["dataGroupId"]).toBe(3);
  });

  it("cohort breakdown group with data group id", () => {
    const cb = new CohortBreakdown({ cohort: 123, name: "Power Users" });
    const result = buildGroupSection(cb, { data_group_id: 7 });
    expect(result).toHaveLength(1);
    expect(result[0]!["dataGroupId"]).toBe(7);
    for (const cohort of result[0]!["cohorts"] as Array<
      Record<string, unknown>
    >) {
      expect(cohort["data_group_id"]).toBe(7);
    }
  });

  it("string group unaffected by data group id", () => {
    const result = buildGroupSection("country", { data_group_id: 5 });
    expect(result).toHaveLength(1);
    expect(Object.hasOwn(result[0]!, "dataGroupId")).toBe(false);
  });

  it("none group returns empty", () => {
    expect(buildGroupSection(null, { data_group_id: 5 })).toEqual([]);
  });
});

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
    expect(child["filterValue"]).toEqual(["US"]);
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
    expect(subValues).toEqual(new Set(["Brand|nike", "Category|hats"]));
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
    expect(new Set(inner.map((s) => s["filterOperator"]))).toEqual(
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
// tests/unit/test_bookmark_builders.py::TestGroupByListItem
// =============================================================================

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
    expect(entry["listItemGroup"]).toEqual({
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
      () => new ListItemGroupMode({ sub: "   ", sub_type: "string" }),
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

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestCodedGroupSectionCodes
// =============================================================================

describe("coded guards — buildGroupSection (BB1)", () => {
  it("bb1 scalar element raises coded error", () => {
    try {
      buildGroupSection(123 as never);
      expect.unreachable("expected ParamTypeError");
    } catch (err) {
      expect(err).toBeInstanceOf(ParamTypeError);
      expect((err as ParamTypeError).code).toBe("BB1_GROUP_BY_ELEMENT_TYPE");
    }
  });

  it("bb1 invalid element in list raises coded error", () => {
    try {
      buildGroupSection(["country", 42] as never);
      expect.unreachable("expected ParamTypeError");
    } catch (err) {
      expect(err).toBeInstanceOf(ParamTypeError);
      expect((err as ParamTypeError).code).toBe("BB1_GROUP_BY_ELEMENT_TYPE");
    }
  });

  it("bb1 stays catchable as type error", () => {
    // Python: `pytest.raises(TypeError)` + `isinstance(exc, ParamTypeError)`.
    // TS twin: ParamTypeError IS the ported TypeError analogue; the
    // base-class half of the assert is `instanceof Error`.
    try {
      buildGroupSection([null] as never);
      expect.unreachable("expected ParamTypeError");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ParamTypeError);
      expect((err as ParamTypeError).code).toBe("BB1_GROUP_BY_ELEMENT_TYPE");
    }
  });
});

// =============================================================================
// tests/unit/test_bookmark_builders.py::TestCodedFlowPropertyFilterCodes
// =============================================================================

describe("coded guards — buildFlowPropertyFilter (BB2/BB3)", () => {
  it("bb2 empty list raises coded error", () => {
    try {
      buildFlowPropertyFilter([]);
      expect.unreachable("expected ParamValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(ParamValidationError);
      expect((err as ParamValidationError).code).toBe(
        "BB2_FLOW_PROPERTY_FILTER_EMPTY",
      );
    }
  });

  it("bb2 stays catchable as value error", () => {
    try {
      buildFlowPropertyFilter([]);
      expect.unreachable("expected ParamValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ParamValidationError);
      expect((err as ParamValidationError).code).toBe(
        "BB2_FLOW_PROPERTY_FILTER_EMPTY",
      );
    }
  });

  it("bb3 custom property ref raises coded error", () => {
    const f = new Filter({
      _property: new CustomPropertyRef({ id: 123 }),
      _operator: "equals",
      _value: ["high"],
      _property_type: "string",
      _resource_type: "events",
    });
    try {
      buildFlowPropertyFilter([f]);
      expect.unreachable("expected ParamTypeError");
    } catch (err) {
      expect(err).toBeInstanceOf(ParamTypeError);
      expect((err as ParamTypeError).code).toBe(
        "BB3_FLOW_PROPERTY_FILTER_TYPE",
      );
    }
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
    try {
      buildFlowPropertyFilter([f]);
      expect.unreachable("expected ParamTypeError");
    } catch (err) {
      expect(err).toBeInstanceOf(ParamTypeError);
      expect((err as ParamTypeError).code).toBe(
        "BB3_FLOW_PROPERTY_FILTER_TYPE",
      );
    }
  });
});

// =============================================================================
// tests/test_custom_property_builders.py::TestBuildComposedProperties (T006)
// =============================================================================

describe("buildComposedProperties", () => {
  it("single input", () => {
    const result = buildComposedProperties({
      A: new PropertyInput({ name: "price", type: "number" }),
    });
    expect(result).toEqual({
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
    expect(result["A"]).toEqual({
      value: "country",
      type: "string",
      resourceType: "event",
    });
  });
});

// =============================================================================
// tests/test_custom_property_builders.py::TestBuildGroupSectionCustomProperties
// =============================================================================

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
    expect(entry["customBucket"]).toEqual({
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
    expect(entry["customBucket"]).toEqual({
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

// =============================================================================
// NEW — buildFlowCohortFilter (`bookmark_builders.py:649-737`)
//
// `tests/test_build_cohort_params.py` is a B5-owned Layer-3 file (packet
// §K2 "Layer-3 test translation" defers it), but its 16
// `build_flow_cohort_filter` vectors replay at the B3 gate. These cases
// mirror those corpus vector ids one-for-one:
//   filters/bookmark_builders.build_flow_cohort_filter/
//     test_build_cohort_params-testbuildflowcohortfilterdirect-*
//     test_build_cohort_params-testcodedflowcohortfiltercodes-*
// =============================================================================

describe("buildFlowCohortFilter (NEW — corpus-vector mirrors)", () => {
  it("saved cohort filter", () => {
    const f = Filter.inCohort(123, "PU");
    expect(buildFlowCohortFilter(f)).toEqual({
      name: "PU",
      negated: false,
      id: 123,
    });
  });

  it("not in cohort negated", () => {
    const f = Filter.notInCohort(123, "Bots");
    expect(buildFlowCohortFilter(f)).toEqual({
      name: "Bots",
      negated: true,
      id: 123,
    });
  });

  it("inline cohort filter carries raw_cohort, not id", () => {
    const definition = CohortDefinition.allOf(
      CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
    );
    const f = Filter.inCohort(definition, "Active");
    const result = buildFlowCohortFilter(f);
    expect(result).not.toBeNull();
    expect(result!["name"]).toBe("Active");
    expect(result!["negated"]).toBe(false);
    expect(Object.hasOwn(result!, "raw_cohort")).toBe(true);
    expect(Object.hasOwn(result!, "id")).toBe(false);
  });

  it("empty list returns null", () => {
    expect(buildFlowCohortFilter([])).toBeNull();
  });

  it("BB4 — a non-cohort property filter raises", () => {
    try {
      buildFlowCohortFilter([Filter.equals("country", "US")]);
      expect.unreachable("expected ParamValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(ParamValidationError);
      expect((err as ParamValidationError).code).toBe(
        "BB4_FLOW_COHORT_FILTER_TYPE",
      );
    }
  });

  it("BB4 fires before BB5 (guard order is Python source order)", () => {
    // Python loops all filters for BB4 BEFORE the len>1 BB5 check.
    try {
      buildFlowCohortFilter([
        Filter.inCohort(1, "A"),
        Filter.equals("country", "US"),
      ]);
      expect.unreachable("expected ParamValidationError");
    } catch (err) {
      expect((err as ParamValidationError).code).toBe(
        "BB4_FLOW_COHORT_FILTER_TYPE",
      );
    }
  });

  it("BB5 — two cohort filters raise", () => {
    try {
      buildFlowCohortFilter([Filter.inCohort(1, "A"), Filter.inCohort(2, "B")]);
      expect.unreachable("expected ParamValidationError");
    } catch (err) {
      expect((err as ParamValidationError).code).toBe(
        "BB5_FLOW_MULTIPLE_COHORT_FILTERS",
      );
    }
  });

  it("BB6 — non-list _value raises", () => {
    const f = new Filter({
      _property: "$cohorts",
      _operator: "contains",
      _value: "oops",
      _property_type: "list",
      _resource_type: "events",
    });
    try {
      buildFlowCohortFilter(f);
      expect.unreachable("expected ParamValidationError");
    } catch (err) {
      expect((err as ParamValidationError).code).toBe(
        "BB6_COHORT_VALUE_NOT_LIST",
      );
    }
  });

  it("BB6 — empty-list _value raises (len check, not truthiness)", () => {
    const f = new Filter({
      _property: "$cohorts",
      _operator: "contains",
      _value: [],
      _property_type: "list",
      _resource_type: "events",
    });
    try {
      buildFlowCohortFilter(f);
      expect.unreachable("expected ParamValidationError");
    } catch (err) {
      expect((err as ParamValidationError).code).toBe(
        "BB6_COHORT_VALUE_NOT_LIST",
      );
    }
  });

  it("BB7 — non-dict first item raises (isPythonDict, watchlist #13)", () => {
    for (const value of [[42], ["cohort"]]) {
      const f = new Filter({
        _property: "$cohorts",
        _operator: "contains",
        _value: value as never,
        _property_type: "list",
        _resource_type: "events",
      });
      try {
        buildFlowCohortFilter(f);
        expect.unreachable("expected ParamValidationError");
      } catch (err) {
        expect((err as ParamValidationError).code).toBe(
          "BB7_COHORT_VALUE_NOT_DICT",
        );
      }
    }
  });

  it("BB8 — missing/non-dict 'cohort' key raises", () => {
    for (const value of [[{}], [{ cohort: "nope" }]]) {
      const f = new Filter({
        _property: "$cohorts",
        _operator: "contains",
        _value: value as never,
        _property_type: "list",
        _resource_type: "events",
      });
      try {
        buildFlowCohortFilter(f);
        expect.unreachable("expected ParamValidationError");
      } catch (err) {
        expect((err as ParamValidationError).code).toBe(
          "BB8_COHORT_KEY_MISSING",
        );
      }
    }
  });

  it("BB guards stay catchable as ValueError analogues", () => {
    expect(() =>
      buildFlowCohortFilter([Filter.equals("country", "US")]),
    ).toThrow(ParamValidationError);
  });

  it("name defaults to '' when the cohort dict has no name key", () => {
    const f = new Filter({
      _property: "$cohorts",
      _operator: "contains",
      _value: [{ cohort: { id: 9 } }],
      _property_type: "list",
      _resource_type: "events",
    });
    expect(buildFlowCohortFilter(f)).toEqual({
      name: "",
      negated: false,
      id: 9,
    });
  });

  it("a single Filter (not a list) is wrapped — `isinstance(where, list)`", () => {
    // NOTE the asymmetry with buildFilterSection: this site tests
    // `list` ONLY (`bookmark_builders.py:683`), not `(list, tuple)`.
    expect(buildFlowCohortFilter(Filter.inCohort(5, "X"))).toEqual({
      name: "X",
      negated: false,
      id: 5,
    });
  });
});

// =============================================================================
// NEW — buildCohortGroupEntry reached through buildGroupSection
// (`bookmark_builders.py:406-466`)
// =============================================================================

describe("buildGroupSection — CohortBreakdown entries (NEW)", () => {
  it("saved cohort produces id + empty groups and both labels", () => {
    const entry = buildGroupSection(
      new CohortBreakdown({ cohort: 123, name: "PU" }),
    )[0]!;
    expect(entry["value"]).toEqual(["PU", "Not In PU"]);
    expect(entry["resourceType"]).toBe("events");
    expect(entry["profileType"]).toBeNull();
    expect(entry["search"]).toBe("");
    expect(entry["dataGroupId"]).toBeNull();
    expect(entry["propertyType"]).toBeNull();
    expect(entry["typeCast"]).toBeNull();
    expect(entry["isHidden"]).toBe(false);
    const cohorts = entry["cohorts"] as Array<Record<string, unknown>>;
    expect(cohorts).toHaveLength(2);
    expect(cohorts[0]).toEqual({
      name: "PU",
      negated: false,
      data_group_id: null,
      id: 123,
      groups: [],
    });
    expect(cohorts[1]!["negated"]).toBe(true);
  });

  it("include_negated=false emits one cohort and one label", () => {
    const entry = buildGroupSection(
      new CohortBreakdown({
        cohort: 123,
        name: "PU",
        include_negated: false,
      }),
    )[0]!;
    expect(entry["value"]).toEqual(["PU"]);
    expect(entry["cohorts"] as unknown[]).toHaveLength(1);
  });

  it("name=null collapses to '' in both the entry and the label", () => {
    // `name = cb.name or ""` — falsy-OR catches None AND "" (caution 10).
    const entry = buildGroupSection(new CohortBreakdown({ cohort: 7 }))[0]!;
    expect(entry["value"]).toEqual(["", "Not In "]);
    const cohorts = entry["cohorts"] as Array<Record<string, unknown>>;
    expect(cohorts[0]!["name"]).toBe("");
  });

  it("the negated copy is a SHALLOW spread of the base cohort", () => {
    // `{**base_cohort, "negated": True}` (`:453`) — `groups` is the SAME
    // array instance in both entries (caution 14: do not deep-copy).
    const entry = buildGroupSection(
      new CohortBreakdown({ cohort: 123, name: "PU" }),
    )[0]!;
    const cohorts = entry["cohorts"] as Array<Record<string, unknown>>;
    expect(cohorts[0]!["groups"]).toBe(cohorts[1]!["groups"]);
  });

  it("inline cohort emits raw_cohort instead of id/groups", () => {
    const definition = CohortDefinition.allOf(
      CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
    );
    const entry = buildGroupSection(
      new CohortBreakdown({ cohort: definition, name: "Active" }),
    )[0]!;
    const cohorts = entry["cohorts"] as Array<Record<string, unknown>>;
    expect(Object.hasOwn(cohorts[0]!, "raw_cohort")).toBe(true);
    expect(Object.hasOwn(cohorts[0]!, "id")).toBe(false);
    expect(Object.hasOwn(cohorts[0]!, "groups")).toBe(false);
  });
});
