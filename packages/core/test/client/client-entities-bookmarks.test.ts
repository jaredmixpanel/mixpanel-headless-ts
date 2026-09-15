// Legacy `listBookmarks`, `querySavedFlows` and the `querySavedReport`
// type routing (insights / funnels / retention / flows, including the
// 30-day funnel date defaults and today cap). Mirrors every class of
// tests/unit/test_api_client_bookmarks.py; live `datetime.now()` reads become
// the injected frozen clock, the date arithmetic under assertion is unchanged.

import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import { toNativeJson } from "../../src/client/json-value.js";
import { AuthenticationError, QueryError } from "../../src/errors.js";
import {
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** The `test_credentials` fixture twin. */
function testCredentials(): Session {
  return makeSession({
    username: "test_user",
    secret: "test_secret",
    projectId: "12345",
    region: "us",
  });
}

/** A frozen instant for the date-defaulting tests (UTC noon). */
const FROZEN_NOW = new Date("2026-08-15T12:00:00Z");

describe("List bookmarks", () => {
  // python: TestListBookmarks
  it("list bookmarks endpoint URL", async () => {
    // python: test_list_bookmarks_endpoint_url
    const capturedUrls: string[] = [];
    const { client } = createMockClient(testCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { results: [] } };
    });
    await client.listBookmarks();
    expect(capturedUrls[0]).toContain("/api/app/projects/12345/bookmarks");
    expect(capturedUrls[0]).toContain("v=2");
  });

  it("list bookmarks returns results", async () => {
    // python: test_list_bookmarks_returns_results
    const { client } = createMockClient(testCredentials(), () => ({
      status: 200,
      json: {
        results: [
          {
            id: 63877017,
            name: "Weekly Active Users",
            type: "insights",
            project_id: 12345,
            created: "2024-01-01T00:00:00",
            modified: "2024-06-15T10:30:00",
          },
          {
            id: 63877018,
            name: "Conversion Funnel",
            type: "funnels",
            project_id: 12345,
            created: "2024-02-01T00:00:00",
            modified: "2024-07-20T14:45:00",
          },
        ],
      },
    }));
    const result = toNativeJson(await client.listBookmarks()) as Record<
      string,
      Array<Record<string, unknown>>
    >;
    expect(Object.hasOwn(result, "results")).toBe(true);
    expect(result["results"]).toHaveLength(2);
    expect(result["results"]?.[0]?.["name"]).toBe("Weekly Active Users");
    expect(result["results"]?.[1]?.["type"]).toBe("funnels");
  });

  it("list bookmarks with type filter", async () => {
    // python: test_list_bookmarks_with_type_filter
    const capturedUrls: string[] = [];
    const { client } = createMockClient(testCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          results: [
            {
              id: 63877017,
              name: "Weekly Active Users",
              type: "insights",
              project_id: 12345,
              created: "2024-01-01T00:00:00",
              modified: "2024-06-15T10:30:00",
            },
          ],
        },
      };
    });
    const result = toNativeJson(
      await client.listBookmarks("insights"),
    ) as Record<string, Array<Record<string, unknown>>>;
    expect(capturedUrls[0]).toContain("type=insights");
    expect(result["results"]).toHaveLength(1);
    expect(result["results"]?.[0]?.["type"]).toBe("insights");
  });

  it("list bookmarks all types", async () => {
    // python: test_list_bookmarks_all_types
    const bookmarkTypes = [
      "insights",
      "funnels",
      "retention",
      "flows",
      "launch-analysis",
    ];
    for (const bmType of bookmarkTypes) {
      const { client } = createMockClient(testCredentials(), () => ({
        status: 200,
        json: { results: [] },
      }));
      await expect(client.listBookmarks(bmType)).resolves.toBeDefined();
    }
  });

  it("list bookmarks empty results", async () => {
    // python: test_list_bookmarks_empty_results
    const { client } = createMockClient(testCredentials(), () => ({
      status: 200,
      json: { results: [] },
    }));
    const result = toNativeJson(await client.listBookmarks()) as Record<
      string,
      unknown
    >;
    expect(result["results"]).toStrictEqual([]);
  });

  it("list bookmarks full metadata", async () => {
    // python: test_list_bookmarks_full_metadata
    const { client } = createMockClient(testCredentials(), () => ({
      status: 200,
      json: {
        results: [
          {
            id: 63877017,
            name: "Monthly Recurring Revenue",
            type: "insights",
            project_id: 12345,
            workspace_id: 100,
            dashboard_id: 200,
            created: "2024-09-18T16:39:49",
            modified: "2025-08-26T05:16:50",
            creator_id: 42,
            creator_name: "John Doe",
            description: "Track monthly recurring revenue",
          },
        ],
      },
    }));
    const result = toNativeJson(await client.listBookmarks()) as Record<
      string,
      Array<Record<string, unknown>>
    >;
    const bookmark = result["results"]![0]!;
    expect(bookmark["id"]).toBe(63877017);
    expect(bookmark["name"]).toBe("Monthly Recurring Revenue");
    expect(bookmark["type"]).toBe("insights");
    expect(bookmark["project_id"]).toBe(12345);
    expect(bookmark["workspace_id"]).toBe(100);
    expect(bookmark["dashboard_id"]).toBe(200);
    expect(bookmark["created"]).toBe("2024-09-18T16:39:49");
    expect(bookmark["modified"]).toBe("2025-08-26T05:16:50");
    expect(bookmark["creator_id"]).toBe(42);
    expect(bookmark["creator_name"]).toBe("John Doe");
    expect(bookmark["description"]).toBe("Track monthly recurring revenue");
  });
});

describe("List bookmarks errors", () => {
  // python: TestListBookmarksErrors
  it("list bookmarks auth error on 401", async () => {
    // python: test_list_bookmarks_auth_error_on_401
    const { client } = createMockClient(testCredentials(), () => ({
      status: 401,
      json: { error: "Invalid credentials" },
    }));
    await expect(client.listBookmarks()).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("list bookmarks query error on 403", async () => {
    // python: test_list_bookmarks_query_error_on_403
    const { client } = createMockClient(testCredentials(), () => ({
      status: 403,
      json: { error: "Permission denied" },
    }));
    const err: unknown = await client
      .listBookmarks()
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(QueryError);
    expect(String(err)).toContain("Permission denied");
  });

  it("list bookmarks query error on 400", async () => {
    // python: test_list_bookmarks_query_error_on_400
    const { client } = createMockClient(testCredentials(), () => ({
      status: 400,
      json: { error: "Invalid type parameter" },
    }));
    const err: unknown = await client
      .listBookmarks("invalid")
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(QueryError);
    expect(String(err)).toContain("Invalid type parameter");
  });
});

describe("Query flows", () => {
  // python: TestQueryFlows
  it("query saved flows endpoint URL", async () => {
    // python: test_query_saved_flows_endpoint_url
    const capturedUrls: string[] = [];
    const { client } = createMockClient(testCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          steps: [],
          breakdowns: [],
          overallConversionRate: 0.0,
          computed_at: "2024-01-15T10:00:00",
        },
      };
    });
    await client.querySavedFlows(12345);
    expect(capturedUrls[0]).toContain("/api/query/arb_funnels");
    expect(capturedUrls[0]).toContain("query_type=flows_sankey");
    expect(capturedUrls[0]).toContain("bookmark_id=12345");
  });

  it("query saved flows returns raw response", async () => {
    // python: test_query_saved_flows_returns_raw_response
    const { client } = createMockClient(testCredentials(), () => ({
      status: 200,
      json: {
        steps: [
          { step: 1, event: "Page View", count: 1000 },
          { step: 2, event: "Add to Cart", count: 500 },
        ],
        breakdowns: [{ path: "Page View -> Add to Cart", count: 500 }],
        overallConversionRate: 0.5,
        computed_at: "2024-01-15T10:00:00",
        metadata: { version: "1.0" },
      },
    }));
    const result = toNativeJson(await client.querySavedFlows(12345)) as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(result, "steps")).toBe(true);
    expect(result["steps"]).toHaveLength(2);
    expect(result["overallConversionRate"]).toBe(0.5);
    expect(result["computed_at"]).toBe("2024-01-15T10:00:00");
  });

  it("query saved flows auth error on 401", async () => {
    // python: test_query_saved_flows_auth_error_on_401
    const { client } = createMockClient(testCredentials(), () => ({
      status: 401,
      json: { error: "Invalid credentials" },
    }));
    await expect(client.querySavedFlows(12345)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("query saved flows query error on 404", async () => {
    // python: test_query_saved_flows_query_error_on_404
    const { client } = createMockClient(testCredentials(), () => ({
      status: 404,
      json: { error: "Bookmark not found" },
    }));
    const err: unknown = await client
      .querySavedFlows(99999)
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(QueryError);
    expect(String(err)).toContain("Bookmark not found");
  });
});

describe("Query saved report routing", () => {
  // python: TestQuerySavedReportRouting
  it("query saved report default routes to insights", async () => {
    // python: test_query_saved_report_default_routes_to_insights
    const capturedUrls: string[] = [];
    const { client } = createMockClient(testCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          headers: ["$metric"],
          computed_at: "2024-01-15T10:00:00",
          date_range: { from_date: "2024-01-01", to_date: "2024-01-15" },
          series: { "Event A": { "2024-01-01": 100 } },
        },
      };
    });
    const result = toNativeJson(await client.querySavedReport(12345)) as Record<
      string,
      unknown
    >;
    expect(capturedUrls[0]).toContain("/api/query/insights");
    expect(capturedUrls[0]).toContain("bookmark_id=12345");
    expect(Object.hasOwn(result, "headers")).toBe(true);
    expect(result["headers"]).toStrictEqual(["$metric"]);
  });

  it("query saved report insights type routes to insights", async () => {
    // python: test_query_saved_report_insights_type_routes_to_insights
    const capturedUrls: string[] = [];
    const { client } = createMockClient(testCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          headers: ["$metric"],
          computed_at: "2024-01-15T10:00:00",
          date_range: { from_date: "2024-01-01", to_date: "2024-01-15" },
          series: {},
        },
      };
    });
    await client.querySavedReport(12345, { bookmark_type: "insights" });
    expect(capturedUrls[0]).toContain("/api/query/insights");
  });

  it("query saved report funnels routes to funnels endpoint", async () => {
    // python: test_query_saved_report_funnels_routes_to_funnels_endpoint
    const capturedUrls: string[] = [];
    const { client } = createMockClient(
      testCredentials(),
      (request) => {
        capturedUrls.push(request.url);
        return {
          status: 200,
          json: {
            computed_at: "2024-01-15T10:00:00",
            data: { "2024-01-15": { steps: [] } },
            meta: {},
          },
        };
      },
      { now: () => FROZEN_NOW },
    );
    await client.querySavedReport(12345, { bookmark_type: "funnels" });
    expect(capturedUrls[0]).toContain("/api/query/funnels");
  });

  it("query saved report funnels uses funnel ID param", async () => {
    // python: test_query_saved_report_funnels_uses_funnel_id_param
    const capturedUrls: string[] = [];
    const { client } = createMockClient(
      testCredentials(),
      (request) => {
        capturedUrls.push(request.url);
        return {
          status: 200,
          json: { computed_at: "2024-01-15T10:00:00", data: {}, meta: {} },
        };
      },
      { now: () => FROZEN_NOW },
    );
    await client.querySavedReport(12345, { bookmark_type: "funnels" });
    // For funnels, the bookmark_id is passed as funnel_id
    expect(capturedUrls[0]).toContain("funnel_id=12345");
  });

  it("query saved report funnels default dates last 30 days", async () => {
    // python: test_query_saved_report_funnels_default_dates_last_30_days
    // Frozen clock: today = 2026-08-15; 30 days earlier = 2026-07-16.
    const today = "2026-08-15";
    const thirtyDaysAgo = "2026-07-16";
    const capturedUrls: string[] = [];
    const { client } = createMockClient(
      testCredentials(),
      (request) => {
        capturedUrls.push(request.url);
        return {
          status: 200,
          json: { computed_at: "2024-01-15T10:00:00", data: {}, meta: {} },
        };
      },
      { now: () => FROZEN_NOW },
    );
    await client.querySavedReport(12345, { bookmark_type: "funnels" });
    expect(capturedUrls[0]).toContain(`from_date=${thirtyDaysAgo}`);
    expect(capturedUrls[0]).toContain(`to_date=${today}`);
  });

  it("query saved report funnels uses provided dates", async () => {
    // python: test_query_saved_report_funnels_uses_provided_dates
    const capturedUrls: string[] = [];
    const { client } = createMockClient(testCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { computed_at: "2024-06-30T10:00:00", data: {}, meta: {} },
      };
    });
    await client.querySavedReport(12345, {
      bookmark_type: "funnels",
      from_date: "2024-06-01",
      to_date: "2024-06-30",
    });
    expect(capturedUrls[0]).toContain("from_date=2024-06-01");
    expect(capturedUrls[0]).toContain("to_date=2024-06-30");
  });

  it("query saved report retention routes to retention endpoint", async () => {
    // python: test_query_saved_report_retention_routes_to_retention_endpoint
    const capturedUrls: string[] = [];
    const { client } = createMockClient(testCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          "2024-01-01": { first: 100, counts: [100, 80, 60], rates: [] },
        },
      };
    });
    await client.querySavedReport(12345, { bookmark_type: "retention" });
    expect(capturedUrls[0]).toContain("/api/query/retention");
    expect(capturedUrls[0]).toContain("bookmark_id=12345");
  });

  it("query saved report flows routes to arb funnels", async () => {
    // python: test_query_saved_report_flows_routes_to_arb_funnels
    const capturedUrls: string[] = [];
    const { client } = createMockClient(testCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          computed_at: "2024-01-15T10:00:00",
          steps: [],
          breakdowns: [],
          overallConversionRate: 0.0,
        },
      };
    });
    await client.querySavedReport(12345, { bookmark_type: "flows" });
    expect(capturedUrls[0]).toContain("/api/query/arb_funnels");
    expect(capturedUrls[0]).toContain("bookmark_id=12345");
    expect(capturedUrls[0]).toContain("query_type=flows_sankey");
  });

  it("query saved report funnels only to date derives from date", async () => {
    // python: test_query_saved_report_funnels_only_to_date_derives_from_date
    // When only to_date is provided, from_date should be derived as 30
    // days before to_date, not 30 days before today. This prevents
    // inverted date ranges when querying historical data.
    const historicalToDate = "2023-06-15";
    const expectedFromDate = "2023-05-16"; // 30 days before 2023-06-15
    const capturedUrls: string[] = [];
    const { client } = createMockClient(
      testCredentials(),
      (request) => {
        capturedUrls.push(request.url);
        return {
          status: 200,
          json: { computed_at: "2023-06-15T10:00:00", data: {}, meta: {} },
        };
      },
      { now: () => FROZEN_NOW },
    );
    await client.querySavedReport(12345, {
      bookmark_type: "funnels",
      to_date: historicalToDate,
    });
    expect(capturedUrls[0]).toContain(`from_date=${expectedFromDate}`);
    expect(capturedUrls[0]).toContain(`to_date=${historicalToDate}`);
  });

  it("query saved report funnels only from date derives to date", async () => {
    // python: test_query_saved_report_funnels_only_from_date_derives_to_date
    // When only from_date is provided, to_date should be derived as 30
    // days after from_date, but capped at today to avoid querying
    // future dates.
    const historicalFromDate = "2023-06-15";
    const expectedToDate = "2023-07-15"; // 30 days after 2023-06-15
    const capturedUrls: string[] = [];
    const { client } = createMockClient(
      testCredentials(),
      (request) => {
        capturedUrls.push(request.url);
        return {
          status: 200,
          json: { computed_at: "2023-07-15T10:00:00", data: {}, meta: {} },
        };
      },
      { now: () => FROZEN_NOW },
    );
    await client.querySavedReport(12345, {
      bookmark_type: "funnels",
      from_date: historicalFromDate,
    });
    expect(capturedUrls[0]).toContain(`from_date=${historicalFromDate}`);
    expect(capturedUrls[0]).toContain(`to_date=${expectedToDate}`);
  });
});
