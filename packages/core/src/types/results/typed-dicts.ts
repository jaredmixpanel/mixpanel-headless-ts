/**
 * Compile-time interfaces mirroring the five Python `TypedDict`s in
 * `mixpanel_headless.types`. No runtime artifact exists by design.
 *
 * Optionality: Python `total=False` keys may be absent but never `None`,
 * so they become `?: T | undefined` (under `exactOptionalPropertyTypes`);
 * explicitly `T | None` values add `| null`.
 *
 * @see mixpanel_headless.types.QueryMeta
 */

import type { FlowAnchorType, FlowNodeType } from "../literals.js";

/**
 * Response metadata of a query execution — port of `types.QueryMeta`
 * (`total=False`: every key optional).
 */
export interface QueryMeta {
  /** Sampling factor applied by the API. */
  readonly sampling_factor?: number | undefined;
  /** Whether the response was served from cache. */
  readonly is_cached?: boolean | undefined;
  /** Server-side computation time. */
  readonly computation_time?: number | undefined;
  /** Server-assigned query ID. */
  readonly query_id?: string | undefined;
}

/**
 * One step of a funnels response — port of `types.FunnelStepData`
 * (total: every key required).
 */
export interface FunnelStepData {
  /** Event name for the step. */
  readonly event: string;
  /** Users reaching the step. */
  readonly count: number;
  /** Conversion ratio from the previous step. */
  readonly step_conv_ratio: number;
  /** Conversion ratio from the first step. */
  readonly overall_conv_ratio: number;
  /** Average seconds from the previous step. */
  readonly avg_time: number;
  /** Average seconds from the first step. */
  readonly avg_time_from_start: number;
}

/**
 * One cohort of a retention response — port of
 * `types.RetentionCohortData` (total: every key required).
 */
export interface RetentionCohortData {
  /** Cohort size (users born in the interval). */
  readonly first: number;
  /** Returning-user counts per bucket. */
  readonly counts: readonly number[];
  /** Retention rates per bucket. */
  readonly rates: readonly number[];
}

/**
 * One node of a flows response step — port of `types.FlowStepNode`
 * (`total=False`; the wire's camelCase keys are kept as-is).
 */
export interface FlowStepNode {
  /** Event name. */
  readonly event?: string | undefined;
  /** Node count, as a string (flows API quirk — parsed via `safeInt`). */
  readonly totalCount?: string | undefined;
  /** Node type. */
  readonly type?: FlowNodeType | undefined;
  /** Anchor type. */
  readonly anchorType?: FlowAnchorType | undefined;
  /** Whether the event is a custom event. */
  readonly isCustomEvent?: boolean | undefined;
  /** Conversion-rate change vs the comparison window. */
  readonly conversionRateChange?: number | null | undefined;
}

/**
 * One edge of a flows response — port of `types.FlowEdge`
 * (`total=False`).
 */
export interface FlowEdge {
  /** Source node label. */
  readonly source?: string | undefined;
  /** Target node label. */
  readonly target?: string | undefined;
  /** Transition count. */
  readonly count?: number | undefined;
  /** Target step index. */
  readonly step?: number | undefined;
}
