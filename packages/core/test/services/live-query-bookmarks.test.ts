// Translated bookmark-method tests (B5-S2, packet §3): assertion-for-
// assertion port of tests/unit/test_live_query_bookmarks.py (R10.2) —
// BOTH classes (TestQueryFlows :15, TestQuerySavedReportNormalization
// :151).
//
// Translation notes:
// - Python uses bare `MagicMock()` clients, so the TS twin is
//   {@link mockClient}: a stub carrying only the two members the tested
//   methods touch (`querySavedFlows`, `querySavedReport`) plus a call
//   log. `assert_called_once_with(bookmark_id=..., ...)` reads that log;
//   Python's kwargs map to the TS positional id + options bag, so the
//   asserts compare `{bookmarkId, options}` with the same VALUES.
// - `result.report_type` is the Phase-2 `report_type` getter on
//   `SavedReportResult`.

import { describe, expect, it } from "vitest";

import type { MixpanelClient } from "../../src/client/client.js";
import type { JsonValue } from "../../src/client/json-value.js";
import { LiveQueryService } from "../../src/services/live-query.js";
import {
  FlowsResult,
  SavedReportResult,
} from "../../src/types/results/live-query.js";

/** One recorded `querySavedReport` call. */
interface SavedReportCall {
  /** The bookmark id argument. */
  readonly bookmarkId: number;
  /** The options bag (Python's three kwargs). */
  readonly options: Record<string, unknown> | undefined;
}

/** The `MagicMock()` twin plus its call logs. */
interface MockApiClient {
  /** The stub cast to the client type the service consumes. */
  readonly client: MixpanelClient;
  /** Every `querySavedFlows` bookmark id, in call order. */
  readonly savedFlowsCalls: number[];
  /** Every `querySavedReport` call, in call order. */
  readonly savedReportCalls: SavedReportCall[];
  /** Set the value the next stub call resolves with. */
  setReturnValue: (value: unknown) => void;
}

/**
 * Build a bare-`MagicMock` twin.
 *
 * @returns The stub client plus its call logs.
 */
function mockClient(): MockApiClient {
  const savedFlowsCalls: number[] = [];
  const savedReportCalls: SavedReportCall[] = [];
  let returnValue: unknown = {};
  const stub = {
    querySavedFlows: (bookmarkId: number): Promise<JsonValue> => {
      savedFlowsCalls.push(bookmarkId);
      return Promise.resolve(returnValue as JsonValue);
    },
    querySavedReport: (
      bookmarkId: number,
      options?: Record<string, unknown>,
    ): Promise<JsonValue> => {
      savedReportCalls.push({ bookmarkId, options });
      return Promise.resolve(returnValue as JsonValue);
    },
  };
  return {
    client: stub as unknown as MixpanelClient,
    savedFlowsCalls,
    savedReportCalls,
    setReturnValue(value: unknown): void {
      returnValue = value;
    },
  };
}

describe("TestQueryFlows", () => {
  it("returns FlowsResult", async () => {
    const mock = mockClient();
    mock.setReturnValue({
      steps: [{ step: 1, event: "Page View", count: 1000 }],
      breakdowns: [{ path: "A -> B", count: 500 }],
      overallConversionRate: 0.5,
      computed_at: "2024-01-15T10:00:00",
    });

    const result = await new LiveQueryService(mock.client).querySavedFlows(
      12345,
    );

    expect(result).toBeInstanceOf(FlowsResult);
    expect(result.bookmark_id).toBe(12345);
  });

  it("parses steps from the response", async () => {
    const mock = mockClient();
    mock.setReturnValue({
      steps: [
        { step: 1, event: "Page View", count: 1000 },
        { step: 2, event: "Add to Cart", count: 500 },
        { step: 3, event: "Purchase", count: 250 },
      ],
      breakdowns: [],
      overallConversionRate: 0.25,
      computed_at: "2024-01-15T10:00:00",
    });

    const result = await new LiveQueryService(mock.client).querySavedFlows(
      12345,
    );

    expect(result.steps).toHaveLength(3);
    expect(result.steps[0]!["event"]).toBe("Page View");
    expect(result.steps[2]!["count"]).toBe(250);
  });

  it("parses breakdowns from the response", async () => {
    const mock = mockClient();
    mock.setReturnValue({
      steps: [],
      breakdowns: [
        { path: "Page View -> Add to Cart", count: 500 },
        { path: "Add to Cart -> Purchase", count: 250 },
      ],
      overallConversionRate: 0.5,
      computed_at: "2024-01-15T10:00:00",
    });

    const result = await new LiveQueryService(mock.client).querySavedFlows(
      12345,
    );

    expect(result.breakdowns).toHaveLength(2);
    expect(result.breakdowns[0]!["path"]).toBe("Page View -> Add to Cart");
  });

  it("parses the overall conversion rate", async () => {
    const mock = mockClient();
    mock.setReturnValue({
      steps: [],
      breakdowns: [],
      overallConversionRate: 0.75,
      computed_at: "2024-01-15T10:00:00",
    });

    const result = await new LiveQueryService(mock.client).querySavedFlows(
      12345,
    );

    expect(result.overall_conversion_rate).toBe(0.75);
  });

  it("parses the computed_at timestamp", async () => {
    const mock = mockClient();
    mock.setReturnValue({
      steps: [],
      breakdowns: [],
      overallConversionRate: 0.0,
      computed_at: "2024-01-15T10:30:45",
    });

    const result = await new LiveQueryService(mock.client).querySavedFlows(
      12345,
    );

    expect(result.computed_at).toBe("2024-01-15T10:30:45");
  });

  it("parses optional metadata", async () => {
    const mock = mockClient();
    mock.setReturnValue({
      steps: [],
      breakdowns: [],
      overallConversionRate: 0.0,
      computed_at: "2024-01-15T10:00:00",
      metadata: { version: "2.0", custom: "value" },
    });

    const result = await new LiveQueryService(mock.client).querySavedFlows(
      12345,
    );

    expect(result.metadata).toStrictEqual({ version: "2.0", custom: "value" });
  });

  it("defaults to empty metadata when absent", async () => {
    const mock = mockClient();
    mock.setReturnValue({
      steps: [],
      breakdowns: [],
      overallConversionRate: 0.0,
      computed_at: "2024-01-15T10:00:00",
    });

    const result = await new LiveQueryService(mock.client).querySavedFlows(
      12345,
    );

    expect(result.metadata).toStrictEqual({});
  });

  it("calls the client with the bookmark id", async () => {
    const mock = mockClient();
    mock.setReturnValue({
      steps: [],
      breakdowns: [],
      overallConversionRate: 0.0,
      computed_at: "2024-01-15T10:00:00",
    });

    await new LiveQueryService(mock.client).querySavedFlows(12345);

    expect(mock.savedFlowsCalls).toStrictEqual([12345]);
  });
});

describe("TestQuerySavedReportNormalization", () => {
  it("insights responses preserve headers and series", async () => {
    const mock = mockClient();
    mock.setReturnValue({
      headers: ["$metric"],
      computed_at: "2024-01-15T10:00:00",
      date_range: { from_date: "2024-01-01", to_date: "2024-01-15" },
      series: { "Event A": { "2024-01-01": 100, "2024-01-02": 150 } },
    });

    const result = await new LiveQueryService(mock.client).querySavedReport(
      12345,
      { bookmark_type: "insights" },
    );

    expect(result).toBeInstanceOf(SavedReportResult);
    expect(result.headers).toStrictEqual(["$metric"]);
    expect(result.series).toStrictEqual({
      "Event A": { "2024-01-01": 100, "2024-01-02": 150 },
    });
  });

  it("funnels responses add the $funnel header", async () => {
    const mock = mockClient();
    mock.setReturnValue({
      computed_at: "2024-01-15T10:00:00",
      data: { "2024-01-15": { steps: [{ count: 100 }] } },
      meta: {},
    });

    const result = await new LiveQueryService(mock.client).querySavedReport(
      12345,
      { bookmark_type: "funnels" },
    );

    expect(result).toBeInstanceOf(SavedReportResult);
    expect(result.headers).toStrictEqual(["$funnel"]);
    expect(result.report_type).toBe("funnel");
  });

  it("funnels responses extract from_date/to_date from data keys", async () => {
    const mock = mockClient();
    mock.setReturnValue({
      computed_at: "2024-01-15T10:00:00",
      data: {
        "2024-01-10": { steps: [] },
        "2024-01-11": { steps: [] },
        "2024-01-15": { steps: [] },
      },
      meta: {},
    });

    const result = await new LiveQueryService(mock.client).querySavedReport(
      12345,
      { bookmark_type: "funnels" },
    );

    expect(result.from_date).toBe("2024-01-10");
    expect(result.to_date).toBe("2024-01-15");
  });

  it("funnels responses store data in the series field", async () => {
    const mock = mockClient();
    const funnelData = { "2024-01-15": { steps: [{ count: 100 }] } };
    mock.setReturnValue({
      computed_at: "2024-01-15T10:00:00",
      data: funnelData,
      meta: {},
    });

    const result = await new LiveQueryService(mock.client).querySavedReport(
      12345,
      { bookmark_type: "funnels" },
    );

    expect(result.series).toStrictEqual(funnelData);
  });

  it("retention responses add the $retention header", async () => {
    const mock = mockClient();
    mock.setReturnValue({
      "2024-01-01": {
        first: 100,
        counts: [100, 80, 60],
        rates: [1.0, 0.8, 0.6],
      },
      "2024-01-02": { first: 120, counts: [120, 90], rates: [1.0, 0.75] },
    });

    const result = await new LiveQueryService(mock.client).querySavedReport(
      12345,
      { bookmark_type: "retention" },
    );

    expect(result).toBeInstanceOf(SavedReportResult);
    expect(result.headers).toStrictEqual(["$retention"]);
    expect(result.report_type).toBe("retention");
  });

  it("retention responses use the entire raw response as series", async () => {
    const mock = mockClient();
    const retentionData = {
      "2024-01-01": { first: 100, counts: [100, 80], rates: [1.0, 0.8] },
    };
    mock.setReturnValue(retentionData);

    const result = await new LiveQueryService(mock.client).querySavedReport(
      12345,
      { bookmark_type: "retention" },
    );

    expect(result.series).toStrictEqual(retentionData);
  });

  it("retention responses extract from_date/to_date from keys", async () => {
    const mock = mockClient();
    mock.setReturnValue({
      "2024-01-05": { first: 100, counts: [100], rates: [1.0] },
      "2024-01-01": { first: 100, counts: [100], rates: [1.0] },
      "2024-01-10": { first: 100, counts: [100], rates: [1.0] },
    });

    const result = await new LiveQueryService(mock.client).querySavedReport(
      12345,
      { bookmark_type: "retention" },
    );

    expect(result.from_date).toBe("2024-01-01");
    expect(result.to_date).toBe("2024-01-10");
  });

  it("flows responses add the $flows header", async () => {
    const mock = mockClient();
    mock.setReturnValue({
      computed_at: "2024-01-15T10:00:00",
      steps: [{ step: 1, event: "Page View" }],
      breakdowns: [{ path: "A -> B" }],
      overallConversionRate: 0.5,
    });

    const result = await new LiveQueryService(mock.client).querySavedReport(
      12345,
      { bookmark_type: "flows" },
    );

    expect(result).toBeInstanceOf(SavedReportResult);
    expect(result.headers).toStrictEqual(["$flows"]);
  });

  it("flows responses structure the series correctly", async () => {
    const mock = mockClient();
    mock.setReturnValue({
      computed_at: "2024-01-15T10:00:00",
      steps: [{ step: 1, event: "Page View" }],
      breakdowns: [{ path: "A -> B", count: 100 }],
      overallConversionRate: 0.75,
    });

    const result = await new LiveQueryService(mock.client).querySavedReport(
      12345,
      { bookmark_type: "flows" },
    );

    const series = result.series as Record<string, unknown>;
    expect(Object.hasOwn(series, "steps")).toBe(true);
    expect(Object.hasOwn(series, "breakdowns")).toBe(true);
    expect(Object.hasOwn(series, "overallConversionRate")).toBe(true);
    expect(series["overallConversionRate"]).toBe(0.75);
  });

  it("passes bookmark_type to the client", async () => {
    const mock = mockClient();
    mock.setReturnValue({
      headers: ["$metric"],
      computed_at: "",
      date_range: { from_date: "", to_date: "" },
      series: {},
    });

    await new LiveQueryService(mock.client).querySavedReport(12345, {
      bookmark_type: "insights",
    });

    expect(mock.savedReportCalls).toHaveLength(1);
    expect(mock.savedReportCalls[0]).toStrictEqual({
      bookmarkId: 12345,
      options: {
        bookmark_type: "insights",
        from_date: null,
        to_date: null,
      },
    });
  });

  it("passes from_date/to_date for funnels", async () => {
    const mock = mockClient();
    mock.setReturnValue({ computed_at: "", data: {}, meta: {} });

    await new LiveQueryService(mock.client).querySavedReport(12345, {
      bookmark_type: "funnels",
      from_date: "2024-06-01",
      to_date: "2024-06-30",
    });

    expect(mock.savedReportCalls).toHaveLength(1);
    expect(mock.savedReportCalls[0]).toStrictEqual({
      bookmarkId: 12345,
      options: {
        bookmark_type: "funnels",
        from_date: "2024-06-01",
        to_date: "2024-06-30",
      },
    });
  });
});
