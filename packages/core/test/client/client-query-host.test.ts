// Layer-3 translation — Phase-3 packet B4-C2 query-host locks. Sources:
//
// - tests/unit/test_api_client.py::TestSegmentation (:705),
//   ::TestDiscovery (:765), ::TestFunnelAndRetention (:1119),
//   ::TestActivityFeed (:3130) — ALL.
// - tests/unit/test_api_client_phase008.py — ALL classes
//   (TestActivityFeed :49, TestSegmentationSum :128,
//   TestSegmentationAverage :182, TestFrequency :236,
//   TestSegmentationNumeric :290, TestQuerySavedReport :347,
//   TestPhase008ErrorHandling :398).
//
// Date-defaulting tests inject a FIXED `now` (the D12 clock seam) so
// `date.today()`-derived params are deterministic; assertion content
// (param values, retry from_date arithmetic) is preserved (R10.2).
import { describe, expect, it } from "vitest";

import { toNativeJson } from "../../src/client/json-value.js";
import {
  AuthenticationError,
  QueryError,
  RateLimitError,
} from "../../src/errors.js";
import {
  type CannedResponse,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** A frozen instant for the date-defaulting tests (UTC noon). */
const FROZEN_NOW = new Date("2026-08-15T12:00:00Z");

/** Parse the captured JSON request body. */
function parseBody(bodyText: string): Record<string, unknown> {
  return bodyText === ""
    ? {}
    : (JSON.parse(bodyText) as Record<string, unknown>);
}

describe("TestSegmentation", () => {
  it("test_segmentation_basic", async () => {
    let capturedParams: Record<string, string> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedParams = { ...request.params };
      return { status: 200, json: { data: { values: {} } } };
    });
    await client.segmentation("Purchase", "2024-01-01", "2024-01-31");
    expect(capturedParams["event"]).toBe("Purchase");
    expect(capturedParams["from_date"]).toBe("2024-01-01");
    expect(capturedParams["to_date"]).toBe("2024-01-31");
  });

  it("test_segmentation_with_on", async () => {
    let capturedParams: Record<string, string> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedParams = { ...request.params };
      return { status: 200, json: { data: {} } };
    });
    await client.segmentation("Purchase", "2024-01-01", "2024-01-31", {
      on: 'properties["country"]',
    });
    expect(capturedParams["on"]).toBe('properties["country"]');
  });

  it("test_segmentation_with_where", async () => {
    let capturedParams: Record<string, string> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedParams = { ...request.params };
      return { status: 200, json: { data: {} } };
    });
    await client.segmentation("Purchase", "2024-01-01", "2024-01-31", {
      where: 'properties["amount"] > 100',
    });
    expect(Object.hasOwn(capturedParams, "where")).toBe(true);
  });
});

describe("TestDiscovery", () => {
  it("test_get_events", async () => {
    let capturedParams: Record<string, string> = {};
    const { client } = createMockClient(
      makeSession(),
      (request) => {
        capturedParams = { ...request.params };
        return { status: 200, json: ["event1", "event2", "event3"] };
      },
      { now: () => FROZEN_NOW },
    );
    const events = await client.getEvents();
    expect(events).toStrictEqual(["event1", "event2", "event3"]);
    expect(capturedParams["type"]).toBe("general");
    expect(capturedParams["limit"]).toBe("5000");
    expect(capturedParams["from_date"]).toBe("2000-01-01");
    expect(Object.hasOwn(capturedParams, "to_date")).toBe(true);
    expect(capturedParams["to_date"] as string).toHaveLength(10);
  });

  it("test_get_events_caller_overrides", async () => {
    let capturedParams: Record<string, string> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedParams = { ...request.params };
      return { status: 200, json: ["a", "b"] };
    });
    const events = await client.getEvents({
      limit: 42,
      from_date: "2024-01-01",
      to_date: "2024-12-31",
    });
    expect(events).toStrictEqual(["a", "b"]);
    expect(capturedParams["limit"]).toBe("42");
    expect(capturedParams["from_date"]).toBe("2024-01-01");
    expect(capturedParams["to_date"]).toBe("2024-12-31");
  });

  it("test_get_events_falls_back_on_date_range_403", async () => {
    const capturedFromDates: string[] = [];
    let callCount = 0;
    const { client } = createMockClient(
      makeSession(),
      (request) => {
        callCount += 1;
        capturedFromDates.push(request.params["from_date"] as string);
        if (callCount === 1) {
          return {
            status: 403,
            json: { error: "Date range exceeds 90 days into the past" },
          };
        }
        return { status: 200, json: ["e1"] };
      },
      { now: () => FROZEN_NOW },
    );
    const events = await client.getEvents();
    expect(events).toStrictEqual(["e1"]);
    expect(callCount).toBe(2);
    expect(capturedFromDates[0]).toBe("2000-01-01");
    // 2026-08-15 (frozen UTC today) - 90 days = 2026-05-17.
    expect(capturedFromDates[1]).toBe("2026-05-17");
  });

  it("test_get_events_does_not_retry_when_caller_set_from_date", async () => {
    let callCount = 0;
    const { client } = createMockClient(makeSession(), () => {
      callCount += 1;
      return {
        status: 403,
        json: { error: "Date range exceeds 30 days into the past" },
      };
    });
    await expect(
      client.getEvents({ from_date: "1999-01-01" }),
    ).rejects.toBeInstanceOf(QueryError);
    expect(callCount).toBe(1);
  });

  it("test_get_events_does_not_retry_on_unrelated_403", async () => {
    let callCount = 0;
    const { client } = createMockClient(makeSession(), () => {
      callCount += 1;
      return { status: 403, json: { error: "Permission denied" } };
    });
    await expect(client.getEvents()).rejects.toBeInstanceOf(QueryError);
    expect(callCount).toBe(1);
  });

  it("test_get_events_does_not_retry_on_non_403_with_matching_text", async () => {
    let callCount = 0;
    const { client } = createMockClient(makeSession(), () => {
      callCount += 1;
      return {
        status: 400,
        json: { error: "Query exceeds 90 days lookback in custom filter" },
      };
    });
    await expect(client.getEvents()).rejects.toBeInstanceOf(QueryError);
    expect(callCount).toBe(1);
  });

  it("test_get_events_empty_string_from_date_is_not_replaced", async () => {
    let capturedParams: Record<string, string> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedParams = { ...request.params };
      return { status: 200, json: [] };
    });
    await client.getEvents({ from_date: "", to_date: "" });
    expect(capturedParams["from_date"]).toBe("");
    expect(capturedParams["to_date"]).toBe("");
  });

  it("test_get_event_properties", async () => {
    let capturedParams: Record<string, string> = {};
    let capturedPath = "";
    const { client } = createMockClient(makeSession(), (request) => {
      capturedPath = new URL(request.url).pathname;
      capturedParams = { ...request.params };
      return { status: 200, json: { prop1: 100.0, prop2: 50.5 } };
    });
    const props = await client.getEventProperties("Purchase");
    expect(capturedPath.endsWith("/events/properties/top")).toBe(true);
    expect(capturedParams["event"]).toBe("Purchase");
    expect(new Set(props)).toStrictEqual(new Set(["prop1", "prop2"]));
  });

  it("test_get_property_values", async () => {
    let capturedParams: Record<string, string> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedParams = { ...request.params };
      return { status: 200, json: ["value1", "value2"] };
    });
    const values = await client.getPropertyValues("country", { limit: 10 });
    expect(capturedParams["name"]).toBe("country");
    expect(capturedParams["limit"]).toBe("10");
    expect(values).toStrictEqual(["value1", "value2"]);
  });
});

describe("TestFunnelAndRetention", () => {
  it("test_funnel", async () => {
    let capturedParams: Record<string, string> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedParams = { ...request.params };
      return { status: 200, json: { data: [] } };
    });
    await client.funnel(12345, "2024-01-01", "2024-01-31");
    expect(capturedParams["funnel_id"]).toBe("12345");
  });

  it("test_retention", async () => {
    let capturedParams: Record<string, string> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedParams = { ...request.params };
      return { status: 200, json: { data: {} } };
    });
    await client.retention("Signup", "Purchase", "2024-01-01", "2024-01-31");
    expect(capturedParams["born_event"]).toBe("Signup");
    expect(capturedParams["event"]).toBe("Purchase");
  });

  it("test_retention_default_interval_sends_unit_only", async () => {
    let capturedParams: Record<string, string> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedParams = { ...request.params };
      return { status: 200, json: {} };
    });
    await client.retention("Signup", "Purchase", "2024-01-01", "2024-01-31", {
      unit: "day",
      interval: 1,
    });
    expect(capturedParams["unit"]).toBe("day");
    expect(Object.hasOwn(capturedParams, "interval")).toBe(false);
  });

  it("test_retention_custom_interval_sends_interval_only", async () => {
    let capturedParams: Record<string, string> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedParams = { ...request.params };
      return { status: 200, json: {} };
    });
    await client.retention("Signup", "Purchase", "2024-01-01", "2024-01-31", {
      unit: "day",
      interval: 7,
    });
    expect(capturedParams["interval"]).toBe("7");
    expect(Object.hasOwn(capturedParams, "unit")).toBe(false);
  });

  it("test_retention_unit_and_interval_mutually_exclusive", async () => {
    for (const interval of [1, 2, 7, 14, 30]) {
      let capturedParams: Record<string, string> = {};
      const { client } = createMockClient(makeSession(), (request) => {
        capturedParams = { ...request.params };
        return { status: 200, json: {} };
      });
      await client.retention("Signup", "Purchase", "2024-01-01", "2024-01-31", {
        unit: "day",
        interval,
      });
      const hasUnit = Object.hasOwn(capturedParams, "unit");
      const hasInterval = Object.hasOwn(capturedParams, "interval");
      expect(hasUnit && hasInterval).toBe(false);
      expect(hasUnit || hasInterval).toBe(true);
    }
  });
});

describe("TestActivityFeed (request contract)", () => {
  /** Handler recording method/path/body; returns an OK raw response. */
  function capturingClient(): {
    client: ReturnType<typeof createMockClient>["client"];
    captured: {
      method?: string;
      path?: string;
      body?: Record<string, unknown>;
    };
  } {
    const captured: {
      method?: string;
      path?: string;
      body?: Record<string, unknown>;
    } = {};
    const { client } = createMockClient(makeSession(), (request) => {
      captured.method = request.method;
      captured.path = new URL(request.url).pathname;
      if (request.bodyText !== "") {
        captured.body = parseBody(request.bodyText);
      }
      return {
        status: 200,
        json: { status: "ok", results: { events: [], sentinel_event: null } },
      };
    });
    return { client, captured };
  }

  it("test_posts_to_stream_bookmark_endpoint", async () => {
    const { client, captured } = capturingClient();
    client.setWorkspaceId(99999);
    await client.activityFeed(["user_1"], {
      from_date: "2026-05-01",
      to_date: "2026-06-01",
    });
    expect(captured.method).toBe("POST");
    expect(captured.path?.endsWith("/stream/bookmark")).toBe(true);
  });

  it("test_body_uses_empty_entries_and_raw_mode", async () => {
    const { client, captured } = capturingClient();
    client.setWorkspaceId(99999);
    await client.activityFeed(["user_1"], {
      from_date: "2026-05-01",
      to_date: "2026-06-01",
    });
    const body = captured.body as Record<string, unknown>;
    expect(
      (body["bookmark"] as Record<string, unknown>)["entries"],
    ).toStrictEqual([]);
    expect(body["mode"]).toBe("raw");
    expect(body["distinct_ids"]).toStrictEqual(["user_1"]);
    expect(body["project_id"]).toBe("12345");
    expect(body["workspace_id"]).toBe(99999);
  });

  it("test_between_date_range_when_both_dates", async () => {
    const { client, captured } = capturingClient();
    client.setWorkspaceId(99999);
    await client.activityFeed(["user_1"], {
      from_date: "2026-05-01",
      to_date: "2026-06-01",
    });
    expect(
      (captured.body?.["bookmark"] as Record<string, unknown>)["dateRange"],
    ).toStrictEqual({ type: "between", from: "2026-05-01", to: "2026-06-01" });
  });

  it("test_since_date_range_when_only_from_date", async () => {
    const { client, captured } = capturingClient();
    client.setWorkspaceId(99999);
    await client.activityFeed(["user_1"], { from_date: "2026-05-01" });
    expect(
      (captured.body?.["bookmark"] as Record<string, unknown>)["dateRange"],
    ).toStrictEqual({ type: "since", from: "2026-05-01" });
  });

  it("test_defaults_to_last_30_days_when_no_dates", async () => {
    const { client, captured } = capturingClient();
    client.setWorkspaceId(99999);
    await client.activityFeed(["user_1"]);
    expect(
      (captured.body?.["bookmark"] as Record<string, unknown>)["dateRange"],
    ).toStrictEqual({
      type: "relative_after",
      window: { unit: "day", value: 30 },
    });
  });

  it("test_only_to_date_builds_30_day_between_window", async () => {
    const { client, captured } = capturingClient();
    client.setWorkspaceId(99999);
    await client.activityFeed(["user_1"], { to_date: "2026-06-01" });
    const dateRange = (captured.body?.["bookmark"] as Record<string, unknown>)[
      "dateRange"
    ] as Record<string, unknown>;
    expect(dateRange["type"]).toBe("between");
    expect(dateRange["to"]).toBe("2026-06-01");
    expect(dateRange["from"]).toBe("2026-05-02");
  });

  it("test_optional_params_absent_by_default", async () => {
    const { client, captured } = capturingClient();
    client.setWorkspaceId(99999);
    await client.activityFeed(["user_1"], {
      from_date: "2026-05-01",
      to_date: "2026-06-01",
    });
    const body = captured.body as Record<string, unknown>;
    expect(body["mode"]).toBe("raw");
    for (const key of [
      "limit",
      "include_events",
      "exclude_events",
      "sentinel_event",
      "paging_window",
      "search",
      "search_properties",
      "use_custom_events",
    ]) {
      expect(Object.hasOwn(body, key)).toBe(false);
    }
  });

  it("test_passes_through_optional_params", async () => {
    const { client, captured } = capturingClient();
    const sentinel = {
      event: "X",
      properties: { time: 1, $insert_id: "i" },
    };
    client.setWorkspaceId(99999);
    await client.activityFeed(["user_1"], {
      from_date: "2026-05-01",
      to_date: "2026-06-01",
      limit: 500,
      include_events: ["Sign Up", "Purchase"],
      sentinel_event: sentinel,
      paging_window: 7,
    });
    const body = captured.body as Record<string, unknown>;
    expect(body["limit"]).toBe(500);
    expect(body["include_events"]).toStrictEqual(["Sign Up", "Purchase"]);
    expect(body["sentinel_event"]).toStrictEqual(sentinel);
    expect(body["paging_window"]).toBe(7);
  });

  it("test_exclude_events_passes_through", async () => {
    const { client, captured } = capturingClient();
    client.setWorkspaceId(99999);
    await client.activityFeed(["user_1"], {
      from_date: "2026-05-01",
      to_date: "2026-06-01",
      exclude_events: ["Heartbeat"],
    });
    expect(captured.body?.["exclude_events"]).toStrictEqual(["Heartbeat"]);
  });

  it("test_include_and_exclude_events_together_raises", async () => {
    const { client } = capturingClient();
    client.setWorkspaceId(99999);
    await expect(
      client.activityFeed(["user_1"], {
        from_date: "2026-05-01",
        to_date: "2026-06-01",
        include_events: ["A"],
        exclude_events: ["B"],
      }),
    ).rejects.toBeInstanceOf(QueryError);
  });

  it("test_search_params_pass_through", async () => {
    const { client, captured } = capturingClient();
    const searchProps = [{ value: "$city", resourceType: "event" }];
    client.setWorkspaceId(99999);
    await client.activityFeed(["user_1"], {
      from_date: "2026-05-01",
      to_date: "2026-06-01",
      search: "san francisco",
      search_properties: searchProps,
    });
    const body = captured.body as Record<string, unknown>;
    expect(body["search"]).toBe("san francisco");
    expect(body["search_properties"]).toStrictEqual(searchProps);
  });

  it("test_use_custom_events_in_body", async () => {
    const { client, captured } = capturingClient();
    client.setWorkspaceId(99999);
    await client.activityFeed(["user_1"], {
      from_date: "2026-05-01",
      to_date: "2026-06-01",
      use_custom_events: true,
    });
    expect(captured.body?.["use_custom_events"]).toBe(true);
  });

  it("test_invalid_to_date_only_raises_query_error", async () => {
    const { client } = capturingClient();
    client.setWorkspaceId(99999);
    await expect(
      client.activityFeed(["user_1"], { to_date: "06/01/2026" }),
    ).rejects.toBeInstanceOf(QueryError);
  });

  it("test_extremely_early_to_date_raises_query_error", async () => {
    const { client } = capturingClient();
    client.setWorkspaceId(99999);
    await expect(
      client.activityFeed(["user_1"], { to_date: "0001-01-10" }),
    ).rejects.toBeInstanceOf(QueryError);
  });

  it("test_invalid_from_date_raises_query_error", async () => {
    const { client } = capturingClient();
    client.setWorkspaceId(99999);
    await expect(
      client.activityFeed(["user_1"], {
        from_date: "06/01/2026",
        to_date: "2026-06-30",
      }),
    ).rejects.toBeInstanceOf(QueryError);
  });

  it("test_mutex_error_carries_request_params", async () => {
    const { client } = capturingClient();
    client.setWorkspaceId(99999);
    let caught: unknown;
    try {
      await client.activityFeed(["user_1"], {
        include_events: ["A"],
        exclude_events: ["B"],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QueryError);
    expect((caught as QueryError).requestParams).toStrictEqual({
      include_events: ["A"],
      exclude_events: ["B"],
    });
  });

  it("test_search_properties_without_search_raises", async () => {
    const { client } = capturingClient();
    client.setWorkspaceId(99999);
    await expect(
      client.activityFeed(["user_1"], {
        search_properties: [{ value: "$city", resourceType: "event" }],
      }),
    ).rejects.toBeInstanceOf(QueryError);
  });
});

describe("TestActivityFeed (phase008)", () => {
  it("test_activity_feed_basic", async () => {
    const { client } = createMockClient(makeSession(), (request) => {
      expect(request.method).toBe("POST");
      expect(new URL(request.url).pathname.endsWith("/stream/bookmark")).toBe(
        true,
      );
      const body = parseBody(request.bodyText);
      expect(body["distinct_ids"]).toStrictEqual(["user_123"]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: {
            events: [
              {
                event: "Sign Up",
                properties: { time: 1704067200, $distinct_id: "user_123" },
              },
            ],
          },
        },
      };
    });
    client.setWorkspaceId(99999);
    const result = toNativeJson(
      await client.activityFeed(["user_123"]),
    ) as Record<string, unknown>;
    expect(result["status"]).toBe("ok");
    const events = (result["results"] as Record<string, unknown>)[
      "events"
    ] as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0]?.["event"]).toBe("Sign Up");
  });

  it("test_activity_feed_with_date_range", async () => {
    const { client } = createMockClient(makeSession(), (request) => {
      const body = parseBody(request.bodyText);
      expect(
        (body["bookmark"] as Record<string, unknown>)["dateRange"],
      ).toStrictEqual({
        type: "between",
        from: "2024-01-01",
        to: "2024-01-31",
      });
      return { status: 200, json: { status: "ok", results: { events: [] } } };
    });
    client.setWorkspaceId(99999);
    const result = toNativeJson(
      await client.activityFeed(["user_123"], {
        from_date: "2024-01-01",
        to_date: "2024-01-31",
      }),
    ) as Record<string, unknown>;
    expect(result["status"]).toBe("ok");
  });

  it("test_activity_feed_multiple_users", async () => {
    const { client } = createMockClient(makeSession(), (request) => {
      const body = parseBody(request.bodyText);
      expect(body["distinct_ids"]).toStrictEqual(["user_123", "user_456"]);
      return { status: 200, json: { status: "ok", results: { events: [] } } };
    });
    client.setWorkspaceId(99999);
    const result = toNativeJson(
      await client.activityFeed(["user_123", "user_456"]),
    ) as Record<string, unknown>;
    expect(result["status"]).toBe("ok");
  });
});

describe("TestSegmentationSum", () => {
  it("test_segmentation_sum_basic", async () => {
    const { client } = createMockClient(makeSession(), (request) => {
      expect(request.url.includes("/segmentation/sum")).toBe(true);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { "2024-01-01": 15432.5, "2024-01-02": 18976.25 },
        },
      };
    });
    const result = toNativeJson(
      await client.segmentationSum(
        "Purchase",
        "2024-01-01",
        "2024-01-02",
        'properties["amount"]',
      ),
    ) as Record<string, unknown>;
    expect(result["status"]).toBe("ok");
    expect((result["results"] as Record<string, unknown>)["2024-01-01"]).toBe(
      15432.5,
    );
  });

  it("test_segmentation_sum_with_filter", async () => {
    const { client } = createMockClient(makeSession(), (request) => {
      expect(request.url.includes("where=")).toBe(true);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    const result = toNativeJson(
      await client.segmentationSum(
        "Purchase",
        "2024-01-01",
        "2024-01-02",
        'properties["amount"]',
        { where: 'properties["country"] == "US"' },
      ),
    ) as Record<string, unknown>;
    expect(result["status"]).toBe("ok");
  });
});

describe("TestSegmentationAverage", () => {
  it("test_segmentation_average_basic", async () => {
    const { client } = createMockClient(makeSession(), (request) => {
      expect(request.url.includes("/segmentation/average")).toBe(true);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { "2024-01-01": 54.32, "2024-01-02": 62.15 },
        },
      };
    });
    const result = toNativeJson(
      await client.segmentationAverage(
        "Purchase",
        "2024-01-01",
        "2024-01-02",
        'properties["amount"]',
      ),
    ) as Record<string, unknown>;
    expect(result["status"]).toBe("ok");
    expect((result["results"] as Record<string, unknown>)["2024-01-01"]).toBe(
      54.32,
    );
  });

  it("test_segmentation_average_hourly", async () => {
    const { client } = createMockClient(makeSession(), (request) => {
      expect(request.url.includes("unit=hour")).toBe(true);
      return { status: 200, json: { status: "ok", results: {} } };
    });
    const result = toNativeJson(
      await client.segmentationAverage(
        "Purchase",
        "2024-01-01",
        "2024-01-01",
        'properties["amount"]',
        { unit: "hour" },
      ),
    ) as Record<string, unknown>;
    expect(result["status"]).toBe("ok");
  });
});

describe("TestFrequency", () => {
  it("test_frequency_basic", async () => {
    const { client } = createMockClient(makeSession(), (request) => {
      expect(request.url.includes("/retention/addiction")).toBe(true);
      return {
        status: 200,
        json: {
          data: {
            "2024-01-01": [305, 107, 60, 41, 32],
            "2024-01-02": [495, 204, 117, 77, 53],
          },
        },
      };
    });
    const result = toNativeJson(
      await client.frequency("2024-01-01", "2024-01-02", "day", "hour"),
    ) as Record<string, unknown>;
    expect(Object.hasOwn(result, "data")).toBe(true);
    const data = result["data"] as Record<string, number[]>;
    expect(Object.hasOwn(data, "2024-01-01")).toBe(true);
    expect(data["2024-01-01"]?.[0]).toBe(305);
  });

  it("test_frequency_with_event_filter", async () => {
    const { client } = createMockClient(makeSession(), (request) => {
      expect(request.url.includes("event=")).toBe(true);
      return { status: 200, json: { data: {} } };
    });
    const result = toNativeJson(
      await client.frequency("2024-01-01", "2024-01-02", "day", "hour", {
        event: "App Open",
      }),
    ) as Record<string, unknown>;
    expect(Object.hasOwn(result, "data")).toBe(true);
  });
});

describe("TestSegmentationNumeric", () => {
  it("test_segmentation_numeric_basic", async () => {
    const { client } = createMockClient(makeSession(), (request) => {
      expect(request.url.includes("/segmentation/numeric")).toBe(true);
      return {
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
      };
    });
    const result = toNativeJson(
      await client.segmentationNumeric(
        "Purchase",
        "2024-01-01",
        "2024-01-02",
        'properties["amount"]',
      ),
    ) as Record<string, unknown>;
    expect(Object.hasOwn(result, "data")).toBe(true);
    const values = (result["data"] as Record<string, unknown>)[
      "values"
    ] as Record<string, unknown>;
    expect(Object.hasOwn(values, "0 - 100")).toBe(true);
  });

  it("test_segmentation_numeric_with_type", async () => {
    const { client } = createMockClient(makeSession(), (request) => {
      expect(request.url.includes("type=unique")).toBe(true);
      return { status: 200, json: { data: { series: [], values: {} } } };
    });
    const result = toNativeJson(
      await client.segmentationNumeric(
        "Purchase",
        "2024-01-01",
        "2024-01-02",
        'properties["amount"]',
        { type: "unique" },
      ),
    ) as Record<string, unknown>;
    expect(Object.hasOwn(result, "data")).toBe(true);
  });
});

describe("TestQuerySavedReport", () => {
  it("test_query_saved_report_basic", async () => {
    const { client } = createMockClient(makeSession(), (request) => {
      expect(request.url.includes("/insights")).toBe(true);
      expect(request.url.includes("bookmark_id=")).toBe(true);
      return {
        status: 200,
        json: {
          computed_at: "2024-01-15T10:30:00.252314+00:00",
          date_range: {
            from_date: "2024-01-01T00:00:00-08:00",
            to_date: "2024-01-07T00:00:00-08:00",
          },
          headers: ["$event"],
          series: { "Sign Up": { "2024-01-01T00:00:00-08:00": 150 } },
        },
      };
    });
    const result = toNativeJson(
      await client.querySavedReport(12345678),
    ) as Record<string, unknown>;
    expect(Object.hasOwn(result, "computed_at")).toBe(true);
    expect(Object.hasOwn(result, "series")).toBe(true);
    expect(
      Object.hasOwn(result["series"] as Record<string, unknown>, "Sign Up"),
    ).toBe(true);
  });

  it("test_query_saved_report_passes_bookmark_id", async () => {
    const { client } = createMockClient(makeSession(), (request) => {
      expect(request.url.includes("bookmark_id=99887766")).toBe(true);
      return { status: 200, json: { series: {} } };
    });
    const result = toNativeJson(
      await client.querySavedReport(99887766),
    ) as Record<string, unknown>;
    expect(Object.hasOwn(result, "series")).toBe(true);
  });
});

describe("TestPhase008ErrorHandling", () => {
  const auth401: CannedResponse = {
    status: 401,
    json: { error: "Invalid credentials" },
  };
  const limited429: CannedResponse = {
    status: 429,
    headers: { "Retry-After": "0" },
  };

  it("test_activity_feed_auth_error_on_401", async () => {
    const { client } = createMockClient(makeSession(), () => auth401);
    client.setWorkspaceId(99999);
    let caught: unknown;
    try {
      await client.activityFeed(["user_123"]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AuthenticationError);
    expect((caught as Error).message.toLowerCase()).toContain("credentials");
  });

  it("test_activity_feed_query_error_on_400", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 400,
      json: { error: "Invalid query" },
    }));
    client.setWorkspaceId(99999);
    let caught: unknown;
    try {
      await client.activityFeed(["user_123"]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QueryError);
    expect((caught as Error).message).toContain("Invalid query");
  });

  it("test_activity_feed_rate_limit_on_429", async () => {
    const { client } = createMockClient(makeSession(), () => limited429, {
      maxRetries: 1,
    });
    client.setWorkspaceId(99999);
    let caught: unknown;
    try {
      await client.activityFeed(["user_123"]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RateLimitError);
    expect((caught as RateLimitError).retryAfter).toBe(0);
  });

  it("test_segmentation_sum_auth_error_on_401", async () => {
    const { client } = createMockClient(makeSession(), () => auth401);
    await expect(
      client.segmentationSum(
        "Purchase",
        "2024-01-01",
        "2024-01-31",
        'properties["amount"]',
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("test_segmentation_sum_query_error_on_400", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 400,
      json: { error: "Invalid property expression" },
    }));
    let caught: unknown;
    try {
      await client.segmentationSum(
        "Purchase",
        "2024-01-01",
        "2024-01-31",
        'properties["amount"]',
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QueryError);
    expect((caught as Error).message).toContain("Invalid property expression");
  });

  it("test_segmentation_sum_rate_limit_on_429", async () => {
    const { client } = createMockClient(makeSession(), () => limited429, {
      maxRetries: 1,
    });
    let caught: unknown;
    try {
      await client.segmentationSum(
        "Purchase",
        "2024-01-01",
        "2024-01-31",
        'properties["amount"]',
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RateLimitError);
    expect((caught as RateLimitError).retryAfter).toBe(0);
  });

  it("test_segmentation_average_auth_error_on_401", async () => {
    const { client } = createMockClient(makeSession(), () => auth401);
    await expect(
      client.segmentationAverage(
        "Purchase",
        "2024-01-01",
        "2024-01-31",
        'properties["amount"]',
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("test_segmentation_average_query_error_on_400", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 400,
      json: { error: "Invalid event name" },
    }));
    let caught: unknown;
    try {
      await client.segmentationAverage(
        "Purchase",
        "2024-01-01",
        "2024-01-31",
        'properties["amount"]',
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QueryError);
    expect((caught as Error).message).toContain("Invalid event name");
  });

  it("test_segmentation_average_rate_limit_on_429", async () => {
    const { client } = createMockClient(makeSession(), () => limited429, {
      maxRetries: 1,
    });
    let caught: unknown;
    try {
      await client.segmentationAverage(
        "Purchase",
        "2024-01-01",
        "2024-01-31",
        'properties["amount"]',
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RateLimitError);
    expect((caught as RateLimitError).retryAfter).toBe(0);
  });

  it("test_frequency_auth_error_on_401", async () => {
    const { client } = createMockClient(makeSession(), () => auth401);
    await expect(
      client.frequency("2024-01-01", "2024-01-31", "day", "hour"),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("test_frequency_query_error_on_400", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 400,
      json: { error: "Invalid date range" },
    }));
    let caught: unknown;
    try {
      await client.frequency("2024-01-01", "2024-01-31", "day", "hour");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QueryError);
    expect((caught as Error).message).toContain("Invalid date range");
  });

  it("test_frequency_rate_limit_on_429", async () => {
    const { client } = createMockClient(makeSession(), () => limited429, {
      maxRetries: 1,
    });
    let caught: unknown;
    try {
      await client.frequency("2024-01-01", "2024-01-31", "day", "hour");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RateLimitError);
    expect((caught as RateLimitError).retryAfter).toBe(0);
  });

  it("test_segmentation_numeric_auth_error_on_401", async () => {
    const { client } = createMockClient(makeSession(), () => auth401);
    await expect(
      client.segmentationNumeric(
        "Purchase",
        "2024-01-01",
        "2024-01-31",
        'properties["amount"]',
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("test_segmentation_numeric_query_error_on_400", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 400,
      json: { error: "Property not found" },
    }));
    let caught: unknown;
    try {
      await client.segmentationNumeric(
        "Purchase",
        "2024-01-01",
        "2024-01-31",
        'properties["amount"]',
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QueryError);
    expect((caught as Error).message).toContain("Property not found");
  });

  it("test_segmentation_numeric_rate_limit_on_429", async () => {
    const { client } = createMockClient(makeSession(), () => limited429, {
      maxRetries: 1,
    });
    let caught: unknown;
    try {
      await client.segmentationNumeric(
        "Purchase",
        "2024-01-01",
        "2024-01-31",
        'properties["amount"]',
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RateLimitError);
    expect((caught as RateLimitError).retryAfter).toBe(0);
  });

  it("test_query_saved_report_auth_error_on_401", async () => {
    const { client } = createMockClient(makeSession(), () => auth401);
    await expect(client.querySavedReport(12345678)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("test_query_saved_report_query_error_on_400", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 400,
      json: { error: "Invalid bookmark_id" },
    }));
    let caught: unknown;
    try {
      await client.querySavedReport(99999999);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QueryError);
    expect((caught as Error).message).toContain("Invalid bookmark_id");
  });

  it("test_query_saved_report_rate_limit_on_429", async () => {
    const { client } = createMockClient(makeSession(), () => limited429, {
      maxRetries: 1,
    });
    let caught: unknown;
    try {
      await client.querySavedReport(12345678);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RateLimitError);
    expect((caught as RateLimitError).retryAfter).toBe(0);
  });
});
