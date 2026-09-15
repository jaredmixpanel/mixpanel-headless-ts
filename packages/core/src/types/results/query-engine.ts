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
 *
 * `FlowTreeNode` lives in `./flow-tree.ts` and the flow frame builders
 * in `./flow-graph.ts`; `FlowQueryResult` delegates to them.
 */

import { compareCodeUnits, pythonFloatCoerce } from "../../compat/index.js";
import { setOwn } from "../../compat/python-dict.js";
import type { FlowChartType } from "../literals.js";
import {
  buildFlowGraph,
  flowDropOffSummary,
  flowEdgesRows,
  type FlowGraph,
  flowNodesRows,
  flowTreesRows,
  safeInt,
} from "./flow-graph.js";
import { type AnyTreeNode, FlowTreeNode } from "./flow-tree.js";
import {
  decodeFail,
  expectArray,
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
 * Strip timezone offsets from ISO timestamps — mirror of
 * `types._normalize_date_key`.
 *
 * @param dateKey - Date string from an API response.
 * @returns The first 19 characters when the key is longer than 19 and
 *   contains a `T`; otherwise unchanged.
 * @internal
 */
function normalizeDateKey(dateKey: string): string {
  if (dateKey.length > 19 && dateKey.includes("T")) {
    return dateKey.slice(0, 19);
  }
  return dateKey;
}

/**
 * Python `sorted()` over string keys.
 *
 * Python orders by code point; this keeps the engine's UTF-16 code-unit
 * order, which differs only when a surrogate pair meets a BMP character
 * above U+D7FF. No corpus key exercises that case, so the switch to
 * `compareCodepoints` is a behaviour change to make together with a
 * vector that proves it, not silently here.
 *
 * @param keys - Keys to sort.
 * @returns A new sorted array.
 */
function sortedKeys(keys: readonly string[]): readonly string[] {
  return [...keys].sort(compareCodeUnits);
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
    let hasSegments = false;
    let hasDates = false;
    for (const [metricName, dateValues] of Object.entries(this.series)) {
      if (!isPlainRecord(dateValues)) {
        continue;
      }
      const firstValue = Object.values(dateValues)[0];
      if (isPlainRecord(firstValue)) {
        hasSegments = true;
        for (const [segmentName, segmentData] of Object.entries(dateValues)) {
          if (!isPlainRecord(segmentData)) {
            continue;
          }
          for (const [dateKey, value] of Object.entries(segmentData)) {
            // eslint-disable-next-line max-depth -- mirrors the Python nesting; flattening would reorder the guards
            if (dateKey === "all") {
              rows.push({
                event: metricName,
                segment: segmentName,
                count: value,
              });
            } else {
              hasDates = true;
              rows.push({
                date: normalizeDateKey(dateKey),
                event: metricName,
                segment: segmentName,
                count: value,
              });
            }
          }
        }
      } else {
        for (const [dateKey, value] of Object.entries(dateValues)) {
          if (dateKey === "all") {
            rows.push({ event: metricName, count: value });
          } else {
            hasDates = true;
            rows.push({
              date: normalizeDateKey(dateKey),
              event: metricName,
              count: value,
            });
          }
        }
      }
    }
    return { rows, has_segments: hasSegments, has_dates: hasDates };
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
    const {
      rows,
      has_segments: hasSegments,
      has_dates: hasDates,
    } = this.#buildRows();
    if (rows.length === 0) {
      return ["date", "event", "count"];
    }
    if (hasSegments && hasDates) {
      return ["date", "event", "segment", "count"];
    }
    if (hasSegments) {
      return ["event", "segment", "count"];
    }
    if (hasDates) {
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
    const last = this.steps_data.at(-1);
    const value = Object.hasOwn(last ?? {}, "overall_conv_ratio")
      ? last?.["overall_conv_ratio"]
      : 0.0;
    // Python applies float(...) to the looked-up value: the full R11.7
    // CPython coercion ladder (string grammar via pythonFloat inside;
    // bool -> 1.0/0.0; None/list/dict -> TypeError twins). B5-ARB
    // ASR-F6b fixed the string arm; the non-string ladder landed at the
    // B6 gate via the `pythonFloatCoerce` compat twin (B5-notes.md
    // outbound ledger item 5).
    return pythonFloatCoerce(value);
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
      for (const segmentName of sortedKeys(Object.keys(this.segments))) {
        const segmentCohorts = this.segments[segmentName] ?? {};
        for (const cohortDate of sortedKeys(Object.keys(segmentCohorts))) {
          const cohort = segmentCohorts[cohortDate] ?? {};
          rows.push(
            ...RetentionQueryResult.#cohortRows(cohort, {
              segment: segmentName,
              cohort_date: cohortDate,
            }),
          );
        }
      }
    } else {
      for (const cohortDate of sortedKeys(Object.keys(this.cohorts))) {
        const cohort = this.cohorts[cohortDate] ?? {};
        rows.push(
          ...RetentionQueryResult.#cohortRows(cohort, {
            cohort_date: cohortDate,
          }),
        );
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
 * `graph` (networkx) and `anytree` are ported at B5-S2 as the plain
 * {@link FlowQueryResult.graph} adjacency object and the
 * {@link FlowQueryResult.anytree} parent-linked roots; their
 * codec-visible cache slots (`_graph_cache`, `_anytree_cache`) exist
 * and stay `null` because both builds are pure.
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
   * The directed flow graph — TS twin of Python's `graph` property, as
   * the plain `{nodes, edges}` adjacency object {@link buildFlowGraph}
   * emits in place of `networkx.DiGraph`.
   *
   * Python caches into `_graph_cache`; the TS build is pure and
   * deterministic, so the codec-visible slot stays `null` (repeated
   * calls are equal).
   *
   * @returns The `{nodes, edges}` adjacency object (empty arrays when
   *   `steps` is empty).
   * @example
   * ```typescript
   * const g = result.graph();
   * g.nodes.find((n) => n.id === "Login@0")?.count; // 100
   * ```
   */
  graph(): FlowGraph {
    return buildFlowGraph(this.steps);
  }

  /**
   * The parent-linked roots of the tree-mode data — TS twin of
   * Python's `anytree` property, closed at
   * B5-S2 alongside {@link FlowTreeNode.toAnytree}.
   *
   * Python caches into `_anytree_cache`; the TS build is pure, so the
   * codec-visible slot stays `null`.
   *
   * @returns One {@link AnyTreeNode} root per member of `trees`.
   */
  anytree(): AnyTreeNode[] {
    return this.trees.map((t) => t.toAnytree());
  }

  /**
   * Pre-pandas rows of the Python `nodes_df` body: one row per sankey
   * node with Python's per-key defaults (`totalCount` string parsed
   * via `_safe_int`).
   *
   * @returns The rows list.
   */
  toNodesRows(): readonly Row[] {
    return flowNodesRows(this.steps);
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
   * Pre-pandas rows of the Python `edges_df` body: one row per
   * (node, edge) pair.
   *
   * @returns The rows list.
   */
  toEdgesRows(): readonly Row[] {
    return flowEdgesRows(this.steps);
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
    return flowTreesRows(this.trees);
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
    for (const [pathIdx, flow] of this.flows.entries()) {
      const flowSteps = flow["flowSteps"];
      const steps: ReadonlyArray<Readonly<Record<string, unknown>>> =
        Array.isArray(flowSteps)
          ? (flowSteps as ReadonlyArray<Readonly<Record<string, unknown>>>)
          : [];
      for (const [stepIdx, fs] of steps.entries()) {
        rows.push({
          path_index: pathIdx,
          step: stepIdx,
          event: fs["event"] ?? "",
          type: fs["type"] ?? "",
          count: safeInt(fs["totalCount"] ?? "0"),
        });
      }
    }
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
    return flowDropOffSummary(this.steps);
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
          const cleanKey = key.startsWith("$") ? key.slice(1) : key;
          setOwn(row, cleanKey, val);
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
    const aggregateValue = floatValue(aggregate);
    if (
      Object.hasOwn(payload, "aggregate_data") &&
      aggregate !== null &&
      aggregateValue === undefined &&
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
              : (aggregateValue ?? null),
          }
        : {}),
    });
  }
}
