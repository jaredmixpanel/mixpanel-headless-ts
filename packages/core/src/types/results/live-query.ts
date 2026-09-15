/**
 * Live-query result dataclasses (phase2-design C6-a, packet P2-6) — TS
 * ports of the corresponding frozen dataclasses in
 * `mixpanel_headless/types.py`.
 *
 * Conventions (C6):
 * - Fields keep their EXACT Python names (R3.4), `readonly` (R4.7).
 * - `toRows()` returns the rows list Python builds before pandas;
 *   `rowColumns()` is the frame's column contract (the Python
 *   empty-frame constant when there are no rows; pandas'
 *   first-occurrence inference when Python passes no `columns=`).
 * - `toJSON()` mirrors the Python `to_dict()` key set and insertion
 *   order byte-for-byte; classes without a Python `to_dict` get none.
 * - `fromDict()` (`@internal`) is the strict golden-test inverse:
 *   wrong JSON type → `ResponseValidationError` (dataclasses don't
 *   coerce).
 * - `toVectorPayload()` (`@internal`, golden-locked classes only)
 *   re-encodes the FULL declared field walk exactly as recorded wire
 *   vectors carry it (`_df_cache: null` included, datetimes re-tagged).
 */

import type {
  CountType,
  HourDayUnit,
  SavedReportType,
  TimeUnit,
} from "../literals.js";
import {
  decodeFail,
  expectArray,
  expectFloat,
  expectInt,
  expectIsoText,
  expectNullCache,
  expectPayload,
  expectRecord,
  expectRecordArray,
  expectStr,
  expectStrArray,
  firstOccurrenceColumns,
  floatValue,
  isPlainRecord,
  rejectUnknownKeys,
  requirePresent,
  type Row,
} from "./result-base.js";

/**
 * Strictly decode an optional-string field that the payload carries
 * explicitly (`str | None` with no default — always present in
 * recorded payloads).
 *
 * @param raw - The payload.
 * @param field - Field name.
 * @param cls - Class name for error messages.
 * @returns The string or `null`.
 * @throws ResponseValidationError - On wrong JSON type.
 */
function expectStrOrNull(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  cls: string,
): string | null {
  const value = raw[field];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    decodeFail(cls, field, "string | null", value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// SegmentationResult
// ---------------------------------------------------------------------------

/** Declared fields of {@link SegmentationResult} (Python field order). */
export interface SegmentationResultFields {
  /** Queried event name. */
  readonly event: string;
  /** Query start date (YYYY-MM-DD). */
  readonly from_date: string;
  /** Query end date (YYYY-MM-DD). */
  readonly to_date: string;
  /** Time unit for aggregation. */
  readonly unit: TimeUnit;
  /** Property used for segmentation (`null` if total only). */
  readonly segment_property: string | null;
  /** Total count across all segments and time periods. */
  readonly total: number;
  /** Time series data by segment: `{segment: {date: count}}`. */
  readonly series?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * Result of a segmentation query — TS port of
 * `types.SegmentationResult`.
 */
export class SegmentationResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** Queried event name. */
  readonly event: string;

  /** Query start date (YYYY-MM-DD). */
  readonly from_date: string;

  /** Query end date (YYYY-MM-DD). */
  readonly to_date: string;

  /** Time unit for aggregation. */
  readonly unit: TimeUnit;

  /** Property used for segmentation (`null` if total only). */
  readonly segment_property: string | null;

  /** Total count across all segments and time periods. */
  readonly total: number;

  /** Time series data by segment: `{segment: {date: count}}`. */
  readonly series: Readonly<Record<string, Readonly<Record<string, number>>>>;

  /**
   * Create a segmentation result.
   *
   * @param fields - Declared fields; absent `series` defaults to `{}`
   *   (Python `default_factory=dict`).
   */
  constructor(fields: SegmentationResultFields) {
    this.event = fields.event;
    this.from_date = fields.from_date;
    this.to_date = fields.to_date;
    this.unit = fields.unit;
    this.segment_property = fields.segment_property;
    this.total = fields.total;
    this.series = fields.series ?? {};
  }

  /**
   * Pre-pandas rows of the Python `.df` body: one
   * `{date, segment, count}` row per (segment, date) pair.
   *
   * @returns The rows list.
   */
  toRows(): readonly Row[] {
    const rows: Row[] = [];
    for (const [segment_name, date_counts] of Object.entries(this.series)) {
      for (const [date_str, count] of Object.entries(date_counts)) {
        rows.push({ date: date_str, segment: segment_name, count });
      }
    }
    return rows;
  }

  /**
   * Column contract of the `.df` frame.
   *
   * @returns `["date", "segment", "count"]` (constant — the uniform
   *   row shape and the Python empty-frame column list coincide).
   */
  rowColumns(): readonly string[] {
    return ["date", "segment", "count"];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      event: this.event,
      from_date: this.from_date,
      to_date: this.to_date,
      unit: this.unit,
      segment_property: this.segment_property,
      total: this.total,
      series: this.series,
    };
  }

  /**
   * Strictly decode a recorded field-walk payload.
   *
   * @param raw - The payload (all declared fields, `_df_cache: null`).
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): SegmentationResult {
    const cls = "SegmentationResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "event",
        "from_date",
        "to_date",
        "unit",
        "segment_property",
        "total",
        "series",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    requirePresent(payload, "segment_property", cls);
    return new SegmentationResult({
      event: expectStr(payload, "event", cls),
      from_date: expectStr(payload, "from_date", cls),
      to_date: expectStr(payload, "to_date", cls),
      unit: expectStr(payload, "unit", cls) as TimeUnit,
      segment_property: expectStrOrNull(payload, "segment_property", cls),
      total: expectInt(payload, "total", cls),
      ...(Object.hasOwn(payload, "series")
        ? {
            series: expectRecord(payload, "series", cls) as Readonly<
              Record<string, Readonly<Record<string, number>>>
            >,
          }
        : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// FunnelResultStep / FunnelResult
// ---------------------------------------------------------------------------

/** Declared fields of {@link FunnelResultStep} (Python field order). */
export interface FunnelResultStepFields {
  /** Event name for this step. */
  readonly event: string;
  /** Number of users at this step. */
  readonly count: number;
  /** Conversion rate from the previous step (0.0 to 1.0). */
  readonly conversion_rate: number;
}

/**
 * Single step result in a legacy funnel query response — TS port of
 * `types.FunnelResultStep`.
 */
export class FunnelResultStep {
  /** Event name for this step. */
  readonly event: string;

  /** Number of users at this step. */
  readonly count: number;

  /** Conversion rate from the previous step (0.0 to 1.0). */
  readonly conversion_rate: number;

  /**
   * Create a funnel step result.
   *
   * @param fields - Declared fields (all required in Python).
   */
  constructor(fields: FunnelResultStepFields) {
    this.event = fields.event;
    this.count = fields.count;
    this.conversion_rate = fields.conversion_rate;
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      event: this.event,
      count: this.count,
      conversion_rate: this.conversion_rate,
    };
  }

  /**
   * Re-encode the full declared field walk for golden diffs.
   *
   * @returns The recorded-payload shape.
   * @internal
   */
  toVectorPayload(): Record<string, unknown> {
    return {
      event: this.event,
      count: this.count,
      conversion_rate: this.conversion_rate,
    };
  }

  /**
   * Strictly decode a recorded payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): FunnelResultStep {
    const cls = "FunnelResultStep";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set(["event", "count", "conversion_rate"]),
      cls,
    );
    return new FunnelResultStep({
      event: expectStr(payload, "event", cls),
      count: expectInt(payload, "count", cls),
      conversion_rate: expectFloat(payload, "conversion_rate", cls),
    });
  }
}

/** Declared fields of {@link FunnelResult} (Python field order). */
export interface FunnelResultFields {
  /** Funnel identifier. */
  readonly funnel_id: number;
  /** Funnel display name. */
  readonly funnel_name: string;
  /** Query start date. */
  readonly from_date: string;
  /** Query end date. */
  readonly to_date: string;
  /** Overall conversion rate (0.0 to 1.0). */
  readonly conversion_rate: number;
  /** Step-by-step breakdown. Default: `[]`. */
  readonly steps?: readonly FunnelResultStep[];
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * Result of a funnel query — TS port of `types.FunnelResult`.
 */
export class FunnelResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** Funnel identifier. */
  readonly funnel_id: number;

  /** Funnel display name. */
  readonly funnel_name: string;

  /** Query start date. */
  readonly from_date: string;

  /** Query end date. */
  readonly to_date: string;

  /** Overall conversion rate (0.0 to 1.0). */
  readonly conversion_rate: number;

  /** Step-by-step breakdown. */
  readonly steps: readonly FunnelResultStep[];

  /**
   * Create a funnel result.
   *
   * @param fields - Declared fields; absent `steps` defaults to `[]`.
   */
  constructor(fields: FunnelResultFields) {
    this.funnel_id = fields.funnel_id;
    this.funnel_name = fields.funnel_name;
    this.from_date = fields.from_date;
    this.to_date = fields.to_date;
    this.conversion_rate = fields.conversion_rate;
    this.steps = fields.steps ?? [];
  }

  /**
   * Pre-pandas rows of the Python `.df` body: one
   * `{step, event, count, conversion_rate}` row per step, `step`
   * starting at 1.
   *
   * @returns The rows list.
   */
  toRows(): readonly Row[] {
    return this.steps.map((step, index) => ({
      step: index + 1,
      event: step.event,
      count: step.count,
      conversion_rate: step.conversion_rate,
    }));
  }

  /**
   * Column contract of the `.df` frame.
   *
   * @returns `["step", "event", "count", "conversion_rate"]`.
   */
  rowColumns(): readonly string[] {
    return ["step", "event", "count", "conversion_rate"];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape (steps via their own `toJSON()`).
   */
  toJSON(): Record<string, unknown> {
    return {
      funnel_id: this.funnel_id,
      funnel_name: this.funnel_name,
      from_date: this.from_date,
      to_date: this.to_date,
      conversion_rate: this.conversion_rate,
      steps: this.steps.map((step) => step.toJSON()),
    };
  }

  /**
   * Re-encode the full declared field walk for golden diffs.
   *
   * @returns The recorded-payload shape (`_df_cache: null` included).
   * @internal
   */
  toVectorPayload(): Record<string, unknown> {
    return {
      _df_cache: this._df_cache,
      funnel_id: this.funnel_id,
      funnel_name: this.funnel_name,
      from_date: this.from_date,
      to_date: this.to_date,
      conversion_rate: this.conversion_rate,
      steps: this.steps.map((step) => step.toVectorPayload()),
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
  static fromDict(raw: unknown): FunnelResult {
    const cls = "FunnelResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "funnel_id",
        "funnel_name",
        "from_date",
        "to_date",
        "conversion_rate",
        "steps",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    return new FunnelResult({
      funnel_id: expectInt(payload, "funnel_id", cls),
      funnel_name: expectStr(payload, "funnel_name", cls),
      from_date: expectStr(payload, "from_date", cls),
      to_date: expectStr(payload, "to_date", cls),
      conversion_rate: expectFloat(payload, "conversion_rate", cls),
      ...(Object.hasOwn(payload, "steps")
        ? {
            steps: expectArray(payload, "steps", cls).map((item) =>
              FunnelResultStep.fromDict(item),
            ),
          }
        : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// CohortInfo / RetentionResult
// ---------------------------------------------------------------------------

/** Declared fields of {@link CohortInfo} (Python field order). */
export interface CohortInfoFields {
  /** Cohort date (when users were "born"). */
  readonly date: string;
  /** Number of users in the cohort. */
  readonly size: number;
  /** Retention percentages by period (0.0 to 1.0). Default: `[]`. */
  readonly retention?: readonly number[];
}

/**
 * Retention data for a single cohort — TS port of `types.CohortInfo`.
 */
export class CohortInfo {
  /** Cohort date (when users were "born"). */
  readonly date: string;

  /** Number of users in the cohort. */
  readonly size: number;

  /** Retention percentages by period (0.0 to 1.0). */
  readonly retention: readonly number[];

  /**
   * Create a cohort info entry.
   *
   * @param fields - Declared fields; absent `retention` defaults to
   *   `[]`.
   */
  constructor(fields: CohortInfoFields) {
    this.date = fields.date;
    this.size = fields.size;
    this.retention = fields.retention ?? [];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      date: this.date,
      size: this.size,
      retention: this.retention,
    };
  }

  /**
   * Re-encode the full declared field walk for golden diffs.
   *
   * @returns The recorded-payload shape.
   * @internal
   */
  toVectorPayload(): Record<string, unknown> {
    return {
      date: this.date,
      size: this.size,
      retention: this.retention,
    };
  }

  /**
   * Strictly decode a recorded payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): CohortInfo {
    const cls = "CohortInfo";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(payload, new Set(["date", "size", "retention"]), cls);
    return new CohortInfo({
      date: expectStr(payload, "date", cls),
      size: expectInt(payload, "size", cls),
      ...(Object.hasOwn(payload, "retention")
        ? {
            retention: expectArray(payload, "retention", cls).map(
              (item, index) => {
                const value = floatValue(item);
                if (value === undefined) {
                  decodeFail(
                    cls,
                    `retention[${String(index)}]`,
                    "number",
                    item,
                  );
                }
                return value;
              },
            ),
          }
        : {}),
    });
  }
}

/** Declared fields of {@link RetentionResult} (Python field order). */
export interface RetentionResultFields {
  /** Event that defines cohort membership. */
  readonly born_event: string;
  /** Event that defines return. */
  readonly return_event: string;
  /** Query start date. */
  readonly from_date: string;
  /** Query end date. */
  readonly to_date: string;
  /** Time unit for retention periods. */
  readonly unit: TimeUnit;
  /** Cohort retention data. Default: `[]`. */
  readonly cohorts?: readonly CohortInfo[];
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * Result of a retention query — TS port of `types.RetentionResult`.
 */
export class RetentionResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** Event that defines cohort membership. */
  readonly born_event: string;

  /** Event that defines return. */
  readonly return_event: string;

  /** Query start date. */
  readonly from_date: string;

  /** Query end date. */
  readonly to_date: string;

  /** Time unit for retention periods. */
  readonly unit: TimeUnit;

  /** Cohort retention data. */
  readonly cohorts: readonly CohortInfo[];

  /**
   * Create a retention result.
   *
   * @param fields - Declared fields; absent `cohorts` defaults to `[]`.
   */
  constructor(fields: RetentionResultFields) {
    this.born_event = fields.born_event;
    this.return_event = fields.return_event;
    this.from_date = fields.from_date;
    this.to_date = fields.to_date;
    this.unit = fields.unit;
    this.cohorts = fields.cohorts ?? [];
  }

  /**
   * Pre-pandas rows of the Python `.df` body: one row per cohort with
   * `cohort_date`, `cohort_size`, and RAGGED `period_N` keys (one per
   * retention entry — pandas' NaN fill for shorter cohorts is a pandas
   * artifact and explicitly OUT of the TS contract, phase2-design C6).
   *
   * @returns The rows list.
   */
  toRows(): readonly Row[] {
    return this.cohorts.map((cohort) => {
      const row: Row = {
        cohort_date: cohort.date,
        cohort_size: cohort.size,
      };
      for (const [i, retention_value] of cohort.retention.entries()) {
        row[`period_${String(i)}`] = retention_value;
      }
      return row;
    });
  }

  /**
   * Column contract of the `.df` frame: the Python empty-frame
   * constant when empty, pandas' first-occurrence inference otherwise
   * (ragged `period_N` keys).
   *
   * @returns The column list.
   */
  rowColumns(): readonly string[] {
    const rows = this.toRows();
    return rows.length > 0
      ? firstOccurrenceColumns(rows)
      : ["cohort_date", "cohort_size"];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape (cohorts via their own `toJSON()`).
   */
  toJSON(): Record<string, unknown> {
    return {
      born_event: this.born_event,
      return_event: this.return_event,
      from_date: this.from_date,
      to_date: this.to_date,
      unit: this.unit,
      cohorts: this.cohorts.map((cohort) => cohort.toJSON()),
    };
  }

  /**
   * Re-encode the full declared field walk for golden diffs.
   *
   * @returns The recorded-payload shape (`_df_cache: null` included).
   * @internal
   */
  toVectorPayload(): Record<string, unknown> {
    return {
      _df_cache: this._df_cache,
      born_event: this.born_event,
      return_event: this.return_event,
      from_date: this.from_date,
      to_date: this.to_date,
      unit: this.unit,
      cohorts: this.cohorts.map((cohort) => cohort.toVectorPayload()),
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
  static fromDict(raw: unknown): RetentionResult {
    const cls = "RetentionResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "born_event",
        "return_event",
        "from_date",
        "to_date",
        "unit",
        "cohorts",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    return new RetentionResult({
      born_event: expectStr(payload, "born_event", cls),
      return_event: expectStr(payload, "return_event", cls),
      from_date: expectStr(payload, "from_date", cls),
      to_date: expectStr(payload, "to_date", cls),
      unit: expectStr(payload, "unit", cls) as TimeUnit,
      ...(Object.hasOwn(payload, "cohorts")
        ? {
            cohorts: expectArray(payload, "cohorts", cls).map((item) =>
              CohortInfo.fromDict(item),
            ),
          }
        : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// EventCountsResult / PropertyCountsResult
// ---------------------------------------------------------------------------

/** Declared fields of {@link EventCountsResult} (Python field order). */
export interface EventCountsResultFields {
  /** Queried event names. */
  readonly events: readonly string[];
  /** Query start date. */
  readonly from_date: string;
  /** Query end date. */
  readonly to_date: string;
  /** Time unit for aggregation. */
  readonly unit: TimeUnit;
  /** Count type. */
  readonly type: CountType;
  /** Time series data by event: `{event: {date: count}}`. */
  readonly series: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * Result of a multi-event counts query — TS port of
 * `types.EventCountsResult`.
 */
export class EventCountsResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** Queried event names. */
  readonly events: readonly string[];

  /** Query start date. */
  readonly from_date: string;

  /** Query end date. */
  readonly to_date: string;

  /** Time unit for aggregation. */
  readonly unit: TimeUnit;

  /** Count type. */
  readonly type: CountType;

  /** Time series data by event: `{event: {date: count}}`. */
  readonly series: Readonly<Record<string, Readonly<Record<string, number>>>>;

  /**
   * Create an event-counts result.
   *
   * @param fields - Declared fields (all required in Python).
   */
  constructor(fields: EventCountsResultFields) {
    this.events = fields.events;
    this.from_date = fields.from_date;
    this.to_date = fields.to_date;
    this.unit = fields.unit;
    this.type = fields.type;
    this.series = fields.series;
  }

  /**
   * Pre-pandas rows of the Python `.df` body: one
   * `{date, event, count}` row per (event, date) pair.
   *
   * @returns The rows list.
   */
  toRows(): readonly Row[] {
    const rows: Row[] = [];
    for (const [event_name, date_counts] of Object.entries(this.series)) {
      for (const [date_str, count] of Object.entries(date_counts)) {
        rows.push({ date: date_str, event: event_name, count });
      }
    }
    return rows;
  }

  /**
   * Column contract of the `.df` frame.
   *
   * @returns `["date", "event", "count"]`.
   */
  rowColumns(): readonly string[] {
    return ["date", "event", "count"];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      events: this.events,
      from_date: this.from_date,
      to_date: this.to_date,
      unit: this.unit,
      type: this.type,
      series: this.series,
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
  static fromDict(raw: unknown): EventCountsResult {
    const cls = "EventCountsResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "events",
        "from_date",
        "to_date",
        "unit",
        "type",
        "series",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    return new EventCountsResult({
      events: expectStrArray(payload, "events", cls),
      from_date: expectStr(payload, "from_date", cls),
      to_date: expectStr(payload, "to_date", cls),
      unit: expectStr(payload, "unit", cls) as TimeUnit,
      type: expectStr(payload, "type", cls) as CountType,
      series: expectRecord(payload, "series", cls) as Readonly<
        Record<string, Readonly<Record<string, number>>>
      >,
    });
  }
}

/** Declared fields of {@link PropertyCountsResult} (Python field order). */
export interface PropertyCountsResultFields {
  /** Queried event name. */
  readonly event: string;
  /** Property whose values were counted. */
  readonly property_name: string;
  /** Query start date. */
  readonly from_date: string;
  /** Query end date. */
  readonly to_date: string;
  /** Time unit for aggregation. */
  readonly unit: TimeUnit;
  /** Count type. */
  readonly type: CountType;
  /** Time series data by property value: `{value: {date: count}}`. */
  readonly series: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * Result of a property-values counts query — TS port of
 * `types.PropertyCountsResult`.
 */
export class PropertyCountsResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** Queried event name. */
  readonly event: string;

  /** Property whose values were counted. */
  readonly property_name: string;

  /** Query start date. */
  readonly from_date: string;

  /** Query end date. */
  readonly to_date: string;

  /** Time unit for aggregation. */
  readonly unit: TimeUnit;

  /** Count type. */
  readonly type: CountType;

  /** Time series data by property value: `{value: {date: count}}`. */
  readonly series: Readonly<Record<string, Readonly<Record<string, number>>>>;

  /**
   * Create a property-counts result.
   *
   * @param fields - Declared fields (all required in Python).
   */
  constructor(fields: PropertyCountsResultFields) {
    this.event = fields.event;
    this.property_name = fields.property_name;
    this.from_date = fields.from_date;
    this.to_date = fields.to_date;
    this.unit = fields.unit;
    this.type = fields.type;
    this.series = fields.series;
  }

  /**
   * Pre-pandas rows of the Python `.df` body: one
   * `{date, value, count}` row per (value, date) pair.
   *
   * @returns The rows list.
   */
  toRows(): readonly Row[] {
    const rows: Row[] = [];
    for (const [value, date_counts] of Object.entries(this.series)) {
      for (const [date_str, count] of Object.entries(date_counts)) {
        rows.push({ date: date_str, value, count });
      }
    }
    return rows;
  }

  /**
   * Column contract of the `.df` frame.
   *
   * @returns `["date", "value", "count"]`.
   */
  rowColumns(): readonly string[] {
    return ["date", "value", "count"];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      event: this.event,
      property_name: this.property_name,
      from_date: this.from_date,
      to_date: this.to_date,
      unit: this.unit,
      type: this.type,
      series: this.series,
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
  static fromDict(raw: unknown): PropertyCountsResult {
    const cls = "PropertyCountsResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "event",
        "property_name",
        "from_date",
        "to_date",
        "unit",
        "type",
        "series",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    return new PropertyCountsResult({
      event: expectStr(payload, "event", cls),
      property_name: expectStr(payload, "property_name", cls),
      from_date: expectStr(payload, "from_date", cls),
      to_date: expectStr(payload, "to_date", cls),
      unit: expectStr(payload, "unit", cls) as TimeUnit,
      type: expectStr(payload, "type", cls) as CountType,
      series: expectRecord(payload, "series", cls) as Readonly<
        Record<string, Readonly<Record<string, number>>>
      >,
    });
  }
}

// ---------------------------------------------------------------------------
// UserEvent / ActivityFeedResult
// ---------------------------------------------------------------------------

/** Declared fields of {@link UserEvent} (Python field order). */
export interface UserEventFields {
  /** Event name. */
  readonly event: string;
  /**
   * Event time as ISO-8601 text (the Python field is a `datetime`;
   * the TS port stores the preserved ISO text — watchlist #5).
   */
  readonly time: string;
  /** Event properties. Default: `{}`. */
  readonly properties?: Readonly<Record<string, unknown>>;
}

/**
 * One event in a user's activity feed — TS port of `types.UserEvent`.
 *
 * Python's `time` field is a `datetime`; the TS port stores the
 * preserved ISO-8601 text (dates stay strings — phase2-design
 * watchlist #5) and `toJSON()` emits it where Python emits
 * `time.isoformat()`.
 */
export class UserEvent {
  /** Event name. */
  readonly event: string;

  /** Event time (ISO-8601 text). */
  readonly time: string;

  /** Event properties. */
  readonly properties: Readonly<Record<string, unknown>>;

  /**
   * Create a user event.
   *
   * @param fields - Declared fields; absent `properties` defaults to
   *   `{}`.
   */
  constructor(fields: UserEventFields) {
    this.event = fields.event;
    this.time = fields.time;
    this.properties = fields.properties ?? {};
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`
   * (`time` emits the ISO text exactly as Python emits
   * `time.isoformat()`).
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      event: this.event,
      time: this.time,
      properties: this.properties,
    };
  }

  /**
   * Re-encode the full declared field walk for golden diffs (`time`
   * re-tagged as the recorded `$type: datetime` payload).
   *
   * @returns The recorded-payload shape.
   * @internal
   */
  toVectorPayload(): Record<string, unknown> {
    return {
      event: this.event,
      time: { $type: "datetime", iso: this.time },
      properties: this.properties,
    };
  }

  /**
   * Strictly decode a recorded payload (`time` arrives as a decoded
   * datetime wrapper or ISO text).
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): UserEvent {
    const cls = "UserEvent";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(payload, new Set(["event", "time", "properties"]), cls);
    requirePresent(payload, "time", cls);
    return new UserEvent({
      event: expectStr(payload, "event", cls),
      time: expectIsoText(payload["time"], "time", cls),
      ...(Object.hasOwn(payload, "properties")
        ? { properties: expectRecord(payload, "properties", cls) }
        : {}),
    });
  }
}

/** Declared fields of {@link ActivityFeedResult} (Python field order). */
export interface ActivityFeedResultFields {
  /** Queried distinct IDs. */
  readonly distinct_ids: readonly string[];
  /** Query start date (`null` when unbounded). */
  readonly from_date: string | null;
  /** Query end date (`null` when unbounded). */
  readonly to_date: string | null;
  /** Chronological events across the queried users. Default: `[]`. */
  readonly events?: readonly UserEvent[];
  /** Raw sentinel event dict, if the API returned one. Default: `null`. */
  readonly sentinel_event?: Readonly<Record<string, unknown>> | null;
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * Result of an activity-feed query — TS port of
 * `types.ActivityFeedResult`.
 */
export class ActivityFeedResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** Queried distinct IDs. */
  readonly distinct_ids: readonly string[];

  /** Query start date (`null` when unbounded). */
  readonly from_date: string | null;

  /** Query end date (`null` when unbounded). */
  readonly to_date: string | null;

  /** Chronological events across the queried users. */
  readonly events: readonly UserEvent[];

  /** Raw sentinel event dict, if the API returned one. */
  readonly sentinel_event: Readonly<Record<string, unknown>> | null;

  /**
   * Create an activity-feed result.
   *
   * @param fields - Declared fields; absent `events` defaults to `[]`
   *   and absent `sentinel_event` to `null`.
   */
  constructor(fields: ActivityFeedResultFields) {
    this.distinct_ids = fields.distinct_ids;
    this.from_date = fields.from_date;
    this.to_date = fields.to_date;
    this.events = fields.events ?? [];
    this.sentinel_event = fields.sentinel_event ?? null;
  }

  /**
   * Pre-pandas rows of the Python `.df` body: one row per event with
   * `event`, `time`, `distinct_id` (from `$distinct_id`, `""` when
   * missing) plus every other property key spread into the row
   * (ragged — pandas' NaN fill is OUT of the TS contract).
   *
   * @returns The rows list.
   */
  toRows(): readonly Row[] {
    return this.events.map((user_event) => {
      const distinctId = user_event.properties["$distinct_id"];
      const row: Row = {
        event: user_event.event,
        time: user_event.time,
        distinct_id: distinctId === undefined ? "" : distinctId,
      };
      for (const [key, value] of Object.entries(user_event.properties)) {
        if (key !== "$distinct_id") {
          row[key] = value;
        }
      }
      return row;
    });
  }

  /**
   * Column contract of the `.df` frame: the Python empty-frame
   * constant when empty, pandas' first-occurrence inference otherwise.
   *
   * @returns The column list.
   */
  rowColumns(): readonly string[] {
    const rows = this.toRows();
    return rows.length > 0
      ? firstOccurrenceColumns(rows)
      : ["event", "time", "distinct_id"];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`
   * (including the derived `event_count`).
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      distinct_ids: this.distinct_ids,
      from_date: this.from_date,
      to_date: this.to_date,
      event_count: this.events.length,
      events: this.events.map((event) => event.toJSON()),
      sentinel_event: this.sentinel_event,
    };
  }

  /**
   * Re-encode the full declared field walk for golden diffs.
   *
   * @returns The recorded-payload shape (`_df_cache: null` included).
   * @internal
   */
  toVectorPayload(): Record<string, unknown> {
    return {
      _df_cache: this._df_cache,
      distinct_ids: this.distinct_ids,
      from_date: this.from_date,
      to_date: this.to_date,
      events: this.events.map((event) => event.toVectorPayload()),
      sentinel_event: this.sentinel_event,
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
  static fromDict(raw: unknown): ActivityFeedResult {
    const cls = "ActivityFeedResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "distinct_ids",
        "from_date",
        "to_date",
        "events",
        "sentinel_event",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    requirePresent(payload, "from_date", cls);
    requirePresent(payload, "to_date", cls);
    const sentinel = payload["sentinel_event"];
    if (
      Object.hasOwn(payload, "sentinel_event") &&
      sentinel !== null &&
      !isPlainRecord(sentinel)
    ) {
      decodeFail(cls, "sentinel_event", "object | null", sentinel);
    }
    return new ActivityFeedResult({
      distinct_ids: expectStrArray(payload, "distinct_ids", cls),
      from_date: expectStrOrNull(payload, "from_date", cls),
      to_date: expectStrOrNull(payload, "to_date", cls),
      ...(Object.hasOwn(payload, "events")
        ? {
            events: expectArray(payload, "events", cls).map((item) =>
              UserEvent.fromDict(item),
            ),
          }
        : {}),
      ...(Object.hasOwn(payload, "sentinel_event")
        ? {
            sentinel_event: sentinel as Readonly<
              Record<string, unknown>
            > | null,
          }
        : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// SavedReportResult
// ---------------------------------------------------------------------------

/** Declared fields of {@link SavedReportResult} (Python field order). */
export interface SavedReportResultFields {
  /** Bookmark (saved report) ID. */
  readonly bookmark_id: number;
  /** When the report was computed (ISO text from the API). */
  readonly computed_at: string;
  /** Effective start date from the response. */
  readonly from_date: string;
  /** Effective end date from the response. */
  readonly to_date: string;
  /** Header markers from the response. Default: `[]`. */
  readonly headers?: readonly string[];
  /** Report series payload (shape varies by report type). Default: `{}`. */
  readonly series?: Readonly<Record<string, unknown>>;
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * Result of querying a saved report — TS port of
 * `types.SavedReportResult`.
 *
 * NOT a `ResultWithDataFrame` subclass in Python (it declares its own
 * `_df_cache`), and its `.df` DIVERGES from the uniform rows pattern:
 * the non-insights branch returns a SINGLE row whose one `series` cell
 * is the nested dict (phase2-design C6 per-class row spec).
 */
export class SavedReportResult {
  /** Bookmark (saved report) ID. */
  readonly bookmark_id: number;

  /** When the report was computed (ISO text from the API). */
  readonly computed_at: string;

  /** Effective start date from the response. */
  readonly from_date: string;

  /** Effective end date from the response. */
  readonly to_date: string;

  /** Header markers from the response. */
  readonly headers: readonly string[];

  /** Report series payload (shape varies by report type). */
  readonly series: Readonly<Record<string, unknown>>;

  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /**
   * Create a saved-report result.
   *
   * @param fields - Declared fields; absent `headers`/`series` default
   *   to `[]`/`{}`.
   */
  constructor(fields: SavedReportResultFields) {
    this.bookmark_id = fields.bookmark_id;
    this.computed_at = fields.computed_at;
    this.from_date = fields.from_date;
    this.to_date = fields.to_date;
    this.headers = fields.headers ?? [];
    this.series = fields.series ?? {};
  }

  /**
   * Report type derived from the headers array, exactly as Python's
   * `report_type` property.
   *
   * @returns `"retention"`, `"funnel"`, `"flows"`, or the default
   *   `"insights"`.
   */
  get report_type(): SavedReportType {
    for (const header of this.headers) {
      const lower = header.toLowerCase();
      if (lower.includes("$retention")) {
        return "retention";
      }
      if (lower.includes("$funnel")) {
        return "funnel";
      }
      if (lower.includes("$flows")) {
        return "flows";
      }
    }
    return "insights";
  }

  /**
   * Pre-pandas rows of the Python `.df` body — BOTH branches mirrored
   * exactly: the insights branch builds `{date, event, count}` rows
   * from dict-valued series entries; every other report type returns
   * ONE row whose single `series` cell is the nested dict.
   *
   * @returns The rows list.
   */
  toRows(): readonly Row[] {
    if (this.report_type === "insights") {
      const rows: Row[] = [];
      for (const [event_name, date_counts] of Object.entries(this.series)) {
        if (isPlainRecord(date_counts)) {
          for (const [date_str, count] of Object.entries(date_counts)) {
            rows.push({ date: date_str, event: event_name, count });
          }
        }
      }
      return rows;
    }
    return [{ series: this.series }];
  }

  /**
   * Column contract of the `.df` frame per branch: insights →
   * `["date", "event", "count"]`; non-insights → `["series"]`.
   *
   * @returns The column list.
   */
  rowColumns(): readonly string[] {
    if (this.report_type === "insights") {
      return ["date", "event", "count"];
    }
    return ["series"];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`
   * (including the derived `report_type`).
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      bookmark_id: this.bookmark_id,
      computed_at: this.computed_at,
      from_date: this.from_date,
      to_date: this.to_date,
      headers: this.headers,
      series: this.series,
      report_type: this.report_type,
    };
  }

  /**
   * Re-encode the full declared field walk for golden diffs.
   *
   * @returns The recorded-payload shape (`_df_cache: null` included;
   *   NO derived `report_type` — the recorder walks declared fields).
   * @internal
   */
  toVectorPayload(): Record<string, unknown> {
    return {
      bookmark_id: this.bookmark_id,
      computed_at: this.computed_at,
      from_date: this.from_date,
      to_date: this.to_date,
      headers: this.headers,
      series: this.series,
      _df_cache: this._df_cache,
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
  static fromDict(raw: unknown): SavedReportResult {
    const cls = "SavedReportResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "bookmark_id",
        "computed_at",
        "from_date",
        "to_date",
        "headers",
        "series",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    return new SavedReportResult({
      bookmark_id: expectInt(payload, "bookmark_id", cls),
      computed_at: expectStr(payload, "computed_at", cls),
      from_date: expectStr(payload, "from_date", cls),
      to_date: expectStr(payload, "to_date", cls),
      ...(Object.hasOwn(payload, "headers")
        ? { headers: expectStrArray(payload, "headers", cls) }
        : {}),
      ...(Object.hasOwn(payload, "series")
        ? { series: expectRecord(payload, "series", cls) }
        : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// FlowsResult
// ---------------------------------------------------------------------------

/** Declared fields of {@link FlowsResult} (Python field order). */
export interface FlowsResultFields {
  /** Bookmark (saved report) ID. */
  readonly bookmark_id: number;
  /** When the report was computed (ISO text from the API). */
  readonly computed_at: string;
  /** Raw step dicts from the flows response. Default: `[]`. */
  readonly steps?: readonly Row[];
  /** Raw breakdown dicts. Default: `[]`. */
  readonly breakdowns?: readonly Row[];
  /** Overall conversion rate. Default: `0.0`. */
  readonly overall_conversion_rate?: number;
  /** Response metadata. Default: `{}`. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * Result of querying a saved flows report — TS port of
 * `types.FlowsResult`.
 *
 * Its `.df` DIVERGES from the uniform pattern: rows are the RAW step
 * dicts (`pd.DataFrame(self.steps)`), and the empty case has NO column
 * list (`rowColumns()` returns `[]` — phase2-design C6 per-class row
 * spec).
 */
export class FlowsResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** Bookmark (saved report) ID. */
  readonly bookmark_id: number;

  /** When the report was computed (ISO text from the API). */
  readonly computed_at: string;

  /** Raw step dicts from the flows response. */
  readonly steps: readonly Row[];

  /** Raw breakdown dicts. */
  readonly breakdowns: readonly Row[];

  /** Overall conversion rate. */
  readonly overall_conversion_rate: number;

  /** Response metadata. */
  readonly metadata: Readonly<Record<string, unknown>>;

  /**
   * Create a flows result.
   *
   * @param fields - Declared fields; Python defaults apply to absent
   *   optionals.
   */
  constructor(fields: FlowsResultFields) {
    this.bookmark_id = fields.bookmark_id;
    this.computed_at = fields.computed_at;
    this.steps = fields.steps ?? [];
    this.breakdowns = fields.breakdowns ?? [];
    this.overall_conversion_rate = fields.overall_conversion_rate ?? 0.0;
    this.metadata = fields.metadata ?? {};
  }

  /**
   * Pre-pandas rows of the Python `.df` body: the raw step dicts
   * themselves (`pd.DataFrame(self.steps)`), NOT hand-named keys.
   *
   * @returns The rows list (empty when there are no steps).
   */
  toRows(): readonly Row[] {
    return this.steps;
  }

  /**
   * Column contract of the `.df` frame: pandas' first-occurrence
   * inference over the raw step dicts; the Python empty case is a bare
   * `pd.DataFrame()` with NO columns → `[]`.
   *
   * @returns The column list.
   */
  rowColumns(): readonly string[] {
    return this.steps.length > 0 ? firstOccurrenceColumns(this.steps) : [];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      bookmark_id: this.bookmark_id,
      computed_at: this.computed_at,
      steps: this.steps,
      breakdowns: this.breakdowns,
      overall_conversion_rate: this.overall_conversion_rate,
      metadata: this.metadata,
    };
  }

  /**
   * Re-encode the full declared field walk for golden diffs.
   *
   * @returns The recorded-payload shape (`_df_cache: null` included).
   * @internal
   */
  toVectorPayload(): Record<string, unknown> {
    return {
      _df_cache: this._df_cache,
      bookmark_id: this.bookmark_id,
      computed_at: this.computed_at,
      steps: this.steps,
      breakdowns: this.breakdowns,
      overall_conversion_rate: this.overall_conversion_rate,
      metadata: this.metadata,
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
  static fromDict(raw: unknown): FlowsResult {
    const cls = "FlowsResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "bookmark_id",
        "computed_at",
        "steps",
        "breakdowns",
        "overall_conversion_rate",
        "metadata",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    return new FlowsResult({
      bookmark_id: expectInt(payload, "bookmark_id", cls),
      computed_at: expectStr(payload, "computed_at", cls),
      ...(Object.hasOwn(payload, "steps")
        ? { steps: expectRecordArray(payload, "steps", cls) }
        : {}),
      ...(Object.hasOwn(payload, "breakdowns")
        ? {
            breakdowns: expectRecordArray(payload, "breakdowns", cls),
          }
        : {}),
      ...(Object.hasOwn(payload, "overall_conversion_rate")
        ? {
            // R10.7 bug-compat: the Python field is ANNOTATED float but
            // dataclasses don't validate — the arb_funnels response
            // carries the literal string "NaN" and Python stores it
            // verbatim (recorded: parse/workspace.query_saved_flows/
            // authored-storybook-query-arb-funnels-bookmark-87176748).
            // Accept number or string, store verbatim.
            overall_conversion_rate: decodeFlowsConversionRate(payload, cls),
          }
        : {}),
      ...(Object.hasOwn(payload, "metadata")
        ? { metadata: expectRecord(payload, "metadata", cls) }
        : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// FrequencyResult
// ---------------------------------------------------------------------------

/**
 * Decode `FlowsResult.overall_conversion_rate` with the R10.7
 * bug-compat tolerance (see the `fromDict` call site): Python's
 * dataclass performs no validation and the recorded corpus carries a
 * literal `"NaN"` string in this float-annotated slot.
 *
 * @param raw - The payload.
 * @param cls - Class name for error messages.
 * @returns The number, or the verbatim string cast into the declared
 *   numeric slot (matching Python's runtime reality).
 * @throws ResponseValidationError - On any other JSON type.
 */
function decodeFlowsConversionRate(
  raw: Readonly<Record<string, unknown>>,
  cls: string,
): number {
  const value = raw["overall_conversion_rate"];
  if (typeof value === "string") {
    return value as unknown as number;
  }
  return expectFloat(raw, "overall_conversion_rate", cls);
}

/** Declared fields of {@link FrequencyResult} (Python field order). */
export interface FrequencyResultFields {
  /** Queried event name (`null` for all events). */
  readonly event: string | null;
  /** Query start date. */
  readonly from_date: string;
  /** Query end date. */
  readonly to_date: string;
  /** Cohort interval unit. */
  readonly unit: TimeUnit;
  /** Addiction (sub-period) unit. */
  readonly addiction_unit: HourDayUnit;
  /** Per-date frequency counts: `{date: [count, ...]}`. Default: `{}`. */
  readonly data?: Readonly<Record<string, readonly number[]>>;
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * Result of a frequency (addiction) query — TS port of
 * `types.FrequencyResult`.
 */
export class FrequencyResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** Queried event name (`null` for all events). */
  readonly event: string | null;

  /** Query start date. */
  readonly from_date: string;

  /** Query end date. */
  readonly to_date: string;

  /** Cohort interval unit. */
  readonly unit: TimeUnit;

  /** Addiction (sub-period) unit. */
  readonly addiction_unit: HourDayUnit;

  /** Per-date frequency counts: `{date: [count, ...]}`. */
  readonly data: Readonly<Record<string, readonly number[]>>;

  /**
   * Create a frequency result.
   *
   * @param fields - Declared fields; absent `data` defaults to `{}`.
   */
  constructor(fields: FrequencyResultFields) {
    this.event = fields.event;
    this.from_date = fields.from_date;
    this.to_date = fields.to_date;
    this.unit = fields.unit;
    this.addiction_unit = fields.addiction_unit;
    this.data = fields.data ?? {};
  }

  /**
   * Pre-pandas rows of the Python `.df` body: one row per date with
   * RAGGED `period_N` keys starting at 1.
   *
   * @returns The rows list.
   */
  toRows(): readonly Row[] {
    const rows: Row[] = [];
    for (const [date_str, counts] of Object.entries(this.data)) {
      const row: Row = { date: date_str };
      for (const [index, count] of counts.entries()) {
        row[`period_${String(index + 1)}`] = count;
      }
      rows.push(row);
    }
    return rows;
  }

  /**
   * Column contract of the `.df` frame: the Python empty-frame
   * constant `["date"]` when empty, first-occurrence inference
   * otherwise.
   *
   * @returns The column list.
   */
  rowColumns(): readonly string[] {
    const rows = this.toRows();
    return rows.length > 0 ? firstOccurrenceColumns(rows) : ["date"];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      event: this.event,
      from_date: this.from_date,
      to_date: this.to_date,
      unit: this.unit,
      addiction_unit: this.addiction_unit,
      data: this.data,
    };
  }

  /**
   * Re-encode the full declared field walk for golden diffs.
   *
   * @returns The recorded-payload shape (`_df_cache: null` included).
   * @internal
   */
  toVectorPayload(): Record<string, unknown> {
    return {
      _df_cache: this._df_cache,
      event: this.event,
      from_date: this.from_date,
      to_date: this.to_date,
      unit: this.unit,
      addiction_unit: this.addiction_unit,
      data: this.data,
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
  static fromDict(raw: unknown): FrequencyResult {
    const cls = "FrequencyResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "event",
        "from_date",
        "to_date",
        "unit",
        "addiction_unit",
        "data",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    requirePresent(payload, "event", cls);
    return new FrequencyResult({
      event: expectStrOrNull(payload, "event", cls),
      from_date: expectStr(payload, "from_date", cls),
      to_date: expectStr(payload, "to_date", cls),
      unit: expectStr(payload, "unit", cls) as TimeUnit,
      addiction_unit: expectStr(payload, "addiction_unit", cls) as HourDayUnit,
      ...(Object.hasOwn(payload, "data")
        ? {
            data: expectRecord(payload, "data", cls) as Readonly<
              Record<string, readonly number[]>
            >,
          }
        : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// NumericBucketResult / NumericSumResult / NumericAverageResult
// ---------------------------------------------------------------------------

/** Declared fields of {@link NumericBucketResult} (Python field order). */
export interface NumericBucketResultFields {
  /** Queried event name. */
  readonly event: string;
  /** Query start date. */
  readonly from_date: string;
  /** Query end date. */
  readonly to_date: string;
  /** Numeric property expression that was bucketed. */
  readonly property_expr: string;
  /** Time unit for aggregation. */
  readonly unit: HourDayUnit;
  /** Bucketed series: `{bucket_label: {date: count}}`. Default: `{}`. */
  readonly series?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * Result of a bucketed numeric segmentation query — TS port of
 * `types.NumericBucketResult`.
 */
export class NumericBucketResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** Queried event name. */
  readonly event: string;

  /** Query start date. */
  readonly from_date: string;

  /** Query end date. */
  readonly to_date: string;

  /** Numeric property expression that was bucketed. */
  readonly property_expr: string;

  /** Time unit for aggregation. */
  readonly unit: HourDayUnit;

  /** Bucketed series: `{bucket_label: {date: count}}`. */
  readonly series: Readonly<Record<string, Readonly<Record<string, number>>>>;

  /**
   * Create a numeric-bucket result.
   *
   * @param fields - Declared fields; absent `series` defaults to `{}`.
   */
  constructor(fields: NumericBucketResultFields) {
    this.event = fields.event;
    this.from_date = fields.from_date;
    this.to_date = fields.to_date;
    this.property_expr = fields.property_expr;
    this.unit = fields.unit;
    this.series = fields.series ?? {};
  }

  /**
   * Pre-pandas rows of the Python `.df` body: one
   * `{date, bucket, count}` row per (bucket, date) pair.
   *
   * @returns The rows list.
   */
  toRows(): readonly Row[] {
    const rows: Row[] = [];
    for (const [bucket, date_counts] of Object.entries(this.series)) {
      for (const [date_str, count] of Object.entries(date_counts)) {
        rows.push({ date: date_str, bucket, count });
      }
    }
    return rows;
  }

  /**
   * Column contract of the `.df` frame.
   *
   * @returns `["date", "bucket", "count"]`.
   */
  rowColumns(): readonly string[] {
    return ["date", "bucket", "count"];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      event: this.event,
      from_date: this.from_date,
      to_date: this.to_date,
      property_expr: this.property_expr,
      unit: this.unit,
      series: this.series,
    };
  }

  /**
   * Re-encode the full declared field walk for golden diffs.
   *
   * @returns The recorded-payload shape (`_df_cache: null` included).
   * @internal
   */
  toVectorPayload(): Record<string, unknown> {
    return {
      _df_cache: this._df_cache,
      event: this.event,
      from_date: this.from_date,
      to_date: this.to_date,
      property_expr: this.property_expr,
      unit: this.unit,
      series: this.series,
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
  static fromDict(raw: unknown): NumericBucketResult {
    const cls = "NumericBucketResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "event",
        "from_date",
        "to_date",
        "property_expr",
        "unit",
        "series",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    return new NumericBucketResult({
      event: expectStr(payload, "event", cls),
      from_date: expectStr(payload, "from_date", cls),
      to_date: expectStr(payload, "to_date", cls),
      property_expr: expectStr(payload, "property_expr", cls),
      unit: expectStr(payload, "unit", cls) as HourDayUnit,
      ...(Object.hasOwn(payload, "series")
        ? {
            series: expectRecord(payload, "series", cls) as Readonly<
              Record<string, Readonly<Record<string, number>>>
            >,
          }
        : {}),
    });
  }
}

/** Declared fields of {@link NumericSumResult} (Python field order). */
export interface NumericSumResultFields {
  /** Queried event name. */
  readonly event: string;
  /** Query start date. */
  readonly from_date: string;
  /** Query end date. */
  readonly to_date: string;
  /** Numeric property expression that was summed. */
  readonly property_expr: string;
  /** Time unit for aggregation. */
  readonly unit: HourDayUnit;
  /** Per-date sums: `{date: sum}`. Default: `{}`. */
  readonly results?: Readonly<Record<string, number>>;
  /** When the result was computed (ISO text), if provided. Default: `null`. */
  readonly computed_at?: string | null;
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * Result of a numeric-sum segmentation query — TS port of
 * `types.NumericSumResult`.
 */
export class NumericSumResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** Queried event name. */
  readonly event: string;

  /** Query start date. */
  readonly from_date: string;

  /** Query end date. */
  readonly to_date: string;

  /** Numeric property expression that was summed. */
  readonly property_expr: string;

  /** Time unit for aggregation. */
  readonly unit: HourDayUnit;

  /** Per-date sums: `{date: sum}`. */
  readonly results: Readonly<Record<string, number>>;

  /** When the result was computed (ISO text), if provided. */
  readonly computed_at: string | null;

  /**
   * Create a numeric-sum result.
   *
   * @param fields - Declared fields; absent `results` defaults to `{}`
   *   and absent `computed_at` to `null`.
   */
  constructor(fields: NumericSumResultFields) {
    this.event = fields.event;
    this.from_date = fields.from_date;
    this.to_date = fields.to_date;
    this.property_expr = fields.property_expr;
    this.unit = fields.unit;
    this.results = fields.results ?? {};
    this.computed_at = fields.computed_at ?? null;
  }

  /**
   * Pre-pandas rows of the Python `.df` body: one `{date, sum}` row
   * per results entry.
   *
   * @returns The rows list.
   */
  toRows(): readonly Row[] {
    return Object.entries(this.results).map(([date_str, value]) => ({
      date: date_str,
      sum: value,
    }));
  }

  /**
   * Column contract of the `.df` frame.
   *
   * @returns `["date", "sum"]`.
   */
  rowColumns(): readonly string[] {
    return ["date", "sum"];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`
   * (`computed_at` emitted ONLY when non-`null`, exactly as Python
   * conditionally adds it).
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      event: this.event,
      from_date: this.from_date,
      to_date: this.to_date,
      property_expr: this.property_expr,
      unit: this.unit,
      results: this.results,
    };
    if (this.computed_at !== null) {
      result["computed_at"] = this.computed_at;
    }
    return result;
  }

  /**
   * Re-encode the full declared field walk for golden diffs.
   *
   * @returns The recorded-payload shape (`_df_cache: null` included;
   *   `computed_at` always present — the recorder walks ALL declared
   *   fields).
   * @internal
   */
  toVectorPayload(): Record<string, unknown> {
    return {
      _df_cache: this._df_cache,
      event: this.event,
      from_date: this.from_date,
      to_date: this.to_date,
      property_expr: this.property_expr,
      unit: this.unit,
      results: this.results,
      computed_at: this.computed_at,
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
  static fromDict(raw: unknown): NumericSumResult {
    const cls = "NumericSumResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "event",
        "from_date",
        "to_date",
        "property_expr",
        "unit",
        "results",
        "computed_at",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    return new NumericSumResult({
      event: expectStr(payload, "event", cls),
      from_date: expectStr(payload, "from_date", cls),
      to_date: expectStr(payload, "to_date", cls),
      property_expr: expectStr(payload, "property_expr", cls),
      unit: expectStr(payload, "unit", cls) as HourDayUnit,
      ...(Object.hasOwn(payload, "results")
        ? {
            results: decodeNumberRecord(payload, "results", cls),
          }
        : {}),
      ...(Object.hasOwn(payload, "computed_at")
        ? { computed_at: expectStrOrNull(payload, "computed_at", cls) }
        : {}),
    });
  }
}

/**
 * Strictly decode a `dict[str, float]` field (values may arrive
 * float-tagged).
 *
 * @param raw - The payload.
 * @param field - Field name.
 * @param cls - Class name for error messages.
 * @returns The numeric record.
 * @throws ResponseValidationError - On wrong JSON types.
 */
function decodeNumberRecord(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  cls: string,
): Readonly<Record<string, number>> {
  const record = expectRecord(raw, field, cls);
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(record)) {
    const value = floatValue(item);
    if (value === undefined) {
      decodeFail(cls, `${field}[${JSON.stringify(key)}]`, "number", item);
    }
    out[key] = value;
  }
  return out;
}

/** Declared fields of {@link NumericAverageResult} (Python field order). */
export interface NumericAverageResultFields {
  /** Queried event name. */
  readonly event: string;
  /** Query start date. */
  readonly from_date: string;
  /** Query end date. */
  readonly to_date: string;
  /** Numeric property expression that was averaged. */
  readonly property_expr: string;
  /** Time unit for aggregation. */
  readonly unit: HourDayUnit;
  /** Per-date averages: `{date: average}`. Default: `{}`. */
  readonly results?: Readonly<Record<string, number>>;
  /** Codec-visible DataFrame cache slot — always `null` in TS. */
  readonly _df_cache?: null | undefined;
}

/**
 * Result of a numeric-average segmentation query — TS port of
 * `types.NumericAverageResult`.
 */
export class NumericAverageResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** Queried event name. */
  readonly event: string;

  /** Query start date. */
  readonly from_date: string;

  /** Query end date. */
  readonly to_date: string;

  /** Numeric property expression that was averaged. */
  readonly property_expr: string;

  /** Time unit for aggregation. */
  readonly unit: HourDayUnit;

  /** Per-date averages: `{date: average}`. */
  readonly results: Readonly<Record<string, number>>;

  /**
   * Create a numeric-average result.
   *
   * @param fields - Declared fields; absent `results` defaults to `{}`.
   */
  constructor(fields: NumericAverageResultFields) {
    this.event = fields.event;
    this.from_date = fields.from_date;
    this.to_date = fields.to_date;
    this.property_expr = fields.property_expr;
    this.unit = fields.unit;
    this.results = fields.results ?? {};
  }

  /**
   * Pre-pandas rows of the Python `.df` body: one `{date, average}`
   * row per results entry.
   *
   * @returns The rows list.
   */
  toRows(): readonly Row[] {
    return Object.entries(this.results).map(([date_str, value]) => ({
      date: date_str,
      average: value,
    }));
  }

  /**
   * Column contract of the `.df` frame.
   *
   * @returns `["date", "average"]`.
   */
  rowColumns(): readonly string[] {
    return ["date", "average"];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      event: this.event,
      from_date: this.from_date,
      to_date: this.to_date,
      property_expr: this.property_expr,
      unit: this.unit,
      results: this.results,
    };
  }

  /**
   * Re-encode the full declared field walk for golden diffs.
   *
   * @returns The recorded-payload shape (`_df_cache: null` included).
   * @internal
   */
  toVectorPayload(): Record<string, unknown> {
    return {
      _df_cache: this._df_cache,
      event: this.event,
      from_date: this.from_date,
      to_date: this.to_date,
      property_expr: this.property_expr,
      unit: this.unit,
      results: this.results,
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
  static fromDict(raw: unknown): NumericAverageResult {
    const cls = "NumericAverageResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "event",
        "from_date",
        "to_date",
        "property_expr",
        "unit",
        "results",
        "_df_cache",
      ]),
      cls,
    );
    expectNullCache(payload, "_df_cache", cls);
    return new NumericAverageResult({
      event: expectStr(payload, "event", cls),
      from_date: expectStr(payload, "from_date", cls),
      to_date: expectStr(payload, "to_date", cls),
      property_expr: expectStr(payload, "property_expr", cls),
      unit: expectStr(payload, "unit", cls) as HourDayUnit,
      ...(Object.hasOwn(payload, "results")
        ? {
            results: decodeNumberRecord(payload, "results", cls),
          }
        : {}),
    });
  }
}
