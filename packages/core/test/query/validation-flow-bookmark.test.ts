// `validateFlowBookmark` rules FLB1-FLB6 and the all-defaults case —
// translation of the `TestValidateFlowBookmarkFLB*` and
// `TestValidateFlowBookmarkDefaults` classes of `tests/test_validation_flow.py`
// (the `validate_flow_args` classes are in validation-flow.test.ts).
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

// --- FLB1 — steps must be present and non-empty ---

describe("Validate flow bookmark FLB1", () => {
  // python: TestValidateFlowBookmarkFLB1
  it("empty steps returns FLB1 error", () => {
    // python: test_empty_steps_returns_flb1_error
    const errors = validateFlowBookmark(validFlowBookmark({ steps: [] }));
    expect(errors.some((e) => e.code === "FLB1_EMPTY_STEPS")).toBe(true);
  });

  it("missing steps key returns FLB1 error", () => {
    // python: test_missing_steps_key_returns_flb1_error
    const params = validFlowBookmark();
    delete params["steps"];
    const errors = validateFlowBookmark(params);
    expect(errors.some((e) => e.code === "FLB1_EMPTY_STEPS")).toBe(true);
  });

  it("valid steps no FLB1 error", () => {
    // python: test_valid_steps_no_flb1_error
    const errors = validateFlowBookmark(validFlowBookmark());
    expect(codes(errors)).not.toContain("FLB1_EMPTY_STEPS");
  });

  it("FLB1 error path is steps", () => {
    // python: test_flb1_error_path_is_steps
    const errors = validateFlowBookmark(validFlowBookmark({ steps: [] }));
    const flb1Errors = withCode(errors, "FLB1_EMPTY_STEPS");
    expect(flb1Errors).toHaveLength(1);
    expect(flb1Errors[0]!.path).toBe("steps");
  });
});

// --- FLB2 — step event name must be non-empty ---

describe("Validate flow bookmark FLB2", () => {
  // python: TestValidateFlowBookmarkFLB2
  it("empty event returns FLB2 error", () => {
    // python: test_empty_event_returns_flb2_error
    const errors = validateFlowBookmark(
      validFlowBookmark({ steps: [{ event: "", forward: 3, reverse: 0 }] }),
    );
    expect(errors.some((e) => e.code === "FLB2_EMPTY_STEP_EVENT")).toBe(true);
  });

  it("whitespace only event returns FLB2 error", () => {
    // python: test_whitespace_only_event_returns_flb2_error
    const errors = validateFlowBookmark(
      validFlowBookmark({
        steps: [{ event: " ".repeat(3), forward: 3, reverse: 0 }],
      }),
    );
    expect(errors.some((e) => e.code === "FLB2_EMPTY_STEP_EVENT")).toBe(true);
  });

  it("missing event key returns FLB2 error", () => {
    // python: test_missing_event_key_returns_flb2_error
    const errors = validateFlowBookmark(
      validFlowBookmark({ steps: [{ forward: 3, reverse: 0 }] }),
    );
    expect(errors.some((e) => e.code === "FLB2_EMPTY_STEP_EVENT")).toBe(true);
  });

  it("valid event no FLB2 error", () => {
    // python: test_valid_event_no_flb2_error
    const errors = validateFlowBookmark(validFlowBookmark());
    expect(codes(errors)).not.toContain("FLB2_EMPTY_STEP_EVENT");
  });

  it("FLB2 error path includes index", () => {
    // python: test_flb2_error_path_includes_index
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

// --- FLB3 — count_type must be valid ---

describe("Validate flow bookmark FLB3", () => {
  // python: TestValidateFlowBookmarkFLB3
  it("invalid count type returns FLB3 error", () => {
    // python: test_invalid_count_type_returns_flb3_error
    const errors = validateFlowBookmark(
      validFlowBookmark({ count_type: "invalid" }),
    );
    expect(errors.some((e) => e.code === "FLB3_INVALID_COUNT_TYPE")).toBe(true);
  });

  it("valid count type unique no error", () => {
    // python: test_valid_count_type_unique_no_error
    const errors = validateFlowBookmark(
      validFlowBookmark({ count_type: "unique" }),
    );
    expect(codes(errors)).not.toContain("FLB3_INVALID_COUNT_TYPE");
  });

  it("valid count type total no error", () => {
    // python: test_valid_count_type_total_no_error
    const errors = validateFlowBookmark(
      validFlowBookmark({ count_type: "total" }),
    );
    expect(codes(errors)).not.toContain("FLB3_INVALID_COUNT_TYPE");
  });

  it("valid count type session no error", () => {
    // python: test_valid_count_type_session_no_error
    const errors = validateFlowBookmark(
      validFlowBookmark({ count_type: "session" }),
    );
    expect(codes(errors)).not.toContain("FLB3_INVALID_COUNT_TYPE");
  });

  it("FLB3 close match has suggestion", () => {
    // python: test_flb3_close_match_has_suggestion
    const errors = validateFlowBookmark(
      validFlowBookmark({ count_type: "uniqe" }),
    );
    const flb3Errors = withCode(errors, "FLB3_INVALID_COUNT_TYPE");
    expect(flb3Errors).toHaveLength(1);
    expect(flb3Errors[0]!.suggestion).not.toBeNull();
    expect(flb3Errors[0]!.suggestion).toContain("unique");
  });

  it("FLB3 error path is count type", () => {
    // python: test_flb3_error_path_is_count_type
    const errors = validateFlowBookmark(
      validFlowBookmark({ count_type: "bad" }),
    );
    const flb3Errors = withCode(errors, "FLB3_INVALID_COUNT_TYPE");
    expect(flb3Errors).toHaveLength(1);
    expect(flb3Errors[0]!.path).toBe("count_type");
  });
});

// --- FLB4 — chartType must be valid ---

describe("Validate flow bookmark FLB4", () => {
  // python: TestValidateFlowBookmarkFLB4
  it("invalid chart type returns FLB4 error", () => {
    // python: test_invalid_chart_type_returns_flb4_error
    const errors = validateFlowBookmark(
      validFlowBookmark({ chartType: "invalid" }),
    );
    expect(errors.some((e) => e.code === "FLB4_INVALID_CHART_TYPE")).toBe(true);
  });

  it("valid chart type sankey no error", () => {
    // python: test_valid_chart_type_sankey_no_error
    const errors = validateFlowBookmark(
      validFlowBookmark({ chartType: "sankey" }),
    );
    expect(codes(errors)).not.toContain("FLB4_INVALID_CHART_TYPE");
  });

  it("valid chart type top paths no error", () => {
    // python: test_valid_chart_type_top_paths_no_error
    const errors = validateFlowBookmark(
      validFlowBookmark({ chartType: "top-paths" }),
    );
    expect(codes(errors)).not.toContain("FLB4_INVALID_CHART_TYPE");
  });

  it("valid chart type tree no error", () => {
    // python: test_valid_chart_type_tree_no_error
    const errors = validateFlowBookmark(
      validFlowBookmark({ chartType: "tree" }),
    );
    expect(codes(errors)).not.toContain("FLB4_INVALID_CHART_TYPE");
  });

  it("FLB4 close match has suggestion", () => {
    // python: test_flb4_close_match_has_suggestion
    const errors = validateFlowBookmark(
      validFlowBookmark({ chartType: "sanke" }),
    );
    const flb4Errors = withCode(errors, "FLB4_INVALID_CHART_TYPE");
    expect(flb4Errors).toHaveLength(1);
    expect(flb4Errors[0]!.suggestion).not.toBeNull();
    expect(flb4Errors[0]!.suggestion).toContain("sankey");
  });

  it("FLB4 error path is chart type", () => {
    // python: test_flb4_error_path_is_chart_type
    const errors = validateFlowBookmark(
      validFlowBookmark({ chartType: "bad" }),
    );
    const flb4Errors = withCode(errors, "FLB4_INVALID_CHART_TYPE");
    expect(flb4Errors).toHaveLength(1);
    expect(flb4Errors[0]!.path).toBe("chartType");
  });
});

// --- FLB5 — date_range must be present ---

describe("Validate flow bookmark FLB5", () => {
  // python: TestValidateFlowBookmarkFLB5
  it("missing date range returns FLB5 error", () => {
    // python: test_missing_date_range_returns_flb5_error
    const params = validFlowBookmark();
    delete params["date_range"];
    const errors = validateFlowBookmark(params);
    expect(errors.some((e) => e.code === "FLB5_MISSING_DATE_RANGE")).toBe(true);
  });

  it("present date range no FLB5 error", () => {
    // python: test_present_date_range_no_flb5_error
    const errors = validateFlowBookmark(validFlowBookmark());
    expect(codes(errors)).not.toContain("FLB5_MISSING_DATE_RANGE");
  });

  it("FLB5 error path is date range", () => {
    // python: test_flb5_error_path_is_date_range
    const params = validFlowBookmark();
    delete params["date_range"];
    const errors = validateFlowBookmark(params);
    const flb5Errors = withCode(errors, "FLB5_MISSING_DATE_RANGE");
    expect(flb5Errors).toHaveLength(1);
    expect(flb5Errors[0]!.path).toBe("date_range");
  });
});

// --- FLB6 — version must be 2 ---

describe("Validate flow bookmark FLB6", () => {
  // python: TestValidateFlowBookmarkFLB6
  it("version one returns FLB6 error", () => {
    // python: test_version_one_returns_flb6_error
    const errors = validateFlowBookmark(validFlowBookmark({ version: 1 }));
    expect(errors.some((e) => e.code === "FLB6_INVALID_VERSION")).toBe(true);
  });

  it("version three returns FLB6 error", () => {
    // python: test_version_three_returns_flb6_error
    const errors = validateFlowBookmark(validFlowBookmark({ version: 3 }));
    expect(errors.some((e) => e.code === "FLB6_INVALID_VERSION")).toBe(true);
  });

  it("version two no FLB6 error", () => {
    // python: test_version_two_no_flb6_error
    const errors = validateFlowBookmark(validFlowBookmark({ version: 2 }));
    expect(codes(errors)).not.toContain("FLB6_INVALID_VERSION");
  });

  it("missing version returns FLB6 error", () => {
    // python: test_missing_version_returns_flb6_error
    const params = validFlowBookmark();
    delete params["version"];
    const errors = validateFlowBookmark(params);
    expect(errors.some((e) => e.code === "FLB6_INVALID_VERSION")).toBe(true);
  });

  it("FLB6 error path is version", () => {
    // python: test_flb6_error_path_is_version
    const errors = validateFlowBookmark(validFlowBookmark({ version: 1 }));
    const flb6Errors = withCode(errors, "FLB6_INVALID_VERSION");
    expect(flb6Errors).toHaveLength(1);
    expect(flb6Errors[0]!.path).toBe("version");
  });
});

// --- All defaults pass ---

describe("Validate flow bookmark defaults", () => {
  // python: TestValidateFlowBookmarkDefaults
  it("all defaults pass validation", () => {
    // python: test_all_defaults_pass_validation
    const errors = validateFlowBookmark(validFlowBookmark());
    expect(errors).toStrictEqual([]);
  });
});
