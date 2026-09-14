/**
 * Layer-3 translation of the `validate_bookmark` half of
 * `tests/unit/test_validation.py` (Python revision:
 * `ts-port/phase2-contract-support` HEAD; 1,238 LOC).
 *
 * Scope per b2-packets.md §V1b: `TestValidateBookmarkLayer2` (20),
 * `TestValidateMeasurementFunnelContext` (4) and
 * `TestValidateSortingBlock` (32). The `validate_query_args` classes
 * (`TestValidateQueryArgsLayer1`, `TestFuzzyMatching`,
 * `TestDataGroupIdValidationInsights`) were translated by shard V1a
 * (`validation-args.test.ts`); `TestValidationError` /
 * `TestBookmarkValidationError` landed in Phase 2 (`errors.test.ts`).
 *
 * Deferred with design citation (phase2-audit A2 style): the whole of
 * `tests/test_validation_bypass.py` and `tests/test_validation_bypass_r2.py`.
 * b2-packets.md §V1b lists their "validator-direct asserts" as V1b scope,
 * but every one of the 8 `validate_bookmark(params)` call sites first
 * builds `params` through `ws.build_params(...)` (measured 2026-08-15:
 * `test_validation_bypass.py:128,215,237,248,259,355,369` all consume a
 * facade-built dict), so the file cannot be translated before the B5-S2
 * facade lands. It moves WHOLE to B5-S2. Layer-2 coverage of those exact
 * inputs is preserved meanwhile by the 7 recorded corpus vectors in
 * `corpus/validation/test_validation_bypass.jsonl`, which replay the
 * built dicts through `validation.validate_bookmark` at (b′).
 *
 * R10.2: assertion-for-assertion.
 */

import { describe, it, expect } from "vitest";
import type { ValidationError } from "../../src/errors.js";
import { validateBookmark } from "../../src/query/validation-bookmark.js";

// =============================================================================
// Helpers (ports of the module-level helpers in the Python file)
// =============================================================================

/** Loose dict, the TS analogue of Python's `dict[str, Any]`. */
type Dict = Record<string, unknown>;

/** The `sections` block of a bookmark params dict. */
interface Sections extends Dict {
  show: Dict[];
}

/** A bookmark params dict as the Python test helpers build it. */
interface BookmarkParams extends Dict {
  sections: Sections;
  displayOptions: Dict;
}

/**
 * Return a minimal valid bookmark params dict with optional overrides.
 *
 * Port of `_minimal_bookmark` (`test_validation.py:45-71`).
 *
 * @param overrides - Top-level keys to merge over the defaults.
 * @returns A fresh params dict.
 */
function minimalBookmark(overrides: Dict = {}): BookmarkParams {
  const bookmark: BookmarkParams = {
    sections: {
      show: [
        {
          behavior: {
            type: "event",
            resourceType: "events",
            value: { name: "Login" },
          },
          measurement: {
            math: "total",
          },
        },
      ],
      time: [{ unit: "day", dateRangeType: "in the last", value: 30 }],
      filter: [],
      group: [],
    },
    displayOptions: {
      chartType: "line",
      analysis: "linear",
    },
  };
  return { ...bookmark, ...overrides };
}

/**
 * Return a minimal valid funnel bookmark params dict.
 *
 * Port of `_minimal_funnel_bookmark` (`test_validation.py:689-717`).
 *
 * @param math - The measurement math to embed.
 * @returns A fresh funnel params dict.
 */
function minimalFunnelBookmark(
  math = "conversion_rate_unique",
): BookmarkParams {
  return {
    sections: {
      show: [
        {
          behavior: {
            type: "funnel",
            behaviors: [
              { name: "Signup", resourceType: "events" },
              { name: "Purchase", resourceType: "events" },
            ],
          },
          measurement: {
            math,
          },
        },
      ],
      time: [{ unit: "day", dateRangeType: "in the last" }],
      filter: [],
      group: [],
      formula: [],
    },
    displayOptions: {
      chartType: "funnel-steps",
    },
  };
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
// Layer 2 bookmark structure validation
// =============================================================================

describe("TestValidateBookmarkLayer2", () => {
  it("test_valid_bookmark_no_errors", () => {
    const errors = validateBookmark(minimalBookmark());
    expect(errors).toEqual([]);
  });

  it("test_b1_missing_sections", () => {
    const errors = validateBookmark({ displayOptions: { chartType: "line" } });
    expect(errors.some((e) => e.code === "B1_MISSING_SECTIONS")).toBe(true);
  });

  it("test_b2_missing_display_options", () => {
    const errors = validateBookmark({
      sections: { show: [{ behavior: { type: "event" } }] },
    });
    expect(errors.some((e) => e.code === "B2_MISSING_DISPLAY_OPTIONS")).toBe(
      true,
    );
  });

  it("test_b3_missing_show", () => {
    const errors = validateBookmark({
      sections: { time: [], filter: [] },
      displayOptions: { chartType: "line" },
    });
    expect(errors.some((e) => e.code === "B3_MISSING_SHOW")).toBe(true);
  });

  it("test_b4_show_empty", () => {
    const errors = validateBookmark({
      sections: { show: [] },
      displayOptions: { chartType: "line" },
    });
    expect(errors.some((e) => e.code === "B4_SHOW_EMPTY")).toBe(true);
  });

  it("test_b5_invalid_chart_type", () => {
    const bm = minimalBookmark();
    bm.displayOptions["chartType"] = "barchart";
    const errors = validateBookmark(bm);
    const chartErrors = withCode(errors, "B5_INVALID_CHART_TYPE");
    expect(chartErrors.length).toBe(1);
    expect(chartErrors[0]!.suggestion).not.toBeNull();
    expect(chartErrors[0]!.suggestion).toContain("bar");
  });

  it("test_b5_missing_chart_type", () => {
    const bm = minimalBookmark();
    delete bm.displayOptions["chartType"];
    const errors = validateBookmark(bm);
    expect(errors.some((e) => e.code === "B5_INVALID_CHART_TYPE")).toBe(true);
  });

  it("test_b6_missing_behavior", () => {
    const bm = minimalBookmark();
    bm.sections.show = [{ measurement: { math: "total" } }];
    const errors = validateBookmark(bm);
    expect(errors.some((e) => e.code === "B6_MISSING_BEHAVIOR")).toBe(true);
  });

  it("test_b9_invalid_math", () => {
    const bm = minimalBookmark();
    (bm.sections.show[0]!["measurement"] as Dict)["math"] = "totl";
    const errors = validateBookmark(bm);
    const mathErrors = withCode(errors, "B9_INVALID_MATH");
    expect(mathErrors.length).toBe(1);
    expect(mathErrors[0]!.suggestion).not.toBeNull();
    expect(mathErrors[0]!.suggestion).toContain("total");
  });

  it("test_b10_math_missing_property", () => {
    const bm = minimalBookmark();
    (bm.sections.show[0]!["measurement"] as Dict)["math"] = "average";
    const errors = validateBookmark(bm);
    const propErrors = withCode(errors, "B10_MATH_MISSING_PROPERTY");
    expect(propErrors.length).toBe(1);
    expect(propErrors[0]!.severity).toBe("warning");
    expect(propErrors[0]!.fix).not.toBeNull();
  });

  it("test_b12_invalid_time_unit", () => {
    const bm = minimalBookmark();
    bm.sections["time"] = [{ unit: "fortnite" }];
    const errors = validateBookmark(bm);
    expect(errors.some((e) => e.code === "B12_INVALID_TIME_UNIT")).toBe(true);
  });

  it("test_b14_invalid_filter_type", () => {
    const bm = minimalBookmark();
    bm.sections["filter"] = [
      {
        filterType: "nope",
        filterOperator: "equals",
        value: "country",
        filterValue: ["US"],
      },
    ];
    const errors = validateBookmark(bm);
    expect(errors.some((e) => e.code === "B14_INVALID_FILTER_TYPE")).toBe(true);
  });

  it("test_b15_invalid_filter_operator_warning", () => {
    const bm = minimalBookmark();
    bm.sections["filter"] = [
      {
        filterType: "string",
        filterOperator: "approximately",
        value: "country",
        filterValue: ["US"],
      },
    ];
    const errors = validateBookmark(bm);
    const opErrors = withCode(errors, "B15_INVALID_FILTER_OPERATOR");
    expect(opErrors.length).toBe(1);
    expect(opErrors[0]!.severity).toBe("warning");
  });

  it("test_b15_insights_date_operators_valid", () => {
    const insightsDateOps = [
      "was on",
      "was not on",
      "was in the",
      "was not in the",
      "was between",
      "was not between",
      "was less than",
      "was before",
      "was since",
      "was in the next",
    ];
    for (const op of insightsDateOps) {
      const bm = minimalBookmark();
      bm.sections["filter"] = [
        {
          filterType: "datetime",
          filterOperator: op,
          value: "created",
          filterValue: "2024-01-01",
        },
      ];
      const errors = validateBookmark(bm);
      const opErrors = withCode(errors, "B15_INVALID_FILTER_OPERATOR");
      expect(
        opErrors.length,
        `Operator '${op}' should be valid but got B15 warning`,
      ).toBe(0);
    }
  });

  it("test_b18_missing_filter_property", () => {
    const bm = minimalBookmark();
    bm.sections["filter"] = [
      {
        filterType: "string",
        filterOperator: "equals",
        filterValue: ["US"],
      },
    ];
    const errors = validateBookmark(bm);
    expect(errors.some((e) => e.code === "B18_MISSING_FILTER_PROPERTY")).toBe(
      true,
    );
  });

  it("test_b18_custom_property_id_passes", () => {
    const bm = minimalBookmark();
    bm.sections["filter"] = [
      {
        filterType: "string",
        filterOperator: "equals",
        filterValue: ["US"],
        customPropertyId: 42,
        resourceType: "events",
      },
    ];
    const errors = validateBookmark(bm);
    expect(errors.some((e) => e.code === "B18_MISSING_FILTER_PROPERTY")).toBe(
      false,
    );
  });

  it("test_b18_custom_property_dict_passes", () => {
    const bm = minimalBookmark();
    bm.sections["filter"] = [
      {
        filterType: "string",
        filterOperator: "equals",
        filterValue: ["US"],
        customProperty: {
          displayFormula: "A",
          composedProperties: {},
        },
        resourceType: "events",
      },
    ];
    const errors = validateBookmark(bm);
    expect(errors.some((e) => e.code === "B18_MISSING_FILTER_PROPERTY")).toBe(
      false,
    );
  });

  it("test_formula_show_clause_valid", () => {
    const bm = minimalBookmark();
    bm.sections.show.push({
      formula: { definition: "(A/B)*100", name: "Rate" },
    });
    const errors = validateBookmark(bm);
    expect(errors.some((e) => e.code === "B6_MISSING_BEHAVIOR")).toBe(false);
  });

  it("test_valid_filter_passes", () => {
    const bm = minimalBookmark();
    bm.sections["filter"] = [
      {
        filterType: "string",
        filterOperator: "equals",
        value: "country",
        filterValue: ["US"],
        resourceType: "events",
      },
    ];
    const errors = validateBookmark(bm);
    const filterErrors = errors.filter(
      (e) =>
        e.code.startsWith("B14") ||
        e.code.startsWith("B15") ||
        e.code.startsWith("B18"),
    );
    expect(filterErrors).toEqual([]);
  });

  it("test_valid_group_passes", () => {
    const bm = minimalBookmark();
    bm.sections["group"] = [
      {
        propertyName: "platform",
        propertyType: "string",
        resourceType: "events",
      },
    ];
    const errors = validateBookmark(bm);
    const groupErrors = errors.filter((e) => e.code.startsWith("B17"));
    expect(groupErrors).toEqual([]);
  });
});

// =============================================================================
// _validate_measurement with bookmark_type="funnels"
// =============================================================================

describe("TestValidateMeasurementFunnelContext", () => {
  it("test_funnel_math_accepted", () => {
    const funnelMathTypes = [
      "conversion_rate_unique",
      "conversion_rate_total",
      "conversion_rate_session",
      "unique",
      "total",
      "general",
      "session",
      "conversion_rate",
    ];
    for (const mathType of funnelMathTypes) {
      const bm = minimalFunnelBookmark(mathType);
      const errors = validateBookmark(bm, { bookmark_type: "funnels" });
      const mathErrors = withCode(errors, "B9_INVALID_MATH");
      expect(
        mathErrors,
        `math='${mathType}' should be valid for funnels`,
      ).toEqual([]);
    }
  });

  it("test_insights_only_math_rejected_in_funnel_context", () => {
    const insightsOnly = ["dau", "wau", "mau", "cumulative_unique"];
    for (const mathType of insightsOnly) {
      const bm = minimalFunnelBookmark(mathType);
      const errors = validateBookmark(bm, { bookmark_type: "funnels" });
      const mathErrors = withCode(errors, "B9_INVALID_MATH");
      expect(
        mathErrors.length,
        `math='${mathType}' should be invalid for funnels`,
      ).toBe(1);
    }
  });

  it("test_funnel_math_rejected_in_insights_context", () => {
    const funnelOnly = [
      "conversion_rate",
      "conversion_rate_session",
      "general",
      "session",
    ];
    for (const mathType of funnelOnly) {
      const bm = minimalBookmark();
      (bm.sections.show[0]!["measurement"] as Dict)["math"] = mathType;
      const errors = validateBookmark(bm, { bookmark_type: "insights" });
      const mathErrors = withCode(errors, "B9_INVALID_MATH");
      expect(
        mathErrors.length,
        `math='${mathType}' should be invalid for insights`,
      ).toBe(1);
    }
  });

  it("test_funnel_math_with_suggestion", () => {
    const bm = minimalFunnelBookmark("conversion_rate_uniqu");
    const errors = validateBookmark(bm, { bookmark_type: "funnels" });
    const mathErrors = withCode(errors, "B9_INVALID_MATH");
    expect(mathErrors.length).toBe(1);
    expect(mathErrors[0]!.suggestion).not.toBeNull();
    expect(mathErrors[0]!.suggestion).toContain("conversion_rate_unique");
  });
});

// =============================================================================
// Layer 2: sorting block validation
// =============================================================================

describe("TestValidateSortingBlock", () => {
  it("test_sorting_omitted_no_errors", () => {
    const errors = validateBookmark(minimalBookmark());
    const sortErrors = errors.filter((e) => e.code.startsWith("S"));
    expect(sortErrors).toEqual([]);
  });

  it("test_sorting_empty_dict_no_errors", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {};
    const errors = validateBookmark(bm);
    const sortErrors = errors.filter((e) => e.code.startsWith("S"));
    expect(sortErrors).toEqual([]);
  });

  it("test_sorting_canonical_column_config_passes", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {
      bar: { sortBy: "column", colSortAttrs: [] },
    };
    const errors = validateBookmark(bm);
    const sortErrors = errors.filter((e) => e.code.startsWith("S"));
    expect(sortErrors).toEqual([]);
  });

  it("test_sorting_value_config_with_attrs_passes", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {
      bar: {
        sortBy: "column",
        colSortAttrs: [
          {
            sortBy: "value",
            sortOrder: "asc",
            valueField: "averageValue",
          },
        ],
      },
    };
    const errors = validateBookmark(bm);
    const sortErrors = errors.filter((e) => e.code.startsWith("S"));
    expect(sortErrors).toEqual([]);
  });

  it("test_sorting_invalid_sort_by_caught", () => {
    const bm = minimalBookmark();
    bm["sorting"] = { bar: { sortBy: "totally bogus", colSortAttrs: [] } };
    const errors = validateBookmark(bm);
    const s1 = withCode(errors, "S1_INVALID_SORT_BY");
    expect(s1.length).toBe(1);
    expect(s1[0]!.path).toBe("sorting.bar.sortBy");
  });

  it("test_sorting_extra_segmentation_field_caught", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {
      bar: {
        sortBy: "value",
        segmentation: "value",
        colSortAttrs: [],
      },
    };
    const errors = validateBookmark(bm);
    const extra = withCode(errors, "S3_UNKNOWN_FIELD");
    expect(extra.length).toBe(1);
    expect(extra[0]!.path).toBe("sorting.bar.segmentation");
  });

  it("test_sorting_missing_col_sort_attrs_caught", () => {
    const bm = minimalBookmark();
    bm["sorting"] = { bar: { sortBy: "value" } };
    const errors = validateBookmark(bm);
    const missing = withCode(errors, "S2_MISSING_COL_SORT_ATTRS");
    expect(missing.length).toBe(1);
    expect(missing[0]!.path).toBe("sorting.bar.colSortAttrs");
  });

  it("test_sorting_collects_missing_col_sort_attrs_and_extra_segmentation", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {
      bar: {
        sortBy: "value",
        sortOrder: "asc",
        segmentation: "value",
      },
      "funnel-steps": {
        sortBy: "value",
        sortOrder: "asc",
        segmentation: "value",
      },
    };
    const errors = validateBookmark(bm);
    const missing = withCode(errors, "S2_MISSING_COL_SORT_ATTRS");
    expect(missing.length).toBe(2);
    const extraSegs = errors.filter(
      (e) => e.code === "S3_UNKNOWN_FIELD" && e.path.endsWith(".segmentation"),
    );
    expect(extraSegs.length).toBe(2);
  });

  it("test_sorting_unknown_chart_type_warning", () => {
    const bm = minimalBookmark();
    bm["sorting"] = { barz: { sortBy: "column", colSortAttrs: [] } };
    const errors = validateBookmark(bm);
    const unknown = withCode(errors, "S4_UNKNOWN_CHART_TYPE");
    expect(unknown.length).toBe(1);
    expect(unknown[0]!.severity).toBe("warning");
    expect(unknown[0]!.suggestion).not.toBeNull();
    expect(unknown[0]!.suggestion).toContain("bar");
  });

  it("test_sorting_chart_config_must_be_dict", () => {
    const bm = minimalBookmark();
    bm["sorting"] = { bar: "asc" };
    const errors = validateBookmark(bm);
    const typeErr = withCode(errors, "S5_NOT_A_DICT");
    expect(typeErr.length).toBe(1);
    expect(typeErr[0]!.path).toBe("sorting.bar");
  });

  it("test_sorting_block_must_be_dict", () => {
    const bm = minimalBookmark();
    bm["sorting"] = ["asc"];
    const errors = validateBookmark(bm);
    const typeErr = withCode(errors, "S5_NOT_A_DICT");
    expect(typeErr.length).toBe(1);
    expect(typeErr[0]!.path).toBe("sorting");
  });

  it("test_sorting_invalid_col_sort_attr_sort_order", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {
      bar: {
        sortBy: "column",
        colSortAttrs: [
          { sortBy: "value", sortOrder: "ascending", valueField: "x" },
        ],
      },
    };
    const errors = validateBookmark(bm);
    const orderErr = withCode(errors, "S6_INVALID_SORT_ORDER");
    expect(orderErr.length).toBe(1);
  });

  it("test_sorting_col_sort_attrs_must_be_list", () => {
    const bm = minimalBookmark();
    bm["sorting"] = { bar: { sortBy: "column", colSortAttrs: {} } };
    const errors = validateBookmark(bm);
    const notAList = withCode(errors, "S7_NOT_A_LIST");
    expect(notAList.length).toBe(1);
    expect(notAList[0]!.path).toBe("sorting.bar.colSortAttrs");
  });

  it("test_sorting_value_config_with_canonical_top_level_fields_passes", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {
      bar: {
        sortBy: "value",
        sortOrder: "asc",
        valueField: "averageValue",
        viewNLimit: 50,
        colSortAttrs: [],
      },
    };
    const errors = validateBookmark(bm);
    const sortErrors = errors.filter((e) => e.code.startsWith("S"));
    expect(sortErrors).toEqual([]);
  });

  it("test_sorting_lift_comparison_value_accepted", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {
      bar: { sortBy: "liftComparisonValue", colSortAttrs: [] },
    };
    const errors = validateBookmark(bm);
    const s1 = withCode(errors, "S1_INVALID_SORT_BY");
    expect(s1).toEqual([]);
  });

  it("test_sorting_line_flat_label_config_accepted", () => {
    const bm = minimalBookmark();
    bm["sorting"] = { line: { sortBy: "label", sortOrder: "asc" } };
    const errors = validateBookmark(bm);
    const sortErrors = errors.filter((e) => e.code.startsWith("S"));
    expect(sortErrors).toEqual([]);
  });

  it("test_sorting_line_flat_value_config_accepted", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {
      line: {
        sortBy: "value",
        sortOrder: "desc",
        valueField: "averageValue",
      },
    };
    const errors = validateBookmark(bm);
    const sortErrors = errors.filter((e) => e.code.startsWith("S"));
    expect(sortErrors).toEqual([]);
  });

  it("test_sorting_line_column_config_still_requires_col_sort_attrs", () => {
    const bm = minimalBookmark();
    bm["sorting"] = { line: { sortBy: "column" } };
    const errors = validateBookmark(bm);
    const missing = withCode(errors, "S2_MISSING_COL_SORT_ATTRS");
    expect(missing.length).toBe(1);
    expect(missing[0]!.path).toBe("sorting.line.colSortAttrs");
  });

  it("test_sorting_line_invalid_sort_by_caught", () => {
    const bm = minimalBookmark();
    bm["sorting"] = { line: { sortBy: "totally bogus", sortOrder: "asc" } };
    const errors = validateBookmark(bm);
    const s1 = withCode(errors, "S1_INVALID_SORT_BY");
    expect(s1.length).toBe(1);
    expect(s1[0]!.path).toBe("sorting.line.sortBy");
  });

  it("test_sorting_non_line_label_still_rejected", () => {
    const bm = minimalBookmark();
    bm["sorting"] = { bar: { sortBy: "label", colSortAttrs: [] } };
    const errors = validateBookmark(bm);
    const s1 = withCode(errors, "S1_INVALID_SORT_BY");
    expect(s1.length).toBe(1);
    expect(s1[0]!.path).toBe("sorting.bar.sortBy");
  });

  it("test_col_sort_attr_missing_sort_by_caught", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {
      bar: {
        sortBy: "column",
        colSortAttrs: [{ sortOrder: "asc" }],
      },
    };
    const errors = validateBookmark(bm);
    const missing = withCode(errors, "S8_MISSING_SORT_BY");
    expect(missing.length).toBe(1);
    expect(missing[0]!.path).toBe("sorting.bar.colSortAttrs[0].sortBy");
  });

  it("test_col_sort_attr_invalid_sort_by_caught", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {
      bar: {
        sortBy: "column",
        colSortAttrs: [{ sortBy: "bogus", sortOrder: "asc" }],
      },
    };
    const errors = validateBookmark(bm);
    const s1 = withCode(errors, "S1_INVALID_SORT_BY");
    expect(s1.length).toBe(1);
    expect(s1[0]!.path).toBe("sorting.bar.colSortAttrs[0].sortBy");
  });

  it("test_col_sort_attr_column_sort_by_rejected", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {
      bar: {
        sortBy: "column",
        colSortAttrs: [{ sortBy: "column", sortOrder: "asc" }],
      },
    };
    const errors = validateBookmark(bm);
    const s1 = withCode(errors, "S1_INVALID_SORT_BY");
    expect(s1.length).toBe(1);
    expect(s1[0]!.path).toBe("sorting.bar.colSortAttrs[0].sortBy");
  });

  it("test_col_sort_attr_missing_sort_order_caught", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {
      bar: {
        sortBy: "column",
        colSortAttrs: [{ sortBy: "value", valueField: "x" }],
      },
    };
    const errors = validateBookmark(bm);
    const missing = withCode(errors, "S9_MISSING_SORT_ORDER");
    expect(missing.length).toBe(1);
    expect(missing[0]!.path).toBe("sorting.bar.colSortAttrs[0].sortOrder");
  });

  it("test_col_sort_attr_label_sort_by_accepted", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {
      bar: {
        sortBy: "column",
        colSortAttrs: [{ sortBy: "label", sortOrder: "asc" }],
      },
    };
    const errors = validateBookmark(bm);
    const sortErrors = errors.filter((e) => e.code.startsWith("S"));
    expect(sortErrors).toEqual([]);
  });

  // ------------------------------------------------------------------
  // Layer 1 / Layer 2 parity regressions (gap tests for Phase 1)
  // ------------------------------------------------------------------

  it("test_sorting_invalid_top_level_sort_order_rejected", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {
      bar: {
        sortBy: "value",
        sortOrder: "ascending",
        colSortAttrs: [],
      },
    };
    const errors = validateBookmark(bm);
    const s6 = withCode(errors, "S6_INVALID_SORT_ORDER");
    expect(s6.length).toBe(1);
    expect(s6[0]!.path).toBe("sorting.bar.sortOrder");
  });

  it("test_sorting_unhashable_sort_by_does_not_crash", () => {
    const bm = minimalBookmark();
    bm["sorting"] = { bar: { sortBy: [], colSortAttrs: [] } };
    const errors = validateBookmark(bm);
    const s1 = withCode(errors, "S1_INVALID_SORT_BY");
    expect(s1.length).toBe(1);
    expect(s1[0]!.path).toBe("sorting.bar.sortBy");
  });

  it("test_sorting_col_sort_attrs_none_rejected", () => {
    const bm = minimalBookmark();
    bm["sorting"] = { bar: { sortBy: "column", colSortAttrs: null } };
    const errors = validateBookmark(bm);
    const s7 = withCode(errors, "S7_NOT_A_LIST");
    expect(s7.length).toBe(1);
    expect(s7[0]!.path).toBe("sorting.bar.colSortAttrs");
  });

  it("test_sorting_line_flat_missing_sort_order_caught", () => {
    const bm = minimalBookmark();
    bm["sorting"] = { line: { sortBy: "label" } };
    const errors = validateBookmark(bm);
    const s9 = withCode(errors, "S9_MISSING_SORT_ORDER");
    expect(s9.length).toBe(1);
    expect(s9[0]!.path).toBe("sorting.line.sortOrder");
  });

  it("test_sorting_line_flat_extra_field_caught", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {
      line: { sortBy: "label", sortOrder: "asc", segmentation: "x" },
    };
    const errors = validateBookmark(bm);
    const s3 = withCode(errors, "S3_UNKNOWN_FIELD");
    expect(s3.length).toBe(1);
    expect(s3[0]!.path).toBe("sorting.line.segmentation");
  });

  it("test_sorting_line_label_with_col_sort_attrs_rejected", () => {
    const bm = minimalBookmark();
    bm["sorting"] = {
      line: { sortBy: "label", sortOrder: "asc", colSortAttrs: [] },
    };
    const errors = validateBookmark(bm);
    const s3 = withCode(errors, "S3_UNKNOWN_FIELD");
    expect(s3.length).toBe(1);
    expect(s3[0]!.path).toBe("sorting.line.colSortAttrs");
  });

  it("test_sorting_line_value_with_col_sort_attrs_routes_to_sort_config", () => {
    const bm = minimalBookmark();
    bm["sorting"] = { line: { sortBy: "value", colSortAttrs: [] } };
    const errors = validateBookmark(bm);
    const sortErrors = errors.filter((e) => e.code.startsWith("S"));
    expect(sortErrors).toEqual([]);
  });
});
