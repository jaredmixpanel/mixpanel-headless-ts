/**
 * Per-replay session-replay result dataclasses — TS ports of
 * `ReplaySummary`, `SignedReplay`, `ReplayEvent` and `Replay` from
 * `mixpanel_headless/types.py`, plus the `events_df` row projection
 * `rrwebEventRow` they and `ReplayBundle` share.
 *
 * Constructor guards fire exactly as Python's `__post_init__` does, IN
 * THE SAME CHECK ORDER, one comment per registry code — their `types.*`
 * guard vectors replay in the conformance corpus.
 *
 * `UserAction` lives in `replays/user-action.ts` (the family's shared
 * leaf) and `ReplayBundle` in `./replays.ts` (the top of the family,
 * which imports the aggregations). `Replay.summaryMarkdown` composes
 * the rrweb analyzer's `renderMarkdown`, mirroring Python's deferred
 * function-local import at the same call site.
 *
 * The codec-visible cache slots stay `null`: the pandas frames they
 * memoized are row-array projections here, and the recorded field-walk
 * payloads still expect `null`.
 */

import { pythonFloatStr } from "../../compat/index.js";
import { ParamValidationError } from "../../errors.js";
import { renderMarkdown } from "../../replays/rrweb-analyzer.js";
import { UserAction } from "../../replays/user-action.js";
import {
  decodeFail,
  expectInt,
  expectNullCache,
  expectPayload,
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
  const rawData = event["data"];
  const data: Readonly<Record<string, unknown>> = isPlainRecord(rawData)
    ? rawData
    : {};
  const source =
    type_ === RRWEB_TYPE_INCREMENTAL_SNAPSHOT ? (data["source"] ?? null) : null;
  let mouseType: number | null = null;
  if (source === RRWEB_SOURCE_MOUSE_INTERACTION) {
    const rawMouseType = data["type"];
    if (typeof rawMouseType === "number" && Number.isInteger(rawMouseType)) {
      mouseType = rawMouseType;
    }
  }
  const rawId = data["id"];
  const targetNodeId =
    typeof rawId === "number" && Number.isInteger(rawId) ? rawId : null;
  const url = type_ === RRWEB_TYPE_META ? (data["href"] ?? null) : null;
  const timestamp = event["timestamp"];
  return {
    t: typeof timestamp === "number" ? Math.trunc(timestamp) : 0,
    type: type_,
    source,
    mouse_type: mouseType,
    target_node_id: targetNodeId,
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
    // `string` on purpose: SR3 is a runtime guard for untyped callers.
    const env: string = this.env;
    if (env !== "prod" && env !== "dev") {
      throw new ParamValidationError(
        `env must be 'prod' or 'dev'; got ${JSON.stringify(env)}`,
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
    const signedAtRepr =
      Number.isFinite(this.signed_at) && Number.isInteger(this.signed_at)
        ? pythonFloatStr(this.signed_at)
        : String(this.signed_at);
    return (
      `SignedReplay(replay_id='${this.replay_id}', url='${this.url}', ` +
      `query_string='${masked}', env='${this.env}', signed_at=${signedAtRepr})`
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
    const signedAt = floatValue(payload["signed_at"]);
    if (signedAt === undefined) {
      decodeFail(cls, "signed_at", "number", payload["signed_at"]);
    }
    return new SignedReplay({
      replay_id: expectStr(payload, "replay_id", cls),
      url: expectStr(payload, "url", cls),
      query_string: expectStr(payload, "query_string", cls),
      env: expectStr(payload, "env", cls) as "prod" | "dev",
      signed_at: signedAt,
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
