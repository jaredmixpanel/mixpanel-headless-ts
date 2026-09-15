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
  buildFilterSection,
  buildFrequencyFilterEntry,
  buildFrequencyGroupEntry,
  buildGroupSection,
} from "../../src/bookmarks/builders.js";
import {
  Filter,
  FrequencyBreakdown,
  FrequencyFilter,
} from "../../src/types/index.js";

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
    expect(behavior["event"]).toStrictEqual({
      label: "Purchase",
      value: "Purchase",
    });
    expect(behavior["filters"]).toStrictEqual([]);
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
    expect(
      (result["behavior"] as Record<string, unknown>)["event"],
    ).toStrictEqual({
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

  it("data group id threaded as a string (contract: string | null)", () => {
    const result = buildFrequencyGroupEntry(
      new FrequencyBreakdown({ event: "Purchase" }),
      { data_group_id: 5 },
    );
    expect(result["dataGroupId"]).toBe("5");
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
// FIX-1 (bug (a)): the old R10.7 customProperty-nested bug-compat lock
// retired with the Python-first fix — this suite now locks the
// platform-native clause (fix-of-record
// `docs/history/phase1/addendum/frequency-filter-probe.md` +
// `docs/history/phase1/bug-reports/mixpanel-headless-frequency-filter-clause-shape.md`).
// =============================================================================

describe("buildFrequencyFilterEntry (platform-native clause)", () => {
  it("basic structure", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({ event: "Login", value: 5 }),
    );
    expect(result).toStrictEqual({
      dataset: "$mixpanel",
      resourceType: "people",
      profileType: null,
      search: "",
      dataGroupId: null,
      behavior: {
        aggregationOperator: "total",
        behaviorType: "$frequency",
        dateRange: null,
        event: { label: "Login", value: "Login" },
        filters: [],
        filtersOperator: "and",
      },
      filterType: "number",
      defaultType: "number",
      filterOperator: "is at least",
      // R10.12: native number, never "5".
      filterValue: 5,
      propertyObjectKey: null,
      value: "Login Frequency",
    });
  });

  it("no customProperty nesting (bug (a) retired shape must not appear)", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({ event: "Login", value: 5 }),
    );
    expect(Object.hasOwn(result, "customProperty")).toBe(false);
    expect(Object.hasOwn(result, "behaviorType")).toBe(false);
    expect(
      (result["behavior"] as Record<string, unknown>)["behaviorType"],
    ).toBe("$frequency");
  });

  it("custom operator", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({
        event: "Login",
        operator: "is greater than",
        value: 10,
      }),
    );
    expect(result["filterOperator"]).toBe("is greater than");
    expect(result["filterValue"]).toBe(10);
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
    expect(
      (result["behavior"] as Record<string, unknown>)["dateRange"],
    ).toStrictEqual({
      type: "in the last",
      unit: "day",
      window: { unit: "day", value: 30 },
    });
  });

  it("without date range", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({ event: "Login", value: 5 }),
    );
    expect(
      (result["behavior"] as Record<string, unknown>)["dateRange"],
    ).toBeNull();
  });

  it("with event filters", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({
        event: "Purchase",
        value: 1,
        event_filters: [Filter.equals("country", "US")],
      }),
    );
    const behavior = result["behavior"] as Record<string, unknown>;
    const filters = behavior["filters"] as Array<Record<string, unknown>>;
    expect(filters).toHaveLength(1);
    expect(filters[0]!["value"]).toBe("country");
    expect(filters[0]!["filterOperator"]).toBe("equals");
    expect(Object.hasOwn(behavior, "eventFilters")).toBe(false);
  });

  it("without event filters", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({ event: "Login", value: 5 }),
    );
    const behavior = result["behavior"] as Record<string, unknown>;
    expect(behavior["filters"]).toStrictEqual([]);
    expect(Object.hasOwn(behavior, "eventFilters")).toBe(false);
  });

  it("label expressed via top-level value when set", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({ event: "Login", value: 5, label: "Active Users" }),
    );
    expect(result["value"]).toBe("Active Users");
    expect(Object.hasOwn(result, "label")).toBe(false);
  });

  it("value defaults to '<event> Frequency' when label is null", () => {
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({ event: "Login", value: 5 }),
    );
    expect(result["value"]).toBe("Login Frequency");
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
    const filters = (result["behavior"] as Record<string, unknown>)[
      "filters"
    ] as Array<Record<string, unknown>>;
    expect(filters).toHaveLength(2);
    expect(filters[0]!["filterOperator"]).toBe("equals");
    expect(filters[1]!["filterOperator"]).toBe("is greater than");
  });

  it("emits the fixed clause's key order byte-for-byte", () => {
    // TS-only insertion-order lock (re-pointed from the retired
    // customProperty shape): Python dict insertion order — dateRange /
    // filters re-assignment keeps the created position.
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
    expect(Object.keys(result)).toStrictEqual([
      "dataset",
      "resourceType",
      "profileType",
      "search",
      "dataGroupId",
      "behavior",
      "filterType",
      "defaultType",
      "filterOperator",
      "filterValue",
      "propertyObjectKey",
      "value",
    ]);
    expect(
      Object.keys(result["behavior"] as Record<string, unknown>),
    ).toStrictEqual([
      "aggregationOperator",
      "behaviorType",
      "dateRange",
      "event",
      "filters",
      "filtersOperator",
    ]);
  });

  it("an empty event_filters list re-assigns filters: [] (is-not-None guard)", () => {
    // The Python guard is `is not None`, so `[]` re-assigns
    // `behavior["filters"] = []` — indistinguishable from the default.
    const result = buildFrequencyFilterEntry(
      new FrequencyFilter({ event: "Login", value: 5, event_filters: [] }),
    );
    const behavior = result["behavior"] as Record<string, unknown>;
    expect(behavior["filters"]).toStrictEqual([]);
    expect(Object.hasOwn(behavior, "eventFilters")).toBe(false);
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

  it("data group id threaded to frequency as a string", () => {
    const result = buildGroupSection(
      new FrequencyBreakdown({ event: "Purchase" }),
      { data_group_id: 5 },
    );
    expect(result[0]!["dataGroupId"]).toBe("5");
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
    expect(
      (result[0]!["behavior"] as Record<string, unknown>)["behaviorType"],
    ).toBe("$frequency");
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
    expect(
      (result[1]!["behavior"] as Record<string, unknown>)["behaviorType"],
    ).toBe("$frequency");
  });
});
