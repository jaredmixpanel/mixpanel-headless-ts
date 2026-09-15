// UserEvent, ActivityFeedResult, the NumericSum / NumericAverage /
// Frequency / NumericBucket results and SavedReportResult: construction,
// the df projection as row arrays and to_dict. Mirrors
// tests/unit/test_types_phase008.py. Python builds UserEvent with tz-aware
// datetimes; the TS field stores ISO text (`isoformat()` strings).
import { describe, expect, it } from "vitest";

import {
  ActivityFeedResult,
  FrequencyResult,
  NumericAverageResult,
  NumericBucketResult,
  NumericSumResult,
  SavedReportResult,
  UserEvent,
} from "../../../src/types/results/live-query.js";

describe("UserEvent", () => {
  // python: TestUserEvent
  it("basic creation", () => {
    // python: test_basic_creation
    const eventTime = "2024-01-01T12:00:00+00:00";
    const event = new UserEvent({
      event: "Sign Up",
      time: eventTime,
      properties: { plan: "premium", $distinct_id: "user_123" },
    });
    expect(event.event).toBe("Sign Up");
    expect(event.time).toBe(eventTime);
    expect(event.properties["plan"]).toBe("premium");
  });

  it("to dict serializable", () => {
    // python: test_to_dict_serializable
    const event = new UserEvent({
      event: "Sign Up",
      time: "2024-01-01T12:00:00+00:00",
      properties: { plan: "premium" },
    });
    const data = event.toJSON();
    const jsonStr = JSON.stringify(data);
    expect(jsonStr).toContain("Sign Up");
    expect(data["event"]).toBe("Sign Up");
    expect(data["time"]).toContain("2024-01-01");
  });
});

describe("ActivityFeedResult", () => {
  // python: TestActivityFeedResult
  it("basic creation", () => {
    // python: test_basic_creation
    const events = [
      new UserEvent({
        event: "Sign Up",
        time: "2024-01-01T12:00:00+00:00",
        properties: { $distinct_id: "user_123" },
      }),
    ];
    const result = new ActivityFeedResult({
      distinct_ids: ["user_123"],
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      events,
    });
    expect(result.distinct_ids).toStrictEqual(["user_123"]);
    expect(result.from_date).toBe("2024-01-01");
    expect(result.events).toHaveLength(1);
  });

  it("df has expected columns", () => {
    // python: test_df_has_expected_columns
    const events = [
      new UserEvent({
        event: "Sign Up",
        time: "2024-01-01T12:00:00+00:00",
        properties: { $distinct_id: "user_123", plan: "free" },
      }),
      new UserEvent({
        event: "Purchase",
        time: "2024-01-02T12:00:00+00:00",
        properties: { $distinct_id: "user_123", amount: 99.99 },
      }),
    ];
    const result = new ActivityFeedResult({
      distinct_ids: ["user_123"],
      from_date: "2024-01-01",
      to_date: "2024-01-02",
      events,
    });
    expect(result.rowColumns()).toContain("event");
    expect(result.rowColumns()).toContain("time");
    expect(result.rowColumns()).toContain("distinct_id");
    expect(result.toRows()).toHaveLength(2);
  });

  it("df empty events", () => {
    // python: test_df_empty_events
    const result = new ActivityFeedResult({
      distinct_ids: ["user_123"],
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      events: [],
    });
    expect(result.toRows()).toHaveLength(0);
    expect(result.rowColumns()).toContain("event");
  });

  it("df cached (determinism)", () => {
    // python: test_df_cached
    const result = new ActivityFeedResult({
      distinct_ids: ["user_123"],
      from_date: null,
      to_date: null,
      events: [],
    });
    expect(result.toRows()).toStrictEqual(result.toRows());
  });

  it("to dict serializable", () => {
    // python: test_to_dict_serializable
    const events = [
      new UserEvent({
        event: "Sign Up",
        time: "2024-01-01T12:00:00+00:00",
        properties: { $distinct_id: "user_123" },
      }),
    ];
    const result = new ActivityFeedResult({
      distinct_ids: ["user_123"],
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      events,
    });
    const data = result.toJSON();
    expect(JSON.stringify(data)).toContain("user_123");
    expect(data["event_count"]).toBe(1);
    expect(data["events"]).toHaveLength(1);
  });
});

describe("NumericSumResult", () => {
  // python: TestNumericSumResult
  it("basic creation", () => {
    // python: test_basic_creation
    const result = new NumericSumResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      property_expr: 'properties["amount"]',
      unit: "day",
      results: { "2024-01-01": 15432.5, "2024-01-02": 18976.25 },
      computed_at: "2024-01-31T23:02:11+00:00",
    });
    expect(result.event).toBe("Purchase");
    expect(result.property_expr).toBe('properties["amount"]');
    expect(result.results["2024-01-01"]).toBe(15432.5);
  });

  it("df has expected columns", () => {
    // python: test_df_has_expected_columns
    const result = new NumericSumResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-02",
      property_expr: 'properties["amount"]',
      unit: "day",
      results: { "2024-01-01": 100.0, "2024-01-02": 200.0 },
    });
    expect(result.rowColumns()).toContain("date");
    expect(result.rowColumns()).toContain("sum");
    expect(result.toRows()).toHaveLength(2);
  });

  it("df empty results", () => {
    // python: test_df_empty_results
    const result = new NumericSumResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      property_expr: 'properties["amount"]',
      unit: "day",
      results: {},
    });
    expect(result.toRows()).toHaveLength(0);
    expect(result.rowColumns()).toContain("date");
  });

  it("df cached (determinism)", () => {
    // python: test_df_cached
    const result = new NumericSumResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      property_expr: 'properties["amount"]',
      unit: "day",
      results: { "2024-01-01": 100.0 },
    });
    expect(result.toRows()).toStrictEqual(result.toRows());
  });

  it("to dict with computed at", () => {
    // python: test_to_dict_with_computed_at
    const result = new NumericSumResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      property_expr: 'properties["amount"]',
      unit: "day",
      results: { "2024-01-01": 100.0 },
      computed_at: "2024-01-31T23:02:11+00:00",
    });
    expect(Object.hasOwn(result.toJSON(), "computed_at")).toBe(true);
  });

  it("to dict without computed at", () => {
    // python: test_to_dict_without_computed_at
    const result = new NumericSumResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      property_expr: 'properties["amount"]',
      unit: "day",
      results: { "2024-01-01": 100.0 },
    });
    expect(Object.hasOwn(result.toJSON(), "computed_at")).toBe(false);
  });
});

describe("NumericAverageResult", () => {
  // python: TestNumericAverageResult
  it("basic creation", () => {
    // python: test_basic_creation
    const result = new NumericAverageResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      property_expr: 'properties["amount"]',
      unit: "day",
      results: { "2024-01-01": 54.32, "2024-01-02": 62.15 },
    });
    expect(result.event).toBe("Purchase");
    expect(result.results["2024-01-01"]).toBe(54.32);
  });

  it("df has expected columns", () => {
    // python: test_df_has_expected_columns
    const result = new NumericAverageResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-02",
      property_expr: 'properties["amount"]',
      unit: "day",
      results: { "2024-01-01": 50.0, "2024-01-02": 60.0 },
    });
    expect(result.rowColumns()).toContain("date");
    expect(result.rowColumns()).toContain("average");
    expect(result.toRows()).toHaveLength(2);
  });

  it("df empty results", () => {
    // python: test_df_empty_results
    const result = new NumericAverageResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      property_expr: 'properties["amount"]',
      unit: "day",
      results: {},
    });
    expect(result.toRows()).toHaveLength(0);
    expect(result.rowColumns()).toContain("date");
  });

  it("df cached (determinism)", () => {
    // python: test_df_cached
    const result = new NumericAverageResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      property_expr: 'properties["amount"]',
      unit: "day",
      results: { "2024-01-01": 50.0 },
    });
    expect(result.toRows()).toStrictEqual(result.toRows());
  });

  it("to dict serializable", () => {
    // python: test_to_dict_serializable
    const result = new NumericAverageResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      property_expr: 'properties["amount"]',
      unit: "day",
      results: { "2024-01-01": 54.32 },
    });
    const data = result.toJSON();
    expect(JSON.stringify(data)).toContain("Purchase");
    expect(data["property_expr"]).toBe('properties["amount"]');
  });
});

describe("FrequencyResult", () => {
  // python: TestFrequencyResult
  it("basic creation", () => {
    // python: test_basic_creation
    const result = new FrequencyResult({
      event: "App Open",
      from_date: "2024-01-01",
      to_date: "2024-01-07",
      unit: "day",
      addiction_unit: "hour",
      data: {
        "2024-01-01": [305, 107, 60, 41, 32],
        "2024-01-02": [495, 204, 117, 77, 53],
      },
    });
    expect(result.event).toBe("App Open");
    expect(result.unit).toBe("day");
    expect(result.addiction_unit).toBe("hour");
    expect(result.data["2024-01-01"]).toHaveLength(5);
  });

  it("df has expected columns", () => {
    // python: test_df_has_expected_columns
    const result = new FrequencyResult({
      event: "App Open",
      from_date: "2024-01-01",
      to_date: "2024-01-01",
      unit: "day",
      addiction_unit: "hour",
      data: { "2024-01-01": [100, 50, 25] },
    });
    expect(result.rowColumns()).toContain("date");
    expect(result.rowColumns()).toContain("period_1");
    expect(result.rowColumns()).toContain("period_2");
    expect(result.rowColumns()).toContain("period_3");
    expect(result.toRows()).toHaveLength(1);
  });

  it("df empty data", () => {
    // python: test_df_empty_data
    const result = new FrequencyResult({
      event: null,
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      addiction_unit: "hour",
      data: {},
    });
    expect(result.toRows()).toHaveLength(0);
    expect(result.rowColumns()).toContain("date");
  });

  it("df cached (determinism)", () => {
    // python: test_df_cached
    const result = new FrequencyResult({
      event: "App Open",
      from_date: "2024-01-01",
      to_date: "2024-01-01",
      unit: "day",
      addiction_unit: "hour",
      data: { "2024-01-01": [100, 50] },
    });
    expect(result.toRows()).toStrictEqual(result.toRows());
  });

  it("event can be null", () => {
    // python: test_event_can_be_none
    const result = new FrequencyResult({
      event: null,
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      addiction_unit: "hour",
      data: {},
    });
    expect(result.event).toBeNull();
  });

  it("to dict serializable", () => {
    // python: test_to_dict_serializable
    const result = new FrequencyResult({
      event: "App Open",
      from_date: "2024-01-01",
      to_date: "2024-01-07",
      unit: "day",
      addiction_unit: "hour",
      data: { "2024-01-01": [100, 50] },
    });
    const data = result.toJSON();
    expect(JSON.stringify(data)).toContain("App Open");
    expect(data["unit"]).toBe("day");
    expect(data["addiction_unit"]).toBe("hour");
  });
});

describe("NumericBucketResult", () => {
  // python: TestNumericBucketResult
  it("basic creation", () => {
    // python: test_basic_creation
    const result = new NumericBucketResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      property_expr: 'properties["amount"]',
      unit: "day",
      series: {
        "0 - 100": { "2024-01-01": 50, "2024-01-02": 65 },
        "100 - 200": { "2024-01-01": 35, "2024-01-02": 42 },
      },
    });
    expect(result.event).toBe("Purchase");
    expect(result.property_expr).toBe('properties["amount"]');
    expect(result.series["0 - 100"]?.["2024-01-01"]).toBe(50);
  });

  it("df has expected columns", () => {
    // python: test_df_has_expected_columns
    const result = new NumericBucketResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-02",
      property_expr: 'properties["amount"]',
      unit: "day",
      series: {
        "0 - 100": { "2024-01-01": 50, "2024-01-02": 65 },
        "100 - 200": { "2024-01-01": 35, "2024-01-02": 42 },
      },
    });
    expect(result.rowColumns()).toContain("date");
    expect(result.rowColumns()).toContain("bucket");
    expect(result.rowColumns()).toContain("count");
    expect(result.toRows()).toHaveLength(4); // 2 buckets x 2 dates
  });

  it("df empty series", () => {
    // python: test_df_empty_series
    const result = new NumericBucketResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      property_expr: 'properties["amount"]',
      unit: "day",
      series: {},
    });
    expect(result.toRows()).toHaveLength(0);
    expect(result.rowColumns()).toContain("date");
  });

  it("df cached (determinism)", () => {
    // python: test_df_cached
    const result = new NumericBucketResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      property_expr: 'properties["amount"]',
      unit: "day",
      series: { "0 - 100": { "2024-01-01": 50 } },
    });
    expect(result.toRows()).toStrictEqual(result.toRows());
  });

  it("to dict serializable", () => {
    // python: test_to_dict_serializable
    const result = new NumericBucketResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      property_expr: 'properties["amount"]',
      unit: "day",
      series: { "0 - 100": { "2024-01-01": 50 } },
    });
    const jsonStr = JSON.stringify(result.toJSON());
    expect(jsonStr).toContain("Purchase");
    expect(jsonStr).toContain("0 - 100");
  });
});

describe("SavedReportResult phase008", () => {
  // python: TestSavedReportResult
  it("basic creation", () => {
    // python: test_basic_creation
    const result = new SavedReportResult({
      bookmark_id: 12345678,
      computed_at: "2024-01-15T10:30:00+00:00",
      from_date: "2024-01-01",
      to_date: "2024-01-07",
      headers: ["$event"],
      series: {
        "Sign Up": { "2024-01-01": 150, "2024-01-02": 175 },
        Purchase: { "2024-01-01": 50, "2024-01-02": 65 },
      },
    });
    expect(result.bookmark_id).toBe(12345678);
    expect(result.computed_at).toBe("2024-01-15T10:30:00+00:00");
    expect(
      (result.series["Sign Up"] as Record<string, number>)["2024-01-01"],
    ).toBe(150);
  });

  it("df has expected columns", () => {
    // python: test_df_has_expected_columns
    const result = new SavedReportResult({
      bookmark_id: 12345,
      computed_at: "2024-01-15T10:30:00+00:00",
      from_date: "2024-01-01",
      to_date: "2024-01-02",
      headers: ["$event"],
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

  it("df empty series", () => {
    // python: test_df_empty_series
    const result = new SavedReportResult({
      bookmark_id: 12345,
      computed_at: "2024-01-15T10:30:00+00:00",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      headers: [],
      series: {},
    });
    expect(result.toRows()).toHaveLength(0);
    expect(result.rowColumns()).toContain("date");
  });

  it("df cached (determinism)", () => {
    // python: test_df_cached
    const result = new SavedReportResult({
      bookmark_id: 12345,
      computed_at: "2024-01-15T10:30:00+00:00",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      headers: ["$event"],
      series: { "Sign Up": { "2024-01-01": 100 } },
    });
    expect(result.toRows()).toStrictEqual(result.toRows());
  });

  it("to dict serializable", () => {
    // python: test_to_dict_serializable
    const result = new SavedReportResult({
      bookmark_id: 12345678,
      computed_at: "2024-01-15T10:30:00+00:00",
      from_date: "2024-01-01",
      to_date: "2024-01-07",
      headers: ["$event"],
      series: { "Sign Up": { "2024-01-01": 150 } },
    });
    const data = result.toJSON();
    expect(JSON.stringify(data)).toContain("12345678");
    expect(data["computed_at"]).toBe("2024-01-15T10:30:00+00:00");
  });
});
