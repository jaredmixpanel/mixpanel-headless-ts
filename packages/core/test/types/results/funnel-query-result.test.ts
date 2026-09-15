// Translated FunnelQueryResult tests (packet P2-6):
// assertion-for-assertion port of tests/test_types_funnel.py
// (TestFunnelQueryResult) — R10.2. Same translation notes as
// query-result.test.ts; frozen-immutability tests not ported
// (compile-time `readonly`).
import { describe, expect, it } from "vitest";

import { FunnelQueryResult } from "../../../src/types/results/query-engine.js";

const SAMPLE_STEPS_DATA = [
  {
    event: "Signup",
    count: 1000,
    step_conv_ratio: 1.0,
    overall_conv_ratio: 1.0,
    avg_time: 0.0,
    avg_time_from_start: 0.0,
  },
  {
    event: "Purchase",
    count: 120,
    step_conv_ratio: 0.12,
    overall_conv_ratio: 0.12,
    avg_time: 86400.0,
    avg_time_from_start: 86400.0,
  },
] as const;

const BASE = {
  computed_at: "2025-04-05T12:00:00Z",
  from_date: "2025-01-01",
  to_date: "2025-03-31",
} as const;

describe("FunnelQueryResult (TestFunnelQueryResult)", () => {
  it("test_construction_with_required_fields", () => {
    const result = new FunnelQueryResult(BASE);
    expect(result.computed_at).toBe("2025-04-05T12:00:00Z");
    expect(result.from_date).toBe("2025-01-01");
    expect(result.to_date).toBe("2025-03-31");
  });

  it("test_default_values", () => {
    const result = new FunnelQueryResult(BASE);
    expect(result.steps_data).toEqual([]);
    expect(result.series).toEqual({});
    expect(result.params).toEqual({});
    expect(result.meta).toEqual({});
  });

  it("test_construction_with_all_fields", () => {
    const result = new FunnelQueryResult({
      ...BASE,
      steps_data: SAMPLE_STEPS_DATA,
      series: { key: "value" },
      params: { funnel_type: "steps" },
      meta: { is_cached: true },
    });
    expect(result.steps_data).toHaveLength(2);
    expect(result.series).toEqual({ key: "value" });
    expect(result.params).toEqual({ funnel_type: "steps" });
    expect(result.meta).toEqual({ is_cached: true });
  });

  it("test_overall_conversion_rate_with_steps", () => {
    const result = new FunnelQueryResult({
      ...BASE,
      steps_data: SAMPLE_STEPS_DATA,
    });
    expect(result.overall_conversion_rate).toBe(0.12);
  });

  it("test_overall_conversion_rate_empty_steps", () => {
    const result = new FunnelQueryResult(BASE);
    expect(result.overall_conversion_rate).toBe(0.0);
  });

  it("test_overall_conversion_rate_single_step", () => {
    const result = new FunnelQueryResult({
      ...BASE,
      steps_data: [
        {
          event: "Signup",
          count: 500,
          step_conv_ratio: 1.0,
          overall_conv_ratio: 1.0,
          avg_time: 0.0,
          avg_time_from_start: 0.0,
        },
      ],
    });
    expect(result.overall_conversion_rate).toBe(1.0);
  });

  it("test_overall_conversion_rate_missing_key", () => {
    const result = new FunnelQueryResult({
      ...BASE,
      steps_data: [{ event: "Signup", count: 100 }],
    });
    expect(result.overall_conversion_rate).toBe(0.0);
  });

  it("test_df_has_expected_columns", () => {
    const result = new FunnelQueryResult({
      ...BASE,
      steps_data: SAMPLE_STEPS_DATA,
    });
    expect(result.rowColumns()).toEqual([
      "step",
      "event",
      "count",
      "step_conv_ratio",
      "overall_conv_ratio",
      "avg_time",
      "avg_time_from_start",
    ]);
  });

  it("test_df_row_count_matches_steps", () => {
    const result = new FunnelQueryResult({
      ...BASE,
      steps_data: SAMPLE_STEPS_DATA,
    });
    expect(result.toRows()).toHaveLength(2);
  });

  it("test_df_step_numbers_are_one_indexed", () => {
    const result = new FunnelQueryResult({
      ...BASE,
      steps_data: SAMPLE_STEPS_DATA,
    });
    expect(result.toRows().map((row) => row["step"])).toEqual([1, 2]);
  });

  it("test_df_values_match_steps_data", () => {
    const result = new FunnelQueryResult({
      ...BASE,
      steps_data: SAMPLE_STEPS_DATA,
    });
    const rows = result.toRows();
    expect(rows.map((row) => row["event"])).toEqual(["Signup", "Purchase"]);
    expect(rows.map((row) => row["count"])).toEqual([1000, 120]);
    expect(rows.map((row) => row["step_conv_ratio"])).toEqual([1.0, 0.12]);
    expect(rows.map((row) => row["overall_conv_ratio"])).toEqual([1.0, 0.12]);
    expect(rows.map((row) => row["avg_time"])).toEqual([0.0, 86400.0]);
    expect(rows.map((row) => row["avg_time_from_start"])).toEqual([
      0.0, 86400.0,
    ]);
  });

  it("test_df_empty_steps_data", () => {
    const result = new FunnelQueryResult(BASE);
    expect(result.toRows()).toHaveLength(0);
    expect(result.rowColumns()).toEqual([
      "step",
      "event",
      "count",
      "step_conv_ratio",
      "overall_conv_ratio",
      "avg_time",
      "avg_time_from_start",
    ]);
  });

  it("test_df_cached (determinism)", () => {
    const result = new FunnelQueryResult({
      ...BASE,
      steps_data: SAMPLE_STEPS_DATA,
    });
    expect(result.toRows()).toEqual(result.toRows());
  });

  it("test_df_handles_missing_keys_in_steps_data", () => {
    const result = new FunnelQueryResult({
      ...BASE,
      steps_data: [{ event: "Signup" }],
    });
    const rows = result.toRows();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.["count"]).toBe(0);
    expect(row?.["step_conv_ratio"]).toBe(0.0);
    expect(row?.["overall_conv_ratio"]).toBe(0.0);
    expect(row?.["avg_time"]).toBe(0.0);
    expect(row?.["avg_time_from_start"]).toBe(0.0);
  });

  it("test_df_handles_missing_event_name", () => {
    const result = new FunnelQueryResult({
      ...BASE,
      steps_data: [{ count: 100 }],
    });
    expect(result.toRows()[0]?.["event"]).toBe("Step 1");
  });

  it("test_to_dict_returns_all_fields", () => {
    const result = new FunnelQueryResult({
      ...BASE,
      steps_data: SAMPLE_STEPS_DATA,
      series: { raw: "data" },
      params: { funnel_type: "steps" },
      meta: { is_cached: false },
    });
    const data = result.toJSON();
    expect(data["computed_at"]).toBe("2025-04-05T12:00:00Z");
    expect(data["from_date"]).toBe("2025-01-01");
    expect(data["to_date"]).toBe("2025-03-31");
    expect(data["steps_data"]).toEqual(SAMPLE_STEPS_DATA);
    expect(data["series"]).toEqual({ raw: "data" });
    expect(data["params"]).toEqual({ funnel_type: "steps" });
    expect(data["meta"]).toEqual({ is_cached: false });
  });

  it("test_to_dict_json_serializable", () => {
    const result = new FunnelQueryResult({
      ...BASE,
      steps_data: SAMPLE_STEPS_DATA,
      params: { funnel_type: "steps" },
    });
    const json_str = JSON.stringify(result.toJSON());
    expect(json_str).toContain("2025-04-05T12:00:00Z");
    expect(json_str).toContain("Signup");
    expect(json_str).toContain("Purchase");
  });

  it("test_to_dict_with_defaults", () => {
    const result = new FunnelQueryResult(BASE);
    const data = result.toJSON();
    expect(data["steps_data"]).toEqual([]);
    expect(data["series"]).toEqual({});
    expect(data["params"]).toEqual({});
    expect(data["meta"]).toEqual({});
  });
});
