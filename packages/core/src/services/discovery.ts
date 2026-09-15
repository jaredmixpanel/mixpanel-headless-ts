/**
 * Discovery service — TS port of
 * `mixpanel_headless/_internal/services/discovery.py` (920 lines,
 * whole file) for Phase-3 batch B5, shard S1
 * (`docs/history/phase3/design/b5-packets.md` §4).
 *
 * Contents, in Python source order: the five Lexicon/bookmark parser
 * functions (`:43-142`), the subproperty-inference helpers
 * (`:150-356`), and {@link DiscoveryService} (`:359-920`) with its
 * lifetime in-memory caches (no TTL; `list_top_events` deliberately
 * uncached, `:375`).
 *
 * Port-wide conventions applied here:
 *
 * - R10.8 — the wire calls are the ALREADY-PORTED B4 client methods
 *   (`getEvents`, `getEventProperties`, `getPropertyValues`,
 *   `listFunnels`, `listCohorts`, `listBookmarks`, `getTopEvents`,
 *   `getSchemas`, `getSchema`, `listEventDefinitions`,
 *   `listPropertyDefinitions`, `listPerEventProperties`); nothing is
 *   re-assembled here.
 * - B4 client methods hand back the lossless `JsonValue` tree
 *   (`JsonNumber` tokens intact); every consumption point converts with
 *   {@link toNativeJson} — the documented point where the TS wire layer
 *   matches Python's `json.loads` product.
 * - R4.8 — the tuple-keyed Python caches become `Map`s keyed by the
 *   JSON encoding of the same tuple (prototype-safe; no `in` on a bare
 *   object).
 * - R11.5 — every `sorted(...)` is code-point ordered
 *   ({@link sortedByCodepoint} / {@link compareCodepoints}), never JS
 *   default UTF-16-unit ordering.
 * - R9.5 — the `_logger.debug` site and the `warnings.warn` side channel
 *   are injected seams ({@link DiscoveryLogger} / {@link WarningSink});
 *   `core` never touches `console`.
 */

import type { MixpanelClient } from "../client/client.js";
import { type JsonValue, toNativeJson } from "../client/json-value.js";
import { LosslessJsonError, parseLossless } from "../client/lossless-json.js";
import {
  codepoints,
  compareCodepoints,
  cpLength,
  sortedByCodepoint,
} from "../compat/codepoint.js";
import { pythonRepr, pythonStrOf } from "../compat/index.js";
import { KeyError, ValueError } from "../compat/python-builtins.js";
import { isPythonDict, setOwn } from "../compat/python-dict.js";
import { PYTHON_STR_WHITESPACE } from "../compat/whitespace.gen.js";
import { EventNotFoundError, QueryError } from "../errors.js";
import type { BookmarkType, CustomPropertyType } from "../types/literals.js";
import {
  BookmarkInfo,
  FunnelInfo,
  LexiconDefinition,
  LexiconMetadata,
  LexiconProperty,
  LexiconSchema,
  SavedCohort,
  SchemaGraphResult,
  SubPropertyInfo,
  TopEvent,
} from "../types/results/discovery.js";
import { pyTruthy } from "../types/results/result-base.js";
import { isLeapYear } from "./queries/py-dates.js";
import { dictGet, passthrough } from "./shared.js";

/**
 * The `warnings.warn(..., UserWarning)` side channel as an injected
 * seam (R9.5 — `core` has no stderr). Python's default action prints
 * the warning and continues; the TS default is a no-op sink, so the
 * observable behaviour (the call still returns) is preserved and hosts
 * that care (CLI, tests) pass their own sink.
 *
 * @param message - The warning text (out of contract, R5.4 — the tests
 *   that assert on it match Python's wording verbatim).
 */
export type WarningSink = (message: string) => void;

/** Debug-log seam for the `_logger.debug` site (R9.5). */
export interface DiscoveryLogger {
  /**
   * Record a debug message.
   *
   * @param message - The formatted text (never vector-compared).
   */
  debug: (message: string) => void;
}

/** Construction options of {@link DiscoveryService}. */
export interface DiscoveryServiceOptions {
  /** `warnings.warn` sink for {@link inferSubproperties}. */
  readonly warn?: WarningSink | undefined;
  /** Debug logger for the schema-graph drop summary. */
  readonly logger?: DiscoveryLogger | undefined;
}

/**
 * ISO-8601 date or datetime pre-filter (`discovery.py:154-156`).
 *
 * Deliberately identical to the Python source character for character.
 * One documented, behaviour-neutral divergence: Python's `$` also
 * matches just before a trailing newline, so `"2025-04-23\n"` passes
 * the Python pre-filter and is then rejected by
 * {@link isValidIso}; the JS `$` rejects it at the pre-filter. Both
 * paths classify the value as `"string"`.
 */
const DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(?:Z|([+-])(\d{2}):?(\d{2}))?)?$/;

/** Maximum distinct sample values retained per subproperty (`:159`). */
const MAX_SAMPLE_VALUES = 5;

// ---------------------------------------------------------------------------
// Lexicon schema parser functions (`discovery.py:43-142`)
// ---------------------------------------------------------------------------

/**
 * Read a REQUIRED mapping member the way Python's `d[key]` does.
 *
 * @param data - The mapping.
 * @param key - The key to read.
 * @returns The member.
 * @throws KeyError - When the key is absent (the CPython twin; these
 *   parsers do no validation, so a malformed API row raises exactly
 *   where Python's subscript does).
 */
function dictIndex(
  data: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  if (!Object.hasOwn(data, key)) {
    throw new KeyError(key);
  }
  return data[key];
}

/**
 * Parse Lexicon metadata from an API response
 * (`_parse_lexicon_metadata`, `discovery.py:43-68`).
 *
 * @param data - Raw metadata dict (may carry `com.mixpanel`), or `null`.
 * @returns The metadata when `com.mixpanel` is present and truthy,
 *   `null` otherwise.
 * @internal
 */
export function parseLexiconMetadata(
  data: Readonly<Record<string, unknown>> | null,
): LexiconMetadata | null {
  if (data === null) {
    return null;
  }
  const mpData = dictGet(data, "com.mixpanel", {});
  // Python `if not mp_data` — empty dict / None / "" / 0 are falsy.
  if (!pyTruthy(mpData)) {
    return null;
  }
  const mp = mpData as Readonly<Record<string, unknown>>;
  return new LexiconMetadata({
    source: passthrough(dictGet(mp, "$source", null)),
    display_name: passthrough(dictGet(mp, "displayName", null)),
    tags: passthrough(dictGet(mp, "tags", [])),
    hidden: passthrough(dictGet(mp, "hidden", false)),
    dropped: passthrough(dictGet(mp, "dropped", false)),
    contacts: passthrough(dictGet(mp, "contacts", [])),
    team_contacts: passthrough(dictGet(mp, "teamContacts", [])),
  });
}

/**
 * Parse a single Lexicon property (`_parse_lexicon_property`,
 * `discovery.py:71-84`).
 *
 * @param data - Raw property dict.
 * @returns The parsed property (`type` defaults to `"string"`).
 * @internal
 */
export function parseLexiconProperty(
  data: Readonly<Record<string, unknown>>,
): LexiconProperty {
  return new LexiconProperty({
    type: passthrough(dictGet(data, "type", "string")),
    description: passthrough(dictGet(data, "description", null)),
    metadata: parseLexiconMetadata(
      passthrough(dictGet(data, "metadata", null)),
    ),
  });
}

/**
 * Parse a Lexicon definition (`_parse_lexicon_definition`,
 * `discovery.py:87-102`).
 *
 * @param data - Raw `schemaJson` dict.
 * @returns The parsed definition.
 * @internal
 */
export function parseLexiconDefinition(
  data: Readonly<Record<string, unknown>>,
): LexiconDefinition {
  const propertiesRaw = dictGet(data, "properties", {}) as Readonly<
    Record<string, unknown>
  >;
  const properties: Record<string, LexiconProperty> = {};
  for (const [key, value] of Object.entries(propertiesRaw)) {
    setOwn(
      properties,
      key,
      parseLexiconProperty(value as Readonly<Record<string, unknown>>),
    );
  }
  return new LexiconDefinition({
    description: passthrough(dictGet(data, "description", null)),
    properties,
    metadata: parseLexiconMetadata(
      passthrough(dictGet(data, "metadata", null)),
    ),
  });
}

/**
 * Parse a complete Lexicon schema (`_parse_lexicon_schema`,
 * `discovery.py:105-118`).
 *
 * @param data - Raw schema dict.
 * @returns The parsed schema.
 * @throws KeyError - Missing `entityType` / `name` / `schemaJson`
 *   (Python subscripts them directly).
 * @internal
 */
export function parseLexiconSchema(
  data: Readonly<Record<string, unknown>>,
): LexiconSchema {
  return new LexiconSchema({
    entity_type: passthrough(dictIndex(data, "entityType")),
    name: passthrough(dictIndex(data, "name")),
    schema_json: parseLexiconDefinition(
      dictIndex(data, "schemaJson") as Readonly<Record<string, unknown>>,
    ),
  });
}

/**
 * Parse a bookmark row into {@link BookmarkInfo} (`_parse_bookmark_info`,
 * `discovery.py:121-142`).
 *
 * @param data - Raw bookmark dict.
 * @returns The parsed bookmark metadata.
 * @throws KeyError - Missing `id` / `name` / `type` / `project_id` /
 *   `created` / `modified`.
 * @internal
 */
export function parseBookmarkInfo(
  data: Readonly<Record<string, unknown>>,
): BookmarkInfo {
  return new BookmarkInfo({
    id: passthrough(dictIndex(data, "id")),
    name: passthrough(dictIndex(data, "name")),
    type: passthrough(dictIndex(data, "type")),
    project_id: passthrough(dictIndex(data, "project_id")),
    created: passthrough(dictIndex(data, "created")),
    modified: passthrough(dictIndex(data, "modified")),
    workspace_id: passthrough(dictGet(data, "workspace_id", null)),
    dashboard_id: passthrough(dictGet(data, "dashboard_id", null)),
    description: passthrough(dictGet(data, "description", null)),
    creator_id: passthrough(dictGet(data, "creator_id", null)),
    creator_name: passthrough(dictGet(data, "creator_name", null)),
  });
}

// ---------------------------------------------------------------------------
// Subproperty inference (`discovery.py:150-356`)
// ---------------------------------------------------------------------------

/** Days per month, non-leap (`datetime` calendar validity). */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * Whether `s` parses as a valid ISO-8601 date or datetime — the
 * `datetime.fromisoformat` twin for the strings {@link DATE_PATTERN}
 * admits (`_is_valid_iso`, `discovery.py:174-194`).
 *
 * Because the caller only ever passes pattern-matched strings, the
 * grammar is already fixed and the remaining question is calendar
 * validity. The rules below were probed against the arbiter
 * interpreter (CPython 3.14.6, 2026-08-16):
 *
 * - year 1..9999 (`0000-01-01` raises — `MINYEAR` is 1),
 * - month 1..12, day 1..days-in-month (proleptic Gregorian leap rule),
 * - hour 0..23, or exactly 24 when minute, second and microsecond are
 *   all zero (`2025-04-23T24:00:00` parses; `T24:00:01` does not),
 * - minute 0..59, second 0..59,
 * - fractional seconds: any digit count, TRUNCATED to 6 digits
 *   (`.0000009` → microsecond 0, so it stays legal after `T24:00:00`),
 * - UTC offset: total `±(hh*60 + mm)` minutes strictly inside ±24h
 *   (`+00:60` is legal — the minutes field is not bounded on its own).
 *
 * The Python source strips a single trailing `Z` before parsing; the
 * pattern only ever admits one, and the offset branch is mutually
 * exclusive with it.
 *
 * @param s - A string that already matched {@link DATE_PATTERN}.
 * @returns Whether it represents a real calendar date/datetime.
 * @internal
 */
export function isValidIso(s: string): boolean {
  const match = DATE_PATTERN.exec(s);
  if (match === null) {
    return false;
  }
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    fractionText,
    offsetSign,
    offsetHourText,
    offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1 || year > 9999) {
    return false;
  }
  if (month < 1 || month > 12) {
    return false;
  }
  const monthDays =
    month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] as number);
  if (day < 1 || day > monthDays) {
    return false;
  }
  if (hourText === undefined) {
    return true;
  }
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = secondText === undefined ? 0 : Number(secondText);
  // CPython truncates the fraction to microsecond resolution.
  const microsecond =
    fractionText === undefined
      ? 0
      : Number(fractionText.slice(0, 6).padEnd(6, "0"));
  if (minute > 59 || second > 59) {
    return false;
  }
  if (hour === 24) {
    if (minute !== 0 || second !== 0 || microsecond !== 0) {
      return false;
    }
  } else if (hour > 24) {
    return false;
  }
  if (offsetSign !== undefined) {
    const offsetMinutes =
      Number(offsetHourText) * 60 + Number(offsetMinuteText);
    if (offsetMinutes >= 24 * 60) {
      return false;
    }
  }
  return true;
}

/** One observed scalar sub-value (Python `str | int | float | bool`). */
export type ScalarSubValue = string | number | boolean;

/**
 * Infer the type of a homogeneous-ish sequence of scalar sub-values
 * (`_infer_scalar_type`, `discovery.py:197-234`).
 *
 * Boolean is checked before number because Python treats `bool` as a
 * subclass of `int` (in TS the two are already disjoint runtime types,
 * but the check ORDER is preserved so a mixed `[True, 1]` list takes
 * the same third branch and reports `("string", true)`).
 *
 * @param values - All scalar values observed for one subproperty.
 *   Callers filter `None` out upstream.
 * @returns `[inferredType, mixedObserved]`; mixed observations report
 *   `["string", true]` so the caller can warn.
 * @throws ValueError - When `values` is empty (Python guards because
 *   `all([])` would silently classify as `boolean`).
 * @internal
 */
export function inferScalarType(
  values: readonly ScalarSubValue[],
): [CustomPropertyType, boolean] {
  if (values.length === 0) {
    throw new ValueError("_infer_scalar_type requires non-empty values");
  }
  if (values.every((v) => typeof v === "boolean")) {
    return ["boolean", false];
  }
  if (values.every((v) => typeof v === "number")) {
    return ["number", false];
  }
  const strs = values.filter((v): v is string => typeof v === "string");
  if (strs.length === values.length) {
    if (strs.every((s) => DATE_PATTERN.test(s) && isValidIso(s))) {
      return ["datetime", false];
    }
    return ["string", false];
  }
  return ["string", true];
}

/**
 * Parse raw property-value strings into dict rows (`_iter_dict_rows`,
 * `discovery.py:237-267`).
 *
 * Each raw value may be a JSON object (one row), a JSON array of
 * objects (many rows), or anything else (skipped). A value that fails to
 * parse is skipped and reported once through `logger.debug` — the twin
 * of Python's `_logger.debug` for the `TypeError`/`ValueError` it drops
 * from `json.loads` (the text is not contract, R9.5).
 *
 * Parsing goes through {@link parseLossless} with `pythonConstants`
 * (packet §0.2) so `NaN`/`Infinity` bodies parse rather than raise the
 * way `JSON.parse` would; {@link toNativeJson} then matches
 * `json.loads`'s native product.
 *
 * @param rawValues - Strings from the property-values endpoint.
 * @param logger - Optional debug sink for the skipped values.
 * @returns Flat list of dict rows, order preserved.
 * @internal
 */
export function iterDictRows(
  rawValues: readonly string[],
  logger?: DiscoveryLogger,
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const raw of rawValues) {
    let parsed: unknown;
    try {
      parsed = toNativeJson(parseLossless(raw, { pythonConstants: true }));
    } catch (error) {
      if (!(error instanceof LosslessJsonError)) {
        throw error;
      }
      logger?.debug(`Skipping unparseable property value: ${error.message}`);
      continue;
    }
    if (isPythonDict(parsed)) {
      rows.push(parsed);
    } else if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (isPythonDict(item)) {
          rows.push(item);
        }
      }
    }
  }
  return rows;
}

/**
 * Split on the Python `re.split(r"[\s_\-]+", text)` grammar
 * (`discovery.py:527,531`).
 *
 * R11.7 forbids a `\s` JS regex here: the two whitespace sets diverge
 * in both directions. The separator set is CPython's
 * {@link PYTHON_STR_WHITESPACE} (probe-verified equal to `re`'s `\s`
 * for `str` patterns, CPython 3.14.6) plus `_` and `-`. Leading and
 * trailing separators produce the empty-string members Python's
 * `re.split` emits — they participate in the overlap count, so they are
 * NOT filtered.
 *
 * @param text - The already-lowercased string.
 * @returns The split parts, empty members included.
 */
function splitWords(text: string): string[] {
  const isSeparator = (ch: string): boolean =>
    ch === "_" ||
    ch === "-" ||
    PYTHON_STR_WHITESPACE.has(ch.codePointAt(0) as number);
  const chars = codepoints(text);
  const parts: string[] = [];
  let current = "";
  let index = 0;
  while (index < chars.length) {
    const ch = chars[index] as string;
    if (isSeparator(ch)) {
      parts.push(current);
      current = "";
      // `[...]+` is greedy: one run of separators is ONE split point.
      while (index < chars.length && isSeparator(chars[index] as string)) {
        index += 1;
      }
      continue;
    }
    current += ch;
    index += 1;
  }
  parts.push(current);
  return parts;
}

/**
 * Build a sorted list of {@link SubPropertyInfo} from sampled raw
 * values (`_infer_subproperties`, `discovery.py:270-356`).
 *
 * Behaviour (verbatim from the Python docstring):
 *
 * - JSON `null` sub-values are missing data, not a type. Sub-keys seen
 *   only with `null` warn and are excluded.
 * - Sub-keys seen with both scalar and dict/list shapes warn and are
 *   reported using the scalar form.
 * - Sub-keys with mixed scalar types collapse to `"string"` with a
 *   warning.
 *
 * @param rawValues - Raw strings from the property-values endpoint.
 * @param warn - The `warnings.warn` sink (R9.5).
 * @param logger - Optional debug sink (see {@link iterDictRows}).
 * @returns Code-point-sorted subproperty infos.
 * @internal
 */
export function inferSubproperties(
  rawValues: readonly string[],
  warn: WarningSink,
  logger?: DiscoveryLogger,
): SubPropertyInfo[] {
  const rows = iterDictRows(rawValues, logger);
  if (rows.length === 0) {
    return [];
  }
  const perKey = new Map<string, ScalarSubValue[]>();
  const observed = new Set<string>();
  const sawScalar = new Set<string>();
  const sawDictOrList = new Set<string>();
  const sawNonNull = new Set<string>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      observed.add(key);
      if (value === null) {
        continue; // treat null sub-values as missing data, not a type
      }
      sawNonNull.add(key);
      if (isPythonDict(value) || Array.isArray(value)) {
        sawDictOrList.add(key);
        continue; // nested objects/lists out of scope for downstream API
      }
      sawScalar.add(key);
      const bucket = perKey.get(key);
      if (bucket === undefined) {
        perKey.set(key, [value as ScalarSubValue]);
      } else {
        bucket.push(value as ScalarSubValue);
      }
    }
  }
  const mixedShape = [...sawScalar].filter((name) => sawDictOrList.has(name));
  const nullOnly = [...observed].filter((name) => !sawNonNull.has(name));

  for (const name of sortedByCodepoint(mixedShape)) {
    warn(
      `Subproperty ${pythonRepr(name)} observed with both scalar and ` +
        `nested-object shapes across sampled rows; reporting the scalar form`,
    );
  }
  for (const name of sortedByCodepoint(nullOnly)) {
    warn(
      `Subproperty ${pythonRepr(name)} observed but all sampled values were ` +
        `null; not classifiable`,
    );
  }

  const out: SubPropertyInfo[] = [];
  for (const name of sortedByCodepoint([...perKey.keys()])) {
    const values = perKey.get(name) as ScalarSubValue[];
    if (values.length === 0) {
      continue;
    }
    const [inferred, mixed] = inferScalarType(values);
    if (mixed) {
      warn(
        `Subproperty ${pythonRepr(name)} has mixed value types across ` +
          `sampled rows; reporting as 'string'`,
      );
    }
    // Distinct sample values, preserving first-seen order, capped.
    // The membership test is Python's, not `Set`'s — see
    // {@link pySetKey} (R10.9 finding 1, `B5-S1-notes.md` §3).
    const seen = new Set<string>();
    const samples: ScalarSubValue[] = [];
    let nanCounter = 0;
    for (const value of values) {
      const key =
        typeof value === "number" && Number.isNaN(value)
          ? `nan:${String((nanCounter += 1))}`
          : pySetKey(value);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      samples.push(value);
      if (samples.length >= MAX_SAMPLE_VALUES) {
        break;
      }
    }
    out.push(
      new SubPropertyInfo({
        name,
        type: inferred,
        sample_values: samples,
      }),
    );
  }
  return out;
}

/**
 * Membership key with CPython `set` semantics for the scalar types
 * `_infer_subproperties` can hold (`str`, `int`, `float`, `bool`).
 *
 * CPython hashes by VALUE across the numeric tower and `bool` is a
 * subclass of `int`, so `{0}` already contains `False`, `-0.0` and
 * `0.0`, and `{1}` already contains `True`. A JS `Set` keeps `0`,
 * `-0` (SameValueZero folds this one) and `false` apart, which made
 * `[0, false]` sample as `[0, false]` where Python samples `[0]`
 * (R10.9 differential finding 1, 5/503 cases).
 *
 * `NaN` is handled by the caller: CPython compares it by identity
 * inside `set`, and every parsed `NaN` is a distinct object, so each
 * occurrence is a NEW element.
 *
 * @param value - One observed scalar.
 * @returns The membership key.
 */
function pySetKey(value: ScalarSubValue): string {
  if (typeof value === "string") {
    return `s:${value}`;
  }
  if (typeof value === "boolean") {
    return `n:${value ? "1" : "0"}`;
  }
  // `-0 === 0` in Python too; `+ 0` normalizes the JS spelling.
  return `n:${String(value === 0 ? 0 : value)}`;
}

// ---------------------------------------------------------------------------
// DiscoveryService (`discovery.py:359-920`)
// ---------------------------------------------------------------------------

/** Options bag of {@link DiscoveryService.listEvents}. */
export interface ListEventsOptions {
  /** Maximum events to return; `null`/absent defers to the client. */
  readonly limit?: number | null | undefined;
  /** `YYYY-MM-DD` lower bound; `null`/absent defers to the client. */
  readonly from_date?: string | null | undefined;
  /** `YYYY-MM-DD` upper bound; `null`/absent defers to the client. */
  readonly to_date?: string | null | undefined;
}

/** Options bag of {@link DiscoveryService.listPropertyValues}. */
export interface ListPropertyValuesOptions {
  /** Optional event name to scope the query. */
  readonly event?: string | null | undefined;
  /** Maximum number of values to return (Python default 100). */
  readonly limit?: number | undefined;
}

/** Options bag of {@link DiscoveryService.listSubproperties}. */
export interface ListSubpropertiesOptions {
  /** Optional event name to scope the sample. */
  readonly event?: string | null | undefined;
  /** Number of raw values to sample (Python default 50). */
  readonly sample_size?: number | undefined;
}

/** Options bag of {@link DiscoveryService.listTopEvents}. */
export interface ListTopEventsOptions {
  /** Counting method — `"general"`, `"unique"` or `"average"`. */
  readonly type?: string | undefined;
  /** Maximum events to return. */
  readonly limit?: number | null | undefined;
}

/** Options bag of {@link DiscoveryService.listSchemas}. */
export interface ListSchemasOptions {
  /** Optional entity-type filter (`"event"` / `"profile"`). */
  readonly entity_type?: string | null | undefined;
}

/** Options bag of {@link DiscoveryService.getSchemaGraph}. */
export interface GetSchemaGraphOptions {
  /** Request the property-level `densityLocal`. */
  readonly include_density?: boolean | undefined;
  /** Also gather user properties (Python default `true`). */
  readonly include_user_properties?: boolean | undefined;
  /** Bypass the per-instance cache and re-fetch. */
  readonly force_refresh?: boolean | undefined;
}

/**
 * Invert per-event property lists into a property→events map — TS port
 * of `_invert_per_event_properties` (`discovery.py:359-385`,
 * PR #215).
 *
 * Each input row is an event dict carrying a `properties` list (the
 * query-API `fetch_per_event_properties` shape). Rows without an event
 * name, and property entries that are not name-carrying dicts,
 * contribute no edges. Event order is preserved per property.
 *
 * @param perEventRows - Event dicts, each with an optional `properties`
 *   list.
 * @returns Map of property name to the ordered list of event names it
 *   appears on.
 */
function invertPerEventProperties(
  perEventRows: ReadonlyArray<Record<string, unknown>>,
): Map<string, string[]> {
  const propertyToEvents = new Map<string, string[]>();
  for (const eventRow of perEventRows) {
    const eventName = eventRow["name"];
    if (!pyTruthy(eventName)) {
      continue;
    }
    // Python `event_row.get("properties") or []` — a falsy value (None,
    // [], "", 0) reads as no properties; a non-list truthy value would
    // raise in the for-loop, matching Python's TypeError only for
    // non-iterables (dicts/strings iterate there) — the wire shape is a
    // list, and non-list truthy shapes are outside the ported contract.
    const rawProperties = eventRow["properties"];
    const properties: unknown[] = Array.isArray(rawProperties)
      ? rawProperties
      : [];
    for (const prop of properties) {
      if (!(isPythonDict(prop) && pyTruthy(prop["name"]))) {
        continue;
      }

      const key = pythonStrOf(prop["name"]);
      let attached = propertyToEvents.get(key);
      if (attached === undefined) {
        attached = [];
        propertyToEvents.set(key, attached);
      }
      attached.push(pythonStrOf(eventName));
    }
  }
  return propertyToEvents;
}

/** Cache-key tuple members (`str | int | None` in Python). */
type CacheKeyPart = string | number | boolean | null;

/**
 * Encode a Python tuple cache key as a Map key (R4.8 — no bare-object
 * lookup table).
 *
 * @param parts - The tuple members.
 * @returns A collision-free string encoding.
 */
function cacheKey(parts: readonly CacheKeyPart[]): string {
  return JSON.stringify(parts);
}

/**
 * Schema discovery service for Mixpanel projects — TS port of
 * `DiscoveryService` (`discovery.py:359-920`).
 *
 * Caching behaviour (verbatim): results live in memory for the lifetime
 * of the instance, keyed by the same tuples Python uses —
 * `("list_events", limit, from_date, to_date)`,
 * `("list_properties", event)`,
 * `("list_property_values", property, event, limit)`,
 * `("list_funnels",)`, `("list_cohorts",)`, `("list_schemas", entity_type)`,
 * `("get_schema", entity_type, name)` and, in a separate map,
 * `("schema_graph", include_density, include_user_properties)`.
 * `listTopEvents` is NOT cached (real-time data). {@link clearCache}
 * drops both maps.
 *
 * @example
 * ```typescript
 * const discovery = new DiscoveryService(client);
 * await discovery.listEvents(); // fetches
 * await discovery.listEvents(); // cached
 * discovery.clearCache();
 * await discovery.listEvents(); // fetches again
 * ```
 */
export class DiscoveryService {
  /** The bound wire client (`self._api_client`). @internal */
  readonly apiClient: MixpanelClient;

  /** List-shaped discovery cache (`self._cache`). @internal */
  readonly cache: Map<string, unknown[]> = new Map();

  /** Schema-graph cache (`self._schema_graph_cache`). @internal */
  readonly schemaGraphCache: Map<string, SchemaGraphResult> = new Map();

  /** The `warnings.warn` sink. */
  readonly #warn: WarningSink;

  /** The `_logger.debug` sink. */
  readonly #logger: DiscoveryLogger | undefined;

  /**
   * Initialize the discovery service (`__init__`, `discovery.py:393`).
   *
   * @param apiClient - Authenticated Mixpanel client (B4, R10.8).
   * @param options - Injected warning/debug seams (R9.5).
   */
  constructor(
    apiClient: MixpanelClient,
    options: DiscoveryServiceOptions = {},
  ) {
    this.apiClient = apiClient;
    this.#warn =
      options.warn ??
      ((): void => {
        // No sink injected: core has no stderr, so warnings are dropped
        // here; the node/browser entry points inject their own sink.
      });
    this.#logger = options.logger;
  }

  /**
   * List event names in the project (`list_events`,
   * `discovery.py:405-456`).
   *
   * Defaults are the client's (`limit=5000`, `from_date=2000-01-01`,
   * `to_date=today`); each `(limit, from_date, to_date)` triple caches
   * separately. Absent kwargs are NOT forwarded (Python builds the
   * kwargs dict conditionally, `:446-452`).
   *
   * @param options - Optional limit / date bounds.
   * @returns Code-point-sorted event names (a fresh list per call).
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Non-gate 403s and other 4xx errors.
   */
  async listEvents(options: ListEventsOptions = {}): Promise<string[]> {
    const limit = options.limit ?? null;
    const fromDate = options.from_date ?? null;
    const toDate = options.to_date ?? null;
    const key = cacheKey(["list_events", limit, fromDate, toDate]);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return [...(cached as string[])];
    }
    const result = await this.apiClient.getEvents({
      ...(limit === null ? {} : { limit }),
      ...(fromDate === null ? {} : { from_date: fromDate }),
      ...(toDate === null ? {} : { to_date: toDate }),
    });
    const sortedResult = sortedByCodepoint(result);
    this.cache.set(key, sortedResult);
    return [...sortedResult];
  }

  /**
   * List all properties for an event (`list_properties`,
   * `discovery.py:458-493`).
   *
   * @param event - Event name.
   * @returns Code-point-sorted property names.
   * @throws EventNotFoundError - The wire call answered 400; the event
   *   list is fetched and similar names are attached as suggestions.
   * @throws QueryError - Any other query failure (re-raised unchanged).
   */
  async listProperties(event: string): Promise<string[]> {
    const key = cacheKey(["list_properties", event]);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return [...(cached as string[])];
    }
    let result: string[];
    try {
      result = await this.apiClient.getEventProperties(event);
    } catch (error) {
      if (error instanceof QueryError && error.statusCode === 400) {
        const availableEvents = await this.listEvents();
        const similar = this.findSimilarEvents(event, availableEvents);
        throw new EventNotFoundError(event, similar);
      }
      throw error;
    }
    const sortedResult = sortedByCodepoint(result);
    this.cache.set(key, sortedResult);
    return [...sortedResult];
  }

  /**
   * Find events with similar names for suggestions
   * (`_find_similar_events`, `discovery.py:495-541`).
   *
   * Progressive strategy: exact case-insensitive match, then substring
   * matches (shortest first, capped at 5), then word-overlap matches
   * (highest overlap first, then shortest name, capped at 5).
   *
   * @param query - The event name that was not found.
   * @param events - Available event names.
   * @returns Up to five suggestions, most relevant first.
   * @internal
   */
  findSimilarEvents(query: string, events: readonly string[]): string[] {
    const queryLower = query.toLowerCase();

    // 1. Exact case-insensitive match (highest priority)
    const exactMatches = events.filter((e) => e.toLowerCase() === queryLower);
    if (exactMatches.length > 0) {
      return exactMatches;
    }

    // 2. Substring matches (query contained in event name)
    const substringMatches = events.filter((e) =>
      e.toLowerCase().includes(queryLower),
    );
    if (substringMatches.length > 0) {
      // Sort by length (shorter = more specific match). Python's
      // `sorted` is stable and `len()` counts CODE POINTS.
      return stableSortBy(substringMatches, (e) => cpLength(e)).slice(0, 5);
    }

    // 3. Word overlap matches
    const queryWords = new Set(splitWords(queryLower));
    const wordMatches: Array<[string, number]> = [];
    for (const e of events) {
      const eventWords = new Set(splitWords(e.toLowerCase()));
      let overlap = 0;
      for (const word of queryWords) {
        if (eventWords.has(word)) {
          overlap += 1;
        }
      }
      if (overlap > 0) {
        wordMatches.push([e, overlap]);
      }
    }

    if (wordMatches.length > 0) {
      // Sort by overlap count (descending), then by name length.
      const ordered = stableSortMulti(wordMatches, (entry) => [
        -entry[1],
        cpLength(entry[0]),
      ]);
      return ordered.slice(0, 5).map(([e]) => e);
    }

    return [];
  }

  /**
   * List inferred subproperties of a list-of-object property
   * (`list_subproperties`, `discovery.py:543-585`).
   *
   * @param propertyName - Top-level property name (e.g. `"cart"`).
   * @param options - Optional event scope and sample size.
   * @returns Code-point-sorted subproperty infos (possibly empty).
   * @throws AuthenticationError - Invalid credentials.
   */
  async listSubproperties(
    propertyName: string,
    options: ListSubpropertiesOptions = {},
  ): Promise<SubPropertyInfo[]> {
    const raw = await this.listPropertyValues(propertyName, {
      ...(options.event === undefined ? {} : { event: options.event }),
      limit: options.sample_size ?? 50,
    });
    return inferSubproperties(raw, this.#warn, this.#logger);
  }

  /**
   * List sample values for a property (`list_property_values`,
   * `discovery.py:587-622`).
   *
   * @param propertyName - Property name.
   * @param options - Optional event scope and limit.
   * @returns The values, UNSORTED (per research.md), a fresh list.
   * @throws AuthenticationError - Invalid credentials.
   */
  async listPropertyValues(
    propertyName: string,
    options: ListPropertyValuesOptions = {},
  ): Promise<string[]> {
    const event = options.event ?? null;
    const limit = options.limit ?? 100;
    const key = cacheKey(["list_property_values", propertyName, event, limit]);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return [...(cached as string[])];
    }
    const result = await this.apiClient.getPropertyValues(propertyName, {
      event,
      limit,
    });
    // Store a copy to prevent mutation if the client retains the array.
    this.cache.set(key, [...result]);
    return [...result];
  }

  /**
   * List all saved funnels (`list_funnels`, `discovery.py:624-647`).
   *
   * @returns Funnels sorted by name (code-point order), a fresh list.
   * @throws AuthenticationError - Invalid credentials.
   */
  async listFunnels(): Promise<FunnelInfo[]> {
    const key = cacheKey(["list_funnels"]);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return [...(cached as FunnelInfo[])];
    }
    const raw = await this.apiClient.listFunnels();
    const funnels = stableSortBy(
      raw.map((entry) => {
        const row = toNativeRecord(entry);
        return new FunnelInfo({
          funnel_id: passthrough(dictIndex(row, "funnel_id")),
          name: passthrough(dictIndex(row, "name")),
        });
      }),
      (info) => info.name,
    );
    this.cache.set(key, funnels);
    return [...funnels];
  }

  /**
   * List all saved cohorts (`list_cohorts`, `discovery.py:649-682`).
   *
   * @returns Cohorts sorted by name (code-point order), a fresh list.
   * @throws AuthenticationError - Invalid credentials.
   */
  async listCohorts(): Promise<SavedCohort[]> {
    const key = cacheKey(["list_cohorts"]);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return [...(cached as SavedCohort[])];
    }
    const raw = await this.apiClient.listCohorts();
    const cohorts = stableSortBy(
      raw.map((entry) => {
        const row = toNativeRecord(entry);
        return new SavedCohort({
          id: passthrough(dictIndex(row, "id")),
          name: passthrough(dictIndex(row, "name")),
          count: passthrough(dictIndex(row, "count")),
          description: passthrough(dictGet(row, "description", "")),
          created: passthrough(dictIndex(row, "created")),
          // Python `bool(c["is_visible"])` — the API sends 0/1.
          is_visible: pyTruthy(dictIndex(row, "is_visible")),
        });
      }),
      (cohort) => cohort.name,
    );
    this.cache.set(key, cohorts);
    return [...cohorts];
  }

  /**
   * List saved reports (bookmarks) (`list_bookmarks`,
   * `discovery.py:684-717`). NOT cached — bookmarks change often.
   *
   * @param bookmarkType - Optional report-type filter.
   * @returns The bookmark metadata rows.
   * @throws AuthenticationError - Invalid credentials.
   * @throws QueryError - Permission denied or invalid type parameter.
   */
  async listBookmarks(
    bookmarkType: BookmarkType | null = null,
  ): Promise<BookmarkInfo[]> {
    const raw = toNativeRecord(
      await this.apiClient.listBookmarks(bookmarkType),
    );
    // API returns a nested structure: {"results": {"results": [...]}}
    const resultsContainer = dictGet(raw, "results", {});
    const results = isPythonDict(resultsContainer)
      ? // Fallback for older/different API versions returning a flat list.
        (dictGet(resultsContainer, "results", []) as unknown[])
      : (resultsContainer as unknown[]);
    return results.map((bm) =>
      parseBookmarkInfo(bm as Readonly<Record<string, unknown>>),
    );
  }

  /**
   * Today's top events (`list_top_events`, `discovery.py:719-749`).
   * NOT cached — the data changes throughout the day.
   *
   * @param options - Counting type and limit.
   * @returns The top events (`amount` mapped onto `count`).
   * @throws AuthenticationError - Invalid credentials.
   */
  async listTopEvents(options: ListTopEventsOptions = {}): Promise<TopEvent[]> {
    // No caching - always fetch fresh data
    const raw = toNativeRecord(
      await this.apiClient.getTopEvents({
        type: options.type ?? "general",
        limit: options.limit ?? null,
      }),
    );
    const events = dictGet(raw, "events", []) as unknown[];
    return events.map((entry) => {
      const row = entry as Readonly<Record<string, unknown>>;
      return new TopEvent({
        event: passthrough(dictIndex(row, "event")),
        count: passthrough(dictIndex(row, "amount")), // Map amount -> count
        percent_change: passthrough(dictIndex(row, "percent_change")),
      });
    });
  }

  /**
   * Clear all cached discovery results (`clear_cache`,
   * `discovery.py:751-759`) — both the list-shaped cache and the
   * schema-graph cache.
   */
  clearCache(): void {
    this.cache.clear();
    this.schemaGraphCache.clear();
  }

  /**
   * List Lexicon schemas (`list_schemas`, `discovery.py:765-798`).
   *
   * @param options - Optional entity-type filter.
   * @returns Schemas sorted by `(entity_type, name)`, a fresh list.
   * @throws AuthenticationError - Invalid credentials.
   */
  async listSchemas(
    options: ListSchemasOptions = {},
  ): Promise<LexiconSchema[]> {
    const entityType = options.entity_type ?? null;
    const key = cacheKey(["list_schemas", entityType]);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return [...(cached as LexiconSchema[])];
    }
    const raw = (await this.apiClient.getSchemas({
      entity_type: entityType,
    })) as JsonValue[];
    const schemas = stableSortMulti(
      raw.map((entry) => parseLexiconSchema(toNativeRecord(entry))),
      (schema) => [schema.entity_type, schema.name],
    );
    this.cache.set(key, schemas);
    return [...schemas];
  }

  /**
   * Get a single Lexicon schema (`get_schema`, `discovery.py:800-831`).
   *
   * @param entityType - Entity type (`"event"` / `"profile"`).
   * @param name - Entity name.
   * @returns The schema.
   * @throws QueryError - Schema not found.
   */
  async getSchema(entityType: string, name: string): Promise<LexiconSchema> {
    const key = cacheKey(["get_schema", entityType, name]);
    const cached = this.cache.get(key);
    if (cached !== undefined && cached.length > 0) {
      return cached[0] as LexiconSchema;
    }
    const raw = await this.apiClient.getSchema(entityType, name);
    const schema = parseLexiconSchema(toNativeRecord(raw));
    this.cache.set(key, [schema]);
    return schema;
  }

  /**
   * Gather the full Lexicon schema and the event↔property graph
   * (`get_schema_graph`, `discovery.py:862-949` post-PR-#215).
   *
   * Three or four bulk calls: event definitions, event properties, and
   * the query-API per-event properties gather always, plus user
   * properties when requested. The per-event gather
   * (`data_definitions/events?fetch_per_event_properties`) is inverted
   * client-side into per-property `events` lists, which
   * {@link SchemaGraphResult} folds into the adjacency maps. The App
   * API's `includeEvents=true` bulk call is deliberately not used: it
   * computes the same join behind a ~120s gateway deadline it cannot
   * meet on large projects.
   *
   * @param options - Density / user-property / refresh switches.
   * @returns The schema graph.
   * @throws AuthenticationError | QueryError | ServerError -
   *   Per the wire contract.
   */
  async getSchemaGraph(
    options: GetSchemaGraphOptions = {},
  ): Promise<SchemaGraphResult> {
    const includeDensity = options.include_density ?? false;
    const includeUserProperties = options.include_user_properties ?? true;
    const forceRefresh = options.force_refresh ?? false;
    const key = cacheKey([
      "schema_graph",
      includeDensity,
      includeUserProperties,
    ]);
    if (!forceRefresh) {
      const cached = this.schemaGraphCache.get(key);
      if (cached !== undefined) {
        return cached;
      }
    }

    const events = (await this.apiClient.listEventDefinitions()).map((entry) =>
      toNativeRecord(entry),
    );
    const flatProperties = (
      await this.apiClient.listPropertyDefinitions({
        resource_type: "Event",
        include_density: includeDensity,
      })
    ).map((entry) => toNativeRecord(entry));
    const perEventRows = (await this.apiClient.listPerEventProperties()).map(
      (entry) => toNativeRecord(entry),
    );
    const propertyToEvents = invertPerEventProperties(perEventRows);
    // Attach the inverted edges as per-property `events` lists (copies,
    // not mutations) so `properties` keeps its single-source-of-truth
    // contract with SchemaGraphResult. Edges for properties absent from
    // the flat list are dropped — the flat list defines the node set.
    const properties = flatProperties.map((row) => ({
      ...row,
      events: (pyTruthy(row["name"])
        ? (propertyToEvents.get(pythonStrOf(row["name"])) ?? [])
        : []
      ).map((eventName) => ({ name: eventName })),
    }));
    let userProperties: Array<Record<string, unknown>> = [];
    if (includeUserProperties) {
      userProperties = (
        await this.apiClient.listPropertyDefinitions({ resource_type: "User" })
      ).map((entry) => toNativeRecord(entry));
    }

    // SchemaGraphResult derives the adjacency maps + meta (incl. drop
    // counts) in its constructor — `properties` is the single source.
    const result = new SchemaGraphResult({
      computed_at: isoUtc(this.apiClient.core.now()),
      events,
      properties,
      user_properties: userProperties,
      include_density: includeDensity,
      params: {
        include_density: includeDensity,
        include_user_properties: includeUserProperties,
      },
    });
    // A nonzero drop count means rows were skipped for a missing name
    // or a malformed events entry — surface it at debug level so an
    // empty/odd graph can be diagnosed.
    const meta = result.meta;
    if (
      [
        "events_without_name",
        "properties_without_name",
        "property_event_entries_dropped",
      ].some((metaKey) => pyTruthy(meta[metaKey]))
    ) {
      this.#logger?.debug(
        `schema_graph dropped ${String(meta["events_without_name"])} nameless ` +
          `event(s), ${String(meta["properties_without_name"])} nameless ` +
          `propert(y/ies), ${String(meta["property_event_entries_dropped"])} ` +
          `malformed property->event entr(y/ies); ` +
          `${String(meta["relationship_edges"])} relationship edge(s) ` +
          `survived (possible Lexicon contract change)`,
      );
    }
    this.schemaGraphCache.set(key, result);
    return result;
  }
}

/**
 * `datetime.now(timezone.utc).isoformat()` (`discovery.py:889`) over
 * the client's injected clock seam (packet §0.4).
 *
 * CPython renders `+00:00` rather than `Z`, and omits the microsecond
 * group entirely when it is zero — both reproduced here.
 *
 * @param when - The clock reading.
 * @returns The ISO-8601 text.
 *
 * Exported for B5-S2 (R10.8): the query-user engine stamps
 * `computed_at` from the same `datetime.now(timezone.utc).isoformat()`
 * expression (`workspace.py:9711`, `:10112`, `:10051`).
 */
export function isoUtc(when: Date): string {
  const iso = when.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
  const millis = iso.slice(20, 23);
  const head = iso.slice(0, 19);
  return millis === "000" ? `${head}+00:00` : `${head}.${millis}000+00:00`;
}

/**
 * Convert one wire row to Python's `json.loads` product.
 *
 * TODO(Ω): the typed twin of {@link toNativeJson} — `workspace.ts` carries
 * an `unknown`-typed copy; home both as one export in `client/json-value.ts`.
 *
 * @param value - The lossless row.
 * @returns The native record.
 */
function toNativeRecord(value: JsonValue): Record<string, unknown> {
  return toNativeJson(value) as Record<string, unknown>;
}

/**
 * Python `sorted(items, key=...)` for a single comparable key: STABLE,
 * with code-point ordering for strings and numeric ordering for numbers.
 *
 * @param items - The input list (never mutated).
 * @param key - The sort key.
 * @returns A new, sorted list.
 */
function stableSortBy<T>(
  items: readonly T[],
  key: (item: T) => string | number,
): T[] {
  return stableSortMulti(items, (item) => [key(item)]);
}

/**
 * Python `sorted(items, key=...)` for a TUPLE key: STABLE, comparing
 * members left to right (strings by code point, numbers numerically).
 *
 * JS `Array.prototype.sort` is stable per spec, so no index tiebreak is
 * needed; the comparator only has to avoid UTF-16-unit string ordering.
 *
 * @param items - The input list (never mutated).
 * @param key - The tuple sort key.
 * @returns A new, sorted list.
 */
function stableSortMulti<T>(
  items: readonly T[],
  key: (item: T) => ReadonlyArray<string | number>,
): T[] {
  const decorated = items.map((item) => ({ item, sortKey: key(item) }));
  decorated.sort((left, right) => {
    const size = Math.min(left.sortKey.length, right.sortKey.length);
    for (let index = 0; index < size; index += 1) {
      const a = left.sortKey[index] as string | number;
      const b = right.sortKey[index] as string | number;
      if (typeof a === "string" && typeof b === "string") {
        const order = compareCodepoints(a, b);
        if (order !== 0) {
          return order;
        }
      } else if (a !== b) {
        return (a as number) < (b as number) ? -1 : 1;
      }
    }
    return 0;
  });
  return decorated.map((entry) => entry.item);
}
