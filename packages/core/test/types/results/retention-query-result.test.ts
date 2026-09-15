// Translated RetentionQueryResult tests (packet P2-6):
// assertion-for-assertion port of tests/test_types_retention.py
// (TestRetentionQueryResultConstruction / DataFrame /
// DataFrameSegmented / ToDict / Average) — R10.2. The RetentionEvent
// suites of the same file were translated by P2-5c
// (test/types/query-params/retention.test.ts); TestRetentionMathType
// is P2-3 alias surface. Immutability suites not ported (compile-time
// `readonly`).
import { describe, expect, it } from "vitest";

import {
  RetentionQueryResult,
  type RetentionQueryResultFields,
} from "../../../src/types/results/query-engine.js";

/** Build a default-valid RetentionQueryResult (Python `_make_result`). */
function makeResult(
  overrides: Partial<RetentionQueryResultFields> = {},
): RetentionQueryResult {
  return new RetentionQueryResult({
    computed_at: "2025-01-15T12:00:00",
    from_date: "2025-01-01",
    to_date: "2025-01-31",
    cohorts: {
      "2025-01-01": {
        first: 100,
        counts: [100, 50, 25],
        rates: [1.0, 0.5, 0.25],
      },
      "2025-01-02": {
        first: 80,
        counts: [80, 40, 20],
        rates: [1.0, 0.5, 0.25],
      },
    },
    average: { first: 90, counts: [90, 45, 22], rates: [1.0, 0.5, 0.244] },
    params: { sections: {}, displayOptions: {} },
    meta: { sampling_factor: 1.0 },
    ...overrides,
  });
}

describe("RetentionQueryResult construction", () => {
  // python: TestRetentionQueryResultConstruction
  it("construct with all fields", () => {
    // python: test_construct_with_all_fields
    const r = makeResult();
    expect(r.computed_at).toBe("2025-01-15T12:00:00");
    expect(r.from_date).toBe("2025-01-01");
    expect(r.to_date).toBe("2025-01-31");
    expect(Object.keys(r.cohorts)).toHaveLength(2);
    expect(r.average["first"]).toBe(90);
    expect(Object.hasOwn(r.params, "sections")).toBe(true);
    expect(r.meta["sampling_factor"]).toBe(1.0);
  });

  it("default cohorts is empty dict", () => {
    // python: test_default_cohorts_is_empty_dict
    const r = new RetentionQueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
    });
    expect(r.cohorts).toStrictEqual({});
  });

  it("default average is empty dict", () => {
    // python: test_default_average_is_empty_dict
    const r = new RetentionQueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
    });
    expect(r.average).toStrictEqual({});
  });

  it("default params is empty dict", () => {
    // python: test_default_params_is_empty_dict
    const r = new RetentionQueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
    });
    expect(r.params).toStrictEqual({});
  });

  it("default meta is empty dict", () => {
    // python: test_default_meta_is_empty_dict
    const r = new RetentionQueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
    });
    expect(r.meta).toStrictEqual({});
  });
});

describe("RetentionQueryResult.df", () => {
  // python: TestRetentionQueryResultDataFrame
  it("df columns", () => {
    // python: test_df_columns
    expect(makeResult().rowColumns()).toStrictEqual([
      "cohort_date",
      "bucket",
      "count",
      "rate",
    ]);
  });

  it("df shape", () => {
    // python: test_df_shape
    // 2 cohorts x 3 buckets each = 6 rows
    expect(makeResult().toRows()).toHaveLength(6);
  });

  it("df caching (determinism)", () => {
    // python: test_df_caching
    const r = makeResult();
    expect(r.toRows()).toStrictEqual(r.toRows());
  });

  it("df values correct", () => {
    // python: test_df_values_correct
    const rows = makeResult().toRows();
    // First cohort, bucket 0
    const row = rows.filter(
      (item) => item["cohort_date"] === "2025-01-01" && item["bucket"] === 0,
    );
    expect(row).toHaveLength(1);
    expect(row[0]?.["count"]).toBe(100);
    expect(row[0]?.["rate"]).toBe(1.0);
  });

  it("df bucket indices", () => {
    // python: test_df_bucket_indices
    const buckets = [
      ...new Set(
        makeResult()
          .toRows()
          .map((row) => row["bucket"] as number),
      ),
    ].sort((a, b) => a - b);
    expect(buckets).toStrictEqual([0, 1, 2]);
  });

  it("empty cohorts produces empty df", () => {
    // python: test_empty_cohorts_produces_empty_df
    const r = makeResult({ cohorts: {} });
    expect(r.toRows()).toHaveLength(0);
    expect(r.rowColumns()).toStrictEqual([
      "cohort_date",
      "bucket",
      "count",
      "rate",
    ]);
  });

  it("rates shorter than counts uses zero", () => {
    // python: test_rates_shorter_than_counts_uses_zero
    const r = makeResult({
      cohorts: {
        "2025-01-01": {
          first: 100,
          counts: [100, 50, 25],
          rates: [1.0], // Only 1 rate for 3 counts
        },
      },
    });
    const rows = r.toRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]?.["rate"]).toBe(1.0);
    expect(rows[1]?.["rate"]).toBe(0.0);
    expect(rows[2]?.["rate"]).toBe(0.0);
  });

  it("rates empty all default to zero", () => {
    // python: test_rates_empty_all_default_to_zero
    const r = makeResult({
      cohorts: {
        "2025-01-01": { first: 50, counts: [50, 25], rates: [] },
      },
    });
    const rows = r.toRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.["rate"]).toBe(0.0);
    expect(rows[1]?.["rate"]).toBe(0.0);
  });
});

describe("RetentionQueryResult.df segmented", () => {
  // python: TestRetentionQueryResultDataFrameSegmented
  const segments = {
    iOS: {
      "2025-01-01": { first: 60, counts: [60, 30], rates: [1.0, 0.5] },
    },
    Android: {
      "2025-01-01": { first: 40, counts: [40, 20], rates: [1.0, 0.5] },
    },
  };

  it("df with segments has segment column", () => {
    // python: test_df_with_segments_has_segment_column
    const r = makeResult({ segments });
    expect(r.rowColumns()).toStrictEqual([
      "segment",
      "cohort_date",
      "bucket",
      "count",
      "rate",
    ]);
  });

  it("df with segments row count", () => {
    // python: test_df_with_segments_row_count
    const r = makeResult({ segments });
    // 2 segments x 1 cohort x 2 buckets = 4 rows
    expect(r.toRows()).toHaveLength(4);
  });

  it("df with segments values correct", () => {
    // python: test_df_with_segments_values_correct
    const r = makeResult({
      segments: {
        iOS: {
          "2025-01-01": { first: 60, counts: [60, 30], rates: [1.0, 0.5] },
        },
      },
    });
    const row = r
      .toRows()
      .filter((item) => item["segment"] === "iOS" && item["bucket"] === 0);
    expect(row).toHaveLength(1);
    expect(row[0]?.["count"]).toBe(60);
    expect(row[0]?.["rate"]).toBe(1.0);
  });

  it("df without segments no segment column", () => {
    // python: test_df_without_segments_no_segment_column
    expect(makeResult().rowColumns()).toStrictEqual([
      "cohort_date",
      "bucket",
      "count",
      "rate",
    ]);
  });
});

describe("RetentionQueryResult.to_dict", () => {
  // python: TestRetentionQueryResultToDict
  it("to dict returns dict", () => {
    // python: test_to_dict_returns_dict
    const d = makeResult().toJSON();
    expect(typeof d).toBe("object");
    expect(Array.isArray(d)).toBe(false);
  });

  it("to dict contains all fields", () => {
    // python: test_to_dict_contains_all_fields
    const d = makeResult().toJSON();
    for (const key of [
      "computed_at",
      "from_date",
      "to_date",
      "cohorts",
      "average",
      "params",
      "meta",
    ]) {
      expect(Object.hasOwn(d, key), key).toBe(true);
    }
  });

  it("to dict includes segments when present", () => {
    // python: test_to_dict_includes_segments_when_present
    const r = makeResult({
      segments: {
        iOS: {
          "2025-01-01": { first: 60, counts: [60, 30], rates: [1.0, 0.5] },
        },
      },
      segment_averages: {
        iOS: { first: 60, counts: [60, 30], rates: [1.0, 0.5] },
      },
    });
    const d = r.toJSON();
    expect(Object.hasOwn(d, "segments")).toBe(true);
    expect(Object.hasOwn(d, "segment_averages")).toBe(true);
    const ios = (
      d["segments"] as Record<string, Record<string, Record<string, unknown>>>
    )["iOS"];
    expect(ios?.["2025-01-01"]?.["first"]).toBe(60);
  });

  it("to dict excludes segments when empty", () => {
    // python: test_to_dict_excludes_segments_when_empty
    const d = makeResult().toJSON();
    expect(Object.hasOwn(d, "segments")).toBe(false);
    expect(Object.hasOwn(d, "segment_averages")).toBe(false);
  });
});

describe("RetentionQueryResult.average", () => {
  // python: TestRetentionQueryResultAverage
  it("average is preserved", () => {
    // python: test_average_is_preserved
    const avg = { first: 90, counts: [90, 45], rates: [1.0, 0.5] };
    const r = makeResult({ average: avg });
    expect(r.average).toStrictEqual(avg);
  });

  it("average empty dict when no data", () => {
    // python: test_average_empty_dict_when_no_data
    const r = new RetentionQueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
    });
    expect(r.average).toStrictEqual({});
  });
});
