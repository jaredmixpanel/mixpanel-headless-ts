/**
 * Structural twin of the non-sorting half of `bookmark_schema.py`: the
 * insights model tree, the display-option models, the two root params
 * models, the `bookmark_type` → root-model dispatch and
 * `PARTIAL_UPDATE_SUB_MODELS`. The sorting half and the model-description
 * machinery live in `./schema-sorting.js`; this file imports them and
 * never re-implements them.
 *
 * TS has no pydantic, so the reference semantics of every acceptance
 * decision below are pydantic-core in lax mode, measured against the
 * real thing rather than CPython's `int()`/`float()` or JS's
 * `parseInt`/`Number()`. The load-bearing findings this file encodes:
 *
 * 1. `Ignore[T]` is not "accept anything" — it is `T | None` with a
 *    default. `Ignore[JsonValue]` accepts everything, but
 *    `icon: Ignore[str]` rejects `12345` with `string_type`,
 *    `id: Ignore[int]` rejects `"notanint"` with `int_parsing`, and
 *    `isNewQBEnabled: Ignore[bool]` rejects `2` with `bool_parsing`.
 * 2. Non-Optional fields that merely carry a default reject `null` —
 *    `forward: int = 0` → `int_type`, `collapse_repeated: bool = False`
 *    → `bool_type`. Those fields carry `nullable: false`.
 * 3. `_show_clause_discriminator` can never fail — it is a plain
 *    callable returning one of two Tags, so `union_tag_invalid` /
 *    `union_tag_not_found` (and therefore `B7_INVALID_BEHAVIOR_TYPE`)
 *    are unreachable through this model tree; a non-dict `show` element
 *    surfaces as `model_type` under the `BehaviorShowClause` Tag.
 * 4. Plain (non-discriminated) unions short-circuit on the first member
 *    that validates and otherwise emit every member's errors in
 *    declaration order, each tagged with the member name in `loc`.
 * 5. `Literal[0..8]` uses Python equality — `True` matches `1`, `1.0`
 *    matches `1`, `"1"` does not.
 *
 * @see mixpanel_headless._internal.bookmark_schema
 * @internal
 */

import { isPythonDict } from "../compat/python-dict.js";
import {
  type FieldType,
  INSIGHTS_BOOKMARK_SORT_CONFIG,
  modelHandle,
  type ModelSpec,
  type RootModelHandle,
  SORT_ORDER_LITERAL,
  type UnionSpec,
} from "./schema-sorting.js";

// --- Non-sorting literal aliases ---
//
// Value tuples rather than bare `type` aliases: the model specs below
// consume them through `lit()`, and the enum-parity test compares six of
// them member-for-member against the `bookmark_enums` sets — the Python
// test reads `typing.get_args(alias)`, which has no TS analogue for a
// type. Those six are exported; the rest are module-private.

/** Mirrors show.py `FiltersDeterminer`. */
export const FILTERS_DETERMINER_LITERAL_VALUES = ["all", "any"] as const;

/** Mirrors show.py `ConversionWindowUnit`. */
const CONVERSION_WINDOW_UNIT_LITERAL_VALUES = [
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "session",
] as const;

/** Mirrors show.py `FunnelReentryModeType`. */
const FUNNEL_REENTRY_MODE_LITERAL_VALUES = [
  "default",
  "basic",
  "aggressive",
  "optimized",
] as const;

/** Mirrors show.py `FunnelOrder`. */
const FUNNEL_ORDER_LITERAL_VALUES = ["loose", "any"] as const;

/** Mirrors show.py `RetentionType`. */
const RETENTION_TYPE_LITERAL_VALUES = [
  "compounded",
  "birth",
  "addiction",
] as const;

/** Mirrors show.py `RetentionAlignmentType`. */
const RETENTION_ALIGNMENT_LITERAL_VALUES = ["birth", "interval_start"] as const;

/** Mirrors show.py `RetentionUnboundedModeType`. */
const RETENTION_UNBOUNDED_MODE_LITERAL_VALUES = [
  "none",
  "carry_back",
  "carry_forward",
  "consecutive_forward",
] as const;

/** Mirrors show.py `COUNT_USERS_ONCE_TYPE`. */
const SEGMENT_METHOD_LITERAL_VALUES = ["all", "first", "last"] as const;

/** Mirrors show.py `MultiAttributionType`. */
const MULTI_ATTRIBUTION_TYPE_LITERAL_VALUES = [
  "first_touch",
  "last_touch",
  "linear",
  "participation",
  "time_decay",
  "u_shaped",
  "j_shaped",
  "inverse_j_shaped",
  "custom",
  "session_replay_last",
] as const;

/** Mirrors show.py `START_END_TYPE`. */
const START_END_LITERAL_VALUES = ["start", "end"] as const;

/** Mirrors show.py `FiltersOperator`. */
const FILTERS_OPERATOR_LITERAL_VALUES = [
  "and",
  "or",
  "or_all",
  "and_any",
  "then",
] as const;

/** Mirrors show.py `AxisAssignment`. */
const AXIS_ASSIGNMENT_LITERAL_VALUES = ["primary", "secondary"] as const;

/** Mirrors common/definitions.py `MetricType`. */
export const METRIC_TYPE_LITERAL_VALUES = [
  "cohort",
  "custom-event",
  "event",
  "formula",
  "funnel",
  "people",
  "retention",
  "retention-frequency",
  "saved-metric",
  "simple",
  "verified",
  // Legacy values still observed in older bookmarks
  "addiction",
  "metric",
] as const;

/** Mirrors insights/definitions.py `InsightsResourceType`. */
export const INSIGHTS_RESOURCE_TYPE_LITERAL_VALUES = [
  "all",
  "cohort",
  "cohorts",
  "event",
  "events",
  "formulas",
  "other",
  "people",
  "user",
] as const;

/** Mirrors common/definitions.py `TimeUnit`. */
export const TIME_UNIT_LITERAL_VALUES = [
  "hour",
  "day",
  "week",
  "month",
  "second",
  "minute",
  "quarter",
  "year",
  "session",
  "hour_of_day",
  "day_of_week",
] as const;

/** Mirrors common/definitions.py `MATH_TYPE` union. */
export const MATH_TYPE_LITERAL_VALUES = [
  // Core counting
  "total",
  "unique",
  "cumulative_unique",
  "sessions",
  // Active users
  "dau",
  "wau",
  "mau",
  // Property aggregation
  "average",
  "median",
  "min",
  "max",
  // Percentiles
  "p25",
  "p75",
  "p90",
  "p99",
  "custom_percentile",
  // Advanced
  "histogram",
  "unique_values",
  "most_frequent",
  "first_value",
  "multi_attribution",
  "numeric_summary",
  // Per-user-only aggregation operator
  "session_replay_id_value",
  // Legacy / context-specific
  "general",
  "session",
  // Conversion (funnel/retention context)
  "conversion_rate",
  "conversion_rate_unique",
  "conversion_rate_total",
  "conversion_rate_session",
  "retention_rate",
] as const;

/** Mirrors display_options.py `ChartPlotStyle`. */
const CHART_PLOT_STYLE_LITERAL_VALUES = ["standard", "stacked"] as const;

/** Mirrors display_options.py `AnalysisType`. */
const ANALYSIS_TYPE_LITERAL_VALUES = [
  "linear",
  "logarithmic",
  "rolling",
  "cumulative",
] as const;

/** Mirrors display_options.py `ValueRepresentationType`. */
const VALUE_REPRESENTATION_LITERAL_VALUES = ["absolute", "relative"] as const;

/** Mirrors display_options.py `TableSummaryAggregation`. */
const TABLE_SUMMARY_AGGREGATION_LITERAL_VALUES = [
  "average",
  "sum",
  "min",
  "max",
  "median",
] as const;

/** Mirrors common/definitions.py `ChartType` union. */
export const CHART_TYPE_LITERAL_VALUES = [
  // Insights chart types
  "bar",
  "line",
  "pie",
  "bar-stacked",
  "stacked-line",
  "table",
  "insights-metric",
  "column",
  "stacked-column",
  "metric",
  // Flows chart types
  "sankey",
  "flows",
  "paths",
  // Funnel chart types
  "funnel-top-paths",
  "funnel-steps",
  "funnel-steps-metric",
  "funnel-trend",
  "funnel-frequency-line",
  "funnel-frequency-bar",
  "funnel-ttc-line",
  "funnel-ttc-bar",
  "funnel-median-ttc",
  // Retention chart types
  "line-retention",
  "retention-trend",
  "retention-trend-metric",
  "retention-table",
  "retention-curve",
  "frequency",
  // Impact chart types
  "impact-adoption",
  "impact-trends",
  "impact-propensity",
  // Legacy local additions
  "frequency-curve",
] as const;

// --- Field-type shorthands ---

/** `str`. */
const STR: FieldType = { kind: "str" };
/** `int`. */
const INT: FieldType = { kind: "int" };
/** `float`. */
const FLOAT: FieldType = { kind: "float" };
/** `bool`. */
const BOOL: FieldType = { kind: "bool" };
/** `JsonValue` / `Any` / `Ignore[JsonValue]`. */
const JSON_VALUE: FieldType = { kind: "json" };
/** `list[JsonValue]`. */
const JSON_LIST: FieldType = { kind: "list", item: JSON_VALUE };

/**
 * `Literal[...]` over strings.
 *
 * @param values - The admitted values, in declaration order.
 * @returns The field type.
 */
function lit(values: readonly string[]): FieldType {
  return { kind: "literal", values };
}

/**
 * A nested `BaseModel` field (thunked — the tree is recursive).
 *
 * @param model_ - Thunk returning the nested model spec.
 * @returns The field type.
 */
function model(model_: () => ModelSpec): FieldType {
  return { kind: "model", model: model_ };
}

/**
 * `list[Model]`.
 *
 * @param model_ - Thunk returning the element model spec.
 * @returns The field type.
 */
function modelList(model_: () => ModelSpec): FieldType {
  return { kind: "list", item: model(model_) };
}

// --- Insights model tree (bookmark_schema.py) ---

/** Mirrors show.py `RollingMeasurement`. */
const ROLLING_MEASUREMENT: ModelSpec = {
  name: "RollingMeasurement",
  fields: [{ key: "rollingWindowSize", type: INT, required: false }],
};

/** Mirrors show.py `MultiAttributionWeights`. */
const MULTI_ATTRIBUTION_WEIGHTS: ModelSpec = {
  name: "MultiAttributionWeights",
  fields: [
    { key: "first", type: INT, required: true },
    { key: "middle", type: INT, required: true },
    { key: "last", type: INT, required: true },
  ],
};

/** Mirrors show.py `CustomMultiAttribution`. */
const CUSTOM_MULTI_ATTRIBUTION: ModelSpec = {
  name: "CustomMultiAttribution",
  fields: [
    { key: "type", type: lit(["custom"]), required: true },
    { key: "name", type: STR, required: true },
    {
      key: "weights",
      type: model(() => MULTI_ATTRIBUTION_WEIGHTS),
      required: true,
    },
  ],
};

/** Mirrors show.py `PredefinedMultiAttribution`. */
const PREDEFINED_MULTI_ATTRIBUTION: ModelSpec = {
  name: "PredefinedMultiAttribution",
  fields: [
    {
      key: "type",
      type: lit(MULTI_ATTRIBUTION_TYPE_LITERAL_VALUES),
      required: true,
    },
    { key: "name", type: STR, required: false },
    {
      key: "weights",
      type: model(() => MULTI_ATTRIBUTION_WEIGHTS),
      required: false,
    },
    { key: "step_index", type: INT, required: false },
  ],
};

/**
 * Mirrors show.py `MultiAttribution` — a plain union, not a
 * discriminated one, so both members' errors surface when neither
 * validates.
 */
const MULTI_ATTRIBUTION: FieldType = {
  kind: "plainUnion",
  members: [
    {
      name: "PredefinedMultiAttribution",
      type: model(() => PREDEFINED_MULTI_ATTRIBUTION),
    },
    {
      name: "CustomMultiAttribution",
      type: model(() => CUSTOM_MULTI_ATTRIBUTION),
    },
  ],
};

/**
 * Mirrors show.py `StepRange`. `from` / `to` are the wire
 * aliases; `from_step` / `to_step` the Python names (both accepted,
 * `populate_by_name=True`).
 */
const STEP_RANGE: ModelSpec = {
  name: "StepRange",
  fields: [
    { key: "from", altKey: "from_step", type: INT, required: false },
    { key: "to", altKey: "to_step", type: INT, required: false },
  ],
};

/** Field list of `FunnelStep` — reused by the subclass. */
const FUNNEL_STEP_FIELDS = [
  {
    key: "bool_op",
    type: lit(FILTERS_OPERATOR_LITERAL_VALUES),
    required: false,
  },
  { key: "property_filter_params_list", type: JSON_LIST, required: false },
  { key: "event", type: STR, required: false },
  { key: "event_id", type: INT, required: false },
  { key: "custom_event", type: INT, required: false },
  { key: "custom_event_name", type: STR, required: false },
  { key: "step_label", type: STR, required: false },
  {
    key: "session_event",
    type: lit(START_END_LITERAL_VALUES),
    required: false,
  },
  { key: "forward", type: INT, required: false },
  { key: "reverse", type: INT, required: false },
  // Tolerated legacy fields (`Ignore[JsonValue]`).
  { key: "dropdown_tab_index", type: JSON_VALUE, required: false },
  { key: "filter", type: JSON_VALUE, required: false },
  { key: "property", type: JSON_VALUE, required: false },
  { key: "selected_property_type", type: JSON_VALUE, required: false },
  { key: "serialized", type: JSON_VALUE, required: false },
  { key: "type", type: JSON_VALUE, required: false },
] as const;

/**
 * Mirrors show.py `ExclusionFunnelStep`. Pydantic orders
 * inherited fields first and the subclass's `steps` last — that is the
 * error emission order.
 */
const EXCLUSION_FUNNEL_STEP: ModelSpec = {
  name: "ExclusionFunnelStep",
  fields: [
    ...FUNNEL_STEP_FIELDS,
    {
      key: "steps",
      type: model(() => STEP_RANGE),
      required: true,
      nullable: false,
    },
  ],
};

/** Mirrors show.py `MetricDisplay`. */
const METRIC_DISPLAY: ModelSpec = {
  name: "MetricDisplay",
  fields: [
    { key: "abbrev", type: BOOL, required: false },
    { key: "axis", type: lit(AXIS_ASSIGNMENT_LITERAL_VALUES), required: false },
    { key: "direction", type: lit(["up", "down"]), required: false },
    { key: "hideTrendline", type: BOOL, required: false },
    {
      key: "precision",
      type: { kind: "literalInt", values: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
      required: false,
    },
    { key: "prefix", type: STR, required: false },
    { key: "suffix", type: STR, required: false },
    { key: "trendline", type: BOOL, required: false },
  ],
};

/** Mirrors insights/definitions.py `Bucket`. */
const BUCKET: ModelSpec = {
  name: "Bucket",
  fields: [
    { key: "bucketSize", type: FLOAT, required: false },
    { key: "disabled", type: BOOL, required: false },
    { key: "groups", type: { kind: "list", item: FLOAT }, required: false },
    { key: "max", type: FLOAT, required: false },
    { key: "min", type: FLOAT, required: false },
    { key: "offset", type: INT, required: false },
    { key: "unit", type: STR, required: false },
  ],
};

/** Mirrors show.py `Winsorization`. */
const WINSORIZATION: ModelSpec = {
  name: "Winsorization",
  fields: [
    { key: "enabled", type: BOOL, required: false },
    { key: "lower_percentile", type: FLOAT, required: false },
    { key: "upper_percentile", type: FLOAT, required: false },
  ],
};

/** Mirrors show.py `Statsig`. */
const STATSIG: ModelSpec = {
  name: "Statsig",
  fields: [
    { key: "confidence", type: FLOAT, required: false },
    { key: "control_key", type: STR, required: true, nullable: false },
    { key: "sequential_testing_adjustment", type: JSON_VALUE, required: false },
    {
      key: "pre_exposure_date_range",
      type: { kind: "list", item: STR },
      required: false,
    },
    { key: "winsorization", type: model(() => WINSORIZATION), required: false },
    { key: "math", type: STR, required: false },
    {
      key: "exposures",
      // `dict[str, int | dict[str, int]]` — the union members carry
      // pydantic's rendered type names into `loc`.
      type: {
        kind: "dict",
        value: {
          kind: "plainUnion",
          members: [
            { name: "int", type: INT },
            {
              name: "dict[str,int]",
              type: { kind: "dict", value: INT },
            },
          ],
        },
      },
      required: false,
    },
    { key: "version", type: STR, required: false },
  ],
};

/** Mirrors show.py `SRM`. */
const SRM: ModelSpec = {
  name: "SRM",
  fields: [
    {
      key: "expectedRatios",
      type: { kind: "dict", value: FLOAT },
      required: true,
      nullable: false,
    },
  ],
};

/** Mirrors common/definitions.py `Goal`. */
const GOAL: ModelSpec = {
  name: "Goal",
  fields: [
    { key: "id", type: STR, required: true, nullable: false },
    { key: "label", type: STR, required: true, nullable: false },
    {
      key: "checkpoints",
      type: { kind: "list", item: { kind: "tuple", items: [STR, FLOAT] } },
      required: true,
      nullable: false,
    },
    {
      key: "target_type",
      type: lit(["absolute", "relative"]),
      required: false,
      // `= "absolute"` — a default, not `| None`.
      nullable: false,
    },
    { key: "target_input", type: FLOAT, required: false },
    // Deprecated fields, excluded from output (`Ignore[JsonValue]`).
    { key: "unit", type: JSON_VALUE, required: false },
    { key: "direction", type: JSON_VALUE, required: false },
  ],
};

/** Mirrors show.py `SubBehavior` — recursive. */
const SUB_BEHAVIOR: ModelSpec = {
  name: "SubBehavior",
  fields: [
    {
      key: "type",
      type: lit(["event", "custom-event", "funnel"]),
      required: false,
    },
    { key: "id", type: INT, required: false },
    { key: "name", type: STR, required: false },
    { key: "renamed", type: STR, required: false },
    { key: "filters", type: JSON_LIST, required: false },
    {
      key: "filtersDeterminer",
      type: lit(FILTERS_DETERMINER_LITERAL_VALUES),
      required: false,
    },
    {
      key: "funnelOrder",
      type: lit(FUNNEL_ORDER_LITERAL_VALUES),
      required: false,
    },
    { key: "behaviors", type: modelList(() => SUB_BEHAVIOR), required: false },
    { key: "display", type: model(() => METRIC_DISPLAY), required: false },
    { key: "customEventSet", type: BOOL, required: false },
  ],
};

/** Mirrors show.py `Behavior`. */
const BEHAVIOR: ModelSpec = {
  name: "Behavior",
  fields: [
    // Common fields
    { key: "type", type: lit(METRIC_TYPE_LITERAL_VALUES), required: false },
    { key: "id", type: INT, required: false },
    { key: "name", type: STR, required: false },
    { key: "renamed", type: STR, required: false },
    { key: "dataGroupId", type: STR, required: false },
    // Deprecated singular `filter`, retained as Ignore[T].
    { key: "filter", type: JSON_VALUE, required: false },
    { key: "filters", type: JSON_LIST, required: false },
    {
      key: "filtersDeterminer",
      type: lit(FILTERS_DETERMINER_LITERAL_VALUES),
      required: false,
    },
    {
      key: "resourceType",
      type: lit(INSIGHTS_RESOURCE_TYPE_LITERAL_VALUES),
      required: false,
    },
    { key: "behaviors", type: modelList(() => SUB_BEHAVIOR), required: false },
    // Inline cohort
    { key: "raw_cohort", type: JSON_VALUE, required: false },
    // Insights
    { key: "customBucket", type: model(() => BUCKET), required: false },
    // Funnel
    { key: "conversionWindowDuration", type: INT, required: false },
    {
      key: "conversionWindowUnit",
      type: lit(CONVERSION_WINDOW_UNIT_LITERAL_VALUES),
      required: false,
    },
    {
      key: "funnelReentryMode",
      type: lit(FUNNEL_REENTRY_MODE_LITERAL_VALUES),
      required: false,
    },
    {
      key: "funnelOrder",
      type: lit(FUNNEL_ORDER_LITERAL_VALUES),
      required: false,
    },
    {
      key: "exclusions",
      type: modelList(() => EXCLUSION_FUNNEL_STEP),
      required: false,
    },
    { key: "aggregateBy", type: JSON_LIST, required: false },
    // Retention
    {
      key: "retentionType",
      type: lit(RETENTION_TYPE_LITERAL_VALUES),
      required: false,
    },
    {
      key: "retentionAlignmentType",
      type: lit(RETENTION_ALIGNMENT_LITERAL_VALUES),
      required: false,
    },
    {
      key: "retentionUnit",
      type: lit(TIME_UNIT_LITERAL_VALUES),
      required: false,
    },
    { key: "retentionUnbounded", type: BOOL, required: false },
    {
      key: "retentionUnboundedMode",
      type: lit(RETENTION_UNBOUNDED_MODE_LITERAL_VALUES),
      required: false,
    },
    {
      key: "retentionCustomBucketSizes",
      type: { kind: "list", item: INT },
      required: false,
    },
    { key: "segmentationEvent", type: STR, required: false },
    // Deprecated / back-compat
    { key: "unsavedId", type: STR, required: false },
    { key: "search", type: STR, required: false },
    { key: "profileType", type: STR, required: false },
    { key: "dataset", type: STR, required: false },
    { key: "datasetId", type: STR, required: false },
    { key: "projectId", type: INT, required: false },
    { key: "display", type: model(() => METRIC_DISPLAY), required: false },
    { key: "disableCohortize", type: BOOL, required: false },
    { key: "customEventSet", type: BOOL, required: false },
    { key: "hasUnsavedChanges", type: BOOL, required: false },
  ],
};

/** Mirrors show.py `BehaviorMeasurement`. */
const BEHAVIOR_MEASUREMENT: ModelSpec = {
  name: "BehaviorMeasurement",
  fields: [
    { key: "dataGroupId", type: STR, required: false },
    { key: "math", type: lit(MATH_TYPE_LITERAL_VALUES), required: false },
    { key: "property", type: JSON_VALUE, required: false },
    { key: "cumulative", type: BOOL, required: false },
    { key: "perUserAggregation", type: STR, required: false },
    { key: "rolling", type: model(() => ROLLING_MEASUREMENT), required: false },
    {
      key: "segmentMethod",
      type: lit(SEGMENT_METHOD_LITERAL_VALUES),
      required: false,
    },
    { key: "multiAttribution", type: MULTI_ATTRIBUTION, required: false },
    { key: "stepIndex", type: INT, required: false },
    { key: "actionMode", type: STR, required: false },
    { key: "actionStep", type: INT, required: false },
    { key: "retentionBucketIndex", type: INT, required: false },
    { key: "retentionCumulative", type: BOOL, required: false },
    { key: "retentionSegmentationEvent", type: JSON_VALUE, required: false },
    { key: "percentile", type: FLOAT, required: false },
    // Tolerated legacy fields (`Ignore[JsonValue]`).
    { key: "id", type: JSON_VALUE, required: false },
    { key: "type", type: JSON_VALUE, required: false },
  ],
};

/** Mirrors show.py `FormulaMeasurement`. */
const FORMULA_MEASUREMENT: ModelSpec = {
  name: "FormulaMeasurement",
  fields: [
    { key: "cumulative", type: BOOL, required: false },
    { key: "rolling", type: model(() => ROLLING_MEASUREMENT), required: false },
    { key: "multiAttribution", type: MULTI_ATTRIBUTION, required: false },
  ],
};

/** Mirrors show.py `BehaviorShowClause`. */
const BEHAVIOR_SHOW_CLAUSE: ModelSpec = {
  name: "BehaviorShowClause",
  fields: [
    { key: "_idx", altKey: "idx", type: STR, required: false },
    { key: "type", type: lit(["metric"]), required: false },
    { key: "id", type: INT, required: false },
    { key: "userNamed", type: BOOL, required: false },
    { key: "name", type: STR, required: false },
    { key: "behavior", type: model(() => BEHAVIOR), required: false },
    {
      key: "measurement",
      type: model(() => BEHAVIOR_MEASUREMENT),
      required: false,
    },
    { key: "statsig", type: model(() => STATSIG), required: false },
    { key: "srm", type: model(() => SRM), required: false },
    { key: "comparisons", type: JSON_LIST, required: false },
    { key: "display", type: model(() => METRIC_DISPLAY), required: false },
    { key: "isHidden", type: BOOL, required: false },
    { key: "isExpanded", type: BOOL, required: false },
    { key: "labelPrefix", type: STR, required: false },
    { key: "formulaLabel", type: STR, required: false },
    { key: "showClauseIndex", type: INT, required: false },
    { key: "hasUnsavedChanges", type: BOOL, required: false },
    { key: "goals", type: modelList(() => GOAL), required: false },
    {
      key: "overrides",
      type: { kind: "dict", value: JSON_VALUE },
      required: false,
    },
  ],
};

/** Mirrors show.py `FormulaShowClause`. */
const FORMULA_SHOW_CLAUSE: ModelSpec = {
  name: "FormulaShowClause",
  fields: [
    { key: "_idx", altKey: "idx", type: STR, required: false },
    { key: "type", type: lit(["formula"]), required: false },
    { key: "formula", type: JSON_VALUE, required: false },
    {
      key: "measurement",
      type: model(() => FORMULA_MEASUREMENT),
      required: false,
    },
    { key: "statsig", type: model(() => STATSIG), required: false },
    { key: "display", type: model(() => METRIC_DISPLAY), required: false },
    { key: "isHidden", type: BOOL, required: false },
    { key: "isExpanded", type: BOOL, required: false },
    { key: "userNamed", type: BOOL, required: false },
    { key: "comparisons", type: JSON_LIST, required: false },
    { key: "id", type: INT, required: false },
    { key: "definition", type: STR, required: false },
    { key: "name", type: STR, required: false },
    {
      key: "referencedMetrics",
      type: modelList(() => BEHAVIOR_SHOW_CLAUSE),
      required: false,
    },
    { key: "hasUnsavedChanges", type: BOOL, required: false },
    {
      key: "overrides",
      type: { kind: "dict", value: JSON_VALUE },
      required: false,
    },
    { key: "goals", type: modelList(() => GOAL), required: false },
  ],
};

/**
 * The Python branch on `isinstance(v, dict)` splits key lookup from
 * `getattr`; every value the port can see here is a decoded JSON value,
 * so the non-dict branch is exactly "no `type` attribute, no `formula`
 * attribute" → `BehaviorShowClause`.
 * Dict-ness is {@link isPythonDict}, never `typeof`.
 *
 * @param v - The candidate `show` element.
 * @returns The selected `Tag` name.
 * @see mixpanel_headless._internal.bookmark_schema._show_clause_discriminator
 */
function showClauseDiscriminator(v: unknown): string {
  let clauseType: unknown;
  let hasFormula: boolean;
  if (isPythonDict(v)) {
    clauseType = Object.hasOwn(v, "type") ? v["type"] : undefined;
    hasFormula = Object.hasOwn(v, "formula");
  } else {
    clauseType = undefined;
    hasFormula = false;
  }
  return clauseType === "formula" || hasFormula
    ? "FormulaShowClause"
    : "BehaviorShowClause";
}

/** Mirrors show.py `ShowClause` discriminated union. */
const SHOW_CLAUSE: UnionSpec = {
  discriminate: showClauseDiscriminator,
  variants: new Map([
    ["FormulaShowClause", FORMULA_SHOW_CLAUSE],
    ["BehaviorShowClause", BEHAVIOR_SHOW_CLAUSE],
  ]),
};

// --- Sections (bookmark_schema.py) ---

/** Mirrors sections.py `Sections`. */
const SECTIONS: ModelSpec = {
  name: "Sections",
  fields: [
    { key: "cohorts", type: JSON_LIST, required: false },
    { key: "filter", type: JSON_LIST, required: false },
    { key: "formula", type: JSON_LIST, required: false },
    { key: "globalDataGroupId", type: STR, required: false },
    { key: "group", type: JSON_LIST, required: false },
    { key: "group_by", type: JSON_LIST, required: false },
    { key: "metricLevelDataGroups", type: BOOL, required: false },
    {
      key: "show",
      type: { kind: "list", item: { kind: "union", union: SHOW_CLAUSE } },
      required: true,
      nullable: false,
    },
    { key: "time", type: JSON_LIST, required: true, nullable: false },
  ],
};

// --- DisplayOptions (bookmark_schema.py) ---

/** Mirrors display_options.py `AnnotationOptions`. */
const ANNOTATION_OPTIONS: ModelSpec = {
  name: "AnnotationOptions",
  fields: [
    { key: "tagFilterIds", type: { kind: "list", item: INT }, required: false },
    { key: "showUntagged", type: BOOL, required: false },
    { key: "sortOrder", type: lit(SORT_ORDER_LITERAL), required: false },
    { key: "hideAnnotations", type: BOOL, required: false },
    {
      key: "creatorFilterIds",
      type: { kind: "list", item: INT },
      required: false,
    },
  ],
};

/** Mirrors display_options.py `CommentOptions`. */
const COMMENT_OPTIONS: ModelSpec = {
  name: "CommentOptions",
  fields: [{ key: "commentsDisabled", type: BOOL, required: false }],
};

/** Mirrors display_options.py `SegmentId`. */
const SEGMENT_ID: ModelSpec = {
  name: "SegmentId",
  fields: [
    { key: "prop", type: STR, required: true, nullable: false },
    { key: "propName", type: STR, required: false },
    { key: "cohortDesc", type: JSON_VALUE, required: false },
  ],
};

/**
 * Mirrors display_options.py `FunnelStepsSelectedTableColumns`
 *. The kebab-case wire keys come from the model's
 * `alias_generator`; every field is `bool = False` — a default, not an
 * `Optional`, so explicit `null` is rejected with `bool_type`.
 */
const FUNNEL_STEPS_SELECTED_TABLE_COLUMNS: ModelSpec = {
  name: "FunnelStepsSelectedTableColumns",
  fields: [
    {
      key: "conv-first-step",
      altKey: "conv_first_step",
      type: BOOL,
      required: false,
      nullable: false,
    },
    {
      key: "conv-prev-step",
      altKey: "conv_prev_step",
      type: BOOL,
      required: false,
      nullable: false,
    },
    { key: "count", type: BOOL, required: false, nullable: false },
    {
      key: "stat-sig",
      altKey: "stat_sig",
      type: BOOL,
      required: false,
      nullable: false,
    },
    {
      key: "time-first-step",
      altKey: "time_first_step",
      type: BOOL,
      required: false,
      nullable: false,
    },
    {
      key: "time-prev-step",
      altKey: "time_prev_step",
      type: BOOL,
      required: false,
      nullable: false,
    },
  ],
};

/** Mirrors display_options.py `DisplayOptions`. */
const DISPLAY_OPTIONS: ModelSpec = {
  name: "DisplayOptions",
  fields: [
    {
      key: "chartType",
      type: lit(CHART_TYPE_LITERAL_VALUES),
      required: true,
      nullable: false,
    },
    {
      key: "plotStyle",
      type: lit(CHART_PLOT_STYLE_LITERAL_VALUES),
      required: false,
    },
    {
      key: "analysis",
      type: lit(ANALYSIS_TYPE_LITERAL_VALUES),
      required: false,
    },
    {
      key: "value",
      type: lit(VALUE_REPRESENTATION_LITERAL_VALUES),
      required: false,
    },
    { key: "rollingWindowSize", type: INT, required: false },
    { key: "timeUnit", type: lit(TIME_UNIT_LITERAL_VALUES), required: false },
    { key: "primaryYAxisOptions", type: JSON_VALUE, required: false },
    { key: "secondaryYAxisOptions", type: JSON_VALUE, required: false },
    { key: "theme", type: JSON_VALUE, required: false },
    { key: "xAxisOptions", type: JSON_VALUE, required: false },
    {
      key: "annotationOptions",
      type: model(() => ANNOTATION_OPTIONS),
      required: false,
    },
    {
      key: "commentOptions",
      type: model(() => COMMENT_OPTIONS),
      required: false,
    },
    { key: "queryTimeSampling", type: BOOL, required: false },
    {
      key: "tableSummaryAggregation",
      type: lit(TABLE_SUMMARY_AGGREGATION_LITERAL_VALUES),
      required: false,
    },
    {
      key: "statSigControl",
      type: modelList(() => SEGMENT_ID),
      required: false,
    },
    {
      key: "funnelStepsSelectedTableColumns",
      type: model(() => FUNNEL_STEPS_SELECTED_TABLE_COLUMNS),
      required: false,
    },
    // Tolerated legacy field (`Ignore[JsonValue]`).
    { key: "axisAssignments", type: JSON_VALUE, required: false },
  ],
};

// --- InsightsBookmarkParams root (bookmark_schema.py) ---

/**
 * The 33 `Ignore[T]` legacy fields of `InsightsBookmarkParams`
 * Three of them are typed (`icon: Ignore[str]`,
 * `id: Ignore[int]`, `isNewQBEnabled: Ignore[bool]`) and do reject
 * wrong-typed values — see module note 1.
 */
const INSIGHTS_LEGACY_FIELDS = [
  { key: "alignment", type: JSON_VALUE, required: false },
  { key: "anchor_position", type: JSON_VALUE, required: false },
  { key: "anchorPosition", type: JSON_VALUE, required: false },
  { key: "cardinality", type: JSON_VALUE, required: false },
  { key: "cardinality_threshold", type: JSON_VALUE, required: false },
  { key: "chart_type", type: JSON_VALUE, required: false },
  { key: "chartType", type: JSON_VALUE, required: false },
  { key: "count_type", type: JSON_VALUE, required: false },
  { key: "date_range", type: JSON_VALUE, required: false },
  { key: "error", type: JSON_VALUE, required: false },
  { key: "exclusions", type: JSON_VALUE, required: false },
  { key: "fields", type: JSON_VALUE, required: false },
  { key: "filter_by_cohort", type: JSON_VALUE, required: false },
  { key: "filter_by_event", type: JSON_VALUE, required: false },
  { key: "global_access_type", type: JSON_VALUE, required: false },
  { key: "graph_sort_priority", type: JSON_VALUE, required: false },
  { key: "group_by", type: JSON_VALUE, required: false },
  { key: "hidden_events", type: JSON_VALUE, required: false },
  { key: "icon", type: STR, required: false },
  { key: "id", type: INT, required: false },
  { key: "isNewQBEnabled", type: BOOL, required: false },
  { key: "modified", type: JSON_VALUE, required: false },
  { key: "segments", type: JSON_VALUE, required: false },
  { key: "smartHub", type: JSON_VALUE, required: false },
  { key: "steps", type: JSON_VALUE, required: false },
  { key: "title", type: STR, required: false },
  { key: "trend_unit", type: JSON_VALUE, required: false },
  { key: "trendType", type: JSON_VALUE, required: false },
  { key: "ttcVizType", type: JSON_VALUE, required: false },
  { key: "use_query_sampling", type: JSON_VALUE, required: false },
  { key: "user", type: JSON_VALUE, required: false },
  { key: "user_id", type: JSON_VALUE, required: false },
] as const;

/** Mirrors bookmark.py `InsightsBookmarkParams`. */
const INSIGHTS_BOOKMARK_PARAMS: ModelSpec = {
  name: "InsightsBookmarkParams",
  fields: [
    { key: "columnWidths", type: JSON_VALUE, required: false },
    {
      key: "displayOptions",
      type: model(() => DISPLAY_OPTIONS),
      required: true,
      nullable: false,
    },
    { key: "forecastComparison", type: JSON_VALUE, required: false },
    { key: "legend", type: JSON_VALUE, required: false },
    { key: "liftComparison", type: JSON_VALUE, required: false },
    { key: "name", type: STR, required: false },
    {
      key: "sections",
      type: model(() => SECTIONS),
      required: true,
      nullable: false,
    },
    {
      key: "sorting",
      type: model(() => INSIGHTS_BOOKMARK_SORT_CONFIG),
      required: false,
    },
    { key: "timeComparison", type: JSON_VALUE, required: false },
    { key: "versions", type: { kind: "list", item: STR }, required: false },
    { key: "executedMigrations", type: JSON_LIST, required: false },
    ...INSIGHTS_LEGACY_FIELDS,
  ],
};

// --- Flows tree (bookmark_schema.py) ---

/** Mirrors mixpanel_mcp/.../bookmark.py `FlowsBookmarkStep`. */
const FLOWS_BOOKMARK_STEP: ModelSpec = {
  name: "FlowsBookmarkStep",
  fields: [
    { key: "event", type: STR, required: false },
    { key: "event_id", type: INT, required: false },
    { key: "custom_event", type: INT, required: false },
    {
      key: "session_event",
      type: lit(START_END_LITERAL_VALUES),
      required: false,
    },
    { key: "step_label", type: STR, required: false },
    { key: "forward", type: INT, required: false, nullable: false },
    { key: "reverse", type: INT, required: false, nullable: false },
    {
      key: "bool_op",
      type: lit(FILTERS_OPERATOR_LITERAL_VALUES),
      required: false,
      nullable: false,
    },
    {
      key: "property_filter_params_list",
      type: JSON_LIST,
      required: false,
      nullable: false,
    },
  ],
};

/**
 * Mirrors mixpanel_mcp/.../bookmark.py `FlowsBookmarkParams`.
 *
 * `extra: "allow"` is deliberate — Python's
 * `model_config = ConfigDict(populate_by_name=True, extra="allow")` —
 * and pinned by `test_flows_bookmark_params_currently_allows_extras`.
 * The Python source carries a `TODO(corpus parity)` to tighten this to
 * `extra="forbid"` once the UI-only fields that need `Ignore[T]`
 * tolerance are enumerated; the twin follows the source when that lands.
 */
const FLOWS_BOOKMARK_PARAMS: ModelSpec = {
  name: "FlowsBookmarkParams",
  extra: "allow",
  fields: [
    {
      key: "steps",
      type: modelList(() => FLOWS_BOOKMARK_STEP),
      required: true,
      nullable: false,
    },
    {
      key: "date_range",
      type: { kind: "dict", value: JSON_VALUE },
      required: true,
      nullable: false,
    },
    { key: "flows_merge_type", type: STR, required: false, nullable: false },
    { key: "count_type", type: STR, required: false, nullable: false },
    {
      key: "cardinality_threshold",
      type: INT,
      required: false,
      nullable: false,
    },
    { key: "version", type: INT, required: false, nullable: false },
    {
      key: "conversion_window",
      type: { kind: "dict", value: JSON_VALUE },
      required: false,
      nullable: false,
    },
    { key: "anchor_position", type: INT, required: false, nullable: false },
    {
      key: "alignment",
      type: { kind: "list", item: INT },
      required: false,
      nullable: false,
    },
    { key: "collapse_repeated", type: BOOL, required: false, nullable: false },
    { key: "show_custom_events", type: BOOL, required: false, nullable: false },
    {
      key: "hidden_events",
      type: { kind: "list", item: STR },
      required: false,
      nullable: false,
    },
    { key: "exclusions", type: JSON_LIST, required: false },
    { key: "filter_by_cohort", type: JSON_VALUE, required: false },
    { key: "filter_by_event", type: JSON_VALUE, required: false },
    { key: "group_by", type: JSON_LIST, required: false },
    { key: "aggregate_by", type: JSON_LIST, required: false },
    { key: "data_group_id", type: STR, required: false },
    { key: "segments", type: JSON_LIST, required: false },
    { key: "time_percentiles_enabled", type: BOOL, required: false },
    // UI compatibility
    { key: "chartType", type: STR, required: false },
  ],
};

// --- Model handles ---

/** Handle for `Sections`. */
export const SECTIONS_MODEL: RootModelHandle = modelHandle(SECTIONS);

/** Handle for `DisplayOptions`. */
export const DISPLAY_OPTIONS_MODEL: RootModelHandle =
  modelHandle(DISPLAY_OPTIONS);

/** Handle for `InsightsBookmarkParams`. */
export const INSIGHTS_BOOKMARK_PARAMS_MODEL: RootModelHandle = modelHandle(
  INSIGHTS_BOOKMARK_PARAMS,
);

/** Handle for `FlowsBookmarkParams`. */
export const FLOWS_BOOKMARK_PARAMS_MODEL: RootModelHandle = modelHandle(
  FLOWS_BOOKMARK_PARAMS,
);

/** Handle for `FlowsBookmarkStep` (leaf; used by the Layer-3 lock). */
export const FLOWS_BOOKMARK_STEP_MODEL: RootModelHandle =
  modelHandle(FLOWS_BOOKMARK_STEP);

/** Handle for `BehaviorMeasurement` (leaf; used by the Layer-3 lock). */
export const BEHAVIOR_MEASUREMENT_MODEL: RootModelHandle =
  modelHandle(BEHAVIOR_MEASUREMENT);

// --- Root-model dispatch ---

/**
 * Dispatch table behind {@link getRootModelForBookmarkType} — the
 * literal `{...}.get(bookmark_type)` of `bookmark_schema.py`,
 * as a `ReadonlyMap`. The `"user"` entry maps to `null`
 * explicitly (Python stores `None` in the dict), which is
 * indistinguishable from "absent" through `.get()`.
 */
const ROOT_MODELS: ReadonlyMap<string, RootModelHandle | null> = new Map<
  string,
  RootModelHandle | null
>([
  ["insights", INSIGHTS_BOOKMARK_PARAMS_MODEL],
  ["funnels", INSIGHTS_BOOKMARK_PARAMS_MODEL],
  ["retention", INSIGHTS_BOOKMARK_PARAMS_MODEL],
  ["flows", FLOWS_BOOKMARK_PARAMS_MODEL],
  ["user", null],
]);

/**
 * Return the root model for a given `bookmark_type`.
 *
 * Funnels and Retention reuse `InsightsBookmarkParams`; user bookmarks
 * have no canonical schema, so the dispatch returns `null` and
 * `validate_bookmark()` no-ops cleanly. An unknown type also yields
 * `null` — Python's `dict.get()` default.
 *
 * @param bookmarkType - The `CreateBookmarkParams.bookmark_type` value.
 * @returns The root-model handle, or `null` when no canonical schema
 *   exists for that type (including unknown types).
 * @example
 * ```typescript
 * getRootModelForBookmarkType("funnels")?.name; // "InsightsBookmarkParams"
 * getRootModelForBookmarkType("user"); // null
 * ```
 * @see mixpanel_headless._internal.bookmark_schema.get_root_model_for_bookmark_type
 */
export function getRootModelForBookmarkType(
  bookmarkType: string,
): RootModelHandle | null {
  return ROOT_MODELS.get(bookmarkType) ?? null;
}

/**
 * Top-level `UpdateBookmarkParams.params` key → canonical sub-model.
 *
 * Python populates the dict at module bottom; here it is a
 * `ReadonlyMap`. `sorting` is intentionally excluded — callers route it
 * through `validate_sorting_block`, which adds the
 * `S4_UNKNOWN_CHART_TYPE` warning and the chart-type pre-filter on top
 * of the same pydantic mirror.
 *
 * @see mixpanel_headless._internal.bookmark_schema.PARTIAL_UPDATE_SUB_MODELS
 */
export const PARTIAL_UPDATE_SUB_MODELS: ReadonlyMap<string, RootModelHandle> =
  new Map([
    ["sections", SECTIONS_MODEL],
    ["displayOptions", DISPLAY_OPTIONS_MODEL],
  ]);

/**
 * Every model the conformance `validate_with_pydantic` adapter can
 * name, keyed by the Python class name.
 *
 * The Python rig flattens `validate_with_pydantic(model_cls, …)` to
 * `(model: str, value, path_prefix)` over a fixed name→class map; this
 * is the TS mirror of that map, so the conformance binding resolves a
 * name without re-deriving the model set.
 */
export const BOOKMARK_MODEL_HANDLES: ReadonlyMap<string, RootModelHandle> =
  new Map([
    ["InsightsBookmarkSortConfig", modelHandle(INSIGHTS_BOOKMARK_SORT_CONFIG)],
    ["InsightsBookmarkParams", INSIGHTS_BOOKMARK_PARAMS_MODEL],
    ["FlowsBookmarkParams", FLOWS_BOOKMARK_PARAMS_MODEL],
    ["Sections", SECTIONS_MODEL],
    ["DisplayOptions", DISPLAY_OPTIONS_MODEL],
  ]);
