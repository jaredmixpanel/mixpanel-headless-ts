/**
 * Layer-3 translation of `tests/test_validation_cohort.py`
 * (Python revision: `ts-port/phase2-contract-support` HEAD; 504 LOC).
 *
 * Scope per b2-packets.md §V1a: the `validate_retention_args` class
 * (`TestRetentionCohortMixValidation`, CB3). The `validate_bookmark`
 * cohort classes (`TestCohortFilterValidation`,
 * `TestCohortGroupValidation`, `TestCohortShowValidation`,
 * `TestCohortBehaviorMissingIdentifier`, B22–B26) are B2 shard V1b.
 *
 * R10.2: assertion-for-assertion.
 */

import { describe, expect, it } from "vitest";

import { validateRetentionArgs } from "../../src/query/validation-args.js";
import { CohortBreakdown, GroupBy } from "../../src/types/index.js";
import { codes } from "../../test-support/error-codes.js";

// =============================================================================
// CB3: no mixing CohortBreakdown with GroupBy in retention (T022)
// =============================================================================

describe("Retention cohort mix validation", () => {
  // python: TestRetentionCohortMixValidation
  it("cohort breakdown alone no CB3 error", () => {
    // python: test_cohort_breakdown_alone_no_cb3_error
    const errors = validateRetentionArgs({
      born_event: "Signup",
      return_event: "Login",
      group_by: new CohortBreakdown({ cohort: 123, name: "PU" }),
    });
    expect(codes(errors)).not.toContain("CB3_RETENTION_MIXED_BREAKDOWN");
  });

  it("string group by alone no CB3 error", () => {
    // python: test_string_group_by_alone_no_cb3_error
    const errors = validateRetentionArgs({
      born_event: "Signup",
      return_event: "Login",
      group_by: "platform",
    });
    expect(codes(errors)).not.toContain("CB3_RETENTION_MIXED_BREAKDOWN");
  });

  it("mixed cohort and groupby returns CB3 error", () => {
    // python: test_mixed_cohort_and_groupby_returns_cb3_error
    const errors = validateRetentionArgs({
      born_event: "Signup",
      return_event: "Login",
      group_by: [
        new CohortBreakdown({ cohort: 123, name: "PU" }),
        new GroupBy({ property: "platform" }),
      ],
    });
    expect(codes(errors)).toContain("CB3_RETENTION_MIXED_BREAKDOWN");
  });

  it("mixed cohort and string returns CB3 error", () => {
    // python: test_mixed_cohort_and_string_returns_cb3_error
    const errors = validateRetentionArgs({
      born_event: "Signup",
      return_event: "Login",
      group_by: [new CohortBreakdown({ cohort: 123, name: "PU" }), "platform"],
    });
    expect(codes(errors)).toContain("CB3_RETENTION_MIXED_BREAKDOWN");
  });

  it("CB3 error message mentions mixing", () => {
    // python: test_cb3_error_message_mentions_mixing
    const errors = validateRetentionArgs({
      born_event: "Signup",
      return_event: "Login",
      group_by: [new CohortBreakdown({ cohort: 123, name: "PU" }), "platform"],
    });
    const cb3Errors = errors.filter(
      (e) => e.code === "CB3_RETENTION_MIXED_BREAKDOWN",
    );
    expect(cb3Errors).toHaveLength(1);
    expect(
      cb3Errors[0]!.message.toLowerCase().includes("mixing") ||
        cb3Errors[0]!.message.toLowerCase().includes("mix"),
    ).toBe(true);
  });

  it("multiple cohort breakdowns no CB3 error", () => {
    // python: test_multiple_cohort_breakdowns_no_cb3_error
    const errors = validateRetentionArgs({
      born_event: "Signup",
      return_event: "Login",
      group_by: [
        new CohortBreakdown({ cohort: 123, name: "PU" }),
        new CohortBreakdown({ cohort: 456, name: "New Users" }),
      ],
    });
    expect(codes(errors)).not.toContain("CB3_RETENTION_MIXED_BREAKDOWN");
  });

  it("null group by no CB3 error", () => {
    // python: test_none_group_by_no_cb3_error
    const errors = validateRetentionArgs({
      born_event: "Signup",
      return_event: "Login",
      group_by: null,
    });
    expect(codes(errors)).not.toContain("CB3_RETENTION_MIXED_BREAKDOWN");
  });
});
