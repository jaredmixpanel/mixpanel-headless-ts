/**
 * `FlowStep`: an anchor event in a flow query with its per-step
 * configuration. Constructor guards fire in the Python `__post_init__`
 * order, one comment per rule code.
 *
 * @see mixpanel_headless.types.FlowStep
 */

import { ParamValidationError } from "../../errors.js";
import type { FiltersCombinator, FlowSessionEvent } from "../literals.js";
import type { Filter } from "./filter.js";
import { validateEventName } from "./guards.js";

/** Declared constructor fields of {@link FlowStep} (Python field order). */
export interface FlowStepFields {
  /** The event name to anchor this step on. */
  readonly event: string;
  /**
   * Max forward steps to trace from this event.
   *
   * @defaultValue `null`
   */
  readonly forward?: number | null;
  /**
   * Max reverse steps to trace from this event.
   *
   * @defaultValue `null`
   */
  readonly reverse?: number | null;
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
   * Session anchor type (`"start"`/`"end"`).
   *
   * @defaultValue `null`
   */
  readonly session_event?: FlowSessionEvent | null;
}

/**
 * An anchor event in a flow query with its per-step configuration.
 *
 * Each step names an event and optional constraints (forward/reverse
 * step counts, filters, a session anchor) that define one node of the
 * flow analysis.
 *
 * @example
 * ```ts
 * const step = new FlowStep({ event: "Signup", forward: 3, reverse: 1 });
 * const start = new FlowStep({ event: "$session_start", session_event: "start" });
 * ```
 * @see mixpanel_headless.types.FlowStep
 */
export class FlowStep {
  /** The event name to anchor this step on. */
  readonly event: string;

  /** Maximum number of forward steps to trace from this event. */
  readonly forward: number | null;

  /** Maximum number of reverse steps to trace from this event. */
  readonly reverse: number | null;

  /** Display label for this step (defaults to event name). */
  readonly label: string | null;

  /** Per-step filter conditions. */
  readonly filters: readonly Filter[] | null;

  /** How per-step filters combine (AND/OR). */
  readonly filters_combinator: FiltersCombinator;

  /**
   * Session anchor type — when set, `event` must be the matching
   * session event name (`"$session_start"` / `"$session_end"`).
   */
  readonly session_event: FlowSessionEvent | null;

  /**
   * Create a flow step; the guards fire in Python `__post_init__` order.
   *
   * @param fields - Declared fields; absent optionals take the Python
   *   defaults.
   * @throws {@link ParamValidationError} - `EV1_EMPTY_EVENT` /
   *   `EV2_CONTROL_CHAR_EVENT` (shared event-name guard), then
   *   `FL3_FORWARD_RANGE` / `FL4_REVERSE_RANGE` when forward/reverse
   *   is outside 0-5, then `FS1_SESSION_EVENT_MISMATCH` when
   *   `session_event` conflicts with the event name (source order).
   */
  constructor(fields: FlowStepFields) {
    this.event = fields.event;
    this.forward = fields.forward ?? null;
    this.reverse = fields.reverse ?? null;
    this.label = fields.label ?? null;
    this.filters = fields.filters ?? null;
    this.filters_combinator = fields.filters_combinator ?? "all";
    this.session_event = fields.session_event ?? null;
    // EV1_EMPTY_EVENT / EV2_CONTROL_CHAR_EVENT: shared event-name guard.
    validateEventName(this.event, "FlowStep");
    // FL3_FORWARD_RANGE: forward must be in 0-5 when set.
    if (this.forward !== null && !(this.forward >= 0 && this.forward <= 5)) {
      throw new ParamValidationError(
        `FlowStep.forward must be in range 0-5, got ${String(this.forward)}`,
        "FL3_FORWARD_RANGE",
      );
    }
    // FL4_REVERSE_RANGE: reverse must be in 0-5 when set.
    if (this.reverse !== null && !(this.reverse >= 0 && this.reverse <= 5)) {
      throw new ParamValidationError(
        `FlowStep.reverse must be in range 0-5, got ${String(this.reverse)}`,
        "FL4_REVERSE_RANGE",
      );
    }
    // FS1_SESSION_EVENT_MISMATCH: session_event / event consistency.
    if (this.session_event !== null) {
      const expectedEvent =
        this.session_event === "start" ? "$session_start" : "$session_end";
      if (this.event !== expectedEvent) {
        throw new ParamValidationError(
          `FlowStep.session_event=${JSON.stringify(this.session_event)} ` +
            `requires event=${JSON.stringify(expectedEvent)}, ` +
            `got ${JSON.stringify(this.event)}`,
          "FS1_SESSION_EVENT_MISMATCH",
        );
      }
    }
  }
}
