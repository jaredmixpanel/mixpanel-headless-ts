/**
 * Layer-3 translation of the `validate_flow_bookmark` classes of
 * `tests/test_validation_flow.py` (Python revision:
 * `ts-port/phase2-contract-support` HEAD; 1,066 LOC).
 *
 * Scope per b2-packets.md §V1b: `TestValidateFlowBookmarkFLB1` (4),
 * `FLB2` (5), `FLB3` (6), `FLB4` (6), `FLB5` (3), `FLB6` (5) and
 * `TestValidateFlowBookmarkDefaults` (1) — 30 tests, the exact set
 * shard V1a deferred (`validation-flow.test.ts` header). The
 * `validate_flow_args` classes of the same source file were translated
 * by V1a; this sibling file cites the same source per the packet's
 * "or a sibling `validation-flow-bookmark.test.ts`" option.
 *
 * R10.2: assertion-for-assertion.
 */

import { describe, expect, it } from "vitest";

import type { ValidationError } from "../../src/errors.js";
import { validateFlowBookmark } from "../../src/query/validation-bookmark.js";
import { codes } from "../../test-support/error-codes.js";

/** Loose dict, the TS analogue of Python's `dict[str, Any]`. */
type Dict = Record<string, unknown>;

/**
 * Build a default-valid params dict for `validateFlowBookmark`.
 *
 * Port of `_valid_flow_bookmark`.
 *
 * @param overrides - Keys to override in the defaults.
 * @returns A fresh flow bookmark params dict.
 */
function validFlowBookmark(overrides: Dict = {}): Dict {
  const defaults: Dict = {
    steps: [{ event: "Purchase", forward: 3, reverse: 0 }],
    date_range: {
      type: "in the last",
      from_date: { unit: "day", value: 30 },
      to_date: "$now",
    },
    chartType: "sankey",
    count_type: "unique",
    version: 2,
  };
  return { ...defaults, ...overrides };
}

/**
 * Filter errors by code equality.
 *
 * @param errors - Validation errors.
 * @param code - Exact code to match.
 * @returns The matching errors, in emission order.
 */
function withCode(
  errors: readonly ValidationError[],
  code: string,
): ValidationError[] {
  return errors.filter((e) => e.code === code);
}

// =============================================================================
// T018: FLB1 — steps must be present and non-empty
// =============================================================================

describe("TestValidateFlowBookmarkFLB1", () => {
  it("test_empty_steps_returns_flb1_error", () => {
    const errors = validateFlowBookmark(validFlowBookmark({ steps: [] }));
    expect(errors.some((e) => e.code === "FLB1_EMPTY_STEPS")).toBe(true);
  });

  it("test_missing_steps_key_returns_flb1_error", () => {
    const params = validFlowBookmark();
    delete params["steps"];
    const errors = validateFlowBookmark(params);
    expect(errors.some((e) => e.code === "FLB1_EMPTY_STEPS")).toBe(true);
  });

  it("test_valid_steps_no_flb1_error", () => {
    const errors = validateFlowBookmark(validFlowBookmark());
    expect(codes(errors)).not.toContain("FLB1_EMPTY_STEPS");
  });

  it("test_flb1_error_path_is_steps", () => {
    const errors = validateFlowBookmark(validFlowBookmark({ steps: [] }));
    const flb1Errors = withCode(errors, "FLB1_EMPTY_STEPS");
    expect(flb1Errors).toHaveLength(1);
    expect(flb1Errors[0]!.path).toBe("steps");
  });
});

// =============================================================================
// T018: FLB2 — step event name must be non-empty
// =============================================================================

describe("TestValidateFlowBookmarkFLB2", () => {
  it("test_empty_event_returns_flb2_error", () => {
    const errors = validateFlowBookmark(
      validFlowBookmark({ steps: [{ event: "", forward: 3, reverse: 0 }] }),
    );
    expect(errors.some((e) => e.code === "FLB2_EMPTY_STEP_EVENT")).toBe(true);
  });

  it("test_whitespace_only_event_returns_flb2_error", () => {
    const errors = validateFlowBookmark(
      validFlowBookmark({
        steps: [{ event: " ".repeat(3), forward: 3, reverse: 0 }],
      }),
    );
    expect(errors.some((e) => e.code === "FLB2_EMPTY_STEP_EVENT")).toBe(true);
  });

  it("test_missing_event_key_returns_flb2_error", () => {
    const errors = validateFlowBookmark(
      validFlowBookmark({ steps: [{ forward: 3, reverse: 0 }] }),
    );
    expect(errors.some((e) => e.code === "FLB2_EMPTY_STEP_EVENT")).toBe(true);
  });

  it("test_valid_event_no_flb2_error", () => {
    const errors = validateFlowBookmark(validFlowBookmark());
    expect(codes(errors)).not.toContain("FLB2_EMPTY_STEP_EVENT");
  });

  it("test_flb2_error_path_includes_index", () => {
    const errors = validateFlowBookmark(
      validFlowBookmark({
        steps: [
          { event: "Purchase", forward: 3, reverse: 0 },
          { event: "", forward: 3, reverse: 0 },
        ],
      }),
    );
    const flb2Errors = withCode(errors, "FLB2_EMPTY_STEP_EVENT");
    expect(flb2Errors).toHaveLength(1);
    expect(flb2Errors[0]!.path).toBe("steps[1].event");
  });
});

// =============================================================================
// T018: FLB3 — count_type must be valid
// =============================================================================

describe("TestValidateFlowBookmarkFLB3", () => {
  it("test_invalid_count_type_returns_flb3_error", () => {
    const errors = validateFlowBookmark(
      validFlowBookmark({ count_type: "invalid" }),
    );
    expect(errors.some((e) => e.code === "FLB3_INVALID_COUNT_TYPE")).toBe(true);
  });

  it("test_valid_count_type_unique_no_error", () => {
    const errors = validateFlowBookmark(
      validFlowBookmark({ count_type: "unique" }),
    );
    expect(codes(errors)).not.toContain("FLB3_INVALID_COUNT_TYPE");
  });

  it("test_valid_count_type_total_no_error", () => {
    const errors = validateFlowBookmark(
      validFlowBookmark({ count_type: "total" }),
    );
    expect(codes(errors)).not.toContain("FLB3_INVALID_COUNT_TYPE");
  });

  it("test_valid_count_type_session_no_error", () => {
    const errors = validateFlowBookmark(
      validFlowBookmark({ count_type: "session" }),
    );
    expect(codes(errors)).not.toContain("FLB3_INVALID_COUNT_TYPE");
  });

  it("test_flb3_close_match_has_suggestion", () => {
    const errors = validateFlowBookmark(
      validFlowBookmark({ count_type: "uniqe" }),
    );
    const flb3Errors = withCode(errors, "FLB3_INVALID_COUNT_TYPE");
    expect(flb3Errors).toHaveLength(1);
    expect(flb3Errors[0]!.suggestion).not.toBeNull();
    expect(flb3Errors[0]!.suggestion).toContain("unique");
  });

  it("test_flb3_error_path_is_count_type", () => {
    const errors = validateFlowBookmark(
      validFlowBookmark({ count_type: "bad" }),
    );
    const flb3Errors = withCode(errors, "FLB3_INVALID_COUNT_TYPE");
    expect(flb3Errors).toHaveLength(1);
    expect(flb3Errors[0]!.path).toBe("count_type");
  });
});

// =============================================================================
// T018: FLB4 — chartType must be valid
// =============================================================================

describe("TestValidateFlowBookmarkFLB4", () => {
  it("test_invalid_chart_type_returns_flb4_error", () => {
    const errors = validateFlowBookmark(
      validFlowBookmark({ chartType: "invalid" }),
    );
    expect(errors.some((e) => e.code === "FLB4_INVALID_CHART_TYPE")).toBe(true);
  });

  it("test_valid_chart_type_sankey_no_error", () => {
    const errors = validateFlowBookmark(
      validFlowBookmark({ chartType: "sankey" }),
    );
    expect(codes(errors)).not.toContain("FLB4_INVALID_CHART_TYPE");
  });

  it("test_valid_chart_type_top_paths_no_error", () => {
    const errors = validateFlowBookmark(
      validFlowBookmark({ chartType: "top-paths" }),
    );
    expect(codes(errors)).not.toContain("FLB4_INVALID_CHART_TYPE");
  });

  it("test_valid_chart_type_tree_no_error", () => {
    const errors = validateFlowBookmark(
      validFlowBookmark({ chartType: "tree" }),
    );
    expect(codes(errors)).not.toContain("FLB4_INVALID_CHART_TYPE");
  });

  it("test_flb4_close_match_has_suggestion", () => {
    const errors = validateFlowBookmark(
      validFlowBookmark({ chartType: "sanke" }),
    );
    const flb4Errors = withCode(errors, "FLB4_INVALID_CHART_TYPE");
    expect(flb4Errors).toHaveLength(1);
    expect(flb4Errors[0]!.suggestion).not.toBeNull();
    expect(flb4Errors[0]!.suggestion).toContain("sankey");
  });

  it("test_flb4_error_path_is_chart_type", () => {
    const errors = validateFlowBookmark(
      validFlowBookmark({ chartType: "bad" }),
    );
    const flb4Errors = withCode(errors, "FLB4_INVALID_CHART_TYPE");
    expect(flb4Errors).toHaveLength(1);
    expect(flb4Errors[0]!.path).toBe("chartType");
  });
});

// =============================================================================
// T018: FLB5 — date_range must be present
// =============================================================================

describe("TestValidateFlowBookmarkFLB5", () => {
  it("test_missing_date_range_returns_flb5_error", () => {
    const params = validFlowBookmark();
    delete params["date_range"];
    const errors = validateFlowBookmark(params);
    expect(errors.some((e) => e.code === "FLB5_MISSING_DATE_RANGE")).toBe(true);
  });

  it("test_present_date_range_no_flb5_error", () => {
    const errors = validateFlowBookmark(validFlowBookmark());
    expect(codes(errors)).not.toContain("FLB5_MISSING_DATE_RANGE");
  });

  it("test_flb5_error_path_is_date_range", () => {
    const params = validFlowBookmark();
    delete params["date_range"];
    const errors = validateFlowBookmark(params);
    const flb5Errors = withCode(errors, "FLB5_MISSING_DATE_RANGE");
    expect(flb5Errors).toHaveLength(1);
    expect(flb5Errors[0]!.path).toBe("date_range");
  });
});

// =============================================================================
// T018: FLB6 — version must be 2
// =============================================================================

describe("TestValidateFlowBookmarkFLB6", () => {
  it("test_version_one_returns_flb6_error", () => {
    const errors = validateFlowBookmark(validFlowBookmark({ version: 1 }));
    expect(errors.some((e) => e.code === "FLB6_INVALID_VERSION")).toBe(true);
  });

  it("test_version_three_returns_flb6_error", () => {
    const errors = validateFlowBookmark(validFlowBookmark({ version: 3 }));
    expect(errors.some((e) => e.code === "FLB6_INVALID_VERSION")).toBe(true);
  });

  it("test_version_two_no_flb6_error", () => {
    const errors = validateFlowBookmark(validFlowBookmark({ version: 2 }));
    expect(codes(errors)).not.toContain("FLB6_INVALID_VERSION");
  });

  it("test_missing_version_returns_flb6_error", () => {
    const params = validFlowBookmark();
    delete params["version"];
    const errors = validateFlowBookmark(params);
    expect(errors.some((e) => e.code === "FLB6_INVALID_VERSION")).toBe(true);
  });

  it("test_flb6_error_path_is_version", () => {
    const errors = validateFlowBookmark(validFlowBookmark({ version: 1 }));
    const flb6Errors = withCode(errors, "FLB6_INVALID_VERSION");
    expect(flb6Errors).toHaveLength(1);
    expect(flb6Errors[0]!.path).toBe("version");
  });
});

// =============================================================================
// T018: All defaults pass
// =============================================================================

describe("TestValidateFlowBookmarkDefaults", () => {
  it("test_all_defaults_pass_validation", () => {
    const errors = validateFlowBookmark(validFlowBookmark());
    expect(errors).toStrictEqual([]);
  });
});
