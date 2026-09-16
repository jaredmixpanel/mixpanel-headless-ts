/**
 * Funnel step specifications: `FunnelStep` (a step with per-step filters,
 * label and ordering), `Exclusion` (an event that disqualifies users
 * between steps) and `HoldingConstant` (a property that must not change
 * across steps). Constructor guards fire in the Python `__post_init__`
 * order, one comment per rule code.
 *
 * @see mixpanel_headless.types.FunnelStep
 */

import { pythonStrip } from "../../compat/index.js";
import { ParamValidationError } from "../../errors.js";
import type { FiltersCombinator, FunnelOrder } from "../literals.js";
import type { Filter } from "./filter.js";
import { validateEventName } from "./guards.js";

/** Declared constructor fields of {@link FunnelStep} (Python field order). */
export interface FunnelStepFields {
  /** Mixpanel event name for this funnel step. */
  readonly event: string;
  /**
   * Display label for this step.
   *
   * @defaultValue `null` (event name)
   */
  readonly label?: string | null;
  /**
   * Per-step filter conditions.
   *
   * @defaultValue `null`
   */
  readonly filters?: readonly Filter[] | null;
  /**
   * How per-step filters combine.
   *
   * @defaultValue `"all"`
   */
  readonly filters_combinator?: FiltersCombinator;
  /**
   * Per-step ordering override.
   *
   * @defaultValue `null`
   */
  readonly order?: FunnelOrder | null;
}

/**
 * A single step in a funnel query.
 *
 * Pass plain event-name strings for simple funnels and `FunnelStep`
 * objects when a step needs its own filters, label or ordering override.
 *
 * @example
 * ```ts
 * const paid = new FunnelStep({
 *   event: "Purchase",
 *   label: "Paid",
 *   filters: [Filter.greaterThan("amount", 0)],
 * });
 * ```
 * @see mixpanel_headless.types.FunnelStep
 */
export class FunnelStep {
  /** Mixpanel event name for this funnel step. */
  readonly event: string;

  /** Display label for this step (defaults to event name). */
  readonly label: string | null;

  /** Per-step filter conditions. */
  readonly filters: readonly Filter[] | null;

  /** How per-step filters combine (AND/OR). */
  readonly filters_combinator: FiltersCombinator;

  /**
   * Per-step ordering override (only meaningful with top-level
   * `order="any"`).
   */
  readonly order: FunnelOrder | null;

  /**
   * Create a funnel step; the guards fire in Python `__post_init__` order.
   *
   * @param fields - Declared fields; absent optionals take the Python
   *   defaults.
   * @throws {@link ParamValidationError} - `EV1_EMPTY_EVENT` when the event
   *   name is blank, `EV2_CONTROL_CHAR_EVENT` when it contains control
   *   characters.
   */
  constructor(fields: FunnelStepFields) {
    this.event = fields.event;
    this.label = fields.label ?? null;
    this.filters = fields.filters ?? null;
    this.filters_combinator = fields.filters_combinator ?? "all";
    this.order = fields.order ?? null;
    // EV1_EMPTY_EVENT / EV2_CONTROL_CHAR_EVENT: shared event-name guard.
    validateEventName(this.event, "FunnelStep");
  }
}

/** Declared constructor fields of {@link Exclusion} (Python field order). */
export interface ExclusionFields {
  /** Event name to exclude between steps. */
  readonly event: string;
  /**
   * Start of exclusion range (0-indexed, inclusive).
   *
   * @defaultValue `0`
   */
  readonly from_step?: number;
  /**
   * End of exclusion range (0-indexed, inclusive).
   *
   * @defaultValue `null`
   */
  readonly to_step?: number | null;
}

/**
 * An event that disqualifies users from a funnel when performed between
 * two steps.
 *
 * Users who perform the excluded event within the step range are removed
 * from the funnel.
 *
 * @example
 * ```ts
 * // Drop anyone who canceled between the first and third step.
 * const noCancel = new Exclusion({ event: "Cancel", from_step: 0, to_step: 2 });
 * ```
 * @see mixpanel_headless.types.Exclusion
 */
export class Exclusion {
  /** Event name to exclude between steps. */
  readonly event: string;

  /** Start of exclusion range (0-indexed, inclusive). */
  readonly from_step: number;

  /** End of exclusion range (0-indexed, inclusive). `null` = last step. */
  readonly to_step: number | null;

  /**
   * Create an exclusion; the guards fire in Python `__post_init__` order.
   *
   * @param fields - Declared fields; absent optionals take the Python
   *   defaults.
   * @throws {@link ParamValidationError} - `EV1_EMPTY_EVENT` /
   *   `EV2_CONTROL_CHAR_EVENT` (shared event-name guard), then
   *   `EX1_FROM_STEP_NEGATIVE` when `from_step < 0`, then
   *   `EX2_STEP_ORDER` when `to_step < from_step` (source order).
   */
  constructor(fields: ExclusionFields) {
    this.event = fields.event;
    this.from_step = fields.from_step ?? 0;
    this.to_step = fields.to_step ?? null;
    // EV1_EMPTY_EVENT / EV2_CONTROL_CHAR_EVENT: shared event-name guard.
    validateEventName(this.event, "Exclusion");
    // EX1_FROM_STEP_NEGATIVE: from_step must be >= 0.
    if (this.from_step < 0) {
      throw new ParamValidationError(
        `Exclusion.from_step must be >= 0, got ${String(this.from_step)}`,
        "EX1_FROM_STEP_NEGATIVE",
      );
    }
    // EX2_STEP_ORDER: to_step must be >= from_step when set.
    if (this.to_step !== null && this.to_step < this.from_step) {
      throw new ParamValidationError(
        `Exclusion.to_step (${String(this.to_step)}) must be >= ` +
          `from_step (${String(this.from_step)})`,
        "EX2_STEP_ORDER",
      );
    }
  }
}

/**
 * Declared constructor fields of {@link HoldingConstant} (Python field
 * order).
 */
export interface HoldingConstantFields {
  /** Property name to hold constant across steps. */
  readonly property: string;
  /**
   * Event vs user-profile property.
   *
   * @defaultValue `"events"`
   */
  readonly resource_type?: "events" | "people";
}

/**
 * A property whose value must be the same at every funnel step for a
 * user to count as converting.
 *
 * @example
 * ```ts
 * const sameDevice = new HoldingConstant({ property: "$device_id" });
 * const samePlan = new HoldingConstant({ property: "plan", resource_type: "people" });
 * ```
 * @see mixpanel_headless.types.HoldingConstant
 */
export class HoldingConstant {
  /** Property name to hold constant across steps. */
  readonly property: string;

  /** Whether this is an event property or user-profile property. */
  readonly resource_type: "events" | "people";

  /**
   * Create a holding constant; the guard fires in Python `__post_init__`
   * order.
   *
   * @param fields - Declared fields; `resource_type` defaults to
   *   `"events"`.
   * @throws {@link ParamValidationError} - `HC1_EMPTY_PROPERTY` when the
   *   property is empty/blank.
   */
  constructor(fields: HoldingConstantFields) {
    this.property = fields.property;
    this.resource_type = fields.resource_type ?? "events";
    // HC1_EMPTY_PROPERTY: property must be a non-empty string.
    if (!this.property || !pythonStrip(this.property)) {
      throw new ParamValidationError(
        "HoldingConstant.property must be a non-empty string",
        "HC1_EMPTY_PROPERTY",
      );
    }
  }
}
