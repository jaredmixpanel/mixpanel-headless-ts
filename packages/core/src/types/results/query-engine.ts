/**
 * Query-engine result dataclasses (phase2-design C6-c, packet P2-6) —
 * TS ports of `QueryResult`, `FunnelQueryResult`,
 * `RetentionQueryResult`, `FlowTreeNode`, `FlowQueryResult`, and
 * `UserQueryResult` from `mixpanel_headless/types.py`.
 *
 * These carry the four DIVERGENT `.df` row contracts called out in the
 * phase2-design C6 per-class row specs (`QueryResult` four column
 * layouts; `UserQueryResult` five branches + post-frame column
 * reorder; `FlowQueryResult` mode-aware frames + auxiliary
 * `nodes_df`/`edges_df`/`trees_df`).
 */

import { pythonInt } from "../../compat/index.js";
import { MixpanelHeadlessError } from "../../errors.js";
import type {
  FlowAnchorType,
  FlowChartType,
  FlowNodeType,
} from "../literals.js";
import {
  decodeFail,
  expectArray,
  expectBool,
  expectFloat,
  expectInt,
  expectNullCache,
  expectPayload,
  expectRecord,
  expectRecordArray,
  expectStr,
  expectStrArray,
  firstOccurrenceColumns,
  floatValue,
  isPlainRecord,
  pyTruthy,
  rejectUnknownKeys,
  type Row,
} from "./result-base.js";

/**
 * Parse a value to int, returning `default_` on failure — mirror of
 * `types._safe_int` (the flows API returns `totalCount` as a string).
 * Python's `warnings.warn` side channel is not ported (out of
 * contract).
 *
 * @param value - Value to parse (typically a numeric string).
 * @param default_ - Fallback when parsing fails. Default: `0`.
 * @returns Parsed integer, or `default_`.
 * @internal
 */
export function safeInt(value: unknown, default_ = 0): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "boolean") {
    // Python: bool is excluded from the int fast path and warned on.
    return default_;
  }
  if (typeof value === "string") {
    // Python: try int(value) except ValueError -> default. `pythonInt`
    // IS the CPython int(str) grammar (underscores, non-ASCII Nd
    // digits, the CPython numeric-whitespace surround) — the previous
    // `\s`-regex + parseInt pair diverged on all three plus U+FEFF
    // (B0-gate RUN.md 2026-08-15). PY_INT_UNSAFE_INTEGER (>2^53-1,
    // where CPython returns the exact big int) also maps to the
    // default: R4.5 leaves no faithful numeric representation (the
    // playbook Discrepancy #6 pattern; the old parseInt path returned
    // an IMPRECISE number there, which was no more faithful).
    try {
      return pythonInt(value);
    } catch (cause) {
      // Guarded catch (b0-review-resolution F3/A2 pattern): only the
      // coded parse rejections are the ValueError analog; anything
      // else propagates.
      if (cause instanceof MixpanelHeadlessError) {
        return default_;
      }
      throw cause;
    }
  }
  return default_;
}

/**
 * Strip timezone offsets from ISO timestamps — mirror of
 * `types._normalize_date_key`.
 *
 * @param date_key - Date string from an API response.
 * @returns The first 19 characters when the key is longer than 19 and
 *   contains a `T`; otherwise unchanged.
 * @internal
 */
export function normalizeDateKey(date_key: string): string {
  if (date_key.length > 19 && date_key.includes("T")) {
    return date_key.slice(0, 19);
  }
  return date_key;
}

/**
 * Python `sorted()` over string keys (codepoint-ordered `<`).
 *
 * @param keys - Keys to sort.
 * @returns A new sorted array.
 */
function sortedKeys(keys: readonly string[]): readonly string[] {
  return [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ---------------------------------------------------------------------------
// QueryResult
// ---------------------------------------------------------------------------

/** Declared fields of {@link QueryResult} (Python field order). */
export interface QueryResultFields {
  /** When the query was computed (ISO text). */
  readonly computed_at: string;
  /** Effective start date from the response. */
  readonly from_date: string;
  /** Effective end date from the response. */
  readonly to_date: string;
  /** Column headers from the insights response. Default: `[]`. */
  readonly headers?: readonly string[];
  /** Query result data (structure varies by mode). Default: `{}`. */
  readonly series?: Readonly<Record<string, unknown>>;
  /** Generated bookmark params sent to the API. Default: `{}`. */
  readonly params?: Readonly<Record<string, unknown>>;
  /** Response metadata. Default: `{}`. */
  readonly meta?: Readonly<Record<string, unknown>>;
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * Structured output of a `Workspace.query()` execution — TS port of
 * `types.QueryResult`.
 *
 * `.df` picks among FOUR column layouts (timeseries / total /
 * segmented timeseries / segmented total) with an explicit per-branch
 * column list — phase2-design C6 per-class row spec.
 */
export class QueryResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** When the query was computed (ISO text). */
  readonly computed_at: string;

  /** Effective start date from the response. */
  readonly from_date: string;

  /** Effective end date from the response. */
  readonly to_date: string;

  /** Column headers from the insights response. */
  readonly headers: readonly string[];

  /** Query result data (structure varies by mode). */
  readonly series: Readonly<Record<string, unknown>>;

  /** Generated bookmark params sent to the API. */
  readonly params: Readonly<Record<string, unknown>>;

  /** Response metadata. */
  readonly meta: Readonly<Record<string, unknown>>;

  /**
   * Create a query result.
   *
   * @param fields - Declared fields; Python defaults apply to absent
   *   optionals.
   */
  constructor(fields: QueryResultFields) {
    this.computed_at = fields.computed_at;
    this.from_date = fields.from_date;
    this.to_date = fields.to_date;
    this.headers = fields.headers ?? [];
    this.series = fields.series ?? {};
    this.params = fields.params ?? {};
    this.meta = fields.meta ?? {};
  }

  /**
   * Build the rows plus the mode flags, exactly as the Python `.df`
   * body does in one pass.
   *
   * @returns Rows and the has-segments/has-dates flags.
   */
  #buildRows(): {
    readonly rows: readonly Row[];
    readonly has_segments: boolean;
    readonly has_dates: boolean;
  } {
    const rows: Row[] = [];
    let has_segments = false;
    let has_dates = false;
    for (const [metric_name, date_values] of Object.entries(this.series)) {
      if (!isPlainRecord(date_values)) {
        continue;
      }
      const first_value = Object.values(date_values)[0];
      if (isPlainRecord(first_value)) {
        has_segments = true;
        for (const [segment_name, segment_data] of Object.entries(
          date_values,
        )) {
          if (!isPlainRecord(segment_data)) {
            continue;
          }
          for (const [date_key, value] of Object.entries(segment_data)) {
            if (date_key === "all") {
              rows.push({
                event: metric_name,
                segment: segment_name,
                count: value,
              });
            } else {
              has_dates = true;
              rows.push({
                date: normalizeDateKey(date_key),
                event: metric_name,
                segment: segment_name,
                count: value,
              });
            }
          }
        }
      } else {
        for (const [date_key, value] of Object.entries(date_values)) {
          if (date_key === "all") {
            rows.push({ event: metric_name, count: value });
          } else {
            has_dates = true;
            rows.push({
              date: normalizeDateKey(date_key),
              event: metric_name,
              count: value,
            });
          }
        }
      }
    }
    return { rows, has_segments, has_dates };
  }

  /**
   * Pre-pandas rows of the Python `.df` body (mode-dependent row key
   * sets; see the class doc).
   *
   * @returns The rows list.
   */
  toRows(): readonly Row[] {
    return this.#buildRows().rows;
  }

  /**
   * Column contract of the `.df` frame: the four explicit per-branch
   * layouts for non-empty rows, or the Python empty-frame constant
   * `["date", "event", "count"]`.
   *
   * @returns The column list.
   */
  rowColumns(): readonly string[] {
    const { rows, has_segments, has_dates } = this.#buildRows();
    if (rows.length === 0) {
      return ["date", "event", "count"];
    }
    if (has_segments && has_dates) {
      return ["date", "event", "segment", "count"];
    }
    if (has_segments) {
      return ["event", "segment", "count"];
    }
    if (has_dates) {
      return ["date", "event", "count"];
    }
    return ["event", "count"];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      computed_at: this.computed_at,
      from_date: this.from_date,
      to_date: this.to_date,
      headers: this.headers,
      series: this.series,
      params: this.params,
      meta: this.meta,
    };
  }

  /**
   * Strictly decode a recorded field-walk payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): QueryResult {
    const cls = "QueryResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "computed_at",
        "from_date",
        "to_date",
        "headers",
        "series",
        "params",
        "meta",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    return new QueryResult({
      computed_at: expectStr(payload, "computed_at", cls),
      from_date: expectStr(payload, "from_date", cls),
      to_date: expectStr(payload, "to_date", cls),
      ...(Object.hasOwn(payload, "headers")
        ? { headers: expectStrArray(payload, "headers", cls) }
        : {}),
      ...(Object.hasOwn(payload, "series")
        ? { series: expectRecord(payload, "series", cls) }
        : {}),
      ...(Object.hasOwn(payload, "params")
        ? { params: expectRecord(payload, "params", cls) }
        : {}),
      ...(Object.hasOwn(payload, "meta")
        ? { meta: expectRecord(payload, "meta", cls) }
        : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// FunnelQueryResult
// ---------------------------------------------------------------------------

/** Declared fields of {@link FunnelQueryResult} (Python field order). */
export interface FunnelQueryResultFields {
  /** When the query was computed (ISO text). */
  readonly computed_at: string;
  /** Effective start date from the response. */
  readonly from_date: string;
  /** Effective end date from the response. */
  readonly to_date: string;
  /** Per-step aggregate dicts from the funnels response. Default: `[]`. */
  readonly steps_data?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Raw series payload. Default: `{}`. */
  readonly series?: Readonly<Record<string, unknown>>;
  /** Generated bookmark params sent to the API. Default: `{}`. */
  readonly params?: Readonly<Record<string, unknown>>;
  /** Response metadata. Default: `{}`. */
  readonly meta?: Readonly<Record<string, unknown>>;
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * Structured output of a `Workspace.query_funnel()` execution — TS
 * port of `types.FunnelQueryResult`.
 */
export class FunnelQueryResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** When the query was computed (ISO text). */
  readonly computed_at: string;

  /** Effective start date from the response. */
  readonly from_date: string;

  /** Effective end date from the response. */
  readonly to_date: string;

  /** Per-step aggregate dicts from the funnels response. */
  readonly steps_data: ReadonlyArray<Readonly<Record<string, unknown>>>;

  /** Raw series payload. */
  readonly series: Readonly<Record<string, unknown>>;

  /** Generated bookmark params sent to the API. */
  readonly params: Readonly<Record<string, unknown>>;

  /** Response metadata. */
  readonly meta: Readonly<Record<string, unknown>>;

  /**
   * Create a funnel query result.
   *
   * @param fields - Declared fields; Python defaults apply to absent
   *   optionals.
   */
  constructor(fields: FunnelQueryResultFields) {
    this.computed_at = fields.computed_at;
    this.from_date = fields.from_date;
    this.to_date = fields.to_date;
    this.steps_data = fields.steps_data ?? [];
    this.series = fields.series ?? {};
    this.params = fields.params ?? {};
    this.meta = fields.meta ?? {};
  }

  /**
   * Overall conversion rate — Python's derived property:
   * `float(steps_data[-1].get("overall_conv_ratio", 0.0))`, `0.0`
   * when there are no steps.
   *
   * @returns The overall conversion rate.
   */
  get overall_conversion_rate(): number {
    if (this.steps_data.length === 0) {
      return 0.0;
    }
    const last = this.steps_data[this.steps_data.length - 1];
    const value = Object.hasOwn(last ?? {}, "overall_conv_ratio")
      ? last?.["overall_conv_ratio"]
      : 0.0;
    // Python applies float(...) to the looked-up value (numeric
    // strings coerce; anything else would raise there too).
    if (typeof value === "string") {
      return Number(value);
    }
    return floatValue(value) ?? 0.0;
  }

  /**
   * Pre-pandas rows of the Python `.df` body: one row per step with
   * the seven fixed columns and Python's per-key defaults (`event` →
   * `"Step {i}"` with 1-based `i`, `count` → `0`, ratios/times →
   * `0.0`).
   *
   * @returns The rows list.
   */
  toRows(): readonly Row[] {
    return this.steps_data.map((step, index) => {
      const i = index + 1;
      return {
        step: i,
        event: step["event"] ?? `Step ${String(i)}`,
        count: step["count"] ?? 0,
        step_conv_ratio: step["step_conv_ratio"] ?? 0.0,
        overall_conv_ratio: step["overall_conv_ratio"] ?? 0.0,
        avg_time: step["avg_time"] ?? 0.0,
        avg_time_from_start: step["avg_time_from_start"] ?? 0.0,
      };
    });
  }

  /**
   * Column contract of the `.df` frame (explicit `columns=cols` in
   * Python for empty AND non-empty).
   *
   * @returns The column list.
   */
  rowColumns(): readonly string[] {
    return [
      "step",
      "event",
      "count",
      "step_conv_ratio",
      "overall_conv_ratio",
      "avg_time",
      "avg_time_from_start",
    ];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      computed_at: this.computed_at,
      from_date: this.from_date,
      to_date: this.to_date,
      steps_data: this.steps_data,
      series: this.series,
      params: this.params,
      meta: this.meta,
    };
  }

  /**
   * Strictly decode a recorded field-walk payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): FunnelQueryResult {
    const cls = "FunnelQueryResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "computed_at",
        "from_date",
        "to_date",
        "steps_data",
        "series",
        "params",
        "meta",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    return new FunnelQueryResult({
      computed_at: expectStr(payload, "computed_at", cls),
      from_date: expectStr(payload, "from_date", cls),
      to_date: expectStr(payload, "to_date", cls),
      ...(Object.hasOwn(payload, "steps_data")
        ? { steps_data: expectRecordArray(payload, "steps_data", cls) }
        : {}),
      ...(Object.hasOwn(payload, "series")
        ? { series: expectRecord(payload, "series", cls) }
        : {}),
      ...(Object.hasOwn(payload, "params")
        ? { params: expectRecord(payload, "params", cls) }
        : {}),
      ...(Object.hasOwn(payload, "meta")
        ? { meta: expectRecord(payload, "meta", cls) }
        : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// RetentionQueryResult
// ---------------------------------------------------------------------------

/** Declared fields of {@link RetentionQueryResult} (Python field order). */
export interface RetentionQueryResultFields {
  /** When the query was computed (ISO text). */
  readonly computed_at: string;
  /** Effective start date from the response. */
  readonly from_date: string;
  /** Effective end date from the response. */
  readonly to_date: string;
  /** Unsegmented cohorts: `{date: {first, counts, rates, ...}}`. Default: `{}`. */
  readonly cohorts?: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  /** Average retention payload. Default: `{}`. */
  readonly average?: Readonly<Record<string, unknown>>;
  /** Generated bookmark params sent to the API. Default: `{}`. */
  readonly params?: Readonly<Record<string, unknown>>;
  /** Response metadata. Default: `{}`. */
  readonly meta?: Readonly<Record<string, unknown>>;
  /** Segmented cohorts: `{segment: {date: cohort}}`. Default: `{}`. */
  readonly segments?: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>
  >;
  /** Per-segment averages. Default: `{}`. */
  readonly segment_averages?: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * Structured output of a `Workspace.query_retention()` execution — TS
 * port of `types.RetentionQueryResult`.
 */
export class RetentionQueryResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** When the query was computed (ISO text). */
  readonly computed_at: string;

  /** Effective start date from the response. */
  readonly from_date: string;

  /** Effective end date from the response. */
  readonly to_date: string;

  /** Unsegmented cohorts: `{date: {first, counts, rates, ...}}`. */
  readonly cohorts: Readonly<Record<string, Readonly<Record<string, unknown>>>>;

  /** Average retention payload. */
  readonly average: Readonly<Record<string, unknown>>;

  /** Generated bookmark params sent to the API. */
  readonly params: Readonly<Record<string, unknown>>;

  /** Response metadata. */
  readonly meta: Readonly<Record<string, unknown>>;

  /** Segmented cohorts: `{segment: {date: cohort}}`. */
  readonly segments: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>
  >;

  /** Per-segment averages. */
  readonly segment_averages: Readonly<
    Record<string, Readonly<Record<string, unknown>>>
  >;

  /**
   * Create a retention query result.
   *
   * @param fields - Declared fields; Python defaults apply to absent
   *   optionals.
   */
  constructor(fields: RetentionQueryResultFields) {
    this.computed_at = fields.computed_at;
    this.from_date = fields.from_date;
    this.to_date = fields.to_date;
    this.cohorts = fields.cohorts ?? {};
    this.average = fields.average ?? {};
    this.params = fields.params ?? {};
    this.meta = fields.meta ?? {};
    this.segments = fields.segments ?? {};
    this.segment_averages = fields.segment_averages ?? {};
  }

  /**
   * Build one bucket-expansion row set for a cohort dict, exactly as
   * both Python branches do (`counts` enumerate; `rates[i]` with a
   * `0.0` fallback past the end).
   *
   * @param cohort - The cohort payload.
   * @param base - Leading row keys (`segment`/`cohort_date`).
   * @returns The bucket rows.
   */
  static #cohortRows(
    cohort: Readonly<Record<string, unknown>>,
    base: Readonly<Row>,
  ): readonly Row[] {
    const counts = Array.isArray(cohort["counts"])
      ? (cohort["counts"] as readonly unknown[])
      : [];
    const rates = Array.isArray(cohort["rates"])
      ? (cohort["rates"] as readonly unknown[])
      : [];
    return counts.map((count, i) => ({
      ...base,
      bucket: i,
      count,
      rate: i < rates.length ? rates[i] : 0.0,
    }));
  }

  /**
   * Pre-pandas rows of the Python `.df` body: segmented rows
   * (`segment, cohort_date, bucket, count, rate`) when `segments` is
   * non-empty, else unsegmented rows (`cohort_date, bucket, count,
   * rate`); keys iterated in sorted order.
   *
   * @returns The rows list.
   */
  toRows(): readonly Row[] {
    const rows: Row[] = [];
    if (Object.keys(this.segments).length > 0) {
      for (const segment_name of sortedKeys(Object.keys(this.segments))) {
        const segment_cohorts = this.segments[segment_name] ?? {};
        for (const cohort_date of sortedKeys(Object.keys(segment_cohorts))) {
          const cohort = segment_cohorts[cohort_date] ?? {};
          rows.push(
            ...RetentionQueryResult.#cohortRows(cohort, {
              segment: segment_name,
              cohort_date,
            }),
          );
        }
      }
    } else {
      for (const cohort_date of sortedKeys(Object.keys(this.cohorts))) {
        const cohort = this.cohorts[cohort_date] ?? {};
        rows.push(...RetentionQueryResult.#cohortRows(cohort, { cohort_date }));
      }
    }
    return rows;
  }

  /**
   * Column contract of the `.df` frame: the per-branch explicit
   * `columns=cols` list (segmented adds `segment` first).
   *
   * @returns The column list.
   */
  rowColumns(): readonly string[] {
    return Object.keys(this.segments).length > 0
      ? ["segment", "cohort_date", "bucket", "count", "rate"]
      : ["cohort_date", "bucket", "count", "rate"];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`
   * (`segments`/`segment_averages` emitted ONLY when non-empty).
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    const d: Record<string, unknown> = {
      computed_at: this.computed_at,
      from_date: this.from_date,
      to_date: this.to_date,
      cohorts: this.cohorts,
      average: this.average,
      params: this.params,
      meta: this.meta,
    };
    if (Object.keys(this.segments).length > 0) {
      d["segments"] = this.segments;
    }
    if (Object.keys(this.segment_averages).length > 0) {
      d["segment_averages"] = this.segment_averages;
    }
    return d;
  }

  /**
   * Strictly decode a recorded field-walk payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): RetentionQueryResult {
    const cls = "RetentionQueryResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "computed_at",
        "from_date",
        "to_date",
        "cohorts",
        "average",
        "params",
        "meta",
        "segments",
        "segment_averages",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    return new RetentionQueryResult({
      computed_at: expectStr(payload, "computed_at", cls),
      from_date: expectStr(payload, "from_date", cls),
      to_date: expectStr(payload, "to_date", cls),
      ...(Object.hasOwn(payload, "cohorts")
        ? {
            cohorts: expectRecord(payload, "cohorts", cls) as Readonly<
              Record<string, Readonly<Record<string, unknown>>>
            >,
          }
        : {}),
      ...(Object.hasOwn(payload, "average")
        ? { average: expectRecord(payload, "average", cls) }
        : {}),
      ...(Object.hasOwn(payload, "params")
        ? { params: expectRecord(payload, "params", cls) }
        : {}),
      ...(Object.hasOwn(payload, "meta")
        ? { meta: expectRecord(payload, "meta", cls) }
        : {}),
      ...(Object.hasOwn(payload, "segments")
        ? {
            segments: expectRecord(payload, "segments", cls) as Readonly<
              Record<
                string,
                Readonly<Record<string, Readonly<Record<string, unknown>>>>
              >
            >,
          }
        : {}),
      ...(Object.hasOwn(payload, "segment_averages")
        ? {
            segment_averages: expectRecord(
              payload,
              "segment_averages",
              cls,
            ) as Readonly<Record<string, Readonly<Record<string, unknown>>>>,
          }
        : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// FlowTreeNode
// ---------------------------------------------------------------------------

/** Declared fields of {@link FlowTreeNode} (Python field order). */
export interface FlowTreeNodeFields {
  /** Event name at this node. */
  readonly event: string;
  /** Node type. */
  readonly type: FlowNodeType;
  /** Zero-based step number. */
  readonly step_number: number;
  /** Users reaching this node. */
  readonly total_count: number;
  /** Users dropping off at this node. Default: `0`. */
  readonly drop_off_count?: number;
  /** Users converting from this node. Default: `0`. */
  readonly converted_count?: number;
  /** Anchor type. Default: `"NORMAL"`. */
  readonly anchor_type?: FlowAnchorType;
  /** Whether the node was computed (vs observed). Default: `false`. */
  readonly is_computed?: boolean;
  /** Child nodes (Python tuple → ReadonlyArray). Default: `[]`. */
  readonly children?: readonly FlowTreeNode[];
  /** Time percentiles from flow start. Default: `{}`. */
  readonly time_percentiles_from_start?: Readonly<Record<string, unknown>>;
  /** Time percentiles from the previous step. Default: `{}`. */
  readonly time_percentiles_from_prev?: Readonly<Record<string, unknown>>;
}

/**
 * One node of a tree-mode flow query — TS port of
 * `types.FlowTreeNode` (`to_anytree()` is NOT ported — it returns
 * `anytree` nodes with no vendored TS twin; TODO(port): revisit with
 * batch B5).
 */
export class FlowTreeNode {
  /** Event name at this node. */
  readonly event: string;

  /** Node type. */
  readonly type: FlowNodeType;

  /** Zero-based step number. */
  readonly step_number: number;

  /** Users reaching this node. */
  readonly total_count: number;

  /** Users dropping off at this node. */
  readonly drop_off_count: number;

  /** Users converting from this node. */
  readonly converted_count: number;

  /** Anchor type. */
  readonly anchor_type: FlowAnchorType;

  /** Whether the node was computed (vs observed). */
  readonly is_computed: boolean;

  /** Child nodes (Python tuple → ReadonlyArray). */
  readonly children: readonly FlowTreeNode[];

  /** Time percentiles from flow start. */
  readonly time_percentiles_from_start: Readonly<Record<string, unknown>>;

  /** Time percentiles from the previous step. */
  readonly time_percentiles_from_prev: Readonly<Record<string, unknown>>;

  /**
   * Create a flow tree node.
   *
   * @param fields - Declared fields; Python defaults apply to absent
   *   optionals.
   */
  constructor(fields: FlowTreeNodeFields) {
    this.event = fields.event;
    this.type = fields.type;
    this.step_number = fields.step_number;
    this.total_count = fields.total_count;
    this.drop_off_count = fields.drop_off_count ?? 0;
    this.converted_count = fields.converted_count ?? 0;
    this.anchor_type = fields.anchor_type ?? "NORMAL";
    this.is_computed = fields.is_computed ?? false;
    this.children = fields.children ?? [];
    this.time_percentiles_from_start = fields.time_percentiles_from_start ?? {};
    this.time_percentiles_from_prev = fields.time_percentiles_from_prev ?? {};
  }

  /**
   * Longest child chain below this node (`0` for a leaf).
   *
   * @returns The depth.
   */
  get depth(): number {
    if (this.children.length === 0) {
      return 0;
    }
    return 1 + Math.max(...this.children.map((c) => c.depth));
  }

  /**
   * Total nodes in this subtree (including this node).
   *
   * @returns The node count.
   */
  get node_count(): number {
    return 1 + this.children.reduce((sum, c) => sum + c.node_count, 0);
  }

  /**
   * Leaves in this subtree (`1` for a leaf).
   *
   * @returns The leaf count.
   */
  get leaf_count(): number {
    if (this.children.length === 0) {
      return 1;
    }
    return this.children.reduce((sum, c) => sum + c.leaf_count, 0);
  }

  /**
   * `converted_count / total_count` (`0.0` when `total_count == 0`).
   *
   * @returns The conversion rate.
   */
  get conversion_rate(): number {
    if (this.total_count === 0) {
      return 0.0;
    }
    return this.converted_count / this.total_count;
  }

  /**
   * `drop_off_count / total_count` (`0.0` when `total_count == 0`).
   *
   * @returns The drop-off rate.
   */
  get drop_off_rate(): number {
    if (this.total_count === 0) {
      return 0.0;
    }
    return this.drop_off_count / this.total_count;
  }

  /**
   * Every root-to-leaf path through this subtree.
   *
   * @returns Paths as node lists (a single `[this]` path for a leaf).
   */
  allPaths(): ReadonlyArray<readonly FlowTreeNode[]> {
    if (this.children.length === 0) {
      return [[this]];
    }
    const paths: FlowTreeNode[][] = [];
    for (const child of this.children) {
      for (const child_path of child.allPaths()) {
        paths.push([this, ...child_path]);
      }
    }
    return paths;
  }

  /**
   * Every node in this subtree whose event matches.
   *
   * @param event - Event name to match.
   * @returns Matching nodes in preorder.
   */
  find(event: string): readonly FlowTreeNode[] {
    const results: FlowTreeNode[] = [];
    if (this.event === event) {
      results.push(this);
    }
    for (const child of this.children) {
      results.push(...child.find(event));
    }
    return results;
  }

  /**
   * All nodes of this subtree in preorder.
   *
   * @returns The flattened node list.
   */
  flatten(): readonly FlowTreeNode[] {
    const result: FlowTreeNode[] = [this];
    for (const child of this.children) {
      result.push(...child.flatten());
    }
    return result;
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`
   * (recursive over `children`).
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      event: this.event,
      type: this.type,
      step_number: this.step_number,
      total_count: this.total_count,
      drop_off_count: this.drop_off_count,
      converted_count: this.converted_count,
      anchor_type: this.anchor_type,
      is_computed: this.is_computed,
      children: this.children.map((c) => c.toJSON()),
      time_percentiles_from_start: this.time_percentiles_from_start,
      time_percentiles_from_prev: this.time_percentiles_from_prev,
    };
  }

  /**
   * ASCII-art rendering of this subtree, byte-identical to Python's
   * `render()` (box-drawing connectors, `event (total_count)` lines).
   *
   * @param _prefix - Accumulated indentation (internal recursion).
   * @param _is_last - Whether this node is its parent's last child.
   * @param _is_root - Whether this node is the render root.
   * @returns The rendered text (trailing newline included).
   */
  render(_prefix = "", _is_last = true, _is_root = true): string {
    let line: string;
    let child_prefix: string;
    if (_is_root) {
      line = `${this.event} (${String(this.total_count)})\n`;
      child_prefix = "";
    } else {
      const connector = _is_last ? "└── " : "├── ";
      line = `${_prefix}${connector}${this.event} (${String(this.total_count)})\n`;
      child_prefix = _prefix + (_is_last ? "    " : "│   ");
    }
    this.children.forEach((child, i) => {
      const is_last_child = i === this.children.length - 1;
      line += child.render(child_prefix, is_last_child, false);
    });
    return line;
  }

  /**
   * Strictly decode a recorded payload (recursive over `children`).
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): FlowTreeNode {
    const cls = "FlowTreeNode";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "event",
        "type",
        "step_number",
        "total_count",
        "drop_off_count",
        "converted_count",
        "anchor_type",
        "is_computed",
        "children",
        "time_percentiles_from_start",
        "time_percentiles_from_prev",
      ]),
      cls,
    );
    return new FlowTreeNode({
      event: expectStr(payload, "event", cls),
      type: expectStr(payload, "type", cls) as FlowNodeType,
      step_number: expectInt(payload, "step_number", cls),
      total_count: expectInt(payload, "total_count", cls),
      ...(Object.hasOwn(payload, "drop_off_count")
        ? { drop_off_count: expectInt(payload, "drop_off_count", cls) }
        : {}),
      ...(Object.hasOwn(payload, "converted_count")
        ? { converted_count: expectInt(payload, "converted_count", cls) }
        : {}),
      ...(Object.hasOwn(payload, "anchor_type")
        ? {
            anchor_type: expectStr(
              payload,
              "anchor_type",
              cls,
            ) as FlowAnchorType,
          }
        : {}),
      ...(Object.hasOwn(payload, "is_computed")
        ? { is_computed: expectBool(payload, "is_computed", cls) }
        : {}),
      ...(Object.hasOwn(payload, "children")
        ? {
            children: expectArray(payload, "children", cls).map((item) =>
              FlowTreeNode.fromDict(item),
            ),
          }
        : {}),
      ...(Object.hasOwn(payload, "time_percentiles_from_start")
        ? {
            time_percentiles_from_start: expectRecord(
              payload,
              "time_percentiles_from_start",
              cls,
            ),
          }
        : {}),
      ...(Object.hasOwn(payload, "time_percentiles_from_prev")
        ? {
            time_percentiles_from_prev: expectRecord(
              payload,
              "time_percentiles_from_prev",
              cls,
            ),
          }
        : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// FlowQueryResult
// ---------------------------------------------------------------------------

/** Declared fields of {@link FlowQueryResult} (Python field order). */
export interface FlowQueryResultFields {
  /** When the query was computed (ISO text). */
  readonly computed_at: string;
  /** Sankey step dicts (`{nodes: [...]}` per step). Default: `[]`. */
  readonly steps?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Paths-mode flow dicts (`{flowSteps: [...]}`). Default: `[]`. */
  readonly flows?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Breakdown dicts. Default: `[]`. */
  readonly breakdowns?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Overall conversion rate. Default: `0.0`. */
  readonly overall_conversion_rate?: number;
  /** Generated bookmark params sent to the API. Default: `{}`. */
  readonly params?: Readonly<Record<string, unknown>>;
  /** Response metadata. Default: `{}`. */
  readonly meta?: Readonly<Record<string, unknown>>;
  /** Flow chart mode. Default: `"sankey"`. */
  readonly mode?: FlowChartType;
  /** Tree-mode roots. Default: `[]`. */
  readonly trees?: readonly FlowTreeNode[];
  /** Codec-visible DataFrame cache slots — always `null` in TS. */
  readonly _df_cache?: null | undefined;
  /** Codec-visible nodes-frame cache slot — always `null` in TS. */
  readonly _nodes_df_cache?: null | undefined;
  /** Codec-visible edges-frame cache slot — always `null` in TS. */
  readonly _edges_df_cache?: null | undefined;
  /** Codec-visible graph cache slot — always `null` in TS. */
  readonly _graph_cache?: null | undefined;
  /** Codec-visible trees-frame cache slot — always `null` in TS. */
  readonly _trees_df_cache?: null | undefined;
  /** Codec-visible anytree cache slot — always `null` in TS. */
  readonly _anytree_cache?: null | undefined;
}

/**
 * Structured output of a `Workspace.query_flow()` execution — TS port
 * of `types.FlowQueryResult`.
 *
 * A multi-DataFrame surface (phase2-design C6): `nodes_df`/`edges_df`
 * (+ `trees_df`) become `toNodesRows()`/`toEdgesRows()`
 * (+ `toTreesRows()`), and the main `.df` is MODE-AWARE (sankey →
 * nodes frame, tree → trees frame, paths → its own row shape).
 *
 * `graph` (networkx) and `anytree` are NOT ported in Phase 2 —
 * TODO(port): revisit with batch B5; their codec-visible cache slots
 * (`_graph_cache`, `_anytree_cache`) exist and stay `null`.
 */
export class FlowQueryResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** When the query was computed (ISO text). */
  readonly computed_at: string;

  /** Sankey step dicts (`{nodes: [...]}` per step). */
  readonly steps: ReadonlyArray<Readonly<Record<string, unknown>>>;

  /** Paths-mode flow dicts (`{flowSteps: [...]}`). */
  readonly flows: ReadonlyArray<Readonly<Record<string, unknown>>>;

  /** Breakdown dicts. */
  readonly breakdowns: ReadonlyArray<Readonly<Record<string, unknown>>>;

  /** Overall conversion rate. */
  readonly overall_conversion_rate: number;

  /** Generated bookmark params sent to the API. */
  readonly params: Readonly<Record<string, unknown>>;

  /** Response metadata. */
  readonly meta: Readonly<Record<string, unknown>>;

  /** Flow chart mode. */
  readonly mode: FlowChartType;

  /** Tree-mode roots. */
  readonly trees: readonly FlowTreeNode[];

  /** Codec-visible nodes-frame cache slot (`@internal`) — always `null`. */
  readonly _nodes_df_cache: null = null;

  /** Codec-visible edges-frame cache slot (`@internal`) — always `null`. */
  readonly _edges_df_cache: null = null;

  /** Codec-visible graph cache slot (`@internal`) — always `null`. */
  readonly _graph_cache: null = null;

  /** Codec-visible trees-frame cache slot (`@internal`) — always `null`. */
  readonly _trees_df_cache: null = null;

  /** Codec-visible anytree cache slot (`@internal`) — always `null`. */
  readonly _anytree_cache: null = null;

  /**
   * Create a flow query result.
   *
   * @param fields - Declared fields; Python defaults apply to absent
   *   optionals.
   */
  constructor(fields: FlowQueryResultFields) {
    this.computed_at = fields.computed_at;
    this.steps = fields.steps ?? [];
    this.flows = fields.flows ?? [];
    this.breakdowns = fields.breakdowns ?? [];
    this.overall_conversion_rate = fields.overall_conversion_rate ?? 0.0;
    this.params = fields.params ?? {};
    this.meta = fields.meta ?? {};
    this.mode = fields.mode ?? "sankey";
    this.trees = fields.trees ?? [];
  }

  /**
   * Nodes of one sankey step dict (`step.get("nodes", [])`).
   *
   * @param step - The step dict.
   * @returns The node dicts.
   */
  static #stepNodes(
    step: Readonly<Record<string, unknown>>,
  ): ReadonlyArray<Readonly<Record<string, unknown>>> {
    const nodes = step["nodes"];
    return Array.isArray(nodes)
      ? (nodes as ReadonlyArray<Readonly<Record<string, unknown>>>)
      : [];
  }

  /**
   * Pre-pandas rows of the Python `nodes_df` body: one row per sankey
   * node with Python's per-key defaults (`totalCount` string parsed
   * via `_safe_int`).
   *
   * @returns The rows list.
   */
  toNodesRows(): readonly Row[] {
    const rows: Row[] = [];
    this.steps.forEach((step, step_idx) => {
      for (const node of FlowQueryResult.#stepNodes(step)) {
        rows.push({
          step: step_idx,
          event: node["event"] ?? "",
          type: node["type"] ?? "",
          count: safeInt(node["totalCount"] ?? "0"),
          anchor_type: node["anchorType"] ?? "",
          is_custom_event: node["isCustomEvent"] ?? false,
          conversion_rate_change: node["conversionRateChange"] ?? 0.0,
        });
      }
    });
    return rows;
  }

  /**
   * Column contract of the `nodes_df` frame (explicit `columns=cols`).
   *
   * @returns The column list.
   */
  nodesRowColumns(): readonly string[] {
    return [
      "step",
      "event",
      "type",
      "count",
      "anchor_type",
      "is_custom_event",
      "conversion_rate_change",
    ];
  }

  /**
   * Edges of one node dict (`node.get("edges", [])`).
   *
   * @param node - The node dict.
   * @returns The edge dicts.
   */
  static #nodeEdges(
    node: Readonly<Record<string, unknown>>,
  ): ReadonlyArray<Readonly<Record<string, unknown>>> {
    const edges = node["edges"];
    return Array.isArray(edges)
      ? (edges as ReadonlyArray<Readonly<Record<string, unknown>>>)
      : [];
  }

  /**
   * Pre-pandas rows of the Python `edges_df` body: one row per
   * (node, edge) pair.
   *
   * @returns The rows list.
   */
  toEdgesRows(): readonly Row[] {
    const rows: Row[] = [];
    this.steps.forEach((step, step_idx) => {
      for (const node of FlowQueryResult.#stepNodes(step)) {
        for (const edge of FlowQueryResult.#nodeEdges(node)) {
          rows.push({
            source_step: step_idx,
            source_event: node["event"] ?? "",
            target_step: safeInt(edge["step"] ?? step_idx + 1, step_idx + 1),
            target_event: edge["event"] ?? "",
            count: safeInt(edge["totalCount"] ?? "0"),
            target_type: edge["type"] ?? "",
          });
        }
      }
    });
    return rows;
  }

  /**
   * Column contract of the `edges_df` frame (explicit `columns=cols`).
   *
   * @returns The column list.
   */
  edgesRowColumns(): readonly string[] {
    return [
      "source_step",
      "source_event",
      "target_step",
      "target_event",
      "count",
      "target_type",
    ];
  }

  /**
   * Pre-pandas rows of the Python `_build_tree_df` body: preorder
   * flattening of every tree with `tree_index`/`depth`/`" > "`-joined
   * `path`.
   *
   * @returns The rows list.
   */
  toTreesRows(): readonly Row[] {
    const rows: Row[] = [];
    this.trees.forEach((tree, tree_idx) => {
      FlowQueryResult.#flattenTreeNode(tree, tree_idx, [], rows);
    });
    return rows;
  }

  /**
   * Column contract of the `trees_df` frame (explicit `columns=cols`).
   *
   * @returns The column list.
   */
  treesRowColumns(): readonly string[] {
    return [
      "tree_index",
      "depth",
      "path",
      "event",
      "type",
      "step_number",
      "total_count",
      "drop_off_count",
      "converted_count",
    ];
  }

  /**
   * Preorder tree flattening — mirror of Python
   * `FlowQueryResult._flatten_tree_node`.
   *
   * @param node - Current node.
   * @param tree_index - Root index.
   * @param ancestors - Ancestor event names.
   * @param rows - Output row accumulator.
   */
  static #flattenTreeNode(
    node: FlowTreeNode,
    tree_index: number,
    ancestors: readonly string[],
    rows: Row[],
  ): void {
    const path_parts = [...ancestors, node.event];
    rows.push({
      tree_index,
      depth: ancestors.length,
      path: path_parts.join(" > "),
      event: node.event,
      type: node.type,
      step_number: node.step_number,
      total_count: node.total_count,
      drop_off_count: node.drop_off_count,
      converted_count: node.converted_count,
    });
    for (const child of node.children) {
      FlowQueryResult.#flattenTreeNode(child, tree_index, path_parts, rows);
    }
  }

  /**
   * Pre-pandas rows of the MODE-AWARE Python `.df`: sankey → nodes
   * frame; tree → trees frame; paths → one row per (flow, flowStep).
   *
   * @returns The rows list.
   */
  toRows(): readonly Row[] {
    if (this.mode === "sankey") {
      return this.toNodesRows();
    }
    if (this.mode === "tree") {
      return this.toTreesRows();
    }
    const rows: Row[] = [];
    this.flows.forEach((flow, path_idx) => {
      const flow_steps = flow["flowSteps"];
      const steps: ReadonlyArray<Readonly<Record<string, unknown>>> =
        Array.isArray(flow_steps)
          ? (flow_steps as ReadonlyArray<Readonly<Record<string, unknown>>>)
          : [];
      steps.forEach((fs, step_idx) => {
        rows.push({
          path_index: path_idx,
          step: step_idx,
          event: fs["event"] ?? "",
          type: fs["type"] ?? "",
          count: safeInt(fs["totalCount"] ?? "0"),
        });
      });
    });
    return rows;
  }

  /**
   * Column contract of the mode-aware `.df` frame.
   *
   * @returns The column list of the active mode's frame.
   */
  rowColumns(): readonly string[] {
    if (this.mode === "sankey") {
      return this.nodesRowColumns();
    }
    if (this.mode === "tree") {
      return this.treesRowColumns();
    }
    return ["path_index", "step", "event", "type", "count"];
  }

  /**
   * Top-n transitions by count — mirror of Python
   * `top_transitions()` (which sorts `edges_df` by `count`
   * descending and formats `event@step` labels).
   *
   * @param n - Max transitions to return. Default: `10`.
   * @returns `[source, target, count]` triples.
   */
  topTransitions(n = 10): ReadonlyArray<readonly [string, string, number]> {
    const edges = this.toEdgesRows();
    if (edges.length === 0) {
      return [];
    }
    const sorted = [...edges]
      .sort((a, b) => (b["count"] as number) - (a["count"] as number))
      .slice(0, n);
    return sorted.map((edge) => [
      `${String(edge["source_event"])}@${String(edge["source_step"])}`,
      `${String(edge["target_event"])}@${String(edge["target_step"])}`,
      edge["count"] as number,
    ]);
  }

  /**
   * Per-step drop-off totals — mirror of Python `drop_off_summary()`.
   *
   * @returns `{step_N: {total, dropoff, rate}}` (empty when there are
   *   no steps).
   */
  dropOffSummary(): Record<string, unknown> {
    if (this.steps.length === 0) {
      return {};
    }
    const summary: Record<string, unknown> = {};
    this.steps.forEach((step, step_idx) => {
      let total = 0;
      let dropoff = 0;
      for (const node of FlowQueryResult.#stepNodes(step)) {
        const count = safeInt(node["totalCount"] ?? "0");
        const node_type = node["type"] ?? "";
        total += count;
        if (node_type !== "DROPOFF") {
          for (const edge of FlowQueryResult.#nodeEdges(node)) {
            if (edge["type"] === "DROPOFF") {
              dropoff += safeInt(edge["totalCount"] ?? "0");
            }
          }
        }
      }
      const rate = total > 0 ? dropoff / total : 0.0;
      summary[`step_${String(step_idx)}`] = { total, dropoff, rate };
    });
    return summary;
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`
   * (trees via their own `toJSON()`).
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      computed_at: this.computed_at,
      steps: this.steps,
      flows: this.flows,
      breakdowns: this.breakdowns,
      overall_conversion_rate: this.overall_conversion_rate,
      params: this.params,
      meta: this.meta,
      mode: this.mode,
      trees: this.trees.map((t) => t.toJSON()),
    };
  }

  /**
   * Strictly decode a recorded field-walk payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): FlowQueryResult {
    const cls = "FlowQueryResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "computed_at",
        "steps",
        "flows",
        "breakdowns",
        "overall_conversion_rate",
        "params",
        "meta",
        "mode",
        "trees",
        "_df_cache",
        "_nodes_df_cache",
        "_edges_df_cache",
        "_graph_cache",
        "_trees_df_cache",
        "_anytree_cache",
      ]),
      cls,
    );
    for (const cache of [
      "_df_cache",
      "_nodes_df_cache",
      "_edges_df_cache",
      "_graph_cache",
      "_trees_df_cache",
      "_anytree_cache",
    ]) {
      expectNullCache(payload, cache, cls);
    }
    return new FlowQueryResult({
      computed_at: expectStr(payload, "computed_at", cls),
      ...(Object.hasOwn(payload, "steps")
        ? { steps: expectRecordArray(payload, "steps", cls) }
        : {}),
      ...(Object.hasOwn(payload, "flows")
        ? { flows: expectRecordArray(payload, "flows", cls) }
        : {}),
      ...(Object.hasOwn(payload, "breakdowns")
        ? { breakdowns: expectRecordArray(payload, "breakdowns", cls) }
        : {}),
      ...(Object.hasOwn(payload, "overall_conversion_rate")
        ? {
            overall_conversion_rate: expectFloat(
              payload,
              "overall_conversion_rate",
              cls,
            ),
          }
        : {}),
      ...(Object.hasOwn(payload, "params")
        ? { params: expectRecord(payload, "params", cls) }
        : {}),
      ...(Object.hasOwn(payload, "meta")
        ? { meta: expectRecord(payload, "meta", cls) }
        : {}),
      ...(Object.hasOwn(payload, "mode")
        ? { mode: expectStr(payload, "mode", cls) as FlowChartType }
        : {}),
      ...(Object.hasOwn(payload, "trees")
        ? {
            trees: expectArray(payload, "trees", cls).map((item) =>
              FlowTreeNode.fromDict(item),
            ),
          }
        : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// UserQueryResult
// ---------------------------------------------------------------------------

/** The Python `mode` literal of {@link UserQueryResult}. */
export type UserQueryMode = "profiles" | "aggregate";

/** Declared fields of {@link UserQueryResult} (Python field order). */
export interface UserQueryResultFields {
  /** When the query was computed (ISO text). */
  readonly computed_at: string;
  /** Total matching users. */
  readonly total: number;
  /** Profile dicts (profiles mode). Default: `[]`. */
  readonly profiles?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Generated engage params sent to the API. Default: `{}`. */
  readonly params?: Readonly<Record<string, unknown>>;
  /** Response metadata. Default: `{}`. */
  readonly meta?: Readonly<Record<string, unknown>>;
  /** Result mode. Default: `"aggregate"`. */
  readonly mode?: UserQueryMode;
  /** Aggregate payload (dict, scalar, or `null`). Default: `null`. */
  readonly aggregate_data?: Readonly<Record<string, unknown>> | number | null;
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * Structured output of a `Workspace.query_user()` execution — TS port
 * of `types.UserQueryResult`.
 *
 * `.df` has FIVE branches plus a post-frame column reorder in profiles
 * mode (`distinct_id` first, `last_seen` second, remaining
 * alphabetical) — the reorder IS part of the column contract
 * (phase2-design C6 per-class row spec).
 */
export class UserQueryResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** When the query was computed (ISO text). */
  readonly computed_at: string;

  /** Total matching users. */
  readonly total: number;

  /** Profile dicts (profiles mode). */
  readonly profiles: ReadonlyArray<Readonly<Record<string, unknown>>>;

  /** Generated engage params sent to the API. */
  readonly params: Readonly<Record<string, unknown>>;

  /** Response metadata. */
  readonly meta: Readonly<Record<string, unknown>>;

  /** Result mode. */
  readonly mode: UserQueryMode;

  /** Aggregate payload (dict, scalar, or `null`). */
  readonly aggregate_data: Readonly<Record<string, unknown>> | number | null;

  /**
   * Create a user query result.
   *
   * @param fields - Declared fields; Python defaults apply to absent
   *   optionals.
   */
  constructor(fields: UserQueryResultFields) {
    this.computed_at = fields.computed_at;
    this.total = fields.total;
    this.profiles = fields.profiles ?? [];
    this.params = fields.params ?? {};
    this.meta = fields.meta ?? {};
    this.mode = fields.mode ?? "aggregate";
    this.aggregate_data = fields.aggregate_data ?? null;
  }

  /**
   * Normalized profile rows — mirror of Python `_build_profiles_df`
   * BEFORE the frame is built: `distinct_id` (default `""`),
   * `last_seen` (default `null`), then every property with a leading
   * `$` stripped.
   *
   * @returns The rows list.
   */
  #profilesRows(): readonly Row[] {
    return this.profiles.map((profile) => {
      const row: Row = {
        distinct_id: profile["distinct_id"] ?? "",
        last_seen: profile["last_seen"] ?? null,
      };
      const props = profile["properties"];
      if (isPlainRecord(props)) {
        for (const [key, val] of Object.entries(props)) {
          const clean_key = key.startsWith("$") ? key.slice(1) : key;
          row[clean_key] = val;
        }
      }
      return row;
    });
  }

  /**
   * The `action` param with Python's `"aggregate"` fallback.
   *
   * @returns The action label.
   */
  #action(): unknown {
    return this.params["action"] ?? "aggregate";
  }

  /**
   * Whether `meta.segmented` is truthy (Python `self.meta.get(...)`).
   *
   * @returns The segmented flag.
   */
  #segmented(): boolean {
    return pyTruthy(this.meta["segmented"]);
  }

  /**
   * Pre-pandas rows of the FIVE-branch Python `.df` body.
   *
   * @returns The rows list.
   */
  toRows(): readonly Row[] {
    if (this.mode === "profiles") {
      return this.#profilesRows();
    }
    if (isPlainRecord(this.aggregate_data)) {
      if (this.#segmented()) {
        const rows: Row[] = [];
        for (const [seg, val] of Object.entries(this.aggregate_data)) {
          if (isPlainRecord(val)) {
            rows.push({ segment: seg, ...val });
          } else {
            rows.push({ segment: seg, value: val });
          }
        }
        return rows;
      }
      return [{ metric: this.#action(), ...this.aggregate_data }];
    }
    if (this.aggregate_data !== null) {
      return [{ metric: this.#action(), value: this.aggregate_data }];
    }
    return [];
  }

  /**
   * Column contract of the `.df` frame per branch, INCLUDING the
   * profiles-mode post-frame reorder (`distinct_id`, `last_seen`,
   * remaining alphabetical).
   *
   * @returns The column list.
   */
  rowColumns(): readonly string[] {
    if (this.mode === "profiles") {
      if (this.profiles.length === 0) {
        return ["distinct_id", "last_seen"];
      }
      const cols = firstOccurrenceColumns(this.#profilesRows());
      const priority = ["distinct_id", "last_seen"];
      const ordered = priority.filter((c) => cols.includes(c));
      const remaining = sortedKeys(cols.filter((c) => !priority.includes(c)));
      return [...ordered, ...remaining];
    }
    if (isPlainRecord(this.aggregate_data)) {
      if (this.#segmented()) {
        const rows = this.toRows();
        return rows.length > 0
          ? firstOccurrenceColumns(rows)
          : ["segment", "value"];
      }
      return firstOccurrenceColumns(this.toRows());
    }
    return ["metric", "value"];
  }

  /**
   * Distinct IDs of the returned profiles — Python's `distinct_ids`
   * property (`[]` outside profiles mode; missing IDs become `""`).
   *
   * @returns The distinct IDs.
   */
  get distinct_ids(): readonly string[] {
    if (this.mode !== "profiles") {
      return [];
    }
    return this.profiles.map((p) => (p["distinct_id"] ?? "") as string);
  }

  /**
   * Scalar aggregate value — Python's `value` property (`null`
   * outside aggregate mode or for dict/`null` aggregate data).
   *
   * @returns The scalar value or `null`.
   */
  get value(): number | null {
    if (this.mode !== "aggregate") {
      return null;
    }
    if (isPlainRecord(this.aggregate_data)) {
      return null;
    }
    if (typeof this.aggregate_data === "number") {
      return this.aggregate_data;
    }
    return null;
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      computed_at: this.computed_at,
      total: this.total,
      profiles: this.profiles,
      params: this.params,
      meta: this.meta,
      mode: this.mode,
      aggregate_data: this.aggregate_data,
    };
  }

  /**
   * Strictly decode a recorded field-walk payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): UserQueryResult {
    const cls = "UserQueryResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "computed_at",
        "total",
        "profiles",
        "params",
        "meta",
        "mode",
        "aggregate_data",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    const aggregate = payload["aggregate_data"];
    const aggregate_value = floatValue(aggregate);
    if (
      Object.hasOwn(payload, "aggregate_data") &&
      aggregate !== null &&
      aggregate_value === undefined &&
      !isPlainRecord(aggregate)
    ) {
      decodeFail(cls, "aggregate_data", "object | number | null", aggregate);
    }
    return new UserQueryResult({
      computed_at: expectStr(payload, "computed_at", cls),
      total: expectInt(payload, "total", cls),
      ...(Object.hasOwn(payload, "profiles")
        ? { profiles: expectRecordArray(payload, "profiles", cls) }
        : {}),
      ...(Object.hasOwn(payload, "params")
        ? { params: expectRecord(payload, "params", cls) }
        : {}),
      ...(Object.hasOwn(payload, "meta")
        ? { meta: expectRecord(payload, "meta", cls) }
        : {}),
      ...(Object.hasOwn(payload, "mode")
        ? { mode: expectStr(payload, "mode", cls) as UserQueryMode }
        : {}),
      ...(Object.hasOwn(payload, "aggregate_data")
        ? {
            aggregate_data: isPlainRecord(aggregate)
              ? aggregate
              : ((aggregate_value ?? null) as number | null),
          }
        : {}),
    });
  }
}
