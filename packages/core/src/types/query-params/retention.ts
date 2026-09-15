/**
 * Retention query-param types — TS port of the corresponding frozen
 * dataclass in `mixpanel_headless/types.py` (phase2-design C7, packet
 * P2-5c): `RetentionEvent`.
 *
 * Guard blocks are transcribed from the Python `__post_init__` body IN
 * SOURCE ORDER (Risk #1), one comment per registry code.
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
  /** Per-event filter conditions. Default: `null`. */
  readonly filters?: readonly Filter[] | null;
  /** How per-event filters combine. Default: `"all"`. */
  readonly filters_combinator?: FiltersCombinator;
}

/**
 * An event specification for retention queries — TS port of
 * `types.RetentionEvent`.
 *
 * Wraps an event name with optional per-event filters. Use plain
 * event-name strings for simple retention queries; use
 * `RetentionEvent` objects when you need per-event filter conditions.
 */
export class RetentionEvent {
  /** Mixpanel event name. */
  readonly event: string;

  /** Per-event filter conditions. */
  readonly filters: readonly Filter[] | null;

  /** How per-event filters combine (AND/OR). */
  readonly filters_combinator: FiltersCombinator;

  /**
   * Create a retention event (guards fire exactly as Python's
   * `__post_init__`).
   *
   * @param fields - Declared fields; absent optionals take the Python
   *   defaults.
   * @throws ParamValidationError - `EV1_EMPTY_EVENT` /
   *   `EV2_CONTROL_CHAR_EVENT` via the shared event-name guard.
   */
  constructor(fields: RetentionEventFields) {
    this.event = fields.event;
    this.filters = fields.filters ?? null;
    this.filters_combinator = fields.filters_combinator ?? "all";
    // EV1_EMPTY_EVENT / EV2_CONTROL_CHAR_EVENT: shared event-name guard.
    validateEventName(this.event, "RetentionEvent");
  }
}
