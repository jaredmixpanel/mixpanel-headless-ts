// transformRetentionResult: cohort / average extraction, QueryError paths,
// non-dict series rejection, segments, cohort-key date normalization and
// format variations. Mirrors tests/test_transform_retention.py (all six
// classes). `del raw[key]` cases build the record without the key; Python's
// `sorted(keys)` is code-point order, so ["Android", "iOS"] holds.

import { describe, expect, it } from "vitest";

import { sortedByCodepoint } from "../../src/compat/codepoint.js";
import { QueryError } from "../../src/errors.js";
import { transformRetentionResult } from "../../src/services/live-query-transforms.js";
import { RetentionQueryResult } from "../../src/types/results/query-engine.js";
import { expectThrows } from "../../test-support/raises.js";

// ===========================================================================
// Shared fixtures (test_transform_retention.py)
// ===========================================================================

const BOOKMARK_PARAMS: Record<string, unknown> = {
  sections: {},
  displayOptions: {},
};

/**
 * Build a mock retention API response with sensible defaults
 * (`_mock_response`, test_transform_retention.py).
 *
 * @param overrides - Keys to override in the default response dict.
 * @returns A record mimicking the retention query response shape.
 */
function mockResponse(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {
    computed_at: "2025-01-15T12:00:00",
    date_range: { from_date: "2025-01-01", to_date: "2025-01-31" },
    series: {
      "Signup and then Login": {
        "2025-01-01": {
          first: 100,
          counts: [100, 50, 25],
          rates: [1.0, 0.5, 0.25],
        },
        "2025-01-02": { first: 80, counts: [80, 40], rates: [1.0, 0.5] },
        $average: { first: 90, counts: [90, 45, 22], rates: [1.0, 0.5, 0.244] },
      },
    },
    meta: { sampling_factor: 1.0 },
  };
  return { ...defaults, ...overrides };
}

// ===========================================================================
// Basic extraction
// ===========================================================================

describe("Transform retention basic", () => {
  // python: TestTransformRetentionBasic
  it("return type is RetentionQueryResult", () => {
    const result = transformRetentionResult(mockResponse(), BOOKMARK_PARAMS);
    expect(result).toBeInstanceOf(RetentionQueryResult);
  });

  it("computed_at is extracted from the raw response", () => {
    const result = transformRetentionResult(mockResponse(), BOOKMARK_PARAMS);
    expect(result.computed_at).toBe("2025-01-15T12:00:00");
  });

  it("from_date is extracted from raw['date_range']", () => {
    const result = transformRetentionResult(mockResponse(), BOOKMARK_PARAMS);
    expect(result.from_date).toBe("2025-01-01");
  });

  it("to_date is extracted from raw['date_range']", () => {
    const result = transformRetentionResult(mockResponse(), BOOKMARK_PARAMS);
    expect(result.to_date).toBe("2025-01-31");
  });

  it("cohorts are extracted from series, excluding $average", () => {
    const result = transformRetentionResult(mockResponse(), BOOKMARK_PARAMS);
    expect(Object.hasOwn(result.cohorts, "2025-01-01")).toBe(true);
    expect(Object.hasOwn(result.cohorts, "2025-01-02")).toBe(true);
    expect(Object.keys(result.cohorts)).toHaveLength(2);
  });

  it("each cohort entry contains first, counts and rates", () => {
    const result = transformRetentionResult(mockResponse(), BOOKMARK_PARAMS);
    const cohort = result.cohorts["2025-01-01"]!;
    expect(cohort["first"]).toBe(100);
    expect(cohort["counts"]).toStrictEqual([100, 50, 25]);
    expect(cohort["rates"]).toStrictEqual([1.0, 0.5, 0.25]);
  });

  it("average is extracted from series['$average']", () => {
    const result = transformRetentionResult(mockResponse(), BOOKMARK_PARAMS);
    expect(result.average["first"]).toBe(90);
    expect(result.average["counts"]).toStrictEqual([90, 45, 22]);
    expect(result.average["rates"]).toStrictEqual([1.0, 0.5, 0.244]);
  });

  it("$average does not appear in the cohorts dict", () => {
    const result = transformRetentionResult(mockResponse(), BOOKMARK_PARAMS);
    expect(Object.hasOwn(result.cohorts, "$average")).toBe(false);
  });

  it("params preserves the bookmark_params argument", () => {
    const result = transformRetentionResult(mockResponse(), BOOKMARK_PARAMS);
    expect(result.params).toStrictEqual(BOOKMARK_PARAMS);
  });

  it("meta is extracted from raw['meta']", () => {
    const result = transformRetentionResult(mockResponse(), BOOKMARK_PARAMS);
    expect(result.meta).toStrictEqual({ sampling_factor: 1.0 });
  });
});

// ===========================================================================
// Errors
// ===========================================================================

describe("Transform retention errors", () => {
  // python: TestTransformRetentionErrors
  it("response containing 'error' raises QueryError with the message", () => {
    const errorResponse: Record<string, unknown> = { error: "invalid query" };
    expect(() =>
      transformRetentionResult(errorResponse, BOOKMARK_PARAMS),
    ).toThrow(QueryError);
    expect(() =>
      transformRetentionResult(errorResponse, BOOKMARK_PARAMS),
    ).toThrow(/invalid query/);
  });

  it("QueryError from an error response has statusCode 200", () => {
    const errorResponse: Record<string, unknown> = { error: "bad params" };
    const error = expectThrows(
      () => transformRetentionResult(errorResponse, BOOKMARK_PARAMS),
      "expected QueryError",
    );
    expect(error).toBeInstanceOf(QueryError);
    expect((error as QueryError).statusCode).toBe(200);
  });

  it("QueryError includes the raw response as responseBody", () => {
    const errorResponse: Record<string, unknown> = { error: "timeout" };
    const error = expectThrows(
      () => transformRetentionResult(errorResponse, BOOKMARK_PARAMS),
      "expected QueryError",
    );
    expect((error as QueryError).responseBody).toStrictEqual(errorResponse);
  });

  it("QueryError includes bookmark_params as requestBody", () => {
    const errorResponse: Record<string, unknown> = { error: "bad filter" };
    const params: Record<string, unknown> = {
      sections: { filters: "invalid" },
    };
    const error = expectThrows(
      () => transformRetentionResult(errorResponse, params),
      "expected QueryError",
    );
    expect((error as QueryError).requestBody).toStrictEqual(params);
  });

  it("missing series raises QueryError", () => {
    const raw: Record<string, unknown> = {
      computed_at: "2025-01-15T12:00:00",
      date_range: { from_date: "2025-01-01", to_date: "2025-01-31" },
      meta: {},
    };
    expect(() => transformRetentionResult(raw, BOOKMARK_PARAMS)).toThrow(
      QueryError,
    );
    expect(() => transformRetentionResult(raw, BOOKMARK_PARAMS)).toThrow(
      /missing 'series' key/,
    );
  });

  it("empty series produces empty cohorts", () => {
    const raw = mockResponse({ series: {} });
    const result = transformRetentionResult(raw, BOOKMARK_PARAMS);
    expect(result.cohorts).toStrictEqual({});
    expect(result.average).toStrictEqual({});
  });

  it("multiple top-level series keys raise QueryError", () => {
    const raw = mockResponse({
      series: {
        metric_a: { "2025-01-01": { first: 10, counts: [10], rates: [1.0] } },
        metric_b: { "2025-01-01": { first: 5, counts: [5], rates: [1.0] } },
      },
    });
    expect(() => transformRetentionResult(raw, BOOKMARK_PARAMS)).toThrow(
      QueryError,
    );
    expect(() => transformRetentionResult(raw, BOOKMARK_PARAMS)).toThrow(
      /segmented series/,
    );
  });

  it("$overall in the cohort data is unwrapped correctly", () => {
    const raw = mockResponse({
      series: {
        "Signup and then Login": {
          $overall: {
            "2025-01-01": { first: 100, counts: [100, 50], rates: [1.0, 0.5] },
            $average: { first: 100, counts: [100, 50], rates: [1.0, 0.5] },
          },
        },
      },
    });

    const result = transformRetentionResult(raw, BOOKMARK_PARAMS);

    expect(Object.hasOwn(result.cohorts, "2025-01-01")).toBe(true);
    expect(result.average["first"]).toBe(100);
  });

  it("$overall plus named segments populates the segments dict", () => {
    const raw = mockResponse({
      series: {
        "Signup and then Login": {
          $overall: {
            "2025-01-01": { first: 100, counts: [100, 50], rates: [1.0, 0.5] },
            $average: { first: 100, counts: [100, 50], rates: [1.0, 0.5] },
          },
          iOS: {
            "2025-01-01": { first: 60, counts: [60, 30], rates: [1.0, 0.5] },
            $average: { first: 60, counts: [60, 30], rates: [1.0, 0.5] },
          },
          Android: {
            "2025-01-01": { first: 40, counts: [40, 20], rates: [1.0, 0.5] },
            $average: { first: 40, counts: [40, 20], rates: [1.0, 0.5] },
          },
        },
      },
    });

    const result = transformRetentionResult(raw, BOOKMARK_PARAMS);

    expect(Object.hasOwn(result.segments, "iOS")).toBe(true);
    expect(Object.hasOwn(result.segments, "Android")).toBe(true);
    expect(Object.hasOwn(result.segment_averages, "iOS")).toBe(true);
    expect(Object.hasOwn(result.segment_averages, "Android")).toBe(true);
  });

  it("segmented response uses $overall for the primary cohorts field", () => {
    const raw = mockResponse({
      series: {
        "Signup and then Login": {
          $overall: {
            "2025-01-01": { first: 100, counts: [100, 50], rates: [1.0, 0.5] },
          },
          iOS: {
            "2025-01-01": { first: 60, counts: [60, 30], rates: [1.0, 0.5] },
          },
        },
      },
    });

    const result = transformRetentionResult(raw, BOOKMARK_PARAMS);

    expect(result.cohorts["2025-01-01"]!["first"]).toBe(100);
  });
});

// ===========================================================================
// Non-dict series
// ===========================================================================

describe("Transform retention non dict series", () => {
  // python: TestTransformRetentionNonDictSeries
  it("series=[] raises QueryError with a descriptive message", () => {
    const raw = mockResponse({ series: [] });
    expect(() => transformRetentionResult(raw, BOOKMARK_PARAMS)).toThrow(
      QueryError,
    );
    expect(() => transformRetentionResult(raw, BOOKMARK_PARAMS)).toThrow(
      /series.*list.*expected dict/,
    );
  });

  it("series='pending' raises QueryError", () => {
    const raw = mockResponse({ series: "pending" });
    expect(() => transformRetentionResult(raw, BOOKMARK_PARAMS)).toThrow(
      QueryError,
    );
    expect(() => transformRetentionResult(raw, BOOKMARK_PARAMS)).toThrow(
      /series.*str.*expected dict/,
    );
  });

  it("series=0 raises QueryError", () => {
    const raw = mockResponse({ series: 0 });
    expect(() => transformRetentionResult(raw, BOOKMARK_PARAMS)).toThrow(
      QueryError,
    );
    expect(() => transformRetentionResult(raw, BOOKMARK_PARAMS)).toThrow(
      /series.*int.*expected dict/,
    );
  });

  it("a string metric value raises QueryError", () => {
    const raw = mockResponse({
      series: { "Signup and then Login": "error: timeout" },
    });
    expect(() => transformRetentionResult(raw, BOOKMARK_PARAMS)).toThrow(
      QueryError,
    );
    expect(() => transformRetentionResult(raw, BOOKMARK_PARAMS)).toThrow(
      /not a dict.*got str/,
    );
  });

  it("a list metric value raises QueryError", () => {
    const raw = mockResponse({
      series: { "Signup and then Login": [1, 2, 3] },
    });
    expect(() => transformRetentionResult(raw, BOOKMARK_PARAMS)).toThrow(
      QueryError,
    );
    expect(() => transformRetentionResult(raw, BOOKMARK_PARAMS)).toThrow(
      /not a dict.*got list/,
    );
  });
});

// ===========================================================================
// Segments
// ===========================================================================

const SEGMENTED_SERIES: Record<string, unknown> = {
  "Signup and then Login": {
    $overall: {
      "2025-01-01": { first: 200, counts: [200, 100], rates: [1.0, 0.5] },
      $average: { first: 200, counts: [200, 100], rates: [1.0, 0.5] },
    },
    iOS: {
      "2025-01-01": { first: 120, counts: [120, 60], rates: [1.0, 0.5] },
      $average: { first: 120, counts: [120, 60], rates: [1.0, 0.5] },
    },
    Android: {
      "2025-01-01": { first: 80, counts: [80, 40], rates: [1.0, 0.5] },
      $average: { first: 80, counts: [80, 40], rates: [1.0, 0.5] },
    },
  },
};

describe("Transform retention segments", () => {
  // python: TestTransformRetentionSegments
  it("segment names match the response keys (excluding $overall)", () => {
    const raw = mockResponse({ series: SEGMENTED_SERIES });
    const result = transformRetentionResult(raw, BOOKMARK_PARAMS);
    expect(sortedByCodepoint(Object.keys(result.segments))).toStrictEqual([
      "Android",
      "iOS",
    ]);
  });

  it("each segment's cohort data is intact", () => {
    const raw = mockResponse({ series: SEGMENTED_SERIES });
    const result = transformRetentionResult(raw, BOOKMARK_PARAMS);

    const iosCohort = result.segments["iOS"]!["2025-01-01"]!;
    expect(iosCohort["first"]).toBe(120);
    expect(iosCohort["counts"]).toStrictEqual([120, 60]);
    expect(iosCohort["rates"]).toStrictEqual([1.0, 0.5]);
  });

  it("$average within each segment goes to segment_averages", () => {
    const raw = mockResponse({ series: SEGMENTED_SERIES });
    const result = transformRetentionResult(raw, BOOKMARK_PARAMS);

    expect(result.segment_averages["iOS"]!["first"]).toBe(120);
    expect(result.segment_averages["Android"]!["first"]).toBe(80);
  });

  it("unsegmented response has an empty segments dict", () => {
    const result = transformRetentionResult(mockResponse(), BOOKMARK_PARAMS);
    expect(result.segments).toStrictEqual({});
    expect(result.segment_averages).toStrictEqual({});
  });

  it("$overall with no named segments has empty segments", () => {
    const raw = mockResponse({
      series: {
        "Signup and then Login": {
          $overall: {
            "2025-01-01": { first: 100, counts: [100, 50], rates: [1.0, 0.5] },
          },
        },
      },
    });
    const result = transformRetentionResult(raw, BOOKMARK_PARAMS);
    expect(result.segments).toStrictEqual({});
    expect(result.segment_averages).toStrictEqual({});
  });
});

// ===========================================================================
// Date normalization
// ===========================================================================

describe("Transform retention date normalization", () => {
  // python: TestTransformRetentionDateNormalization
  it("ISO timestamp cohort keys are normalized to YYYY-MM-DD", () => {
    const raw = mockResponse({
      series: {
        "Signup and then Login": {
          "2025-01-01T00:00:00+00:00": {
            first: 100,
            counts: [100, 50],
            rates: [1.0, 0.5],
          },
          $average: { first: 100, counts: [100, 50], rates: [1.0, 0.5] },
        },
      },
    });

    const result = transformRetentionResult(raw, BOOKMARK_PARAMS);

    expect(Object.hasOwn(result.cohorts, "2025-01-01")).toBe(true);
    expect(Object.hasOwn(result.cohorts, "2025-01-01T00:00:00+00:00")).toBe(
      false,
    );
  });

  it("plain YYYY-MM-DD cohort keys are preserved as-is", () => {
    const result = transformRetentionResult(mockResponse(), BOOKMARK_PARAMS);
    expect(Object.hasOwn(result.cohorts, "2025-01-01")).toBe(true);
    expect(Object.hasOwn(result.cohorts, "2025-01-02")).toBe(true);
  });

  it("ISO timestamp keys are normalized within segment cohort data", () => {
    const raw = mockResponse({
      series: {
        "Signup and then Login": {
          $overall: {
            "2025-01-01T00:00:00+00:00": {
              first: 100,
              counts: [100, 50],
              rates: [1.0, 0.5],
            },
          },
          iOS: {
            "2025-01-01T00:00:00+00:00": {
              first: 60,
              counts: [60, 30],
              rates: [1.0, 0.5],
            },
          },
        },
      },
    });

    const result = transformRetentionResult(raw, BOOKMARK_PARAMS);

    expect(Object.hasOwn(result.cohorts, "2025-01-01")).toBe(true);
    expect(Object.hasOwn(result.segments["iOS"]!, "2025-01-01")).toBe(true);
  });
});

// ===========================================================================
// Format variations
// ===========================================================================

describe("Transform retention format variations", () => {
  // python: TestTransformRetentionFormatVariations
  it("direct cohort dict format is parsed correctly", () => {
    const result = transformRetentionResult(mockResponse(), BOOKMARK_PARAMS);
    expect(Object.keys(result.cohorts)).toHaveLength(2);
  });

  it("missing date_range produces empty from_date/to_date", () => {
    const raw = mockResponse();
    delete raw["date_range"];
    const result = transformRetentionResult(raw, BOOKMARK_PARAMS);
    expect(result.from_date).toBe("");
    expect(result.to_date).toBe("");
  });

  it("missing meta produces an empty dict", () => {
    const raw = mockResponse();
    delete raw["meta"];
    const result = transformRetentionResult(raw, BOOKMARK_PARAMS);
    expect(result.meta).toStrictEqual({});
  });

  it("missing computed_at produces an empty string", () => {
    const raw = mockResponse();
    delete raw["computed_at"];
    const result = transformRetentionResult(raw, BOOKMARK_PARAMS);
    expect(result.computed_at).toBe("");
  });

  it("series without $average produces an empty average dict", () => {
    const raw = mockResponse({
      series: {
        "Signup and then Login": {
          "2025-01-01": { first: 100, counts: [100, 50], rates: [1.0, 0.5] },
        },
      },
    });
    const result = transformRetentionResult(raw, BOOKMARK_PARAMS);
    expect(result.average).toStrictEqual({});
    expect(Object.keys(result.cohorts)).toHaveLength(1);
  });

  it("single cohort date in series is handled correctly", () => {
    const raw = mockResponse({
      series: {
        "Signup and then Login": {
          "2025-01-01": { first: 50, counts: [50, 25], rates: [1.0, 0.5] },
          $average: { first: 50, counts: [50, 25], rates: [1.0, 0.5] },
        },
      },
    });
    const result = transformRetentionResult(raw, BOOKMARK_PARAMS);
    expect(Object.keys(result.cohorts)).toHaveLength(1);
    expect(Object.hasOwn(result.cohorts, "2025-01-01")).toBe(true);
  });

  it("empty dict inside the metric wrapper produces empty cohorts", () => {
    const raw = mockResponse({ series: { "Signup and then Login": {} } });
    const result = transformRetentionResult(raw, BOOKMARK_PARAMS);
    expect(result.cohorts).toStrictEqual({});
    expect(result.average).toStrictEqual({});
  });
});
