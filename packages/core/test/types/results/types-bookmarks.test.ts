// Translated result-class tests (packet P2-6): assertion-for-assertion
// port of tests/unit/test_types_bookmarks.py (R10.2) — the
// SavedReportResult / FlowsResult per-class row specs (phase2-design
// C6) and BookmarkInfo's conditional to_dict.
//
// Same translation notes as types.test.ts: `.df` -> `toRows()`/
// `rowColumns()`; identity-caching tests -> repeated-call determinism;
// frozen-dataclass suites not ported (compile-time `readonly`);
// `TestTypeAliases` is P2-3 surface (locked by the C8d alias tests).
import { describe, expect, it } from "vitest";

import type { BookmarkType } from "../../../src/types/literals.js";
import { BookmarkInfo } from "../../../src/types/results/discovery.js";
import {
  FlowsResult,
  SavedReportResult,
} from "../../../src/types/results/live-query.js";

describe("SavedReportResult (TestSavedReportResult)", () => {
  it("test_create_insights_report", () => {
    const result = new SavedReportResult({
      bookmark_id: 12345,
      computed_at: "2024-01-15T10:30:00",
      from_date: "2024-01-01",
      to_date: "2024-01-14",
      headers: ["$event"],
      series: {
        "Page View": { "2024-01-01": 100, "2024-01-02": 150 },
        "Sign Up": { "2024-01-01": 10, "2024-01-02": 15 },
      },
    });
    expect(result.bookmark_id).toBe(12345);
    expect(result.computed_at).toBe("2024-01-15T10:30:00");
    expect(result.from_date).toBe("2024-01-01");
    expect(result.to_date).toBe("2024-01-14");
    expect(result.headers).toStrictEqual(["$event"]);
  });

  const bare = (headers: readonly string[]): SavedReportResult =>
    new SavedReportResult({
      bookmark_id: 1,
      computed_at: "2024-01-01T00:00:00",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      headers,
      series: {},
    });

  it("test_report_type_insights", () => {
    expect(bare(["$event", "Date"]).report_type).toBe("insights");
  });

  it("test_report_type_retention", () => {
    expect(bare(["$retention"]).report_type).toBe("retention");
  });

  it("test_report_type_retention_case_insensitive", () => {
    expect(bare(["$RETENTION"]).report_type).toBe("retention");
  });

  it("test_report_type_funnel", () => {
    expect(bare(["$funnel"]).report_type).toBe("funnel");
  });

  it("test_report_type_funnel_case_insensitive", () => {
    expect(bare(["$FUNNEL"]).report_type).toBe("funnel");
  });

  it("test_report_type_empty_headers", () => {
    expect(bare([]).report_type).toBe("insights");
  });

  it("test_df_property_insights", () => {
    const result = new SavedReportResult({
      bookmark_id: 1,
      computed_at: "2024-01-01T00:00:00",
      from_date: "2024-01-01",
      to_date: "2024-01-02",
      headers: ["$event"],
      series: {
        "Page View": { "2024-01-01": 100, "2024-01-02": 150 },
        "Sign Up": { "2024-01-01": 10, "2024-01-02": 15 },
      },
    });
    expect(result.toRows()).toHaveLength(4);
    expect(new Set(result.rowColumns())).toStrictEqual(
      new Set(["date", "event", "count"]),
    );
  });

  it("test_df_property_cached (determinism)", () => {
    const result = new SavedReportResult({
      bookmark_id: 1,
      computed_at: "2024-01-01T00:00:00",
      from_date: "2024-01-01",
      to_date: "2024-01-02",
      headers: [],
      series: { Event: { "2024-01-01": 100 } },
    });
    expect(result.toRows()).toStrictEqual(result.toRows());
  });

  it("test_df_property_empty_series", () => {
    const result = bare([]);
    expect(result.toRows()).toHaveLength(0);
    expect(result.rowColumns()).toStrictEqual(["date", "event", "count"]);
  });

  it("non-insights branch returns ONE row whose series cell is the nested dict (C6 per-class row spec)", () => {
    // The design's F3 respec: the non-insights branch is
    // `pd.DataFrame([{"series": self.series}])`.
    const series = { cohorts: [1, 2, 3] };
    const result = new SavedReportResult({
      bookmark_id: 1,
      computed_at: "2024-01-01T00:00:00",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      headers: ["$retention"],
      series,
    });
    expect(result.toRows()).toStrictEqual([{ series }]);
    expect(result.rowColumns()).toStrictEqual(["series"]);
  });

  it("test_to_dict", () => {
    const result = new SavedReportResult({
      bookmark_id: 12345,
      computed_at: "2024-01-15T10:30:00",
      from_date: "2024-01-01",
      to_date: "2024-01-14",
      headers: ["$event"],
      series: { Event: { "2024-01-01": 100 } },
    });
    const d = result.toJSON();
    expect(d["bookmark_id"]).toBe(12345);
    expect(d["computed_at"]).toBe("2024-01-15T10:30:00");
    expect(d["from_date"]).toBe("2024-01-01");
    expect(d["to_date"]).toBe("2024-01-14");
    expect(d["headers"]).toStrictEqual(["$event"]);
    expect(d["series"]).toStrictEqual({ Event: { "2024-01-01": 100 } });
    expect(d["report_type"]).toBe("insights");
  });
});

describe("FlowsResult (TestFlowsResult)", () => {
  it("test_create_flows_result", () => {
    const result = new FlowsResult({
      bookmark_id: 12345,
      computed_at: "2024-01-15T10:30:00",
      steps: [
        { step: 1, event: "Page View", count: 1000 },
        { step: 2, event: "Add to Cart", count: 500 },
      ],
      breakdowns: [{ path: "Page View -> Add to Cart", count: 500 }],
      overall_conversion_rate: 0.5,
      metadata: { version: "1.0" },
    });
    expect(result.bookmark_id).toBe(12345);
    expect(result.computed_at).toBe("2024-01-15T10:30:00");
    expect(result.steps).toHaveLength(2);
    expect(result.breakdowns).toHaveLength(1);
    expect(result.overall_conversion_rate).toBe(0.5);
    expect(result.metadata).toStrictEqual({ version: "1.0" });
  });

  it("test_df_property", () => {
    const result = new FlowsResult({
      bookmark_id: 1,
      computed_at: "2024-01-01T00:00:00",
      steps: [
        { step: 1, event: "Page View", count: 1000 },
        { step: 2, event: "Add to Cart", count: 500 },
      ],
      breakdowns: [],
      overall_conversion_rate: 0.5,
    });
    expect(result.toRows()).toHaveLength(2);
    expect(result.rowColumns()).toContain("step");
    expect(result.rowColumns()).toContain("event");
    expect(result.rowColumns()).toContain("count");
  });

  it("test_df_property_cached (determinism)", () => {
    const result = new FlowsResult({
      bookmark_id: 1,
      computed_at: "2024-01-01T00:00:00",
      steps: [{ step: 1, event: "Event", count: 100 }],
      breakdowns: [],
      overall_conversion_rate: 1.0,
    });
    expect(result.toRows()).toStrictEqual(result.toRows());
  });

  it("test_df_property_empty_steps", () => {
    const result = new FlowsResult({
      bookmark_id: 1,
      computed_at: "2024-01-01T00:00:00",
      steps: [],
      breakdowns: [],
      overall_conversion_rate: 0.0,
    });
    expect(result.toRows()).toHaveLength(0);
    // The Python empty case is a bare pd.DataFrame() — NO column list
    // (phase2-design C6 per-class row spec).
    expect(result.rowColumns()).toStrictEqual([]);
  });

  it("test_to_dict", () => {
    const result = new FlowsResult({
      bookmark_id: 12345,
      computed_at: "2024-01-15T10:30:00",
      steps: [{ step: 1, event: "Event", count: 100 }],
      breakdowns: [{ path: "A -> B", count: 50 }],
      overall_conversion_rate: 0.5,
      metadata: { key: "value" },
    });
    const d = result.toJSON();
    expect(d["bookmark_id"]).toBe(12345);
    expect(d["computed_at"]).toBe("2024-01-15T10:30:00");
    expect(d["steps"]).toStrictEqual([{ step: 1, event: "Event", count: 100 }]);
    expect(d["breakdowns"]).toStrictEqual([{ path: "A -> B", count: 50 }]);
    expect(d["overall_conversion_rate"]).toBe(0.5);
    expect(d["metadata"]).toStrictEqual({ key: "value" });
  });

  it("test_default_values", () => {
    const result = new FlowsResult({
      bookmark_id: 1,
      computed_at: "2024-01-01T00:00:00",
    });
    expect(result.steps).toStrictEqual([]);
    expect(result.breakdowns).toStrictEqual([]);
    expect(result.overall_conversion_rate).toBe(0.0);
    expect(result.metadata).toStrictEqual({});
  });
});

describe("BookmarkInfo (TestBookmarkInfo)", () => {
  it("test_create_bookmark_info", () => {
    const info = new BookmarkInfo({
      id: 12345,
      name: "Weekly Active Users",
      type: "insights",
      project_id: 100,
      created: "2024-01-01T00:00:00",
      modified: "2024-01-15T10:30:00",
    });
    expect(info.id).toBe(12345);
    expect(info.name).toBe("Weekly Active Users");
    expect(info.type).toBe("insights");
    expect(info.project_id).toBe(100);
    expect(info.created).toBe("2024-01-01T00:00:00");
    expect(info.modified).toBe("2024-01-15T10:30:00");
  });

  it("test_create_with_optional_fields", () => {
    const info = new BookmarkInfo({
      id: 12345,
      name: "User Funnel",
      type: "funnels",
      project_id: 100,
      created: "2024-01-01T00:00:00",
      modified: "2024-01-15T10:30:00",
      workspace_id: 1,
      dashboard_id: 5,
      description: "Main conversion funnel",
      creator_id: 42,
      creator_name: "John Doe",
    });
    expect(info.workspace_id).toBe(1);
    expect(info.dashboard_id).toBe(5);
    expect(info.description).toBe("Main conversion funnel");
    expect(info.creator_id).toBe(42);
    expect(info.creator_name).toBe("John Doe");
  });

  it("test_default_optional_fields", () => {
    const info = new BookmarkInfo({
      id: 1,
      name: "Test",
      type: "insights",
      project_id: 100,
      created: "2024-01-01T00:00:00",
      modified: "2024-01-01T00:00:00",
    });
    expect(info.workspace_id).toBeNull();
    expect(info.dashboard_id).toBeNull();
    expect(info.description).toBeNull();
    expect(info.creator_id).toBeNull();
    expect(info.creator_name).toBeNull();
  });

  it("test_to_dict_minimal", () => {
    const info = new BookmarkInfo({
      id: 12345,
      name: "Test Report",
      type: "retention",
      project_id: 100,
      created: "2024-01-01T00:00:00",
      modified: "2024-01-15T10:30:00",
    });
    const d = info.toJSON();
    expect(d["id"]).toBe(12345);
    expect(d["name"]).toBe("Test Report");
    expect(d["type"]).toBe("retention");
    expect(d["project_id"]).toBe(100);
    expect(d["created"]).toBe("2024-01-01T00:00:00");
    expect(d["modified"]).toBe("2024-01-15T10:30:00");
    // Optional fields should not be in dict when None.
    expect(Object.hasOwn(d, "workspace_id")).toBe(false);
    expect(Object.hasOwn(d, "dashboard_id")).toBe(false);
    expect(Object.hasOwn(d, "description")).toBe(false);
    expect(Object.hasOwn(d, "creator_id")).toBe(false);
    expect(Object.hasOwn(d, "creator_name")).toBe(false);
  });

  it("test_to_dict_with_optional_fields", () => {
    const info = new BookmarkInfo({
      id: 12345,
      name: "Test Report",
      type: "flows",
      project_id: 100,
      created: "2024-01-01T00:00:00",
      modified: "2024-01-15T10:30:00",
      workspace_id: 1,
      dashboard_id: 5,
      description: "A test",
      creator_id: 42,
      creator_name: "Test User",
    });
    const d = info.toJSON();
    expect(d["workspace_id"]).toBe(1);
    expect(d["dashboard_id"]).toBe(5);
    expect(d["description"]).toBe("A test");
    expect(d["creator_id"]).toBe(42);
    expect(d["creator_name"]).toBe("Test User");
  });

  it("test_all_bookmark_types", () => {
    const bookmarkTypes: readonly BookmarkType[] = [
      "insights",
      "funnels",
      "retention",
      "flows",
      "launch-analysis",
    ];
    for (const bmType of bookmarkTypes) {
      const info = new BookmarkInfo({
        id: 1,
        name: "Test",
        type: bmType,
        project_id: 100,
        created: "2024-01-01T00:00:00",
        modified: "2024-01-01T00:00:00",
      });
      expect(info.type).toBe(bmType);
    }
  });
});
