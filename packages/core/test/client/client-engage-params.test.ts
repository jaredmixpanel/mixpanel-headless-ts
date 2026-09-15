// `exportProfiles` parameter handling: session_id pagination, where /
// cohort / output_properties / distinct_id(s) / group_id / behaviors /
// as_of_timestamp / include_all_users, mutual-exclusion guards and edge
// cases. Mirrors TestProfileExport and the TestEngage*Parameter* classes of
// tests/unit/test_api_client.py; `pytest.raises(ValueError)` is ParamValidationError here.

import { describe, expect, it } from "vitest";

import { ParamValidationError } from "../../src/errors.js";
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

describe("Profile export", () => {
  // python: TestProfileExport
  it("export profiles returns iterator", () => {
    // python: test_export_profiles_returns_iterator
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

  it("pagination with session ID", async () => {
    // python: test_pagination_with_session_id
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

  it("where filter", async () => {
    // python: test_where_filter
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

  it("cohort ID filter", async () => {
    // python: test_cohort_id_filter
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

  it("output properties filter", async () => {
    // python: test_output_properties_filter
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

  it("cohort ID and output properties together", async () => {
    // python: test_cohort_id_and_output_properties_together
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
      JSON.parse(
        (capturedBody["output_properties"] as string | undefined) ?? "[]",
      ),
    ).toStrictEqual(["$email"]);
  });

  it("no cohort ID when null", async () => {
    // python: test_no_cohort_id_when_none
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyResults;
    });
    await drain(client.exportProfiles());
    expect(Object.hasOwn(capturedBody, "filter_by_cohort")).toBe(false);
  });

  it("no output properties when null", async () => {
    // python: test_no_output_properties_when_none
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return emptyResults;
    });
    await drain(client.exportProfiles());
    expect(Object.hasOwn(capturedBody, "output_properties")).toBe(false);
  });
});

describe("Engage parameter validation", () => {
  // python: TestEngageParameterValidation
  it("distinct ID distinct IDs mutually exclusive", async () => {
    // python: test_distinct_id_distinct_ids_mutually_exclusive
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

  it("behaviors cohort ID mutually exclusive", async () => {
    // python: test_behaviors_cohort_id_mutually_exclusive
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

  it("include all users requires cohort ID", async () => {
    // python: test_include_all_users_requires_cohort_id
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

describe("Engage parameter edge cases", () => {
  // python: TestEngageParameterEdgeCases
  it("empty distinct IDs list returns empty", async () => {
    // python: test_empty_distinct_ids_list_returns_empty
    let callCount = 0;
    const { client } = createMockClient(makeSession(), () => {
      callCount += 1;
      return emptyResults;
    });
    const result = await drain(client.exportProfiles({ distinct_ids: [] }));
    expect(result).toStrictEqual([]);
    expect(callCount).toBe(0);
  });

  it("distinct IDs deduplicates input", async () => {
    // python: test_distinct_ids_deduplicates_input
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
      (capturedBody["distinct_ids"] as string | undefined) ?? "[]",
    ) as string[];
    expect(sentIds).toHaveLength(3);
    expect(new Set(sentIds)).toStrictEqual(
      new Set(["user_1", "user_2", "user_3"]),
    );
  });

  it("invalid behaviors expression raises error", async () => {
    // python: test_invalid_behaviors_expression_raises_error
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

  it("as of timestamp in future raises error", async () => {
    // python: test_as_of_timestamp_in_future_raises_error
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

describe("Engage distinct ID parameter", () => {
  // python: TestEngageDistinctIdParameter
  it("export profiles with distinct ID", async () => {
    // python: test_export_profiles_with_distinct_id
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

  it("export profiles with distinct IDs", async () => {
    // python: test_export_profiles_with_distinct_ids
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
      (capturedBody["distinct_ids"] as string | undefined) ?? "[]",
    ) as string[];
    expect(new Set(sentIds)).toStrictEqual(new Set(["user_1", "user_2"]));
    expect(profiles).toHaveLength(2);
  });

  it("distinct IDs JSON serialization", async () => {
    // python: test_distinct_ids_json_serialization
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

describe("Engage group ID parameter", () => {
  // python: TestEngageGroupIdParameter
  it("export profiles with group ID", async () => {
    // python: test_export_profiles_with_group_id
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

describe("Engage behaviors parameter", () => {
  // python: TestEngageBehaviorsParameter
  it("export profiles with behaviors", async () => {
    // python: test_export_profiles_with_behaviors
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

  it("export profiles with as of timestamp", async () => {
    // python: test_export_profiles_with_as_of_timestamp
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

describe("Engage include all users parameter", () => {
  // python: TestEngageIncludeAllUsersParameter
  it("export profiles include all users with cohort", async () => {
    // python: test_export_profiles_include_all_users_with_cohort
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

  it("export profiles include all users false sent with cohort", async () => {
    // python: test_export_profiles_include_all_users_false_sent_with_cohort
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

  it("export profiles include all users not sent without cohort", async () => {
    // python: test_export_profiles_include_all_users_not_sent_without_cohort
    let capturedBody: Record<string, unknown> = {};
    const { client } = createMockClient(makeSession(), (request) => {
      capturedBody = parseBody(request.bodyText);
      return { status: 200, json: { results: [], session_id: null } };
    });
    await drain(client.exportProfiles());
    expect(Object.hasOwn(capturedBody, "include_all_users")).toBe(false);
  });
});
