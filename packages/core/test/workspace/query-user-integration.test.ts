// Translated query-user integration tests (B5-S2, packet §3):
// assertion-for-assertion port of
// tests/test_workspace_query_user_integration.py (R10.2) — ALL 11
// classes (TestBehavioralFilteringAllOf :182,
// TestBehavioralFilteringAnyOf :275,
// TestBehavioralFilteringSavedCohort :359,
// TestBehavioralFilteringCombinedCohortAndWhere :428,
// TestBehavioralFilteringCohortPlusInCohortError :519,
// TestBehavioralFilteringCohortSerializationError :591,
// TestCrossEngineDistinctIds :652,
// TestCrossEngineDataFrameComposition :752,
// TestCrossEngineFilterConsistency :895,
// TestCrossEngineCohortIdFromFunnel :1010,
// TestUFilterWrapPreservation :1116).
//
// Translation notes:
// - `export_profiles_page.call_args.kwargs.get(k)` becomes the recorded
//   options bag (`mock.exportPageCalls[0].options[k]`).
// - `patch.object(CohortDefinition, "to_dict", side_effect=...)` becomes
//   a per-instance `toDict` override (the same observable: the U24
//   validator's call raises).
// - `TestCrossEngineDataFrameComposition` asserts PANDAS operations
//   (`groupby`, `describe`, `merge`, boolean indexing,
//   `isinstance(df, pd.DataFrame)`). There is no pandas in TS
//   (phase2-design C6: `.df` becomes `toRows()` + `rowColumns()`), so
//   each case is translated to the equivalent computation over the row
//   list — the SAME numbers, asserted on the data the frame would be
//   built from. `test_df_is_pandas_dataframe` becomes an assertion that
//   `toRows()` is an array (the frame body); the pandas type check
//   itself is a header-cited exclusion.
// - `assert isinstance(excinfo.value.__cause__, ParamValidationError)`
//   maps to the `cause` property the facade sets on the wrap (Python's
//   `raise ... from exc`).

import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
import {
  BookmarkValidationError,
  ParamValidationError,
} from "../../src/errors.js";
import {
  RuntimeError as PyRuntimeError,
  ValueError as PyValueError,
} from "../../src/query/python-builtins.js";
import { Filter } from "../../src/types/query-params/filter.js";
import {
  CohortCriteria,
  CohortDefinition,
} from "../../src/types/query-params/cohort.js";
import { UserQueryResult } from "../../src/types/results/query-engine.js";
import type { ProfilePageResult } from "../../src/types/results/discovery.js";
import {
  makePageResult,
  makeRawProfile,
  mockWorkspaceClient,
  TEST_SESSION,
  type MockWorkspaceClient,
} from "../../test-support/workspace-test-helpers.js";

/**
 * The `workspace_factory` fixture (test file :141-168).
 *
 * @param mock - The stub client.
 * @returns The facade under test.
 */
function workspaceFactory(mock: MockWorkspaceClient): Workspace {
  return new Workspace({ session: TEST_SESSION, client: mock.client });
}

/**
 * Install a fixed page result.
 *
 * @param mock - The stub client.
 * @param result - The page result every call returns.
 */
function returnValue(
  mock: MockWorkspaceClient,
  result: ProfilePageResult,
): void {
  mock.setPageHandler(() => result);
}

/** Read the collected `BookmarkValidationError` codes. */
function codesOf(exc: unknown): string[] {
  return (exc as BookmarkValidationError).errors.map((e) => e.code);
}

/** Parse the recorded `filter_by_cohort` JSON text. */
function parseCohortParam(mock: MockWorkspaceClient): Record<string, unknown> {
  const raw = mock.exportPageCalls[0]!.options["filter_by_cohort"];
  return JSON.parse(raw as string) as Record<string, unknown>;
}

// Mock data (test file :117-131)
const RAW_PROFILE_PREMIUM = makeRawProfile("user_001", undefined, {
  plan: "premium",
  email: "alice@example.com",
  revenue: 150.0,
});
const RAW_PROFILE_FREE = makeRawProfile("user_002", undefined, {
  plan: "free",
  email: "bob@example.com",
  revenue: 0.0,
});
const RAW_PROFILE_ENTERPRISE = makeRawProfile("user_003", undefined, {
  plan: "enterprise",
  email: "carol@example.com",
  revenue: 500.0,
});
const RAW_PROFILE_PREMIUM_2 = makeRawProfile("user_004", undefined, {
  plan: "premium",
  email: "dave@example.com",
  revenue: 200.0,
});

// ===========================================================================
// T020: behavioural filtering — all_of
// ===========================================================================

describe("TestBehavioralFilteringAllOf", () => {
  it("all_of(did_event) sets filter_by_cohort with raw_cohort", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_PREMIUM], { total: 1 }));
    const cohort = CohortDefinition.allOf(
      CohortCriteria.didEvent("Purchase", { at_least: 3, within_days: 30 }),
    );

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      cohort,
      limit: 1,
    });

    expect(
      mock.exportPageCalls[0]!.options["filter_by_cohort"] ?? null,
    ).not.toBeNull();
    const fbc = parseCohortParam(mock);
    expect(Object.hasOwn(fbc, "raw_cohort")).toBe(true);
    const rawCohort = fbc["raw_cohort"] as Record<string, unknown>;
    expect(Object.hasOwn(rawCohort, "selector")).toBe(true);
    expect(Object.hasOwn(rawCohort, "behaviors")).toBe(true);
  });

  it("the raw_cohort behaviors reference the event name", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_PREMIUM], { total: 1 }));
    const cohort = CohortDefinition.allOf(
      CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 7 }),
    );

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      cohort,
      limit: 1,
    });

    const fbc = parseCohortParam(mock);
    const rawCohort = fbc["raw_cohort"] as Record<string, unknown>;
    const behaviors = rawCohort["behaviors"] as Record<
      string,
      Record<string, unknown>
    >;
    // Structure: behaviors.bhvr_N.count.event_selector.event
    const behaviorEvents = Object.values(behaviors).map((b) => {
      const count = (b["count"] ?? {}) as Record<string, unknown>;
      const sel = (count["event_selector"] ?? {}) as Record<string, unknown>;
      return sel["event"];
    });
    expect(behaviorEvents).toContain("Purchase");
  });

  it("all_of produces a selector with the AND operator", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_PREMIUM], { total: 1 }));
    const cohort = CohortDefinition.allOf(
      CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 7 }),
      CohortCriteria.hasProperty("plan", "premium"),
    );

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      cohort,
      limit: 1,
    });

    const fbc = parseCohortParam(mock);
    const rawCohort = fbc["raw_cohort"] as Record<string, unknown>;
    const selector = rawCohort["selector"] as Record<string, unknown>;
    expect(selector["operator"]).toBe("and");
  });
});

// ===========================================================================
// T020: behavioural filtering — any_of
// ===========================================================================

describe("TestBehavioralFilteringAnyOf", () => {
  it("any_of produces a selector with the OR operator", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([RAW_PROFILE_PREMIUM, RAW_PROFILE_FREE], { total: 2 }),
    );
    const cohort = CohortDefinition.anyOf(
      CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
      CohortCriteria.hasProperty("plan", "premium"),
    );

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      cohort,
      limit: 2,
    });

    const fbc = parseCohortParam(mock);
    const rawCohort = fbc["raw_cohort"] as Record<string, unknown>;
    const selector = rawCohort["selector"] as Record<string, unknown>;
    expect(selector["operator"]).toBe("or");
  });

  it("any_of has one selector child per criterion", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_PREMIUM], { total: 1 }));
    const cohort = CohortDefinition.anyOf(
      CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
      CohortCriteria.hasProperty("plan", "premium"),
    );

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      cohort,
      limit: 1,
    });

    const fbc = parseCohortParam(mock);
    const rawCohort = fbc["raw_cohort"] as Record<string, unknown>;
    const selector = rawCohort["selector"] as Record<string, unknown>;
    expect((selector["children"] as unknown[]).length).toBe(2);
  });

  it("any_of uses raw_cohort, not id", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_PREMIUM], { total: 1 }));
    const cohort = CohortDefinition.anyOf(
      CohortCriteria.didEvent("Signup", { at_least: 1, within_days: 7 }),
    );

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      cohort,
      limit: 1,
    });

    const fbc = parseCohortParam(mock);
    expect(Object.hasOwn(fbc, "raw_cohort")).toBe(true);
    expect(Object.hasOwn(fbc, "id")).toBe(false);
  });
});

// ===========================================================================
// T020: behavioural filtering — saved cohort
// ===========================================================================

describe("TestBehavioralFilteringSavedCohort", () => {
  it("an integer cohort sets filter_by_cohort with id", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_PREMIUM], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      cohort: 12345,
      limit: 1,
    });

    expect(
      mock.exportPageCalls[0]!.options["filter_by_cohort"] ?? null,
    ).not.toBeNull();
    expect(parseCohortParam(mock)).toEqual({ id: 12345 });
  });

  it("an integer cohort has no raw_cohort key", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_PREMIUM], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      cohort: 99999,
      limit: 1,
    });

    expect(Object.hasOwn(parseCohortParam(mock), "raw_cohort")).toBe(false);
  });

  it("a cohort makes include_all_users part of the call", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_PREMIUM], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      cohort: 12345,
      limit: 1,
    });

    expect(
      Object.hasOwn(mock.exportPageCalls[0]!.options, "include_all_users"),
    ).toBe(true);
  });
});

// ===========================================================================
// T020: combined cohort + where
// ===========================================================================

describe("TestBehavioralFilteringCombinedCohortAndWhere", () => {
  it("cohort + where filter sends both", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_PREMIUM], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      cohort: 12345,
      where: Filter.equals("plan", "premium", { resource_type: "people" }),
      limit: 1,
    });

    const options = mock.exportPageCalls[0]!.options;
    expect(options["filter_by_cohort"] ?? null).not.toBeNull();
    expect(options["where"] ?? null).not.toBeNull();
  });

  it("CohortDefinition + where filter sends raw_cohort and where", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_PREMIUM], { total: 1 }));
    const cohort = CohortDefinition.allOf(
      CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
    );

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      cohort,
      where: Filter.equals("plan", "premium", { resource_type: "people" }),
      limit: 1,
    });

    expect(Object.hasOwn(parseCohortParam(mock), "raw_cohort")).toBe(true);
    expect(mock.exportPageCalls[0]!.options["where"] ?? null).not.toBeNull();
  });

  it("cohort + multiple where filters sends both", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_PREMIUM], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      cohort: 12345,
      where: [
        Filter.equals("plan", "premium", { resource_type: "people" }),
        Filter.greaterThan("revenue", 100, { resource_type: "people" }),
      ],
      limit: 1,
    });

    const options = mock.exportPageCalls[0]!.options;
    expect(options["filter_by_cohort"] ?? null).not.toBeNull();
    expect(options["where"] ?? null).not.toBeNull();
  });
});

// ===========================================================================
// T020: cohort + in_cohort -> U2
// ===========================================================================

describe("TestBehavioralFilteringCohortPlusInCohortError", () => {
  it("cohort param + Filter.in_cohort raises U2", async () => {
    const ws = workspaceFactory(mockWorkspaceClient());
    try {
      await ws.queryUser({
        mode: "profiles",
        cohort: 12345,
        where: Filter.inCohort(67890),
        limit: 1,
      });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U2");
    }
  });

  it("CohortDefinition + Filter.in_cohort raises U2", async () => {
    const cohort = CohortDefinition.allOf(
      CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
    );
    const ws = workspaceFactory(mockWorkspaceClient());
    try {
      await ws.queryUser({
        mode: "profiles",
        cohort,
        where: Filter.inCohort(67890),
        limit: 1,
      });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U2");
    }
  });

  it("the U2 message mentions mutual exclusivity", async () => {
    const ws = workspaceFactory(mockWorkspaceClient());
    try {
      await ws.queryUser({
        mode: "profiles",
        cohort: 12345,
        where: Filter.inCohort(67890),
        limit: 1,
      });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      const u2 = (exc as BookmarkValidationError).errors.filter(
        (e) => e.code === "U2",
      );
      expect(u2.length).toBe(1);
      expect(u2[0]!.message.toLowerCase()).toContain("mutually exclusive");
    }
  });
});

// ===========================================================================
// T020: cohort serialization failure -> U24
// ===========================================================================

describe("TestBehavioralFilteringCohortSerializationError", () => {
  it("a to_dict failure produces U24", async () => {
    const brokenCohort = CohortDefinition.allOf(
      CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
    );
    // `patch.object(CohortDefinition, "to_dict", side_effect=...)`
    (brokenCohort as unknown as { toDict: () => never }).toDict = (): never => {
      throw new PyRuntimeError("serialization failed");
    };

    const ws = workspaceFactory(mockWorkspaceClient());
    try {
      await ws.queryUser({ mode: "profiles", cohort: brokenCohort, limit: 1 });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toContain("U24");
    }
  });

  it("the U24 message includes the underlying exception text", async () => {
    const brokenCohort = CohortDefinition.allOf(
      CohortCriteria.didEvent("Signup", { at_least: 1, within_days: 7 }),
    );
    (brokenCohort as unknown as { toDict: () => never }).toDict = (): never => {
      throw new PyValueError("bad selector node");
    };

    const ws = workspaceFactory(mockWorkspaceClient());
    try {
      await ws.queryUser({ mode: "profiles", cohort: brokenCohort, limit: 1 });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      const u24 = (exc as BookmarkValidationError).errors.filter(
        (e) => e.code === "U24",
      );
      expect(u24.length).toBe(1);
      expect(u24[0]!.message).toContain("bad selector node");
    }
  });
});

// ===========================================================================
// T024: cross-engine distinct_ids
// ===========================================================================

describe("TestCrossEngineDistinctIds", () => {
  it("distinct_ids is a list of strings", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult(
        [RAW_PROFILE_PREMIUM, RAW_PROFILE_FREE, RAW_PROFILE_ENTERPRISE],
        { total: 3, has_more: false },
      ),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      limit: 3,
    });

    const ids = result.distinct_ids;
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.every((i) => typeof i === "string")).toBe(true);
    expect(ids).toEqual(["user_001", "user_002", "user_003"]);
  });

  it("distinct_ids can drive a subsequent query", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([RAW_PROFILE_PREMIUM, RAW_PROFILE_ENTERPRISE], {
        total: 2,
        has_more: false,
      }),
    );

    const ws = workspaceFactory(mock);
    const result1 = await ws.queryUser({ mode: "profiles", limit: 2 });
    const ids = result1.distinct_ids;

    const result2 = await ws.queryUser({
      mode: "profiles",
      distinct_ids: ids,
      limit: 100_000,
    });

    expect(result2.profiles.length).toBe(2);
    expect(result2.distinct_ids).toEqual(ids);
  });

  it("an empty result yields an empty distinct_ids list", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([], { total: 0, has_more: false, session_id: null }),
    );

    const result = await workspaceFactory(mock).queryUser({ mode: "profiles" });

    expect(result.distinct_ids).toEqual([]);
    expect(Array.isArray(result.distinct_ids)).toBe(true);
  });

  it("distinct_ids length matches the profile count", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([RAW_PROFILE_PREMIUM, RAW_PROFILE_FREE], {
        total: 100,
        has_more: true,
      }),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      limit: 2,
    });

    expect(result.distinct_ids.length).toBe(result.profiles.length);
  });
});

// ===========================================================================
// T024: frame composition (pandas ops -> row-list equivalents)
// ===========================================================================

describe("TestCrossEngineDataFrameComposition", () => {
  it("rows can be grouped by a property column", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult(
        [
          RAW_PROFILE_PREMIUM,
          RAW_PROFILE_FREE,
          RAW_PROFILE_ENTERPRISE,
          RAW_PROFILE_PREMIUM_2,
        ],
        { total: 4, has_more: false },
      ),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      limit: 4,
    });

    // `df.groupby("plan").size()`
    const grouped = new Map<unknown, number>();
    for (const row of result.toRows()) {
      grouped.set(row["plan"], (grouped.get(row["plan"]) ?? 0) + 1);
    }
    expect(grouped.get("premium")).toBe(2);
    expect(grouped.get("free")).toBe(1);
    expect(grouped.get("enterprise")).toBe(1);
  });

  it("numeric columns support a describe()-style summary", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult(
        [RAW_PROFILE_PREMIUM, RAW_PROFILE_FREE, RAW_PROFILE_ENTERPRISE],
        { total: 3, has_more: false },
      ),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      limit: 3,
    });

    // `df["revenue"].describe()` — count / min / max
    const revenues = result.toRows().map((r) => r["revenue"] as number);
    expect(revenues.length).toBe(3);
    expect(Math.min(...revenues)).toBe(0.0);
    expect(Math.max(...revenues)).toBe(500.0);
  });

  it("rows merge with external data on distinct_id", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([RAW_PROFILE_PREMIUM, RAW_PROFILE_FREE], {
        total: 2,
        has_more: false,
      }),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      limit: 2,
    });

    // Simulate external data (e.g. from a funnel result)
    const externalRows = [
      { distinct_id: "user_001", converted: true },
      { distinct_id: "user_002", converted: false },
    ];
    const externalById = new Map(
      externalRows.map((r) => [r.distinct_id, r.converted]),
    );
    const merged: Array<Record<string, unknown>> = result
      .toRows()
      .filter((r) => externalById.has(r["distinct_id"] as string))
      .map((r) => ({
        ...r,
        converted: externalById.get(r["distinct_id"] as string),
      }));

    expect(merged.length).toBe(2);
    expect(Object.hasOwn(merged[0]!, "converted")).toBe(true);
    expect(
      merged.find((r) => r["distinct_id"] === "user_001")!["converted"],
    ).toBe(true);
  });

  it("rows support boolean filtering", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult(
        [RAW_PROFILE_PREMIUM, RAW_PROFILE_FREE, RAW_PROFILE_ENTERPRISE],
        { total: 3, has_more: false },
      ),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      limit: 3,
    });

    const premiumUsers = result.toRows().filter((r) => r["plan"] === "premium");
    expect(premiumUsers.length).toBe(1);
    expect(premiumUsers[0]!["distinct_id"]).toBe("user_001");
  });

  it("toRows() returns the frame body (the pd.DataFrame twin)", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_PREMIUM], { total: 1 }));

    const result = await workspaceFactory(mock).queryUser({ mode: "profiles" });

    expect(Array.isArray(result.toRows())).toBe(true);
  });
});

// ===========================================================================
// T024: Filter consistency
// ===========================================================================

describe("TestCrossEngineFilterConsistency", () => {
  it("Filter.equals is accepted by query_user", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_PREMIUM], { total: 1 }));

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      where: Filter.equals("plan", "premium", { resource_type: "people" }),
      limit: 1,
    });

    expect(result).toBeInstanceOf(UserQueryResult);
    expect(result.profiles.length).toBe(1);
  });

  it("a Filter list is accepted by query_user", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_PREMIUM], { total: 1 }));

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      where: [
        Filter.equals("plan", "premium", { resource_type: "people" }),
        Filter.greaterThan("revenue", 100, { resource_type: "people" }),
      ],
      limit: 1,
    });

    expect(result).toBeInstanceOf(UserQueryResult);
  });

  it("Filter.equals is valid for build_user_params", async () => {
    const params = await workspaceFactory(
      mockWorkspaceClient(),
    ).buildUserParams({
      where: Filter.equals("plan", "premium", { resource_type: "people" }),
    });

    expect(typeof params).toBe("object");
    expect(Object.hasOwn(params, "where")).toBe(true);
  });

  it("a Filter list is valid for build_user_params", async () => {
    const params = await workspaceFactory(
      mockWorkspaceClient(),
    ).buildUserParams({
      where: [
        Filter.equals("plan", "premium", { resource_type: "people" }),
        Filter.greaterThan("revenue", 100, { resource_type: "people" }),
      ],
    });

    expect(typeof params).toBe("object");
    expect(Object.hasOwn(params, "where")).toBe(true);
  });

  it("Filters produce a where selector string in the API call", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_PREMIUM], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      where: Filter.equals("plan", "premium", { resource_type: "people" }),
      limit: 1,
    });

    const whereVal = mock.exportPageCalls[0]!.options["where"];
    expect(typeof whereVal).toBe("string");
    expect(whereVal as string).toContain("plan");
  });
});

// ===========================================================================
// T024: cohort ID from funnel analysis
// ===========================================================================

describe("TestCrossEngineCohortIdFromFunnel", () => {
  it("a funnel cohort id works with query_user", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([RAW_PROFILE_PREMIUM, RAW_PROFILE_FREE], {
        total: 2,
        has_more: false,
      }),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      cohort: 42,
      limit: 100_000,
    });

    expect(result).toBeInstanceOf(UserQueryResult);
    expect(result.profiles.length).toBe(2);
    expect(parseCohortParam(mock)).toEqual({ id: 42 });
  });

  it("the cohort-filtered result has composable distinct_ids", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([RAW_PROFILE_PREMIUM, RAW_PROFILE_ENTERPRISE], {
        total: 2,
        has_more: false,
      }),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      cohort: 42,
      limit: 100_000,
    });

    const ids = result.distinct_ids;
    expect(ids.length).toBe(2);
    expect(ids).toContain("user_001");
    expect(ids).toContain("user_003");
  });

  it("the cohort-filtered frame supports analysis", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([RAW_PROFILE_PREMIUM, RAW_PROFILE_ENTERPRISE], {
        total: 2,
        has_more: false,
      }),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      cohort: 42,
      limit: 100_000,
    });

    const rows = result.toRows();
    expect(rows.length).toBe(2);
    const totalRevenue = rows.reduce(
      (sum, r) => sum + (r["revenue"] as number),
      0,
    );
    expect(totalRevenue).toBe(650.0);
  });

  it("include_all_users defaults to false", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_PREMIUM], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      cohort: 42,
      limit: 1,
    });

    expect(mock.exportPageCalls[0]!.options["include_all_users"]).toBe(false);
  });
});

// ===========================================================================
// U_FILTER wrap preservation over converted ES* guards (RR-4)
// ===========================================================================

describe("TestUFilterWrapPreservation", () => {
  it("a converted ES11 raise surfaces as U_FILTER", async () => {
    const bad = new Filter({
      _property: "prop",
      _operator: "is between" as never,
      _value: ["low", 10] as never,
    });

    const ws = workspaceFactory(mockWorkspaceClient());
    try {
      await ws.buildUserParams({ where: [bad] });
      expect.unreachable("expected BookmarkValidationError");
    } catch (exc) {
      expect(codesOf(exc)).toEqual(["U_FILTER"]);
      // The chained cause is the converted coded guard error itself.
      const cause = (exc as { cause?: unknown }).cause;
      expect(cause).toBeInstanceOf(ParamValidationError);
      expect((cause as ParamValidationError).code).toBe(
        "ES11_BETWEEN_LOWER_NOT_NUMBER",
      );
    }
  });
});
