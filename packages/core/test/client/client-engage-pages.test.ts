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

import { ParamValidationError } from "../../src/errors.js";
import { ProfilePageResult } from "../../src/types/results/discovery.js";
import {
  type CannedResponse,
  createMockClient,
  drain,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** Parse the captured JSON request body. */
function parseBody(bodyText: string): Record<string, unknown> {
  return bodyText === ""
    ? {}
    : (JSON.parse(bodyText) as Record<string, unknown>);
}

const emptyResults: CannedResponse = { status: 200, json: { results: [] } };

describe("Export profiles page", () => {
  // python: TestExportProfilesPage
  it("first page without session ID", async () => {
    // python: test_first_page_without_session_id
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return {
        status: 200,
        json: {
          results: [
            { $distinct_id: "user1", $properties: { name: "Alice" } },
            { $distinct_id: "user2", $properties: { name: "Bob" } },
          ],
          session_id: "session_abc",
          total: 5000,
          page_size: 1000,
        },
      };
    });
    const result = await client.exportProfilesPage(0);
    expect(capturedBody["page"]).toBe(0);
    expect(Object.hasOwn(capturedBody, "session_id")).toBe(false);
    expect(result.profiles).toHaveLength(2);
    expect(result.session_id).toBe("session_abc");
    expect(result.page).toBe(0);
    expect(result.has_more).toBe(true);
  });

  it("subsequent page with session ID", async () => {
    // python: test_subsequent_page_with_session_id
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return {
        status: 200,
        json: {
          results: [{ $distinct_id: "user3" }],
          session_id: "session_abc",
          total: 5000,
          page_size: 1000,
        },
      };
    });
    const result = await client.exportProfilesPage(1, {
      session_id: "session_abc",
    });
    expect(capturedBody["page"]).toBe(1);
    expect(capturedBody["session_id"]).toBe("session_abc");
    expect(result.profiles).toHaveLength(1);
    expect(result.page).toBe(1);
  });

  it("last page no more results", async () => {
    // python: test_last_page_no_more_results
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: { results: [], session_id: null, total: 5000, page_size: 1000 },
    }));
    const result = await client.exportProfilesPage(5, {
      session_id: "session_abc",
    });
    expect(result.profiles).toStrictEqual([]);
    expect(result.session_id).toBeNull();
    expect(result.has_more).toBe(false);
  });

  it("with filter parameters", async () => {
    // python: test_with_filter_parameters
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return {
        status: 200,
        json: { results: [], session_id: null, total: 0, page_size: 1000 },
      };
    });
    await client.exportProfilesPage(0, {
      where: 'properties["plan"] == "premium"',
      output_properties: ["$name", "$email"],
    });
    expect(capturedBody["where"]).toBe('properties["plan"] == "premium"');
    expect(capturedBody["output_properties"]).toBe('["$name", "$email"]');
  });

  it("with cohort ID", async () => {
    // python: test_with_cohort_id
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return {
        status: 200,
        json: { results: [], session_id: null, total: 0, page_size: 1000 },
      };
    });
    await client.exportProfilesPage(0, { cohort_id: "cohort_123" });
    expect(capturedBody["filter_by_cohort"]).toBe('{"id": "cohort_123"}');
  });

  it("with behaviors", async () => {
    // python: test_with_behaviors
    let capturedBody: Record<string, unknown> = {};
    const behaviors = [
      {
        window: "30d",
        name: "purchased",
        event_selectors: [{ event: "Purchase" }],
      },
    ];
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return {
        status: 200,
        json: { results: [], session_id: null, total: 0, page_size: 1000 },
      };
    });
    await client.exportProfilesPage(0, { behaviors });
    expect(Object.hasOwn(capturedBody, "behaviors")).toBe(true);
  });

  it("result type", async () => {
    // python: test_result_type
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: {
        results: [{ $distinct_id: "user1" }],
        session_id: "session_abc",
        total: 1000,
        page_size: 1000,
      },
    }));
    const result = await client.exportProfilesPage(0);
    expect(result).toBeInstanceOf(ProfilePageResult);
  });

  it("has more true when session ID present", async () => {
    // python: test_has_more_true_when_session_id_present
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: {
        results: [{ $distinct_id: "user1" }],
        session_id: "session_abc",
        total: 5000,
        page_size: 1000,
      },
    }));
    const result = await client.exportProfilesPage(0);
    expect(result.has_more).toBe(true);
  });

  it("has more false when no session ID", async () => {
    // python: test_has_more_false_when_no_session_id
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: {
        results: [{ $distinct_id: "user1" }],
        session_id: null,
        total: 1,
        page_size: 1000,
      },
    }));
    const result = await client.exportProfilesPage(0);
    expect(result.has_more).toBe(false);
  });

  it("empty results with no session", async () => {
    // python: test_empty_results_with_no_session
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: { results: [], session_id: null, total: 0, page_size: 1000 },
    }));
    const result = await client.exportProfilesPage(0);
    expect(result.profiles).toStrictEqual([]);
    expect(result.session_id).toBeNull();
    expect(result.has_more).toBe(false);
  });
});

describe("Export profiles page pagination", () => {
  // python: TestExportProfilesPagePagination
  it("extracts total from response", async () => {
    // python: test_extracts_total_from_response
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: {
        results: [{ $distinct_id: "user1" }],
        session_id: "session_abc",
        total: 5432,
        page_size: 1000,
        page: 0,
      },
    }));
    const result = await client.exportProfilesPage(0);
    expect(result.total).toBe(5432);
  });

  it("extracts page size from response", async () => {
    // python: test_extracts_page_size_from_response
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: {
        results: [],
        session_id: "session_abc",
        total: 500,
        page_size: 500,
        page: 0,
      },
    }));
    const result = await client.exportProfilesPage(0);
    expect(result.page_size).toBe(500);
  });

  it("defaults total to zero when missing", async () => {
    // python: test_defaults_total_to_zero_when_missing
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: { results: [], session_id: null, page_size: 1000 },
    }));
    const result = await client.exportProfilesPage(0);
    expect(result.total).toBe(0);
  });

  it("defaults page size to 1000 when missing", async () => {
    // python: test_defaults_page_size_to_1000_when_missing
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: { results: [], session_id: null, total: 0 },
    }));
    const result = await client.exportProfilesPage(0);
    expect(result.page_size).toBe(1000);
  });

  it("num pages computed correctly", async () => {
    // python: test_num_pages_computed_correctly
    const results: Array<Record<string, string>> = [];
    for (let i = 0; i < 1000; i += 1) {
      results.push({ $distinct_id: `user${i}` });
    }
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: {
        results,
        session_id: "session_abc",
        total: 5432,
        page_size: 1000,
        page: 0,
      },
    }));
    const result = await client.exportProfilesPage(0);
    expect(result.num_pages).toBe(6); // ceil(5432/1000)
  });
});

describe("Coded export profiles codes", () => {
  // python: TestCodedExportProfilesCodes
  /** Expect a ParamValidationError with the given code. */
  async function expectCode(
    run: () => AsyncIterable<unknown>,
    code: string,
  ): Promise<void> {
    let caught: unknown;
    try {
      await drain(run());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    expect((caught as ParamValidationError).code).toBe(code);
  }

  function makeClient(): ReturnType<typeof createMockClient>["client"] {
    return createMockClient(makeSession(), () => emptyResults).client;
  }

  it("AC2 single IDs raise coded error", async () => {
    // python: test_ac2_single_ids_raise_coded_error
    await expectCode(
      () =>
        makeClient().exportProfiles({
          distinct_id: "u1",
          distinct_ids: ["u2"],
        }),
      "AC2_DISTINCT_ID_CONFLICT",
    );
  });

  it("AC2 many IDs raise coded error", async () => {
    // python: test_ac2_many_ids_raise_coded_error
    await expectCode(
      () =>
        makeClient().exportProfiles({
          distinct_id: "u1",
          distinct_ids: ["u2", "u3", "u4"],
        }),
      "AC2_DISTINCT_ID_CONFLICT",
    );
  });

  it("AC3 behaviors with cohort raise coded error", async () => {
    // python: test_ac3_behaviors_with_cohort_raise_coded_error
    await expectCode(
      () =>
        makeClient().exportProfiles({
          behaviors: [{ event: "Purchase" }],
          cohort_id: "c1",
        }),
      "AC3_BEHAVIORS_COHORT_CONFLICT",
    );
  });

  it("AC3 empty behaviors with cohort raise coded error", async () => {
    // python: test_ac3_empty_behaviors_with_cohort_raise_coded_error
    await expectCode(
      () => makeClient().exportProfiles({ behaviors: [], cohort_id: "c1" }),
      "AC3_BEHAVIORS_COHORT_CONFLICT",
    );
  });

  it("AC4 include all users alone raises coded error", async () => {
    // python: test_ac4_include_all_users_alone_raises_coded_error
    await expectCode(
      () => makeClient().exportProfiles({ include_all_users: true }),
      "AC4_INCLUDE_ALL_USERS_REQUIRES_COHORT",
    );
  });

  it("AC4 include all users with where raises coded error", async () => {
    // python: test_ac4_include_all_users_with_where_raises_coded_error
    await expectCode(
      () =>
        makeClient().exportProfiles({
          include_all_users: true,
          where: 'properties["plan"] == "premium"',
        }),
      "AC4_INCLUDE_ALL_USERS_REQUIRES_COHORT",
    );
  });

  it("AC5 behaviors string raises coded error", async () => {
    // python: test_ac5_behaviors_string_raises_coded_error
    await expectCode(
      () =>
        makeClient().exportProfiles({
          behaviors: "not-a-list" as unknown as readonly unknown[],
        }),
      "AC5_BEHAVIORS_NOT_LIST",
    );
  });

  it("AC5 behaviors dict raises coded error", async () => {
    // python: test_ac5_behaviors_dict_raises_coded_error
    await expectCode(
      () =>
        makeClient().exportProfiles({
          behaviors: { event: "P" } as unknown as readonly unknown[],
        }),
      "AC5_BEHAVIORS_NOT_LIST",
    );
  });

  it("AC6 near future timestamp raises coded error", async () => {
    // python: test_ac6_near_future_timestamp_raises_coded_error
    await expectCode(
      () =>
        makeClient().exportProfiles({
          as_of_timestamp: Math.floor(Date.now() / 1000) + 10_000,
        }),
      "AC6_AS_OF_TIMESTAMP_FUTURE",
    );
  });

  it("AC6 far future timestamp raises coded error", async () => {
    // python: test_ac6_far_future_timestamp_raises_coded_error
    await expectCode(
      () =>
        makeClient().exportProfiles({
          as_of_timestamp: Math.floor(Date.now() / 1000) + 10_000_000,
        }),
      "AC6_AS_OF_TIMESTAMP_FUTURE",
    );
  });

  it("ac guards stay catchable as value error", async () => {
    // python: test_ac_guards_stay_catchable_as_value_error
    // Python: bare `except ValueError` still catches the coded guard.
    // TS twin: the instance is a ParamValidationError with the code
    // (class + code is the conformance key, R5.2).
    let caught: unknown;
    try {
      await drain(makeClient().exportProfiles({ include_all_users: true }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    expect((caught as ParamValidationError).code).toBe(
      "AC4_INCLUDE_ALL_USERS_REQUIRES_COHORT",
    );
  });
});

describe("Export profiles page new params", () => {
  // python: TestExportProfilesPageNewParams
  const emptyPage: CannedResponse = {
    status: 200,
    json: { results: [], session_id: null, total: 0, page_size: 1000 },
  };

  it("sort key parameter", async () => {
    // python: test_sort_key_parameter
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0, { sort_key: "$last_seen" });
    expect(capturedBody["sort_key"]).toBe("$last_seen");
  });

  it("sort key omitted when null", async () => {
    // python: test_sort_key_omitted_when_none
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0);
    expect(Object.hasOwn(capturedBody, "sort_key")).toBe(false);
  });

  it("sort order parameter", async () => {
    // python: test_sort_order_parameter
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0, { sort_order: "descending" });
    expect(capturedBody["sort_order"]).toBe("descending");
  });

  it("sort order omitted when null", async () => {
    // python: test_sort_order_omitted_when_none
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0);
    expect(Object.hasOwn(capturedBody, "sort_order")).toBe(false);
  });

  it("search parameter", async () => {
    // python: test_search_parameter
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0, { search: "alice@example.com" });
    expect(capturedBody["search"]).toBe("alice@example.com");
  });

  it("search omitted when null", async () => {
    // python: test_search_omitted_when_none
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0);
    expect(Object.hasOwn(capturedBody, "search")).toBe(false);
  });

  it("limit parameter", async () => {
    // python: test_limit_parameter
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0, { limit: 50 });
    expect(capturedBody["limit"]).toBe(50);
  });

  it("limit omitted when null", async () => {
    // python: test_limit_omitted_when_none
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0);
    expect(Object.hasOwn(capturedBody, "limit")).toBe(false);
  });

  it("sort key and sort order combined", async () => {
    // python: test_sort_key_and_sort_order_combined
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0, {
      sort_key: "$last_seen",
      sort_order: "descending",
    });
    expect(capturedBody["sort_key"]).toBe("$last_seen");
    expect(capturedBody["sort_order"]).toBe("descending");
  });

  it("all new params combined", async () => {
    // python: test_all_new_params_combined
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return {
        status: 200,
        json: {
          results: [{ $distinct_id: "u1" }],
          session_id: "sess_1",
          total: 100,
          page_size: 50,
        },
      };
    });
    await client.exportProfilesPage(0, {
      sort_key: "$created",
      sort_order: "ascending",
      search: "bob",
      limit: 25,
      filter_by_cohort: '{"id": 789}',
    });
    expect(capturedBody["sort_key"]).toBe("$created");
    expect(capturedBody["sort_order"]).toBe("ascending");
    expect(capturedBody["search"]).toBe("bob");
    expect(capturedBody["limit"]).toBe(25);
    expect(Object.hasOwn(capturedBody, "filter_by_cohort")).toBe(true);
  });

  it("new params coexist with existing params", async () => {
    // python: test_new_params_coexist_with_existing_params
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0, {
      where: 'properties["plan"] == "premium"',
      output_properties: ["$name", "$email"],
      sort_key: "$last_seen",
      search: "test",
    });
    expect(capturedBody["where"]).toBe('properties["plan"] == "premium"');
    expect(capturedBody["output_properties"]).toBe('["$name", "$email"]');
    expect(capturedBody["sort_key"]).toBe("$last_seen");
    expect(capturedBody["search"]).toBe("test");
  });
});

describe("Export profiles page filter by cohort", () => {
  // python: TestExportProfilesPageFilterByCohort
  const emptyPage: CannedResponse = {
    status: 200,
    json: { results: [], session_id: null, total: 0, page_size: 1000 },
  };

  it("filter by cohort ID format", async () => {
    // python: test_filter_by_cohort_id_format
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0, { filter_by_cohort: '{"id": 42}' });
    const raw = capturedBody["filter_by_cohort"];
    expect(raw).toBeDefined();
    const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    expect(parsed).toStrictEqual({ id: 42 });
  });

  it("filter by cohort raw cohort format", async () => {
    // python: test_filter_by_cohort_raw_cohort_format
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    const rawCohort = {
      raw_cohort: {
        and_batch: [
          {
            event_selectors: [{ event: "Purchase" }],
            filter_type: "selector",
          },
        ],
      },
    };
    await client.exportProfilesPage(0, {
      filter_by_cohort: JSON.stringify(rawCohort),
    });
    const raw = capturedBody["filter_by_cohort"];
    expect(raw).toBeDefined();
    const parsed = (
      typeof raw === "string" ? JSON.parse(raw) : raw
    ) as typeof rawCohort;
    expect(Object.hasOwn(parsed, "raw_cohort")).toBe(true);
    expect(parsed.raw_cohort.and_batch[0]?.event_selectors[0]?.event).toBe(
      "Purchase",
    );
  });

  it("filter by cohort omitted when null", async () => {
    // python: test_filter_by_cohort_omitted_when_none
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0);
    expect(Object.hasOwn(capturedBody, "filter_by_cohort")).toBe(false);
  });

  it("filter by cohort does not conflict with cohort ID", async () => {
    // python: test_filter_by_cohort_does_not_conflict_with_cohort_id
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0, {
      cohort_id: "123",
      filter_by_cohort: '{"id": 99}',
    });
    const raw = capturedBody["filter_by_cohort"];
    expect(raw).toBeDefined();
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<
      string,
      unknown
    >;
    expect(parsed["id"]).toBe(99);
  });

  it("filter by cohort passthrough preserves JSON", async () => {
    // python: test_filter_by_cohort_passthrough_preserves_json
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0, { filter_by_cohort: '{"id": 55}' });
    const raw = capturedBody["filter_by_cohort"];
    expect(raw).toBeDefined();
    const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    expect(parsed).toStrictEqual({ id: 55 });
  });
});
