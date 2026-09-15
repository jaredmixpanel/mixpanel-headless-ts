/**
 * Layer-3 translation of `tests/unit/test_bookmark_schema_pbt.py`
 * (Python revision: `ts-port/phase2-contract-support` HEAD; 387 LOC,
 * 7 classes) — fast-check twins of the Hypothesis strategies, same
 * shapes, same filters, same example budgets.
 *
 * Strategy mirroring notes (R10.2):
 * - `st.text(min_size=1, max_size=50)` → `fc.string` over the same
 *   size window with `unit: "binary"` so non-BMP code points can be
 *   generated (the B2 ASSERT-F1 narrowing fix).
 * - `_safe_extra_field_names` mirrors the `a-z`, 8..20 alphabet and the
 *   `_KNOWN_FIELDS` filter; the known-field set is rebuilt here from
 *   the ported model specs, so it drifts with them exactly as the
 *   Python set drifts with `model_fields`.
 * - `TestRoundtripSoundness` asserts the twin's OBSERVABLE half only:
 *   the port has validators, not parsers, so there is no `model_dump`
 *   to round-trip (see `schema.test.ts` header). The
 *   "validate → no errors" halves translate verbatim; the
 *   "dump → re-validate" halves become a second validation of the same
 *   input, which is what the property is guarding (statelessness).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  DISPLAY_OPTIONS_MODEL,
  FLOWS_BOOKMARK_PARAMS_MODEL,
  FLOWS_BOOKMARK_STEP_MODEL,
  getRootModelForBookmarkType,
  INSIGHTS_BOOKMARK_PARAMS_MODEL,
  PARTIAL_UPDATE_SUB_MODELS,
  SECTIONS_MODEL,
} from "../../src/bookmarks/schema.js";
import {
  SORT_BY_COLUMNS_CONFIG_MODEL,
  SORT_BY_VALUE_CONFIG_MODEL,
  validateWithPydantic,
} from "../../src/bookmarks/schema-sorting.js";
import type { ValidationError } from "../../src/errors.js";

/** Loose dict, the TS analogue of `dict[str, Any]`. */
type Dict = Record<string, unknown>;

/**
 * Port of `_valid_minimal_insights` (`test_bookmark_schema_pbt.py:44-57`).
 *
 * @returns A fresh minimal valid `InsightsBookmarkParams` dict.
 */
function validMinimalInsights(): Dict {
  return {
    displayOptions: { chartType: "bar" },
    sections: {
      show: [{ type: "metric", behavior: { type: "event", name: "Login" } }],
      time: [],
    },
  };
}

/**
 * Port of `_valid_minimal_flows` (`:60-65`).
 *
 * @returns A fresh minimal valid `FlowsBookmarkParams` dict.
 */
function validMinimalFlows(): Dict {
  return {
    steps: [{ event: "Login" }],
    date_range: { from_date: "2025-01-01", to_date: "2025-01-31" },
  };
}

/**
 * Port of `_KNOWN_FIELDS` (`:71-86`) — every field name (and alias) of
 * every model the extra-field property could collide with.
 */
const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  // InsightsBookmarkParams
  "columnWidths",
  "displayOptions",
  "forecastComparison",
  "legend",
  "liftComparison",
  "name",
  "sections",
  "sorting",
  "timeComparison",
  "versions",
  "executedMigrations",
  "alignment",
  "anchor_position",
  "anchorPosition",
  "cardinality",
  "cardinality_threshold",
  "chart_type",
  "chartType",
  "count_type",
  "date_range",
  "error",
  "exclusions",
  "fields",
  "filter_by_cohort",
  "filter_by_event",
  "global_access_type",
  "graph_sort_priority",
  "group_by",
  "hidden_events",
  "icon",
  "id",
  "isNewQBEnabled",
  "modified",
  "segments",
  "smartHub",
  "steps",
  "title",
  "trend_unit",
  "trendType",
  "ttcVizType",
  "use_query_sampling",
  "user",
  "user_id",
  // Behavior
  "type",
  "renamed",
  "dataGroupId",
  "filter",
  "filters",
  "filtersDeterminer",
  "resourceType",
  "behaviors",
  "raw_cohort",
  "customBucket",
  "conversionWindowDuration",
  "conversionWindowUnit",
  "funnelReentryMode",
  "funnelOrder",
  "aggregateBy",
  "retentionType",
  "retentionAlignmentType",
  "retentionUnit",
  "retentionUnbounded",
  "retentionUnboundedMode",
  "retentionCustomBucketSizes",
  "segmentationEvent",
  "unsavedId",
  "search",
  "profileType",
  "dataset",
  "datasetId",
  "projectId",
  "display",
  "disableCohortize",
  "customEventSet",
  "hasUnsavedChanges",
  // Behavior/FormulaShowClause
  "idx",
  "userNamed",
  "behavior",
  "measurement",
  "statsig",
  "srm",
  "comparisons",
  "isHidden",
  "isExpanded",
  "labelPrefix",
  "formulaLabel",
  "showClauseIndex",
  "goals",
  "overrides",
  "formula",
  "definition",
  "referencedMetrics",
  // BehaviorMeasurement
  "math",
  "property",
  "cumulative",
  "perUserAggregation",
  "rolling",
  "segmentMethod",
  "multiAttribution",
  "stepIndex",
  "actionMode",
  "actionStep",
  "retentionBucketIndex",
  "retentionCumulative",
  "retentionSegmentationEvent",
  "percentile",
  // Sort configs
  "sortBy",
  "sortOrder",
  "valueField",
  "colSortAttrs",
  "viewNLimit",
  "sortColumn",
  "bar",
  "table",
  "line",
  "pie",
  "insights_metric",
  "retention_curve",
  "funnel_steps",
  // FlowsBookmarkParams / FlowsBookmarkStep
  "date_range_",
  "flows_merge_type",
  "version",
  "conversion_window",
  "collapse_repeated",
  "show_custom_events",
  "aggregate_by",
  "data_group_id",
  "time_percentiles_enabled",
  "event",
  "event_id",
  "custom_event",
  "session_event",
  "step_label",
  "forward",
  "reverse",
  "bool_op",
  "property_filter_params_list",
  // Sections
  "cohorts",
  "group",
  "metricLevelDataGroups",
  "show",
  "time",
  "globalDataGroupId",
  // Pydantic field aliases that may surface
  "funnel-steps",
  "retention-curve",
  "insights-metric",
  "_idx",
  "from",
  "to",
  "conv-first-step",
  "conv-prev-step",
]);

/** Port of `_safe_extra_field_names` (`:89-93`). */
const safeExtraFieldNames = fc
  .string({
    minLength: 8,
    maxLength: 20,
    unit: fc.constantFrom(
      ..."abcdefghijklmnopqrstuvwxyz".split("").map((c) => c),
    ),
  })
  .filter((s) => !KNOWN_FIELDS.has(s) && !s.startsWith("_"));

/**
 * Port of `_INSIGHTS_LEGACY_FIELDS` (`:100-133`) — the 32 documented
 * `Ignore[T]` fields with type-correct values.
 */
const INSIGHTS_LEGACY_FIELDS: ReadonlyArray<readonly [string, unknown]> = [
  ["alignment", "any-json-value"],
  ["anchor_position", 1],
  ["anchorPosition", 1],
  ["cardinality", 5],
  ["cardinality_threshold", 10],
  ["chart_type", "bar"],
  ["chartType", "bar"],
  ["count_type", "unique"],
  ["date_range", { from_date: "2025-01-01" }],
  ["error", "some-error"],
  ["exclusions", []],
  ["fields", ["a", "b"]],
  ["filter_by_cohort", 42],
  ["filter_by_event", "Login"],
  ["global_access_type", "public"],
  ["graph_sort_priority", 1],
  ["group_by", []],
  ["hidden_events", []],
  ["icon", "icon-name"],
  ["id", 12345],
  ["isNewQBEnabled", true],
  ["modified", "2025-01-01"],
  ["segments", []],
  ["smartHub", {}],
  ["steps", []],
  ["title", "old title"],
  ["trend_unit", "day"],
  ["trendType", "linear"],
  ["ttcVizType", "line"],
  ["use_query_sampling", true],
  ["user", "test"],
  ["user_id", 42],
];

/**
 * `validate_with_pydantic(InsightsBookmarkParams, params)`.
 *
 * @param params - The params dict.
 * @returns Translated validation errors.
 */
function validateInsights(params: unknown): ValidationError[] {
  return validateWithPydantic(INSIGHTS_BOOKMARK_PARAMS_MODEL.validate, params);
}

describe("TestRoundtripSoundness", () => {
  it("test_insights_minimal_roundtrip_no_errors", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50, unit: "binary" }),
        (name) => {
          const params = validMinimalInsights();
          params["name"] = name;
          expect(validateInsights(params)).toEqual([]);
          // The twin has no `model_dump`; re-validating the same input
          // is the statelessness half of the Python property.
          expect(validateInsights(params)).toEqual([]);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("test_sort_by_columns_roundtrip", () => {
    fc.assert(
      fc.property(fc.constantFrom("column"), (sortBy) => {
        const raw = { sortBy, colSortAttrs: [] };
        expect(
          validateWithPydantic(SORT_BY_COLUMNS_CONFIG_MODEL.validate, raw),
        ).toEqual([]);
      }),
      { numRuns: 20 },
    );
  });

  it("test_flows_step_roundtrip", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 }), (forward) => {
        expect(
          FLOWS_BOOKMARK_STEP_MODEL.validate({ event: "Login", forward }),
        ).toEqual([]);
      }),
      { numRuns: 20 },
    );
  });
});

describe("TestValidatorIdempotence", () => {
  it("test_validator_no_state_leak", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), (extraCount) => {
        const valid = validMinimalInsights();
        expect(validateInsights(valid)).toEqual([]);
        const bad: Dict = { ...valid };
        for (let i = 0; i <= extraCount; i += 1) {
          bad[`definitely_unknown_${String(i)}`] = i;
        }
        expect(validateInsights(bad).length).toBeGreaterThanOrEqual(1);
        expect(validateInsights(valid)).toEqual([]);
      }),
      { numRuns: 20 },
    );
  });
});

describe("TestExtraFieldRejection", () => {
  it("test_unknown_field_on_sections_rejected", () => {
    fc.assert(
      fc.property(safeExtraFieldNames, (fieldName) => {
        const params = validMinimalInsights();
        (params["sections"] as Dict)[fieldName] = "anything";
        const errs = validateInsights(params);
        expect(
          errs.some(
            (e) => e.code === "S3_UNKNOWN_FIELD" && e.path.includes(fieldName),
          ),
        ).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it("test_unknown_field_on_behavior_rejected", () => {
    fc.assert(
      fc.property(safeExtraFieldNames, (fieldName) => {
        const params = validMinimalInsights();
        const show = (params["sections"] as Dict)["show"] as Dict[];
        (show[0]!["behavior"] as Dict)[fieldName] = 1;
        const errs = validateInsights(params);
        expect(
          errs.some(
            (e) => e.code === "S3_UNKNOWN_FIELD" && e.path.includes(fieldName),
          ),
        ).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it("test_unknown_field_on_sort_config_rejected", () => {
    fc.assert(
      fc.property(safeExtraFieldNames, (fieldName) => {
        const bad: Dict = {
          sortBy: "value",
          colSortAttrs: [],
          [fieldName]: "x",
        };
        const errs = validateWithPydantic(
          SORT_BY_VALUE_CONFIG_MODEL.validate,
          bad,
        );
        expect(
          errs.some(
            (e) => e.code === "S3_UNKNOWN_FIELD" && e.path.includes(fieldName),
          ),
        ).toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});

describe("TestRequiredFieldRejection", () => {
  it("test_missing_required_top_level_field_rejected", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("displayOptions", "sections"),
        (fieldName) => {
          const params = validMinimalInsights();
          Reflect.deleteProperty(params, fieldName);
          const errs = validateInsights(params);
          expect(
            errs.some(
              (e) =>
                e.code === "B0_MISSING_FIELD" && e.path.includes(fieldName),
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 10 },
    );
  });

  it("test_missing_required_sections_field_rejected", () => {
    fc.assert(
      fc.property(fc.constantFrom("show", "time"), (fieldName) => {
        const params = validMinimalInsights();
        Reflect.deleteProperty(params["sections"] as Dict, fieldName);
        const errs = validateInsights(params);
        expect(
          errs.some(
            (e) => e.code === "B0_MISSING_FIELD" && e.path.includes(fieldName),
          ),
        ).toBe(true);
      }),
      { numRuns: 10 },
    );
  });
});

describe("TestDiscriminatorRejection", () => {
  const KNOWN_METRIC_TYPES: ReadonlySet<string> = new Set([
    "event",
    "simple",
    "cohort",
    "funnel",
    "retention",
    "formula",
    "custom-event",
    "people",
    "saved-metric",
    "verified",
    "retention-frequency",
    "addiction",
    "metric",
  ]);

  it("test_bad_behavior_type_rejected", () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 2, maxLength: 15, unit: "binary" })
          .filter((s) => !KNOWN_METRIC_TYPES.has(s)),
        (badType) => {
          const params = validMinimalInsights();
          const show = (params["sections"] as Dict)["show"] as Dict[];
          (show[0]!["behavior"] as Dict)["type"] = badType;
          const errs = validateInsights(params);
          expect(
            errs.some(
              (e) =>
                e.code === "B0_INVALID_LITERAL" ||
                e.code === "B7_INVALID_BEHAVIOR_TYPE",
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("test_bad_sort_by_rejected", () => {
    const KNOWN_SORT_BY: ReadonlySet<string> = new Set([
      "column",
      "value",
      "label",
      "liftComparisonValue",
    ]);
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 2, maxLength: 15, unit: "binary" })
          .filter((s) => !KNOWN_SORT_BY.has(s)),
        (badSortBy) => {
          expect(
            SORT_BY_COLUMNS_CONFIG_MODEL.validate({
              sortBy: badSortBy,
              colSortAttrs: [],
            }).length,
          ).toBeGreaterThan(0);
        },
      ),
      { numRuns: 30 },
    );
  });
});

describe("TestLegacyFieldTolerance", () => {
  it("test_legacy_field_tolerated", () => {
    fc.assert(
      fc.property(fc.constantFrom(...INSIGHTS_LEGACY_FIELDS), (field) => {
        const [fieldName, fieldValue] = field;
        const params = validMinimalInsights();
        params[fieldName] = fieldValue;
        expect(validateInsights(params)).toEqual([]);
      }),
      { numRuns: INSIGHTS_LEGACY_FIELDS.length },
    );
  });

  it("test_multiple_legacy_fields_tolerated", () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(fc.constantFrom(...INSIGHTS_LEGACY_FIELDS), {
            minLength: 2,
            maxLength: 5,
            selector: (t) => t[0],
          })
          .filter((fields) => fields.length >= 2),
        (fields) => {
          const params = validMinimalInsights();
          for (const [fieldName, fieldValue] of fields) {
            params[fieldName] = fieldValue;
          }
          expect(validateInsights(params)).toEqual([]);
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe("TestDispatchConsistency", () => {
  it("test_dispatch_returns_consistent_class", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("insights", "funnels", "retention", "flows", "user"),
        (bt) => {
          const m = getRootModelForBookmarkType(bt);
          if (bt === "insights" || bt === "funnels" || bt === "retention") {
            expect(m).toBe(INSIGHTS_BOOKMARK_PARAMS_MODEL);
          } else if (bt === "flows") {
            expect(m).toBe(FLOWS_BOOKMARK_PARAMS_MODEL);
          } else {
            expect(m).toBeNull();
          }
        },
      ),
      { numRuns: 5 },
    );
  });

  it("returns null for unknown and empty bookmark types", () => {
    // R10.9 `get_root_model_family` edge probe: Python's `dict.get()`
    // default makes "unknown" indistinguishable from the explicit
    // `"user" -> None` entry.
    for (const bt of ["", "insightz", "USER", "𝒳", "sorting"]) {
      expect(getRootModelForBookmarkType(bt)).toBeNull();
    }
  });

  it("exposes exactly the two partial-update sub-models", () => {
    // `sorting` is deliberately excluded (`bookmark_schema.py:362-369`).
    expect([...PARTIAL_UPDATE_SUB_MODELS.keys()]).toEqual([
      "sections",
      "displayOptions",
    ]);
    expect(PARTIAL_UPDATE_SUB_MODELS.get("sections")).toBe(SECTIONS_MODEL);
    expect(PARTIAL_UPDATE_SUB_MODELS.get("displayOptions")).toBe(
      DISPLAY_OPTIONS_MODEL,
    );
    expect(PARTIAL_UPDATE_SUB_MODELS.has("sorting")).toBe(false);
  });

  it("round-trips the flows root model on its minimal valid payload", () => {
    expect(
      validateWithPydantic(
        FLOWS_BOOKMARK_PARAMS_MODEL.validate,
        validMinimalFlows(),
      ),
    ).toEqual([]);
  });
});
