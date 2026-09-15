/**
 * Session-replay result dataclasses (phase2-design C6-d, packet P2-6)
 * — TS ports of `ReplaySummary`, `SignedReplay`, `UserAction`,
 * `ReplayEvent`, `Replay`, and `ReplayBundle` from
 * `mixpanel_headless/types.py`.
 *
 * Constructor guards fire exactly as Python's `__post_init__` does, IN
 * THE SAME CHECK ORDER (Risk #1), one comment per registry code —
 * their `types.*` guard vectors replay in Phase 2.
 *
 * `UserAction` is also a D4.4 `$type` family member (UA1/UA2 codes);
 * it is built here with the replay models and codec-registered exactly
 * like the C7 classes (phase2-design C6-d).
 *
 * The Phase-2 TODO(port) block is CLOSED as of batch B5 shard S3
 * (`b5-packets.md` §5): `Replay.summaryMarkdown`,
 * `ReplayBundle.toElementsRows` / `topClicks` / `rageClicks` /
 * `longPauses` / `errorSessions` / `findPattern` / `sample` /
 * `summaryMarkdown` now compose `src/replays/` (aggregators,
 * `replay_labels`, the rrweb analyzer) and — for `sample` — full
 * CPython `random.Random(seed)` parity (`compat/python-random.ts`,
 * decision S3-D1). The codec-visible cache slots stay `null`: the
 * pandas frames they memoized are row-array projections here, and the
 * recorded field-walk payloads still expect `null`.
 *
 * Import-cycle note: `src/replays/rrweb-analyzer.ts` imports
 * `UserAction` from THIS module, and this module imports
 * `renderMarkdown` from it. The cycle is safe under ESM — every
 * cross-edge is consumed inside a function body, never at module
 * evaluation time — and mirrors Python's deferred function-local
 * imports at exactly the same call sites (`types.py:13199`, `:13529`,
 * `:13585`, `:13738`, `:13777`).
 */

import { compareCodepoints, pythonFloatStr } from "../../compat/index.js";
import { pythonSample } from "../../compat/python-random.js";
import { ParamValidationError } from "../../errors.js";
import {
  errorSessions,
  longPauses,
  rageClicks,
  realClicks,
  topClicks,
} from "../../replays/aggregators.js";
import { defaultLabelFn, urlNormalizer } from "../../replays/replay-labels.js";
import { renderMarkdown } from "../../replays/rrweb-analyzer.js";
import {
  decodeFail,
  expectInt,
  expectNullCache,
  expectPayload,
  expectRecord,
  expectRecordArray,
  expectStr,
  floatValue,
  isPlainRecord,
  rejectUnknownKeys,
  requirePresent,
  type Row,
} from "./result-base.js";

/** Allowed replay retention windows (Python `_ALLOWED_RETENTION_DAYS`). */
const ALLOWED_RETENTION_DAYS: ReadonlySet<number> = new Set([1, 7, 30, 90]);

/**
 * Closed set of normalized action labels emitted by the rrweb analyzer
 * — mirror of the module-private Python `_REPLAY_ACTION_LITERAL`
 * (NOT in `__all__`, so not re-exported from the package barrel).
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

/** rrweb event-type discriminators (Python module constants). */
const RRWEB_TYPE_INCREMENTAL_SNAPSHOT = 3;
const RRWEB_TYPE_META = 4;
const RRWEB_SOURCE_MOUSE_INTERACTION = 2;

/**
 * Project one raw rrweb event into the `events_df` row shape — mirror
 * of `types._rrweb_event_row` (missing attributes are `null`; `raw`
 * always points at the original event).
 *
 * @param event - Raw rrweb event dict (`type`, `data`, `timestamp`).
 * @returns The seven-column row.
 * @internal
 */
export function rrwebEventRow(event: Readonly<Record<string, unknown>>): Row {
  const type_ = event["type"] ?? null;
  const raw_data = event["data"];
  const data: Readonly<Record<string, unknown>> = isPlainRecord(raw_data)
    ? raw_data
    : {};
  const source =
    type_ === RRWEB_TYPE_INCREMENTAL_SNAPSHOT ? (data["source"] ?? null) : null;
  let mouse_type: number | null = null;
  if (source === RRWEB_SOURCE_MOUSE_INTERACTION) {
    const raw_mouse_type = data["type"];
    if (
      typeof raw_mouse_type === "number" &&
      Number.isInteger(raw_mouse_type)
    ) {
      mouse_type = raw_mouse_type;
    }
  }
  const raw_id = data["id"];
  const target_node_id =
    typeof raw_id === "number" && Number.isInteger(raw_id) ? raw_id : null;
  const url = type_ === RRWEB_TYPE_META ? (data["href"] ?? null) : null;
  const timestamp = event["timestamp"];
  return {
    t: typeof timestamp === "number" ? Math.trunc(timestamp) : 0,
    type: type_,
    source,
    mouse_type,
    target_node_id,
    url,
    raw: event,
  };
}

// ---------------------------------------------------------------------------
// ReplaySummary
// ---------------------------------------------------------------------------

/** Declared fields of {@link ReplaySummary} (Python field order). */
export interface ReplaySummaryFields {
  /** Replay identifier. */
  readonly replay_id: string;
  /** User the replay belongs to (`null` when unknown). */
  readonly distinct_id: string | null;
  /** Owning project ID. */
  readonly project_id: number;
  /** Recording start (unix ms). */
  readonly start_time: number;
  /** CDN retention window in days. */
  readonly retention_days: number;
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * A discovered replay summary — TS port of `types.ReplaySummary`.
 */
export class ReplaySummary {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** Replay identifier. */
  readonly replay_id: string;

  /** User the replay belongs to (`null` when unknown). */
  readonly distinct_id: string | null;

  /** Owning project ID. */
  readonly project_id: number;

  /** Recording start (unix ms). */
  readonly start_time: number;

  /** CDN retention window in days. */
  readonly retention_days: number;

  /**
   * Create a replay summary (guards fire exactly as Python's
   * `__post_init__`, in source order).
   *
   * @param fields - Declared fields.
   * @throws ParamValidationError - `RS1_EMPTY_REPLAY_ID`,
   *   `RS2_PROJECT_ID_NOT_POSITIVE`, `RS3_START_TIME_NOT_POSITIVE`, or
   *   `RS4_INVALID_RETENTION_DAYS`.
   */
  constructor(fields: ReplaySummaryFields) {
    this.replay_id = fields.replay_id;
    this.distinct_id = fields.distinct_id;
    this.project_id = fields.project_id;
    this.start_time = fields.start_time;
    this.retention_days = fields.retention_days;
    // RS1_EMPTY_REPLAY_ID: replay_id must be non-empty.
    if (!this.replay_id) {
      throw new ParamValidationError(
        "replay_id must be non-empty",
        "RS1_EMPTY_REPLAY_ID",
      );
    }
    // RS2_PROJECT_ID_NOT_POSITIVE: project_id must be positive.
    if (this.project_id <= 0) {
      throw new ParamValidationError(
        `project_id must be positive; got ${String(this.project_id)}`,
        "RS2_PROJECT_ID_NOT_POSITIVE",
      );
    }
    // RS3_START_TIME_NOT_POSITIVE: start_time must be a positive unix ms.
    if (this.start_time <= 0) {
      throw new ParamValidationError(
        `start_time must be a positive unix ms timestamp; got ${String(this.start_time)}`,
        "RS3_START_TIME_NOT_POSITIVE",
      );
    }
    // RS4_INVALID_RETENTION_DAYS: retention_days ∈ {1, 7, 30, 90}.
    if (!ALLOWED_RETENTION_DAYS.has(this.retention_days)) {
      throw new ParamValidationError(
        `retention_days must be in {1, 7, 30, 90}; got ${String(this.retention_days)}`,
        "RS4_INVALID_RETENTION_DAYS",
      );
    }
  }

  /**
   * Pre-pandas rows of the Python `.df` body: a single row of the
   * five declared fields.
   *
   * @returns The one-row list.
   */
  toRows(): readonly Row[] {
    return [
      {
        replay_id: this.replay_id,
        distinct_id: this.distinct_id,
        project_id: this.project_id,
        start_time: this.start_time,
        retention_days: this.retention_days,
      },
    ];
  }

  /**
   * Column contract of the `.df` frame (always one row — pandas
   * infers from the row keys).
   *
   * @returns The column list.
   */
  rowColumns(): readonly string[] {
    return [
      "replay_id",
      "distinct_id",
      "project_id",
      "start_time",
      "retention_days",
    ];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      replay_id: this.replay_id,
      distinct_id: this.distinct_id,
      project_id: this.project_id,
      start_time: this.start_time,
      retention_days: this.retention_days,
    };
  }

  /**
   * Strictly decode a recorded field-walk payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance (guards fire).
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @throws ParamValidationError - When a constructor guard fires.
   * @internal
   */
  static fromDict(raw: unknown): ReplaySummary {
    const cls = "ReplaySummary";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "replay_id",
        "distinct_id",
        "project_id",
        "start_time",
        "retention_days",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    requirePresent(payload, "distinct_id", cls);
    const distinct = payload["distinct_id"];
    if (distinct !== null && typeof distinct !== "string") {
      decodeFail(cls, "distinct_id", "string | null", distinct);
    }
    return new ReplaySummary({
      replay_id: expectStr(payload, "replay_id", cls),
      distinct_id: distinct,
      project_id: expectInt(payload, "project_id", cls),
      start_time: expectInt(payload, "start_time", cls),
      retention_days: expectInt(payload, "retention_days", cls),
    });
  }
}

// ---------------------------------------------------------------------------
// SignedReplay
// ---------------------------------------------------------------------------

/** Declared fields of {@link SignedReplay} (Python field order). */
export interface SignedReplayFields {
  /** Replay identifier. */
  readonly replay_id: string;
  /** CDN base URL (must end with `/`). */
  readonly url: string;
  /** Signed query string (a short-lived bearer credential). */
  readonly query_string: string;
  /** Signing environment. */
  readonly env: "prod" | "dev";
  /** When the URL was signed (unix seconds, float). */
  readonly signed_at: number;
}

/**
 * A signed replay-CDN access grant — TS port of `types.SignedReplay`.
 */
export class SignedReplay {
  /** Replay identifier. */
  readonly replay_id: string;

  /** CDN base URL (must end with `/`). */
  readonly url: string;

  /** Signed query string (a short-lived bearer credential). */
  readonly query_string: string;

  /** Signing environment. */
  readonly env: "prod" | "dev";

  /** When the URL was signed (unix seconds, float). */
  readonly signed_at: number;

  /**
   * Create a signed replay (guards fire exactly as Python's
   * `__post_init__`, in source order).
   *
   * @param fields - Declared fields.
   * @throws ParamValidationError - `SR1_URL_NO_TRAILING_SLASH`,
   *   `SR2_EMPTY_QUERY_STRING`, `SR3_INVALID_ENV`, or
   *   `SR4_SIGNED_AT_NEGATIVE`.
   */
  constructor(fields: SignedReplayFields) {
    this.replay_id = fields.replay_id;
    this.url = fields.url;
    this.query_string = fields.query_string;
    this.env = fields.env;
    this.signed_at = fields.signed_at;
    // SR1_URL_NO_TRAILING_SLASH: url must end with '/'.
    if (!this.url.endsWith("/")) {
      throw new ParamValidationError(
        `url must end with '/' for CDN-path concatenation; got ${JSON.stringify(this.url)}`,
        "SR1_URL_NO_TRAILING_SLASH",
      );
    }
    // SR2_EMPTY_QUERY_STRING: query_string must be non-empty.
    if (!this.query_string) {
      throw new ParamValidationError(
        "query_string must be non-empty",
        "SR2_EMPTY_QUERY_STRING",
      );
    }
    // SR3_INVALID_ENV: env must be 'prod' or 'dev'.
    if (this.env !== "prod" && this.env !== "dev") {
      throw new ParamValidationError(
        `env must be 'prod' or 'dev'; got ${JSON.stringify(this.env as string)}`,
        "SR3_INVALID_ENV",
      );
    }
    // SR4_SIGNED_AT_NEGATIVE: signed_at must be non-negative.
    if (this.signed_at < 0) {
      throw new ParamValidationError(
        `signed_at must be non-negative; got ${String(this.signed_at)}`,
        "SR4_SIGNED_AT_NEGATIVE",
      );
    }
  }

  /**
   * Expiry instant — Python's `expires_at` property
   * (`signed_at + 300`).
   *
   * @returns Unix seconds.
   */
  get expires_at(): number {
    return this.signed_at + 300;
  }

  /**
   * Whether the grant has expired — Python's `is_expired` property
   * (`time.time() >= expires_at`).
   *
   * @returns True when the wall clock is at/past expiry.
   */
  get is_expired(): boolean {
    return Date.now() / 1000 >= this.expires_at;
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`
   * (leading `_warning` key included).
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      _warning: "query_string is a bearer credential valid for ~5 minutes",
      replay_id: this.replay_id,
      url: this.url,
      query_string: this.query_string,
      env: this.env,
      signed_at: this.signed_at,
    };
  }

  /**
   * Masked debug rendering — port of Python `__repr__`/`__str__`: the
   * bearer `query_string` NEVER appears; it renders as
   * `'<redacted N chars>'`. Non-credential fields stay visible.
   *
   * @returns The masked representation.
   */
  toString(): string {
    const masked = `<redacted ${String(this.query_string.length)} chars>`;
    const signed_at_repr =
      Number.isFinite(this.signed_at) && Number.isInteger(this.signed_at)
        ? pythonFloatStr(this.signed_at)
        : String(this.signed_at);
    return (
      `SignedReplay(replay_id='${this.replay_id}', url='${this.url}', ` +
      `query_string='${masked}', env='${this.env}', signed_at=${signed_at_repr})`
    );
  }

  /**
   * Strictly decode a recorded field-walk payload (`signed_at` may
   * arrive as a `$type: float`-decoded wrapper).
   *
   * @param raw - The payload.
   * @returns The reconstructed instance (guards fire).
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @throws ParamValidationError - When a constructor guard fires.
   * @internal
   */
  static fromDict(raw: unknown): SignedReplay {
    const cls = "SignedReplay";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set(["replay_id", "url", "query_string", "env", "signed_at"]),
      cls,
    );
    requirePresent(payload, "signed_at", cls);
    const signed_at = floatValue(payload["signed_at"]);
    if (signed_at === undefined) {
      decodeFail(cls, "signed_at", "number", payload["signed_at"]);
    }
    return new SignedReplay({
      replay_id: expectStr(payload, "replay_id", cls),
      url: expectStr(payload, "url", cls),
      query_string: expectStr(payload, "query_string", cls),
      env: expectStr(payload, "env", cls) as "prod" | "dev",
      signed_at,
    });
  }
}

// Node `util.inspect` hook for {@link SignedReplay} — same masked
// rendering as `toString()` (registered via `Symbol.for`, no `node:util`
// import — R9.1-safe, ignored in browsers). Installed on the prototype
// with a class method's attributes rather than declared in the class
// body: `isolatedDeclarations` only accepts well-known `Symbol.*`
// computed names, and the method was never part of the emitted
// declaration anyway.
Object.defineProperty(
  SignedReplay.prototype,
  Symbol.for("nodejs.util.inspect.custom"),
  {
    value: function inspect(this: SignedReplay): string {
      return this.toString();
    },
    writable: true,
    enumerable: false,
    configurable: true,
  },
);

// ---------------------------------------------------------------------------
// UserAction
// ---------------------------------------------------------------------------

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
 * One normalized user action extracted from a replay — TS port of
 * `types.UserAction` (a D4.4 `$type` family member; UA1/UA2 codes).
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
   * Create a user action (guards fire exactly as Python's
   * `__post_init__`, in source order).
   *
   * @param fields - Declared fields; Python defaults apply to absent
   *   optionals.
   * @throws ParamValidationError - `UA1_TIMESTAMP_NOT_POSITIVE` or
   *   `UA2_EMPTY_TARGET_DESC`.
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
   * @returns The reconstructed instance (guards fire).
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @throws ParamValidationError - When a constructor guard fires.
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
    const node_id = payload["target_node_id"];
    if (
      node_id !== null &&
      (typeof node_id !== "number" || !Number.isInteger(node_id))
    ) {
      decodeFail(cls, "target_node_id", "integer | null", node_id);
    }
    const url = payload["url"];
    if (url !== null && typeof url !== "string") {
      decodeFail(cls, "url", "string | null", url);
    }
    return new UserAction({
      timestamp: expectInt(payload, "timestamp", cls),
      action: expectStr(payload, "action", cls) as ReplayActionLabel,
      target_node_id: node_id,
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

// ---------------------------------------------------------------------------
// ReplayEvent
// ---------------------------------------------------------------------------

/** Declared fields of {@link ReplayEvent} (Python field order). */
export interface ReplayEventFields {
  /** Replay identifier the event belongs to. */
  readonly replay_id: string;
  /** Mixpanel event name. */
  readonly event_name: string;
  /** Event instant (unix seconds). */
  readonly event_time: number;
  /** Event properties. Default: `null`. */
  readonly properties?: Readonly<Record<string, unknown>> | null;
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * A Mixpanel event correlated with a replay — TS port of
 * `types.ReplayEvent`.
 */
export class ReplayEvent {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** Replay identifier the event belongs to. */
  readonly replay_id: string;

  /** Mixpanel event name. */
  readonly event_name: string;

  /** Event instant (unix seconds). */
  readonly event_time: number;

  /** Event properties (`null` when not fetched). */
  readonly properties: Readonly<Record<string, unknown>> | null;

  /**
   * Create a replay event (guards fire exactly as Python's
   * `__post_init__`, in source order).
   *
   * @param fields - Declared fields; absent `properties` defaults to
   *   `null`.
   * @throws ParamValidationError - `RE1_EMPTY_REPLAY_ID`,
   *   `RE2_EMPTY_EVENT_NAME`, or `RE3_EVENT_TIME_NOT_POSITIVE`.
   */
  constructor(fields: ReplayEventFields) {
    this.replay_id = fields.replay_id;
    this.event_name = fields.event_name;
    this.event_time = fields.event_time;
    this.properties = fields.properties ?? null;
    // RE1_EMPTY_REPLAY_ID: replay_id must be non-empty.
    if (!this.replay_id) {
      throw new ParamValidationError(
        "replay_id must be non-empty",
        "RE1_EMPTY_REPLAY_ID",
      );
    }
    // RE2_EMPTY_EVENT_NAME: event_name must be non-empty.
    if (!this.event_name) {
      throw new ParamValidationError(
        "event_name must be non-empty",
        "RE2_EMPTY_EVENT_NAME",
      );
    }
    // RE3_EVENT_TIME_NOT_POSITIVE: event_time must be positive.
    if (this.event_time <= 0) {
      throw new ParamValidationError(
        `event_time must be a positive unix seconds timestamp; got ${String(this.event_time)}`,
        "RE3_EVENT_TIME_NOT_POSITIVE",
      );
    }
  }

  /**
   * Pre-pandas rows of the Python `.df` body: a single row of the
   * four declared fields.
   *
   * @returns The one-row list.
   */
  toRows(): readonly Row[] {
    return [
      {
        replay_id: this.replay_id,
        event_name: this.event_name,
        event_time: this.event_time,
        properties: this.properties,
      },
    ];
  }

  /**
   * Column contract of the `.df` frame.
   *
   * @returns The column list.
   */
  rowColumns(): readonly string[] {
    return ["replay_id", "event_name", "event_time", "properties"];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`
   * (Python deep-copies `properties`; the TS port deep-clones the
   * JSON-shaped value).
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      replay_id: this.replay_id,
      event_name: this.event_name,
      event_time: this.event_time,
      properties:
        this.properties === null ? null : deepCloneJson(this.properties),
    };
  }

  /**
   * Strictly decode a recorded field-walk payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance (guards fire).
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @throws ParamValidationError - When a constructor guard fires.
   * @internal
   */
  static fromDict(raw: unknown): ReplayEvent {
    const cls = "ReplayEvent";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "replay_id",
        "event_name",
        "event_time",
        "properties",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    const properties = payload["properties"];
    if (
      Object.hasOwn(payload, "properties") &&
      properties !== null &&
      !isPlainRecord(properties)
    ) {
      decodeFail(cls, "properties", "object | null", properties);
    }
    return new ReplayEvent({
      replay_id: expectStr(payload, "replay_id", cls),
      event_name: expectStr(payload, "event_name", cls),
      event_time: expectInt(payload, "event_time", cls),
      ...(Object.hasOwn(payload, "properties")
        ? {
            properties: properties as Readonly<Record<string, unknown>> | null,
          }
        : {}),
    });
  }
}

/**
 * Deep-clone a JSON-shaped value (mirror of Python `copy.deepcopy`
 * for the JSON subset — no `structuredClone` dependency, R9.1-safe).
 *
 * @param value - A JSON-shaped value.
 * @returns A structurally equal deep copy.
 */
function deepCloneJson<T>(value: T): T {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map((item) => deepCloneJson(item)) as unknown as T;
  }
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepCloneJson(item)]),
    ) as unknown as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/** Declared fields of {@link Replay} (Python field order). */
export interface ReplayFields {
  /** Replay identifier. */
  readonly replay_id: string;
  /** User the replay belongs to (`null` when unknown). */
  readonly distinct_id: string | null;
  /** Owning project ID. */
  readonly project_id: number;
  /** Recording start (unix ms). */
  readonly start_time: number;
  /** Recording end (unix ms). */
  readonly end_time: number;
  /** CDN retention window in days. */
  readonly retention_days: number;
  /** Raw rrweb events. Default: `[]`. */
  readonly rrweb_events?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Extracted user actions. Default: `[]`. */
  readonly actions?: readonly UserAction[];
  /** Correlated Mixpanel events. Default: `[]`. */
  readonly mixpanel_events?: readonly ReplayEvent[];
  /** Codec-visible DataFrame cache slots — always `null` in TS. */
  readonly _df_cache?: null | undefined;
  /** Codec-visible events-frame cache slot — always `null` in TS. */
  readonly _events_df_cache?: null | undefined;
  /** Codec-visible actions-frame cache slot — always `null` in TS. */
  readonly _actions_df_cache?: null | undefined;
  /** Codec-visible mixpanel-frame cache slot — always `null` in TS. */
  readonly _mixpanel_df_cache?: null | undefined;
}

/**
 * A fully fetched session replay — TS port of `types.Replay`.
 *
 * Multi-frame surface: `events_df`/`actions_df`/`mixpanel_df` become
 * `toEventsRows()`/`toActionsRows()`/`toMixpanelRows()`; the main
 * `.df` delegates to the actions frame.
 */
export class Replay {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** Replay identifier. */
  readonly replay_id: string;

  /** User the replay belongs to (`null` when unknown). */
  readonly distinct_id: string | null;

  /** Owning project ID. */
  readonly project_id: number;

  /** Recording start (unix ms). */
  readonly start_time: number;

  /** Recording end (unix ms). */
  readonly end_time: number;

  /** CDN retention window in days. */
  readonly retention_days: number;

  /** Raw rrweb events. */
  readonly rrweb_events: ReadonlyArray<Readonly<Record<string, unknown>>>;

  /** Extracted user actions. */
  readonly actions: readonly UserAction[];

  /** Correlated Mixpanel events. */
  readonly mixpanel_events: readonly ReplayEvent[];

  /** Codec-visible events-frame cache slot (`@internal`) — always `null`. */
  readonly _events_df_cache: null = null;

  /** Codec-visible actions-frame cache slot (`@internal`) — always `null`. */
  readonly _actions_df_cache: null = null;

  /** Codec-visible mixpanel-frame cache slot (`@internal`) — always `null`. */
  readonly _mixpanel_df_cache: null = null;

  /**
   * Create a replay (guards fire exactly as Python's `__post_init__`,
   * in source order).
   *
   * @param fields - Declared fields; Python defaults apply to absent
   *   optionals.
   * @throws ParamValidationError - `RP1_EMPTY_REPLAY_ID`,
   *   `RP2_PROJECT_ID_NOT_POSITIVE`, `RP3_START_TIME_NOT_POSITIVE`,
   *   `RP4_TIME_ORDER`, or `RP5_INVALID_RETENTION_DAYS`.
   */
  constructor(fields: ReplayFields) {
    this.replay_id = fields.replay_id;
    this.distinct_id = fields.distinct_id;
    this.project_id = fields.project_id;
    this.start_time = fields.start_time;
    this.end_time = fields.end_time;
    this.retention_days = fields.retention_days;
    this.rrweb_events = fields.rrweb_events ?? [];
    this.actions = fields.actions ?? [];
    this.mixpanel_events = fields.mixpanel_events ?? [];
    // RP1_EMPTY_REPLAY_ID: replay_id must be non-empty.
    if (!this.replay_id) {
      throw new ParamValidationError(
        "replay_id must be non-empty",
        "RP1_EMPTY_REPLAY_ID",
      );
    }
    // RP2_PROJECT_ID_NOT_POSITIVE: project_id must be positive.
    if (this.project_id <= 0) {
      throw new ParamValidationError(
        `project_id must be positive; got ${String(this.project_id)}`,
        "RP2_PROJECT_ID_NOT_POSITIVE",
      );
    }
    // RP3_START_TIME_NOT_POSITIVE: start_time must be a positive unix ms.
    if (this.start_time <= 0) {
      throw new ParamValidationError(
        `start_time must be a positive unix ms timestamp; got ${String(this.start_time)}`,
        "RP3_START_TIME_NOT_POSITIVE",
      );
    }
    // RP4_TIME_ORDER: end_time must be >= start_time.
    if (this.end_time < this.start_time) {
      throw new ParamValidationError(
        `end_time must be >= start_time; got start=${String(this.start_time)}, end=${String(this.end_time)}`,
        "RP4_TIME_ORDER",
      );
    }
    // RP5_INVALID_RETENTION_DAYS: retention_days ∈ {1, 7, 30, 90}.
    if (!ALLOWED_RETENTION_DAYS.has(this.retention_days)) {
      throw new ParamValidationError(
        `retention_days must be in {1, 7, 30, 90}; got ${String(this.retention_days)}`,
        "RP5_INVALID_RETENTION_DAYS",
      );
    }
  }

  /**
   * Recording duration — Python's `duration_seconds` property.
   *
   * @returns `(end_time - start_time) / 1000`.
   */
  get duration_seconds(): number {
    return (this.end_time - this.start_time) / 1000;
  }

  /**
   * Pre-pandas rows of the Python `events_df` body (one projected row
   * per rrweb event).
   *
   * @returns The rows list.
   */
  toEventsRows(): readonly Row[] {
    return this.rrweb_events.map((event) => rrwebEventRow(event));
  }

  /**
   * Column contract of the `events_df` frame (explicit
   * `columns=cols`).
   *
   * @returns The column list.
   */
  eventsRowColumns(): readonly string[] {
    return [
      "t",
      "type",
      "source",
      "mouse_type",
      "target_node_id",
      "url",
      "raw",
    ];
  }

  /**
   * Pre-pandas rows of the Python `actions_df` body.
   *
   * @returns The rows list.
   */
  toActionsRows(): readonly Row[] {
    return this.actions.map((a) => ({
      t: a.timestamp,
      action: a.action,
      target_node_id: a.target_node_id,
      target_desc: a.target_desc,
      description: a.description,
      url: a.url,
      metadata: { ...a.metadata },
    }));
  }

  /**
   * Column contract of the `actions_df` frame (explicit
   * `columns=cols`).
   *
   * @returns The column list.
   */
  actionsRowColumns(): readonly string[] {
    return [
      "t",
      "action",
      "target_node_id",
      "target_desc",
      "description",
      "url",
      "metadata",
    ];
  }

  /**
   * Pre-pandas rows of the Python `mixpanel_df` body.
   *
   * @returns The rows list.
   */
  toMixpanelRows(): readonly Row[] {
    return this.mixpanel_events.map((e) => ({
      t: e.event_time,
      event_name: e.event_name,
      properties: e.properties,
    }));
  }

  /**
   * Column contract of the `mixpanel_df` frame (explicit
   * `columns=cols`).
   *
   * @returns The column list.
   */
  mixpanelRowColumns(): readonly string[] {
    return ["t", "event_name", "properties"];
  }

  /**
   * The main `.df` contract — Python's `df` property returns
   * `actions_df`.
   *
   * @returns.
   */
  toRows(): readonly Row[] {
    return this.toActionsRows();
  }

  /**
   * Column contract of the main `.df` frame.
   *
   * @returns.
   */
  rowColumns(): readonly string[] {
    return this.actionsRowColumns();
  }

  /**
   * URLs of navigate actions — mirror of Python `page_path()`
   * (`str(a.url)` for navigate actions with a non-`null` URL).
   *
   * @returns The page path.
   */
  pagePath(): readonly string[] {
    return this.actions
      .filter((a) => a.action === "navigate" && a.url !== null)
      .map((a) => String(a.url));
  }

  /**
   * rrweb events sorted by timestamp for the rrweb player — mirror of
   * Python `to_rrweb_player_json()` (stable sort, missing timestamps
   * treated as `0`).
   *
   * @returns The sorted events.
   */
  toRrwebPlayerJson(): ReadonlyArray<Readonly<Record<string, unknown>>> {
    const key = (event: Readonly<Record<string, unknown>>): number => {
      const ts = event["timestamp"];
      return typeof ts === "number" ? Math.trunc(ts) : 0;
    };
    return [...this.rrweb_events].sort((a, b) => key(a) - key(b));
  }

  /**
   * Console-error rows of the actions frame — mirror of Python's
   * `errors` property (`actions_df[action == "console_error"]`).
   *
   * @returns The filtered rows (actions-frame columns).
   */
  toErrorsRows(): readonly Row[] {
    return this.toActionsRows().filter(
      (row) => row["action"] === "console_error",
    );
  }

  /**
   * Click rows matching a predicate — mirror of Python
   * `clicks_on(predicate)` (note: NO `description` column, unlike the
   * actions frame).
   *
   * @param predicate - Filter applied to click actions.
   * @returns The matching rows.
   */
  clicksOnRows(predicate: (action: UserAction) => boolean): readonly Row[] {
    return this.actions
      .filter((a) => a.action === "click" && predicate(a))
      .map((a) => ({
        t: a.timestamp,
        action: a.action,
        target_node_id: a.target_node_id,
        target_desc: a.target_desc,
        url: a.url,
        metadata: { ...a.metadata },
      }));
  }

  /**
   * Column contract of the `clicks_on` frame (explicit
   * `columns=cols`).
   *
   * @returns The column list.
   */
  clicksOnRowColumns(): readonly string[] {
    return ["t", "action", "target_node_id", "target_desc", "url", "metadata"];
  }

  /**
   * Analyzer-produced markdown timeline rendered from `actions`
   * (Python `summary_markdown` property, `types.py:13187-13205`).
   * Closed at B5-S3 — the `_render_markdown` dependency landed with
   * the analyzer.
   *
   * `Workspace.fetchReplay` runs the rrweb analyzer; when `actions` is
   * non-empty this returns the markdown timeline. When `actions` is
   * empty (test fixture, no-events fetch) it returns a one-line
   * placeholder.
   *
   * @returns Multi-line markdown suitable for stdout / LLM
   *   consumption.
   */
  summaryMarkdown(): string {
    if (this.actions.length === 0) {
      return `# Replay ${this.replay_id} — no actions extracted\n`;
    }
    return renderMarkdown(this.actions);
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      replay_id: this.replay_id,
      distinct_id: this.distinct_id,
      project_id: this.project_id,
      start_time: this.start_time,
      end_time: this.end_time,
      retention_days: this.retention_days,
      rrweb_events: [...this.rrweb_events],
      actions: this.actions.map((a) => a.toJSON()),
      mixpanel_events: this.mixpanel_events.map((e) => e.toJSON()),
    };
  }

  /**
   * Strictly decode a recorded field-walk payload (`actions` /
   * `mixpanel_events` accept decoded instances or plain dicts).
   *
   * @param raw - The payload.
   * @returns The reconstructed instance (guards fire).
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @throws ParamValidationError - When a constructor guard fires.
   * @internal
   */
  static fromDict(raw: unknown): Replay {
    const cls = "Replay";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "replay_id",
        "distinct_id",
        "project_id",
        "start_time",
        "end_time",
        "retention_days",
        "rrweb_events",
        "actions",
        "mixpanel_events",
        "_df_cache",
        "_events_df_cache",
        "_actions_df_cache",
        "_mixpanel_df_cache",
      ]),
      cls,
    );
    for (const cache of [
      "_df_cache",
      "_events_df_cache",
      "_actions_df_cache",
      "_mixpanel_df_cache",
    ]) {
      expectNullCache(payload, cache, cls);
    }
    requirePresent(payload, "distinct_id", cls);
    const distinct = payload["distinct_id"];
    if (distinct !== null && typeof distinct !== "string") {
      decodeFail(cls, "distinct_id", "string | null", distinct);
    }
    const decodeActions = (): readonly UserAction[] =>
      (payload["actions"] as readonly unknown[]).map((item) =>
        item instanceof UserAction ? item : UserAction.fromDict(item),
      );
    const decodeMixpanelEvents = (): readonly ReplayEvent[] =>
      (payload["mixpanel_events"] as readonly unknown[]).map((item) =>
        item instanceof ReplayEvent ? item : ReplayEvent.fromDict(item),
      );
    if (
      Object.hasOwn(payload, "actions") &&
      !Array.isArray(payload["actions"])
    ) {
      decodeFail(cls, "actions", "array", payload["actions"]);
    }
    if (
      Object.hasOwn(payload, "mixpanel_events") &&
      !Array.isArray(payload["mixpanel_events"])
    ) {
      decodeFail(cls, "mixpanel_events", "array", payload["mixpanel_events"]);
    }
    return new Replay({
      replay_id: expectStr(payload, "replay_id", cls),
      distinct_id: distinct,
      project_id: expectInt(payload, "project_id", cls),
      start_time: expectInt(payload, "start_time", cls),
      end_time: expectInt(payload, "end_time", cls),
      retention_days: expectInt(payload, "retention_days", cls),
      ...(Object.hasOwn(payload, "rrweb_events")
        ? { rrweb_events: expectRecordArray(payload, "rrweb_events", cls) }
        : {}),
      ...(Object.hasOwn(payload, "actions")
        ? { actions: decodeActions() }
        : {}),
      ...(Object.hasOwn(payload, "mixpanel_events")
        ? { mixpanel_events: decodeMixpanelEvents() }
        : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// ReplayBundle
// ---------------------------------------------------------------------------

/** Declared fields of {@link ReplayBundle} (Python field order). */
export interface ReplayBundleFields {
  /** Replays in the bundle. Default: `[]`. */
  readonly replays?: readonly Replay[];
  /** When the bundle was computed (ISO text). Default: `""`. */
  readonly computed_at?: string;
  /** Owning project ID (`0` when unset). Default: `0`. */
  readonly project_id?: number;
  /** Codec-visible DataFrame cache slots — always `null` in TS. */
  readonly _df_cache?: null | undefined;
  /** Codec-visible sessions-frame cache slot — always `null` in TS. */
  readonly _sessions_df_cache?: null | undefined;
  /** Codec-visible actions-frame cache slot — always `null` in TS. */
  readonly _actions_df_cache?: null | undefined;
  /** Codec-visible events-frame cache slot — always `null` in TS. */
  readonly _events_df_cache?: null | undefined;
  /** Codec-visible mixpanel-frame cache slot — always `null` in TS. */
  readonly _mixpanel_df_cache?: null | undefined;
  /** Codec-visible elements-frame cache slot — always `null` in TS. */
  readonly _elements_df_cache?: null | undefined;
}

/**
 * A collection of replays with aggregate frames — TS port of
 * `types.ReplayBundle`.
 *
 * Multi-frame surface: `sessions_df`/`actions_df`/`events_df`/
 * `mixpanel_df` become `toSessionsRows()`/`toActionsRows()`/
 * `toEventsRows()`/`toMixpanelRows()`; the main `.df` delegates to the
 * sessions frame. See the module doc for the B5-deferred members.
 */
export class ReplayBundle {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** Replays in the bundle. */
  readonly replays: readonly Replay[];

  /** When the bundle was computed (ISO text). */
  readonly computed_at: string;

  /** Owning project ID (`0` when unset). */
  readonly project_id: number;

  /** Codec-visible sessions-frame cache slot (`@internal`) — always `null`. */
  readonly _sessions_df_cache: null = null;

  /** Codec-visible actions-frame cache slot (`@internal`) — always `null`. */
  readonly _actions_df_cache: null = null;

  /** Codec-visible events-frame cache slot (`@internal`) — always `null`. */
  readonly _events_df_cache: null = null;

  /** Codec-visible mixpanel-frame cache slot (`@internal`) — always `null`. */
  readonly _mixpanel_df_cache: null = null;

  /** Codec-visible elements-frame cache slot (`@internal`) — always `null`. */
  readonly _elements_df_cache: null = null;

  /**
   * Create a replay bundle (guard fires exactly as Python's
   * `__post_init__`).
   *
   * @param fields - Declared fields; Python defaults apply to absent
   *   optionals.
   * @throws ParamValidationError - `RB1_PROJECT_ID_MISMATCH` when
   *   `project_id` is set (truthy) and any replay carries a different
   *   project ID.
   */
  constructor(fields: ReplayBundleFields = {}) {
    this.replays = fields.replays ?? [];
    this.computed_at = fields.computed_at ?? "";
    this.project_id = fields.project_id ?? 0;
    // RB1_PROJECT_ID_MISMATCH: all replays must match a set project_id.
    if (
      this.project_id &&
      this.replays.some((r) => r.project_id !== this.project_id)
    ) {
      const mismatches = this.replays
        .filter((r) => r.project_id !== this.project_id)
        .map((r) => r.replay_id);
      throw new ParamValidationError(
        `ReplayBundle.project_id=${String(this.project_id)} but the following ` +
          `replays carry a different project_id: ${JSON.stringify(mismatches)}`,
        "RB1_PROJECT_ID_MISMATCH",
      );
    }
  }

  /**
   * Pre-pandas rows of the Python `sessions_df` body: one summary row
   * per replay.
   *
   * @returns The rows list.
   */
  toSessionsRows(): readonly Row[] {
    return this.replays.map((r) => {
      const n_clicks = r.actions.filter((a) => a.action === "click").length;
      const n_inputs = r.actions.filter((a) => a.action === "input").length;
      const n_errors = r.actions.filter(
        (a) => a.action === "console_error",
      ).length;
      const navigations = r.actions.filter((a) => a.action === "navigate");
      const entry_url = navigations.length > 0 ? navigations[0]?.url : null;
      const exit_url =
        navigations.length > 0
          ? navigations[navigations.length - 1]?.url
          : null;
      return {
        replay_id: r.replay_id,
        distinct_id: r.distinct_id,
        start_time: r.start_time,
        end_time: r.end_time,
        duration_s: r.duration_seconds,
        retention_days: r.retention_days,
        n_events: r.rrweb_events.length,
        n_actions: r.actions.length,
        n_clicks,
        n_inputs,
        n_pages: navigations.length,
        n_errors,
        n_mp_events: r.mixpanel_events.length,
        entry_url: entry_url ?? null,
        exit_url: exit_url ?? null,
      };
    });
  }

  /**
   * Column contract of the `sessions_df` frame (explicit
   * `columns=cols`).
   *
   * @returns The column list.
   */
  sessionsRowColumns(): readonly string[] {
    return [
      "replay_id",
      "distinct_id",
      "start_time",
      "end_time",
      "duration_s",
      "retention_days",
      "n_events",
      "n_actions",
      "n_clicks",
      "n_inputs",
      "n_pages",
      "n_errors",
      "n_mp_events",
      "entry_url",
      "exit_url",
    ];
  }

  /**
   * Pre-pandas rows of the Python bundle `actions_df` body (replay-id
   * prefixed action rows across every replay).
   *
   * @returns The rows list.
   */
  toActionsRows(): readonly Row[] {
    const rows: Row[] = [];
    for (const r of this.replays) {
      for (const a of r.actions) {
        rows.push({
          replay_id: r.replay_id,
          t: a.timestamp,
          action: a.action,
          target_node_id: a.target_node_id,
          target_desc: a.target_desc,
          description: a.description,
          url: a.url,
          metadata: { ...a.metadata },
        });
      }
    }
    return rows;
  }

  /**
   * Column contract of the bundle `actions_df` frame.
   *
   * @returns The column list.
   */
  actionsRowColumns(): readonly string[] {
    return [
      "replay_id",
      "t",
      "action",
      "target_node_id",
      "target_desc",
      "description",
      "url",
      "metadata",
    ];
  }

  /**
   * Pre-pandas rows of the Python bundle `events_df` body (projected
   * rrweb rows with `replay_id` added AFTER projection, exactly as
   * Python mutates the row dict — the key lands LAST).
   *
   * @returns The rows list.
   */
  toEventsRows(): readonly Row[] {
    const rows: Row[] = [];
    for (const r of this.replays) {
      for (const event of r.rrweb_events) {
        const row = rrwebEventRow(event);
        row["replay_id"] = r.replay_id;
        rows.push(row);
      }
    }
    return rows;
  }

  /**
   * Column contract of the bundle `events_df` frame (explicit
   * `columns=cols` — `replay_id` FIRST, unlike the row-dict insertion
   * order).
   *
   * @returns The column list.
   */
  eventsRowColumns(): readonly string[] {
    return [
      "replay_id",
      "t",
      "type",
      "source",
      "mouse_type",
      "target_node_id",
      "url",
      "raw",
    ];
  }

  /**
   * Pre-pandas rows of the Python bundle `mixpanel_df` body.
   *
   * @returns The rows list.
   */
  toMixpanelRows(): readonly Row[] {
    const rows: Row[] = [];
    for (const r of this.replays) {
      for (const e of r.mixpanel_events) {
        rows.push({
          replay_id: r.replay_id,
          t: e.event_time,
          event_name: e.event_name,
          properties: e.properties,
        });
      }
    }
    return rows;
  }

  /**
   * Column contract of the bundle `mixpanel_df` frame.
   *
   * @returns The column list.
   */
  mixpanelRowColumns(): readonly string[] {
    return ["replay_id", "t", "event_name", "properties"];
  }

  /**
   * The main `.df` contract — Python's `df` property returns
   * `sessions_df`.
   *
   * @returns.
   */
  toRows(): readonly Row[] {
    return this.toSessionsRows();
  }

  /**
   * Column contract of the main `.df` frame.
   *
   * @returns.
   */
  rowColumns(): readonly string[] {
    return this.sessionsRowColumns();
  }

  /**
   * New bundle keeping only replays matching a predicate — mirror of
   * Python `filter()` (same `computed_at`/`project_id`).
   *
   * @param predicate - Keep test.
   * @returns The filtered bundle.
   */
  filter(predicate: (replay: Replay) => boolean): ReplayBundle {
    return new ReplayBundle({
      replays: this.replays.filter(predicate),
      computed_at: this.computed_at,
      project_id: this.project_id,
    });
  }

  /**
   * Declarative filter — mirror of Python `where()` (all provided
   * conditions must hold).
   *
   * @param options - Filter conditions.
   * @param options.distinct_id - Exact distinct-ID match.
   * @param options.contains_url - Substring of any navigate URL.
   * @param options.has_event - Name of a correlated Mixpanel event.
   * @param options.min_duration_s - Minimum duration (inclusive).
   * @param options.max_duration_s - Maximum duration (inclusive).
   * @returns The filtered bundle.
   */
  where(options: {
    readonly distinct_id?: string | null;
    readonly contains_url?: string | null;
    readonly has_event?: string | null;
    readonly min_duration_s?: number | null;
    readonly max_duration_s?: number | null;
  }): ReplayBundle {
    const distinct_id = options.distinct_id ?? null;
    const contains_url = options.contains_url ?? null;
    const has_event = options.has_event ?? null;
    const min_duration_s = options.min_duration_s ?? null;
    const max_duration_s = options.max_duration_s ?? null;
    const ok = (r: Replay): boolean => {
      if (distinct_id !== null && r.distinct_id !== distinct_id) {
        return false;
      }
      if (
        contains_url !== null &&
        r.actions.every(
          (a) =>
            !(a.action === "navigate" && (a.url ?? "").includes(contains_url)),
        )
      ) {
        return false;
      }
      if (
        has_event !== null &&
        r.mixpanel_events.every((e) => e.event_name !== has_event)
      ) {
        return false;
      }
      if (min_duration_s !== null && r.duration_seconds < min_duration_s) {
        return false;
      }
      return max_duration_s === null || !(r.duration_seconds > max_duration_s);
    };
    return this.filter(ok);
  }

  /**
   * New bundle with the first `n` replays — mirror of Python
   * `head()`.
   *
   * @param n - Max replays to keep. Default: `5`.
   * @returns The truncated bundle.
   */
  head(n = 5): ReplayBundle {
    return new ReplayBundle({
      replays: this.replays.slice(0, n),
      computed_at: this.computed_at,
      project_id: this.project_id,
    });
  }

  /**
   * One row per `(target_desc, normalized_url)` with click counts
   * (Python `elements_df` property, `types.py:13512-13547`). Closed at
   * B5-S3 — the `real_clicks` + `url_normalizer` dependencies landed
   * with the aggregators.
   *
   * Counts exclude focus-only interactions (a real click fires both a
   * `focused` and a `clicked` action; counting both double-counts every
   * click). URLs are normalized via `urlNormalizer` so the same element
   * on parameterized pages aggregates into one row.
   *
   * @returns `{target_desc, url, n_clicks, n_unique_replays}` rows;
   *   empty when the bundle has no genuine clicks.
   */
  toElementsRows(): readonly Row[] {
    const clicks = realClicks(this.toActionsRows());
    if (clicks.length === 0) {
      return [];
    }
    // `groupby(["target_desc", "url"], dropna=False).agg(...)` — pandas
    // sorts the composite group key ascending; the URL column is the
    // NORMALIZED one (`clicks.assign(url=...)`), and Python's
    // `url_normalizer(u) if u else u` leaves a falsy URL untouched.
    const groups = new Map<
      string,
      {
        target_desc: unknown;
        url: unknown;
        n_clicks: number;
        replays: Set<unknown>;
      }
    >();
    for (const row of clicks) {
      const rawUrl = row["url"];
      const url =
        typeof rawUrl === "string" && rawUrl !== ""
          ? urlNormalizer(rawUrl)
          : rawUrl;
      const key = JSON.stringify([row["target_desc"] ?? null, url ?? null]);
      let entry = groups.get(key);
      if (entry === undefined) {
        entry = {
          target_desc: row["target_desc"],
          url,
          n_clicks: 0,
          replays: new Set<unknown>(),
        };
        groups.set(key, entry);
      }
      entry.n_clicks += 1;
      // `n_unique_replays=("replay_id", "nunique")` — pandas' nunique
      // SKIPS NaN; the column is never null in this projection.
      entry.replays.add(row["replay_id"]);
    }
    return [...groups]
      .sort((a, b) => compareCodepoints(a[0], b[0]))
      .map(([, entry]) => ({
        target_desc: entry.target_desc,
        url: entry.url,
        n_clicks: entry.n_clicks,
        n_unique_replays: entry.replays.size,
      }));
  }

  /**
   * Column contract of the `elements_df` frame.
   *
   * @returns The column list.
   */
  elementsRowColumns(): readonly string[] {
    return ["target_desc", "url", "n_clicks", "n_unique_replays"];
  }

  /**
   * Rank the most-clicked targets across every replay in the bundle
   * (Python `top_clicks`, `types.py:13563-13588`).
   *
   * @param n - Maximum number of click targets to return. Default 10.
   * @returns `{target_desc, count}` rows, descending by count.
   */
  topClicks(n = 10): readonly Row[] {
    return topClicks(this, n);
  }

  /**
   * Find rage-click bursts — repeated clicks on one target in a tight
   * window (Python `rage_clicks`, `types.py:13590-13613`).
   *
   * @param options - `threshold` (default 3) / `windowMs` (default
   *   1000).
   * @returns `{replay_id, t_start, target_desc, count}` rows.
   */
  rageClicks(
    options: { threshold?: number; windowMs?: number } = {},
  ): readonly Row[] {
    return rageClicks(this, options);
  }

  /**
   * Find idle stretches between consecutive actions longer than a
   * threshold (Python `long_pauses`, `types.py:13615-13636`).
   *
   * @param thresholdS - Minimum pause length in seconds. Default 10.
   * @returns `{replay_id, t_start, duration_s}` rows.
   */
  longPauses(thresholdS = 10): readonly Row[] {
    return longPauses(this, thresholdS);
  }

  /**
   * New bundle whose action labels contain `actionSequence` as a
   * CONTIGUOUS subsequence (Python `find_pattern`,
   * `types.py:13718-13756`).
   *
   * @param actionSequence - Labels to look for, in order. An empty list
   *   matches every replay (returns a full clone).
   * @param options - Optional `labelFn` override (defaults to
   *   `defaultLabelFn`).
   * @returns The filtered bundle.
   */
  findPattern(
    actionSequence: readonly string[],
    options: { labelFn?: (action: UserAction) => string } = {},
  ): ReplayBundle {
    const fn = options.labelFn ?? defaultLabelFn;
    const target = [...actionSequence];
    if (target.length === 0) {
      return new ReplayBundle({
        replays: [...this.replays],
        computed_at: this.computed_at,
        project_id: this.project_id,
      });
    }
    return this.filter((r) => {
      const labels = r.actions.map((a) => fn(a));
      for (let i = 0; i <= labels.length - target.length; i += 1) {
        if (target.every((label, k) => labels[i + k] === label)) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * New bundle of only the replays that emitted a console error
   * (Python `error_sessions`, `types.py:13758-13781`).
   *
   * @returns The filtered bundle; empty when the bundle has no console
   *   errors.
   */
  errorSessions(): ReplayBundle {
    const ids = new Set(errorSessions(this));
    return this.filter((r) => ids.has(r.replay_id));
  }

  /**
   * New bundle with up to `n` replays, deterministic per `seed`
   * (Python `sample`, `types.py:13808-13831`). Closed at B5-S3 with
   * FULL CPython `random.Random(seed).sample` parity (decision S3-D1,
   * `B5-S3-notes.md`) — the same seed selects the same replays in both
   * runtimes, not merely self-consistently.
   *
   * @param n - How many replays to sample. Default 5.
   * @param seed - Optional integer seed for reproducible sampling.
   *   `null` / omitted needs `entropy` (there is no `os.urandom` seam
   *   in `core`, R9.5).
   * @param entropy - 32-bit seed words used when `seed` is `null`.
   * @returns A bundle whose `replays` has length `min(n, total)`.
   * @throws MixpanelHeadlessError - Code `PY_RANDOM_SEED_UNSUPPORTED`
   *   when neither a seed nor entropy is supplied.
   */
  sample(
    n = 5,
    seed: number | null = null,
    entropy?: readonly number[],
  ): ReplayBundle {
    // Python `rng.sample` raises when k > population; clamp first.
    const k = Math.min(n, this.replays.length);
    const chosen = pythonSample([...this.replays], k, seed, entropy);
    return new ReplayBundle({
      replays: chosen,
      computed_at: this.computed_at,
      project_id: this.project_id,
    });
  }

  /**
   * Markdown rollup of the bundle: header totals plus per-session
   * timelines (Python `summary_markdown`, `types.py:13857-13886`).
   *
   * @returns A markdown string; `"# No replays in bundle\n"` when the
   *   bundle is empty.
   */
  summaryMarkdown(): string {
    if (this.replays.length === 0) {
      return "# No replays in bundle\n";
    }
    const sections = [
      "# Bundle summary",
      "",
      `- replays: ${String(this.replays.length)}`,
    ];
    const rows = this.toSessionsRows();
    if (rows.length > 0) {
      const sum = (column: string): number =>
        rows.reduce((acc, row) => acc + Number(row[column] ?? 0), 0);
      sections.push(`- total events: ${String(Math.trunc(sum("n_events")))}`);
      sections.push(`- total actions: ${String(Math.trunc(sum("n_actions")))}`);
      sections.push(`- total errors: ${String(Math.trunc(sum("n_errors")))}`);
    }
    sections.push("");
    for (const r of this.replays) {
      // Python wraps each per-replay render in `except NotImplementedError`
      // — a Phase-2-era holdover from the unported `summary_markdown`.
      // The member is implemented now and cannot raise it, so the
      // fallback branch is unreachable in both runtimes.
      sections.push(r.summaryMarkdown(), "\n---\n");
    }
    return sections.join("\n");
  }

  /**
   * Identity copy — mirror of Python `join_mixpanel_events()` (the
   * Python body ignores `properties` and returns a copy).
   *
   * @param properties - Ignored, as in Python.
   * @returns A copy of this bundle.
   */
  joinMixpanelEvents(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for arity parity with Python's `join_mixpanel_events(properties=None)`, whose body ignores it too
    _properties?: readonly string[] | null,
  ): ReplayBundle {
    return new ReplayBundle({
      replays: [...this.replays],
      computed_at: this.computed_at,
      project_id: this.project_id,
    });
  }

  /**
   * Action-count comparison rows against another bundle — mirror of
   * Python `compare()` (value counts per action label, sorted union
   * of keys).
   *
   * @param other - The bundle to compare against.
   * @returns `{action, self_count, other_count, delta}` rows.
   */
  compareRows(other: ReplayBundle): readonly Row[] {
    const countByAction = (bundle: ReplayBundle): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const row of bundle.toActionsRows()) {
        const action = row["action"] as string;
        counts.set(action, (counts.get(action) ?? 0) + 1);
      }
      return counts;
    };
    const a = countByAction(this);
    const b = countByAction(other);
    const keys = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) =>
      x < y ? -1 : x > y ? 1 : 0,
    );
    return keys.map((k) => ({
      action: k,
      self_count: a.get(k) ?? 0,
      other_count: b.get(k) ?? 0,
      delta: (a.get(k) ?? 0) - (b.get(k) ?? 0),
    }));
  }

  /**
   * Column contract of the `compare()` frame (explicit
   * `columns=[...]`).
   *
   * @returns The column list.
   */
  compareRowColumns(): readonly string[] {
    return ["action", "self_count", "other_count", "delta"];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      computed_at: this.computed_at,
      project_id: this.project_id,
      replays: this.replays.map((r) => r.toJSON()),
    };
  }

  /**
   * Strictly decode a recorded field-walk payload (`replays` accepts
   * decoded instances or plain dicts).
   *
   * @param raw - The payload.
   * @returns The reconstructed instance (guards fire).
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @throws ParamValidationError - When the RB1 guard fires.
   * @internal
   */
  static fromDict(raw: unknown): ReplayBundle {
    const cls = "ReplayBundle";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "replays",
        "computed_at",
        "project_id",
        "_df_cache",
        "_sessions_df_cache",
        "_actions_df_cache",
        "_events_df_cache",
        "_mixpanel_df_cache",
        "_elements_df_cache",
      ]),
      cls,
    );
    for (const cache of [
      "_df_cache",
      "_sessions_df_cache",
      "_actions_df_cache",
      "_events_df_cache",
      "_mixpanel_df_cache",
      "_elements_df_cache",
    ]) {
      expectNullCache(payload, cache, cls);
    }
    if (
      Object.hasOwn(payload, "replays") &&
      !Array.isArray(payload["replays"])
    ) {
      decodeFail(cls, "replays", "array", payload["replays"]);
    }
    return new ReplayBundle({
      ...(Object.hasOwn(payload, "replays")
        ? {
            replays: (payload["replays"] as readonly unknown[]).map((item) =>
              item instanceof Replay ? item : Replay.fromDict(item),
            ),
          }
        : {}),
      ...(Object.hasOwn(payload, "computed_at")
        ? { computed_at: expectStr(payload, "computed_at", cls) }
        : {}),
      ...(Object.hasOwn(payload, "project_id")
        ? { project_id: expectInt(payload, "project_id", cls) }
        : {}),
    });
  }
}
