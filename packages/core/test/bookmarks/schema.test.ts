/**
 * Layer-3 translation of `tests/unit/test_bookmark_schema.py` (Python
 * revision: `ts-port/phase2-contract-support` HEAD; 574 LOC, 9
 * classes). B3-K1 owns all nine — the sorting-model classes were NOT
 * translated at B2 (that shard translated only the validator-facing
 * `validate_sorting_block` tests).
 *
 * **Structural-twin caveat (R10.2 honesty).** The TS port has no
 * pydantic: `bookmarks/schema{,-sorting}.ts` reproduces the models as
 * structural VALIDATORS, not parsers. So a Python assert of the form
 * `m = Model.model_validate(raw); assert m.sortBy == "column"` becomes
 * `expect(types(MODEL.validate(raw))).toStrictEqual([])` — the strongest
 * statement the twin can make (there is no `m` to inspect, and the
 * package's only consumer of these models,
 * `Workspace._validate_bookmark_params_schema`, reads the error stream
 * and discards the parsed object). Every `pytest.raises` assert keeps
 * its full strength: the pydantic error `type` string is asserted, not
 * merely "some error".
 *
 * The `type` strings asserted below are the twin's contract keys —
 * they are the `_DEFAULT_CODE_MAP` lookup keys — and every one is
 * pinned to the CPython pydantic probe recorded in
 * `docs/history/phase3/notes/B3-K1-notes.md` §Probe
 * (`throwaway/b3-k1/probe-*.py`, run 2026-08-15).
 */

import { describe, expect, it } from "vitest";

import {
  VALID_CHART_TYPES,
  VALID_FILTERS_DETERMINER,
  VALID_MATH_TYPES,
  VALID_METRIC_TYPES,
  VALID_RESOURCE_TYPES,
  VALID_TIME_UNITS,
} from "../../src/bookmarks/enums.js";
import {
  BEHAVIOR_MEASUREMENT_MODEL,
  CHART_TYPE_LITERAL_VALUES,
  DISPLAY_OPTIONS_MODEL,
  FILTERS_DETERMINER_LITERAL_VALUES,
  FLOWS_BOOKMARK_PARAMS_MODEL,
  FLOWS_BOOKMARK_STEP_MODEL,
  INSIGHTS_RESOURCE_TYPE_LITERAL_VALUES,
  MATH_TYPE_LITERAL_VALUES,
  METRIC_TYPE_LITERAL_VALUES,
  SECTIONS_MODEL,
  TIME_UNIT_LITERAL_VALUES,
} from "../../src/bookmarks/schema.js";
import {
  DEFAULT_CODE_MAP,
  defaultCodeMapper,
  FLAT_LABEL_SORT_CONFIG_MODEL,
  FLAT_VALUE_SORT_CONFIG_MODEL,
  INSIGHTS_BOOKMARK_SORT_CONFIG_MODEL,
  locToJsonPath,
  type PydanticErrorEntry,
  SORT_BY_COLUMNS_CONFIG_MODEL,
  SORT_BY_VALUE_CONFIG_MODEL,
  sortingCodeMapper,
  validateWithPydantic,
} from "../../src/bookmarks/schema-sorting.js";
import { ResponseValidationError } from "../../src/errors.js";
import { CreateBookmarkParams } from "../../src/types/entities/bookmarks.js";

/**
 * Error `type` strings in emission order.
 *
 * @param errors - Raw pydantic-twin entries.
 * @returns The `type` strings.
 */
function types(errors: readonly PydanticErrorEntry[]): string[] {
  return errors.map((e) => e.type);
}

/**
 * Python `e["loc"]` containment (`"colSortAttrs" in e["loc"]`).
 *
 * @param entry - One error entry.
 * @param needle - The `loc` member to look for.
 * @returns True when the tuple contains the member.
 */
function locHas(entry: PydanticErrorEntry, needle: string): boolean {
  return entry.loc.includes(needle);
}

// =============================================================================
// Sorting models
// =============================================================================

describe("Sort by columns config", () => {
  // python: TestSortByColumnsConfig
  it("valid minimal passes", () => {
    // python: test_valid_minimal_passes
    expect(
      types(
        SORT_BY_COLUMNS_CONFIG_MODEL.validate({
          sortBy: "column",
          colSortAttrs: [],
        }),
      ),
    ).toStrictEqual([]);
  });

  it("with value field passes", () => {
    // python: test_with_value_field_passes
    expect(
      types(
        SORT_BY_COLUMNS_CONFIG_MODEL.validate({
          sortBy: "column",
          colSortAttrs: [],
          valueField: "averageValue",
        }),
      ),
    ).toStrictEqual([]);
  });

  it("missing col sort attrs rejected", () => {
    // python: test_missing_col_sort_attrs_rejected
    const errs = SORT_BY_COLUMNS_CONFIG_MODEL.validate({ sortBy: "column" });
    expect(
      errs.some((e) => e.type === "missing" && locHas(e, "colSortAttrs")),
    ).toBe(true);
  });

  it("wrong sort by rejected", () => {
    // python: test_wrong_sort_by_rejected
    expect(
      SORT_BY_COLUMNS_CONFIG_MODEL.validate({
        sortBy: "value",
        colSortAttrs: [],
      }).length,
    ).toBeGreaterThan(0);
  });

  it("legacy sort order tolerated", () => {
    // python: test_legacy_sort_order_tolerated
    // Python asserts `"sortOrder" not in m.model_dump()`; the twin has
    // no dump surface, so the observable half is "accepted silently".
    expect(
      types(
        SORT_BY_COLUMNS_CONFIG_MODEL.validate({
          sortBy: "column",
          colSortAttrs: [],
          sortOrder: "asc",
        }),
      ),
    ).toStrictEqual([]);
  });

  it("legacy view n limit tolerated", () => {
    // python: test_legacy_view_n_limit_tolerated
    expect(
      types(
        SORT_BY_COLUMNS_CONFIG_MODEL.validate({
          sortBy: "column",
          colSortAttrs: [],
          viewNLimit: 50,
        }),
      ),
    ).toStrictEqual([]);
  });

  it("unknown field rejected", () => {
    // python: test_unknown_field_rejected
    const errs = SORT_BY_COLUMNS_CONFIG_MODEL.validate({
      sortBy: "column",
      colSortAttrs: [],
      segmentation: "value",
    });
    expect(errs.some((e) => e.type === "extra_forbidden")).toBe(true);
  });
});

describe("Sort by value config", () => {
  // python: TestSortByValueConfig
  it("valid minimal passes", () => {
    // python: test_valid_minimal_passes
    expect(
      types(
        SORT_BY_VALUE_CONFIG_MODEL.validate({
          sortBy: "value",
          colSortAttrs: [],
        }),
      ),
    ).toStrictEqual([]);
  });

  it("missing col sort attrs rejected", () => {
    // python: test_missing_col_sort_attrs_rejected
    expect(
      SORT_BY_VALUE_CONFIG_MODEL.validate({ sortBy: "value" }).length,
    ).toBeGreaterThan(0);
  });

  it("sort order optional", () => {
    // python: test_sort_order_optional
    // Python asserts `m.sortOrder is None`; the twin's observable is
    // that the absent optional produces no error.
    expect(
      types(
        SORT_BY_VALUE_CONFIG_MODEL.validate({
          sortBy: "value",
          colSortAttrs: [],
        }),
      ),
    ).toStrictEqual([]);
  });

  it("sort order when provided validated", () => {
    // python: test_sort_order_when_provided_validated
    expect(
      SORT_BY_VALUE_CONFIG_MODEL.validate({
        sortBy: "value",
        sortOrder: "ascending",
        colSortAttrs: [],
      }).length,
    ).toBeGreaterThan(0);
  });

  it("deprecated lift comparison value accepted", () => {
    // python: test_deprecated_lift_comparison_value_accepted
    expect(
      types(
        SORT_BY_VALUE_CONFIG_MODEL.validate({
          sortBy: "liftComparisonValue",
          colSortAttrs: [],
        }),
      ),
    ).toStrictEqual([]);
  });

  it("extra segmentation field rejected", () => {
    // python: test_extra_segmentation_field_rejected
    const errs = SORT_BY_VALUE_CONFIG_MODEL.validate({
      sortBy: "value",
      sortOrder: "asc",
      colSortAttrs: [],
      segmentation: "value",
    });
    expect(
      errs.some(
        (e) => e.type === "extra_forbidden" && locHas(e, "segmentation"),
      ),
    ).toBe(true);
  });
});

describe("Flat sort configs", () => {
  // python: TestFlatSortConfigs
  it("flat label valid", () => {
    // python: test_flat_label_valid
    expect(
      types(
        FLAT_LABEL_SORT_CONFIG_MODEL.validate({
          sortBy: "label",
          sortOrder: "asc",
        }),
      ),
    ).toStrictEqual([]);
  });

  it("flat value valid", () => {
    // python: test_flat_value_valid
    expect(
      types(
        FLAT_VALUE_SORT_CONFIG_MODEL.validate({
          sortBy: "value",
          sortOrder: "desc",
          valueField: "averageValue",
        }),
      ),
    ).toStrictEqual([]);
  });

  it("flat label missing sort order rejected", () => {
    // python: test_flat_label_missing_sort_order_rejected
    expect(
      FLAT_LABEL_SORT_CONFIG_MODEL.validate({ sortBy: "label" }).length,
    ).toBeGreaterThan(0);
  });
});

describe("Insights bookmark sort config", () => {
  // python: TestInsightsBookmarkSortConfig
  it("empty passes", () => {
    // python: test_empty_passes
    expect(
      types(INSIGHTS_BOOKMARK_SORT_CONFIG_MODEL.validate({})),
    ).toStrictEqual([]);
  });

  it("bar with columns config passes", () => {
    // python: test_bar_with_columns_config_passes
    expect(
      types(
        INSIGHTS_BOOKMARK_SORT_CONFIG_MODEL.validate({
          bar: { sortBy: "column", colSortAttrs: [] },
        }),
      ),
    ).toStrictEqual([]);
  });

  it("funnel steps kebab alias accepted", () => {
    // python: test_funnel_steps_kebab_alias_accepted
    expect(
      types(
        INSIGHTS_BOOKMARK_SORT_CONFIG_MODEL.validate({
          "funnel-steps": { sortBy: "column", colSortAttrs: [] },
        }),
      ),
    ).toStrictEqual([]);
  });

  it("retention curve kebab alias accepted", () => {
    // python: test_retention_curve_kebab_alias_accepted
    expect(
      types(
        INSIGHTS_BOOKMARK_SORT_CONFIG_MODEL.validate({
          "retention-curve": { sortBy: "column", colSortAttrs: [] },
        }),
      ),
    ).toStrictEqual([]);
  });

  it("unknown chart type rejected", () => {
    // python: test_unknown_chart_type_rejected
    expect(
      INSIGHTS_BOOKMARK_SORT_CONFIG_MODEL.validate({
        barz: { sortBy: "column", colSortAttrs: [] },
      }).length,
    ).toBeGreaterThan(0);
  });

  it("invalid sorting combinations collected", () => {
    // python: test_invalid_sorting_combinations_collected
    const bad = {
      bar: { sortBy: "value", sortOrder: "asc", segmentation: "value" },
      "funnel-steps": {
        sortBy: "value",
        sortOrder: "asc",
        segmentation: "value",
      },
    };
    const errs = INSIGHTS_BOOKMARK_SORT_CONFIG_MODEL.validate(bad);
    expect(
      errs.filter((e) => e.type === "missing").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      errs.filter(
        (e) => e.type === "extra_forbidden" && locHas(e, "segmentation"),
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================
// Adapter
// =============================================================================

describe("Pydantic adapter", () => {
  // python: TestPydanticAdapter
  it("loc to jsonpath top level", () => {
    // python: test_loc_to_jsonpath_top_level
    expect(locToJsonPath(["sortBy"], "")).toBe("sortBy");
  });

  it("loc to jsonpath nested with index", () => {
    // python: test_loc_to_jsonpath_nested_with_index
    expect(locToJsonPath(["show", 0, "behavior", "type"], "sections")).toBe(
      "sections.show[0].behavior.type",
    );
  });

  it("loc to jsonpath with prefix", () => {
    // python: test_loc_to_jsonpath_with_prefix
    expect(locToJsonPath(["bar", "sortBy"], "sorting")).toBe(
      "sorting.bar.sortBy",
    );
  });

  it("loc to jsonpath leading index", () => {
    // python: test_loc_to_jsonpath_leading_index
    expect(locToJsonPath([0, "name"], "")).toBe("[0].name");
  });

  it("loc to jsonpath strips discriminator tags", () => {
    // python: test_loc_to_jsonpath_strips_discriminator_tags
    expect(
      locToJsonPath(["line", "FlatLabelSortConfig", "sortOrder"], "sorting"),
    ).toBe("sorting.line.sortOrder");
  });

  it("unmapped error falls through to validation error", () => {
    // python: test_unmapped_error_falls_through_to_validation_error
    expect(defaultCodeMapper("totally_made_up_type", [])).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("default code mapper uses default map", () => {
    // python: test_default_code_mapper_uses_default_map
    expect(defaultCodeMapper("missing", [])).toBe("B0_MISSING_FIELD");
    expect(defaultCodeMapper("extra_forbidden", [])).toBe("S3_UNKNOWN_FIELD");
    expect(defaultCodeMapper("literal_error", [])).toBe("B0_INVALID_LITERAL");
  });

  it("sorting code mapper path disambiguation", () => {
    // python: test_sorting_code_mapper_path_disambiguation
    expect(sortingCodeMapper("missing", ["bar", "colSortAttrs"])).toBe(
      "S2_MISSING_COL_SORT_ATTRS",
    );
    expect(
      sortingCodeMapper("missing", ["bar", "colSortAttrs", 0, "sortBy"]),
    ).toBe("S8_MISSING_SORT_BY");
    expect(sortingCodeMapper("missing", ["line", "sortOrder"])).toBe(
      "S9_MISSING_SORT_ORDER",
    );
  });

  it("validate with pydantic uses code mapper when provided", () => {
    // python: test_validate_with_pydantic_uses_code_mapper_when_provided
    const myMapper = (): string => "CUSTOM_CODE";
    const errs = validateWithPydantic(
      SORT_BY_VALUE_CONFIG_MODEL.validate,
      { sortBy: "value" },
      { code_mapper: myMapper },
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs.every((e) => e.code === "CUSTOM_CODE")).toBe(true);
  });

  it("validate with pydantic path prefix prepended", () => {
    // python: test_validate_with_pydantic_path_prefix_prepended
    const errs = validateWithPydantic(
      SORT_BY_VALUE_CONFIG_MODEL.validate,
      { sortBy: "value" },
      { path_prefix: "custom.prefix" },
    );
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs.every((e) => e.path.startsWith("custom.prefix."))).toBe(true);
  });

  it("validate with pydantic no errors returns empty", () => {
    // python: test_validate_with_pydantic_no_errors_returns_empty
    expect(
      validateWithPydantic(FLAT_LABEL_SORT_CONFIG_MODEL.validate, {
        sortBy: "label",
        sortOrder: "asc",
      }),
    ).toStrictEqual([]);
  });
});

// =============================================================================
// Enum parity
// =============================================================================

describe("Enum parity", () => {
  // python: TestEnumParity
  const cases: ReadonlyArray<
    readonly [string, readonly string[], ReadonlySet<string>]
  > = [
    ["MathTypeLiteral", MATH_TYPE_LITERAL_VALUES, VALID_MATH_TYPES],
    ["ChartTypeLiteral", CHART_TYPE_LITERAL_VALUES, VALID_CHART_TYPES],
    ["MetricTypeLiteral", METRIC_TYPE_LITERAL_VALUES, VALID_METRIC_TYPES],
    ["TimeUnitLiteral", TIME_UNIT_LITERAL_VALUES, VALID_TIME_UNITS],
    [
      "InsightsResourceTypeLiteral",
      INSIGHTS_RESOURCE_TYPE_LITERAL_VALUES,
      VALID_RESOURCE_TYPES,
    ],
    [
      "FiltersDeterminerLiteral",
      FILTERS_DETERMINER_LITERAL_VALUES,
      VALID_FILTERS_DETERMINER,
    ],
  ];

  for (const [literalName, literalValues, frozenSet] of cases) {
    it(`test_literal_matches_frozenset[${literalName}]`, () => {
      expect([...literalValues].sort()).toStrictEqual([...frozenSet].sort());
    });
  }
});

// =============================================================================
// CreateBookmarkParams literal tightening
// =============================================================================

describe("Bookmark type literal", () => {
  // python: TestBookmarkTypeLiteral
  // NOTE: the Python assert reads pydantic's `literal_error` off
  // `CreateBookmarkParams`; the TS twin of that PUBLIC type is the
  // Phase-2 `EntityModel` port, whose `oneOf` check raises
  // `ResponseValidationError`. The assertion keeps its strength
  // (constructing with the typo must fail) against the twin's own
  // contract surface.
  it("create bookmark params rejects unknown type", () => {
    // python: test_create_bookmark_params_rejects_unknown_type
    expect(
      () =>
        new CreateBookmarkParams({
          name: "Test",
          bookmark_type: "insightz" as "insights",
          params: {},
        }),
    ).toThrow(ResponseValidationError);
  });

  it("create bookmark params accepts canonical types", () => {
    // python: test_create_bookmark_params_accepts_canonical_types
    for (const bt of [
      "insights",
      "funnels",
      "retention",
      "flows",
      "user",
    ] as const) {
      expect(
        () =>
          new CreateBookmarkParams({
            name: "X",
            bookmark_type: bt,
            params: {},
          }),
      ).not.toThrow();
    }
  });
});

// =============================================================================
// Math / chartType tightening
// =============================================================================

describe("Math and chart type tightening", () => {
  // python: TestMathAndChartTypeTightening
  it("behavior measurement rejects invalid math", () => {
    // python: test_behavior_measurement_rejects_invalid_math
    expect(
      BEHAVIOR_MEASUREMENT_MODEL.validate({ math: "totl" }).length,
    ).toBeGreaterThan(0);
  });

  it("behavior measurement accepts valid math", () => {
    // python: test_behavior_measurement_accepts_valid_math
    expect(
      types(BEHAVIOR_MEASUREMENT_MODEL.validate({ math: "total" })),
    ).toStrictEqual([]);
  });

  it("display options rejects invalid chart type", () => {
    // python: test_display_options_rejects_invalid_chart_type
    expect(
      DISPLAY_OPTIONS_MODEL.validate({ chartType: "lien" }).length,
    ).toBeGreaterThan(0);
  });

  it("display options accepts valid chart type", () => {
    // python: test_display_options_accepts_valid_chart_type
    expect(
      types(DISPLAY_OPTIONS_MODEL.validate({ chartType: "bar" })),
    ).toStrictEqual([]);
  });
});

// =============================================================================
// Flows
// =============================================================================

describe("Flows bookmark params", () => {
  // python: TestFlowsBookmarkParams
  it("flows bookmark params currently allows extras", () => {
    // python: test_flows_bookmark_params_currently_allows_extras
    // Pins `extra="allow"`: an unknown key must NOT produce
    // `extra_forbidden` (the `"forbid"` twin would).
    expect(
      types(
        FLOWS_BOOKMARK_PARAMS_MODEL.validate({
          steps: [{ event: "Login" }],
          date_range: { from_date: "2025-01-01" },
          totally_unknown_ui_field: 12345,
        }),
      ),
    ).toStrictEqual([]);
  });

  it("flows step bool op rejects invalid", () => {
    // python: test_flows_step_bool_op_rejects_invalid
    expect(
      FLOWS_BOOKMARK_STEP_MODEL.validate({ event: "X", bool_op: "annd" })
        .length,
    ).toBeGreaterThan(0);
  });
});

// =============================================================================
// Probe-pinned shapes (R10.2 additions, not weakenings)
//
// These lock the CPython probe findings that the Python unit file never
// exercised but that the twin's structural machinery must reproduce for
// the R10.9 differential fuzz to stand a chance. Every expectation is a
// verbatim transcript row from `throwaway/b3-k1/probe-*.py`.
// =============================================================================

describe("probe-pinned pydantic-core shapes", () => {
  it("emits declared-field errors in declaration order, then extras in input order", () => {
    // probe-detail.py `order/do-multiple`
    const errs = DISPLAY_OPTIONS_MODEL.validate({
      chartType: "nope",
      zzz: 1,
      plotStyle: "x",
      aaa: 2,
      analysis: "y",
    });
    expect(errs.map((e) => [e.type, e.loc.join(".")])).toStrictEqual([
      ["literal_error", "chartType"],
      ["literal_error", "plotStyle"],
      ["literal_error", "analysis"],
      ["extra_forbidden", "zzz"],
      ["extra_forbidden", "aaa"],
    ]);
  });

  it("reports the python-name key as extra when both alias and name are present", () => {
    // probe-detail.py `alias/fsstc-both`
    const errs = DISPLAY_OPTIONS_MODEL.validate({
      chartType: "bar",
      funnelStepsSelectedTableColumns: {
        "conv-first-step": true,
        conv_first_step: false,
      },
    });
    expect(errs.map((e) => [e.type, e.loc.join(".")])).toStrictEqual([
      ["extra_forbidden", "funnelStepsSelectedTableColumns.conv_first_step"],
    ]);
  });

  it("inserts the ShowClause Tag into loc and keeps nesting depth", () => {
    // probe-schema.py `sections/behavior-deep-subbehavior`
    const errs = SECTIONS_MODEL.validate({
      show: [
        {
          type: "metric",
          behavior: { behaviors: [{ behaviors: [{ type: "nope" }] }] },
        },
      ],
      time: [],
    });
    expect(errs.map((e) => [e.type, e.loc.join(".")])).toStrictEqual([
      [
        "literal_error",
        "show.0.BehaviorShowClause.behavior.behaviors.0.behaviors.0.type",
      ],
    ]);
  });

  it("selects FormulaShowClause on a bare `formula` key", () => {
    // probe-schema.py `sections/formula-extra-behavior-key`
    const errs = SECTIONS_MODEL.validate({
      show: [{ formula: "A", behavior: {} }],
      time: [],
    });
    expect(errs.map((e) => [e.type, e.loc.join(".")])).toStrictEqual([
      ["extra_forbidden", "show.0.FormulaShowClause.behavior"],
    ]);
  });

  it("never emits union_tag_* through the ShowClause discriminator", () => {
    // probe-schema.py `sections/show-element-not-dict`: a non-dict
    // element lands under the BehaviorShowClause Tag as `model_type`,
    // NOT as `union_tag_invalid`.
    const errs = SECTIONS_MODEL.validate({ show: [5], time: [] });
    expect(errs.map((e) => [e.type, e.loc.join(".")])).toStrictEqual([
      ["model_type", "show.0.BehaviorShowClause"],
    ]);
  });

  it("emits every plain-union member's errors, tagged with the member name", () => {
    // probe-schema.py `sections/meas-multiattr-bad-type`
    const errs = BEHAVIOR_MEASUREMENT_MODEL.validate({
      multiAttribution: { type: "nope" },
    });
    expect(errs.map((e) => [e.type, e.loc.join(".")])).toStrictEqual([
      ["literal_error", "multiAttribution.PredefinedMultiAttribution.type"],
      ["literal_error", "multiAttribution.CustomMultiAttribution.type"],
      ["missing", "multiAttribution.CustomMultiAttribution.name"],
      ["missing", "multiAttribution.CustomMultiAttribution.weights"],
    ]);
  });

  it("accepts a plain union as soon as one member validates", () => {
    // probe-schema.py `sections/meas-multiattr-custom-missing`
    expect(
      types(
        BEHAVIOR_MEASUREMENT_MODEL.validate({
          multiAttribution: { type: "custom" },
        }),
      ),
    ).toStrictEqual([]);
  });

  it("type-checks Ignore[str] / Ignore[int] / Ignore[bool] legacy fields", () => {
    // probe-schema.py `ibp/ignore-*`
    const model = FLOWS_BOOKMARK_PARAMS_MODEL;
    expect(
      types(model.validate({ steps: [], date_range: {}, chartType: 5 })),
    ).toStrictEqual(["string_type"]);
  });

  it("rejects explicit null on a non-Optional defaulted field", () => {
    // probe-order.py `fbp/collapse_repeated-null`
    expect(
      FLOWS_BOOKMARK_PARAMS_MODEL.validate({
        steps: [],
        date_range: {},
        collapse_repeated: null,
      }).map((e) => [e.type, e.loc.join(".")]),
    ).toStrictEqual([["bool_type", "collapse_repeated"]]);
  });

  it("keeps the i64 window for float->int and float->bool coercion", () => {
    // probe-bool2.py — R10.9 fuzz finding (seeds 99991 / 20260816):
    // an INTEGRAL float inside the i64 window coerces, one at or past
    // 2**63 does not. Python `int`s have no ceiling, so the guard is
    // keyed on float-ness (PyFloat carrier), never magnitude alone.
    const carrier = (spelling: string): unknown =>
      new (class {
        readonly spelling = spelling;
      })();
    expect(
      DISPLAY_OPTIONS_MODEL.validate({
        chartType: "bar",
        rollingWindowSize: carrier("4.611686018427388e+18"),
      }),
    ).toStrictEqual([]);
    expect(
      DISPLAY_OPTIONS_MODEL.validate({
        chartType: "bar",
        rollingWindowSize: carrier("1e+300"),
      }).map((e) => e.type),
    ).toStrictEqual(["int_parsing_size"]);
    // A bare JS number stands for a Python int — arbitrary precision.
    expect(
      DISPLAY_OPTIONS_MODEL.validate({
        chartType: "bar",
        rollingWindowSize: 1e300,
      }),
    ).toStrictEqual([]);
    expect(
      DISPLAY_OPTIONS_MODEL.validate({
        chartType: "bar",
        queryTimeSampling: carrier("2.0"),
      }).map((e) => e.type),
    ).toStrictEqual(["bool_parsing"]);
    expect(
      DISPLAY_OPTIONS_MODEL.validate({
        chartType: "bar",
        queryTimeSampling: carrier("1e+300"),
      }).map((e) => e.type),
    ).toStrictEqual(["bool_type"]);
    expect(
      DISPLAY_OPTIONS_MODEL.validate({
        chartType: "bar",
        queryTimeSampling: 2 ** 70,
      }).map((e) => e.type),
    ).toStrictEqual(["bool_type"]);
  });

  it("maps every reachable pydantic type through DEFAULT_CODE_MAP", () => {
    for (const t of [
      "missing",
      "extra_forbidden",
      "literal_error",
      "string_type",
      "int_type",
      "int_parsing",
      "bool_type",
      "bool_parsing",
      "float_type",
      "float_parsing",
      "list_type",
      "dict_type",
      "model_type",
    ]) {
      expect(DEFAULT_CODE_MAP.has(t)).toBe(true);
    }
    // `int_from_float`, `finite_number`, `too_long` and `tuple_type`
    // are reachable but unmapped — they fall through to the generic
    // code (probe transcript §unmapped).
    for (const t of [
      "int_from_float",
      "finite_number",
      "too_long",
      "tuple_type",
    ]) {
      expect(defaultCodeMapper(t, [])).toBe("VALIDATION_ERROR");
    }
  });
});
