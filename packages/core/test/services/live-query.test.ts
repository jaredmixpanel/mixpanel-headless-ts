// Translated LiveQueryService tests (B5-S2, packet §3): assertion-for-
// assertion port of tests/unit/test_live_query.py (R10.2) — ALL 7
// classes (TestLiveQueryService :57, TestSegmentation :78, TestFunnel
// :287, TestExtractStepsFromDateData :528, TestRetention :658,
// TestEventCounts :845, TestPropertyCounts :1013).
//
// Translation notes (applied consistently):
// - `live_query_factory` -> `liveQueryFactory` over the B4
//   `createMockClient` httpx.MockTransport analog
//   (`test-support/client-test-helpers.ts`). Python's explicit
//   `client.__enter__()` / `__exit__` has no TS twin (R6.2: the TS
//   client owns no pool that needs opening).
// - Handlers that `assert` on the captured request assert AFTER the
//   await via the transport capture log: a throw inside the injected
//   fetch would be normalized into a transport error by the B4 client
//   and mask the assertion. Same assertion, same values.
// - `result.df` asserts (`test_event_counts_df_conversion`,
//   `test_property_counts_df_conversion`, and the two `len(df) == 0`
//   cases) become `toRows()` / `rowColumns()` asserts per the C6
//   pandas convention — the pre-pandas row list IS the frame body.
// - The private `_extract_steps_from_date_data` is
//   {@link extractStepsFromDateData} in `services/live-query-transforms.ts`
//   (R7.2 split of the 2,042-line Python module).

import { describe, expect, it } from "vitest";
import {
  createMockClient,
  makeSession,
  type CannedResponse,
  type CapturedFetchRequest,
  type FakeTransport,
} from "../../test-support/client-test-helpers.js";
import { LiveQueryService } from "../../src/services/live-query.js";
import { extractStepsFromDateData } from "../../src/services/live-query-transforms.js";
import { AuthenticationError, QueryError } from "../../src/errors.js";

/** A canned-response handler (the httpx.MockTransport handler twin). */
type Handler = (request: CapturedFetchRequest) => CannedResponse;

/**
 * The `live_query_factory` fixture (test_live_query.py:21-54).
 *
 * @param handler - The canned-response handler.
 * @returns The service under test plus the transport capture log.
 */
function liveQueryFactory(handler: Handler): {
  live: LiveQueryService;
  transport: FakeTransport;
} {
  const { client, transport } = createMockClient(makeSession(), handler);
  return { live: new LiveQueryService(client), transport };
}

/** The `success_handler` fixture (conftest.py:311-317). */
const successHandler: Handler = () => ({ status: 200, json: [] });

/**
 * The single captured request URL (the `str(request.url)` the Python
 * handlers assert against).
 *
 * @param transport - The capture log.
 * @returns The URL text of the first captured request.
 */
function firstUrl(transport: FakeTransport): string {
  return transport.captures[0]!.url;
}

describe("TestLiveQueryService", () => {
  it("accepts an API client", () => {
    const { client } = createMockClient(makeSession(), successHandler);
    const live = new LiveQueryService(client);
    expect(live.apiClient).toBe(client);
  });
});

// ===========================================================================
// User Story 1: Segmentation Tests
// ===========================================================================

describe("TestSegmentation", () => {
  it("returns SegmentationResult with correct data", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: {
        data: {
          series: ["2024-01-01", "2024-01-02", "2024-01-03"],
          values: {
            "Sign Up": {
              "2024-01-01": 147,
              "2024-01-02": 146,
              "2024-01-03": 776,
            },
          },
        },
        legend_size: 1,
      },
    }));
    const result = await live.segmentation(
      "Sign Up",
      "2024-01-01",
      "2024-01-03",
    );

    expect(result.event).toBe("Sign Up");
    expect(result.from_date).toBe("2024-01-01");
    expect(result.to_date).toBe("2024-01-03");
    expect(result.unit).toBe("day");
    expect(result.segment_property).toBeNull();
    expect(result.series).toEqual({
      "Sign Up": {
        "2024-01-01": 147,
        "2024-01-02": 146,
        "2024-01-03": 776,
      },
    });
  });

  it("with the `on` parameter returns segmented data", async () => {
    const { live, transport } = liveQueryFactory(() => ({
      status: 200,
      json: {
        data: {
          series: ["2024-01-01", "2024-01-02"],
          values: {
            US: { "2024-01-01": 100, "2024-01-02": 120 },
            CA: { "2024-01-01": 50, "2024-01-02": 60 },
          },
        },
        legend_size: 2,
      },
    }));
    const result = await live.segmentation(
      "Sign Up",
      "2024-01-01",
      "2024-01-02",
      { on: 'properties["country"]' },
    );

    // Verify the `on` parameter is passed
    expect(firstUrl(transport)).toContain("on=");
    expect(result.segment_property).toBe('properties["country"]');
    expect(Object.hasOwn(result.series, "US")).toBe(true);
    expect(Object.hasOwn(result.series, "CA")).toBe(true);
    expect(result.series["US"]!["2024-01-01"]).toBe(100);
  });

  it("with the `where` parameter passes the filter to the API", async () => {
    const { live, transport } = liveQueryFactory(() => ({
      status: 200,
      json: {
        data: {
          series: ["2024-01-01"],
          values: { "Sign Up": { "2024-01-01": 50 } },
        },
        legend_size: 1,
      },
    }));
    const result = await live.segmentation(
      "Sign Up",
      "2024-01-01",
      "2024-01-01",
      { where: 'properties["platform"] == "mobile"' },
    );

    expect(firstUrl(transport)).toContain("where=");
    expect(result.total).toBe(50);
  });

  it("calculates the total from all values", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: {
        data: {
          series: ["2024-01-01", "2024-01-02"],
          values: {
            US: { "2024-01-01": 100, "2024-01-02": 200 },
            CA: { "2024-01-01": 50, "2024-01-02": 150 },
          },
        },
        legend_size: 2,
      },
    }));
    const result = await live.segmentation(
      "Sign Up",
      "2024-01-01",
      "2024-01-02",
      { on: 'properties["country"]' },
    );

    // Total should be 100 + 200 + 50 + 150 = 500
    expect(result.total).toBe(500);
  });

  it("handles empty results", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: { data: { series: [], values: {} }, legend_size: 0 },
    }));
    const result = await live.segmentation(
      "Sign Up",
      "2024-01-01",
      "2024-01-01",
    );

    expect(result.total).toBe(0);
    expect(result.series).toEqual({});
  });

  it("propagates AuthenticationError from the API", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 401,
      json: { error: "Invalid credentials" },
    }));

    await expect(
      live.segmentation("Sign Up", "2024-01-01", "2024-01-01"),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});

// ===========================================================================
// User Story 2: Funnel Tests
// ===========================================================================

describe("TestFunnel", () => {
  it("returns FunnelResult with correct step data", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: {
        meta: { dates: ["2024-01-01"] },
        data: {
          "2024-01-01": {
            steps: [
              {
                count: 1000,
                step_conv_ratio: 1.0,
                overall_conv_ratio: 1.0,
                event: "App Open",
                goal: "App Open",
              },
              {
                count: 600,
                step_conv_ratio: 0.6,
                overall_conv_ratio: 0.6,
                event: "Sign Up",
                goal: "Sign Up",
              },
              {
                count: 300,
                step_conv_ratio: 0.5,
                overall_conv_ratio: 0.3,
                event: "Purchase",
                goal: "Purchase",
              },
            ],
            analysis: {
              completion: 300,
              starting_amount: 1000,
              steps: 3,
              worst: 1,
            },
          },
        },
      },
    }));
    const result = await live.funnel(12345, "2024-01-01", "2024-01-01");

    expect(result.funnel_id).toBe(12345);
    expect(result.from_date).toBe("2024-01-01");
    expect(result.to_date).toBe("2024-01-01");
    expect(result.steps.length).toBe(3);
    expect(result.steps[0]!.event).toBe("App Open");
    expect(result.steps[0]!.count).toBe(1000);
    expect(result.steps[1]!.event).toBe("Sign Up");
    expect(result.steps[1]!.count).toBe(600);
    expect(result.steps[2]!.event).toBe("Purchase");
    expect(result.steps[2]!.count).toBe(300);
  });

  it("aggregates counts across multiple dates", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: {
        meta: { dates: ["2024-01-01", "2024-01-02"] },
        data: {
          "2024-01-01": {
            steps: [
              { count: 500, event: "App Open" },
              { count: 300, event: "Sign Up" },
            ],
            analysis: {},
          },
          "2024-01-02": {
            steps: [
              { count: 500, event: "App Open" },
              { count: 300, event: "Sign Up" },
            ],
            analysis: {},
          },
        },
      },
    }));
    const result = await live.funnel(12345, "2024-01-01", "2024-01-02");

    // Should be aggregated: 500 + 500 = 1000, 300 + 300 = 600
    expect(result.steps[0]!.count).toBe(1000);
    expect(result.steps[1]!.count).toBe(600);
  });

  it("calculates step conversion rates from aggregated counts", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: {
        meta: { dates: ["2024-01-01"] },
        data: {
          "2024-01-01": {
            steps: [
              { count: 1000, event: "Step 1" },
              { count: 500, event: "Step 2" },
              { count: 250, event: "Step 3" },
            ],
            analysis: {},
          },
        },
      },
    }));
    const result = await live.funnel(12345, "2024-01-01", "2024-01-01");

    // Step 1 is always 1.0 (100% of itself)
    expect(result.steps[0]!.conversion_rate).toBe(1.0);
    // Step 2 is 500/1000 = 0.5
    expect(result.steps[1]!.conversion_rate).toBe(0.5);
    // Step 3 is 250/500 = 0.5
    expect(result.steps[2]!.conversion_rate).toBe(0.5);
  });

  it("calculates the overall conversion rate", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: {
        meta: { dates: ["2024-01-01"] },
        data: {
          "2024-01-01": {
            steps: [
              { count: 1000, event: "Step 1" },
              { count: 250, event: "Step 2" },
            ],
            analysis: {},
          },
        },
      },
    }));
    const result = await live.funnel(12345, "2024-01-01", "2024-01-01");

    // Overall conversion: 250/1000 = 0.25
    expect(result.conversion_rate).toBe(0.25);
  });

  it("handles empty results", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: { meta: { dates: [] }, data: {} },
    }));
    const result = await live.funnel(12345, "2024-01-01", "2024-01-01");

    expect(result.steps).toEqual([]);
    expect(result.conversion_rate).toBe(0.0);
  });

  it("propagates QueryError for an invalid funnel ID", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 400,
      json: { error: "Invalid funnel ID" },
    }));

    await expect(
      live.funnel(99999, "2024-01-01", "2024-01-01"),
    ).rejects.toBeInstanceOf(QueryError);
  });
});

// ===========================================================================
// Funnel Helper Tests
// ===========================================================================

describe("TestExtractStepsFromDateData", () => {
  it("non-segmented format with 'steps' returns the step list", () => {
    const dateData = {
      steps: [
        { count: 100, step_label: "Step 1" },
        { count: 80, step_label: "Step 2" },
      ],
    };
    expect(extractStepsFromDateData(dateData)).toEqual([
      { count: 100, step_label: "Step 1" },
      { count: 80, step_label: "Step 2" },
    ]);
  });

  it("segmented format with '$overall' returns the aggregate data", () => {
    const dateData = {
      $overall: [
        { count: 200, step_label: "Step 1" },
        { count: 150, step_label: "Step 2" },
      ],
      Chrome: [
        { count: 100, step_label: "Step 1" },
        { count: 70, step_label: "Step 2" },
      ],
      Firefox: [
        { count: 100, step_label: "Step 1" },
        { count: 80, step_label: "Step 2" },
      ],
    };
    // Should return $overall, not individual segments
    expect(extractStepsFromDateData(dateData)).toEqual([
      { count: 200, step_label: "Step 1" },
      { count: 150, step_label: "Step 2" },
    ]);
  });

  it("empty steps list returns an empty list", () => {
    expect(extractStepsFromDateData({ steps: [] })).toEqual([]);
  });

  it("empty $overall list returns an empty list", () => {
    expect(extractStepsFromDateData({ $overall: [] })).toEqual([]);
  });

  it("non-list type for steps returns an empty list", () => {
    expect(extractStepsFromDateData({ steps: "not a list" })).toEqual([]);
  });

  it("non-list type for $overall returns an empty list", () => {
    expect(extractStepsFromDateData({ $overall: { not: "a list" } })).toEqual(
      [],
    );
  });

  it("unrecognized format returns an empty list", () => {
    expect(extractStepsFromDateData({ some_other_key: [1, 2, 3] })).toEqual([]);
  });

  it("empty dict returns an empty list", () => {
    expect(extractStepsFromDateData({})).toEqual([]);
  });

  it("'steps' takes precedence over '$overall'", () => {
    const dateData = {
      steps: [{ count: 50, step_label: "From steps" }],
      $overall: [{ count: 100, step_label: "From overall" }],
    };
    // steps key is checked first, so it takes precedence
    expect(extractStepsFromDateData(dateData)).toEqual([
      { count: 50, step_label: "From steps" },
    ]);
  });
});

// ===========================================================================
// User Story 3: Retention Tests
// ===========================================================================

describe("TestRetention", () => {
  it("returns RetentionResult with cohort data", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: {
        "2024-01-01": { counts: [9, 7, 6], first: 10 },
        "2024-01-02": { counts: [8, 5, 4], first: 9 },
      },
    }));
    const result = await live.retention(
      "Sign Up",
      "Purchase",
      "2024-01-01",
      "2024-01-02",
    );

    expect(result.born_event).toBe("Sign Up");
    expect(result.return_event).toBe("Purchase");
    expect(result.from_date).toBe("2024-01-01");
    expect(result.to_date).toBe("2024-01-02");
    expect(result.unit).toBe("day");
    expect(result.cohorts.length).toBe(2);
  });

  it("calculates retention percentages from counts", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: { "2024-01-01": { counts: [100, 50, 25], first: 100 } },
    }));
    const result = await live.retention(
      "Sign Up",
      "Purchase",
      "2024-01-01",
      "2024-01-01",
    );

    const cohort = result.cohorts[0]!;
    expect(cohort.size).toBe(100);
    // retention[0] = 100/100 = 1.0
    expect(cohort.retention[0]).toBe(1.0);
    // retention[1] = 50/100 = 0.5
    expect(cohort.retention[1]).toBe(0.5);
    // retention[2] = 25/100 = 0.25
    expect(cohort.retention[2]).toBe(0.25);
  });

  it("passes filter parameters to the API", async () => {
    const { live, transport } = liveQueryFactory(() => ({
      status: 200,
      json: { "2024-01-01": { counts: [50, 25], first: 50 } },
    }));
    const result = await live.retention(
      "Sign Up",
      "Purchase",
      "2024-01-01",
      "2024-01-01",
      { born_where: 'properties["platform"] == "mobile"' },
    );

    const urlStr = firstUrl(transport);
    expect(urlStr.includes("born_where=") || urlStr.includes("where=")).toBe(
      true,
    );
    expect(result.cohorts.length).toBe(1);
  });

  it("passes interval parameters to the API", async () => {
    const { live, transport } = liveQueryFactory(() => ({
      status: 200,
      json: { "2024-01-01": { counts: [100, 80, 60, 40, 20], first: 100 } },
    }));
    const result = await live.retention(
      "Sign Up",
      "Any Event",
      "2024-01-01",
      "2024-01-01",
      { interval: 7, interval_count: 5 },
    );

    // interval is only included when != 1 (Mixpanel API constraint)
    const urlStr = firstUrl(transport);
    expect(urlStr).toContain("interval=7");
    expect(urlStr).toContain("interval_count=");
    // When interval != 1, unit should NOT be included
    expect(urlStr).not.toContain("unit=");
    expect(result.cohorts[0]!.retention.length).toBe(5);
  });

  it("handles empty results", async () => {
    const { live } = liveQueryFactory(() => ({ status: 200, json: {} }));
    const result = await live.retention(
      "Sign Up",
      "Purchase",
      "2024-01-01",
      "2024-01-01",
    );

    expect(result.cohorts).toEqual([]);
  });

  it("returns cohorts sorted by date", async () => {
    // Return dates in non-sorted order
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: {
        "2024-01-03": { counts: [30], first: 30 },
        "2024-01-01": { counts: [10], first: 10 },
        "2024-01-02": { counts: [20], first: 20 },
      },
    }));
    const result = await live.retention(
      "Sign Up",
      "Purchase",
      "2024-01-01",
      "2024-01-03",
    );

    expect(result.cohorts[0]!.date).toBe("2024-01-01");
    expect(result.cohorts[1]!.date).toBe("2024-01-02");
    expect(result.cohorts[2]!.date).toBe("2024-01-03");
  });
});

// ===========================================================================
// User Story 5: Event Counts Tests
// ===========================================================================

describe("TestEventCounts", () => {
  it("returns EventCountsResult with correct data", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: {
        data: {
          series: ["2024-01-01", "2024-01-02"],
          values: {
            "Sign Up": { "2024-01-01": 100, "2024-01-02": 150 },
            Purchase: { "2024-01-01": 50, "2024-01-02": 75 },
          },
        },
        legend_size: 2,
      },
    }));
    const result = await live.eventCounts(
      ["Sign Up", "Purchase"],
      "2024-01-01",
      "2024-01-02",
    );

    expect(result.events).toEqual(["Sign Up", "Purchase"]);
    expect(result.from_date).toBe("2024-01-01");
    expect(result.to_date).toBe("2024-01-02");
    expect(result.unit).toBe("day");
    expect(result.type).toBe("general");
    expect(result.series["Sign Up"]!["2024-01-01"]).toBe(100);
    expect(result.series["Purchase"]!["2024-01-02"]).toBe(75);
  });

  it("passes the type and unit parameters", async () => {
    const { live, transport } = liveQueryFactory(() => ({
      status: 200,
      json: {
        data: {
          series: ["2024-01-01"],
          values: { Test: { "2024-01-01": 100 } },
        },
        legend_size: 1,
      },
    }));
    const result = await live.eventCounts(
      ["Test"],
      "2024-01-01",
      "2024-01-31",
      {
        type: "unique",
        unit: "week",
      },
    );

    const urlStr = firstUrl(transport);
    expect(urlStr).toContain("type=unique");
    expect(urlStr).toContain("unit=week");
    expect(result.type).toBe("unique");
    expect(result.unit).toBe("week");
  });

  it("result has working frame rows (`.df` twin)", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: {
        data: {
          series: ["2024-01-01", "2024-01-02"],
          values: {
            "Event A": { "2024-01-01": 100, "2024-01-02": 150 },
            "Event B": { "2024-01-01": 50, "2024-01-02": 75 },
          },
        },
        legend_size: 2,
      },
    }));
    const result = await live.eventCounts(
      ["Event A", "Event B"],
      "2024-01-01",
      "2024-01-02",
    );

    const columns = result.rowColumns();
    expect(columns).toContain("date");
    expect(columns).toContain("event");
    expect(columns).toContain("count");
    expect(result.toRows().length).toBe(4); // 2 events x 2 dates
  });

  it("handles empty results", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: { data: { series: [], values: {} }, legend_size: 0 },
    }));
    const result = await live.eventCounts([], "2024-01-01", "2024-01-01");

    expect(result.series).toEqual({});
    expect(result.toRows().length).toBe(0);
  });

  it("propagates AuthenticationError from the API", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 401,
      json: { error: "Invalid credentials" },
    }));

    await expect(
      live.eventCounts(["Test"], "2024-01-01", "2024-01-01"),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});

// ===========================================================================
// User Story 6: Property Counts Tests
// ===========================================================================

describe("TestPropertyCounts", () => {
  it("returns PropertyCountsResult with correct data", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: {
        data: {
          series: ["2024-01-01", "2024-01-02"],
          values: {
            US: { "2024-01-01": 100, "2024-01-02": 150 },
            CA: { "2024-01-01": 50, "2024-01-02": 75 },
          },
        },
        legend_size: 2,
      },
    }));
    const result = await live.propertyCounts(
      "Purchase",
      "country",
      "2024-01-01",
      "2024-01-02",
    );

    expect(result.event).toBe("Purchase");
    expect(result.property_name).toBe("country");
    expect(result.from_date).toBe("2024-01-01");
    expect(result.to_date).toBe("2024-01-02");
    expect(result.unit).toBe("day");
    expect(result.type).toBe("general");
    expect(result.series["US"]!["2024-01-01"]).toBe(100);
    expect(result.series["CA"]!["2024-01-02"]).toBe(75);
  });

  it("passes the type and unit parameters", async () => {
    const { live, transport } = liveQueryFactory(() => ({
      status: 200,
      json: {
        data: { series: ["2024-01-01"], values: { US: { "2024-01-01": 100 } } },
        legend_size: 1,
      },
    }));
    const result = await live.propertyCounts(
      "Purchase",
      "country",
      "2024-01-01",
      "2024-01-31",
      { type: "unique", unit: "month" },
    );

    const urlStr = firstUrl(transport);
    expect(urlStr).toContain("type=unique");
    expect(urlStr).toContain("unit=month");
    expect(result.type).toBe("unique");
    expect(result.unit).toBe("month");
  });

  it("passes the values filter to the API", async () => {
    const { live, transport } = liveQueryFactory(() => ({
      status: 200,
      json: {
        data: { series: ["2024-01-01"], values: { US: { "2024-01-01": 100 } } },
        legend_size: 1,
      },
    }));
    await live.propertyCounts(
      "Purchase",
      "country",
      "2024-01-01",
      "2024-01-01",
      {
        values: ["US", "CA"],
      },
    );

    // Verify the values parameter is JSON-encoded onto the query string
    expect(firstUrl(transport)).toContain("values=");
  });

  it("passes the limit parameter to the API", async () => {
    const { live, transport } = liveQueryFactory(() => ({
      status: 200,
      json: {
        data: { series: ["2024-01-01"], values: { US: { "2024-01-01": 100 } } },
        legend_size: 1,
      },
    }));
    await live.propertyCounts(
      "Purchase",
      "country",
      "2024-01-01",
      "2024-01-01",
      {
        limit: 10,
      },
    );

    expect(firstUrl(transport)).toContain("limit=10");
  });

  it("result has working frame rows (`.df` twin)", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: {
        data: {
          series: ["2024-01-01", "2024-01-02"],
          values: {
            US: { "2024-01-01": 100, "2024-01-02": 150 },
            CA: { "2024-01-01": 50, "2024-01-02": 75 },
          },
        },
        legend_size: 2,
      },
    }));
    const result = await live.propertyCounts(
      "Purchase",
      "country",
      "2024-01-01",
      "2024-01-02",
    );

    const columns = result.rowColumns();
    expect(columns).toContain("date");
    expect(columns).toContain("value");
    expect(columns).toContain("count");
    expect(result.toRows().length).toBe(4); // 2 values x 2 dates
  });

  it("handles empty results", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 200,
      json: { data: { series: [], values: {} }, legend_size: 0 },
    }));
    const result = await live.propertyCounts(
      "Purchase",
      "country",
      "2024-01-01",
      "2024-01-01",
    );

    expect(result.series).toEqual({});
    expect(result.toRows().length).toBe(0);
  });

  it("propagates QueryError for invalid params", async () => {
    const { live } = liveQueryFactory(() => ({
      status: 400,
      json: { error: "Invalid property" },
    }));

    await expect(
      live.propertyCounts(
        "Purchase",
        "invalid_property",
        "2024-01-01",
        "2024-01-01",
      ),
    ).rejects.toBeInstanceOf(QueryError);
  });
});
