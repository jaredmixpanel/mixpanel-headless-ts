// Translated funnel-transform tests (B5-S2, packet §3 + §8): the B3-K3
// deferral (`B3-K3-notes.md:85-92`) — assertion-for-assertion port of
// tests/test_transform_funnel.py (R10.2), BOTH classes
// (TestExtractFunnelStepsFromSeries :57, TestTransformFunnelResult
// :338).
//
// Translation notes:
// - `_extract_funnel_steps_from_series` / `_transform_funnel_result` are
//   {@link extractFunnelStepsFromSeries} / {@link transformFunnelResult}
//   in `services/live-query-transforms.ts` (R7.2 split). Both take the
//   `warnings.warn` sink explicitly (R9.5) — the tests pass a collector.
// - Python `assert result is steps` (IDENTITY) stays identity here
//   (`toBe`): the pass-through branches must not copy.
// - `pytest.warns(UserWarning, match="unrecognized format")` becomes an
//   assertion on the collected sink messages.
// - `exc_info.value.status_code` / `.response_body` / `.request_body`
//   are the Phase-2 `statusCode` / `responseBody` / `requestBody`
//   fields of `QueryError` (`errors.ts:837`).

import { describe, expect, it } from "vitest";

import { QueryError } from "../../src/errors.js";
import { AttributeError } from "../../src/query/python-builtins.js";
import {
  extractFunnelStepsFromSeries,
  transformFunnel,
  transformFunnelResult,
  transformRetention,
} from "../../src/services/live-query-transforms.js";
import { FunnelQueryResult } from "../../src/types/results/query-engine.js";

// ===========================================================================
// Shared fixtures (test_transform_funnel.py:20-48)
// ===========================================================================

const SAMPLE_STEPS: Array<Record<string, unknown>> = [
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
];

const MOCK_RESPONSE: Record<string, unknown> = {
  computed_at: "2025-01-15T12:00:00",
  date_range: { from_date: "2025-01-01", to_date: "2025-01-31" },
  headers: ["$funnel"],
  series: { steps: SAMPLE_STEPS },
  meta: { sampling_factor: 1.0 },
};

const BOOKMARK_PARAMS: Record<string, unknown> = {
  sections: {},
  displayOptions: {},
};

/** A warning collector standing in for Python's warnings machinery. */
function warnCollector(): { warn: (m: string) => void; messages: string[] } {
  const messages: string[] = [];
  return {
    warn: (m: string): void => {
      messages.push(m);
    },
    messages,
  };
}

/** A no-op warning sink for the cases Python does not assert warnings on. */
const noWarn = (): void => {};

// ===========================================================================
// TestExtractFunnelStepsFromSeries (T020b)
// ===========================================================================

describe("TestExtractFunnelStepsFromSeries", () => {
  it("direct list input is returned unchanged", () => {
    const steps = [{ event: "Signup", count: 100 }];
    expect(extractFunnelStepsFromSeries(steps, noWarn)).toBe(steps);
  });

  it("dict containing 'steps' returns the steps list", () => {
    const series = { steps: SAMPLE_STEPS };
    expect(extractFunnelStepsFromSeries(series, noWarn)).toBe(SAMPLE_STEPS);
  });

  it("segmented '$overall' dict containing 'steps' returns those steps", () => {
    const innerSteps = [{ event: "Login", count: 500 }];
    const series = { $overall: { steps: innerSteps } };
    expect(extractFunnelStepsFromSeries(series, noWarn)).toBe(innerSteps);
  });

  it("segmented '$overall' as a list returns that list", () => {
    const overallList: Array<Record<string, unknown>> = [
      { event: "Signup", count: 200 },
    ];
    const series = { $overall: overallList };
    expect(extractFunnelStepsFromSeries(series, noWarn)).toBe(overallList);
  });

  it("empty dict returns an empty list", () => {
    expect(extractFunnelStepsFromSeries({}, noWarn)).toEqual([]);
  });

  it("non-dict input (int) returns an empty list", () => {
    expect(extractFunnelStepsFromSeries(42, noWarn)).toEqual([]);
  });

  it("non-dict input (string) returns an empty list", () => {
    expect(extractFunnelStepsFromSeries("not a dict", noWarn)).toEqual([]);
  });

  it("non-dict input (None) returns an empty list", () => {
    expect(extractFunnelStepsFromSeries(null, noWarn)).toEqual([]);
  });

  it("'steps' takes precedence over '$overall'", () => {
    const directSteps = [{ event: "Direct", count: 1 }];
    const overallSteps = [{ event: "Overall", count: 2 }];
    const series = { steps: directSteps, $overall: { steps: overallSteps } };
    expect(extractFunnelStepsFromSeries(series, noWarn)).toBe(directSteps);
  });

  it("empty list input is returned unchanged", () => {
    expect(extractFunnelStepsFromSeries([], noWarn)).toEqual([]);
  });

  it("dict whose 'steps' value is not a list falls through to '$overall'", () => {
    const series: Record<string, unknown> = {
      steps: "not a list",
      $overall: [{ event: "Fallback" }],
    };
    expect(extractFunnelStepsFromSeries(series, noWarn)).toEqual([
      { event: "Fallback" },
    ]);
  });

  it("dict with unrelated keys warns and returns an empty list", () => {
    const series = { foo: "bar", baz: [1, 2, 3] };
    const sink = warnCollector();

    const result = extractFunnelStepsFromSeries(series, sink.warn);

    expect(sink.messages).toHaveLength(1);
    expect(sink.messages[0]).toContain("unrecognized format");
    expect(result).toEqual([]);
  });

  // -------------------------------------------------------------------
  // Insights API nested series format (live_query.py:367-437)
  // -------------------------------------------------------------------

  it("canonical insights format extracts step data correctly", () => {
    const series = {
      "Signup through Purchase": {
        count: { "1. Signup": { all: 1000 }, "2. Purchase": { all: 120 } },
        step_conv_ratio: {
          "1. Signup": { all: 1.0 },
          "2. Purchase": { all: 0.12 },
        },
        overall_conv_ratio: {
          "1. Signup": { all: 1.0 },
          "2. Purchase": { all: 0.12 },
        },
        avg_time: { "1. Signup": { all: 0 }, "2. Purchase": { all: 86400 } },
        avg_time_from_start: {
          "1. Signup": { all: 0 },
          "2. Purchase": { all: 86400 },
        },
      },
    };

    const result = extractFunnelStepsFromSeries(series, noWarn);

    expect(result).toHaveLength(2);
    expect(result[0]!["event"]).toBe("Signup");
    expect(result[0]!["count"]).toBe(1000);
    expect(result[0]!["step_conv_ratio"]).toBe(1.0);
    expect(result[1]!["event"]).toBe("Purchase");
    expect(result[1]!["count"]).toBe(120);
    expect(result[1]!["overall_conv_ratio"]).toBe(0.12);
    expect(result[1]!["avg_time"]).toBe(86400);
  });

  it("steps with 10+ entries sort numerically, not lexicographically", () => {
    const countData: Record<string, unknown> = {};
    for (let i = 1; i < 12; i += 1) {
      countData[`${i}. Step${i}`] = { all: 1000 - i * 100 };
    }
    const series = { Funnel: { count: countData } };

    const result = extractFunnelStepsFromSeries(series, noWarn);

    expect(result).toHaveLength(11);
    // Step 10 should come after step 9, not after step 1
    expect(result[0]!["event"]).toBe("Step1");
    expect(result[8]!["event"]).toBe("Step9");
    expect(result[9]!["event"]).toBe("Step10");
    expect(result[10]!["event"]).toBe("Step11");
  });

  it("segmented format extracts $overall metrics", () => {
    const series = {
      "Signup through Purchase": {
        $overall: {
          count: { "1. Signup": { all: 500 }, "2. Purchase": { all: 60 } },
          step_conv_ratio: {
            "1. Signup": { all: 1.0 },
            "2. Purchase": { all: 0.12 },
          },
          overall_conv_ratio: {
            "1. Signup": { all: 1.0 },
            "2. Purchase": { all: 0.12 },
          },
          avg_time: {},
          avg_time_from_start: {},
        },
        Chrome: { count: { "1. Signup": { all: 300 } } },
      },
    };

    const result = extractFunnelStepsFromSeries(series, noWarn);

    expect(result).toHaveLength(2);
    expect(result[0]!["event"]).toBe("Signup");
    expect(result[0]!["count"]).toBe(500);
  });

  it("missing metric keys default to 0", () => {
    const series = {
      Funnel: {
        count: { "1. Signup": { all: 100 }, "2. Purchase": { all: 10 } },
        // No step_conv_ratio / overall_conv_ratio / avg_time /
        // avg_time_from_start
      },
    };

    const result = extractFunnelStepsFromSeries(series, noWarn);

    expect(result).toHaveLength(2);
    expect(result[0]!["step_conv_ratio"]).toBe(0);
    expect(result[0]!["overall_conv_ratio"]).toBe(0);
    expect(result[0]!["avg_time"]).toBe(0);
    expect(result[0]!["avg_time_from_start"]).toBe(0);
  });

  it("step names without a numeric prefix are used as-is", () => {
    const series = {
      Funnel: { count: { Signup: { all: 100 }, Purchase: { all: 10 } } },
    };

    const result = extractFunnelStepsFromSeries(series, noWarn);

    expect(result).toHaveLength(2);
    // Without a numeric prefix, sorted by the fallback key
    const events = result.map((s) => s["event"]);
    expect(events).toContain("Signup");
    expect(events).toContain("Purchase");
  });

  it("scalar metric values are returned directly", () => {
    const series = {
      Funnel: { count: { "1. Signup": 1000, "2. Purchase": 120 } },
    };

    const result = extractFunnelStepsFromSeries(series, noWarn);

    expect(result).toHaveLength(2);
    expect(result[0]!["count"]).toBe(1000);
    expect(result[1]!["count"]).toBe(120);
  });

  it("non-dict count data returns an empty list", () => {
    const series = { Funnel: { count: "not a dict" } };
    expect(extractFunnelStepsFromSeries(series, noWarn)).toEqual([]);
  });

  it("trends format extracts from the first date", () => {
    const series = {
      "Signup through Purchase": {
        "2025-01-01": {
          count: { "1. Signup": { all: 100 }, "2. Purchase": { all: 12 } },
        },
        "2025-01-02": { count: { "1. Signup": { all: 90 } } },
      },
    };

    const result = extractFunnelStepsFromSeries(series, noWarn);

    expect(result).toHaveLength(2);
    expect(result[0]!["event"]).toBe("Signup");
  });
});

// ===========================================================================
// TestTransformFunnelResult (T020)
// ===========================================================================

describe("TestTransformFunnelResult", () => {
  it("return type is FunnelQueryResult", () => {
    const result = transformFunnelResult(
      MOCK_RESPONSE,
      BOOKMARK_PARAMS,
      noWarn,
    );
    expect(result).toBeInstanceOf(FunnelQueryResult);
  });

  it("computed_at is extracted from the raw response", () => {
    const result = transformFunnelResult(
      MOCK_RESPONSE,
      BOOKMARK_PARAMS,
      noWarn,
    );
    expect(result.computed_at).toBe("2025-01-15T12:00:00");
  });

  it("from_date is extracted from raw['date_range']", () => {
    const result = transformFunnelResult(
      MOCK_RESPONSE,
      BOOKMARK_PARAMS,
      noWarn,
    );
    expect(result.from_date).toBe("2025-01-01");
  });

  it("to_date is extracted from raw['date_range']", () => {
    const result = transformFunnelResult(
      MOCK_RESPONSE,
      BOOKMARK_PARAMS,
      noWarn,
    );
    expect(result.to_date).toBe("2025-01-31");
  });

  it("steps_data is populated via the series extractor", () => {
    const result = transformFunnelResult(
      MOCK_RESPONSE,
      BOOKMARK_PARAMS,
      noWarn,
    );
    expect(result.steps_data).toEqual(SAMPLE_STEPS);
    expect(result.steps_data).toHaveLength(2);
    expect(result.steps_data[0]!["event"]).toBe("Signup");
    expect(result.steps_data[1]!["event"]).toBe("Purchase");
  });

  it("series preserves the raw series dict from the response", () => {
    const result = transformFunnelResult(
      MOCK_RESPONSE,
      BOOKMARK_PARAMS,
      noWarn,
    );
    expect(result.series).toEqual({ steps: SAMPLE_STEPS });
  });

  it("params preserves the bookmark_params argument", () => {
    const result = transformFunnelResult(
      MOCK_RESPONSE,
      BOOKMARK_PARAMS,
      noWarn,
    );
    expect(result.params).toEqual(BOOKMARK_PARAMS);
  });

  it("meta is extracted from raw['meta']", () => {
    const result = transformFunnelResult(
      MOCK_RESPONSE,
      BOOKMARK_PARAMS,
      noWarn,
    );
    expect(result.meta).toEqual({ sampling_factor: 1.0 });
  });

  it("response containing 'error' raises QueryError", () => {
    const errorResponse: Record<string, unknown> = { error: "invalid query" };
    expect(() =>
      transformFunnelResult(errorResponse, BOOKMARK_PARAMS, noWarn),
    ).toThrow(/invalid query/);
  });

  it("QueryError from an error response has statusCode 200", () => {
    const errorResponse: Record<string, unknown> = { error: "bad params" };
    try {
      transformFunnelResult(errorResponse, BOOKMARK_PARAMS, noWarn);
      expect.unreachable("expected QueryError");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryError);
      expect((error as QueryError).statusCode).toBe(200);
    }
  });

  it("QueryError includes the raw response as responseBody", () => {
    const errorResponse: Record<string, unknown> = { error: "timeout" };
    try {
      transformFunnelResult(errorResponse, BOOKMARK_PARAMS, noWarn);
      expect.unreachable("expected QueryError");
    } catch (error) {
      expect((error as QueryError).responseBody).toEqual(errorResponse);
    }
  });

  it("QueryError includes bookmark_params as requestBody", () => {
    const errorResponse: Record<string, unknown> = { error: "bad filter" };
    const params = { sections: { filters: "invalid" } };
    try {
      transformFunnelResult(errorResponse, params, noWarn);
      expect.unreachable("expected QueryError");
    } catch (error) {
      expect((error as QueryError).requestBody).toEqual(params);
    }
  });

  it("missing date_range defaults from_date and to_date to empty strings", () => {
    const raw: Record<string, unknown> = {
      computed_at: "2025-01-15T12:00:00",
      series: { steps: [] },
      meta: {},
    };

    const result = transformFunnelResult(raw, BOOKMARK_PARAMS, noWarn);

    expect(result.from_date).toBe("");
    expect(result.to_date).toBe("");
  });

  it("missing series raises QueryError", () => {
    const raw: Record<string, unknown> = {
      computed_at: "2025-01-15T12:00:00",
      date_range: { from_date: "2025-01-01", to_date: "2025-01-31" },
      meta: {},
    };

    expect(() => transformFunnelResult(raw, BOOKMARK_PARAMS, noWarn)).toThrow(
      /missing 'series' key/,
    );
  });

  it("missing meta defaults to an empty dict", () => {
    const raw: Record<string, unknown> = {
      computed_at: "2025-01-15T12:00:00",
      date_range: { from_date: "2025-01-01", to_date: "2025-01-31" },
      series: { steps: [] },
    };

    const result = transformFunnelResult(raw, BOOKMARK_PARAMS, noWarn);

    expect(result.meta).toEqual({});
  });

  it("missing computed_at defaults to an empty string", () => {
    const raw: Record<string, unknown> = {
      date_range: { from_date: "2025-01-01", to_date: "2025-01-31" },
      series: { steps: [] },
      meta: {},
    };

    const result = transformFunnelResult(raw, BOOKMARK_PARAMS, noWarn);

    expect(result.computed_at).toBe("");
  });

  it("minimal response with a series key produces defaults", () => {
    const raw: Record<string, unknown> = { series: {} };

    const result = transformFunnelResult(raw, {}, noWarn);

    expect(result).toBeInstanceOf(FunnelQueryResult);
    expect(result.computed_at).toBe("");
    expect(result.from_date).toBe("");
    expect(result.to_date).toBe("");
    expect(result.steps_data).toEqual([]);
    expect(result.series).toEqual({});
    expect(result.params).toEqual({});
    expect(result.meta).toEqual({});
  });

  it("completely empty response raises QueryError (missing series)", () => {
    expect(() => transformFunnelResult({}, {}, noWarn)).toThrow(
      /missing 'series' key/,
    );
  });

  it("segmented series with '$overall' extracts steps", () => {
    const steps = [{ event: "View", count: 500 }];
    const raw: Record<string, unknown> = {
      computed_at: "2025-02-01T00:00:00",
      date_range: { from_date: "2025-02-01", to_date: "2025-02-28" },
      series: { $overall: { steps } },
      meta: {},
    };

    const result = transformFunnelResult(raw, BOOKMARK_PARAMS, noWarn);

    expect(result.steps_data).toEqual(steps);
  });

  it("series preserves the raw segmented dict, not the extracted steps", () => {
    const segmentedSeries: Record<string, unknown> = {
      $overall: { steps: [{ event: "A" }] },
      segment_1: { steps: [{ event: "B" }] },
    };
    const raw: Record<string, unknown> = {
      computed_at: "2025-03-01T00:00:00",
      date_range: { from_date: "2025-03-01", to_date: "2025-03-31" },
      series: segmentedSeries,
      meta: {},
    };

    const result = transformFunnelResult(raw, BOOKMARK_PARAMS, noWarn);

    expect(result.series).toBe(segmentedSeries);
  });
});

// ===========================================================================
// R10.9 harness regressions (B5-S2): divergences the throwaway
// differential harness found against the Python arbiter, fixed at the
// owning layer (`throwaway/b5-s2/RUN.md`, divergence table rows T1/T2).
// ===========================================================================

describe("R10.9: AttributeError fidelity on non-mapping members", () => {
  it("transform_funnel with data=null raises AttributeError, not TypeError", () => {
    // Python: `raw.get("data", {})` yields `None`, and `None.items()`
    // raises `AttributeError` (`live_query.py:141`).
    expect(() =>
      transformFunnel({ data: null }, 42, "2025-01-01", "2025-01-31"),
    ).toThrow(AttributeError);
  });

  it("transform_funnel with a non-mapping data member raises AttributeError", () => {
    expect(() =>
      transformFunnel({ data: "nope" }, 42, "2025-01-01", "2025-01-31"),
    ).toThrow(AttributeError);
  });

  it("transform_retention with a non-mapping cohort raises AttributeError", () => {
    // Python: `cohort_data.get("first", 0)` on a `str`
    // (`live_query.py:198`).
    expect(() =>
      transformRetention(
        { "2025-01-01": "notadict" },
        "Signup",
        "Login",
        "2025-01-01",
        "2025-01-31",
        "day",
      ),
    ).toThrow(AttributeError);
  });

  it("transform_retention with a mapping cohort still succeeds", () => {
    const result = transformRetention(
      { "2025-01-01": { first: 100, counts: [100, 50] } },
      "Signup",
      "Login",
      "2025-01-01",
      "2025-01-31",
      "day",
    );
    expect(result.cohorts[0]!.retention).toEqual([1.0, 0.5]);
  });
});
