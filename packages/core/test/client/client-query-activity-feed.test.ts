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

/** Parse the captured JSON request body. */
function parseBody(bodyText: string): Record<string, unknown> {
  return bodyText === ""
    ? {}
    : (JSON.parse(bodyText) as Record<string, unknown>);
}

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
    const body = captured.body!;
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
    const body = captured.body!;
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
    const body = captured.body!;
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
    const body = captured.body!;
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
