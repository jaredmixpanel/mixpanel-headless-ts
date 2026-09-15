// Translated result-class tests (phase2-design C6/C8b, packet P2-6):
// assertion-for-assertion port of tests/unit/test_types.py (R10.2),
// `.df` -> `toRows()`/`rowColumns()` per the C6 row contract.
//
// Translation notes (applied consistently, see the design's Risk #6):
// - `df.columns` assertions -> `rowColumns()`; `len(df)` ->
//   `toRows().length`.
// - Python `test_df_cached` asserts `df1 is df2` (pandas identity
//   caching). TS `toRows()` is cheap/pure with NO mandated cache
//   (phase2-design C6), so the caching tests translate to repeated
//   calls being deep-equal (determinism — the observable half).
// - Frozen-dataclass immutability suites have no TS runtime analog
//   (`readonly` is the compile-time equivalent) and are not ported.
// - The `TestResultWithDataFrame` base-class suite exercises the
//   pandas plumbing (`NotImplementedError`, `to_table_dict`) that has
//   no TS runtime artifact — the TS row contract lives on each class.
// - `TestCustomEventExports` is a P2-7 entity-surface concern, not
//   ported here.
import { describe, expect, it } from "vitest";

import {
  FunnelInfo,
  ProfilePageResult,
  SavedCohort,
  SubPropertyInfo,
  TopEvent,
} from "../../../src/types/results/discovery.js";
import {
  CohortInfo,
  EventCountsResult,
  FunnelResult,
  FunnelResultStep,
  PropertyCountsResult,
  RetentionResult,
  SegmentationResult,
} from "../../../src/types/results/live-query.js";

describe("SegmentationResult (TestSegmentationResult)", () => {
  it("test_basic_creation", () => {
    const result = new SegmentationResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      segment_property: "country",
      total: 5000,
      series: {
        US: { "2024-01-01": 100, "2024-01-02": 150 },
        EU: { "2024-01-01": 50, "2024-01-02": 75 },
      },
    });
    expect(result.event).toBe("Purchase");
    expect(result.total).toBe(5000);
  });

  it("test_df_has_expected_columns", () => {
    const result = new SegmentationResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-02",
      unit: "day",
      segment_property: "country",
      total: 375,
      series: {
        US: { "2024-01-01": 100, "2024-01-02": 150 },
        EU: { "2024-01-01": 50, "2024-01-02": 75 },
      },
    });
    expect(result.rowColumns()).toContain("date");
    expect(result.rowColumns()).toContain("segment");
    expect(result.rowColumns()).toContain("count");
    expect(result.toRows()).toHaveLength(4); // 2 segments x 2 dates
  });

  it("test_df_empty_series", () => {
    const result = new SegmentationResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      segment_property: null,
      total: 0,
      series: {},
    });
    expect(result.toRows()).toHaveLength(0);
    expect(result.rowColumns()).toContain("date");
  });

  it("test_df_cached (determinism)", () => {
    const result = new SegmentationResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      segment_property: null,
      total: 0,
      series: {},
    });
    expect(result.toRows()).toStrictEqual(result.toRows());
  });

  it("test_to_dict_serializable", () => {
    const result = new SegmentationResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      segment_property: "country",
      total: 5000,
      series: { US: { "2024-01-01": 100 } },
    });
    const json_str = JSON.stringify(result.toJSON());
    expect(json_str).toContain("Purchase");
  });
});

describe("FunnelResult (TestFunnelResult)", () => {
  it("test_funnel_step_creation", () => {
    const step = new FunnelResultStep({
      event: "Sign Up",
      count: 1000,
      conversion_rate: 1.0,
    });
    expect(step.event).toBe("Sign Up");
    expect(step.count).toBe(1000);
    expect(step.conversion_rate).toBe(1.0);
  });

  it("test_funnel_result_creation", () => {
    const steps = [
      new FunnelResultStep({
        event: "View",
        count: 1000,
        conversion_rate: 1.0,
      }),
      new FunnelResultStep({
        event: "Click",
        count: 500,
        conversion_rate: 0.5,
      }),
      new FunnelResultStep({
        event: "Purchase",
        count: 100,
        conversion_rate: 0.2,
      }),
    ];
    const result = new FunnelResult({
      funnel_id: 12345,
      funnel_name: "Checkout Funnel",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      conversion_rate: 0.1,
      steps,
    });
    expect(result.funnel_id).toBe(12345);
    expect(result.funnel_name).toBe("Checkout Funnel");
    expect(result.conversion_rate).toBe(0.1);
    expect(result.steps).toHaveLength(3);
  });

  it("test_steps_iteration", () => {
    const steps = [
      new FunnelResultStep({ event: "A", count: 100, conversion_rate: 1.0 }),
      new FunnelResultStep({ event: "B", count: 50, conversion_rate: 0.5 }),
    ];
    const result = new FunnelResult({
      funnel_id: 1,
      funnel_name: "Test",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      conversion_rate: 0.5,
      steps,
    });
    expect(result.steps.map((step) => step.event)).toStrictEqual(["A", "B"]);
  });

  it("test_df_has_expected_columns", () => {
    const steps = [
      new FunnelResultStep({
        event: "View",
        count: 1000,
        conversion_rate: 1.0,
      }),
      new FunnelResultStep({
        event: "Click",
        count: 500,
        conversion_rate: 0.5,
      }),
    ];
    const result = new FunnelResult({
      funnel_id: 1,
      funnel_name: "Test",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      conversion_rate: 0.5,
      steps,
    });
    expect(result.rowColumns()).toContain("step");
    expect(result.rowColumns()).toContain("event");
    expect(result.rowColumns()).toContain("count");
    expect(result.rowColumns()).toContain("conversion_rate");
    expect(result.toRows()).toHaveLength(2);
  });

  it("test_df_cached (determinism)", () => {
    const steps = [
      new FunnelResultStep({
        event: "View",
        count: 1000,
        conversion_rate: 1.0,
      }),
    ];
    const result = new FunnelResult({
      funnel_id: 1,
      funnel_name: "Test",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      conversion_rate: 1.0,
      steps,
    });
    expect(result.toRows()).toStrictEqual(result.toRows());
  });

  it("test_to_dict_serializable", () => {
    const steps = [
      new FunnelResultStep({
        event: "View",
        count: 1000,
        conversion_rate: 1.0,
      }),
    ];
    const result = new FunnelResult({
      funnel_id: 1,
      funnel_name: "Test",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      conversion_rate: 1.0,
      steps,
    });
    const data = result.toJSON();
    const json_str = JSON.stringify(data);
    expect(json_str).toContain("Test");
    expect(data["steps"]).toHaveLength(1);
  });
});

describe("RetentionResult (TestRetentionResult)", () => {
  it("test_cohort_info_creation", () => {
    const cohort = new CohortInfo({
      date: "2024-01-01",
      size: 1000,
      retention: [1.0, 0.5, 0.3, 0.2],
    });
    expect(cohort.date).toBe("2024-01-01");
    expect(cohort.size).toBe(1000);
    expect(cohort.retention).toStrictEqual([1.0, 0.5, 0.3, 0.2]);
  });

  it("test_retention_result_creation", () => {
    const cohorts = [
      new CohortInfo({ date: "2024-01-01", size: 1000, retention: [1.0, 0.5] }),
      new CohortInfo({ date: "2024-01-08", size: 800, retention: [1.0, 0.4] }),
    ];
    const result = new RetentionResult({
      born_event: "Sign Up",
      return_event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "week",
      cohorts,
    });
    expect(result.born_event).toBe("Sign Up");
    expect(result.return_event).toBe("Purchase");
    expect(result.cohorts).toHaveLength(2);
  });

  it("test_df_has_expected_columns", () => {
    const cohorts = [
      new CohortInfo({
        date: "2024-01-01",
        size: 1000,
        retention: [1.0, 0.5, 0.3],
      }),
    ];
    const result = new RetentionResult({
      born_event: "Sign Up",
      return_event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "week",
      cohorts,
    });
    expect(result.rowColumns()).toContain("cohort_date");
    expect(result.rowColumns()).toContain("cohort_size");
    expect(result.rowColumns()).toContain("period_0");
    expect(result.rowColumns()).toContain("period_1");
    expect(result.rowColumns()).toContain("period_2");
  });

  it("test_df_cached (determinism)", () => {
    const cohorts = [
      new CohortInfo({ date: "2024-01-01", size: 1000, retention: [1.0, 0.5] }),
    ];
    const result = new RetentionResult({
      born_event: "Sign Up",
      return_event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "week",
      cohorts,
    });
    expect(result.toRows()).toStrictEqual(result.toRows());
  });

  it("test_to_dict_serializable", () => {
    const cohorts = [
      new CohortInfo({ date: "2024-01-01", size: 1000, retention: [1.0, 0.5] }),
    ];
    const result = new RetentionResult({
      born_event: "Sign Up",
      return_event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "week",
      cohorts,
    });
    expect(JSON.stringify(result.toJSON())).toContain("Sign Up");
  });
});

describe("FunnelInfo (TestFunnelInfo)", () => {
  it("test_basic_creation", () => {
    const info = new FunnelInfo({ funnel_id: 12345, name: "Checkout Funnel" });
    expect(info.funnel_id).toBe(12345);
    expect(info.name).toBe("Checkout Funnel");
  });

  it("test_to_dict_serializable", () => {
    const info = new FunnelInfo({ funnel_id: 12345, name: "Checkout Funnel" });
    const data = info.toJSON();
    const json_str = JSON.stringify(data);
    expect(json_str).toContain("12345");
    expect(json_str).toContain("Checkout Funnel");
    expect(data["funnel_id"]).toBe(12345);
    expect(data["name"]).toBe("Checkout Funnel");
  });
});

describe("SavedCohort (TestSavedCohort)", () => {
  it("test_basic_creation", () => {
    const cohort = new SavedCohort({
      id: 456,
      name: "Power Users",
      count: 1500,
      description: "Users with 10+ purchases",
      created: "2024-01-15 10:30:00",
      is_visible: true,
    });
    expect(cohort.id).toBe(456);
    expect(cohort.name).toBe("Power Users");
    expect(cohort.count).toBe(1500);
    expect(cohort.description).toBe("Users with 10+ purchases");
    expect(cohort.created).toBe("2024-01-15 10:30:00");
    expect(cohort.is_visible).toBe(true);
  });

  it("test_to_dict_serializable", () => {
    const cohort = new SavedCohort({
      id: 456,
      name: "Power Users",
      count: 1500,
      description: "Users with 10+ purchases",
      created: "2024-01-15 10:30:00",
      is_visible: true,
    });
    const data = cohort.toJSON();
    expect(JSON.stringify(data)).toContain("Power Users");
    expect(data["id"]).toBe(456);
    expect(data["count"]).toBe(1500);
    expect(data["is_visible"]).toBe(true);
  });
});

describe("TopEvent (TestTopEvent)", () => {
  it("test_basic_creation", () => {
    const event = new TopEvent({
      event: "Sign Up",
      count: 1500,
      percent_change: 0.25,
    });
    expect(event.event).toBe("Sign Up");
    expect(event.count).toBe(1500);
    expect(event.percent_change).toBe(0.25);
  });

  it("test_negative_percent_change", () => {
    const event = new TopEvent({
      event: "Purchase",
      count: 500,
      percent_change: -0.15,
    });
    expect(event.percent_change).toBe(-0.15);
  });

  it("test_to_dict_serializable", () => {
    const event = new TopEvent({
      event: "Sign Up",
      count: 1500,
      percent_change: 0.25,
    });
    const data = event.toJSON();
    expect(JSON.stringify(data)).toContain("Sign Up");
    expect(data["count"]).toBe(1500);
    expect(data["percent_change"]).toBe(0.25);
  });
});

describe("EventCountsResult (TestEventCountsResult)", () => {
  it("test_basic_creation", () => {
    const result = new EventCountsResult({
      events: ["Sign Up", "Purchase"],
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      type: "general",
      series: {
        "Sign Up": { "2024-01-01": 100, "2024-01-02": 150 },
        Purchase: { "2024-01-01": 50, "2024-01-02": 75 },
      },
    });
    expect(result.events).toStrictEqual(["Sign Up", "Purchase"]);
    expect(result.from_date).toBe("2024-01-01");
    expect(result.unit).toBe("day");
    expect(result.type).toBe("general");
  });

  it("test_df_has_expected_columns", () => {
    const result = new EventCountsResult({
      events: ["Sign Up", "Purchase"],
      from_date: "2024-01-01",
      to_date: "2024-01-02",
      unit: "day",
      type: "general",
      series: {
        "Sign Up": { "2024-01-01": 100, "2024-01-02": 150 },
        Purchase: { "2024-01-01": 50, "2024-01-02": 75 },
      },
    });
    expect(result.rowColumns()).toContain("date");
    expect(result.rowColumns()).toContain("event");
    expect(result.rowColumns()).toContain("count");
    expect(result.toRows()).toHaveLength(4); // 2 events x 2 dates
  });

  it("test_df_empty_series", () => {
    const result = new EventCountsResult({
      events: [],
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      type: "general",
      series: {},
    });
    expect(result.toRows()).toHaveLength(0);
    expect(result.rowColumns()).toContain("date");
  });

  it("test_df_cached (determinism)", () => {
    const result = new EventCountsResult({
      events: ["Test"],
      from_date: "2024-01-01",
      to_date: "2024-01-01",
      unit: "day",
      type: "general",
      series: { Test: { "2024-01-01": 100 } },
    });
    expect(result.toRows()).toStrictEqual(result.toRows());
  });

  it("test_to_dict_serializable", () => {
    const result = new EventCountsResult({
      events: ["Sign Up"],
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      type: "general",
      series: { "Sign Up": { "2024-01-01": 100 } },
    });
    const data = result.toJSON();
    expect(JSON.stringify(data)).toContain("Sign Up");
    expect(data["unit"]).toBe("day");
    expect(data["type"]).toBe("general");
  });
});

describe("PropertyCountsResult (TestPropertyCountsResult)", () => {
  it("test_basic_creation", () => {
    const result = new PropertyCountsResult({
      event: "Purchase",
      property_name: "country",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      type: "general",
      series: {
        US: { "2024-01-01": 100, "2024-01-02": 150 },
        CA: { "2024-01-01": 50, "2024-01-02": 75 },
      },
    });
    expect(result.event).toBe("Purchase");
    expect(result.property_name).toBe("country");
    expect(result.from_date).toBe("2024-01-01");
  });

  it("test_df_has_expected_columns", () => {
    const result = new PropertyCountsResult({
      event: "Purchase",
      property_name: "country",
      from_date: "2024-01-01",
      to_date: "2024-01-02",
      unit: "day",
      type: "general",
      series: {
        US: { "2024-01-01": 100, "2024-01-02": 150 },
        CA: { "2024-01-01": 50, "2024-01-02": 75 },
      },
    });
    expect(result.rowColumns()).toContain("date");
    expect(result.rowColumns()).toContain("value");
    expect(result.rowColumns()).toContain("count");
    expect(result.toRows()).toHaveLength(4); // 2 values x 2 dates
  });

  it("test_df_empty_series", () => {
    const result = new PropertyCountsResult({
      event: "Purchase",
      property_name: "country",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      type: "general",
      series: {},
    });
    expect(result.toRows()).toHaveLength(0);
    expect(result.rowColumns()).toContain("date");
  });

  it("test_df_cached (determinism)", () => {
    const result = new PropertyCountsResult({
      event: "Purchase",
      property_name: "country",
      from_date: "2024-01-01",
      to_date: "2024-01-01",
      unit: "day",
      type: "general",
      series: { US: { "2024-01-01": 100 } },
    });
    expect(result.toRows()).toStrictEqual(result.toRows());
  });

  it("test_to_dict_serializable", () => {
    const result = new PropertyCountsResult({
      event: "Purchase",
      property_name: "country",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      type: "general",
      series: { US: { "2024-01-01": 100 } },
    });
    const data = result.toJSON();
    expect(JSON.stringify(data)).toContain("Purchase");
    expect(data["property_name"]).toBe("country");
  });
});

describe("ProfilePageResult (TestProfilePageResult)", () => {
  it("test_create_with_profiles", () => {
    const profiles = [
      { $distinct_id: "user1", $properties: { name: "Alice" } },
      { $distinct_id: "user2", $properties: { name: "Bob" } },
    ];
    const result = new ProfilePageResult({
      profiles,
      session_id: "abc123",
      page: 0,
      has_more: true,
      total: 5000,
      page_size: 1000,
    });
    expect(result.profiles).toStrictEqual(profiles);
    expect(result.session_id).toBe("abc123");
    expect(result.page).toBe(0);
    expect(result.has_more).toBe(true);
    expect(result.total).toBe(5000);
    expect(result.page_size).toBe(1000);
  });

  it("test_create_last_page", () => {
    const result = new ProfilePageResult({
      profiles: [{ $distinct_id: "user1" }],
      session_id: null,
      page: 5,
      has_more: false,
      total: 5001,
      page_size: 1000,
    });
    expect(result.session_id).toBeNull();
    expect(result.has_more).toBe(false);
    expect(result.page).toBe(5);
  });

  it("test_to_dict", () => {
    const profiles = [{ $distinct_id: "user1" }, { $distinct_id: "user2" }];
    const result = new ProfilePageResult({
      profiles,
      session_id: "session123",
      page: 2,
      has_more: true,
      total: 5000,
      page_size: 1000,
    });
    const data = result.toJSON();
    expect(data["profiles"]).toStrictEqual(profiles);
    expect(data["session_id"]).toBe("session123");
    expect(data["page"]).toBe(2);
    expect(data["has_more"]).toBe(true);
    expect(data["profile_count"]).toBe(2);
    expect(data["total"]).toBe(5000);
    expect(data["page_size"]).toBe(1000);
    expect(data["num_pages"]).toBe(5);
  });

  it("test_to_dict_json_serializable", () => {
    const result = new ProfilePageResult({
      profiles: [
        { $distinct_id: "user1", $properties: { email: "test@example.com" } },
      ],
      session_id: "session123",
      page: 0,
      has_more: true,
      total: 1000,
      page_size: 1000,
    });
    const json_str = JSON.stringify(result.toJSON());
    expect(json_str).toContain("session123");
    expect(json_str).toContain("profile_count");
    expect(json_str).toContain("total");
    expect(json_str).toContain("num_pages");
  });
});

describe("ProfilePageResult pagination (TestProfilePageResultPagination)", () => {
  const base = {
    profiles: [],
    session_id: "session_abc",
    page: 0,
    has_more: true,
  } as const;

  it("test_profile_page_result_includes_total_field", () => {
    const result = new ProfilePageResult({
      ...base,
      total: 5000,
      page_size: 1000,
    });
    expect(result.total).toBe(5000);
  });

  it("test_profile_page_result_includes_page_size_field", () => {
    const result = new ProfilePageResult({
      ...base,
      total: 5000,
      page_size: 1000,
    });
    expect(result.page_size).toBe(1000);
  });

  it("test_num_pages_property_computes_ceiling", () => {
    const result = new ProfilePageResult({
      ...base,
      total: 5432,
      page_size: 1000,
    });
    expect(result.num_pages).toBe(6); // ceil(5432/1000)
  });

  it("test_num_pages_exact_division", () => {
    const result = new ProfilePageResult({
      ...base,
      total: 5000,
      page_size: 1000,
    });
    expect(result.num_pages).toBe(5); // 5000 / 1000 exactly
  });

  it("test_num_pages_empty_result_returns_zero", () => {
    const result = new ProfilePageResult({
      profiles: [],
      session_id: null,
      page: 0,
      has_more: false,
      total: 0,
      page_size: 1000,
    });
    expect(result.num_pages).toBe(0);
  });

  it("test_num_pages_single_page", () => {
    const result = new ProfilePageResult({
      profiles: [{ $distinct_id: "user1" }],
      session_id: null,
      page: 0,
      has_more: false,
      total: 500,
      page_size: 1000,
    });
    expect(result.num_pages).toBe(1); // 500 < 1000
  });

  it("test_to_dict_includes_pagination_fields", () => {
    const result = new ProfilePageResult({
      profiles: [{ $distinct_id: "user1" }],
      session_id: "session_abc",
      page: 0,
      has_more: true,
      total: 5000,
      page_size: 1000,
    });
    const d = result.toJSON();
    expect(d["total"]).toBe(5000);
    expect(d["page_size"]).toBe(1000);
    expect(d["num_pages"]).toBe(5);
  });
});

describe("SubPropertyInfo (TestSubPropertyInfo)", () => {
  it("test_to_dict_returns_lists_for_sample_values", () => {
    const sp = new SubPropertyInfo({
      name: "Brand",
      type: "string",
      sample_values: ["nike", "puma"],
    });
    const result = sp.toJSON();
    expect(result).toStrictEqual({
      name: "Brand",
      type: "string",
      sample_values: ["nike", "puma"],
    });
    // The sample_values value must be an array for JSON.
    expect(Array.isArray(result["sample_values"])).toBe(true);
    // And the result must round-trip through JSON without error.
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  });
});
