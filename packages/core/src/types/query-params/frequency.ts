/**
 * Frequency query-param types — TS port of the corresponding frozen
 * dataclasses in `mixpanel_headless/types.py` (phase2-design C7, packet
 * P2-5c): `FrequencyBreakdown`, `FrequencyFilter`.
 *
 * Guard blocks are transcribed from the Python `__post_init__` bodies IN
 * SOURCE ORDER (Risk #1), one comment per registry code.
 *
 * R10.7 bug-compat note (phase2-design C10 / Escalations): downstream,
 * `build_frequency_filter_entry` (Phase-3 batch B3) serializes a
 * `FrequencyFilter` into a `customProperty`-nested clause that the live
 * Mixpanel query engine REJECTS with an HTTP 500 (probe record
 * `docs/history/phase1/addendum/frequency-filter-probe.md`; bug filed as
 * `docs/history/phase1/bug-reports/mixpanel-headless-frequency-filter-clause-shape.md`).
 * The TS port replicates the current Python behavior byte-for-byte —
 * `FrequencyFilter` accepts exactly what Python accepts and the Phase-3
 * builder will reproduce the server-500 shape unchanged. DO NOT FIX.
 */

import { VALID_FREQUENCY_FILTER_OPERATORS } from "../../bookmarks/enums.js";
import { pythonStrip } from "../../compat/index.js";
import { ParamValidationError } from "../../errors.js";
import type { FrequencyFilterOperator } from "../literals.js";
import type { Filter } from "./filter.js";

/**
 * Declared constructor fields of {@link FrequencyBreakdown} (Python
 * field order).
 */
export interface FrequencyBreakdownFields {
  /** Event name to count frequency for. */
  readonly event: string;
  /** Width of each frequency bucket. Default: `1`. */
  readonly bucket_size?: number;
  /** Minimum frequency value. Default: `0`. */
  readonly bucket_min?: number;
  /** Maximum frequency value. Default: `10`. */
  readonly bucket_max?: number;
  /** Display label for the breakdown. Default: `null`. */
  readonly label?: string | null;
}

/**
 * Break down query results by how often users performed an event — TS
 * port of `types.FrequencyBreakdown`.
 *
 * Used in the `group_by=` parameter to segment users by event
 * frequency.
 */
export class FrequencyBreakdown {
  /** Event name to count frequency for. */
  readonly event: string;

  /** Width of each frequency bucket. */
  readonly bucket_size: number;

  /** Minimum frequency value. */
  readonly bucket_min: number;

  /** Maximum frequency value. */
  readonly bucket_max: number;

  /**
   * Display label for the breakdown (`null` generates
   * `"<event> Frequency"` downstream).
   */
  readonly label: string | null;

  /**
   * Create a frequency breakdown (guards fire exactly as Python's
   * `__post_init__`, rules FB1-FB4 in source order: FB1, FB2, FB4,
   * FB3 — Python checks FB4 before FB3).
   *
   * @param fields - Declared fields; absent optionals take the Python
   *   defaults.
   * @throws ParamValidationError - `FB1_EMPTY_EVENT`,
   *   `FB2_BUCKET_SIZE_NOT_POSITIVE`, `FB4_BUCKET_MIN_NEGATIVE`,
   *   `FB3_BUCKET_ORDER`.
   */
  constructor(fields: FrequencyBreakdownFields) {
    this.event = fields.event;
    this.bucket_size = fields.bucket_size ?? 1;
    this.bucket_min = fields.bucket_min ?? 0;
    this.bucket_max = fields.bucket_max ?? 10;
    this.label = fields.label ?? null;
    // FB1_EMPTY_EVENT: event must be non-empty.
    if (!pythonStrip(this.event)) {
      throw new ParamValidationError(
        "FrequencyBreakdown.event must be a non-empty string",
        "FB1_EMPTY_EVENT",
      );
    }
    // FB2_BUCKET_SIZE_NOT_POSITIVE: bucket_size must be positive.
    if (this.bucket_size <= 0) {
      throw new ParamValidationError(
        "FrequencyBreakdown.bucket_size must be positive, " +
          `got ${String(this.bucket_size)}`,
        "FB2_BUCKET_SIZE_NOT_POSITIVE",
      );
    }
    // FB4_BUCKET_MIN_NEGATIVE: bucket_min must be non-negative
    // (Python checks FB4 before FB3 "for clarity" — order preserved).
    if (this.bucket_min < 0) {
      throw new ParamValidationError(
        "FrequencyBreakdown.bucket_min must be non-negative, " +
          `got ${String(this.bucket_min)}`,
        "FB4_BUCKET_MIN_NEGATIVE",
      );
    }
    // FB3_BUCKET_ORDER: bucket_min must be < bucket_max.
    if (this.bucket_min >= this.bucket_max) {
      throw new ParamValidationError(
        `FrequencyBreakdown.bucket_min (${String(this.bucket_min)}) must be ` +
          `less than bucket_max (${String(this.bucket_max)})`,
        "FB3_BUCKET_ORDER",
      );
    }
  }
}

/**
 * Declared constructor fields of {@link FrequencyFilter} (Python field
 * order — note `value` is declared second and REQUIRED).
 */
export interface FrequencyFilterFields {
  /** Event name to count frequency for. */
  readonly event: string;
  /** Threshold value for the comparison (int or float). */
  readonly value: number;
  /** Comparison operator. Default: `"is at least"`. */
  readonly operator?: FrequencyFilterOperator;
  /** Lookback window size. Default: `null`. */
  readonly date_range_value?: number | null;
  /** Lookback window unit. Default: `null`. */
  readonly date_range_unit?: "day" | "week" | "month" | null;
  /** Property filters applied to the frequency event. Default: `null`. */
  readonly event_filters?: readonly Filter[] | null;
  /** Display label for the filter. Default: `null`. */
  readonly label?: string | null;
}

/**
 * Filter query results by how often users performed an event — TS port
 * of `types.FrequencyFilter`.
 *
 * Used in the `where=` parameter to restrict results to users meeting
 * a frequency threshold. See the module-level R10.7 note: the clause
 * shape this type feeds is server-rejected today and is replicated,
 * not fixed.
 */
export class FrequencyFilter {
  /** Event name to count frequency for. */
  readonly event: string;

  /** Threshold value for the comparison. */
  readonly value: number;

  /** Comparison operator. */
  readonly operator: FrequencyFilterOperator;

  /** Lookback window size (paired with `date_range_unit`). */
  readonly date_range_value: number | null;

  /** Lookback window unit (paired with `date_range_value`). */
  readonly date_range_unit: "day" | "week" | "month" | null;

  /** Property filters applied to the frequency event before counting. */
  readonly event_filters: readonly Filter[] | null;

  /** Display label for the filter. */
  readonly label: string | null;

  /**
   * Create a frequency filter (guards fire exactly as Python's
   * `__post_init__`, rules FF1-FF5 in source order).
   *
   * @param fields - Declared fields; absent optionals take the Python
   *   defaults.
   * @throws ParamValidationError - `FF1_EMPTY_EVENT`,
   *   `FF2_INVALID_OPERATOR`, `FF3_VALUE_NEGATIVE`,
   *   `FF4_DATE_RANGE_PAIR`, `FF5_DATE_RANGE_VALUE_NOT_POSITIVE`.
   */
  constructor(fields: FrequencyFilterFields) {
    this.event = fields.event;
    this.value = fields.value;
    this.operator = fields.operator ?? "is at least";
    this.date_range_value = fields.date_range_value ?? null;
    this.date_range_unit = fields.date_range_unit ?? null;
    this.event_filters = fields.event_filters ?? null;
    this.label = fields.label ?? null;
    // FF1_EMPTY_EVENT: event must be non-empty.
    if (!pythonStrip(this.event)) {
      throw new ParamValidationError(
        "FrequencyFilter.event must be a non-empty string",
        "FF1_EMPTY_EVENT",
      );
    }
    // FF2_INVALID_OPERATOR: operator must be valid.
    if (!VALID_FREQUENCY_FILTER_OPERATORS.has(this.operator)) {
      const valid = [...VALID_FREQUENCY_FILTER_OPERATORS].sort().join(", ");
      throw new ParamValidationError(
        `FrequencyFilter.operator must be one of: ${valid}; ` +
          `got ${JSON.stringify(this.operator)}`,
        "FF2_INVALID_OPERATOR",
      );
    }
    // FF3_VALUE_NEGATIVE: value must be non-negative.
    if (this.value < 0) {
      throw new ParamValidationError(
        `FrequencyFilter.value must be non-negative, got ${String(this.value)}`,
        "FF3_VALUE_NEGATIVE",
      );
    }
    // FF4_DATE_RANGE_PAIR: date_range_value and date_range_unit must
    // both be set or both be None.
    const hasValue = this.date_range_value !== null;
    const hasUnit = this.date_range_unit !== null;
    if (hasValue !== hasUnit) {
      throw new ParamValidationError(
        `FrequencyFilter.date_range_value and date_range_unit must ` +
          `both be set or both be None; got date_range_value=` +
          `${String(this.date_range_value)}, date_range_unit=${String(
            this.date_range_unit,
          )}`,
        "FF4_DATE_RANGE_PAIR",
      );
    }
    // FF5_DATE_RANGE_VALUE_NOT_POSITIVE: date_range_value positive if set.
    if (this.date_range_value !== null && this.date_range_value <= 0) {
      throw new ParamValidationError(
        "FrequencyFilter.date_range_value must be positive when set, " +
          `got ${String(this.date_range_value)}`,
        "FF5_DATE_RANGE_VALUE_NOT_POSITIVE",
      );
    }
  }
}
