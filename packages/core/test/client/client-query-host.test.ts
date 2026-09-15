// Layer-3 translation — Phase-3 packet B4-C2 query-host locks. Sources:
//
// - tests/unit/test_api_client.py::TestSegmentation,
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
// (param values, retry from_date arithmetic) is preserved.
import { describe, expect, it } from "vitest";

import { toNativeJson } from "../../src/client/json-value.js";
import { QueryError } from "../../src/errors.js";
import {
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** A frozen instant for the date-defaulting tests (UTC noon). */
const FROZEN_NOW = new Date("2026-08-15T12:00:00Z");

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
    expect(capturedParams["to_date"]!).toHaveLength(10);
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
        capturedFromDates.push(request.params["from_date"]!);
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
