// Translated Phase-008 LiveQueryService tests (B5-S2, packet §3):
// assertion-for-assertion port of tests/unit/test_live_query_phase008.py
// (R10.2) — ALL 8 classes (TestActivityFeedService :68,
// TestNumericSumService :279, TestNumericAverageService :355,
// TestFrequencyService :427, TestNumericBucketService :516,
// TestQuerySavedReportService :597, TestPhase008ServiceErrorHandling
// :703, TestPhase008EdgeCases :964).
//
// Translation notes:
// - The Python fixture pins a workspace with `client.set_workspace_id(
//   12345)` so `activity_feed`'s stream/bookmark call resolves without
//   an unmocked fetch; the TS twin pins it on the SESSION
//   (`makeSession({workspaceId: 12345})`), which is the same
//   pin-then-skip-discovery path the B4 client reads.
// - `UserEvent.time` is a `datetime` in Python and preserved ISO text in
//   TS (phase2-design watchlist #5), so
//   `test_activity_feed_converts_timestamps`'s
//   `.year/.month/.day == 2024/1/1` becomes the exact ISO rendering
//   `"2024-01-01T00:00:00+00:00"` — a STRICTLY stronger assertion over
//   the same conversion, and the `isinstance(..., datetime)` check has
//   no TS analog (recorded in `B5-S2-notes.md` §2).
// - `.df` asserts translate to `toRows()` / `rowColumns()` (C6).
// - `pytest.raises(ValueError, match=...)` is the shared
//   `query/python-builtins.ts` `ValueError` twin.

import { describe, expect, it } from "vitest";

import { AuthenticationError, QueryError } from "../../src/errors.js";
import { ValueError } from "../../src/query/python-builtins.js";
import { LiveQueryService } from "../../src/services/live-query.js";
import {
  ActivityFeedResult,
  FrequencyResult,
  NumericAverageResult,
  NumericBucketResult,
  NumericSumResult,
  SavedReportResult,
  UserEvent,
} from "../../src/types/results/live-query.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** A canned-response handler (the httpx.MockTransport handler twin). */
type Handler = (request: CapturedFetchRequest) => CannedResponse;

/**
 * The `live_query_factory` fixture (test_live_query_phase008.py:34-60).
 *
 * @param handler - The canned-response handler.
 * @returns The service under test.
 */
function liveQueryFactory(handler: Handler): LiveQueryService {
  const { client } = createMockClient(
    makeSession({ workspaceId: 12345 }),
    handler,
  );
  return new LiveQueryService(client);
}

// ===========================================================================
// US1: Activity Feed Tests
// ===========================================================================

describe("TestActivityFeedService", () => {
  it("returns ActivityFeedResult", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          events: [
            {
              event: "Sign Up",
              properties: {
                time: 1704067200,
                $distinct_id: "user_123",
                plan: "premium",
              },
            },
            {
              event: "Purchase",
              properties: {
                time: 1704153600,
                $distinct_id: "user_123",
                amount: 99.99,
              },
            },
          ],
        },
      },
    }));
    const result = await live.activityFeed(["user_123"]);

    expect(result).toBeInstanceOf(ActivityFeedResult);
    expect(result.distinct_ids).toStrictEqual(["user_123"]);
    expect(result.events).toHaveLength(2);
  });

  it("converts Unix timestamps to datetimes", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          // 1704067200 == 2024-01-01 00:00:00 UTC
          events: [{ event: "Sign Up", properties: { time: 1704067200 } }],
        },
      },
    }));
    const result = await live.activityFeed(["user_123"]);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toBeInstanceOf(UserEvent);
    // Python asserts year/month/day == 2024/1/1 on the datetime; the TS
    // field is the preserved isoformat text of that same instant.
    expect(result.events[0]!.time).toBe("2024-01-01T00:00:00+00:00");
  });

  it("preserves event properties", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          events: [
            {
              event: "Purchase",
              properties: {
                time: 1704067200,
                amount: 99.99,
                product: "Widget",
              },
            },
          ],
        },
      },
    }));
    const result = await live.activityFeed(["user_123"]);

    expect(result.events[0]!.properties["amount"]).toBe(99.99);
    expect(result.events[0]!.properties["product"]).toBe("Widget");
  });

  it("result supports frame conversion (`.df` twin)", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          events: [
            { event: "Sign Up", properties: { time: 1704067200 } },
            { event: "Purchase", properties: { time: 1704153600 } },
          ],
        },
      },
    }));
    const result = await live.activityFeed(["user_123"]);

    expect(result.toRows()).toHaveLength(2);
    expect(result.rowColumns()).toContain("event");
    expect(result.rowColumns()).toContain("time");
  });

  it("surfaces results.sentinel_event for pagination", async () => {
    const sentinel = {
      event: "Purchase",
      properties: { time: 1704153600, $insert_id: "abc" },
    };
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          events: [{ event: "Purchase", properties: { time: 1704153600 } }],
          sentinel_event: sentinel,
        },
      },
    }));
    const result = await live.activityFeed(["user_123"]);

    expect(result.sentinel_event).toStrictEqual(sentinel);
  });

  it("sentinel_event is null when the response omits a cursor", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          events: [{ event: "Sign Up", properties: { time: 1704067200 } }],
        },
      },
    }));
    const result = await live.activityFeed(["user_123"]);

    expect(result.sentinel_event).toBeNull();
  });
});

// ===========================================================================
// US2: Numeric Sum Tests
// ===========================================================================

describe("TestNumericSumService", () => {
  it("returns NumericSumResult", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        status: "ok",
        computed_at: "2024-01-31T23:02:11.666218+00:00",
        results: { "2024-01-01": 15432.5, "2024-01-02": 18976.25 },
      },
    }));
    const result = await live.segmentationSum(
      "Purchase",
      "2024-01-01",
      "2024-01-02",
      'properties["amount"]',
    );

    expect(result).toBeInstanceOf(NumericSumResult);
    expect(result.event).toBe("Purchase");
    expect(result.results["2024-01-01"]).toBe(15432.5);
    expect(result.computed_at).toBe("2024-01-31T23:02:11.666218+00:00");
  });

  it("frame has the expected columns", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        status: "ok",
        results: { "2024-01-01": 15432.5, "2024-01-02": 18976.25 },
      },
    }));
    const result = await live.segmentationSum(
      "Purchase",
      "2024-01-01",
      "2024-01-02",
      'properties["amount"]',
    );

    expect(result.toRows()).toHaveLength(2);
    expect(result.rowColumns()).toContain("date");
    expect(result.rowColumns()).toContain("sum");
  });
});

// ===========================================================================
// US3: Numeric Average Tests
// ===========================================================================

describe("TestNumericAverageService", () => {
  it("returns NumericAverageResult", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        status: "ok",
        results: { "2024-01-01": 54.32, "2024-01-02": 62.15 },
      },
    }));
    const result = await live.segmentationAverage(
      "Purchase",
      "2024-01-01",
      "2024-01-02",
      'properties["amount"]',
    );

    expect(result).toBeInstanceOf(NumericAverageResult);
    expect(result.event).toBe("Purchase");
    expect(result.results["2024-01-01"]).toBe(54.32);
  });

  it("frame has the expected columns", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: { status: "ok", results: { "2024-01-01": 54.32 } },
    }));
    const result = await live.segmentationAverage(
      "Purchase",
      "2024-01-01",
      "2024-01-01",
      'properties["amount"]',
    );

    expect(result.rowColumns()).toContain("date");
    expect(result.rowColumns()).toContain("average");
  });
});

// ===========================================================================
// US4: Frequency Tests
// ===========================================================================

describe("TestFrequencyService", () => {
  it("returns FrequencyResult", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        data: {
          "2024-01-01": [305, 107, 60, 41, 32],
          "2024-01-02": [495, 204, 117, 77, 53],
        },
      },
    }));
    const result = await live.frequency("2024-01-01", "2024-01-02");

    expect(result).toBeInstanceOf(FrequencyResult);
    expect(result.from_date).toBe("2024-01-01");
    expect(result.to_date).toBe("2024-01-02");
    expect(Object.hasOwn(result.data, "2024-01-01")).toBe(true);
    expect(result.data["2024-01-01"]![0]).toBe(305);
  });

  it("preserves the event filter", async () => {
    const live = liveQueryFactory(() => ({ status: 200, json: { data: {} } }));
    const result = await live.frequency("2024-01-01", "2024-01-02", {
      event: "App Open",
    });

    expect(result.event).toBe("App Open");
  });

  it("result supports frame conversion (`.df` twin)", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        data: {
          "2024-01-01": [305, 107, 60],
          "2024-01-02": [495, 204, 117],
        },
      },
    }));
    const result = await live.frequency("2024-01-01", "2024-01-02");

    expect(result.toRows()).toHaveLength(2);
    expect(result.rowColumns()).toContain("date");
  });
});

// ===========================================================================
// US5: Numeric Bucketing Tests
// ===========================================================================

describe("TestNumericBucketService", () => {
  it("returns NumericBucketResult", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        data: {
          series: ["2024-01-01", "2024-01-02"],
          values: {
            "0 - 100": { "2024-01-01": 50, "2024-01-02": 65 },
            "100 - 200": { "2024-01-01": 35, "2024-01-02": 42 },
          },
        },
        legend_size: 2,
      },
    }));
    const result = await live.segmentationNumeric(
      "Purchase",
      "2024-01-01",
      "2024-01-02",
      'properties["amount"]',
    );

    expect(result).toBeInstanceOf(NumericBucketResult);
    expect(result.event).toBe("Purchase");
    expect(Object.hasOwn(result.series, "0 - 100")).toBe(true);
    expect(result.series["0 - 100"]!["2024-01-01"]).toBe(50);
  });

  it("result supports frame conversion (`.df` twin)", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        data: {
          series: ["2024-01-01"],
          values: {
            "0 - 100": { "2024-01-01": 50 },
            "100 - 200": { "2024-01-01": 35 },
          },
        },
        legend_size: 2,
      },
    }));
    const result = await live.segmentationNumeric(
      "Purchase",
      "2024-01-01",
      "2024-01-01",
      'properties["amount"]',
    );

    expect(result.rowColumns()).toContain("date");
    expect(result.rowColumns()).toContain("bucket");
    expect(result.rowColumns()).toContain("count");
  });
});

// ===========================================================================
// US6: Insights Tests
// ===========================================================================

describe("TestQuerySavedReportService", () => {
  it("returns SavedReportResult", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        computed_at: "2024-01-15T10:30:00.252314+00:00",
        date_range: {
          from_date: "2024-01-01T00:00:00-08:00",
          to_date: "2024-01-07T00:00:00-08:00",
        },
        headers: ["$event"],
        series: {
          "Sign Up": { "2024-01-01T00:00:00-08:00": 150 },
          Purchase: { "2024-01-01T00:00:00-08:00": 50 },
        },
      },
    }));
    const result = await live.querySavedReport(12345678);

    expect(result).toBeInstanceOf(SavedReportResult);
    expect(result.bookmark_id).toBe(12345678);
    expect(result.computed_at).toBe("2024-01-15T10:30:00.252314+00:00");
    expect(Object.hasOwn(result.series, "Sign Up")).toBe(true);
    expect(Object.hasOwn(result.series, "Purchase")).toBe(true);
  });

  it("preserves the date range and headers", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        computed_at: "2024-01-15T10:30:00+00:00",
        date_range: {
          from_date: "2024-01-01T00:00:00-08:00",
          to_date: "2024-01-07T00:00:00-08:00",
        },
        headers: ["$event", "country"],
        series: {},
      },
    }));
    const result = await live.querySavedReport(12345678);

    expect(result.from_date).toBe("2024-01-01T00:00:00-08:00");
    expect(result.to_date).toBe("2024-01-07T00:00:00-08:00");
    expect(result.headers).toStrictEqual(["$event", "country"]);
  });

  it("result supports frame conversion (`.df` twin)", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        computed_at: "2024-01-15T10:30:00+00:00",
        date_range: { from_date: "2024-01-01", to_date: "2024-01-07" },
        headers: ["$event"],
        series: {
          "Sign Up": { "2024-01-01": 150, "2024-01-02": 175 },
          Purchase: { "2024-01-01": 50, "2024-01-02": 65 },
        },
      },
    }));
    const result = await live.querySavedReport(12345678);

    expect(result.rowColumns()).toContain("event");
    expect(result.rowColumns()).toContain("date");
    expect(result.rowColumns()).toContain("count");
    expect(result.toRows()).toHaveLength(4); // 2 events x 2 dates
  });
});

// ===========================================================================
// Error Handling Tests
// ===========================================================================

describe("TestPhase008ServiceErrorHandling", () => {
  // --- Activity Feed ---

  it("activity_feed propagates AuthenticationError", async () => {
    const live = liveQueryFactory(() => ({
      status: 401,
      json: { error: "Invalid credentials" },
    }));
    await expect(live.activityFeed(["user_123"])).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("activity_feed propagates QueryError", async () => {
    const live = liveQueryFactory(() => ({
      status: 400,
      json: { error: "Invalid query" },
    }));
    await expect(live.activityFeed(["user_123"])).rejects.toBeInstanceOf(
      QueryError,
    );
  });

  // --- Segmentation Sum ---

  it("segmentation_sum propagates AuthenticationError", async () => {
    const live = liveQueryFactory(() => ({
      status: 401,
      json: { error: "Invalid credentials" },
    }));
    await expect(
      live.segmentationSum(
        "Purchase",
        "2024-01-01",
        "2024-01-31",
        'properties["amount"]',
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("segmentation_sum propagates QueryError", async () => {
    const live = liveQueryFactory(() => ({
      status: 400,
      json: { error: "Invalid property" },
    }));
    await expect(
      live.segmentationSum(
        "Purchase",
        "2024-01-01",
        "2024-01-31",
        'properties["amount"]',
      ),
    ).rejects.toBeInstanceOf(QueryError);
  });

  // --- Segmentation Average ---

  it("segmentation_average propagates AuthenticationError", async () => {
    const live = liveQueryFactory(() => ({
      status: 401,
      json: { error: "Invalid credentials" },
    }));
    await expect(
      live.segmentationAverage(
        "Purchase",
        "2024-01-01",
        "2024-01-31",
        'properties["amount"]',
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("segmentation_average propagates QueryError", async () => {
    const live = liveQueryFactory(() => ({
      status: 400,
      json: { error: "Invalid event" },
    }));
    await expect(
      live.segmentationAverage(
        "Purchase",
        "2024-01-01",
        "2024-01-31",
        'properties["amount"]',
      ),
    ).rejects.toBeInstanceOf(QueryError);
  });

  // --- Frequency ---

  it("frequency propagates AuthenticationError", async () => {
    const live = liveQueryFactory(() => ({
      status: 401,
      json: { error: "Invalid credentials" },
    }));
    await expect(
      live.frequency("2024-01-01", "2024-01-31"),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("frequency propagates QueryError", async () => {
    const live = liveQueryFactory(() => ({
      status: 400,
      json: { error: "Invalid date range" },
    }));
    await expect(
      live.frequency("2024-01-01", "2024-01-31"),
    ).rejects.toBeInstanceOf(QueryError);
  });

  // --- Segmentation Numeric ---

  it("segmentation_numeric propagates AuthenticationError", async () => {
    const live = liveQueryFactory(() => ({
      status: 401,
      json: { error: "Invalid credentials" },
    }));
    await expect(
      live.segmentationNumeric(
        "Purchase",
        "2024-01-01",
        "2024-01-31",
        'properties["amount"]',
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("segmentation_numeric propagates QueryError", async () => {
    const live = liveQueryFactory(() => ({
      status: 400,
      json: { error: "Property not found" },
    }));
    await expect(
      live.segmentationNumeric(
        "Purchase",
        "2024-01-01",
        "2024-01-31",
        'properties["amount"]',
      ),
    ).rejects.toBeInstanceOf(QueryError);
  });

  // --- query_saved_report ---

  it("query_saved_report propagates AuthenticationError", async () => {
    const live = liveQueryFactory(() => ({
      status: 401,
      json: { error: "Invalid credentials" },
    }));
    await expect(live.querySavedReport(12345678)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("query_saved_report propagates QueryError", async () => {
    const live = liveQueryFactory(() => ({
      status: 400,
      json: { error: "Invalid bookmark_id" },
    }));
    await expect(live.querySavedReport(99999999)).rejects.toBeInstanceOf(
      QueryError,
    );
  });
});

// ===========================================================================
// Edge Case Tests
// ===========================================================================

describe("TestPhase008EdgeCases", () => {
  it("events with a missing timestamp raise ValueError", async () => {
    const live = liveQueryFactory(() => ({
      status: 200,
      json: {
        status: "ok",
        results: {
          events: [
            {
              event: "Test Event",
              // Note: the 'time' field is intentionally missing
              properties: { $distinct_id: "user_123" },
            },
          ],
        },
      },
    }));

    await expect(live.activityFeed(["user_123"])).rejects.toThrow(ValueError);
    await expect(live.activityFeed(["user_123"])).rejects.toThrow(
      /missing required 'time' field/,
    );
  });
});
