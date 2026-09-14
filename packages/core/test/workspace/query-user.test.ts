// Translated query_user tests (B5-S2, packet §3): assertion-for-
// assertion port of tests/test_workspace_query_user.py (R10.2) — ALL 18
// classes (TestQueryUserDefaultLimit :164, TestQueryUserExplicitLimit
// :237, TestQueryUserPropertySelection :367, TestQueryUserSorting :417,
// TestQueryUserSearch :526, TestQueryUserDistinctId :575,
// TestQueryUserDistinctIds :608, TestQueryUserGroupId :644,
// TestQueryUserAsOf :674, TestQueryUserTotalCount :726,
// TestQueryUserDataFrame :798, TestQueryUserEmptyResult :926,
// TestQueryUserConfigError :1002, TestQueryUserResultMetadata :1034,
// TestQueryUserProfileNormalization :1158,
// TestQueryUserPaginationSessionId :1252,
// TestQueryUserValueErrorWrapping :1335,
// TestQueryUserAggregatePropertyEscaping :1355).
//
// Translation notes:
// - `export_profiles_page.call_args.kwargs.get(k)` becomes the recorded
//   options bag (`mock.exportPageCalls[i].options[k]`); the TS client
//   takes `(page, options)` where Python takes kwargs, so the same keys
//   and values are compared. Absent-vs-null: the facade forwards only
//   the keys the params dict carries, so `get(k) is None` translates to
//   `?? null` being null (absent OR explicit null — the same Python
//   `.get(k)` semantics).
// - `mock.side_effect = [p0, p1, p2]` (an iterable side effect) becomes
//   a handler indexed by call count.
// - `.df` asserts become `toRows()` / `rowColumns()` (C6).
// - The Python file records two REMOVED cases in comments
//   (`test_no_credentials_raises_config_error`, B1 Fix 10) — nothing to
//   translate.

import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
import { BookmarkValidationError } from "../../src/errors.js";
import { filterUnchecked } from "../../src/types/query-params/filter.js";
import { UserQueryResult } from "../../src/types/results/query-engine.js";
import { ProfilePageResult } from "../../src/types/results/discovery.js";
import { sortedByCodepoint } from "../../src/compat/codepoint.js";
import {
  makePageResult,
  makeRawProfile,
  mockWorkspaceClient,
  TEST_SESSION,
  type MockWorkspaceClient,
} from "./workspace-test-helpers.js";

/**
 * The `workspace_factory` fixture (test file :125-146).
 *
 * @param mock - The stub client.
 * @returns The facade under test.
 */
function workspaceFactory(mock: MockWorkspaceClient): Workspace {
  return new Workspace({ session: TEST_SESSION, client: mock.client });
}

/**
 * Install a fixed page result (`mock.export_profiles_page.return_value`).
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

/**
 * Install an iterable side effect (`mock.side_effect = [...]`).
 *
 * @param mock - The stub client.
 * @param results - The page results, in call order.
 */
function sideEffect(
  mock: MockWorkspaceClient,
  results: readonly ProfilePageResult[],
): void {
  let index = 0;
  mock.setPageHandler(() => {
    const value = results[index];
    index += 1;
    if (value === undefined) {
      throw new Error("StopIteration");
    }
    return value;
  });
}

// Mock data (test file :151-155)
const RAW_PROFILE_1 = makeRawProfile("user_001", undefined, {
  plan: "premium",
  email: "alice@example.com",
});
const RAW_PROFILE_2 = makeRawProfile("user_002", undefined, {
  plan: "free",
  email: "bob@example.com",
});
const RAW_PROFILE_3 = makeRawProfile("user_003", undefined, {
  plan: "premium",
  email: "carol@example.com",
});

// ===========================================================================
// Default limit=1
// ===========================================================================

describe("TestQueryUserDefaultLimit", () => {
  it("returns exactly one profile", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([RAW_PROFILE_1, RAW_PROFILE_2], {
        total: 500,
        has_more: true,
      }),
    );

    const result = await workspaceFactory(mock).queryUser({ mode: "profiles" });

    expect(result).toBeInstanceOf(UserQueryResult);
    expect(result.mode).toBe("profiles");
    expect(result.profiles.length).toBe(1);
    expect(result.profiles[0]!["distinct_id"]).toBe("user_001");
  });

  it("total equals len(profiles) == 1", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([RAW_PROFILE_1], { total: 5432, has_more: true }),
    );

    const result = await workspaceFactory(mock).queryUser({ mode: "profiles" });

    expect(result.total).toBe(1);
    expect(result.total).toBe(result.profiles.length);
  });

  it("fetches only page 0", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([RAW_PROFILE_1, RAW_PROFILE_2], {
        total: 5000,
        has_more: true,
      }),
    );

    await workspaceFactory(mock).queryUser({ mode: "profiles" });

    expect(mock.exportPageCalls.length).toBe(1);
  });
});

// ===========================================================================
// Explicit limit + pagination
// ===========================================================================

describe("TestQueryUserExplicitLimit", () => {
  it("truncates to the requested count", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([RAW_PROFILE_1, RAW_PROFILE_2, RAW_PROFILE_3], {
        total: 500,
        has_more: true,
      }),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      limit: 2,
    });

    expect(result.profiles.length).toBe(2);
  });

  it("paginates across multiple pages", async () => {
    const mock = mockWorkspaceClient();
    sideEffect(mock, [
      makePageResult([RAW_PROFILE_1], {
        page: 0,
        total: 3,
        page_size: 1,
        session_id: "sess_xyz",
        has_more: true,
      }),
      makePageResult([RAW_PROFILE_2], {
        page: 1,
        total: 3,
        page_size: 1,
        session_id: "sess_xyz",
        has_more: true,
      }),
      makePageResult([RAW_PROFILE_3], {
        page: 2,
        total: 3,
        page_size: 1,
        session_id: "sess_xyz",
        has_more: false,
      }),
    ]);

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      limit: 3,
    });

    expect(result.profiles.length).toBe(3);
    expect(mock.exportPageCalls.length).toBe(3);
  });

  it("stops paginating once the limit is met", async () => {
    const mock = mockWorkspaceClient();
    sideEffect(mock, [
      makePageResult([RAW_PROFILE_1, RAW_PROFILE_2], {
        page: 0,
        total: 100,
        page_size: 2,
        session_id: "sess_stop",
        has_more: true,
      }),
    ]);

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      limit: 2,
    });

    expect(result.profiles.length).toBe(2);
    // Should not fetch page 1 since the limit is already met
    expect(mock.exportPageCalls.length).toBe(1);
  });

  it("a huge limit fetches all pages until has_more is false", async () => {
    const mock = mockWorkspaceClient();
    sideEffect(mock, [
      makePageResult([RAW_PROFILE_1], {
        page: 0,
        total: 2,
        page_size: 1,
        session_id: "sess_all",
        has_more: true,
      }),
      makePageResult([RAW_PROFILE_2], {
        page: 1,
        total: 2,
        page_size: 1,
        session_id: "sess_all",
        has_more: false,
      }),
    ]);

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      limit: 100_000,
    });

    expect(result.profiles.length).toBe(2);
    expect(mock.exportPageCalls.length).toBe(2);
  });
});

// ===========================================================================
// Property selection
// ===========================================================================

describe("TestQueryUserPropertySelection", () => {
  it("forwards properties as output_properties", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_1], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      properties: ["$email", "plan"],
    });

    expect(mock.exportPageCalls[0]!.options["output_properties"]).toEqual([
      "$email",
      "plan",
    ]);
  });

  it("properties=null sends no output_properties", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_1], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      properties: null,
    });

    expect(
      mock.exportPageCalls[0]!.options["output_properties"] ?? null,
    ).toBeNull();
  });
});

// ===========================================================================
// Sorting
// ===========================================================================

describe("TestQueryUserSorting", () => {
  it("sort_by is translated to sort_key", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_1], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      sort_by: "$last_seen",
    });

    expect(mock.exportPageCalls[0]!.options["sort_key"]).toBe(
      'properties["$last_seen"]',
    );
  });

  it("sort_order is forwarded", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_1], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      sort_by: "revenue",
      sort_order: "ascending",
    });

    expect(mock.exportPageCalls[0]!.options["sort_order"]).toBe("ascending");
  });

  it("the default sort_order is descending", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_1], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      sort_by: "$last_seen",
    });

    expect(mock.exportPageCalls[0]!.options["sort_order"]).toBe("descending");
  });

  it("double quotes in sort_by are escaped", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_1], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      sort_by: 'weird"prop',
    });

    expect(mock.exportPageCalls[0]!.options["sort_key"]).toBe(
      'properties["weird\\"prop"]',
    );
  });

  it("backslashes in sort_by are escaped", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_1], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      sort_by: "back\\slash",
    });

    expect(mock.exportPageCalls[0]!.options["sort_key"]).toBe(
      'properties["back\\\\slash"]',
    );
  });
});

// ===========================================================================
// Search
// ===========================================================================

describe("TestQueryUserSearch", () => {
  it("search is forwarded", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_1], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      search: "alice",
    });

    expect(mock.exportPageCalls[0]!.options["search"]).toBe("alice");
  });

  it("the default search is null (not sent)", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_1], { total: 1 }));

    await workspaceFactory(mock).queryUser({ mode: "profiles" });

    expect(mock.exportPageCalls[0]!.options["search"] ?? null).toBeNull();
  });
});

// ===========================================================================
// distinct_id / distinct_ids
// ===========================================================================

describe("TestQueryUserDistinctId", () => {
  it("distinct_id reaches the API", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult(
        [makeRawProfile("user_target", undefined, { plan: "enterprise" })],
        { total: 1, has_more: false },
      ),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      distinct_id: "user_target",
    });

    expect(result.profiles.length).toBe(1);
    expect(result.profiles[0]!["distinct_id"]).toBe("user_target");
    expect(mock.exportPageCalls.length).toBe(1);
  });
});

describe("TestQueryUserDistinctIds", () => {
  it("distinct_ids returns profiles for each requested id", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([RAW_PROFILE_1, RAW_PROFILE_2], {
        total: 2,
        has_more: false,
      }),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      distinct_ids: ["user_001", "user_002"],
      limit: 100_000,
    });

    expect(result.profiles.length).toBe(2);
    const ids = result.profiles.map((p) => p["distinct_id"]);
    expect(ids).toContain("user_001");
    expect(ids).toContain("user_002");
  });
});

// ===========================================================================
// group_id
// ===========================================================================

describe("TestQueryUserGroupId", () => {
  it("group_id is forwarded", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult(
        [makeRawProfile("company_001", undefined, { name: "Acme Corp" })],
        { total: 1 },
      ),
    );

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      group_id: "companies",
    });

    expect(mock.exportPageCalls[0]!.options["group_id"]).toBe("companies");
  });
});

// ===========================================================================
// as_of
// ===========================================================================

describe("TestQueryUserAsOf", () => {
  it("a Unix int as_of is forwarded as as_of_timestamp", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_1], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      as_of: 1704067200,
    });

    expect(mock.exportPageCalls[0]!.options["as_of_timestamp"]).toBe(
      1704067200,
    );
  });

  it("a YYYY-MM-DD as_of is converted to a Unix timestamp", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_1], { total: 1 }));

    await workspaceFactory(mock).queryUser({
      mode: "profiles",
      as_of: "2024-01-01",
    });

    const asOfTs = mock.exportPageCalls[0]!.options["as_of_timestamp"];
    expect(Number.isInteger(asOfTs)).toBe(true);
    expect(asOfTs as number).toBeGreaterThan(0);
  });
});

// ===========================================================================
// result.total == len(profiles)
// ===========================================================================

describe("TestQueryUserTotalCount", () => {
  it("total equals len(profiles) with limit=1", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([RAW_PROFILE_1], { total: 99999, has_more: true }),
    );

    const result = await workspaceFactory(mock).queryUser({ mode: "profiles" });

    expect(result.total).toBe(1);
    expect(result.total).toBe(result.profiles.length);
  });

  it("total equals len(profiles) with an explicit limit", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([RAW_PROFILE_1, RAW_PROFILE_2, RAW_PROFILE_3], {
        total: 10000,
        has_more: true,
      }),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      limit: 2,
    });

    expect(result.total).toBe(2);
    expect(result.total).toBe(result.profiles.length);
  });

  it("total matches when all profiles fit in one page", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([RAW_PROFILE_1, RAW_PROFILE_2], {
        total: 2,
        has_more: false,
      }),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      limit: 100_000,
    });

    expect(result.total).toBe(2);
    expect(result.total).toBe(result.profiles.length);
  });
});

// ===========================================================================
// Frame column schema
// ===========================================================================

describe("TestQueryUserDataFrame", () => {
  it("the first column is distinct_id", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_1], { total: 1 }));

    const result = await workspaceFactory(mock).queryUser({ mode: "profiles" });

    expect(result.rowColumns()[0]).toBe("distinct_id");
  });

  it("the second column is last_seen", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_1], { total: 1 }));

    const result = await workspaceFactory(mock).queryUser({ mode: "profiles" });

    expect(result.rowColumns()[1]).toBe("last_seen");
  });

  it("strips the $ prefix from property columns", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult(
        [
          makeRawProfile("user_dollar", undefined, {
            $email: "test@example.com",
            $city: "SF",
          }),
        ],
        { total: 1 },
      ),
    );

    const result = await workspaceFactory(mock).queryUser({ mode: "profiles" });

    const columns = result.rowColumns();
    expect(columns).toContain("email");
    expect(columns).toContain("city");
    expect(columns).not.toContain("$email");
    expect(columns).not.toContain("$city");
  });

  it("columns after the fixed two are alphabetically sorted", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult(
        [
          makeRawProfile("user_sort", undefined, {
            plan: "premium",
            age: 30,
            email: "z@example.com",
          }),
        ],
        { total: 1 },
      ),
    );

    const result = await workspaceFactory(mock).queryUser({ mode: "profiles" });

    const columns = [...result.rowColumns()];
    expect(columns[0]).toBe("distinct_id");
    expect(columns[1]).toBe("last_seen");
    const remaining = columns.slice(2);
    expect(remaining).toEqual(sortedByCodepoint(remaining));
  });

  it("row count matches the profile count", async () => {
    const mock = mockWorkspaceClient();
    returnValue(
      mock,
      makePageResult([RAW_PROFILE_1, RAW_PROFILE_2], {
        total: 2,
        has_more: false,
      }),
    );

    const result = await workspaceFactory(mock).queryUser({
      mode: "profiles",
      limit: 2,
    });

    expect(result.toRows().length).toBe(2);
  });
});

// ===========================================================================
// Empty result
// ===========================================================================

describe("TestQueryUserEmptyResult", () => {
  /** The empty page every case in this class returns. */
  function emptyPage(): ProfilePageResult {
    return makePageResult([], {
      total: 0,
      has_more: false,
      session_id: null,
    });
  }

  it("produces zero rows", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, emptyPage());

    const result = await workspaceFactory(mock).queryUser({ mode: "profiles" });

    expect(result.profiles.length).toBe(0);
    expect(result.total).toBe(0);
    expect(result.toRows().length).toBe(0);
  });

  it("the empty frame still has distinct_id and last_seen columns", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, emptyPage());

    const result = await workspaceFactory(mock).queryUser({ mode: "profiles" });

    expect(result.rowColumns()).toContain("distinct_id");
    expect(result.rowColumns()).toContain("last_seen");
  });

  it("distinct_ids is an empty list", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, emptyPage());

    const result = await workspaceFactory(mock).queryUser({ mode: "profiles" });

    expect(result.distinct_ids).toEqual([]);
  });
});

// ===========================================================================
// Credentials
// ===========================================================================

describe("TestQueryUserConfigError", () => {
  it("does not raise with valid credentials", async () => {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_1], { total: 1 }));

    const result = await workspaceFactory(mock).queryUser({ mode: "profiles" });

    expect(result).toBeInstanceOf(UserQueryResult);
  });
});

// ===========================================================================
// Result metadata
// ===========================================================================

describe("TestQueryUserResultMetadata", () => {
  /** Build a facade whose page call returns one profile. */
  function oneProfileWs(): Workspace {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_1], { total: 1 }));
    return workspaceFactory(mock);
  }

  it("returns a UserQueryResult", async () => {
    const result = await oneProfileWs().queryUser({ mode: "profiles" });
    expect(result).toBeInstanceOf(UserQueryResult);
  });

  it("mode is 'profiles'", async () => {
    const result = await oneProfileWs().queryUser({ mode: "profiles" });
    expect(result.mode).toBe("profiles");
  });

  it("includes a computed_at timestamp string", async () => {
    const result = await oneProfileWs().queryUser({ mode: "profiles" });
    expect(typeof result.computed_at).toBe("string");
    expect(result.computed_at.length).toBeGreaterThan(0);
  });

  it("includes the params dict", async () => {
    const result = await oneProfileWs().queryUser({ mode: "profiles" });
    expect(typeof result.params).toBe("object");
    expect(result.params).not.toBeNull();
  });

  it("includes a meta dict", async () => {
    const result = await oneProfileWs().queryUser({ mode: "profiles" });
    expect(typeof result.meta).toBe("object");
    expect(result.meta).not.toBeNull();
  });

  it("aggregate_data is null in profiles mode", async () => {
    const result = await oneProfileWs().queryUser({ mode: "profiles" });
    expect(result.aggregate_data).toBeNull();
  });
});

// ===========================================================================
// Profile normalization
// ===========================================================================

describe("TestQueryUserProfileNormalization", () => {
  /** Build a facade whose page call returns RAW_PROFILE_1. */
  function oneProfileWs(): Workspace {
    const mock = mockWorkspaceClient();
    returnValue(mock, makePageResult([RAW_PROFILE_1], { total: 1 }));
    return workspaceFactory(mock);
  }

  it("profiles carry 'distinct_id' (not '$distinct_id')", async () => {
    const result = await oneProfileWs().queryUser({ mode: "profiles" });
    const profile = result.profiles[0]!;
    expect(Object.hasOwn(profile, "distinct_id")).toBe(true);
    expect(Object.hasOwn(profile, "$distinct_id")).toBe(false);
  });

  it("profiles carry 'last_seen'", async () => {
    const result = await oneProfileWs().queryUser({ mode: "profiles" });
    expect(Object.hasOwn(result.profiles[0]!, "last_seen")).toBe(true);
  });

  it("profiles carry a properties dict without reserved keys", async () => {
    const result = await oneProfileWs().queryUser({ mode: "profiles" });
    const profile = result.profiles[0]!;
    expect(Object.hasOwn(profile, "properties")).toBe(true);
    const props = profile["properties"] as Record<string, unknown>;
    expect(typeof props).toBe("object");
    expect(Object.hasOwn(props, "$last_seen")).toBe(false);
  });

  it("custom properties are preserved", async () => {
    const result = await oneProfileWs().queryUser({ mode: "profiles" });
    const props = result.profiles[0]!["properties"] as Record<string, unknown>;
    expect(props["plan"]).toBe("premium");
    expect(props["email"]).toBe("alice@example.com");
  });
});

// ===========================================================================
// Pagination session_id forwarding
// ===========================================================================

describe("TestQueryUserPaginationSessionId", () => {
  /** Install the two-page side effect both cases in this class share. */
  function twoPages(mock: MockWorkspaceClient, sessionId: string): void {
    sideEffect(mock, [
      makePageResult([RAW_PROFILE_1], {
        page: 0,
        total: 2,
        page_size: 1,
        session_id: sessionId,
        has_more: true,
      }),
      makePageResult([RAW_PROFILE_2], {
        page: 1,
        total: 2,
        page_size: 1,
        session_id: sessionId,
        has_more: false,
      }),
    ]);
  }

  it("the first page request is page 0", async () => {
    const mock = mockWorkspaceClient();
    twoPages(mock, "sess_first");

    await workspaceFactory(mock).queryUser({ mode: "profiles", limit: 2 });

    expect(mock.exportPageCalls[0]!.page).toBe(0);
  });

  it("subsequent pages use the page-0 session_id", async () => {
    const mock = mockWorkspaceClient();
    twoPages(mock, "sess_paginate");

    await workspaceFactory(mock).queryUser({ mode: "profiles", limit: 2 });

    expect(mock.exportPageCalls[1]!.options["session_id"]).toBe(
      "sess_paginate",
    );
  });
});

// ===========================================================================
// PR #118 review fixes
// ===========================================================================

describe("TestQueryUserValueErrorWrapping", () => {
  it("an unsupported filter operator raises BookmarkValidationError", async () => {
    // Python PR #236: the constructor rejects unknown operators, so the
    // ES13 builder guard is driven through the unchecked rebuild (Python
    // `make_unchecked_filter`).
    const f = filterUnchecked({
      _property: "prop",
      _operator: "unsupported_op",
      _value: "val",
    });
    const ws = workspaceFactory(mockWorkspaceClient());

    await expect(
      ws.queryUser({ mode: "profiles", where: f }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
  });
});

describe("TestQueryUserAggregatePropertyEscaping", () => {
  it("a double quote in aggregate_property is escaped in the action", async () => {
    const mock = mockWorkspaceClient();
    mock.setEngageStats({ results: 42 });

    await workspaceFactory(mock).queryUser({
      mode: "aggregate",
      aggregate: "extremes",
      aggregate_property: 'has"quote',
    });

    expect(mock.engageStatsCalls[0]!["action"]).toBe(
      'extremes(properties["has\\"quote"])',
    );
  });
});
