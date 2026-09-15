/**
 * Layer-1 argument validators.
 *
 * Source: `src/mixpanel_headless/_internal/validation.py`
 * (`validate_time_args` :511-647, `validate_group_by_args` :650-771,
 * `validate_funnel_args` :779-1155, `validate_retention_args`
 * :1179-1477, `validate_flow_args` :1498-1764, `validate_query_args`
 * :1885-2280). Python revision: `ts-port/phase2-contract-support` HEAD.
 *
 * These validators are TOTAL functions returning `ValidationError[]`;
 * callers decide whether to raise `BookmarkValidationError`. Every
 * `errors.push` / `errors.push(...)` appears in Python source order —
 * emission order is contract (b2-packets.md Cautions §11).
 *
 * Input-typing posture (R4.9 / R10.10): parameters are deliberately
 * loose where Python type-checks at runtime (`steps` elements,
 * `conversion_window`, `bucket_sizes` elements, `data_group_id`,
 * `group_by`) so the B5 facade can forward raw user input — the
 * validators ARE the type police.
 *
 * @module validation-args
 * @internal
 */

import {
  MATH_NO_PER_USER,
  MATH_PROPERTY_OPTIONAL,
  MATH_REQUIRING_PROPERTY,
  MAX_CONVERSION_WINDOW,
  MAX_FUNNEL_STEPS,
  MAX_HOLDING_CONSTANT,
  VALID_CONVERSION_WINDOW_UNITS,
  VALID_FLOWS_CONVERSION_WINDOW_UNITS,
  VALID_FLOWS_COUNT_TYPES,
  VALID_FLOWS_MODES,
  VALID_FUNNEL_REENTRY_MODES,
  VALID_RETENTION_ALIGNMENT,
  VALID_RETENTION_UNBOUNDED_MODES,
  VALID_RETENTION_UNITS,
} from "../bookmarks/enums.js";
import { pythonRepr, pythonStrip, sortedByCodepoint } from "../compat/index.js";
import { ValidationError } from "../errors.js";
import {
  CohortBreakdown,
  CohortDefinition,
  CohortMetric,
  type Exclusion,
  Formula,
  FunnelStep,
  GroupBy,
  HoldingConstant,
  Metric,
} from "../types/index.js";
import {
  codepointGreater,
  containsControlChars,
  enumError,
  FLOW_MAX_WINDOW,
  FORMULA_POSITION_RE,
  isFiniteNumber,
  isInvisibleOnly,
  isPythonFloat,
  isPythonInt,
  isValidDate,
  matchesDateRe,
  MAX_FLOW_CARDINALITY,
  MAX_FLOW_STEPS_DIRECTION,
  MAX_LAST_DAYS,
  MAX_RETENTION_BUCKETS,
  MAX_ROLLING,
  pythonListRepr,
  pythonNumberStr,
  pythonStrLoose,
  pythonTypeName,
  scanCustomProperties,
  SESSION_MATH,
  suggest,
  VALID_RETENTION_MATH_PUBLIC,
  VALID_RETENTION_MODES,
  validateDataGroupId,
} from "./validation-shared.js";

// =============================================================================
// validate_time_args (validation.py:511-647)
// =============================================================================

/** Options bag for {@link validateTimeArgs} (Python is all-kwonly). */
export interface ValidateTimeArgsOptions {
  /** Start date in YYYY-MM-DD format, or `null`. */
  readonly from_date: string | null;
  /** End date in YYYY-MM-DD format, or `null`. */
  readonly to_date: string | null;
  /** Number of days for a relative date range (facade default: 30). */
  readonly last: number;
}

/**
 * Validate time-range arguments (rules V7-V10, V15, V20).
 *
 * Extracted from {@link validateQueryArgs} so callers building
 * non-Insights bookmark types can reuse the same date/last checks
 * without pulling in the full query-arg validator.
 *
 * @param options - Time range parameters.
 * @returns List of validation errors; empty means all time arguments
 *   are valid.
 * @example
 * ```typescript
 * const errors = validateTimeArgs({
 *   from_date: "2024-01-01",
 *   to_date: "2024-01-31",
 *   last: 30,
 * });
 * // errors.length === 0
 * ```
 */
export function validateTimeArgs(
  options: ValidateTimeArgsOptions,
): ValidationError[] {
  const { from_date, to_date, last } = options;
  const errors: ValidationError[] = [];

  // V7: last must be positive
  if (last <= 0) {
    errors.push(
      new ValidationError(
        "last",
        "last must be a positive integer",
        "V7_LAST_POSITIVE",
      ),
    );
  }

  // V8: Date format and calendar validation
  if (from_date !== null) {
    if (!matchesDateRe(from_date)) {
      errors.push(
        new ValidationError(
          "from_date",
          `from_date must be YYYY-MM-DD format (got '${from_date}')`,
          "V8_DATE_FORMAT",
        ),
      );
    } else if (!isValidDate(from_date)) {
      errors.push(
        new ValidationError(
          "from_date",
          `from_date '${from_date}' is not a valid calendar date`,
          "V8_DATE_INVALID",
        ),
      );
    }
  }
  if (to_date !== null) {
    if (!matchesDateRe(to_date)) {
      errors.push(
        new ValidationError(
          "to_date",
          `to_date must be YYYY-MM-DD format (got '${to_date}')`,
          "V8_DATE_FORMAT",
        ),
      );
    } else if (!isValidDate(to_date)) {
      errors.push(
        new ValidationError(
          "to_date",
          `to_date '${to_date}' is not a valid calendar date`,
          "V8_DATE_INVALID",
        ),
      );
    }
  }

  // V9: to_date requires from_date
  if (to_date !== null && from_date === null) {
    errors.push(
      new ValidationError(
        "to_date",
        "to_date requires from_date",
        "V9_TO_REQUIRES_FROM",
      ),
    );
  }

  // V10: Cannot combine explicit dates with non-default last
  if (from_date !== null && last !== 30) {
    errors.push(
      new ValidationError(
        "last",
        `Cannot combine last=${pythonNumberStr(last)} with explicit dates; ` +
          `use either last or from_date/to_date`,
        "V10_DATE_LAST_EXCLUSIVE",
      ),
    );
  }

  // V15: Date ordering — from_date must be <= to_date. R11.5: Python
  // `>` on str is codepoint-wise, and `_DATE_RE`'s `\d` admits non-BMP
  // Unicode Nd digits, so JS `>` (UTF-16 code-unit order) would diverge.
  if (
    from_date !== null &&
    to_date !== null &&
    matchesDateRe(from_date) &&
    matchesDateRe(to_date) &&
    codepointGreater(from_date, to_date)
  ) {
    errors.push(
      new ValidationError(
        "from_date",
        `from_date '${from_date}' is after to_date '${to_date}'; ` +
          `dates must be in chronological order`,
        "V15_DATE_ORDER",
      ),
    );
  }

  // V20: last must not be absurdly large
  if (last > MAX_LAST_DAYS) {
    errors.push(
      new ValidationError(
        "last",
        `last=${pythonNumberStr(last)} exceeds maximum of ` +
          `${String(MAX_LAST_DAYS)} days (~10 years)`,
        "V20_LAST_TOO_LARGE",
      ),
    );
  }

  return errors;
}

// =============================================================================
// validate_group_by_args (validation.py:650-771)
// =============================================================================

/** Options bag for {@link validateGroupByArgs}. */
export interface ValidateGroupByArgsOptions {
  /**
   * Breakdown specification — a property-name string, a `GroupBy`, a
   * `CohortBreakdown`, a `FrequencyBreakdown`, an array of any mix, or
   * `null` for no breakdown.
   */
  readonly group_by: unknown;
}

/**
 * Validate group-by arguments (rules V11-V12, V18, V24).
 *
 * Extracted from {@link validateQueryArgs} so callers building
 * non-Insights bookmark types can reuse the same bucket checks.
 *
 * @param options - Breakdown specification bag.
 * @returns List of validation errors; empty means all group-by
 *   arguments are valid.
 * @example
 * ```typescript
 * const errors = validateGroupByArgs({
 *   group_by: new GroupBy({
 *     property: "revenue",
 *     property_type: "number",
 *     bucket_size: 50,
 *     bucket_min: 0,
 *     bucket_max: 500,
 *   }),
 * });
 * // errors.length === 0
 * ```
 */
export function validateGroupByArgs(
  options: ValidateGroupByArgsOptions,
): ValidationError[] {
  const { group_by } = options;
  const errors: ValidationError[] = [];

  if (group_by === null || group_by === undefined) {
    return errors;
  }

  const groups: readonly unknown[] = Array.isArray(group_by)
    ? group_by
    : [group_by];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g instanceof GroupBy) {
      const gpath = groups.length > 1 ? `group_by[${String(i)}]` : "group_by";

      // V24: Bucket values must be finite (not NaN or Inf)
      const bucketFields: ReadonlyArray<readonly [string, number | null]> = [
        ["bucket_size", g.bucket_size],
        ["bucket_min", g.bucket_min],
        ["bucket_max", g.bucket_max],
      ];
      for (const [fname, fval] of bucketFields) {
        if (!isFiniteNumber(fval)) {
          errors.push(
            new ValidationError(
              gpath,
              `${fname} must be a finite number, got ${pythonNumberStr(fval)}`,
              "V24_BUCKET_NOT_FINITE",
            ),
          );
        }
      }

      if (
        (g.bucket_min !== null || g.bucket_max !== null) &&
        g.bucket_size === null
      ) {
        errors.push(
          new ValidationError(
            gpath,
            "bucket_min/bucket_max require bucket_size",
            "V11_BUCKET_REQUIRES_SIZE",
          ),
        );
      }
      if (g.bucket_size !== null && g.bucket_size <= 0) {
        errors.push(
          new ValidationError(
            gpath,
            "bucket_size must be positive",
            "V12_BUCKET_SIZE_POSITIVE",
          ),
        );
      }
      if (g.bucket_size !== null && g.property_type !== "number") {
        errors.push(
          new ValidationError(
            gpath,
            "bucket_size requires property_type='number'",
            "V12B_BUCKET_REQUIRES_NUMBER",
          ),
        );
      }
      if (
        g.bucket_size !== null &&
        (g.bucket_min === null || g.bucket_max === null)
      ) {
        errors.push(
          new ValidationError(
            gpath,
            "bucket_size requires both bucket_min and bucket_max",
            "V12C_BUCKET_REQUIRES_BOUNDS",
          ),
        );
      }

      // V18: bucket_min must be < bucket_max
      if (
        g.bucket_min !== null &&
        g.bucket_max !== null &&
        g.bucket_min >= g.bucket_max
      ) {
        errors.push(
          new ValidationError(
            gpath,
            `bucket_min (${pythonNumberStr(g.bucket_min)}) must be less than ` +
              `bucket_max (${pythonNumberStr(g.bucket_max)})`,
            "V18_BUCKET_ORDER",
          ),
        );
      }
    }
  }

  return errors;
}

// =============================================================================
// validate_funnel_args (validation.py:779-1155)
// =============================================================================

/** Options bag for {@link validateFunnelArgs}. */
export interface ValidateFunnelArgsOptions {
  /** Funnel step specifications (event names or `FunnelStep` objects). */
  readonly steps: readonly unknown[];
  /** Conversion window size (must be a positive integer). */
  readonly conversion_window: unknown;
  /** Time unit for the conversion window. Default: `"day"`. */
  readonly conversion_window_unit?: string | undefined;
  /** Funnel aggregation. Default: `"conversion_rate_unique"`. */
  readonly math?: string | undefined;
  /** Numeric property for property-aggregation math. Default: `null`. */
  readonly math_property?: string | null | undefined;
  /** Events to exclude between steps, or `null`. */
  readonly exclusions: readonly Exclusion[] | null;
  /** Properties to hold constant, or `null`. Default: `null`. */
  readonly holding_constant?: readonly unknown[] | null | undefined;
  /** Start date (YYYY-MM-DD) or `null`. */
  readonly from_date: string | null;
  /** End date (YYYY-MM-DD) or `null`. */
  readonly to_date: string | null;
  /** Number of days for a relative date range. */
  readonly last: number;
  /** Breakdown specification. */
  readonly group_by: unknown;
  /** Funnel reentry mode, or `null`. Default: `null`. */
  readonly reentry_mode?: string | null | undefined;
  /** Optional data group ID for group-level analytics. Default: `null`. */
  readonly data_group_id?: unknown;
}

/**
 * Validate funnel query arguments before bookmark construction (Layer 1).
 *
 * Implements funnel-specific rules F1-F12 plus the reused time and
 * group-by validators, returning ALL errors so callers can fix multiple
 * issues in a single pass.
 *
 * @param options - Funnel query arguments.
 * @returns List of validation errors; empty means all arguments are
 *   valid.
 * @example
 * ```typescript
 * const errors = validateFunnelArgs({
 *   steps: ["Signup", "Purchase"],
 *   conversion_window: 14,
 *   exclusions: null,
 *   from_date: null,
 *   to_date: null,
 *   last: 30,
 *   group_by: null,
 * });
 * // errors.length === 0
 * ```
 */
export function validateFunnelArgs(
  options: ValidateFunnelArgsOptions,
): ValidationError[] {
  const {
    steps,
    conversion_window,
    conversion_window_unit = "day",
    math = "conversion_rate_unique",
    math_property = null,
    exclusions,
    holding_constant = null,
    from_date,
    to_date,
    last,
    group_by,
    reentry_mode = null,
    data_group_id = null,
  } = options;
  // DG1: data_group_id must be positive if provided
  const errors: ValidationError[] = [...validateDataGroupId(data_group_id)];

  // F1: At least 2 steps required
  if (steps.length < 2) {
    errors.push(
      new ValidationError(
        "steps",
        `At least 2 steps are required (got ${String(steps.length)})`,
        "F1_MIN_STEPS",
      ),
    );
  }

  // F1b: Maximum 100 steps
  if (steps.length > MAX_FUNNEL_STEPS) {
    errors.push(
      new ValidationError(
        "steps",
        `Maximum ${String(MAX_FUNNEL_STEPS)} steps allowed ` +
          `(got ${String(steps.length)})`,
        "F1_MAX_STEPS",
      ),
    );
  }

  // F2: Each step event must be non-empty string, no control/invisible chars
  for (const [i, step] of steps.entries()) {
    const event: unknown = step instanceof FunnelStep ? step.event : step;
    if (typeof event !== "string" || pythonStrip(event) === "") {
      errors.push(
        new ValidationError(
          `steps[${String(i)}]`,
          "Step event name must be a non-empty string",
          "F2_EMPTY_STEP_EVENT",
        ),
      );
      continue;
    }
    // F2b: No control characters
    if (containsControlChars(event)) {
      errors.push(
        new ValidationError(
          `steps[${String(i)}]`,
          `Step event name contains control characters: ${pythonRepr(event)}`,
          "F2_CONTROL_CHAR_STEP_EVENT",
        ),
      );
    }
    // F2c: No invisible-only names
    if (isInvisibleOnly(event)) {
      errors.push(
        new ValidationError(
          `steps[${String(i)}]`,
          "Step event name contains only invisible characters",
          "F2_INVISIBLE_STEP_EVENT",
        ),
      );
    }
  }

  // F3: Positive integer conversion window. Caution §8: Python `bool`
  // IS `int`, so booleans must be rejected before the int check —
  // `typeof x === "number"` already excludes them in TS.
  const validWindow = isPythonInt(conversion_window);
  if (!validWindow) {
    errors.push(
      new ValidationError(
        "conversion_window",
        `conversion_window must be an integer, ` +
          `got ${pythonTypeName(conversion_window)}`,
        "F3_CONVERSION_WINDOW_TYPE",
      ),
    );
  } else if (conversion_window <= 0) {
    errors.push(
      new ValidationError(
        "conversion_window",
        "conversion_window must be a positive integer",
        "F3_CONVERSION_WINDOW_POSITIVE",
      ),
    );
  }

  // F3b: Maximum conversion window per unit (requires valid int)
  if (
    validWindow &&
    MAX_CONVERSION_WINDOW.has(conversion_window_unit) &&
    conversion_window > 0
  ) {
    const maxVal = MAX_CONVERSION_WINDOW.get(conversion_window_unit) as number;
    if (conversion_window > maxVal) {
      errors.push(
        new ValidationError(
          "conversion_window",
          `conversion_window=${pythonNumberStr(conversion_window)} ` +
            `exceeds maximum of ${String(maxVal)} for unit ` +
            `'${conversion_window_unit}'`,
          "F3_CONVERSION_WINDOW_MAX",
        ),
      );
    }
  }

  // F7: Conversion window unit validation
  if (!VALID_CONVERSION_WINDOW_UNITS.has(conversion_window_unit)) {
    errors.push(
      enumError(
        "conversion_window_unit",
        "conversion_window_unit",
        conversion_window_unit,
        VALID_CONVERSION_WINDOW_UNITS,
        "F7_INVALID_WINDOW_UNIT",
      ),
    );
  }

  if (validWindow) {
    const window = conversion_window;
    // F7b: Minimum conversion window per unit (second requires >=2)
    if (conversion_window_unit === "second" && window > 0 && window < 2) {
      errors.push(
        new ValidationError(
          "conversion_window",
          `conversion_window must be at least 2 when ` +
            `conversion_window_unit='second' (got ${pythonNumberStr(window)})`,
          "F7_SECOND_MIN_WINDOW",
          "error",
          ["2"],
        ),
      );
    }

    // F9: Session math requires session window
    if (SESSION_MATH.has(math) && conversion_window_unit !== "session") {
      errors.push(
        new ValidationError(
          "math",
          `math='${math}' requires conversion_window_unit='session'`,
          "F9_SESSION_MATH_REQUIRES_SESSION_WINDOW",
        ),
      );
    }
    if (
      conversion_window_unit === "session" &&
      !SESSION_MATH.has(math) &&
      window !== 1
    ) {
      errors.push(
        new ValidationError(
          "conversion_window",
          "conversion_window_unit='session' requires conversion_window=1",
          "F9_SESSION_WINDOW_REQUIRES_ONE",
        ),
      );
    }
  }

  // F10: Property math requires math_property
  if (MATH_REQUIRING_PROPERTY.has(math) && math_property === null) {
    errors.push(
      new ValidationError(
        "math_property",
        `math='${math}' requires a math_property ` +
          `(numeric property name to aggregate)`,
        "F10_MATH_MISSING_PROPERTY",
      ),
    );
  }

  // F11: Non-property math rejects math_property
  if (
    !MATH_REQUIRING_PROPERTY.has(math) &&
    !MATH_PROPERTY_OPTIONAL.has(math) &&
    math_property !== null
  ) {
    const valid = sortedByCodepoint([
      ...new Set([...MATH_REQUIRING_PROPERTY, ...MATH_PROPERTY_OPTIONAL]),
    ]);
    errors.push(
      new ValidationError(
        "math_property",
        `math='${math}' does not support math_property; ` +
          `valid math types for property aggregation: ${pythonListRepr(valid)}`,
        "F11_MATH_REJECTS_PROPERTY",
      ),
    );
  }

  // F4: Non-empty exclusion event names and step range validation
  if (exclusions !== null) {
    for (const [i, exclusion] of exclusions.entries()) {
      const ex = exclusion;
      if (ex.event === "" || pythonStrip(ex.event) === "") {
        errors.push(
          new ValidationError(
            `exclusions[${String(i)}]`,
            "Exclusion event name must be a non-empty string",
            "F4_EMPTY_EXCLUSION_EVENT",
          ),
        );
      } else if (containsControlChars(ex.event)) {
        // F4 control char check on exclusion events
        errors.push(
          new ValidationError(
            `exclusions[${String(i)}]`,
            `Exclusion event name contains control ` +
              `characters: ${pythonRepr(ex.event)}`,
            "F4_CONTROL_CHAR_EXCLUSION",
          ),
        );
      }
      // F4e: from_step must be non-negative
      if (ex.from_step < 0) {
        errors.push(
          new ValidationError(
            `exclusions[${String(i)}]`,
            `Exclusion from_step must be >= 0 (got ${pythonNumberStr(ex.from_step)})`,
            "F4_EXCLUSION_NEGATIVE_STEP",
          ),
        );
      }
      // F4b: to_step must be > from_step (server requires strict from < to)
      if (ex.to_step !== null && ex.to_step <= ex.from_step) {
        errors.push(
          new ValidationError(
            `exclusions[${String(i)}]`,
            `Exclusion to_step (${pythonNumberStr(ex.to_step)}) must be > ` +
              `from_step (${pythonNumberStr(ex.from_step)})`,
            "F4_EXCLUSION_STEP_ORDER",
          ),
        );
      }
      // F4c: to_step must not exceed step count
      if (ex.to_step !== null && ex.to_step >= steps.length) {
        errors.push(
          new ValidationError(
            `exclusions[${String(i)}]`,
            `Exclusion to_step (${pythonNumberStr(ex.to_step)}) exceeds ` +
              `step count (${String(steps.length)})`,
            "F4_EXCLUSION_STEP_BOUNDS",
          ),
        );
      }
      // F4d: from_step must not exceed step count
      if (ex.from_step >= steps.length) {
        errors.push(
          new ValidationError(
            `exclusions[${String(i)}]`,
            `Exclusion from_step (${pythonNumberStr(ex.from_step)}) exceeds ` +
              `step count (${String(steps.length)})`,
            "F4_EXCLUSION_STEP_BOUNDS",
          ),
        );
      }
    }
  }

  // F8: Holding constant validation
  if (holding_constant !== null) {
    // F8b: Each holding constant property must be a non-empty string
    for (const [i, hc] of holding_constant.entries()) {
      const prop: unknown = hc instanceof HoldingConstant ? hc.property : hc;
      if (typeof prop !== "string" || pythonStrip(prop) === "") {
        errors.push(
          new ValidationError(
            `holding_constant[${String(i)}]`,
            "Holding constant property name must be a non-empty string",
            "F8_EMPTY_HOLDING_CONSTANT_PROPERTY",
          ),
        );
      }
    }
  }

  if (
    holding_constant !== null &&
    holding_constant.length > MAX_HOLDING_CONSTANT
  ) {
    errors.push(
      new ValidationError(
        "holding_constant",
        `Maximum ${String(MAX_HOLDING_CONSTANT)} holding_constant ` +
          `properties allowed (got ${String(holding_constant.length)})`,
        "F8_MAX_HOLDING_CONSTANT",
      ),
    );
  }

  // F5: Time argument validation (delegated)
  // F6: GroupBy validation (delegated)
  // CP1-CP6: Custom property validation (group_by and per-step filters)
  errors.push(
    ...validateTimeArgs({ from_date, to_date, last }),
    ...validateGroupByArgs({ group_by }),
    ...scanCustomProperties({ group_by, funnel_steps: steps }),
  );

  // F12: reentry_mode validation
  if (reentry_mode !== null && !VALID_FUNNEL_REENTRY_MODES.has(reentry_mode)) {
    const suggestion = suggest(reentry_mode, VALID_FUNNEL_REENTRY_MODES);
    errors.push(
      new ValidationError(
        "reentry_mode",
        `Invalid reentry_mode '${reentry_mode}'; valid values: ${pythonListRepr(
          sortedByCodepoint([...VALID_FUNNEL_REENTRY_MODES]),
        )}`,
        "F12_INVALID_REENTRY_MODE",
        "error",
        suggestion,
      ),
    );
  }

  return errors;
}

// =============================================================================
// validate_retention_args (validation.py:1179-1477)
// =============================================================================

/** Options bag for {@link validateRetentionArgs}. */
export interface ValidateRetentionArgsOptions {
  /** Event name that defines cohort membership. */
  readonly born_event: string;
  /** Event name that defines return. */
  readonly return_event: string;
  /** Retention period unit. Default: `"week"`. */
  readonly retention_unit?: string | undefined;
  /** Retention alignment mode. Default: `"birth"`. */
  readonly alignment?: string | undefined;
  /** Custom bucket sizes, or `null` for uniform buckets. */
  readonly bucket_sizes?: readonly unknown[] | null | undefined;
  /** Retention aggregation. Default: `"retention_rate"`. */
  readonly math?: string | undefined;
  /** Display mode. Default: `"curve"`. */
  readonly mode?: string | null | undefined;
  /** Time unit for retention buckets. Default: `"day"`. */
  readonly unit?: string | null | undefined;
  /** Start date (YYYY-MM-DD) or `null`. */
  readonly from_date?: string | null | undefined;
  /** End date (YYYY-MM-DD) or `null`. */
  readonly to_date?: string | null | undefined;
  /** Number of days for a relative date range. Default: `30`. */
  readonly last?: number | undefined;
  /** Breakdown specification. */
  readonly group_by?: unknown;
  /** Retention unbounded mode, or `null`. Default: `null`. */
  readonly unbounded_mode?: string | null | undefined;
  /** Optional data group ID. Default: `null`. */
  readonly data_group_id?: unknown;
}

/**
 * Validate retention query arguments before bookmark construction
 * (Layer 1).
 *
 * Implements retention-specific rules R1-R13 (+ CB3) plus the reused
 * time and group-by validators, returning ALL errors found.
 *
 * @param options - Retention query arguments.
 * @returns List of validation errors; empty means all arguments are
 *   valid.
 * @example
 * ```typescript
 * const errors = validateRetentionArgs({
 *   born_event: "Signup",
 *   return_event: "Login",
 * });
 * // errors.length === 0
 * ```
 */
export function validateRetentionArgs(
  options: ValidateRetentionArgsOptions,
): ValidationError[] {
  const {
    born_event,
    return_event,
    retention_unit = "week",
    alignment = "birth",
    bucket_sizes = null,
    math = "retention_rate",
    mode = "curve",
    unit = "day",
    from_date = null,
    to_date = null,
    last = 30,
    group_by = null,
    unbounded_mode = null,
    data_group_id = null,
  } = options;
  // DG1: data_group_id must be positive if provided
  const errors: ValidationError[] = [...validateDataGroupId(data_group_id)];

  // R1: born_event must be non-empty string
  if (pythonStrip(born_event) === "") {
    errors.push(
      new ValidationError(
        "born_event",
        "born_event must be a non-empty string",
        "R1_EMPTY_BORN_EVENT",
      ),
    );
  } else {
    // R1b: No control characters
    if (containsControlChars(born_event)) {
      errors.push(
        new ValidationError(
          "born_event",
          `born_event contains control characters: ${pythonRepr(born_event)}`,
          "R1_CONTROL_CHAR_BORN_EVENT",
        ),
      );
    }
    // R1c: No invisible-only names
    if (isInvisibleOnly(born_event)) {
      errors.push(
        new ValidationError(
          "born_event",
          "born_event contains only invisible characters",
          "R1_INVISIBLE_BORN_EVENT",
        ),
      );
    }
  }

  // R2: return_event must be non-empty string
  if (pythonStrip(return_event) === "") {
    errors.push(
      new ValidationError(
        "return_event",
        "return_event must be a non-empty string",
        "R2_EMPTY_RETURN_EVENT",
      ),
    );
  } else {
    // R2b: No control characters
    if (containsControlChars(return_event)) {
      errors.push(
        new ValidationError(
          "return_event",
          `return_event contains control characters: ${pythonRepr(return_event)}`,
          "R2_CONTROL_CHAR_RETURN_EVENT",
        ),
      );
    }
    // R2c: No invisible-only names
    if (isInvisibleOnly(return_event)) {
      errors.push(
        new ValidationError(
          "return_event",
          "return_event contains only invisible characters",
          "R2_INVISIBLE_RETURN_EVENT",
        ),
      );
    }
  }

  // R3: Time argument validation (delegated)
  // R4: GroupBy validation (delegated)
  errors.push(
    ...validateTimeArgs({ from_date, to_date, last }),
    ...validateGroupByArgs({ group_by }),
  );

  // R5: bucket_sizes values must be positive integers
  let allValidInts = true;
  if (bucket_sizes !== null) {
    for (const [i, val] of bucket_sizes.entries()) {
      if (isPythonFloat(val)) {
        allValidInts = false;
        errors.push(
          new ValidationError(
            `bucket_sizes[${String(i)}]`,
            `bucket_sizes[${String(i)}] must be an integer, got float`,
            "R5_BUCKET_SIZES_INTEGER",
          ),
        );
      } else if (!isPythonInt(val) || typeof val === "boolean" || val <= 0) {
        allValidInts = false;
        errors.push(
          new ValidationError(
            "bucket_sizes",
            "bucket_sizes values must be positive integers",
            "R5_BUCKET_SIZES_POSITIVE",
          ),
        );
      }
    }

    // R5c: Maximum bucket count
    if (bucket_sizes.length > MAX_RETENTION_BUCKETS) {
      errors.push(
        new ValidationError(
          "bucket_sizes",
          `bucket_sizes has ${String(bucket_sizes.length)} entries, ` +
            `maximum is ${String(MAX_RETENTION_BUCKETS)}`,
          "R5_BUCKET_SIZES_TOO_MANY",
        ),
      );
    }

    // R6: bucket_sizes must be in strictly ascending order. Only
    // checked when all elements are valid positive ints, to avoid the
    // Python TypeError on comparison with non-numeric values.
    if (allValidInts && bucket_sizes.length >= 2) {
      for (let i = 1; i < bucket_sizes.length; i++) {
        if ((bucket_sizes[i] as number) <= (bucket_sizes[i - 1] as number)) {
          errors.push(
            new ValidationError(
              "bucket_sizes",
              "bucket_sizes must be in strictly ascending order",
              "R6_BUCKET_SIZES_ASCENDING",
            ),
          );
          break;
        }
      }
    }
  }

  // R7: retention_unit validation
  if (!VALID_RETENTION_UNITS.has(retention_unit)) {
    errors.push(
      enumError(
        "retention_unit",
        "retention_unit",
        retention_unit,
        VALID_RETENTION_UNITS,
        "R7_INVALID_RETENTION_UNIT",
      ),
    );
  }

  // R8: alignment validation
  if (!VALID_RETENTION_ALIGNMENT.has(alignment)) {
    errors.push(
      enumError(
        "alignment",
        "alignment",
        alignment,
        VALID_RETENTION_ALIGNMENT,
        "R8_INVALID_ALIGNMENT",
      ),
    );
  }

  // R9: math validation (public-facing subset)
  if (!VALID_RETENTION_MATH_PUBLIC.has(math)) {
    errors.push(
      enumError(
        "math",
        "math",
        math,
        VALID_RETENTION_MATH_PUBLIC,
        "R9_INVALID_MATH",
      ),
    );
  }

  // R10: mode validation
  if (mode === null || !VALID_RETENTION_MODES.has(mode)) {
    errors.push(
      enumError(
        "mode",
        "mode",
        pythonStrLoose(mode),
        VALID_RETENTION_MODES,
        "R10_INVALID_MODE",
      ),
    );
  }

  // R11: unit must be valid for retention context (day, week, month only)
  if (unit === null || !VALID_RETENTION_UNITS.has(unit)) {
    errors.push(
      enumError(
        "unit",
        "unit",
        pythonStrLoose(unit),
        VALID_RETENTION_UNITS,
        "R11_INVALID_UNIT",
      ),
    );
  }

  // R12: group_by strings must be non-empty
  // CB3: CohortBreakdown and GroupBy are mutually exclusive in retention
  if (group_by !== null && group_by !== undefined) {
    const gbList: readonly unknown[] = Array.isArray(group_by)
      ? group_by
      : [group_by];
    for (let i = 0; i < gbList.length; i++) {
      const g = gbList[i];
      if (typeof g === "string" && pythonStrip(g) === "") {
        const gpath = gbList.length > 1 ? `group_by[${String(i)}]` : "group_by";
        errors.push(
          new ValidationError(
            gpath,
            "group_by property name must be a non-empty string",
            "R12_EMPTY_GROUP_BY",
          ),
        );
      }
    }

    const hasCohort = gbList.some((g) => g instanceof CohortBreakdown);
    const hasProperty = gbList.some(
      (g) => typeof g === "string" || g instanceof GroupBy,
    );
    if (hasCohort && hasProperty) {
      errors.push(
        new ValidationError(
          "group_by",
          "query_retention does not support mixing " +
            "CohortBreakdown with property GroupBy",
          "CB3_RETENTION_MIXED_BREAKDOWN",
        ),
      );
    }
  }

  // CP1-CP6: Custom property validation
  errors.push(...scanCustomProperties({ group_by }));

  // R13: unbounded_mode validation
  if (
    unbounded_mode !== null &&
    !VALID_RETENTION_UNBOUNDED_MODES.has(unbounded_mode)
  ) {
    const suggestion = suggest(unbounded_mode, VALID_RETENTION_UNBOUNDED_MODES);
    errors.push(
      new ValidationError(
        "unbounded_mode",
        `Invalid unbounded_mode '${unbounded_mode}'; valid values: ${pythonListRepr(
          sortedByCodepoint([...VALID_RETENTION_UNBOUNDED_MODES]),
        )}`,
        "R13_INVALID_UNBOUNDED_MODE",
        "error",
        suggestion,
      ),
    );
  }

  return errors;
}

// =============================================================================
// validate_flow_args (validation.py:1498-1764)
// =============================================================================

/** Options bag for {@link validateFlowArgs}. */
export interface ValidateFlowArgsOptions {
  /** Event names that define the flow anchor points. */
  readonly steps: readonly unknown[];
  /** Steps to show after the anchor event (0-5). Default: `3`. */
  readonly forward?: number | undefined;
  /** Steps to show before the anchor event (0-5). Default: `0`. */
  readonly reverse?: number | undefined;
  /** Counting method. Default: `"unique"`. */
  readonly count_type?: string | undefined;
  /** Display mode. Default: `"sankey"`. */
  readonly mode?: string | undefined;
  /** Number of top paths to display (1-50). Default: `3`. */
  readonly cardinality?: number | undefined;
  /** Conversion window size. Default: `7`. */
  readonly conversion_window?: number | undefined;
  /** Time unit for the conversion window. Default: `"day"`. */
  readonly conversion_window_unit?: string | undefined;
  /** Start date (YYYY-MM-DD) or `null`. */
  readonly from_date?: string | null | undefined;
  /** End date (YYYY-MM-DD) or `null`. */
  readonly to_date?: string | null | undefined;
  /** Number of days for a relative date range. Default: `30`. */
  readonly last?: number | undefined;
  /** Time comparison object — must be `null` for flows. */
  readonly time_comparison?: unknown;
  /** Optional data group ID. Default: `null`. */
  readonly data_group_id?: unknown;
}

/**
 * Validate flow query arguments before bookmark construction (Layer 1).
 *
 * Implements FL1-FL10, DG1, the time-comparison rejection, and the
 * flow enum checks, returning ALL errors found.
 *
 * @param options - Flow query arguments.
 * @returns List of validation errors; empty means all arguments are
 *   valid.
 * @example
 * ```typescript
 * const errors = validateFlowArgs({
 *   steps: ["Purchase"],
 *   forward: 3,
 *   reverse: 0,
 * });
 * // errors.length === 0
 * ```
 */
export function validateFlowArgs(
  options: ValidateFlowArgsOptions,
): ValidationError[] {
  const {
    steps,
    forward = 3,
    reverse = 0,
    count_type = "unique",
    mode = "sankey",
    cardinality = 3,
    conversion_window = 7,
    conversion_window_unit = "day",
    from_date = null,
    to_date = null,
    last = 30,
    time_comparison = null,
    data_group_id = null,
  } = options;
  // DG1: data_group_id must be positive if provided
  const errors: ValidationError[] = [...validateDataGroupId(data_group_id)];

  // Flows do not support time comparison
  if (time_comparison !== null && time_comparison !== undefined) {
    errors.push(
      new ValidationError(
        "time_comparison",
        "Flows do not support time comparison; " +
          "remove the time_comparison parameter",
        "FL_TIME_COMPARISON_NOT_SUPPORTED",
      ),
    );
  }

  // FL1: steps must be non-empty
  if (steps.length === 0) {
    errors.push(
      new ValidationError(
        "steps",
        "At least one step event is required",
        "FL1_EMPTY_STEPS",
      ),
    );
  }

  // FL2: Each step event must be non-empty string, no control/invisible chars
  for (const [i, event] of steps.entries()) {
    if (typeof event !== "string" || pythonStrip(event) === "") {
      errors.push(
        new ValidationError(
          `steps[${String(i)}]`,
          "Step event name must be a non-empty string",
          "FL2_EMPTY_STEP_EVENT",
        ),
      );
      continue;
    }
    // FL2b: No control characters
    if (containsControlChars(event)) {
      errors.push(
        new ValidationError(
          `steps[${String(i)}]`,
          `Step event name contains control characters: ${pythonRepr(event)}`,
          "FL2_CONTROL_CHAR_STEP_EVENT",
        ),
      );
    }
    // FL2c: No invisible-only names
    if (isInvisibleOnly(event)) {
      errors.push(
        new ValidationError(
          `steps[${String(i)}]`,
          "Step event name contains only invisible characters",
          "FL2_INVISIBLE_STEP_EVENT",
        ),
      );
    }
  }

  // FL3: forward must be in range 0-5
  if (forward < 0 || forward > MAX_FLOW_STEPS_DIRECTION) {
    errors.push(
      new ValidationError(
        "forward",
        `forward must be between 0 and ${String(MAX_FLOW_STEPS_DIRECTION)} ` +
          `(got ${pythonNumberStr(forward)})`,
        "FL3_FORWARD_RANGE",
      ),
    );
  }

  // FL4: reverse must be in range 0-5
  if (reverse < 0 || reverse > MAX_FLOW_STEPS_DIRECTION) {
    errors.push(
      new ValidationError(
        "reverse",
        `reverse must be between 0 and ${String(MAX_FLOW_STEPS_DIRECTION)} ` +
          `(got ${pythonNumberStr(reverse)})`,
        "FL4_REVERSE_RANGE",
      ),
    );
  }

  // FL5: forward + reverse must be > 0 (at least one direction)
  if (forward + reverse === 0) {
    errors.push(
      new ValidationError(
        "forward",
        "At least one of forward or reverse must be > 0; " +
          "both are currently 0",
        "FL5_NO_DIRECTION",
      ),
    );
  }

  // FL6: cardinality must be in range 1-50
  if (cardinality < 1 || cardinality > MAX_FLOW_CARDINALITY) {
    errors.push(
      new ValidationError(
        "cardinality",
        `cardinality must be between 1 and ${String(MAX_FLOW_CARDINALITY)} ` +
          `(got ${pythonNumberStr(cardinality)})`,
        "FL6_CARDINALITY_RANGE",
      ),
    );
  }

  // FL7: conversion_window must be positive
  if (conversion_window <= 0) {
    errors.push(
      new ValidationError(
        "conversion_window",
        "conversion_window must be a positive integer",
        "FL7_CONVERSION_WINDOW_POSITIVE",
      ),
    );
  }

  // FL7b: conversion_window max per unit (366-day equivalent)
  if (
    conversion_window > 0 &&
    FLOW_MAX_WINDOW.has(conversion_window_unit) &&
    conversion_window > (FLOW_MAX_WINDOW.get(conversion_window_unit) as number)
  ) {
    const maxVal = FLOW_MAX_WINDOW.get(conversion_window_unit) as number;
    errors.push(
      new ValidationError(
        "conversion_window",
        `conversion_window=${pythonNumberStr(conversion_window)} exceeds ` +
          `maximum of ${String(maxVal)} for unit '${conversion_window_unit}'`,
        "FL7_CONVERSION_WINDOW_MAX",
      ),
    );
  }

  // Enum: count_type validation
  if (!VALID_FLOWS_COUNT_TYPES.has(count_type)) {
    errors.push(
      enumError(
        "count_type",
        "count_type",
        count_type,
        VALID_FLOWS_COUNT_TYPES,
        "FL_INVALID_COUNT_TYPE",
      ),
    );
  }

  // Enum: mode validation
  if (!VALID_FLOWS_MODES.has(mode)) {
    errors.push(
      enumError("mode", "mode", mode, VALID_FLOWS_MODES, "FL_INVALID_MODE"),
    );
  }

  // Enum: conversion_window_unit validation
  if (!VALID_FLOWS_CONVERSION_WINDOW_UNITS.has(conversion_window_unit)) {
    errors.push(
      enumError(
        "conversion_window_unit",
        "conversion_window_unit",
        conversion_window_unit,
        VALID_FLOWS_CONVERSION_WINDOW_UNITS,
        "FL_INVALID_WINDOW_UNIT",
      ),
    );
  }

  // FL9: count_type='session' requires conversion_window_unit='session'
  if (count_type === "session" && conversion_window_unit !== "session") {
    errors.push(
      new ValidationError(
        "count_type",
        "count_type='session' requires conversion_window_unit='session'",
        "FL9_SESSION_REQUIRES_SESSION_WINDOW",
      ),
    );
  }

  // FL10: conversion_window_unit='session' requires conversion_window=1
  if (conversion_window_unit === "session" && conversion_window !== 1) {
    errors.push(
      new ValidationError(
        "conversion_window",
        "conversion_window_unit='session' requires conversion_window=1",
        "FL10_SESSION_WINDOW_REQUIRES_ONE",
      ),
    );
  }

  // FL8: Time argument validation (delegated)
  errors.push(...validateTimeArgs({ from_date, to_date, last }));

  return errors;
}

// =============================================================================
// validate_query_args (validation.py:1885-2280)
// =============================================================================

/** Options bag for {@link validateQueryArgs}. */
export interface ValidateQueryArgsOptions {
  /** Event names, `Metric`s or `CohortMetric`s. */
  readonly events: readonly unknown[];
  /** Top-level aggregation function. */
  readonly math: string;
  /** Property for property-based math. */
  readonly math_property: string | null;
  /** Per-user pre-aggregation. */
  readonly per_user: string | null;
  /** Custom percentile value. Default: `null`. */
  readonly percentile_value?: number | null | undefined;
  /** Start date (YYYY-MM-DD) or `null`. */
  readonly from_date: string | null;
  /** End date (YYYY-MM-DD) or `null`. */
  readonly to_date: string | null;
  /** Number of days for a relative date range. */
  readonly last: number;
  /** Whether any formula is present. */
  readonly has_formula: boolean;
  /** Rolling window size, or `null`. */
  readonly rolling: number | null;
  /** Cumulative analysis mode. */
  readonly cumulative: boolean;
  /** Breakdown specification. */
  readonly group_by: unknown;
  /** Resolved `Formula` objects (for expression validation). */
  readonly formulas?: readonly unknown[] | null | undefined;
  /** Optional data group ID. Default: `null`. */
  readonly data_group_id?: unknown;
}

/**
 * Validate query arguments before bookmark construction (Layer 1).
 *
 * Implements V0-V27 (plus CM5 and DG1), delegating time (V7-V10, V15,
 * V20) and group-by (V11-V12, V18, V24) to the extracted helpers.
 * Returns ALL errors found, not just the first.
 *
 * @param options - Insights query arguments.
 * @returns List of validation errors; empty means all arguments are
 *   valid.
 * @example
 * ```typescript
 * const errors = validateQueryArgs({
 *   events: ["Login"],
 *   math: "total",
 *   math_property: null,
 *   per_user: null,
 *   from_date: null,
 *   to_date: null,
 *   last: 30,
 *   has_formula: false,
 *   rolling: null,
 *   cumulative: false,
 *   group_by: null,
 * });
 * // errors.length === 0
 * ```
 */
export function validateQueryArgs(
  options: ValidateQueryArgsOptions,
): ValidationError[] {
  const {
    events,
    math,
    math_property,
    per_user,
    percentile_value = null,
    from_date,
    to_date,
    last,
    has_formula,
    rolling,
    cumulative,
    group_by,
    formulas = null,
    data_group_id = null,
  } = options;
  // DG1: data_group_id must be positive if provided
  const errors: ValidationError[] = [...validateDataGroupId(data_group_id)];

  // V0: At least one event required
  if (events.length === 0) {
    errors.push(
      new ValidationError(
        "events",
        "At least one event is required",
        "V0_NO_EVENTS",
      ),
    );
  }

  // V17/V21/V22: Event validation — type, empty, control chars, invisible
  for (const [idx, item] of events.entries()) {
    const epath = `events[${String(idx)}]`;

    // V21: Type guard — must be str, Metric, or CohortMetric
    if (
      typeof item !== "string" &&
      !(item instanceof Metric) &&
      !(item instanceof CohortMetric)
    ) {
      errors.push(
        new ValidationError(
          epath,
          `Event must be a string, Metric, or CohortMetric, ` +
            `got ${pythonTypeName(item)}`,
          "V21_INVALID_EVENT_TYPE",
        ),
      );
      continue;
    }

    // CohortMetric: validate cohort type, then skip event-name validation.
    // CM5 is unreachable through the TS port's CohortMetric constructor
    // (which raises CM5_INLINE_COHORT_METRIC itself, metric.ts) exactly
    // as it is unreachable in Python — the branch is ported for
    // completeness because callers may hold pre-existing instances.
    if (item instanceof CohortMetric) {
      // B2 arbiter fix F3: spelled `instanceof CohortDefinition`, the
      // literal twin of Python's isinstance — a bool or float-carrier
      // cohort (ctor-constructible in BOTH languages) must NOT fire CM5.
      if (item.cohort instanceof CohortDefinition) {
        errors.push(
          new ValidationError(
            epath,
            "CohortMetric does not support inline CohortDefinition " +
              "(server returns 500). Use a saved cohort ID instead.",
            "CM5_INLINE_COHORT_METRIC",
          ),
        );
      }
      continue;
    }

    const name = item instanceof Metric ? item.event : item;

    // V17: Non-empty after stripping whitespace
    if (pythonStrip(name) === "") {
      errors.push(
        new ValidationError(
          epath,
          "Event name must be a non-empty string",
          "V17_EMPTY_EVENT",
        ),
      );
      continue;
    }

    // V22a: No control characters (null bytes, etc.)
    if (containsControlChars(name)) {
      errors.push(
        new ValidationError(
          epath,
          `Event name contains control characters ` +
            `(e.g. null bytes): ${pythonRepr(name)}`,
          "V22_CONTROL_CHAR_EVENT",
        ),
      );
    }

    // V22b: No invisible-only names (zero-width spaces, etc.)
    if (isInvisibleOnly(name)) {
      errors.push(
        new ValidationError(
          epath,
          "Event name contains only invisible characters",
          "V22_INVISIBLE_EVENT",
        ),
      );
    }
  }

  // CM3/FR-020: Top-level math/math_property/per_user only apply to plain
  // string events. When all events are CohortMetric (or Metric, which
  // carries its own math), there are no consumers — skip V1/V2/V3/V26/V27.
  const hasPlainEvents = events.some((item) => typeof item === "string");

  // V1: Property math requires property
  if (
    hasPlainEvents &&
    MATH_REQUIRING_PROPERTY.has(math) &&
    math_property === null
  ) {
    errors.push(
      new ValidationError(
        "math",
        `math='${math}' requires math_property to be set`,
        "V1_MATH_REQUIRES_PROPERTY",
      ),
    );
  }

  // V2: Non-property math rejects property
  if (
    hasPlainEvents &&
    !MATH_REQUIRING_PROPERTY.has(math) &&
    !MATH_PROPERTY_OPTIONAL.has(math) &&
    math_property !== null
  ) {
    const valid = sortedByCodepoint([
      ...new Set([...MATH_REQUIRING_PROPERTY, ...MATH_PROPERTY_OPTIONAL]),
    ]);
    errors.push(
      new ValidationError(
        "math_property",
        `math_property is only valid with property-based math types ` +
          `(${valid.join(", ")}), not '${math}'`,
        "V2_MATH_REJECTS_PROPERTY",
      ),
    );
  }

  // V26: percentile math requires percentile_value
  if (hasPlainEvents && math === "percentile" && percentile_value === null) {
    errors.push(
      new ValidationError(
        "percentile_value",
        "math='percentile' requires percentile_value to be set",
        "V26_PERCENTILE_REQUIRES_VALUE",
      ),
    );
  }

  // V27: histogram math requires per_user
  if (hasPlainEvents && math === "histogram" && per_user === null) {
    errors.push(
      new ValidationError(
        "per_user",
        "math='histogram' requires per_user to be set " +
          "(e.g. per_user='total')",
        "V27_HISTOGRAM_REQUIRES_PER_USER",
      ),
    );
  }

  // V3: per_user incompatible with DAU/WAU/MAU/unique
  if (hasPlainEvents && per_user !== null && MATH_NO_PER_USER.has(math)) {
    errors.push(
      new ValidationError(
        "per_user",
        `per_user is incompatible with math='${math}'`,
        "V3_PER_USER_INCOMPATIBLE",
      ),
    );
  }

  // V3b: per_user requires a property
  if (hasPlainEvents && per_user !== null && math_property === null) {
    errors.push(
      new ValidationError(
        "per_user",
        "per_user requires math_property to be set",
        "V3B_PER_USER_REQUIRES_PROPERTY",
      ),
    );
  }

  // V4: Formula requires 2+ events
  if (has_formula && events.length < 2) {
    errors.push(
      new ValidationError(
        "formula",
        `formula requires at least 2 events (got ${String(events.length)})`,
        "V4_FORMULA_MIN_EVENTS",
      ),
    );
  }

  // V16/V19: Formula expression validation
  const resolved: readonly unknown[] = formulas ?? [];
  for (let fi = 0; fi < resolved.length; fi++) {
    const f = resolved[fi];
    if (f instanceof Formula) {
      const expr = f.expression;
      const fpath = resolved.length > 1 ? `formula[${String(fi)}]` : "formula";

      // V16: Formula must contain at least one position letter
      const positions = new Set(expr.match(FORMULA_POSITION_RE));
      if (positions.size === 0) {
        errors.push(
          new ValidationError(
            fpath,
            `Formula '${expr}' must reference at least one ` +
              `event position (A, B, C, ...)`,
            "V16_FORMULA_SYNTAX",
          ),
        );
      }

      // V19: Position letters must not exceed event count
      if (positions.size > 0 && events.length > 0) {
        const maxLetter = String.fromCodePoint(0x41 + events.length - 1);
        const outOfBounds = [...positions].filter((p) =>
          codepointGreater(p, maxLetter),
        );
        if (outOfBounds.length > 0) {
          errors.push(
            new ValidationError(
              fpath,
              `Formula references position(s) ` +
                `${pythonListRepr(sortedByCodepoint(outOfBounds))} but only ` +
                `${String(events.length)} event(s) defined (A-${maxLetter})`,
              "V19_FORMULA_BOUNDS",
            ),
          );
        }
      }
    }
  }

  // V5: Rolling and cumulative are mutually exclusive
  if (rolling !== null && cumulative) {
    errors.push(
      new ValidationError(
        "rolling",
        "rolling and cumulative are mutually exclusive",
        "V5_ROLLING_CUMULATIVE_EXCLUSIVE",
      ),
    );
  }

  // V6: Rolling must be positive
  if (rolling !== null && rolling <= 0) {
    errors.push(
      new ValidationError(
        "rolling",
        "rolling must be a positive integer",
        "V6_ROLLING_POSITIVE",
      ),
    );
  }

  // V23: Rolling window sanity cap
  if (rolling !== null && rolling > MAX_ROLLING) {
    errors.push(
      new ValidationError(
        "rolling",
        `rolling=${pythonNumberStr(rolling)} exceeds maximum of ` +
          `${String(MAX_ROLLING)} periods`,
        "V23_ROLLING_TOO_LARGE",
      ),
    );
  }

  // V7-V10, V15, V20: Time argument validation (delegated)
  // V11-V12, V18, V24: GroupBy validation (delegated)
  // CP1-CP6: Custom property validation
  errors.push(
    ...validateTimeArgs({ from_date, to_date, last }),
    ...validateGroupByArgs({ group_by }),
    ...scanCustomProperties({ group_by, where: null, events }),
  );

  // V13-V14: Per-Metric validation
  for (const [idx, item] of events.entries()) {
    if (!(item instanceof Metric)) {
      continue;
    }

    const mpath = `events[${String(idx)}]`;
    const mMath = item.math;
    const mProp = item.property;
    const mPerUser = item.per_user;

    if (MATH_REQUIRING_PROPERTY.has(mMath) && mProp === null) {
      errors.push(
        new ValidationError(
          mpath,
          `Metric('${item.event}'): math='${mMath}' ` +
            `requires property to be set`,
          "V13_METRIC_MATH_PROPERTY",
        ),
      );
    }

    if (
      !MATH_REQUIRING_PROPERTY.has(mMath) &&
      !MATH_PROPERTY_OPTIONAL.has(mMath) &&
      mProp !== null
    ) {
      const valid = sortedByCodepoint([
        ...new Set([...MATH_REQUIRING_PROPERTY, ...MATH_PROPERTY_OPTIONAL]),
      ]);
      errors.push(
        new ValidationError(
          mpath,
          `Metric('${item.event}'): property is only valid with ` +
            `property-based math types ` +
            `(${valid.join(", ")}), not '${mMath}'`,
          "V14_METRIC_REJECTS_PROPERTY",
        ),
      );
    }

    // V27: Per-Metric histogram requires per_user
    if (mMath === "histogram" && mPerUser === null) {
      errors.push(
        new ValidationError(
          mpath,
          `Metric('${item.event}'): math='histogram' ` +
            `requires per_user to be set ` +
            `(e.g. per_user='total')`,
          "V27_HISTOGRAM_REQUIRES_PER_USER",
        ),
      );
    }

    // V26: Per-Metric percentile requires percentile_value
    if (mMath === "percentile" && item.percentile_value === null) {
      errors.push(
        new ValidationError(
          mpath,
          `Metric('${item.event}'): math='percentile' ` +
            `requires percentile_value to be set`,
          "V26_PERCENTILE_REQUIRES_VALUE",
        ),
      );
    }

    if (mPerUser !== null && MATH_NO_PER_USER.has(mMath)) {
      errors.push(
        new ValidationError(
          mpath,
          `Metric('${item.event}'): per_user is incompatible ` +
            `with math='${mMath}'`,
          "V3_PER_USER_INCOMPATIBLE",
        ),
      );
    }

    if (mPerUser !== null && mProp === null) {
      errors.push(
        new ValidationError(
          mpath,
          `Metric('${item.event}'): per_user requires property to be set`,
          "V3B_PER_USER_REQUIRES_PROPERTY",
        ),
      );
    }
  }

  return errors;
}
