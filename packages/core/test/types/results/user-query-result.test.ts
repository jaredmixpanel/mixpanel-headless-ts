// UserQueryResult: construction, the five-branch df projection (profiles,
// empty, aggregate, segmented, None) as row arrays, distinct_ids, value,
// to_dict and to_table_dict. Mirrors tests/test_types_user_query_result.py.
// pandas NaN is out of the TS contract: an explicit None stays null, a
// missing property is an absent row key; no runtime df cache in TS.
import { describe, expect, it } from "vitest";

import { compareCodeUnits } from "../../../src/compat/codepoint.js";
import {
  UserQueryResult,
  type UserQueryResultFields,
} from "../../../src/types/results/query-engine.js";

/** Build a default-valid UserQueryResult (Python `_make_result`). */
function makeResult(
  overrides: Partial<UserQueryResultFields> = {},
): UserQueryResult {
  return new UserQueryResult({
    computed_at: "2025-01-15T10:00:00",
    total: 0,
    profiles: [],
    params: {},
    meta: {},
    mode: "profiles",
    aggregate_data: null,
    ...overrides,
  });
}

/** Sample profiles (Python `_sample_profiles`). */
function sampleProfiles(): ReadonlyArray<Record<string, unknown>> {
  return [
    {
      distinct_id: "user_001",
      last_seen: "2025-01-14T08:30:00",
      properties: {
        $email: "alice@example.com",
        $city: "San Francisco",
        plan: "premium",
        ltv: 299.99,
      },
    },
    {
      distinct_id: "user_002",
      last_seen: "2025-01-13T12:00:00",
      properties: {
        $email: "bob@example.com",
        $city: "New York",
        plan: "free",
        ltv: 0,
        referral_source: "organic",
      },
    },
  ];
}

/** A single profile (Python `_single_profile`). */
function singleProfile(): ReadonlyArray<Record<string, unknown>> {
  return [
    {
      distinct_id: "user_solo",
      last_seen: "2025-01-15T00:00:00",
      properties: { $email: "solo@example.com", plan: "trial" },
    },
  ];
}

describe("UserQueryResult construction", () => {
  // python: TestUserQueryResultConstruction
  it("construct profiles mode with defaults", () => {
    // python: test_construct_profiles_mode_with_defaults
    const r = makeResult();
    expect(r.computed_at).toBe("2025-01-15T10:00:00");
    expect(r.total).toBe(0);
    expect(r.profiles).toStrictEqual([]);
    expect(r.params).toStrictEqual({});
    expect(r.meta).toStrictEqual({});
    expect(r.mode).toBe("profiles");
    expect(r.aggregate_data).toBeNull();
  });

  it("construct aggregate mode", () => {
    // python: test_construct_aggregate_mode
    const r = makeResult({
      mode: "aggregate",
      total: 5000,
      aggregate_data: 5000,
      profiles: [],
    });
    expect(r.mode).toBe("aggregate");
    expect(r.total).toBe(5000);
    expect(r.aggregate_data).toBe(5000);
    expect(r.profiles).toStrictEqual([]);
  });

  it("construct with profiles", () => {
    // python: test_construct_with_profiles
    const profiles = sampleProfiles();
    const r = makeResult({ profiles, total: 2 });
    expect(r.profiles).toHaveLength(2);
    expect(r.profiles[0]?.["distinct_id"]).toBe("user_001");
    expect(r.profiles[1]?.["distinct_id"]).toBe("user_002");
  });

  it("construct with all overrides", () => {
    // python: test_construct_with_all_overrides
    const r = makeResult({
      computed_at: "2025-02-01T12:00:00",
      total: 100,
      profiles: singleProfile(),
      params: { where: 'properties["plan"] == "premium"' },
      meta: { session_id: "abc123", pages_fetched: 1 },
      mode: "profiles",
      aggregate_data: null,
    });
    expect(r.computed_at).toBe("2025-02-01T12:00:00");
    expect(r.total).toBe(100);
    expect(r.profiles).toHaveLength(1);
    expect(Object.hasOwn(r.params, "where")).toBe(true);
    expect(r.meta["session_id"]).toBe("abc123");
    expect(r.mode).toBe("profiles");
    expect(r.aggregate_data).toBeNull();
  });

  it("construct with dict aggregate data", () => {
    // python: test_construct_with_dict_aggregate_data
    const segData = { cohort_123: 42, cohort_456: 78 };
    const r = makeResult({ mode: "aggregate", aggregate_data: segData });
    expect(typeof r.aggregate_data).toBe("object");
    expect((r.aggregate_data as Record<string, unknown>)["cohort_123"]).toBe(
      42,
    );
  });

  it("construct with int aggregate data", () => {
    // python: test_construct_with_int_aggregate_data
    expect(
      makeResult({ mode: "aggregate", aggregate_data: 500 }).aggregate_data,
    ).toBe(500);
  });

  it("construct with float aggregate data", () => {
    // python: test_construct_with_float_aggregate_data
    expect(
      makeResult({ mode: "aggregate", aggregate_data: 123.45 }).aggregate_data,
    ).toBe(123.45);
  });
});

describe("UserQueryResult.df profiles mode", () => {
  // python: TestUserQueryResultProfilesDf
  it("df columns contain distinct ID and last seen", () => {
    // python: test_df_columns_contain_distinct_id_and_last_seen
    const cols = makeResult({
      profiles: sampleProfiles(),
      total: 2,
    }).rowColumns();
    expect(cols[0]).toBe("distinct_id");
    expect(cols[1]).toBe("last_seen");
  });

  it("df dollar prefix stripped", () => {
    // python: test_df_dollar_prefix_stripped
    const cols = makeResult({
      profiles: sampleProfiles(),
      total: 2,
    }).rowColumns();
    expect(cols).toContain("email");
    expect(cols).toContain("city");
    expect(cols).not.toContain("$email");
    expect(cols).not.toContain("$city");
  });

  it("df properties sorted alphabetically", () => {
    // python: test_df_properties_sorted_alphabetically
    const cols = makeResult({
      profiles: sampleProfiles(),
      total: 2,
    }).rowColumns();
    const propertyCols = cols.slice(2);
    expect(propertyCols).toStrictEqual(
      [...propertyCols].sort(compareCodeUnits),
    );
  });

  it("df row count matches profiles", () => {
    // python: test_df_row_count_matches_profiles
    const profiles = sampleProfiles();
    expect(makeResult({ profiles, total: 2 }).toRows()).toHaveLength(
      profiles.length,
    );
  });

  it("df distinct ID values", () => {
    // python: test_df_distinct_id_values
    const rows = makeResult({ profiles: sampleProfiles(), total: 2 }).toRows();
    expect(rows.map((row) => row["distinct_id"])).toStrictEqual([
      "user_001",
      "user_002",
    ]);
  });

  it("df last seen values", () => {
    // python: test_df_last_seen_values
    const rows = makeResult({ profiles: sampleProfiles(), total: 2 }).toRows();
    expect(rows.map((row) => row["last_seen"])).toStrictEqual([
      "2025-01-14T08:30:00",
      "2025-01-13T12:00:00",
    ]);
  });

  it("df property values preserved", () => {
    // python: test_df_property_values_preserved
    const rows = makeResult({ profiles: sampleProfiles(), total: 2 }).toRows();
    expect(rows[0]?.["email"]).toBe("alice@example.com");
    expect(rows[0]?.["plan"]).toBe("premium");
    expect(rows[0]?.["ltv"]).toBe(299.99);
  });

  it("df missing property is NaN (absent key in TS rows)", () => {
    // python: test_df_missing_property_is_nan
    const rows = makeResult({ profiles: sampleProfiles(), total: 2 }).toRows();
    // referral_source only on user_002 — pandas NaN-fills user_001;
    // the TS row simply lacks the key (NaN fill is a pandas artifact).
    expect(Object.hasOwn(rows[0] ?? {}, "referral_source")).toBe(false);
    expect(rows[1]?.["referral_source"]).toBe("organic");
  });

  it("df single profile", () => {
    // python: test_df_single_profile
    const rows = makeResult({ profiles: singleProfile(), total: 1 }).toRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["distinct_id"]).toBe("user_solo");
  });

  it("df profile no properties", () => {
    // python: test_df_profile_no_properties
    const profiles = [
      {
        distinct_id: "bare_user",
        last_seen: "2025-01-01T00:00:00",
        properties: {},
      },
    ];
    const r = makeResult({ profiles, total: 1 });
    expect(r.toRows()).toHaveLength(1);
    expect(r.rowColumns()).toStrictEqual(["distinct_id", "last_seen"]);
  });

  it("df all dollar prefixed properties", () => {
    // python: test_df_all_dollar_prefixed_properties
    const profiles = [
      {
        distinct_id: "u1",
        last_seen: "2025-01-01T00:00:00",
        properties: { $browser: "Chrome", $os: "macOS", $app_version: "3.2" },
      },
    ];
    const cols = makeResult({ profiles, total: 1 }).rowColumns();
    // After stripping $: app_version, browser, os — alphabetical.
    expect(cols.slice(2)).toStrictEqual(["app_version", "browser", "os"]);
  });

  it("df mixed types in properties", () => {
    // python: test_df_mixed_types_in_properties
    const profiles = [
      {
        distinct_id: "u1",
        last_seen: "2025-01-01T00:00:00",
        properties: { name: "Alice", age: 30, score: 95.5, active: true },
      },
    ];
    const row = makeResult({ profiles, total: 1 }).toRows()[0];
    expect(row?.["name"]).toBe("Alice");
    expect(row?.["age"]).toBe(30);
    expect(row?.["score"]).toBe(95.5);
    expect(row?.["active"]).toBe(true);
  });
});

describe("UserQueryResult.df empty profiles", () => {
  // python: TestUserQueryResultEmptyProfilesDf
  it("empty profiles produces empty dataframe", () => {
    // python: test_empty_profiles_produces_empty_dataframe
    expect(makeResult({ profiles: [], total: 0 }).toRows()).toHaveLength(0);
  });

  it("empty profiles has correct columns", () => {
    // python: test_empty_profiles_has_correct_columns
    const cols = makeResult({ profiles: [], total: 0 }).rowColumns();
    expect(cols).toContain("distinct_id");
    expect(cols).toContain("last_seen");
  });

  it("empty profiles total nonzero", () => {
    // python: test_empty_profiles_total_nonzero
    const r = makeResult({ profiles: [], total: 5000 });
    expect(r.toRows()).toHaveLength(0);
    expect(r.total).toBe(5000);
  });
});

describe("UserQueryResult.df aggregate mode", () => {
  // python: TestUserQueryResultAggregateDf
  it("aggregate count df columns", () => {
    // python: test_aggregate_count_df_columns
    const r = makeResult({
      mode: "aggregate",
      aggregate_data: 5000,
      total: 5000,
      meta: { action: "count()" },
    });
    expect(r.rowColumns()).toStrictEqual(["metric", "value"]);
  });

  it("aggregate count df single row", () => {
    // python: test_aggregate_count_df_single_row
    const r = makeResult({
      mode: "aggregate",
      aggregate_data: 5000,
      total: 5000,
      meta: { action: "count()" },
    });
    expect(r.toRows()).toHaveLength(1);
  });

  it("aggregate count df values", () => {
    // python: test_aggregate_count_df_values
    const r = makeResult({
      mode: "aggregate",
      aggregate_data: 5000,
      total: 5000,
      meta: { action: "count()" },
    });
    expect(r.toRows()[0]?.["value"]).toBe(5000);
  });

  it("aggregate float df values", () => {
    // python: test_aggregate_float_df_values
    const r = makeResult({
      mode: "aggregate",
      aggregate_data: 123.45,
      total: 500,
      meta: { action: "mean(ltv)" },
    });
    expect(r.toRows()[0]?.["value"]).toBe(123.45);
  });

  it("aggregate zero value", () => {
    // python: test_aggregate_zero_value
    const r = makeResult({
      mode: "aggregate",
      aggregate_data: 0,
      total: 0,
      meta: { action: "count()" },
    });
    expect(r.toRows()).toHaveLength(1);
    expect(r.toRows()[0]?.["value"]).toBe(0);
  });
});

describe("UserQueryResult.df segmented", () => {
  // python: TestUserQueryResultSegmentedAggregateDf
  it("segmented df columns", () => {
    // python: test_segmented_df_columns
    const r = makeResult({
      mode: "aggregate",
      aggregate_data: { cohort_123: 42, cohort_456: 78 },
      total: 120,
      meta: { action: "count()", segmented: true },
    });
    expect(r.rowColumns()).toStrictEqual(["segment", "value"]);
  });

  it("segmented df row count", () => {
    // python: test_segmented_df_row_count
    const r = makeResult({
      mode: "aggregate",
      aggregate_data: { cohort_A: 10, cohort_B: 20, cohort_C: 30 },
      total: 60,
      meta: { action: "count()", segmented: true },
    });
    expect(r.toRows()).toHaveLength(3);
  });

  it("segmented df values", () => {
    // python: test_segmented_df_values
    const r = makeResult({
      mode: "aggregate",
      aggregate_data: { cohort_123: 42, cohort_456: 78 },
      total: 120,
      meta: { action: "count()", segmented: true },
    });
    const rows = r.toRows();
    expect(new Set(rows.map((row) => row["segment"]))).toStrictEqual(
      new Set(["cohort_123", "cohort_456"]),
    );
    const row123 = rows.find((row) => row["segment"] === "cohort_123");
    expect(row123?.["value"]).toBe(42);
  });

  it("segmented single segment", () => {
    // python: test_segmented_single_segment
    const r = makeResult({
      mode: "aggregate",
      aggregate_data: { only_segment: 99 },
      total: 99,
      meta: { action: "count()", segmented: true },
    });
    const rows = r.toRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["segment"]).toBe("only_segment");
    expect(rows[0]?.["value"]).toBe(99);
  });
});

describe("UserQueryResult.df aggregate None", () => {
  // python: TestUserQueryResultAggregateNoneDf
  it("aggregate mode null data produces empty df", () => {
    // python: test_aggregate_mode_none_data_produces_empty_df
    const r = makeResult({ mode: "aggregate", aggregate_data: null, total: 0 });
    expect(r.toRows()).toHaveLength(0);
  });
});

describe("UserQueryResult.df caching (determinism)", () => {
  // python: TestUserQueryResultDfCaching
  it("df cached profiles mode", () => {
    // python: test_df_cached_profiles_mode
    const r = makeResult({ profiles: sampleProfiles(), total: 2 });
    expect(r.toRows()).toStrictEqual(r.toRows());
  });

  it("df cached aggregate mode", () => {
    // python: test_df_cached_aggregate_mode
    const r = makeResult({
      mode: "aggregate",
      aggregate_data: 100,
      total: 100,
    });
    expect(r.toRows()).toStrictEqual(r.toRows());
  });

  it("df cached empty profiles", () => {
    // python: test_df_cached_empty_profiles
    const r = makeResult({ profiles: [], total: 0 });
    expect(r.toRows()).toStrictEqual(r.toRows());
  });

  it("codec-visible _df_cache slot is always null in TS", () => {
    const r = makeResult();
    expect(r._df_cache).toBeNull();
  });
});

describe("UserQueryResult.distinct_ids", () => {
  // python: TestUserQueryResultDistinctIds
  it("distinct IDs from profiles", () => {
    // python: test_distinct_ids_from_profiles
    expect(
      makeResult({ profiles: sampleProfiles(), total: 2 }).distinct_ids,
    ).toStrictEqual(["user_001", "user_002"]);
  });

  it("distinct IDs single profile", () => {
    // python: test_distinct_ids_single_profile
    expect(
      makeResult({ profiles: singleProfile(), total: 1 }).distinct_ids,
    ).toStrictEqual(["user_solo"]);
  });

  it("distinct IDs empty profiles", () => {
    // python: test_distinct_ids_empty_profiles
    expect(makeResult({ profiles: [], total: 0 }).distinct_ids).toStrictEqual(
      [],
    );
  });

  it("distinct IDs aggregate mode returns empty", () => {
    // python: test_distinct_ids_aggregate_mode_returns_empty
    const r = makeResult({
      mode: "aggregate",
      aggregate_data: 100,
      total: 100,
      profiles: [],
    });
    expect(r.distinct_ids).toStrictEqual([]);
  });

  it("distinct IDs returns list type", () => {
    // python: test_distinct_ids_returns_list_type
    expect(
      Array.isArray(
        makeResult({ profiles: sampleProfiles(), total: 2 }).distinct_ids,
      ),
    ).toBe(true);
  });

  it("distinct IDs preserves order", () => {
    // python: test_distinct_ids_preserves_order
    const profiles = [
      { distinct_id: "z_user", last_seen: "", properties: {} },
      { distinct_id: "a_user", last_seen: "", properties: {} },
      { distinct_id: "m_user", last_seen: "", properties: {} },
    ];
    expect(makeResult({ profiles, total: 3 }).distinct_ids).toStrictEqual([
      "z_user",
      "a_user",
      "m_user",
    ]);
  });
});

describe("UserQueryResult.value", () => {
  // python: TestUserQueryResultValue
  it("value int aggregate", () => {
    // python: test_value_int_aggregate
    expect(
      makeResult({ mode: "aggregate", aggregate_data: 5000, total: 5000 })
        .value,
    ).toBe(5000);
  });

  it("value float aggregate", () => {
    // python: test_value_float_aggregate
    expect(
      makeResult({ mode: "aggregate", aggregate_data: 123.45, total: 500 })
        .value,
    ).toBe(123.45);
  });

  it("value zero aggregate", () => {
    // python: test_value_zero_aggregate
    const r = makeResult({ mode: "aggregate", aggregate_data: 0, total: 0 });
    expect(r.value).toBe(0);
    expect(r.value).not.toBeNull();
  });

  it("value profiles mode returns null", () => {
    // python: test_value_profiles_mode_returns_none
    expect(
      makeResult({ mode: "profiles", profiles: sampleProfiles(), total: 2 })
        .value,
    ).toBeNull();
  });

  it("value segmented aggregate returns null", () => {
    // python: test_value_segmented_aggregate_returns_none
    const r = makeResult({
      mode: "aggregate",
      aggregate_data: { cohort_123: 42, cohort_456: 78 },
      total: 120,
    });
    expect(r.value).toBeNull();
  });

  it("value null aggregate data", () => {
    // python: test_value_none_aggregate_data
    expect(
      makeResult({ mode: "aggregate", aggregate_data: null, total: 0 }).value,
    ).toBeNull();
  });
});

describe("UserQueryResult mode-aware", () => {
  // python: TestUserQueryResultModeAware
  it("profiles mode df has profile columns", () => {
    // python: test_profiles_mode_df_has_profile_columns
    const r = makeResult({
      profiles: sampleProfiles(),
      total: 2,
      mode: "profiles",
    });
    expect(r.rowColumns()).toContain("distinct_id");
    expect(r.rowColumns()).toContain("last_seen");
    expect(r.toRows()).toHaveLength(2);
  });

  it("aggregate mode df has metric columns", () => {
    // python: test_aggregate_mode_df_has_metric_columns
    const r = makeResult({
      mode: "aggregate",
      aggregate_data: 100,
      total: 100,
    });
    const cols = r.rowColumns();
    expect(cols.includes("metric") || cols.includes("segment")).toBe(true);
    expect(cols).toContain("value");
  });

  it("profiles mode value is null", () => {
    // python: test_profiles_mode_value_is_none
    expect(
      makeResult({ mode: "profiles", profiles: sampleProfiles(), total: 2 })
        .value,
    ).toBeNull();
  });

  it("aggregate mode distinct IDs is empty", () => {
    // python: test_aggregate_mode_distinct_ids_is_empty
    expect(
      makeResult({ mode: "aggregate", aggregate_data: 100, total: 100 })
        .distinct_ids,
    ).toStrictEqual([]);
  });

  it("profiles mode distinct IDs populated", () => {
    // python: test_profiles_mode_distinct_ids_populated
    expect(
      makeResult({ mode: "profiles", profiles: sampleProfiles(), total: 2 })
        .distinct_ids,
    ).toHaveLength(2);
  });

  it("aggregate mode value populated", () => {
    // python: test_aggregate_mode_value_populated
    expect(
      makeResult({ mode: "aggregate", aggregate_data: 42, total: 42 }).value,
    ).toBe(42);
  });
});

describe("UserQueryResult.to_dict", () => {
  // python: TestUserQueryResultToDict
  it("to dict contains all fields", () => {
    // python: test_to_dict_contains_all_fields
    const d = makeResult().toJSON();
    for (const key of [
      "computed_at",
      "total",
      "profiles",
      "params",
      "meta",
      "mode",
      "aggregate_data",
    ]) {
      expect(Object.hasOwn(d, key), key).toBe(true);
    }
  });

  it("to dict values match fields", () => {
    // python: test_to_dict_values_match_fields
    const r = makeResult({
      computed_at: "2025-02-01T12:00:00",
      total: 42,
      profiles: singleProfile(),
      params: { where: "plan == premium" },
      meta: { session_id: "xyz" },
      mode: "profiles",
      aggregate_data: null,
    });
    const d = r.toJSON();
    expect(d["computed_at"]).toBe("2025-02-01T12:00:00");
    expect(d["total"]).toBe(42);
    expect(d["profiles"]).toHaveLength(1);
    expect((d["params"] as Record<string, unknown>)["where"]).toBe(
      "plan == premium",
    );
    expect((d["meta"] as Record<string, unknown>)["session_id"]).toBe("xyz");
    expect(d["mode"]).toBe("profiles");
    expect(d["aggregate_data"]).toBeNull();
  });

  it("to dict with aggregate data", () => {
    // python: test_to_dict_with_aggregate_data
    const d = makeResult({
      mode: "aggregate",
      aggregate_data: 123.45,
      total: 500,
    }).toJSON();
    expect(d["aggregate_data"]).toBe(123.45);
    expect(d["mode"]).toBe("aggregate");
  });

  it("to dict with segmented aggregate", () => {
    // python: test_to_dict_with_segmented_aggregate
    const d = makeResult({
      mode: "aggregate",
      aggregate_data: { cohort_123: 42, cohort_456: 78 },
      total: 120,
    }).toJSON();
    expect(d["aggregate_data"]).toStrictEqual({
      cohort_123: 42,
      cohort_456: 78,
    });
  });

  it("to dict is JSON serializable", () => {
    // python: test_to_dict_is_json_serializable
    const d = makeResult({
      profiles: singleProfile(),
      total: 1,
      params: { where: "plan == premium" },
      meta: { session_id: "abc" },
    }).toJSON();
    const jsonStr = JSON.stringify(d);
    expect(jsonStr).toContain("user_solo");
    expect(jsonStr).toContain("plan == premium");
  });

  it("to dict aggregate JSON serializable", () => {
    // python: test_to_dict_aggregate_json_serializable
    const d = makeResult({
      mode: "aggregate",
      aggregate_data: 42,
      total: 42,
    }).toJSON();
    expect(JSON.stringify(d)).toContain("42");
  });

  it("to dict does not include df cache", () => {
    // python: test_to_dict_does_not_include_df_cache
    const r = makeResult({ profiles: sampleProfiles(), total: 2 });
    r.toRows(); // Python populates the cache here
    expect(Object.hasOwn(r.toJSON(), "_df_cache")).toBe(false);
  });

  it("to dict empty result", () => {
    // python: test_to_dict_empty_result
    const d = makeResult().toJSON();
    expect(d["total"]).toBe(0);
    expect(d["profiles"]).toStrictEqual([]);
    expect(d["aggregate_data"]).toBeNull();
  });
});

describe("UserQueryResult.to_table_dict (toRows analog)", () => {
  // python: TestUserQueryResultToTableDict
  it("to table dict profiles mode", () => {
    // python: test_to_table_dict_profiles_mode
    const rows = makeResult({ profiles: sampleProfiles(), total: 2 }).toRows();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.["distinct_id"]).toBe("user_001");
  });

  it("to table dict aggregate mode", () => {
    // python: test_to_table_dict_aggregate_mode
    const rows = makeResult({
      mode: "aggregate",
      aggregate_data: 100,
      total: 100,
    }).toRows();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(1);
  });

  it("to table dict empty", () => {
    // python: test_to_table_dict_empty
    expect(makeResult({ profiles: [], total: 0 }).toRows()).toStrictEqual([]);
  });
});

describe("UserQueryResult edge cases", () => {
  // python: TestUserQueryResultEdgeCases
  it("profile with null property value", () => {
    // python: test_profile_with_none_property_value
    const profiles = [
      {
        distinct_id: "u1",
        last_seen: "2025-01-01T00:00:00",
        properties: { email: null, plan: "free" },
      },
    ];
    const row = makeResult({ profiles, total: 1 }).toRows()[0];
    // Python's None becomes pandas NaN; the TS row keeps the null.
    expect(row?.["email"]).toBeNull();
    expect(row?.["plan"]).toBe("free");
  });

  it("profile with unicode property names", () => {
    // python: test_profile_with_unicode_property_names
    const profiles = [
      {
        distinct_id: "u1",
        last_seen: "2025-01-01T00:00:00",
        properties: { nombre: "Carlos", ciudad: "Madrid" },
      },
    ];
    const r = makeResult({ profiles, total: 1 });
    expect(r.rowColumns()).toContain("nombre");
    expect(r.toRows()[0]?.["nombre"]).toBe("Carlos");
  });

  it("profile with empty distinct ID", () => {
    // python: test_profile_with_empty_distinct_id
    const profiles = [
      { distinct_id: "", last_seen: "2025-01-01T00:00:00", properties: {} },
    ];
    expect(
      makeResult({ profiles, total: 1 }).toRows()[0]?.["distinct_id"],
    ).toBe("");
  });

  it("large total with few profiles", () => {
    // python: test_large_total_with_few_profiles
    const r = makeResult({ profiles: singleProfile(), total: 50000 });
    expect(r.total).toBe(50000);
    expect(r.profiles).toHaveLength(1);
    expect(r.toRows()).toHaveLength(1);
  });

  it("profile with nested property value", () => {
    // python: test_profile_with_nested_property_value
    const profiles = [
      {
        distinct_id: "u1",
        last_seen: "2025-01-01T00:00:00",
        properties: {
          address: { city: "SF", state: "CA" },
          plan: "premium",
        },
      },
    ];
    const row = makeResult({ profiles, total: 1 }).toRows()[0];
    expect(typeof row?.["address"]).toBe("object");
  });

  it("profile with list property value", () => {
    // python: test_profile_with_list_property_value
    const profiles = [
      {
        distinct_id: "u1",
        last_seen: "2025-01-01T00:00:00",
        properties: { tags: ["vip", "beta"], plan: "premium" },
      },
    ];
    expect(
      makeResult({ profiles, total: 1 }).toRows()[0]?.["tags"],
    ).toStrictEqual(["vip", "beta"]);
  });

  it("many profiles column consistency", () => {
    // python: test_many_profiles_column_consistency
    const profiles = Array.from({ length: 5 }, (_, i) => ({
      distinct_id: `u${String(i)}`,
      last_seen: "2025-01-01T00:00:00",
      properties: { common: "yes", [`unique_${String(i)}`]: i },
    }));
    const r = makeResult({ profiles, total: 5 });
    expect(r.toRows()).toHaveLength(5);
    expect(r.rowColumns()).toContain("common");
    for (let i = 0; i < 5; i += 1) {
      expect(r.rowColumns()).toContain(`unique_${String(i)}`);
    }
  });
});
