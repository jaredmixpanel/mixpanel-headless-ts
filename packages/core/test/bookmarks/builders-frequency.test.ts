// `buildFrequencyGroupEntry`, `buildFrequencyFilterEntry` and the frequency
// dispatch arms of `buildGroupSection` / `buildFilterSection`, mirroring the
// `TestBuildFrequency*` / `Test*Frequency` classes of
// `tests/unit/test_bookmark_builders.py`. The filter entry locks the
// platform-native clause shape (the older `customProperty`-nested shape was a bug).
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

// --- Frequency group entry (TestBuildFrequencyGroupEntry) ---

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
    // TS-only: Python's guard is
    // `fb.label if fb.label is not None else f"{fb.event} Frequency"`.
    const result = buildFrequencyGroupEntry(
      new FrequencyBreakdown({ event: "Purchase", label: "" }),
    );
    expect(result["value"]).toBe("");
  });
});

// --- Frequency filter entry (TestBuildFrequencyFilterEntry) ---
// The `customProperty`-nested clause the builder once emitted was a bug fixed
// Python-first; this suite locks the platform-native clause.

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
      // Native number, never "5".
      filterValue: 5,
      propertyObjectKey: null,
      value: "Login Frequency",
    });
  });

  it("no customProperty nesting (the retired bug shape must not appear)", () => {
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

// --- Group-section dispatch (TestBuildGroupSectionFrequency) ---

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

// --- Filter-section dispatch (TestBuildFilterSectionFrequency) ---

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
