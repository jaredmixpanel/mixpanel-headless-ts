/**
 * The 37 distinct public Python `Literal` aliases as string-literal
 * union types (phase2-design C2, rulebook R4.3), each with a sibling
 * runtime tuple for membership checks.
 *
 * Sources (Python, branch ts-port/phase2-contract-support):
 * - `src/mixpanel_headless/_literal_types.py` — 32 aliases
 * - `src/mixpanel_headless/types.py` module level — `BookmarkType`,
 *   `SavedReportType`, `EntityType` (`BookmarkTypeLiteral` is NOT in
 *   `__all__` and gets no TS surface)
 * - `src/mixpanel_headless/_internal/auth/account.py` (via
 *   `auth_types`) — `Region`, `AccountType`; this module is their
 *   canonical TS definition and `auth/account.ts` (P2-4) re-exports
 *   them rather than redeclaring
 *
 * Hand-written source, machine-verified sync: the C8(d) lock test
 * (`conformance-runner/test/literal-alias-lock.test.ts`) asserts
 * set-equality per alias against the generated contract artifact
 * `conformance-runner/corpus/contract/literal-aliases.json`. Member
 * order below mirrors Python declaration order (contractual for
 * nothing, kept stable so diffs are readable).
 *
 * Every alias follows the mandated pattern: the `satisfies` clause
 * rejects tuple members outside the union, and the
 * `LiteralAliasCoverageProof` type at the bottom of this file makes a
 * union member missing from its tuple a compile error.
 */

// =============================================================================
// Time units (_literal_types.py)
// =============================================================================

/**
 * Time unit for segmentation, retention, event_counts, property_counts,
 * and frequency queries.
 */
export type TimeUnit = "day" | "week" | "month";

/** Runtime membership tuple for {@link TimeUnit}. */
export const TIME_UNIT_VALUES = [
  "day",
  "week",
  "month",
] as const satisfies readonly TimeUnit[];

/**
 * Time unit for numeric aggregations (`segmentation_numeric`,
 * `segmentation_sum`, `segmentation_average`).
 */
export type HourDayUnit = "hour" | "day";

/** Runtime membership tuple for {@link HourDayUnit}. */
export const HOUR_DAY_UNIT_VALUES = [
  "hour",
  "day",
] as const satisfies readonly HourDayUnit[];

/**
 * Time unit for the bookmark query API (`query`, `build_params`,
 * `build_time_section`).
 */
export type QueryTimeUnit = "hour" | "day" | "week" | "month" | "quarter";

/** Runtime membership tuple for {@link QueryTimeUnit}. */
export const QUERY_TIME_UNIT_VALUES = [
  "hour",
  "day",
  "week",
  "month",
  "quarter",
] as const satisfies readonly QueryTimeUnit[];

// =============================================================================
// Count / aggregation types (_literal_types.py)
// =============================================================================

/** Count/aggregation method for legacy segmentation-style queries. */
export type CountType = "general" | "unique" | "average";

/** Runtime membership tuple for {@link CountType}. */
export const COUNT_TYPE_VALUES = [
  "general",
  "unique",
  "average",
] as const satisfies readonly CountType[];

/** Counting method for flows analysis. */
export type FlowCountType = "unique" | "total" | "session";

/** Runtime membership tuple for {@link FlowCountType}. */
export const FLOW_COUNT_TYPE_VALUES = [
  "unique",
  "total",
  "session",
] as const satisfies readonly FlowCountType[];

// =============================================================================
// Insights math types (_literal_types.py)
// =============================================================================

/**
 * Aggregation function for query metrics.
 *
 * Notes carried from the Python docstring: Mixpanel has no `"sum"` math
 * type — use `"total"` with a property to sum its numeric values.
 * `"dau"`/`"wau"`/`"mau"`/`"unique"` are incompatible with per-user
 * aggregation. `"percentile"` maps to `custom_percentile` in bookmark
 * JSON and requires a percentile value on the metric.
 */
export type MathType =
  | "total"
  | "unique"
  | "dau"
  | "wau"
  | "mau"
  | "average"
  | "median"
  | "min"
  | "max"
  | "p25"
  | "p75"
  | "p90"
  | "p99"
  | "percentile"
  | "histogram"
  | "cumulative_unique"
  | "sessions"
  | "unique_values"
  | "most_frequent"
  | "first_value"
  | "multi_attribution"
  | "numeric_summary";

/** Runtime membership tuple for {@link MathType}. */
export const MATH_TYPE_VALUES = [
  "total",
  "unique",
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
  "percentile",
  "histogram",
  "cumulative_unique",
  "sessions",
  "unique_values",
  "most_frequent",
  "first_value",
  "multi_attribution",
  "numeric_summary",
] as const satisfies readonly MathType[];

/**
 * Per-user pre-aggregation type. Requires a math property; the query
 * first computes the per-user aggregate, then applies the top-level
 * math across users. Maps to `perUserAggregation` in the bookmark
 * measurement block.
 */
export type PerUserAggregation =
  "unique_values" | "total" | "average" | "min" | "max";

/** Runtime membership tuple for {@link PerUserAggregation}. */
export const PER_USER_AGGREGATION_VALUES = [
  "unique_values",
  "total",
  "average",
  "min",
  "max",
] as const satisfies readonly PerUserAggregation[];

// =============================================================================
// Funnel types (_literal_types.py)
// =============================================================================

/**
 * Aggregation function for funnel query metrics. These 14 values are
 * the public-facing funnel math types; the Mixpanel API also accepts
 * internal aliases (`"general"`, `"session"`, `"conversion_rate"`) that
 * are not exposed in the public API.
 */
export type FunnelMathType =
  | "conversion_rate_unique"
  | "conversion_rate_total"
  | "conversion_rate_session"
  | "unique"
  | "total"
  | "average"
  | "median"
  | "min"
  | "max"
  | "p25"
  | "p75"
  | "p90"
  | "p99"
  | "histogram";

/** Runtime membership tuple for {@link FunnelMathType}. */
export const FUNNEL_MATH_TYPE_VALUES = [
  "conversion_rate_unique",
  "conversion_rate_total",
  "conversion_rate_session",
  "unique",
  "total",
  "average",
  "median",
  "min",
  "max",
  "p25",
  "p75",
  "p90",
  "p99",
  "histogram",
] as const satisfies readonly FunnelMathType[];

/**
 * Time unit for the funnel conversion window (per-unit maximums live in
 * the bookmark-enum table `MAX_CONVERSION_WINDOW`).
 */
export type ConversionWindowUnit =
  "second" | "minute" | "hour" | "day" | "week" | "month" | "session";

/** Runtime membership tuple for {@link ConversionWindowUnit}. */
export const CONVERSION_WINDOW_UNIT_VALUES = [
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "session",
] as const satisfies readonly ConversionWindowUnit[];

/**
 * Funnel step ordering mode: `"loose"` (in order, other events allowed
 * between; default) or `"any"` (any order).
 */
export type FunnelOrder = "loose" | "any";

/** Runtime membership tuple for {@link FunnelOrder}. */
export const FUNNEL_ORDER_VALUES = [
  "loose",
  "any",
] as const satisfies readonly FunnelOrder[];

/** Display mode for funnel query results. */
export type FunnelMode = "steps" | "trends" | "table";

/** Runtime membership tuple for {@link FunnelMode}. */
export const FUNNEL_MODE_VALUES = [
  "steps",
  "trends",
  "table",
] as const satisfies readonly FunnelMode[];

// =============================================================================
// Retention types (_literal_types.py)
// =============================================================================

/**
 * Retention alignment mode: `"birth"` aligns each cohort to its born
 * date (default); `"interval_start"` aligns all cohorts to the same
 * start date.
 */
export type RetentionAlignment = "birth" | "interval_start";

/** Runtime membership tuple for {@link RetentionAlignment}. */
export const RETENTION_ALIGNMENT_VALUES = [
  "birth",
  "interval_start",
] as const satisfies readonly RetentionAlignment[];

/** Display mode for retention query results. */
export type RetentionMode = "curve" | "trends" | "table";

/** Runtime membership tuple for {@link RetentionMode}. */
export const RETENTION_MODE_VALUES = [
  "curve",
  "trends",
  "table",
] as const satisfies readonly RetentionMode[];

/**
 * Aggregation function for retention query metrics. Maps directly to
 * the `measurement.math` field in bookmark JSON.
 */
export type RetentionMathType =
  "retention_rate" | "unique" | "total" | "average";

/** Runtime membership tuple for {@link RetentionMathType}. */
export const RETENTION_MATH_TYPE_VALUES = [
  "retention_rate",
  "unique",
  "total",
  "average",
] as const satisfies readonly RetentionMathType[];

// =============================================================================
// Advanced query types (_literal_types.py)
// =============================================================================

/**
 * Method for counting qualifying events in segmentation: `"all"`
 * (default) or `"first"` (only the first qualifying event per user).
 */
export type SegmentMethod = "all" | "first";

/** Runtime membership tuple for {@link SegmentMethod}. */
export const SEGMENT_METHOD_VALUES = [
  "all",
  "first",
] as const satisfies readonly SegmentMethod[];

/** Re-entry mode for funnel queries (`behavior.funnelReentryMode`). */
export type FunnelReentryMode =
  "default" | "basic" | "aggressive" | "optimized";

/** Runtime membership tuple for {@link FunnelReentryMode}. */
export const FUNNEL_REENTRY_MODE_VALUES = [
  "default",
  "basic",
  "aggressive",
  "optimized",
] as const satisfies readonly FunnelReentryMode[];

/**
 * Unbounded retention mode for retention queries
 * (`behavior.retentionUnboundedMode`).
 */
export type RetentionUnboundedMode =
  "none" | "carry_back" | "carry_forward" | "consecutive_forward";

/** Runtime membership tuple for {@link RetentionUnboundedMode}. */
export const RETENTION_UNBOUNDED_MODE_VALUES = [
  "none",
  "carry_back",
  "carry_forward",
  "consecutive_forward",
] as const satisfies readonly RetentionUnboundedMode[];

/**
 * Type of time comparison for query results
 * (`displayOptions.timeComparison`).
 */
export type TimeComparisonType = "relative" | "absolute-start" | "absolute-end";

/** Runtime membership tuple for {@link TimeComparisonType}. */
export const TIME_COMPARISON_TYPE_VALUES = [
  "relative",
  "absolute-start",
  "absolute-end",
] as const satisfies readonly TimeComparisonType[];

/** Time unit for period-over-period comparisons. */
export type TimeComparisonUnit = "day" | "week" | "month" | "quarter" | "year";

/** Runtime membership tuple for {@link TimeComparisonUnit}. */
export const TIME_COMPARISON_UNIT_VALUES = [
  "day",
  "week",
  "month",
  "quarter",
  "year",
] as const satisfies readonly TimeComparisonUnit[];

/** Aggregation type for cohort behavior criteria. */
export type CohortAggregationType =
  "total" | "unique" | "average" | "min" | "max" | "median";

/** Runtime membership tuple for {@link CohortAggregationType}. */
export const COHORT_AGGREGATION_TYPE_VALUES = [
  "total",
  "unique",
  "average",
  "min",
  "max",
  "median",
] as const satisfies readonly CohortAggregationType[];

/**
 * Session anchor event type for flow queries: `"start"`
 * (`$session_start`) or `"end"` (`$session_end`).
 */
export type FlowSessionEvent = "start" | "end";

/** Runtime membership tuple for {@link FlowSessionEvent}. */
export const FLOW_SESSION_EVENT_VALUES = [
  "start",
  "end",
] as const satisfies readonly FlowSessionEvent[];

/**
 * Comparison operator for frequency filters. `"is between"` is
 * excluded because `FrequencyFilter.value` is a single scalar and
 * cannot represent a two-bound range.
 */
export type FrequencyFilterOperator =
  | "is at least"
  | "is at most"
  | "is greater than"
  | "is less than"
  | "is equal to";

/** Runtime membership tuple for {@link FrequencyFilterOperator}. */
export const FREQUENCY_FILTER_OPERATOR_VALUES = [
  "is at least",
  "is at most",
  "is greater than",
  "is less than",
  "is equal to",
] as const satisfies readonly FrequencyFilterOperator[];

// =============================================================================
// Flow types (_literal_types.py)
// =============================================================================

/** Chart type for flows visualization. */
export type FlowChartType = "sankey" | "paths" | "tree";

/** Runtime membership tuple for {@link FlowChartType}. */
export const FLOW_CHART_TYPE_VALUES = [
  "sankey",
  "paths",
  "tree",
] as const satisfies readonly FlowChartType[];

/**
 * Time unit for the flow conversion window. Subset of
 * {@link ConversionWindowUnit} — flows do not support second, minute,
 * or hour granularity.
 */
export type FlowConversionWindowUnit = "day" | "week" | "month" | "session";

/** Runtime membership tuple for {@link FlowConversionWindowUnit}. */
export const FLOW_CONVERSION_WINDOW_UNIT_VALUES = [
  "day",
  "week",
  "month",
  "session",
] as const satisfies readonly FlowConversionWindowUnit[];

/** Node type in a flow tree response. */
export type FlowNodeType =
  "ANCHOR" | "NORMAL" | "DROPOFF" | "PRUNED" | "FORWARD" | "REVERSE";

/** Runtime membership tuple for {@link FlowNodeType}. */
export const FLOW_NODE_TYPE_VALUES = [
  "ANCHOR",
  "NORMAL",
  "DROPOFF",
  "PRUNED",
  "FORWARD",
  "REVERSE",
] as const satisfies readonly FlowNodeType[];

/** Anchor type in a flow tree response. */
export type FlowAnchorType = "NORMAL" | "RELATIVE_REVERSE" | "RELATIVE_FORWARD";

/** Runtime membership tuple for {@link FlowAnchorType}. */
export const FLOW_ANCHOR_TYPE_VALUES = [
  "NORMAL",
  "RELATIVE_REVERSE",
  "RELATIVE_FORWARD",
] as const satisfies readonly FlowAnchorType[];

// =============================================================================
// Insights display mode (_literal_types.py)
// =============================================================================

/** Display mode for insights query results. */
export type InsightsMode = "timeseries" | "total" | "table";

/** Runtime membership tuple for {@link InsightsMode}. */
export const INSIGHTS_MODE_VALUES = [
  "timeseries",
  "total",
  "table",
] as const satisfies readonly InsightsMode[];

// =============================================================================
// Filter types (_literal_types.py)
// =============================================================================

/**
 * Property data type for filter conditions. Includes `"datetime"` and
 * `"list"` for API compatibility and `"object"` for
 * `Filter.list_contains` sub-property filtering.
 */
export type FilterPropertyType =
  "string" | "number" | "boolean" | "datetime" | "list" | "object";

/** Runtime membership tuple for {@link FilterPropertyType}. */
export const FILTER_PROPERTY_TYPE_VALUES = [
  "string",
  "number",
  "boolean",
  "datetime",
  "list",
  "object",
] as const satisfies readonly FilterPropertyType[];

/**
 * Output type for custom property definitions. Unlike
 * {@link FilterPropertyType}, excludes `"list"` (not valid for custom
 * property output types); also reused by `SubPropertyInfo` and
 * `GroupBy.list_item`.
 */
export type CustomPropertyType = "string" | "number" | "boolean" | "datetime";

/** Runtime membership tuple for {@link CustomPropertyType}. */
export const CUSTOM_PROPERTY_TYPE_VALUES = [
  "string",
  "number",
  "boolean",
  "datetime",
] as const satisfies readonly CustomPropertyType[];

/**
 * All recognized values of `Filter._operator`. Centralized so
 * additions/removals stay in lockstep with the bookmark wire format.
 */
export type FilterOperator =
  | "contains"
  | "does not contain"
  | "does not equal"
  | "ends with"
  | "equals"
  | "false"
  | "is at least"
  | "is at most"
  | "is between"
  | "is greater than"
  | "is less than"
  | "is not set"
  | "is set"
  | "list_contains"
  | "not between"
  | "starts with"
  | "true"
  | "was before"
  | "was between"
  | "was in the"
  | "was in the next"
  | "was not between"
  | "was not in the"
  | "was not on"
  | "was on"
  | "was since";

/** Runtime membership tuple for {@link FilterOperator}. */
export const FILTER_OPERATOR_VALUES = [
  "contains",
  "does not contain",
  "does not equal",
  "ends with",
  "equals",
  "false",
  "is at least",
  "is at most",
  "is between",
  "is greater than",
  "is less than",
  "is not set",
  "is set",
  "list_contains",
  "not between",
  "starts with",
  "true",
  "was before",
  "was between",
  "was in the",
  "was in the next",
  "was not between",
  "was not in the",
  "was not on",
  "was on",
  "was since",
] as const satisfies readonly FilterOperator[];

/**
 * Time unit for relative date filters (`Filter.in_the_last` /
 * `Filter.not_in_the_last`). Maps to `filterDateUnit` in bookmark JSON.
 */
export type FilterDateUnit = "hour" | "day" | "week" | "month";

/** Runtime membership tuple for {@link FilterDateUnit}. */
export const FILTER_DATE_UNIT_VALUES = [
  "hour",
  "day",
  "week",
  "month",
] as const satisfies readonly FilterDateUnit[];

/**
 * How multiple filters combine: `"all"` (AND logic, default) or
 * `"any"` (OR logic).
 */
export type FiltersCombinator = "all" | "any";

/** Runtime membership tuple for {@link FiltersCombinator}. */
export const FILTERS_COMBINATOR_VALUES = [
  "all",
  "any",
] as const satisfies readonly FiltersCombinator[];

// =============================================================================
// Module-level aliases from types.py
// =============================================================================

/**
 * Bookmark type values from the Mixpanel Bookmarks API. Per the C2
 * source-kind-wins ruling (phase2-design Discrepancy Log #3) this is a
 * literal union, not a TS enum — the Python source defines it as a
 * `Literal` alias.
 */
export type BookmarkType =
  "insights" | "funnels" | "retention" | "flows" | "launch-analysis";

/** Runtime membership tuple for {@link BookmarkType}. */
export const BOOKMARK_TYPE_VALUES = [
  "insights",
  "funnels",
  "retention",
  "flows",
  "launch-analysis",
] as const satisfies readonly BookmarkType[];

/**
 * Report type detected from saved report query results (derived from
 * the headers array in the API response).
 */
export type SavedReportType = "insights" | "retention" | "funnel" | "flows";

/** Runtime membership tuple for {@link SavedReportType}. */
export const SAVED_REPORT_TYPE_VALUES = [
  "insights",
  "retention",
  "funnel",
  "flows",
] as const satisfies readonly SavedReportType[];

/**
 * Lexicon entity type accepted as an input parameter. The Mixpanel API
 * may return additional entity types in responses, which are accepted
 * but not supported as input filters.
 */
export type EntityType = "event" | "profile";

/** Runtime membership tuple for {@link EntityType}. */
export const ENTITY_TYPE_VALUES = [
  "event",
  "profile",
] as const satisfies readonly EntityType[];

// =============================================================================
// Auth aliases from _internal/auth/account.py (public via auth_types)
// =============================================================================

/** Mixpanel data-residency region. */
export type Region = "us" | "eu" | "in";

/** Runtime membership tuple for {@link Region}. */
export const REGION_VALUES = [
  "us",
  "eu",
  "in",
] as const satisfies readonly Region[];

/** Discriminant values of the `Account` union (C4). */
export type AccountType = "service_account" | "oauth_browser" | "oauth_token";

/** Runtime membership tuple for {@link AccountType}. */
export const ACCOUNT_TYPE_VALUES = [
  "service_account",
  "oauth_browser",
  "oauth_token",
] as const satisfies readonly AccountType[];

// =============================================================================
// Lock-test registry + compile-time coverage proof
// =============================================================================

/**
 * Serialization view of every literal alias for the C8(d) lock test:
 * alias name → its runtime membership tuple. `ReadonlyMap` per R4.8
 * (name-keyed lookup table). Keyed on the 274-distinct-name surface —
 * the 10 `__all__` duplicate strings (Discrepancy Log #9) key once.
 *
 * @internal
 */
export const LITERAL_ALIAS_VALUES: ReadonlyMap<string, readonly string[]> =
  new Map<string, readonly string[]>([
    ["TimeUnit", TIME_UNIT_VALUES],
    ["HourDayUnit", HOUR_DAY_UNIT_VALUES],
    ["QueryTimeUnit", QUERY_TIME_UNIT_VALUES],
    ["CountType", COUNT_TYPE_VALUES],
    ["FlowCountType", FLOW_COUNT_TYPE_VALUES],
    ["MathType", MATH_TYPE_VALUES],
    ["PerUserAggregation", PER_USER_AGGREGATION_VALUES],
    ["FunnelMathType", FUNNEL_MATH_TYPE_VALUES],
    ["ConversionWindowUnit", CONVERSION_WINDOW_UNIT_VALUES],
    ["FunnelOrder", FUNNEL_ORDER_VALUES],
    ["FunnelMode", FUNNEL_MODE_VALUES],
    ["RetentionAlignment", RETENTION_ALIGNMENT_VALUES],
    ["RetentionMode", RETENTION_MODE_VALUES],
    ["RetentionMathType", RETENTION_MATH_TYPE_VALUES],
    ["SegmentMethod", SEGMENT_METHOD_VALUES],
    ["FunnelReentryMode", FUNNEL_REENTRY_MODE_VALUES],
    ["RetentionUnboundedMode", RETENTION_UNBOUNDED_MODE_VALUES],
    ["TimeComparisonType", TIME_COMPARISON_TYPE_VALUES],
    ["TimeComparisonUnit", TIME_COMPARISON_UNIT_VALUES],
    ["CohortAggregationType", COHORT_AGGREGATION_TYPE_VALUES],
    ["FlowSessionEvent", FLOW_SESSION_EVENT_VALUES],
    ["FrequencyFilterOperator", FREQUENCY_FILTER_OPERATOR_VALUES],
    ["FlowChartType", FLOW_CHART_TYPE_VALUES],
    ["FlowConversionWindowUnit", FLOW_CONVERSION_WINDOW_UNIT_VALUES],
    ["FlowNodeType", FLOW_NODE_TYPE_VALUES],
    ["FlowAnchorType", FLOW_ANCHOR_TYPE_VALUES],
    ["InsightsMode", INSIGHTS_MODE_VALUES],
    ["FilterPropertyType", FILTER_PROPERTY_TYPE_VALUES],
    ["CustomPropertyType", CUSTOM_PROPERTY_TYPE_VALUES],
    ["FilterOperator", FILTER_OPERATOR_VALUES],
    ["FilterDateUnit", FILTER_DATE_UNIT_VALUES],
    ["FiltersCombinator", FILTERS_COMBINATOR_VALUES],
    ["BookmarkType", BOOKMARK_TYPE_VALUES],
    ["SavedReportType", SAVED_REPORT_TYPE_VALUES],
    ["EntityType", ENTITY_TYPE_VALUES],
    ["Region", REGION_VALUES],
    ["AccountType", ACCOUNT_TYPE_VALUES],
  ]);

/**
 * Accepts only a tuple whose every position is `never`; used by
 * {@link LiteralAliasCoverageProof} to turn union⇄tuple drift into a
 * compile error at the exact offending position.
 */
type AssertAllNever<T extends readonly never[]> = T;

/**
 * Compile-time coverage proof (phase2-design C2): for every alias,
 * `Exclude<Union, typeof *_VALUES[number]>` must be `never`. A union
 * member missing from its runtime tuple fails the `AssertAllNever`
 * constraint here (extra/misspelled tuple members are already rejected
 * by each tuple's `satisfies` clause).
 *
 * @internal
 */
export type LiteralAliasCoverageProof = AssertAllNever<
  [
    Exclude<TimeUnit, (typeof TIME_UNIT_VALUES)[number]>,
    Exclude<HourDayUnit, (typeof HOUR_DAY_UNIT_VALUES)[number]>,
    Exclude<QueryTimeUnit, (typeof QUERY_TIME_UNIT_VALUES)[number]>,
    Exclude<CountType, (typeof COUNT_TYPE_VALUES)[number]>,
    Exclude<FlowCountType, (typeof FLOW_COUNT_TYPE_VALUES)[number]>,
    Exclude<MathType, (typeof MATH_TYPE_VALUES)[number]>,
    Exclude<PerUserAggregation, (typeof PER_USER_AGGREGATION_VALUES)[number]>,
    Exclude<FunnelMathType, (typeof FUNNEL_MATH_TYPE_VALUES)[number]>,
    Exclude<
      ConversionWindowUnit,
      (typeof CONVERSION_WINDOW_UNIT_VALUES)[number]
    >,
    Exclude<FunnelOrder, (typeof FUNNEL_ORDER_VALUES)[number]>,
    Exclude<FunnelMode, (typeof FUNNEL_MODE_VALUES)[number]>,
    Exclude<RetentionAlignment, (typeof RETENTION_ALIGNMENT_VALUES)[number]>,
    Exclude<RetentionMode, (typeof RETENTION_MODE_VALUES)[number]>,
    Exclude<RetentionMathType, (typeof RETENTION_MATH_TYPE_VALUES)[number]>,
    Exclude<SegmentMethod, (typeof SEGMENT_METHOD_VALUES)[number]>,
    Exclude<FunnelReentryMode, (typeof FUNNEL_REENTRY_MODE_VALUES)[number]>,
    Exclude<
      RetentionUnboundedMode,
      (typeof RETENTION_UNBOUNDED_MODE_VALUES)[number]
    >,
    Exclude<TimeComparisonType, (typeof TIME_COMPARISON_TYPE_VALUES)[number]>,
    Exclude<TimeComparisonUnit, (typeof TIME_COMPARISON_UNIT_VALUES)[number]>,
    Exclude<
      CohortAggregationType,
      (typeof COHORT_AGGREGATION_TYPE_VALUES)[number]
    >,
    Exclude<FlowSessionEvent, (typeof FLOW_SESSION_EVENT_VALUES)[number]>,
    Exclude<
      FrequencyFilterOperator,
      (typeof FREQUENCY_FILTER_OPERATOR_VALUES)[number]
    >,
    Exclude<FlowChartType, (typeof FLOW_CHART_TYPE_VALUES)[number]>,
    Exclude<
      FlowConversionWindowUnit,
      (typeof FLOW_CONVERSION_WINDOW_UNIT_VALUES)[number]
    >,
    Exclude<FlowNodeType, (typeof FLOW_NODE_TYPE_VALUES)[number]>,
    Exclude<FlowAnchorType, (typeof FLOW_ANCHOR_TYPE_VALUES)[number]>,
    Exclude<InsightsMode, (typeof INSIGHTS_MODE_VALUES)[number]>,
    Exclude<FilterPropertyType, (typeof FILTER_PROPERTY_TYPE_VALUES)[number]>,
    Exclude<CustomPropertyType, (typeof CUSTOM_PROPERTY_TYPE_VALUES)[number]>,
    Exclude<FilterOperator, (typeof FILTER_OPERATOR_VALUES)[number]>,
    Exclude<FilterDateUnit, (typeof FILTER_DATE_UNIT_VALUES)[number]>,
    Exclude<FiltersCombinator, (typeof FILTERS_COMBINATOR_VALUES)[number]>,
    Exclude<BookmarkType, (typeof BOOKMARK_TYPE_VALUES)[number]>,
    Exclude<SavedReportType, (typeof SAVED_REPORT_TYPE_VALUES)[number]>,
    Exclude<EntityType, (typeof ENTITY_TYPE_VALUES)[number]>,
    Exclude<Region, (typeof REGION_VALUES)[number]>,
    Exclude<AccountType, (typeof ACCOUNT_TYPE_VALUES)[number]>,
  ]
>;
