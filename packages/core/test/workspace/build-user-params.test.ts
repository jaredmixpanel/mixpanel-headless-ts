// Translated build_user_params tests (B5-S2, packet §3): assertion-for-
// assertion port of tests/test_workspace_build_user_params.py (R10.2) —
// ALL 13 classes (TestFilterTranslation :107, TestCohortRouting :226,
// TestPropertySelection :299, TestSortByTranslation :340,
// TestAsOfConversion :375, TestDistinctIdHandling :408,
// TestGroupIdTranslation :437, TestSearchPassthrough :456,
// TestRawStringWhere :472, TestValidationErrors :490,
// TestAggregateModeParams :607, TestModeSpecificValidation :686,
// TestCombinedScenarios :735).
//
// Translation notes:
// - `ws` / `workspace_factory` come from the shared
//   `workspace-test-helpers.ts`.
// - `calendar.timegm(date(Y, M, D).timetuple())` is midnight UTC of the
//   calendar date; the expected values are computed the same way in TS
//   (`Date.UTC(...) / 1000`), never parsed out of the produced param.
// - The Python `if isinstance(fbc, str): fbc = json.loads(fbc)`
//   defensive unwraps stay: the TS builder always emits the JSON TEXT
//   (`pythonJsonDumps`), so the parse branch is the one that runs.
// - `assert isinstance(params, dict)` becomes an object/non-null check.

import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
import { BookmarkValidationError } from "../../src/errors.js";
import { Filter } from "../../src/types/query-params/filter.js";
import {
  CohortCriteria,
  CohortDefinition,
  sanitizeRawCohort,
} from "../../src/types/query-params/cohort.js";
import { mockWorkspaceClient, TEST_SESSION } from "./workspace-test-helpers.js";

/**
 * The `ws` fixture (test file :95-102).
 *
 * @returns A default facade with a stub client.
 */
function makeWs(): Workspace {
  return new Workspace({
    session: TEST_SESSION,
    client: mockWorkspaceClient().client,
  });
}

/** Read the collected `BookmarkValidationError` codes. */
function codesOf(exc: unknown): string[] {
  return (exc as BookmarkValidationError).errors.map((e) => e.code);
}

/** Decode a param that may be JSON text (the Python `json.loads` arm). */
function decodeParam(value: unknown): unknown {
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}

/** `calendar.timegm(date(y, m, d).timetuple())` — midnight UTC. */
function timegm(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / 1000;
}

// ===========================================================================
// 1. Filter translation to the engage `where` param
// ===========================================================================

describe("TestFilterTranslation", () => {
  it("a single Filter.equals produces a selector string", async () => {
    const params = await makeWs().buildUserParams({
      where: Filter.equals("plan", "premium"),
    });
    expect(Object.hasOwn(params, "where")).toBe(true);
    expect(params["where"]).toContain('properties["plan"] == "premium"');
  });

  it("multiple filters are AND-combined", async () => {
    const params = await makeWs().buildUserParams({
      where: [Filter.equals("plan", "premium"), Filter.isSet("email")],
    });
    const where = params["where"] as string;
    expect(where).toContain('properties["plan"] == "premium"');
    expect(where).toContain('defined(properties["email"])');
    expect(where).toContain(" and ");
  });

  it("greater_than translates to > selector syntax", async () => {
    const params = await makeWs().buildUserParams({
      where: Filter.greaterThan("ltv", 100),
    });
    expect(params["where"]).toContain('properties["ltv"] > 100');
  });

  it("less_than translates to < selector syntax", async () => {
    const params = await makeWs().buildUserParams({
      where: Filter.lessThan("age", 30),
    });
    expect(params["where"]).toContain('properties["age"] < 30');
  });

  it("contains translates to 'in' selector syntax", async () => {
    const params = await makeWs().buildUserParams({
      where: Filter.contains("email", "corp"),
    });
    expect(params["where"]).toContain('"corp" in properties["email"]');
  });

  it("not_contains translates to 'not in' selector syntax", async () => {
    const params = await makeWs().buildUserParams({
      where: Filter.notContains("email", "gmail"),
    });
    expect(params["where"]).toContain('not "gmail" in properties["email"]');
  });

  it("between translates to >= and <= selector syntax", async () => {
    const params = await makeWs().buildUserParams({
      where: Filter.between("age", 18, 65),
    });
    const where = params["where"] as string;
    expect(where).toContain('properties["age"] >= 18');
    expect(where).toContain('properties["age"] <= 65');
  });

  it("is_set translates to defined()", async () => {
    const params = await makeWs().buildUserParams({
      where: Filter.isSet("email"),
    });
    expect(params["where"]).toContain('defined(properties["email"])');
  });

  it("is_not_set translates to not defined()", async () => {
    const params = await makeWs().buildUserParams({
      where: Filter.isNotSet("phone"),
    });
    expect(params["where"]).toContain('not defined(properties["phone"])');
  });

  it("is_true translates to == true", async () => {
    const params = await makeWs().buildUserParams({
      where: Filter.isTrue("active"),
    });
    expect(params["where"]).toContain('properties["active"] == true');
  });

  it("is_false translates to == false", async () => {
    const params = await makeWs().buildUserParams({
      where: Filter.isFalse("churned"),
    });
    expect(params["where"]).toContain('properties["churned"] == false');
  });

  it("multi-value equals produces an OR-chained selector", async () => {
    const params = await makeWs().buildUserParams({
      where: Filter.equals("plan", ["premium", "enterprise"]),
    });
    const where = params["where"] as string;
    expect(where).toContain('properties["plan"] == "premium"');
    expect(where).toContain('properties["plan"] == "enterprise"');
    expect(where).toContain(" or ");
  });

  it("no where omits the param", async () => {
    const params = await makeWs().buildUserParams();
    expect(
      !Object.hasOwn(params, "where") || params["where"] === null,
    ).toBe(true);
  });

  it("a single Filter (not wrapped in a list) is accepted", async () => {
    const params = await makeWs().buildUserParams({
      where: Filter.equals("plan", "premium"),
    });
    expect(params["where"]).toContain('properties["plan"] == "premium"');
  });
});

// ===========================================================================
// 2. Cohort routing
// ===========================================================================

describe("TestCohortRouting", () => {
  it("an integer cohort id routes to filter_by_cohort with 'id'", async () => {
    const params = await makeWs().buildUserParams({ cohort: 12345 });
    expect(Object.hasOwn(params, "filter_by_cohort")).toBe(true);
    const fbc = decodeParam(params["filter_by_cohort"]) as Record<
      string,
      unknown
    >;
    expect(fbc["id"]).toBe(12345);
  });

  it("a CohortDefinition routes to filter_by_cohort with 'raw_cohort'", async () => {
    const defn = CohortDefinition.allOf(
      CohortCriteria.hasProperty("plan", "premium"),
    );
    const params = await makeWs().buildUserParams({ cohort: defn });
    expect(Object.hasOwn(params, "filter_by_cohort")).toBe(true);
    const fbc = decodeParam(params["filter_by_cohort"]) as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(fbc, "raw_cohort")).toBe(true);
    expect(typeof fbc["raw_cohort"]).toBe("object");
  });

  it("the raw_cohort value matches the sanitized to_dict output", async () => {
    const defn = CohortDefinition.allOf(
      CohortCriteria.hasProperty("plan", "premium"),
      CohortCriteria.didEvent("Purchase", { at_least: 3, within_days: 30 }),
    );
    const expected = sanitizeRawCohort(defn.toDict());
    const params = await makeWs().buildUserParams({ cohort: defn });
    const fbc = decodeParam(params["filter_by_cohort"]) as Record<
      string,
      unknown
    >;
    expect(fbc["raw_cohort"]).toEqual(expected);
  });

  it("Filter.in_cohort in the where list extracts to filter_by_cohort", async () => {
    const params = await makeWs().buildUserParams({
      where: [Filter.inCohort(789), Filter.equals("plan", "premium")],
    });
    expect(Object.hasOwn(params, "filter_by_cohort")).toBe(true);
    const fbc = decodeParam(params["filter_by_cohort"]) as Record<
      string,
      unknown
    >;
    expect(fbc["id"]).toBe(789);
    // Remaining property filter stays in where
    expect(params["where"]).toContain('properties["plan"] == "premium"');
  });

  it("no cohort omits filter_by_cohort", async () => {
    const params = await makeWs().buildUserParams({
      where: Filter.equals("plan", "premium"),
    });
    expect(Object.hasOwn(params, "filter_by_cohort")).toBe(false);
  });
});

// ===========================================================================
// 3. Property selection -> output_properties
// ===========================================================================

describe("TestPropertySelection", () => {
  it("properties map to output_properties", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      properties: ["$email", "$name", "plan"],
    });
    expect(Object.hasOwn(params, "output_properties")).toBe(true);
    const output = decodeParam(params["output_properties"]) as string[];
    expect(output).toContain("$email");
    expect(output).toContain("$name");
    expect(output).toContain("plan");
  });

  it("no properties omits output_properties", async () => {
    const params = await makeWs().buildUserParams();
    expect(Object.hasOwn(params, "output_properties")).toBe(false);
  });

  it("dollar-prefixed names are passed through unchanged", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      properties: ["$email", "$last_seen"],
    });
    const output = decodeParam(params["output_properties"]) as string[];
    expect(output).toContain("$email");
    expect(output).toContain("$last_seen");
  });
});

// ===========================================================================
// 4. sort_by -> sort_key translation
// ===========================================================================

describe("TestSortByTranslation", () => {
  it("sort_by='ltv' translates to sort_key", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      sort_by: "ltv",
    });
    expect(Object.hasOwn(params, "sort_key")).toBe(true);
    expect(params["sort_key"]).toBe('properties["ltv"]');
  });

  it("a dollar prefix is preserved", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      sort_by: "$last_seen",
    });
    expect(params["sort_key"]).toBe('properties["$last_seen"]');
  });

  it("no sort_by omits sort_key", async () => {
    const params = await makeWs().buildUserParams();
    expect(Object.hasOwn(params, "sort_key")).toBe(false);
  });

  it("sort_order passes through", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      sort_by: "ltv",
      sort_order: "ascending",
    });
    expect(params["sort_order"]).toBe("ascending");
  });

  it("the default sort_order is descending", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      sort_by: "ltv",
    });
    expect(params["sort_order"]).toBe("descending");
  });
});

// ===========================================================================
// 5. as_of string -> Unix timestamp conversion
// ===========================================================================

describe("TestAsOfConversion", () => {
  it("as_of='2025-01-01' converts to midnight UTC", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      as_of: "2025-01-01",
    });
    expect(Object.hasOwn(params, "as_of_timestamp")).toBe(true);
    expect(params["as_of_timestamp"]).toBe(timegm(2025, 1, 1));
  });

  it("an integer as_of passes through", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      as_of: 1704067200,
    });
    expect(Object.hasOwn(params, "as_of_timestamp")).toBe(true);
    expect(params["as_of_timestamp"]).toBe(1704067200);
  });

  it("no as_of omits the timestamp", async () => {
    const params = await makeWs().buildUserParams();
    expect(Object.hasOwn(params, "as_of_timestamp")).toBe(false);
  });

  it("produces the correct epoch for 2024-06-15", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      as_of: "2024-06-15",
    });
    expect(params["as_of_timestamp"]).toBe(timegm(2024, 6, 15));
  });
});

// ===========================================================================
// 6. distinct_id / distinct_ids handling
// ===========================================================================

describe("TestDistinctIdHandling", () => {
  it("distinct_id passes through", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      distinct_id: "user_abc123",
    });
    expect(params["distinct_id"]).toBe("user_abc123");
  });

  it("distinct_ids passes through", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      distinct_ids: ["user_1", "user_2", "user_3"],
    });
    expect(decodeParam(params["distinct_ids"])).toEqual([
      "user_1",
      "user_2",
      "user_3",
    ]);
  });

  it("neither given omits both params", async () => {
    const params = await makeWs().buildUserParams();
    expect(Object.hasOwn(params, "distinct_id")).toBe(false);
    expect(Object.hasOwn(params, "distinct_ids")).toBe(false);
  });
});

// ===========================================================================
// 7. group_id -> data_group_id
// ===========================================================================

describe("TestGroupIdTranslation", () => {
  it("group_id maps to data_group_id", async () => {
    const params = await makeWs().buildUserParams({ group_id: "companies" });
    expect(Object.hasOwn(params, "data_group_id")).toBe(true);
    expect(params["data_group_id"]).toBe("companies");
  });

  it("no group_id omits data_group_id", async () => {
    const params = await makeWs().buildUserParams();
    expect(Object.hasOwn(params, "data_group_id")).toBe(false);
  });
});

// ===========================================================================
// 8. search passthrough
// ===========================================================================

describe("TestSearchPassthrough", () => {
  it("search passes through", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      search: "alice@example.com",
    });
    expect(params["search"]).toBe("alice@example.com");
  });

  it("no search omits the param", async () => {
    const params = await makeWs().buildUserParams();
    expect(Object.hasOwn(params, "search")).toBe(false);
  });
});

// ===========================================================================
// 9. Raw string where passthrough
// ===========================================================================

describe("TestRawStringWhere", () => {
  it("a raw selector string passes straight through", async () => {
    const raw = 'properties["plan"] == "premium" and properties["ltv"] > 100';
    const params = await makeWs().buildUserParams({ where: raw });
    expect(params["where"]).toBe(raw);
  });

  it("a raw string is not modified or re-translated", async () => {
    const raw = 'user["custom_field"] == "value"';
    const params = await makeWs().buildUserParams({ where: raw });
    expect(params["where"]).toBe(raw);
  });
});

// ===========================================================================
// 10. Validation errors
// ===========================================================================

describe("TestValidationErrors", () => {
  it("distinct_id + distinct_ids raises U1", async () => {
    try {
      await makeWs().buildUserParams({
        distinct_id: "user_1",
        distinct_ids: ["user_2"],
      });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U1");
    }
  });

  it("cohort + Filter.in_cohort raises U2", async () => {
    try {
      await makeWs().buildUserParams({
        cohort: 123,
        where: Filter.inCohort(456),
      });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U2");
    }
  });

  it("an empty sort_by raises U5", async () => {
    try {
      await makeWs().buildUserParams({ sort_by: "" });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U5");
    }
  });

  it("an invalid as_of date raises U6", async () => {
    try {
      await makeWs().buildUserParams({ as_of: "not-a-date" });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U6");
    }
  });

  it("include_all_users without a cohort raises U7", async () => {
    try {
      await makeWs().buildUserParams({ include_all_users: true });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U7");
    }
  });

  it("Filter.not_in_cohort in where raises U12", async () => {
    try {
      await makeWs().buildUserParams({ where: Filter.notInCohort(123) });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U12");
    }
  });

  it("multiple Filter.in_cohort entries raise U13", async () => {
    try {
      await makeWs().buildUserParams({
        where: [Filter.inCohort(100), Filter.inCohort(200)],
      });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U13");
    }
  });

  it("an empty distinct_ids list raises U4", async () => {
    try {
      await makeWs().buildUserParams({ distinct_ids: [] });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U4");
    }
  });

  it("multiple violations are collected into one error", async () => {
    try {
      await makeWs().buildUserParams({
        distinct_id: "user_1",
        distinct_ids: ["user_2"],
        sort_by: "",
        include_all_users: true,
      });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      const codes = codesOf(exc);
      expect(codes).toContain("U1");
      expect(codes).toContain("U5");
      expect(codes).toContain("U7");
    }
  });
});

// ===========================================================================
// Aggregate mode param construction
// ===========================================================================

describe("TestAggregateModeParams", () => {
  it("default count produces action='count()'", async () => {
    const params = await makeWs().buildUserParams({ mode: "aggregate" });
    expect(params["action"]).toBe("count()");
  });

  it("numeric_summary produces the correct action string", async () => {
    const params = await makeWs().buildUserParams({
      mode: "aggregate",
      aggregate: "numeric_summary",
      aggregate_property: "ltv",
    });
    expect(params["action"]).toBe('numeric_summary(properties["ltv"])');
  });

  it("extremes produces the correct action string", async () => {
    const params = await makeWs().buildUserParams({
      mode: "aggregate",
      aggregate: "extremes",
      aggregate_property: "revenue",
    });
    expect(params["action"]).toBe('extremes(properties["revenue"])');
  });

  it("percentile produces the correct action string", async () => {
    const params = await makeWs().buildUserParams({
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "age",
      percentile: 50,
    });
    expect(params["action"]).toBe('percentile(properties["age"], 50)');
  });

  it("a non-count aggregate without a property raises U14", async () => {
    try {
      await makeWs().buildUserParams({
        mode: "aggregate",
        aggregate: "extremes",
      });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U14");
    }
  });

  it("count with a property raises U15", async () => {
    try {
      await makeWs().buildUserParams({
        mode: "aggregate",
        aggregate: "count",
        aggregate_property: "ltv",
      });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U15");
    }
  });

  it("segment_by maps to segment_by_cohorts", async () => {
    const params = await makeWs().buildUserParams({
      mode: "aggregate",
      segment_by: [123, 456],
    });
    expect(Object.hasOwn(params, "segment_by_cohorts")).toBe(true);
  });

  it("segment_by with mode='profiles' raises U16", async () => {
    try {
      await makeWs().buildUserParams({ mode: "profiles", segment_by: [123] });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U16");
    }
  });
});

// ===========================================================================
// Mode-specific profile-only params
// ===========================================================================

describe("TestModeSpecificValidation", () => {
  it("sort_by with mode='aggregate' raises U19", async () => {
    try {
      await makeWs().buildUserParams({ mode: "aggregate", sort_by: "ltv" });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U19");
    }
  });

  it("search with mode='aggregate' raises U20", async () => {
    try {
      await makeWs().buildUserParams({ mode: "aggregate", search: "alice" });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U20");
    }
  });

  it("distinct_id with mode='aggregate' raises U21", async () => {
    try {
      await makeWs().buildUserParams({
        mode: "aggregate",
        distinct_id: "user_1",
      });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U21");
    }
  });

  it("properties with mode='aggregate' raises U22", async () => {
    try {
      await makeWs().buildUserParams({
        mode: "aggregate",
        properties: ["$email"],
      });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U22");
    }
  });
});

// ===========================================================================
// Combined param scenarios
// ===========================================================================

describe("TestCombinedScenarios", () => {
  it("a full profile query produces all expected params", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      where: [Filter.equals("plan", "premium"), Filter.greaterThan("ltv", 100)],
      properties: ["$email", "$name", "plan", "ltv"],
      sort_by: "ltv",
      sort_order: "descending",
      search: "alice",
    });

    expect(Object.hasOwn(params, "where")).toBe(true);
    expect(params["where"]).toContain('properties["plan"] == "premium"');
    expect(params["where"]).toContain('properties["ltv"] > 100');
    const output = decodeParam(params["output_properties"]) as string[];
    expect(output).toContain("$email");
    expect(params["sort_key"]).toBe('properties["ltv"]');
    expect(params["sort_order"]).toBe("descending");
    expect(params["search"]).toBe("alice");
  });

  it("cohort plus property where filters both appear", async () => {
    const params = await makeWs().buildUserParams({
      cohort: 12345,
      where: Filter.equals("plan", "premium"),
    });
    expect(Object.hasOwn(params, "filter_by_cohort")).toBe(true);
    expect(params["where"]).toContain('properties["plan"] == "premium"');
  });

  it("include_all_users with a cohort does not raise", async () => {
    const params = await makeWs().buildUserParams({
      cohort: 12345,
      include_all_users: true,
    });
    expect(Object.hasOwn(params, "filter_by_cohort")).toBe(true);
  });

  it("group_id with filters produces the correct params", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      group_id: "companies",
      where: Filter.greaterThan("arr", 50000),
      sort_by: "arr",
      sort_order: "descending",
    });
    expect(params["data_group_id"]).toBe("companies");
    expect(params["where"]).toContain('properties["arr"] > 50000');
    expect(params["sort_key"]).toBe('properties["arr"]');
  });

  it("as_of with distinct_id produces both params", async () => {
    const params = await makeWs().buildUserParams({
      mode: "profiles",
      as_of: "2025-01-01",
      distinct_id: "user_123",
    });
    expect(Object.hasOwn(params, "as_of_timestamp")).toBe(true);
    expect(params["distinct_id"]).toBe("user_123");
  });

  it("valid parameter combinations complete without raising", async () => {
    await makeWs().buildUserParams({
      mode: "profiles",
      where: Filter.equals("plan", "premium"),
      properties: ["$email"],
      sort_by: "ltv",
      sort_order: "ascending",
    });
  });

  it("an empty call returns a dict", async () => {
    const params = await makeWs().buildUserParams();
    expect(typeof params).toBe("object");
    expect(params).not.toBeNull();
  });
});
