/**
 * `RetentionEvent`: an event specification with optional per-event filters
 * for retention queries. Constructor guards fire in the Python
 * `__post_init__` order, one comment per rule code.
 *
 * @see mixpanel_headless.types.RetentionEvent
 */

import type { FiltersCombinator } from "../literals.js";
import type { Filter } from "./filter.js";
import { validateEventName } from "./guards.js";

/**
 * Declared constructor fields of {@link RetentionEvent} (Python field
 * order).
 */
export interface RetentionEventFields {
  /** Mixpanel event name. */
  readonly event: string;
  /**
   * Per-event filter conditions.
   *
   * @defaultValue `null`
   */
  readonly filters?: readonly Filter[] | null;
  /**
   * How per-event filters combine.
   *
   * @defaultValue `"all"`
   */
  readonly filters_combinator?: FiltersCombinator;
}

/**
 * An event specification for retention queries: an event name with
 * optional per-event filter conditions.
 *
 * Pass plain event-name strings for simple retention queries and
 * `RetentionEvent` objects when an event needs its own filters.
 *
 * @example
 * ```ts
 * const returned = new RetentionEvent({
 *   event: "Purchase",
 *   filters: [Filter.equals("plan", "pro")],
 * });
 * // returned.filters_combinator === "all"
 * ```
 * @see mixpanel_headless.types.RetentionEvent
 */
export class RetentionEvent {
  /** Mixpanel event name. */
  readonly event: string;

  /** Per-event filter conditions. */
  readonly filters: readonly Filter[] | null;

  /** How per-event filters combine (AND/OR). */
  readonly filters_combinator: FiltersCombinator;

  /**
   * Create a retention event; the guards fire in Python `__post_init__`
   * order.
   *
   * @param fields - Declared fields; absent optionals take the Python
   *   defaults.
   * @throws {@link ParamValidationError} - `EV1_EMPTY_EVENT` when the event
   *   name is blank, `EV2_CONTROL_CHAR_EVENT` when it contains control
   *   characters.
   */
  constructor(fields: RetentionEventFields) {
    this.event = fields.event;
    this.filters = fields.filters ?? null;
    this.filters_combinator = fields.filters_combinator ?? "all";
    // EV1_EMPTY_EVENT / EV2_CONTROL_CHAR_EVENT: shared event-name guard.
    validateEventName(this.event, "RetentionEvent");
  }
}
