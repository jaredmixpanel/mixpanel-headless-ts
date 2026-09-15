// Layer-3 translation — Phase-3 packet B4-C2 engage locks. Sources:
//
// - tests/unit/test_api_client.py::TestProfileExport (:965),
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
import { ParamValidationError, QueryError } from "../../src/errors.js";
import { ProfilePageResult } from "../../src/types/results/index.js";
import {
  type CannedResponse,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** Drain an async generator into an array (`list(...)`). */
async function drain<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) {
    out.push(item);
  }
  return out;
}

/** Parse the captured JSON request body. */
function parseBody(bodyText: string): Record<string, unknown> {
  return bodyText === ""
    ? {}
    : (JSON.parse(bodyText) as Record<string, unknown>);
}

const emptyResults: CannedResponse = { status: 200, json: { results: [] } };

describe("TestProfileExport", () => {
  it("test_export_profiles_returns_iterator", () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: {
        results: [{ $distinct_id: "u1", $properties: {} }],
        session_id: null,
      },
    }));
    const result = client.exportProfiles();
    expect(typeof result[Symbol.asyncIterator]).toBe("function");
  });

  it("test_pagination_with_session_id", async () => {
    let callCount = 0;
    const { client } = createMockClient(makeSession(), () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          status: 200,
          json: { results: [{ $distinct_id: "u1" }], session_id: "abc123" },
        };
      }
      return { status: 200, json: { results: [], session_id: null } };
    });
    const profiles = await drain(client.exportProfiles());
    expect(profiles).toHaveLength(1);
    expect(callCount).toBe(2);
  });

  it("test_where_filter", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyResults;
    });
    await drain(
      client.exportProfiles({ where: 'properties["plan"] == "premium"' }),
    );
    expect(Object.hasOwn(capturedBody, "where")).toBe(true);
  });

  it("test_cohort_id_filter", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyResults;
    });
    await drain(client.exportProfiles({ cohort_id: "12345" }));
    // filter_by_cohort requires JSON object format {"id": cohort_id} —
    // note the Python json.dumps ": " separator.
    expect(capturedBody["filter_by_cohort"]).toBe('{"id": "12345"}');
  });

  it("test_output_properties_filter", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyResults;
    });
    await drain(
      client.exportProfiles({
        output_properties: ["$email", "$name", "plan"],
      }),
    );
    const outputProps = capturedBody["output_properties"];
    expect(outputProps).toBeDefined();
    expect(JSON.parse(outputProps as string)).toStrictEqual([
      "$email",
      "$name",
      "plan",
    ]);
  });

  it("test_cohort_id_and_output_properties_together", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyResults;
    });
    await drain(
      client.exportProfiles({
        cohort_id: "cohort_abc",
        output_properties: ["$email"],
      }),
    );
    expect(capturedBody["filter_by_cohort"]).toBe('{"id": "cohort_abc"}');
    expect(
      JSON.parse((capturedBody["output_properties"] as string) ?? "[]"),
    ).toStrictEqual(["$email"]);
  });

  it("test_no_cohort_id_when_none", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyResults;
    });
    await drain(client.exportProfiles());
    expect(Object.hasOwn(capturedBody, "filter_by_cohort")).toBe(false);
  });

  it("test_no_output_properties_when_none", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyResults;
    });
    await drain(client.exportProfiles());
    expect(Object.hasOwn(capturedBody, "output_properties")).toBe(false);
  });
});

describe("TestEngageParameterValidation", () => {
  it("test_distinct_id_distinct_ids_mutually_exclusive", async () => {
    const { client } = createMockClient(makeSession(), () => emptyResults);
    let caught: unknown;
    try {
      await drain(
        client.exportProfiles({
          distinct_id: "user_123",
          distinct_ids: ["user_456", "user_789"],
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    const message = (caught as Error).message.toLowerCase();
    expect(message).toContain("distinct_id");
    expect(message).toContain("mutually exclusive");
  });

  it("test_behaviors_cohort_id_mutually_exclusive", async () => {
    const { client } = createMockClient(makeSession(), () => emptyResults);
    let caught: unknown;
    try {
      await drain(
        client.exportProfiles({
          behaviors: [{ event: "Purchase", within: 30 }],
          cohort_id: "cohort_123",
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    const message = (caught as Error).message.toLowerCase();
    expect(message).toContain("behaviors");
    expect(message).toContain("cohort");
  });

  it("test_include_all_users_requires_cohort_id", async () => {
    const { client } = createMockClient(makeSession(), () => emptyResults);
    let caught: unknown;
    try {
      await drain(client.exportProfiles({ include_all_users: true }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    const message = (caught as Error).message.toLowerCase();
    expect(message).toContain("include_all_users");
    expect(message).toContain("cohort");
  });
});

describe("TestEngageParameterEdgeCases", () => {
  it("test_empty_distinct_ids_list_returns_empty", async () => {
    let callCount = 0;
    const { client } = createMockClient(makeSession(), () => {
      callCount += 1;
      return emptyResults;
    });
    const result = await drain(client.exportProfiles({ distinct_ids: [] }));
    expect(result).toStrictEqual([]);
    expect(callCount).toBe(0);
  });

  it("test_distinct_ids_deduplicates_input", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return { status: 200, json: { results: [], session_id: null } };
    });
    await drain(
      client.exportProfiles({
        distinct_ids: ["user_1", "user_2", "user_1", "user_3", "user_2"],
      }),
    );
    const sentIds = JSON.parse(
      (capturedBody["distinct_ids"] as string) ?? "[]",
    ) as string[];
    expect(sentIds).toHaveLength(3);
    expect(new Set(sentIds)).toStrictEqual(
      new Set(["user_1", "user_2", "user_3"]),
    );
  });

  it("test_invalid_behaviors_expression_raises_error", async () => {
    const { client } = createMockClient(makeSession(), () => emptyResults);
    let caught: unknown;
    try {
      await drain(
        client.exportProfiles({
          behaviors: "Purchase" as unknown as readonly unknown[],
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    expect((caught as Error).message.toLowerCase()).toContain("behaviors");
  });

  it("test_as_of_timestamp_in_future_raises_error", async () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 86400;
    const { client } = createMockClient(makeSession(), () => emptyResults);
    let caught: unknown;
    try {
      await drain(client.exportProfiles({ as_of_timestamp: futureTimestamp }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    const message = (caught as Error).message.toLowerCase();
    expect(message).toContain("as_of_timestamp");
    expect(message).toContain("future");
  });
});

describe("TestEngageDistinctIdParameter", () => {
  it("test_export_profiles_with_distinct_id", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return {
        status: 200,
        json: {
          results: [{ $distinct_id: "user_123", $properties: {} }],
          session_id: null,
        },
      };
    });
    const profiles = await drain(
      client.exportProfiles({ distinct_id: "user_123" }),
    );
    expect(capturedBody["distinct_id"]).toBe("user_123");
    expect(profiles).toHaveLength(1);
  });

  it("test_export_profiles_with_distinct_ids", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return {
        status: 200,
        json: {
          results: [
            { $distinct_id: "user_1", $properties: {} },
            { $distinct_id: "user_2", $properties: {} },
          ],
          session_id: null,
        },
      };
    });
    const profiles = await drain(
      client.exportProfiles({ distinct_ids: ["user_1", "user_2"] }),
    );
    const sentIds = JSON.parse(
      (capturedBody["distinct_ids"] as string) ?? "[]",
    ) as string[];
    expect(new Set(sentIds)).toStrictEqual(new Set(["user_1", "user_2"]));
    expect(profiles).toHaveLength(2);
  });

  it("test_distinct_ids_json_serialization", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return { status: 200, json: { results: [], session_id: null } };
    });
    await drain(
      client.exportProfiles({
        distinct_ids: ["id_with_special!@#", "normal"],
      }),
    );
    const rawValue = capturedBody["distinct_ids"];
    expect(rawValue).toBeDefined();
    const parsed = JSON.parse(rawValue as string) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed as string[]).toContain("id_with_special!@#");
  });
});

describe("TestEngageGroupIdParameter", () => {
  it("test_export_profiles_with_group_id", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return {
        status: 200,
        json: {
          results: [{ $distinct_id: "company_123", $properties: {} }],
          session_id: null,
        },
      };
    });
    const profiles = await drain(
      client.exportProfiles({ group_id: "companies" }),
    );
    expect(capturedBody["data_group_id"]).toBe("companies");
    expect(profiles).toHaveLength(1);
  });
});

describe("TestEngageBehaviorsParameter", () => {
  it("test_export_profiles_with_behaviors", async () => {
    let capturedBody: Record<string, unknown> = {};
    const behaviors = [
      { event: "Purchase", within: 30 },
      { event: "Page View", count: { gte: 5 } },
    ];
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return { status: 200, json: { results: [], session_id: null } };
    });
    await drain(client.exportProfiles({ behaviors }));
    const rawBehaviors = capturedBody["behaviors"];
    expect(rawBehaviors).toBeDefined();
    const parsed = JSON.parse(rawBehaviors as string) as Array<
      Record<string, unknown>
    >;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.["event"]).toBe("Purchase");
  });

  it("test_export_profiles_with_as_of_timestamp", async () => {
    let capturedBody: Record<string, unknown> = {};
    const timestamp = 1704067200; // 2024-01-01 00:00:00 UTC
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return { status: 200, json: { results: [], session_id: null } };
    });
    await drain(client.exportProfiles({ as_of_timestamp: timestamp }));
    expect(capturedBody["as_of_timestamp"]).toBe(timestamp);
  });
});

describe("TestEngageIncludeAllUsersParameter", () => {
  it("test_export_profiles_include_all_users_with_cohort", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return { status: 200, json: { results: [], session_id: null } };
    });
    await drain(
      client.exportProfiles({
        cohort_id: "cohort_123",
        include_all_users: true,
      }),
    );
    expect(capturedBody["filter_by_cohort"]).toBe('{"id": "cohort_123"}');
    expect(capturedBody["include_all_users"]).toBe(true);
  });

  it("test_export_profiles_include_all_users_false_sent_with_cohort", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return { status: 200, json: { results: [], session_id: null } };
    });
    await drain(
      client.exportProfiles({
        cohort_id: "cohort_123",
        include_all_users: false,
      }),
    );
    expect(capturedBody["filter_by_cohort"]).toBe('{"id": "cohort_123"}');
    expect(capturedBody["include_all_users"]).toBe(false);
  });

  it("test_export_profiles_include_all_users_not_sent_without_cohort", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return { status: 200, json: { results: [], session_id: null } };
    });
    await drain(client.exportProfiles());
    expect(Object.hasOwn(capturedBody, "include_all_users")).toBe(false);
  });
});

describe("TestExportProfilesPage", () => {
  it("test_first_page_without_session_id", async () => {
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

  it("test_subsequent_page_with_session_id", async () => {
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

  it("test_last_page_no_more_results", async () => {
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

  it("test_with_filter_parameters", async () => {
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

  it("test_with_cohort_id", async () => {
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

  it("test_with_behaviors", async () => {
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

  it("test_result_type", async () => {
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

  it("test_has_more_true_when_session_id_present", async () => {
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

  it("test_has_more_false_when_no_session_id", async () => {
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

  it("test_empty_results_with_no_session", async () => {
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

describe("TestExportProfilesPagePagination", () => {
  it("test_extracts_total_from_response", async () => {
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

  it("test_extracts_page_size_from_response", async () => {
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

  it("test_defaults_total_to_zero_when_missing", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: { results: [], session_id: null, page_size: 1000 },
    }));
    const result = await client.exportProfilesPage(0);
    expect(result.total).toBe(0);
  });

  it("test_defaults_page_size_to_1000_when_missing", async () => {
    const { client } = createMockClient(makeSession(), () => ({
      status: 200,
      json: { results: [], session_id: null, total: 0 },
    }));
    const result = await client.exportProfilesPage(0);
    expect(result.page_size).toBe(1000);
  });

  it("test_num_pages_computed_correctly", async () => {
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

describe("TestCodedExportProfilesCodes", () => {
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

  it("test_ac2_single_ids_raise_coded_error", async () => {
    await expectCode(
      () =>
        makeClient().exportProfiles({
          distinct_id: "u1",
          distinct_ids: ["u2"],
        }),
      "AC2_DISTINCT_ID_CONFLICT",
    );
  });

  it("test_ac2_many_ids_raise_coded_error", async () => {
    await expectCode(
      () =>
        makeClient().exportProfiles({
          distinct_id: "u1",
          distinct_ids: ["u2", "u3", "u4"],
        }),
      "AC2_DISTINCT_ID_CONFLICT",
    );
  });

  it("test_ac3_behaviors_with_cohort_raise_coded_error", async () => {
    await expectCode(
      () =>
        makeClient().exportProfiles({
          behaviors: [{ event: "Purchase" }],
          cohort_id: "c1",
        }),
      "AC3_BEHAVIORS_COHORT_CONFLICT",
    );
  });

  it("test_ac3_empty_behaviors_with_cohort_raise_coded_error", async () => {
    await expectCode(
      () => makeClient().exportProfiles({ behaviors: [], cohort_id: "c1" }),
      "AC3_BEHAVIORS_COHORT_CONFLICT",
    );
  });

  it("test_ac4_include_all_users_alone_raises_coded_error", async () => {
    await expectCode(
      () => makeClient().exportProfiles({ include_all_users: true }),
      "AC4_INCLUDE_ALL_USERS_REQUIRES_COHORT",
    );
  });

  it("test_ac4_include_all_users_with_where_raises_coded_error", async () => {
    await expectCode(
      () =>
        makeClient().exportProfiles({
          include_all_users: true,
          where: 'properties["plan"] == "premium"',
        }),
      "AC4_INCLUDE_ALL_USERS_REQUIRES_COHORT",
    );
  });

  it("test_ac5_behaviors_string_raises_coded_error", async () => {
    await expectCode(
      () =>
        makeClient().exportProfiles({
          behaviors: "not-a-list" as unknown as readonly unknown[],
        }),
      "AC5_BEHAVIORS_NOT_LIST",
    );
  });

  it("test_ac5_behaviors_dict_raises_coded_error", async () => {
    await expectCode(
      () =>
        makeClient().exportProfiles({
          behaviors: { event: "P" } as unknown as readonly unknown[],
        }),
      "AC5_BEHAVIORS_NOT_LIST",
    );
  });

  it("test_ac6_near_future_timestamp_raises_coded_error", async () => {
    await expectCode(
      () =>
        makeClient().exportProfiles({
          as_of_timestamp: Math.floor(Date.now() / 1000) + 10_000,
        }),
      "AC6_AS_OF_TIMESTAMP_FUTURE",
    );
  });

  it("test_ac6_far_future_timestamp_raises_coded_error", async () => {
    await expectCode(
      () =>
        makeClient().exportProfiles({
          as_of_timestamp: Math.floor(Date.now() / 1000) + 10_000_000,
        }),
      "AC6_AS_OF_TIMESTAMP_FUTURE",
    );
  });

  it("test_ac_guards_stay_catchable_as_value_error", async () => {
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

describe("TestExportProfilesPageNewParams", () => {
  const emptyPage: CannedResponse = {
    status: 200,
    json: { results: [], session_id: null, total: 0, page_size: 1000 },
  };

  it("test_sort_key_parameter", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0, { sort_key: "$last_seen" });
    expect(capturedBody["sort_key"]).toBe("$last_seen");
  });

  it("test_sort_key_omitted_when_none", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0);
    expect(Object.hasOwn(capturedBody, "sort_key")).toBe(false);
  });

  it("test_sort_order_parameter", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0, { sort_order: "descending" });
    expect(capturedBody["sort_order"]).toBe("descending");
  });

  it("test_sort_order_omitted_when_none", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0);
    expect(Object.hasOwn(capturedBody, "sort_order")).toBe(false);
  });

  it("test_search_parameter", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0, { search: "alice@example.com" });
    expect(capturedBody["search"]).toBe("alice@example.com");
  });

  it("test_search_omitted_when_none", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0);
    expect(Object.hasOwn(capturedBody, "search")).toBe(false);
  });

  it("test_limit_parameter", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0, { limit: 50 });
    expect(capturedBody["limit"]).toBe(50);
  });

  it("test_limit_omitted_when_none", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0);
    expect(Object.hasOwn(capturedBody, "limit")).toBe(false);
  });

  it("test_sort_key_and_sort_order_combined", async () => {
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

  it("test_all_new_params_combined", async () => {
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

  it("test_new_params_coexist_with_existing_params", async () => {
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

describe("TestExportProfilesPageFilterByCohort", () => {
  const emptyPage: CannedResponse = {
    status: 200,
    json: { results: [], session_id: null, total: 0, page_size: 1000 },
  };

  it("test_filter_by_cohort_id_format", async () => {
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

  it("test_filter_by_cohort_raw_cohort_format", async () => {
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

  it("test_filter_by_cohort_omitted_when_none", async () => {
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyPage;
    });
    await client.exportProfilesPage(0);
    expect(Object.hasOwn(capturedBody, "filter_by_cohort")).toBe(false);
  });

  it("test_filter_by_cohort_does_not_conflict_with_cohort_id", async () => {
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

  it("test_filter_by_cohort_passthrough_preserves_json", async () => {
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
