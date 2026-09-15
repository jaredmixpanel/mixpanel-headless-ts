/**
 * Per-metric query-parameter types: `Metric` (an event with its
 * aggregation settings), `Formula` (an expression over metric letters),
 * `CohortMetric` (cohort size over time) and `TimeComparison` (a
 * comparison-period overlay). Constructor guards fire in the Python
 * `__post_init__` order, one comment per rule code.
 *
 * @see mixpanel_headless.types.Metric
 */

import { pythonStrip } from "../../compat/index.js";
import { ParamValidationError } from "../../errors.js";
import type {
  FiltersCombinator,
  MathType,
  PerUserAggregation,
  SegmentMethod,
  TimeComparisonType,
  TimeComparisonUnit,
} from "../literals.js";
import { CohortDefinition } from "./cohort.js";
import type { Filter, PropertySpec } from "./filter.js";
import {
  isRealCalendarDate,
  MATH_REQUIRING_PROPERTY,
  validateCohortArgs,
  validateEventName,
} from "./guards.js";

/** Declared constructor fields of {@link Metric} (Python field order). */
export interface MetricFields {
  /** Mixpanel event name. */
  readonly event: string;
  /**
   * Aggregation function.
   *
   * @defaultValue `"total"`
   */
  readonly math?: MathType;
  /**
   * Property for property-based math types.
   *
   * @defaultValue `null`
   */
  readonly property?: PropertySpec | null;
  /**
   * Per-user pre-aggregation type.
   *
   * @defaultValue `null`
   */
  readonly per_user?: PerUserAggregation | null;
  /**
   * Custom percentile value (e.g. 95 for p95).
   *
   * @defaultValue `null`
   */
  readonly percentile_value?: number | null;
  /**
   * Per-metric filters.
   *
   * @defaultValue `null`
   */
  readonly filters?: readonly Filter[] | null;
  /**
   * How per-metric filters combine.
   *
   * @defaultValue `"all"`
   */
  readonly filters_combinator?: FiltersCombinator;
  /**
   * Segment method for counting qualifying events.
   *
   * @defaultValue `null`
   */
  readonly segment_method?: SegmentMethod | null;
}

/**
 * A single event to query together with its aggregation settings.
 *
 * Plain event-name strings inherit the top-level query defaults; `Metric`
 * objects override them per event.
 *
 * @example
 * ```ts
 * const revenue = new Metric({
 *   event: "Purchase",
 *   math: "sum",
 *   property: "amount",
 *   filters: [Filter.equals("currency", "USD")],
 * });
 * const p95 = new Metric({ event: "Load", math: "percentile", property: "ms", percentile_value: 95 });
 * ```
 * @see mixpanel_headless.types.Metric
 */
export class Metric {
  /** Mixpanel event name. */
  readonly event: string;

  /** Aggregation function. */
  readonly math: MathType;

  /** Property for property-based math types (name, ref, or inline). */
  readonly property: PropertySpec | null;

  /** Per-user pre-aggregation type. */
  readonly per_user: PerUserAggregation | null;

  /**
   * Custom percentile value (e.g. 95 for p95). Required when
   * `math="percentile"`; ignored for other math types. Maps to
   * `percentile` in bookmark JSON.
   */
  readonly percentile_value: number | null;

  /** Per-metric filters (applied in addition to global `where`). */
  readonly filters: readonly Filter[] | null;

  /** How per-metric filters combine (`"all"` = AND, `"any"` = OR). */
  readonly filters_combinator: FiltersCombinator;

  /**
   * Segment method for counting qualifying events (`"all"` counts every
   * qualifying event, `"first"` only the first per user). Maps to
   * `segmentMethod` in the bookmark measurement block.
   */
  readonly segment_method: SegmentMethod | null;

  /**
   * Create a metric; the guards fire in Python `__post_init__` order.
   *
   * @param fields - Declared fields; absent optionals take the Python
   *   defaults.
   * @throws {@link ParamValidationError} - `EV1_EMPTY_EVENT` /
   *   `EV2_CONTROL_CHAR_EVENT` (via the shared event-name guard),
   *   `V13_METRIC_MATH_PROPERTY`, `V26_PERCENTILE_REQUIRES_VALUE`,
   *   `MT2_INVALID_SEGMENT_METHOD` (transcribed in Python source order).
   */
  constructor(fields: MetricFields) {
    this.event = fields.event;
    this.math = fields.math ?? "total";
    this.property = fields.property ?? null;
    this.per_user = fields.per_user ?? null;
    this.percentile_value = fields.percentile_value ?? null;
    this.filters = fields.filters ?? null;
    this.filters_combinator = fields.filters_combinator ?? "all";
    this.segment_method = fields.segment_method ?? null;
    // EV1_EMPTY_EVENT / EV2_CONTROL_CHAR_EVENT: shared event-name guard.
    validateEventName(this.event, "Metric");
    // V13_METRIC_MATH_PROPERTY: property-based math requires a property.
    if (MATH_REQUIRING_PROPERTY.has(this.math) && this.property === null) {
      throw new ParamValidationError(
        `Metric math=${JSON.stringify(this.math)} requires a property ` +
          `to be set (e.g., Metric(${JSON.stringify(this.event)}, ` +
          `math=${JSON.stringify(this.math)}, property="your_property"))`,
        "V13_METRIC_MATH_PROPERTY",
      );
    }
    // V26_PERCENTILE_REQUIRES_VALUE: percentile math needs its value.
    if (this.math === "percentile" && this.percentile_value === null) {
      throw new ParamValidationError(
        'Metric math="percentile" requires percentile_value ' +
          "(e.g., Metric(event, math='percentile', percentile_value=95))",
        "V26_PERCENTILE_REQUIRES_VALUE",
      );
    }
    // MT2_INVALID_SEGMENT_METHOD: segment_method must be valid if set.
    if (
      this.segment_method !== null &&
      !["all", "first"].includes(this.segment_method)
    ) {
      throw new ParamValidationError(
        "Metric segment_method must be one of ['all', 'first'], " +
          `got ${JSON.stringify(this.segment_method)}`,
        "MT2_INVALID_SEGMENT_METHOD",
      );
    }
  }
}

/**
 * A formula expression that references the query's events by position
 * letter: `A` is the first event, `B` the second, and so on.
 *
 * @example
 * ```ts
 * const conversion = new Formula({ expression: "B / A * 100", label: "Conversion %" });
 * ```
 * @see mixpanel_headless.types.Formula
 */
export class Formula {
  /** Formula expression referencing events by letter. */
  readonly expression: string;

  /** Optional display label for the formula result. */
  readonly label: string | null;

  /**
   * Create a formula; the guard fires in Python `__post_init__` order.
   *
   * @param fields - Bag with `expression` (the formula text, required) and
   *   `label` (display label, defaults to `null`).
   * @throws {@link ParamValidationError} - `FM1_EMPTY_EXPRESSION` when the
   *   expression is empty/blank.
   */
  constructor(fields: {
    readonly expression: string;
    readonly label?: string | null;
  }) {
    this.expression = fields.expression;
    this.label = fields.label ?? null;
    // FM1_EMPTY_EXPRESSION: expression must be a non-empty string.
    if (!this.expression || !pythonStrip(this.expression)) {
      throw new ParamValidationError(
        "Formula.expression must be a non-empty string",
        "FM1_EMPTY_EXPRESSION",
      );
    }
  }
}

/**
 * Track the size of a saved cohort over time as an insights metric.
 *
 * Only saved cohorts are accepted (rule CM5, enforced here); the bookmark
 * builders enforce the insights-only restriction (rule CM4).
 *
 * @example
 * ```ts
 * const payingUsers = new CohortMetric({ cohort: 12345, name: "Paying users" });
 * ```
 * @see mixpanel_headless.types.CohortMetric
 */
export class CohortMetric {
  /** Saved cohort ID or inline definition. */
  readonly cohort: number | CohortDefinition;

  /** Display name / series label. */
  readonly name: string | null;

  /**
   * Create a cohort metric; the guards fire in Python `__post_init__`
   * order.
   *
   * @param fields - Bag with `cohort` (saved cohort id or inline
   *   definition, required) and `name` (display name, defaults to `null`).
   * @throws {@link ParamValidationError} - `CM1_COHORT_ID_NOT_POSITIVE` /
   *   `CM2_COHORT_NAME_EMPTY` (via the shared cohort-args guard), then
   *   `CM5_INLINE_COHORT_METRIC` when the cohort is an inline
   *   `CohortDefinition` (the server returns 500 for those).
   */
  constructor(fields: {
    readonly cohort: number | CohortDefinition;
    readonly name?: string | null;
  }) {
    this.cohort = fields.cohort;
    this.name = fields.name ?? null;
    // CM1_COHORT_ID_NOT_POSITIVE / CM2_COHORT_NAME_EMPTY: shared guard.
    validateCohortArgs(this.cohort, this.name, "CM");
    // CM5_INLINE_COHORT_METRIC: inline CohortDefinition causes a
    // server-side 500 — rejected at construction.
    if (this.cohort instanceof CohortDefinition) {
      throw new ParamValidationError(
        "CohortMetric does not support inline CohortDefinition " +
          "(server returns 500). Use a saved cohort ID instead.",
        "CM5_INLINE_COHORT_METRIC",
      );
    }
  }
}

/**
 * Overlay a comparison time period on an insights, funnel or retention
 * query.
 *
 * Prefer the static factories to direct construction: {@link relative},
 * {@link absoluteStart}, {@link absoluteEnd}.
 *
 * @example
 * ```ts
 * const lastMonth = TimeComparison.relative("month");
 * const fromLaunch = TimeComparison.absoluteStart("2026-01-01");
 * ```
 * @see mixpanel_headless.types.TimeComparison
 */
export class TimeComparison {
  /**
   * Discriminant — `"relative"`, `"absolute-start"`, or
   * `"absolute-end"`.
   */
  readonly type: TimeComparisonType;

  /** Time unit for relative comparison (day/week/month/quarter/year). */
  readonly unit: TimeComparisonUnit | null;

  /** ISO date (YYYY-MM-DD) for absolute comparison. */
  readonly date: string | null;

  /**
   * Create a time comparison; the guards TC0–TC3b fire in Python
   * `__post_init__` order.
   *
   * @param fields - Bag with `type` (the discriminant, required), `unit`
   *   (relative comparisons only, defaults to `null`) and `date`
   *   (`YYYY-MM-DD`, absolute comparisons only, defaults to `null`).
   * @throws {@link ParamValidationError} - `TC0_INVALID_TYPE`,
   *   `TC1_REQUIRES_UNIT`, `TC1B_INVALID_UNIT`, `TC1_REJECTS_DATE`,
   *   `TC2_REQUIRES_DATE`, `TC2_REJECTS_UNIT`, `TC3_DATE_FORMAT`,
   *   `TC3B_DATE_INVALID`.
   */
  constructor(fields: {
    readonly type: TimeComparisonType;
    readonly unit?: TimeComparisonUnit | null;
    readonly date?: string | null;
  }) {
    this.type = fields.type;
    this.unit = fields.unit ?? null;
    this.date = fields.date ?? null;
    // TC0_INVALID_TYPE: type must be a valid TimeComparisonType.
    if (!["relative", "absolute-start", "absolute-end"].includes(this.type)) {
      throw new ParamValidationError(
        "TimeComparison type must be one of " +
          "['absolute-end', 'absolute-start', 'relative'], " +
          `got ${JSON.stringify(this.type)}`,
        "TC0_INVALID_TYPE",
      );
    }
    if (this.type === "relative") {
      // TC1_REQUIRES_UNIT: relative requires unit.
      if (this.unit === null) {
        throw new ParamValidationError(
          "TimeComparison type='relative' requires unit to be set " +
            "(e.g., TimeComparison.relative('month'))",
          "TC1_REQUIRES_UNIT",
        );
      }
      // TC1B_INVALID_UNIT: unit must be a valid TimeComparisonUnit.
      if (!["day", "week", "month", "quarter", "year"].includes(this.unit)) {
        throw new ParamValidationError(
          "TimeComparison unit must be one of " +
            "['day', 'month', 'quarter', 'week', 'year'], " +
            `got ${JSON.stringify(this.unit)}`,
          "TC1B_INVALID_UNIT",
        );
      }
      // TC1_REJECTS_DATE: relative rejects date.
      if (this.date !== null) {
        throw new ParamValidationError(
          "TimeComparison type='relative' does not accept date; " +
            "use absolute-start or absolute-end for date-based comparison",
          "TC1_REJECTS_DATE",
        );
      }
    } else {
      // TC2_REQUIRES_DATE: absolute-start/absolute-end requires date.
      if (this.date === null) {
        throw new ParamValidationError(
          `TimeComparison type=${JSON.stringify(this.type)} requires date ` +
            "to be set (e.g., TimeComparison.absoluteStart('2026-01-01'))",
          "TC2_REQUIRES_DATE",
        );
      }
      // TC2_REJECTS_UNIT: absolute comparisons reject unit.
      if (this.unit !== null) {
        throw new ParamValidationError(
          `TimeComparison type=${JSON.stringify(this.type)} does not ` +
            "accept unit; unit is only valid for type='relative'",
          "TC2_REJECTS_UNIT",
        );
      }
      // TC3_DATE_FORMAT: date must be YYYY-MM-DD.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(this.date)) {
        throw new ParamValidationError(
          "TimeComparison date must be in YYYY-MM-DD format, " +
            `got ${JSON.stringify(this.date)}`,
          "TC3_DATE_FORMAT",
        );
      }
      // TC3B_DATE_INVALID: date must be a real calendar date.
      if (!isRealCalendarDate(this.date)) {
        throw new ParamValidationError(
          `TimeComparison date is not a valid calendar date: ${JSON.stringify(
            this.date,
          )}`,
          "TC3B_DATE_INVALID",
        );
      }
    }
  }

  /**
   * Create a relative time comparison.
   *
   * @param unit - Time unit for the comparison offset.
   * @returns A `TimeComparison` with `type="relative"` and the given unit.
   * @throws {@link ParamValidationError} - `TC1B_INVALID_UNIT` from the
   *   constructor guards when the unit is not one of the five units.
   * @see mixpanel_headless.types.TimeComparison.relative
   */
  static relative(unit: TimeComparisonUnit): TimeComparison {
    return new TimeComparison({ type: "relative", unit });
  }

  /**
   * Create an absolute-start time comparison.
   *
   * @param date - Start date in `YYYY-MM-DD` format.
   * @returns A `TimeComparison` with `type="absolute-start"` and the date.
   * @throws {@link ParamValidationError} - `TC3_DATE_FORMAT` /
   *   `TC3B_DATE_INVALID` from the constructor guards.
   * @see mixpanel_headless.types.TimeComparison.absolute_start
   */
  static absoluteStart(date: string): TimeComparison {
    return new TimeComparison({ type: "absolute-start", date });
  }

  /**
   * Create an absolute-end time comparison.
   *
   * @param date - End date in `YYYY-MM-DD` format.
   * @returns A `TimeComparison` with `type="absolute-end"` and the date.
   * @throws {@link ParamValidationError} - `TC3_DATE_FORMAT` /
   *   `TC3B_DATE_INVALID` from the constructor guards.
   * @see mixpanel_headless.types.TimeComparison.absolute_end
   */
  static absoluteEnd(date: string): TimeComparison {
    return new TimeComparison({ type: "absolute-end", date });
  }
}
