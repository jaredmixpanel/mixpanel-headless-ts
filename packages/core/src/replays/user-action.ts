/**
 * `UserAction` — one normalized user action extracted from a session
 * replay — and the closed action-label union the rrweb analyzer emits.
 *
 * This is the shared leaf of the replay family: the analyzer constructs
 * actions, the label functions and bundle aggregations read them, and
 * the result classes carry them. Keeping it below all of those lets the
 * family import in one direction only.
 *
 * @see mixpanel_headless.types.UserAction
 */

import { ParamValidationError } from "../errors.js";
import {
  decodeFail,
  expectInt,
  expectPayload,
  expectRecord,
  expectStr,
  rejectUnknownKeys,
  requirePresent,
} from "../types/results/result-base.js";

/**
 * Closed set of normalized action labels emitted by the rrweb analyzer
 * — mirror of the module-private Python `_REPLAY_ACTION_LITERAL`
 * (not in `__all__`, so not re-exported from the package barrel).
 */
export type ReplayActionLabel =
  | "click"
  | "input"
  | "scroll"
  | "navigate"
  | "select"
  | "console_error"
  | "viewport_resize"
  | "touch_start"
  | "media_interaction";

/** Declared fields of {@link UserAction} (Python field order). */
export interface UserActionFields {
  /** Action instant (unix ms). */
  readonly timestamp: number;
  /** Normalized action label. */
  readonly action: ReplayActionLabel;
  /** DOM node ID the action targeted (`null` when unknown). */
  readonly target_node_id: number | null;
  /** Human-readable target description. */
  readonly target_desc: string;
  /** Page URL at action time (`null` when unknown). */
  readonly url: string | null;
  /** Analyzer-specific extras. Default: `{}`. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Extended description. Default: `""`. */
  readonly description?: string;
}

/**
 * One normalized user action extracted from a session replay.
 *
 * @example
 * ```ts
 * const action = new UserAction({
 *   timestamp: 1_700_000_000_000,
 *   action: "click",
 *   target_node_id: 42,
 *   target_desc: 'button "Sign in"',
 *   url: "https://app.example.com/login",
 * });
 * action.toJSON();
 * // { timestamp: 1700000000000, action: "click", target_node_id: 42, ... }
 * ```
 * @see mixpanel_headless.types.UserAction
 */
export class UserAction {
  /** Action instant (unix ms). */
  readonly timestamp: number;

  /** Normalized action label. */
  readonly action: ReplayActionLabel;

  /** DOM node ID the action targeted (`null` when unknown). */
  readonly target_node_id: number | null;

  /** Human-readable target description. */
  readonly target_desc: string;

  /** Page URL at action time (`null` when unknown). */
  readonly url: string | null;

  /** Analyzer-specific extras. */
  readonly metadata: Readonly<Record<string, unknown>>;

  /** Extended description. */
  readonly description: string;

  /**
   * Create a user action; the guards run in the order of Python's
   * `__post_init__`.
   *
   * @param fields - Declared fields; Python defaults apply to absent
   *   optionals.
   * @throws {@link ParamValidationError} - `UA1_TIMESTAMP_NOT_POSITIVE` when
   *   `timestamp` is not a positive number, `UA2_EMPTY_TARGET_DESC` when
   *   `target_desc` is empty.
   */
  constructor(fields: UserActionFields) {
    this.timestamp = fields.timestamp;
    this.action = fields.action;
    this.target_node_id = fields.target_node_id;
    this.target_desc = fields.target_desc;
    this.url = fields.url;
    this.metadata = fields.metadata ?? {};
    this.description = fields.description ?? "";
    // UA1_TIMESTAMP_NOT_POSITIVE: timestamp must be a positive unix ms.
    if (this.timestamp <= 0) {
      throw new ParamValidationError(
        `timestamp must be a positive unix ms timestamp; got ${String(this.timestamp)}`,
        "UA1_TIMESTAMP_NOT_POSITIVE",
      );
    }
    // UA2_EMPTY_TARGET_DESC: target_desc must be non-empty.
    if (!this.target_desc) {
      throw new ParamValidationError(
        "target_desc must be non-empty",
        "UA2_EMPTY_TARGET_DESC",
      );
    }
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`
   * (`metadata` copied, as Python does `dict(self.metadata)`).
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      timestamp: this.timestamp,
      action: this.action,
      target_node_id: this.target_node_id,
      target_desc: this.target_desc,
      url: this.url,
      metadata: { ...this.metadata },
      description: this.description,
    };
  }

  /**
   * Strictly decode a recorded field-walk payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance (constructor guards apply).
   * @throws {@link ResponseValidationError} - on unknown keys or wrong field
   *   types.
   * @throws {@link ParamValidationError} - when a constructor guard fires.
   * @internal
   */
  static fromDict(raw: unknown): UserAction {
    const cls = "UserAction";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "timestamp",
        "action",
        "target_node_id",
        "target_desc",
        "url",
        "metadata",
        "description",
      ]),
      cls,
    );
    requirePresent(payload, "target_node_id", cls);
    requirePresent(payload, "url", cls);
    const nodeId = payload["target_node_id"];
    if (
      nodeId !== null &&
      (typeof nodeId !== "number" || !Number.isInteger(nodeId))
    ) {
      decodeFail(cls, "target_node_id", "integer | null", nodeId);
    }
    const url = payload["url"];
    if (url !== null && typeof url !== "string") {
      decodeFail(cls, "url", "string | null", url);
    }
    return new UserAction({
      timestamp: expectInt(payload, "timestamp", cls),
      action: expectStr(payload, "action", cls) as ReplayActionLabel,
      target_node_id: nodeId,
      target_desc: expectStr(payload, "target_desc", cls),
      url,
      ...(Object.hasOwn(payload, "metadata")
        ? { metadata: expectRecord(payload, "metadata", cls) }
        : {}),
      ...(Object.hasOwn(payload, "description")
        ? { description: expectStr(payload, "description", cls) }
        : {}),
    });
  }
}
