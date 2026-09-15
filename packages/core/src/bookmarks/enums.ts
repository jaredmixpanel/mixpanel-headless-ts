/**
 * The 34 constant tables of `bookmark_enums.py`: every valid value the
 * Mixpanel insights query API accepts for each bookmark field, used by
 * the validation engine to catch invalid values client-side. Python
 * `frozenset[str]` tables become `ReadonlySet<string>` and the dict
 * constant `MAX_CONVERSION_WINDOW` a `ReadonlyMap<string, number>`, so
 * membership tests use `.has()` rather than prototype-unsafe object-key
 * access; member order mirrors the Python source literals for readable
 * diffs. {@link bookmarkEnumTablesSnapshot} is the serialization view
 * the enum lock test diffs against the extracted vector file
 * `conformance-runner/corpus/enums/bookmark_enums.json`. Like its Python
 * twin, this module is not re-exported from the package barrel.
 *
 * @see mixpanel_headless._internal.bookmark_enums
 */

import { compareCodepoints, sortedByCodepoint } from "../compat/codepoint.js";

/**
 * Python source module these tables mirror (locked against the
 * `source_module` field of the extracted vector file).
 */
export const BOOKMARK_ENUMS_SOURCE_MODULE =
  "mixpanel_headless._internal.bookmark_enums";

/**
 * Maximum number of steps allowed in a funnel query; consumed by
 * `validateFunnelArgs` rule F1_MAX_STEPS. Module-private in Python;
 * exported for intra-package use only.
 *
 * @see mixpanel_headless._internal.bookmark_enums._MAX_FUNNEL_STEPS
 * @internal
 */
export const MAX_FUNNEL_STEPS = 100;

/**
 * Maximum number of holding-constant properties allowed; consumed by
 * `validateFunnelArgs` rule F8_MAX_HOLDING_CONSTANT. Module-private in
 * Python; exported for intra-package use only.
 *
 * @see mixpanel_headless._internal.bookmark_enums._MAX_HOLDING_CONSTANT
 * @internal
 */
export const MAX_HOLDING_CONSTANT = 3;

// --- Math / aggregation types ---

/**
 * All valid math/aggregation operators across all contexts (insights,
 * funnels, retention). Mirrors the canonical `MATH_TYPE` union in
 * `analytics/lib/common/mxpnl/report/bookmarks/common/definitions.py`.
 */
export const VALID_MATH_TYPES: ReadonlySet<string> = new Set([
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
  // Per-user-only aggregation operator (canonical PER_USER_AGGREGATIONS
  // includes this; included in the union here)
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
]);

/**
 * Valid math types for insights context (excludes
 * funnel/retention-specific).
 */
export const VALID_MATH_INSIGHTS: ReadonlySet<string> = new Set([
  "total",
  "unique",
  "cumulative_unique",
  "sessions",
  "dau",
  "wau",
  "mau",
  "average",
  "median",
  "min",
  "max",
  "p25",
  "p75",
  "p90",
  "p99",
  "custom_percentile",
  "histogram",
  "unique_values",
  "most_frequent",
  "first_value",
  "multi_attribution",
  "numeric_summary",
]);

/**
 * Valid math types for funnel context: counting/conversion types plus
 * property aggregation types for funnel measure-on-property.
 */
export const VALID_MATH_FUNNELS: ReadonlySet<string> = new Set([
  "general",
  "unique",
  "session",
  "total",
  "conversion_rate",
  "conversion_rate_unique",
  "conversion_rate_total",
  "conversion_rate_session",
  // Property aggregation types (funnel measure on property)
  "average",
  "median",
  "min",
  "max",
  "p25",
  "p75",
  "p90",
  "p99",
  "histogram",
]);

/** Valid math types for retention context. */
export const VALID_MATH_RETENTION: ReadonlySet<string> = new Set([
  "unique",
  "retention_rate",
  "total",
  "average",
]);

/** Math types that require a measurement property to be specified. */
export const MATH_REQUIRING_PROPERTY: ReadonlySet<string> = new Set([
  "average",
  "median",
  "min",
  "max",
  "p25",
  "p75",
  "p90",
  "p99",
  "custom_percentile",
  "percentile",
  "histogram",
  // Advanced
  "unique_values",
  "most_frequent",
  "first_value",
  "multi_attribution",
  "numeric_summary",
]);

/**
 * Math types that optionally accept a property: `"total"` without a
 * property counts events; with a property it sums the property's
 * numeric values.
 */
export const MATH_PROPERTY_OPTIONAL: ReadonlySet<string> = new Set(["total"]);

/** Math types incompatible with per-user aggregation. */
export const MATH_NO_PER_USER: ReadonlySet<string> = new Set([
  "dau",
  "wau",
  "mau",
  "unique",
]);

// --- Per-user aggregation ---

/**
 * Valid per-user aggregation types (maps to `perUserAggregation` in
 * the bookmark measurement block).
 */
export const VALID_PER_USER_AGGREGATIONS: ReadonlySet<string> = new Set([
  "average",
  "max",
  "min",
  "session_replay_id_value",
  "total",
  "unique_values",
]);

// --- Property types ---

/**
 * Valid property data types for filter and group-by clauses.
 * `"undefined"` is retained as a legacy alias for `"unknown"` for
 * back-compat with older bookmarks.
 */
export const VALID_PROPERTY_TYPES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "datetime",
  "boolean",
  "list",
  "object",
  "undefined",
  // Canonical additions (insights/definitions.py PropertyType)
  "dimension", // property is a dimension join key
  "other", // NonProperty
  "unknown",
]);

// --- Time units ---

/**
 * Valid time units for time section aggregation. Mirrors the canonical
 * `TimeUnit` union (base + extended + non-standard + special units).
 */
export const VALID_TIME_UNITS: ReadonlySet<string> = new Set([
  // BaseTimeUnit
  "hour",
  "day",
  "week",
  "month",
  // ExtendedTimeUnit
  "second",
  "minute",
  "quarter",
  "year",
  // NonStandardTimeUnit
  "session",
  // SpecialTimeUnit (canonical TimeUnit union includes these)
  "hour_of_day",
  "day_of_week",
]);

/**
 * Valid time units for query contexts (includes special grouping
 * units).
 */
export const VALID_QUERY_TIME_UNITS: ReadonlySet<string> = new Set([
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "year",
  "quarter",
  "session",
  "day_of_week",
  "hour_of_day",
]);

// --- Resource types ---

/**
 * Valid resource types for filters, groups, and show clauses,
 * including legacy singular aliases (`"event"`, `"user"`, `"cohort"`)
 * the server still accepts.
 */
export const VALID_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  "events",
  "people",
  "cohorts",
  "other",
  // Legacy aliases (still accepted by server)
  "event",
  "user",
  "cohort",
  // Canonical additions (insights/definitions.py InsightsResourceType)
  "all",
  "formulas",
]);

// --- Metric / behavior types ---

/**
 * Valid behavior/metric types in show clause behavior blocks,
 * including `"addiction"` and `"metric"` as legacy values that may
 * appear in older saved bookmarks.
 */
export const VALID_METRIC_TYPES: ReadonlySet<string> = new Set([
  "event",
  "simple",
  "custom-event",
  "cohort",
  "people",
  "funnel",
  "retention",
  "formula",
  // Canonical additions (insights/definitions.py MetricType)
  "retention-frequency",
  "saved-metric",
  "verified",
  // Legacy values still observed in older bookmarks (kept for back-compat)
  "addiction",
  "metric",
]);

// --- Chart types ---

/**
 * Valid chart types for `displayOptions.chartType`, plus
 * `"frequency-curve"` retained as a legacy local addition for
 * back-compat.
 */
export const VALID_CHART_TYPES: ReadonlySet<string> = new Set([
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
  // Legacy dashboards-only metric (still saved on the backend)
  "metric",
  // Flows chart types
  "sankey",
  "flows", // alias for sankey
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
  "line-retention", // deprecated retention curve
  "retention-trend",
  "retention-trend-metric",
  "retention-table", // AKA retention curve
  "retention-curve",
  "frequency",
  // Impact chart types
  "impact-adoption",
  "impact-trends",
  "impact-propensity",
  // Legacy local additions (kept for back-compat with older bookmarks)
  "frequency-curve",
]);

// --- Filter operators ---

/**
 * Valid filter operators from the canonical operator expression
 * schema. Includes both legacy `DateRangeType` operators (`"on"`,
 * `"in the last"`, …) and canonical `InsightsDateRangeType` operators
 * (`"was on"`, `"was in the"`, …) — both are accepted by the Mixpanel
 * API.
 */
export const VALID_FILTER_OPERATORS: ReadonlySet<string> = new Set([
  // String operators
  "contains",
  "does not contain",
  "equals",
  "does not equal",
  "is equal to",
  "starts with",
  "ends with",
  // Existence operators
  "is set",
  "is not set",
  // Numeric comparison operators
  "is at least",
  "is at most",
  "is between",
  "between",
  "not between",
  "is greater than",
  "is less than",
  "is greater than or equal to",
  "is less than or equal to",
  // Boolean operators
  "true",
  "false",
  // Date operators (legacy segfilter format — DateRangeType)
  "on",
  "not on",
  "in the last",
  "not in the last",
  "before the last",
  "before",
  "in the next",
  "since",
  // Date operators (canonical bookmark sections — InsightsDateRangeType)
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
]);

// --- Filters determiner ---

/**
 * Valid values for `filtersDeterminer` (AND/OR logic for multiple
 * filters).
 */
export const VALID_FILTERS_DETERMINER: ReadonlySet<string> = new Set([
  "any",
  "all",
]);

// --- Analysis types ---

/** Valid analysis types for `displayOptions`. */
export const VALID_ANALYSIS_TYPES: ReadonlySet<string> = new Set([
  "linear",
  "logarithmic",
  "rolling",
  "cumulative",
]);

// --- Date range types ---

/** Valid date range types for time section clauses. */
const VALID_DATE_RANGE_TYPES: ReadonlySet<string> = new Set([
  "in the last",
  "between",
  "since",
  "on",
  "relative_after",
]);

// --- Funnel-specific constants ---

/**
 * Valid funnel step ordering modes: `"loose"` requires steps in order
 * but allows other events between; `"any"` allows steps in any order.
 */
export const VALID_FUNNEL_ORDER: ReadonlySet<string> = new Set([
  "loose",
  "any",
]);

/** Valid time units for the funnel conversion window. */
export const VALID_CONVERSION_WINDOW_UNITS: ReadonlySet<string> = new Set([
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "session",
]);

/**
 * Maximum conversion window duration per unit (all values correspond
 * to approximately 366 days). Python `dict` lookup table →
 * `ReadonlyMap`; sourced from
 * `analytics/api/version_2_0/arb_funnels/validate.py` `_MAX_LENGTHS`.
 */
export const MAX_CONVERSION_WINDOW: ReadonlyMap<string, number> = new Map([
  ["month", 12],
  ["session", 12],
  ["week", 52],
  ["day", 367],
  ["hour", 8808],
  ["minute", 528480],
  ["second", 31708800],
]);

// --- Retention-specific constants ---

/** Valid time units for retention period grouping. */
export const VALID_RETENTION_UNITS: ReadonlySet<string> = new Set([
  "day",
  "week",
  "month",
]);

/**
 * Valid retention alignment modes: `"birth"` aligns each user to their
 * first qualifying event; `"interval_start"` aligns to the start of
 * each calendar period.
 */
export const VALID_RETENTION_ALIGNMENT: ReadonlySet<string> = new Set([
  "birth",
  "interval_start",
]);

// --- Flows-specific constants ---

/** Valid counting methods for flows analysis. */
export const VALID_FLOWS_COUNT_TYPES: ReadonlySet<string> = new Set([
  "unique",
  "total",
  "session",
]);

/** Valid chart types for flows visualization. */
export const VALID_FLOWS_CHART_TYPES: ReadonlySet<string> = new Set([
  "sankey",
  "top-paths",
  "tree",
]);

/**
 * Valid user-facing mode values for flow queries. Maps to chart types
 * internally: `"sankey"` → `"sankey"`, `"paths"` → `"top-paths"` (the
 * API uses `"top-paths"`).
 */
export const VALID_FLOWS_MODES: ReadonlySet<string> = new Set([
  "sankey",
  "paths",
  "tree",
]);

/**
 * Valid time units for the flows conversion window. Includes
 * `"session"` for session-based counting (requires
 * `count_type="session"` and `conversion_window=1`).
 */
export const VALID_FLOWS_CONVERSION_WINDOW_UNITS: ReadonlySet<string> = new Set(
  ["day", "week", "month", "session"],
);

// --- Advanced query mode constants ---

/** Valid funnel reentry modes for `behavior.funnelReentryMode`. */
export const VALID_FUNNEL_REENTRY_MODES: ReadonlySet<string> = new Set([
  "default",
  "basic",
  "aggressive",
  "optimized",
]);

/**
 * Valid retention unbounded modes for
 * `behavior.retentionUnboundedMode`.
 */
export const VALID_RETENTION_UNBOUNDED_MODES: ReadonlySet<string> = new Set([
  "none",
  "carry_back",
  "carry_forward",
  "consecutive_forward",
]);

/** Valid segment method values for `measurement.segmentMethod`. */
const VALID_SEGMENT_METHODS: ReadonlySet<string> = new Set(["all", "first"]);

/**
 * Valid time comparison type values for
 * `displayOptions.timeComparison`.
 */
const VALID_TIME_COMPARISON_TYPES: ReadonlySet<string> = new Set([
  "relative",
  "absolute-start",
  "absolute-end",
]);

/**
 * Valid time comparison unit values for relative time comparisons.
 */
const VALID_TIME_COMPARISON_UNITS: ReadonlySet<string> = new Set([
  "day",
  "week",
  "month",
  "quarter",
  "year",
]);

/**
 * Valid cohort aggregation operators for behavioral cohort conditions.
 */
const VALID_COHORT_AGGREGATION_OPERATORS: ReadonlySet<string> = new Set([
  "total",
  "unique",
  "average",
  "min",
  "max",
  "median",
]);

/**
 * Valid operators for frequency-based filters. `"is between"` is
 * excluded — `FrequencyFilter.value` is a single scalar and cannot
 * represent the two-bound range that "between" requires.
 */
export const VALID_FREQUENCY_FILTER_OPERATORS: ReadonlySet<string> = new Set([
  "is at least",
  "is at most",
  "is greater than",
  "is less than",
  "is equal to",
]);

// --- Lock-test registry + serialization view ---

/**
 * Registry of all 34 ported constant tables, keyed by their exact
 * Python constant names; consumed by the serialization view below and
 * by the enum lock test's key-set equality check.
 */
export const BOOKMARK_ENUM_TABLES: ReadonlyMap<
  string,
  ReadonlySet<string> | ReadonlyMap<string, number>
> = new Map<string, ReadonlySet<string> | ReadonlyMap<string, number>>([
  ["VALID_MATH_TYPES", VALID_MATH_TYPES],
  ["VALID_MATH_INSIGHTS", VALID_MATH_INSIGHTS],
  ["VALID_MATH_FUNNELS", VALID_MATH_FUNNELS],
  ["VALID_MATH_RETENTION", VALID_MATH_RETENTION],
  ["MATH_REQUIRING_PROPERTY", MATH_REQUIRING_PROPERTY],
  ["MATH_PROPERTY_OPTIONAL", MATH_PROPERTY_OPTIONAL],
  ["MATH_NO_PER_USER", MATH_NO_PER_USER],
  ["VALID_PER_USER_AGGREGATIONS", VALID_PER_USER_AGGREGATIONS],
  ["VALID_PROPERTY_TYPES", VALID_PROPERTY_TYPES],
  ["VALID_TIME_UNITS", VALID_TIME_UNITS],
  ["VALID_QUERY_TIME_UNITS", VALID_QUERY_TIME_UNITS],
  ["VALID_RESOURCE_TYPES", VALID_RESOURCE_TYPES],
  ["VALID_METRIC_TYPES", VALID_METRIC_TYPES],
  ["VALID_CHART_TYPES", VALID_CHART_TYPES],
  ["VALID_FILTER_OPERATORS", VALID_FILTER_OPERATORS],
  ["VALID_FILTERS_DETERMINER", VALID_FILTERS_DETERMINER],
  ["VALID_ANALYSIS_TYPES", VALID_ANALYSIS_TYPES],
  ["VALID_DATE_RANGE_TYPES", VALID_DATE_RANGE_TYPES],
  ["VALID_FUNNEL_ORDER", VALID_FUNNEL_ORDER],
  ["VALID_CONVERSION_WINDOW_UNITS", VALID_CONVERSION_WINDOW_UNITS],
  ["MAX_CONVERSION_WINDOW", MAX_CONVERSION_WINDOW],
  ["VALID_RETENTION_UNITS", VALID_RETENTION_UNITS],
  ["VALID_RETENTION_ALIGNMENT", VALID_RETENTION_ALIGNMENT],
  ["VALID_FLOWS_COUNT_TYPES", VALID_FLOWS_COUNT_TYPES],
  ["VALID_FLOWS_CHART_TYPES", VALID_FLOWS_CHART_TYPES],
  ["VALID_FLOWS_MODES", VALID_FLOWS_MODES],
  ["VALID_FLOWS_CONVERSION_WINDOW_UNITS", VALID_FLOWS_CONVERSION_WINDOW_UNITS],
  ["VALID_FUNNEL_REENTRY_MODES", VALID_FUNNEL_REENTRY_MODES],
  ["VALID_RETENTION_UNBOUNDED_MODES", VALID_RETENTION_UNBOUNDED_MODES],
  ["VALID_SEGMENT_METHODS", VALID_SEGMENT_METHODS],
  ["VALID_TIME_COMPARISON_TYPES", VALID_TIME_COMPARISON_TYPES],
  ["VALID_TIME_COMPARISON_UNITS", VALID_TIME_COMPARISON_UNITS],
  ["VALID_COHORT_AGGREGATION_OPERATORS", VALID_COHORT_AGGREGATION_OPERATORS],
  ["VALID_FREQUENCY_FILTER_OPERATORS", VALID_FREQUENCY_FILTER_OPERATORS],
]);

/**
 * Serialization view for the enum lock test: each `ReadonlySet` renders
 * as a sorted string array and each `ReadonlyMap` as a sorted-key plain
 * object — the same normalization the Python extractor applied when
 * writing `conformance/vectors/enums/bookmark_enums.json` (all values
 * are ASCII, so JS code-unit sort and Python codepoint sort agree).
 *
 * @returns Constant name → normalized table, for canonical diffing
 *   against the extracted vector file.
 * @example
 * ```typescript
 * bookmarkEnumTablesSnapshot()["VALID_FUNNEL_ORDER"]; // ["any", "loose"]
 * bookmarkEnumTablesSnapshot()["MAX_CONVERSION_WINDOW"]; // { day: 366, hour: 8784, … }
 * ```
 */
export function bookmarkEnumTablesSnapshot(): Readonly<
  Record<string, readonly string[] | Readonly<Record<string, number>>>
> {
  const snapshot: Record<
    string,
    readonly string[] | Readonly<Record<string, number>>
  > = {};
  for (const [name, table] of BOOKMARK_ENUM_TABLES) {
    if (table instanceof Set) {
      snapshot[name] = sortedByCodepoint([...table]);
    } else {
      const entries = [...table.entries()].sort(([a], [b]) =>
        compareCodepoints(a, b),
      );
      snapshot[name] = Object.fromEntries(entries) as Readonly<
        Record<string, number>
      >;
    }
  }
  return snapshot;
}
