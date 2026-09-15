// Translated QueryResult tests (packet P2-6): assertion-for-assertion
// port of tests/unit/test_query_types.py (TestQueryResultConstruction,
// TestQueryResultDataFrame, TestQueryResultSegmentedDataFrame,
// TestQueryResultToDict) — the four-column-layout per-class row spec
// of phase2-design C6.
//
// Translation notes: `list(df.columns)` -> `rowColumns()`;
// `df.iloc[n]` -> `toRows()[n]`; pandas boolean-mask row selection ->
// array `filter`; identity caching -> repeated-call determinism;
// `qr.params is params` (Python identity) -> reference equality via
// `toBe`; the frozen-dataclass immutability test is not ported
// (compile-time `readonly`).
import { describe, expect, it } from "vitest";

import { QueryResult } from "../../../src/types/results/query-engine.js";

describe("QueryResult construction (TestQueryResultConstruction)", () => {
  it("test_basic_construction", () => {
    const qr = new QueryResult({
      computed_at: "2024-01-01T00:00:00Z",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      headers: ["$metric"],
      series: { "Login [Total Events]": { "2024-01-01": 100 } },
      params: { test: true },
      meta: { min_sampling_factor: 1.0 },
    });
    expect(qr.computed_at).toBe("2024-01-01T00:00:00Z");
    expect(qr.from_date).toBe("2024-01-01");
    expect(qr.to_date).toBe("2024-01-31");
  });

  it("test_params_preserved", () => {
    const params = { sections: { show: [] }, displayOptions: {} };
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      params,
      meta: {},
    });
    expect(qr.params).toBe(params);
  });

  it("test_meta_preserved", () => {
    const meta = { min_sampling_factor: 1.0, is_segmentation_limit_hit: false };
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      params: {},
      meta,
    });
    expect(qr.meta).toBe(meta);
  });
});

describe("QueryResult.df (TestQueryResultDataFrame)", () => {
  it("test_timeseries_columns", () => {
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      series: {
        "Login [Total Events]": { "2024-01-01": 100, "2024-01-02": 200 },
      },
      params: {},
      meta: {},
    });
    expect(qr.rowColumns()).toStrictEqual(["date", "event", "count"]);
    expect(qr.toRows()).toHaveLength(2);
  });

  it("test_timeseries_values", () => {
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      series: {
        "Login [Total Events]": { "2024-01-01": 100, "2024-01-02": 200 },
      },
      params: {},
      meta: {},
    });
    const row0 = qr.toRows()[0];
    expect(row0?.["date"]).toBe("2024-01-01");
    expect(row0?.["event"]).toBe("Login [Total Events]");
    expect(row0?.["count"]).toBe(100);
  });

  it("test_hourly_timestamps_preserved", () => {
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      series: {
        "Login [Total Events]": {
          "2024-01-01T00:00:00": 100,
          "2024-01-01T01:00:00": 110,
          "2024-01-01T02:00:00": 120,
        },
      },
      params: {},
      meta: {},
    });
    const rows = qr.toRows();
    expect(rows).toHaveLength(3);
    const dates = rows.map((row) => row["date"]);
    expect(dates[0]).toBe("2024-01-01T00:00:00");
    expect(dates[1]).toBe("2024-01-01T01:00:00");
    expect(dates[2]).toBe("2024-01-01T02:00:00");
  });

  it("test_total_mode_columns", () => {
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      series: { "Login [Unique Users]": { all: 500 } },
      params: {},
      meta: {},
    });
    expect(qr.rowColumns()).toStrictEqual(["event", "count"]);
    expect(qr.toRows()).toHaveLength(1);
    expect(qr.toRows()[0]?.["count"]).toBe(500);
  });

  it("test_empty_series", () => {
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      series: {},
      params: {},
      meta: {},
    });
    expect(qr.toRows()).toHaveLength(0);
    expect(qr.rowColumns()).toContain("date");
  });

  it("test_multi_metric_timeseries", () => {
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      series: {
        "Login [Total]": { "2024-01-01": 100 },
        "Signup [Total]": { "2024-01-01": 50 },
      },
      params: {},
      meta: {},
    });
    const rows = qr.toRows();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row["event"]))).toStrictEqual(
      new Set(["Login [Total]", "Signup [Total]"]),
    );
  });

  it("test_df_caching (determinism)", () => {
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      series: { A: { "2024-01-01": 1 } },
      params: {},
      meta: {},
    });
    expect(qr.toRows()).toStrictEqual(qr.toRows());
  });
});

describe("QueryResult.df segmented (TestQueryResultSegmentedDataFrame)", () => {
  it("test_segmented_total_columns", () => {
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      series: {
        "Login [Total Events]": {
          $overall: { all: 500 },
          US: { all: 300 },
          EU: { all: 200 },
        },
      },
      params: {},
      meta: {},
    });
    expect(qr.rowColumns()).toContain("segment");
    expect(qr.rowColumns()).toContain("count");
    expect(qr.rowColumns()).toContain("event");
    expect(qr.rowColumns()).not.toContain("date");
  });

  it("test_segmented_total_scalar_counts", () => {
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      series: {
        "Login [Total Events]": {
          $overall: { all: 500 },
          US: { all: 300 },
          EU: { all: 200 },
        },
      },
      params: {},
      meta: {},
    });
    for (const row of qr.toRows()) {
      expect(
        typeof row["count"],
        `count should be scalar: ${String(row["count"])}`,
      ).toBe("number");
    }
  });

  it("test_segmented_total_values", () => {
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      series: {
        "Login [Total Events]": {
          $overall: { all: 500 },
          US: { all: 300 },
          EU: { all: 200 },
        },
      },
      params: {},
      meta: {},
    });
    const rows = qr.toRows();
    // $overall + US + EU = 3 rows
    expect(rows).toHaveLength(3);
    const usRows = rows.filter((row) => row["segment"] === "US");
    expect(usRows).toHaveLength(1);
    expect(usRows[0]?.["count"]).toBe(300);
  });

  it("test_segmented_timeseries_columns", () => {
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      series: {
        "Login [Total Events]": {
          $overall: { "2024-01-01": 100, "2024-01-02": 120 },
          US: { "2024-01-01": 60, "2024-01-02": 72 },
          EU: { "2024-01-01": 40, "2024-01-02": 48 },
        },
      },
      params: {},
      meta: {},
    });
    expect(qr.rowColumns()).toStrictEqual([
      "date",
      "event",
      "segment",
      "count",
    ]);
  });

  it("test_segmented_timeseries_scalar_counts", () => {
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      series: {
        "Login [Total Events]": {
          $overall: { "2024-01-01": 100 },
          US: { "2024-01-01": 60 },
        },
      },
      params: {},
      meta: {},
    });
    for (const row of qr.toRows()) {
      expect(
        typeof row["count"],
        `count should be scalar: ${String(row["count"])}`,
      ).toBe("number");
    }
  });

  it("test_segmented_timeseries_values", () => {
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      series: {
        "Login [Total Events]": {
          US: { "2024-01-01": 60, "2024-01-02": 72 },
          EU: { "2024-01-01": 40, "2024-01-02": 48 },
        },
      },
      params: {},
      meta: {},
    });
    const rows = qr.toRows();
    expect(rows).toHaveLength(4);
    const usJan1 = rows.filter(
      (row) => row["segment"] === "US" && row["date"] === "2024-01-01",
    );
    expect(usJan1).toHaveLength(1);
    expect(usJan1[0]?.["count"]).toBe(60);
  });

  it("test_segmented_timeseries_strips_timezone", () => {
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      series: {
        "Login [Total Events]": { US: { "2024-01-01T00:00:00-07:00": 60 } },
      },
      params: {},
      meta: {},
    });
    expect(qr.toRows()[0]?.["date"]).toBe("2024-01-01T00:00:00");
  });

  it("test_segmented_multi_metric", () => {
    const qr = new QueryResult({
      computed_at: "",
      from_date: "",
      to_date: "",
      series: {
        "Login [Total]": { US: { all: 300 }, EU: { all: 200 } },
        "Signup [Total]": { US: { all: 50 }, EU: { all: 30 } },
      },
      params: {},
      meta: {},
    });
    const rows = qr.toRows();
    expect(rows).toHaveLength(4);
    const loginUs = rows.find(
      (row) => row["event"] === "Login [Total]" && row["segment"] === "US",
    );
    expect(loginUs?.["count"]).toBe(300);
  });
});

describe("QueryResult.to_dict (TestQueryResultToDict)", () => {
  it("test_to_dict_contains_all_fields", () => {
    const qr = new QueryResult({
      computed_at: "ts",
      from_date: "f",
      to_date: "t",
      headers: ["h"],
      series: { s: {} },
      params: { p: 1 },
      meta: { m: 2 },
    });
    const d = qr.toJSON();
    expect(d["computed_at"]).toBe("ts");
    expect(d["from_date"]).toBe("f");
    expect(d["to_date"]).toBe("t");
    expect(d["headers"]).toStrictEqual(["h"]);
    expect(d["series"]).toStrictEqual({ s: {} });
    expect(d["params"]).toStrictEqual({ p: 1 });
    expect(d["meta"]).toStrictEqual({ m: 2 });
  });
});
