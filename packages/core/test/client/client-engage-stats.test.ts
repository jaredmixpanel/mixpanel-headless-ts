// Layer-3 translation — Phase-3 packet B4-C2 engage locks. Sources:
//
// - tests/unit/test_api_client.py::TestProfileExport,
//   ::TestEngageParameterValidation (:1861),
//   ::TestEngageParameterEdgeCases (:1942),
//   ::TestEngageDistinctIdParameter (:2042),
//   ::TestEngageGroupIdParameter (:2130),
//   ::TestEngageBehaviorsParameter (:2163),
//   ::TestEngageIncludeAllUsersParameter (:2220),
//   ::TestExportProfilesPage (:2319),
//   ::TestExportProfilesPagePagination (:2554),
//   ::TestCodedExportProfilesCodes (:4124) — ALL.
// - tests/test_api_client_engage_stats.py — ALL (TestEngageStats :81,
//   TestExportProfilesPageNewParams :436,
//   TestExportProfilesPageFilterByCohort :679).
//
// Python `pytest.raises(ValueError)` sites: the AC* guards are
// ParamValidationError (Python dual-inherits ValueError; TS keys on
// class + code, R5.2 — see errors.ts ParamValidationError JSDoc).
import { describe, expect, it } from "vitest";

import { toNativeJson } from "../../src/client/json-value.js";
import { QueryError } from "../../src/errors.js";
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

describe("TestEngageStats", () => {
  const okStats: CannedResponse = {
    status: 200,
    json: { results: [], total: 0 },
  };

  it("test_posts_to_engage_endpoint", async () => {
    let capturedUrl = "";
    const { client } = createMockClient(makeSession(), (request) => {
      capturedUrl = request.url;
      return okStats;
    });
    await client.engageStats();
    expect(capturedUrl.includes("/engage")).toBe(true);
  });

  it("test_posts_to_engage_stats_url", async () => {
    let capturedUrl = "";
    const { client } = createMockClient(makeSession(), (request) => {
      capturedUrl = request.url;
      return okStats;
    });
    await client.engageStats();
    expect(capturedUrl.includes("/engage/stats")).toBe(true);
  });

  it("test_sends_project_id", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return okStats;
    });
    await client.engageStats();
    expect(capturedBody["project_id"]).toBe("12345");
  });

  it("test_default_action_is_count", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return okStats;
    });
    await client.engageStats();
    expect(capturedBody["action"]).toBe("count()");
  });

  it("test_custom_action", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return okStats;
    });
    await client.engageStats({ action: "sum(properties['revenue'])" });
    expect(capturedBody["action"]).toBe("sum(properties['revenue'])");
  });

  it("test_where_sent_as_selector", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return okStats;
    });
    await client.engageStats({ where: 'properties["plan"] == "premium"' });
    expect(capturedBody["selector"]).toBe('properties["plan"] == "premium"');
    expect(Object.hasOwn(capturedBody, "where")).toBe(false);
  });

  it("test_selector_omitted_when_where_none", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return okStats;
    });
    await client.engageStats();
    expect(Object.hasOwn(capturedBody, "selector")).toBe(false);
  });

  it("test_filter_by_cohort_parameter", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return okStats;
    });
    await client.engageStats({ filter_by_cohort: "cohort_123" });
    expect(Object.hasOwn(capturedBody, "filter_by_cohort")).toBe(true);
  });

  it("test_filter_by_cohort_omitted_when_none", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return okStats;
    });
    await client.engageStats();
    expect(Object.hasOwn(capturedBody, "filter_by_cohort")).toBe(false);
  });

  it("test_segment_by_cohorts_parameter", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return okStats;
    });
    await client.engageStats({
      segment_by_cohorts: { cohort_1: true, cohort_2: false },
    });
    const raw = capturedBody["segment_by_cohorts"];
    expect(raw).toBeDefined();
    const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    expect(parsed).toStrictEqual({ cohort_1: true, cohort_2: false });
  });

  it("test_segment_by_cohorts_omitted_when_none", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return okStats;
    });
    await client.engageStats();
    expect(Object.hasOwn(capturedBody, "segment_by_cohorts")).toBe(false);
  });

  it("test_group_id_parameter", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return okStats;
    });
    await client.engageStats({ group_id: "companies" });
    expect(capturedBody["data_group_id"]).toBe("companies");
  });

  it("test_group_id_omitted_when_none", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return okStats;
    });
    await client.engageStats();
    expect(Object.hasOwn(capturedBody, "data_group_id")).toBe(false);
  });

  it("test_as_of_timestamp_parameter", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return okStats;
    });
    await client.engageStats({ as_of_timestamp: 1700000000 });
    expect(capturedBody["as_of_timestamp"]).toBe(1700000000);
  });

  it("test_as_of_timestamp_omitted_when_none", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return okStats;
    });
    await client.engageStats();
    expect(Object.hasOwn(capturedBody, "as_of_timestamp")).toBe(false);
  });

  it("test_include_all_users_false_by_default", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return okStats;
    });
    await client.engageStats();
    expect(capturedBody["include_all_users"]).not.toBe(true);
  });

  it("test_include_all_users_true", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return okStats;
    });
    await client.engageStats({
      filter_by_cohort: '{"id": 42}',
      include_all_users: true,
    });
    expect(capturedBody["include_all_users"]).toBe(true);
  });

  it("test_returns_raw_dict", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: { results: [{ count: 42 }], total: 42 },
    }));
    const result = await client.engageStats();
    const native = toNativeJson(result) as Record<string, unknown>;
    expect(typeof native).toBe("object");
    expect(native["total"]).toBe(42);
  });

  it("test_uses_post_method", async () => {
    let capturedMethod = "";
    const { client } = createMockClient(makeSession(), (request) => {
      capturedMethod = request.method;
      return okStats;
    });
    await client.engageStats();
    expect(capturedMethod).toBe("POST");
  });

  it("test_all_params_combined", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return okStats;
    });
    await client.engageStats({
      where: 'properties["country"] == "US"',
      action: "sum(properties['revenue'])",
      filter_by_cohort: "cohort_99",
      segment_by_cohorts: { c1: true },
      group_id: "companies",
      as_of_timestamp: 1700000000,
      include_all_users: true,
    });
    expect(capturedBody["selector"]).toBe('properties["country"] == "US"');
    expect(Object.hasOwn(capturedBody, "where")).toBe(false);
    expect(capturedBody["action"]).toBe("sum(properties['revenue'])");
    expect(Object.hasOwn(capturedBody, "filter_by_cohort")).toBe(true);
    expect(Object.hasOwn(capturedBody, "segment_by_cohorts")).toBe(true);
    expect(capturedBody["data_group_id"]).toBe("companies");
    expect(capturedBody["as_of_timestamp"]).toBe(1700000000);
    expect(capturedBody["include_all_users"]).toBe(true);
  });

  it("test_non_dict_response_raises_query_error", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: [1, 2, 3],
    }));
    let caught: unknown;
    try {
      await client.engageStats();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QueryError);
    expect((caught as Error).message).toContain("unexpected response type");
    // The recorded detail shape: Python str() of the parsed list.
    expect((caught as QueryError).responseBody).toBe("[1, 2, 3]");
    expect((caught as QueryError).statusCode).toBe(200);
  });
});
