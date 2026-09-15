/**
 * Layer-3 translation of the `validate_bookmark` classes of
 * `tests/test_validation_cohort.py` (Python revision:
 * `ts-port/phase2-contract-support` HEAD; 504 LOC).
 *
 * Scope per b2-packets.md §V1b: `TestCohortFilterValidation` (3),
 * `TestCohortGroupValidation` (3), `TestCohortShowValidation` (8) and
 * `TestCohortBehaviorMissingIdentifier` (1) — B22–B26. The
 * `validate_retention_args` class (`TestRetentionCohortMixValidation`,
 * CB3) was translated by shard V1a in `validation-cohort.test.ts`,
 * which cites this split in its own header.
 *
 * R10.2: assertion-for-assertion.
 */

import { describe, expect, it } from "vitest";

import type { ValidationError } from "../../src/errors.js";
import { validateBookmark } from "../../src/query/validation-bookmark.js";

/** Loose dict, the TS analogue of Python's `dict[str, Any]`. */
type Dict = Record<string, unknown>;

/**
 * Extract error codes.
 *
 * Port of `_codes` (`test_validation_cohort.py:33-42`).
 *
 * @param errors - Validation errors.
 * @returns The codes, in emission order.
 */
function codes(errors: readonly ValidationError[]): string[] {
  return errors.map((e) => e.code);
}

/**
 * Build a valid bookmark dict with a cohort show clause.
 *
 * Port of `_valid_cohort_show` (`test_validation_cohort.py:45-88`).
 *
 * @returns A fresh params dict.
 */
function validCohortShow(): Dict {
  return {
    sections: {
      show: [
        {
          type: "metric",
          behavior: {
            type: "cohort",
            name: "Power Users",
            id: 123,
            resourceType: "cohorts",
            dataGroupId: null,
            dataset: "$mixpanel",
            filtersDeterminer: "all",
            filters: [],
          },
          measurement: {
            math: "unique",
            property: null,
            perUserAggregation: null,
          },
          isHidden: false,
        },
      ],
      time: [
        {
          dateRangeType: "in the last",
          window: { value: 30, unit: "day" },
          unit: "day",
        },
      ],
      filter: [],
      group: [],
      formula: [],
    },
    displayOptions: { chartType: "line" },
  };
}

/**
 * Build a valid cohort filter entry dict.
 *
 * Port of `_valid_cohort_filter_entry` (`test_validation_cohort.py:91-113`).
 *
 * @returns A fresh filter clause dict.
 */
function validCohortFilterEntry(): Dict {
  return {
    resourceType: "events",
    filterType: "list",
    defaultType: "list",
    value: "$cohorts",
    filterValue: [
      {
        cohort: {
          id: 123,
          name: "Power Users",
          negated: false,
        },
      },
    ],
    filterOperator: "contains",
  };
}

/**
 * Build a valid cohort group entry dict.
 *
 * Port of `_valid_cohort_group_entry` (`test_validation_cohort.py:116-148`).
 *
 * @returns A fresh group clause dict.
 */
function validCohortGroupEntry(): Dict {
  return {
    value: ["Power Users", "Not In Power Users"],
    resourceType: "events",
    profileType: null,
    search: "",
    dataGroupId: null,
    propertyType: null,
    typeCast: null,
    cohorts: [
      {
        id: 123,
        name: "Power Users",
        negated: false,
        data_group_id: null,
        groups: [],
      },
      {
        id: 123,
        name: "Power Users",
        negated: true,
        data_group_id: null,
        groups: [],
      },
    ],
    isHidden: false,
  };
}

/**
 * Build a minimal valid bookmark with a single filter entry.
 *
 * Port of `_bookmark_with_filter` (`test_validation_cohort.py:151-188`).
 *
 * @param filterEntry - The filter clause dict to include.
 * @returns A complete bookmark dict.
 */
function bookmarkWithFilter(filterEntry: Dict): Dict {
  return {
    sections: {
      show: [
        {
          behavior: {
            type: "event",
            name: "Login",
            resourceType: "events",
          },
          measurement: {
            math: "total",
            property: null,
            perUserAggregation: null,
          },
        },
      ],
      time: [
        {
          dateRangeType: "in the last",
          window: { value: 30, unit: "day" },
          unit: "day",
        },
      ],
      filter: [filterEntry],
      group: [],
      formula: [],
    },
    displayOptions: { chartType: "line" },
  };
}

/**
 * Build a minimal valid bookmark with a single group entry.
 *
 * Port of `_bookmark_with_group` (`test_validation_cohort.py:191-228`).
 *
 * @param groupEntry - The group clause dict to include.
 * @returns A complete bookmark dict.
 */
function bookmarkWithGroup(groupEntry: Dict): Dict {
  return {
    sections: {
      show: [
        {
          behavior: {
            type: "event",
            name: "Login",
            resourceType: "events",
          },
          measurement: {
            math: "total",
            property: null,
            perUserAggregation: null,
          },
        },
      ],
      time: [
        {
          dateRangeType: "in the last",
          window: { value: 30, unit: "day" },
          unit: "day",
        },
      ],
      filter: [],
      group: [groupEntry],
      formula: [],
    },
    displayOptions: { chartType: "line" },
  };
}

/**
 * Read the first show clause's `behavior` dict out of a params dict.
 *
 * @param params - A bookmark params dict built by the helpers above.
 * @returns The behavior dict.
 */
function firstBehavior(params: Dict): Dict {
  const sections = params["sections"] as Dict;
  const show = sections["show"] as Dict[];
  return show[0]!["behavior"] as Dict;
}

/**
 * Read the first show clause's `measurement` dict out of a params dict.
 *
 * @param params - A bookmark params dict built by the helpers above.
 * @returns The measurement dict.
 */
function firstMeasurement(params: Dict): Dict {
  const sections = params["sections"] as Dict;
  const show = sections["show"] as Dict[];
  return show[0]!["measurement"] as Dict;
}

// =============================================================================
// B25: Cohort filter value must be "$cohorts"
// =============================================================================

describe("TestCohortFilterValidation", () => {
  it("test_valid_cohort_filter_no_b25_error", () => {
    const entry = validCohortFilterEntry();
    const params = bookmarkWithFilter(entry);
    const errors = validateBookmark(params);
    expect(codes(errors)).not.toContain("B25_COHORT_FILTER_VALUE");
  });

  it("test_cohort_filter_with_wrong_value_returns_b25_error", () => {
    const entry = validCohortFilterEntry();
    entry["value"] = "wrong_property";
    const params = bookmarkWithFilter(entry);
    const errors = validateBookmark(params);
    expect(codes(errors)).toContain("B25_COHORT_FILTER_VALUE");
  });

  it("test_non_cohort_list_filter_no_b25_error", () => {
    const entry: Dict = {
      resourceType: "events",
      filterType: "string",
      value: "country",
      filterValue: ["US"],
      filterOperator: "equals",
    };
    const params = bookmarkWithFilter(entry);
    const errors = validateBookmark(params);
    expect(codes(errors)).not.toContain("B25_COHORT_FILTER_VALUE");
  });
});

// =============================================================================
// B26: Cohort group entry must have non-empty cohorts array
// =============================================================================

describe("TestCohortGroupValidation", () => {
  it("test_valid_cohort_group_no_b26_error", () => {
    const entry = validCohortGroupEntry();
    const params = bookmarkWithGroup(entry);
    const errors = validateBookmark(params);
    expect(codes(errors)).not.toContain("B26_EMPTY_COHORTS");
  });

  it("test_empty_cohorts_array_returns_b26_error", () => {
    const entry = validCohortGroupEntry();
    entry["cohorts"] = [];
    const params = bookmarkWithGroup(entry);
    const errors = validateBookmark(params);
    expect(codes(errors)).toContain("B26_EMPTY_COHORTS");
  });

  it("test_group_without_cohorts_key_no_b26_error", () => {
    const entry: Dict = {
      value: "country",
      resourceType: "events",
      propertyType: "string",
    };
    const params = bookmarkWithGroup(entry);
    const errors = validateBookmark(params);
    expect(codes(errors)).not.toContain("B26_EMPTY_COHORTS");
  });
});

// =============================================================================
// B22-B24: Cohort show clause validation
// =============================================================================

describe("TestCohortShowValidation", () => {
  it("test_valid_cohort_show_no_errors", () => {
    const params = validCohortShow();
    const errors = validateBookmark(params);
    const cohortCodes = new Set([
      "B22_COHORT_BEHAVIOR_ID",
      "B23_COHORT_RESOURCE_TYPE",
      "B24_COHORT_MATH",
    ]);
    expect(errors.some((e) => cohortCodes.has(e.code))).toBe(false);
  });

  it("test_b22_negative_id_returns_error", () => {
    const params = validCohortShow();
    firstBehavior(params)["id"] = -1;
    const errors = validateBookmark(params);
    expect(codes(errors)).toContain("B22_COHORT_BEHAVIOR_ID");
  });

  it("test_b22_zero_id_returns_error", () => {
    const params = validCohortShow();
    firstBehavior(params)["id"] = 0;
    const errors = validateBookmark(params);
    expect(codes(errors)).toContain("B22_COHORT_BEHAVIOR_ID");
  });

  it("test_b22_missing_id_with_raw_cohort_no_error", () => {
    const params = validCohortShow();
    const behavior = firstBehavior(params);
    delete behavior["id"];
    behavior["raw_cohort"] = { selector: {}, behaviors: {} };
    const errors = validateBookmark(params);
    expect(codes(errors)).not.toContain("B22_COHORT_BEHAVIOR_ID");
  });

  it("test_b23_wrong_resource_type_returns_error", () => {
    const params = validCohortShow();
    firstBehavior(params)["resourceType"] = "events";
    const errors = validateBookmark(params);
    expect(codes(errors)).toContain("B23_COHORT_RESOURCE_TYPE");
  });

  it("test_b23_correct_resource_type_no_error", () => {
    const params = validCohortShow();
    const errors = validateBookmark(params);
    expect(codes(errors)).not.toContain("B23_COHORT_RESOURCE_TYPE");
  });

  it("test_b24_wrong_math_returns_error", () => {
    const params = validCohortShow();
    firstMeasurement(params)["math"] = "total";
    const errors = validateBookmark(params);
    expect(codes(errors)).toContain("B24_COHORT_MATH");
  });

  it("test_b24_correct_math_no_error", () => {
    const params = validCohortShow();
    const errors = validateBookmark(params);
    expect(codes(errors)).not.toContain("B24_COHORT_MATH");
  });
});

// =============================================================================
// B22: Cohort behavior missing identifier
// =============================================================================

describe("TestCohortBehaviorMissingIdentifier", () => {
  it("test_missing_both_id_and_raw_cohort", () => {
    const bookmark: Dict = {
      sections: {
        show: [
          {
            dataset: "$mixpanel",
            value: "Login",
            resourceType: "events",
            profileType: null,
            search: "",
            dataGroupId: null,
            math: "total",
            property: null,
            perUserAggregation: null,
            type: "number",
            measurement: { property: null },
          },
          {
            dataset: "$mixpanel",
            resourceType: "cohorts",
            math: "unique",
            type: "number",
            behavior: {
              type: "cohort",
              resourceType: "cohorts",
              // Missing both "id" and "raw_cohort"
            },
            value: "Test Cohort",
            measurement: { property: null },
          },
        ],
        filter: [],
        group: [],
        formula: [],
        time: { dateRange: "30d", unit: "day" },
      },
      displayOptions: {
        chartType: "line",
        plotStyle: "standard",
        analysis: "linear",
      },
    };
    const errors = validateBookmark(bookmark);
    expect(codes(errors)).toContain("B22_COHORT_MISSING_IDENTIFIER");
  });
});
