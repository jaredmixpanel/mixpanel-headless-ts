/**
 * Metric/formula/time-comparison query-param types — TS port of the
 * corresponding frozen dataclasses in `mixpanel_headless/types.py`
 * (phase2-design C7, packet P2-5a): `Metric`, `CohortMetric`, `Formula`,
 * `TimeComparison`.
 *
 * Guard blocks are transcribed from the Python `__post_init__` bodies IN
 * SOURCE ORDER (Risk #1), one comment per registry code.
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
  /** Aggregation function. Default: `"total"`. */
  readonly math?: MathType;
  /** Property for property-based math types. Default: `null`. */
  readonly property?: PropertySpec | null;
  /** Per-user pre-aggregation type. Default: `null`. */
  readonly per_user?: PerUserAggregation | null;
  /** Custom percentile value (e.g. 95 for p95). Default: `null`. */
  readonly percentile_value?: number | null;
  /** Per-metric filters. Default: `null`. */
  readonly filters?: readonly Filter[] | null;
  /** How per-metric filters combine. Default: `"all"`. */
  readonly filters_combinator?: FiltersCombinator;
  /** Segment method for counting qualifying events. Default: `null`. */
  readonly segment_method?: SegmentMethod | null;
}

/**
 * Encapsulates a single event to query with its aggregation settings —
 * TS port of `types.Metric`.
 *
 * Plain event name strings inherit top-level query defaults; Metric
 * objects override them.
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
   * Create a metric (guards fire exactly as Python's `__post_init__`).
   *
   * @param fields - Declared fields; absent optionals take the Python
   *   defaults.
   * @throws ParamValidationError - `EV1_EMPTY_EVENT` /
   *   `EV2_CONTROL_CHAR_EVENT` (via the shared event-name guard),
   *   `V13_METRIC_MATH_PROPERTY`, `V26_PERCENTILE_REQUIRES_VALUE`,
   *   `MT2_INVALID_SEGMENT_METHOD` (transcribed in Python source order).
   */
  constructor(fields: MetricFields) {
    this.event = fields.event;
    this.math = fields.math === undefined ? "total" : fields.math;
    this.property = fields.property ?? null;
    this.per_user = fields.per_user ?? null;
    this.percentile_value = fields.percentile_value ?? null;
    this.filters = fields.filters ?? null;
    this.filters_combinator =
      fields.filters_combinator === undefined
        ? "all"
        : fields.filters_combinator;
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
      !["all", "first"].includes(this.segment_method as string)
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
 * A formula expression referencing events by position letter (A, B,
 * C...) — TS port of `types.Formula`.
 *
 * Letters map to event positions in the list passed to the query: A is
 * the first event, B the second, etc.
 */
export class Formula {
  /** Formula expression referencing events by letter. */
  readonly expression: string;

  /** Optional display label for the formula result. */
  readonly label: string | null;

  /**
   * Create a formula (guards fire exactly as Python's `__post_init__`).
   *
   * @param fields - Declared fields; `label` defaults to `null`.
   * @throws ParamValidationError - `FM1_EMPTY_EXPRESSION` when the
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
 * Track cohort size over time as an event metric — TS port of
 * `types.CohortMetric` (insights only; CM4 is enforced by the Phase-3
 * builders, CM5 here at construction).
 */
export class CohortMetric {
  /** Saved cohort ID or inline definition. */
  readonly cohort: number | CohortDefinition;

  /** Display name / series label. */
  readonly name: string | null;

  /**
   * Create a cohort metric (guards fire exactly as Python's
   * `__post_init__`).
   *
   * @param fields - Declared fields; `name` defaults to `null`.
   * @throws ParamValidationError - `CM1_COHORT_ID_NOT_POSITIVE` /
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
 * Overlay a comparison time period on insights, funnel, or retention
 * queries — TS port of `types.TimeComparison`.
 *
 * Use the static factories rather than constructing directly:
 * {@link relative}, {@link absoluteStart}, {@link absoluteEnd}.
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
   * Create a time comparison (guards fire exactly as Python's
   * `__post_init__`, rules TC0-TC3b in source order).
   *
   * @param fields - Declared fields; `unit`/`date` default to `null`.
   * @throws ParamValidationError - `TC0_INVALID_TYPE`,
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
    if (
      !["relative", "absolute-start", "absolute-end"].includes(
        this.type as string,
      )
    ) {
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
      if (
        !["day", "week", "month", "quarter", "year"].includes(
          this.unit as string,
        )
      ) {
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
   * Create a relative time comparison — port of
   * `TimeComparison.relative`.
   *
   * @param unit - Time unit for the comparison offset.
   * @returns TimeComparison with `type="relative"` and the given unit.
   */
  static relative(unit: TimeComparisonUnit): TimeComparison {
    return new TimeComparison({ type: "relative", unit });
  }

  /**
   * Create an absolute-start time comparison — port of
   * `TimeComparison.absolute_start`.
   *
   * @param date - Start date in YYYY-MM-DD format.
   * @returns TimeComparison with `type="absolute-start"` and the date.
   * @throws ParamValidationError - `TC3_DATE_FORMAT`/`TC3B_DATE_INVALID`
   *   via the constructor guards.
   */
  static absoluteStart(date: string): TimeComparison {
    return new TimeComparison({ type: "absolute-start", date });
  }

  /**
   * Create an absolute-end time comparison — port of
   * `TimeComparison.absolute_end`.
   *
   * @param date - End date in YYYY-MM-DD format.
   * @returns TimeComparison with `type="absolute-end"` and the date.
   * @throws ParamValidationError - `TC3_DATE_FORMAT`/`TC3B_DATE_INVALID`
   *   via the constructor guards.
   */
  static absoluteEnd(date: string): TimeComparison {
    return new TimeComparison({ type: "absolute-end", date });
  }
}
