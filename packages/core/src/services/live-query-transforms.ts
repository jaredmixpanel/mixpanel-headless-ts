/**
 * Live-query response transforms: the module-level functions that turn raw
 * `/segmentation`, `/funnels`, `/retention`, insights, flows and
 * activity-feed bodies into typed results (the service class lives in
 * `live-query.ts`). The arithmetic is transcribed statement for statement
 * because the corpus pins it byte-exactly (step 0 converts at the literal
 * `1.0`; an all-zero cohort yields `0.0`, never NaN), and every dict read
 * goes through the CPython-shaped helpers below so a non-mapping raises
 * the class Python raises, where Python raises it.
 *
 * @see mixpanel_headless._internal.services.live_query
 */

import {
  codepoints,
  compareCodepoints,
  cpSlice,
  sortedByCodepoint,
} from "../compat/codepoint.js";
import { AttributeError, ValueError } from "../compat/python-builtins.js";
import { isPythonDict, setOwn } from "../compat/python-dict.js";
import { pythonInt } from "../compat/python-int.js";
import { pythonRepr, pythonStr } from "../compat/python-str.js";
import { dictGet, pythonTypeName } from "../compat/python-values.js";
import { PYTHON_STR_WHITESPACE } from "../compat/whitespace.gen.js";
import { QueryError } from "../errors.js";
import { defined } from "../invariant.js";
import { fromTimestampUtcIso, timestampNumber } from "../query/transforms.js";
import type { HourDayUnit, TimeUnit } from "../types/literals.js";
import { safeInt } from "../types/results/flow-graph.js";
import { FlowTreeNode } from "../types/results/flow-tree.js";
import {
  ActivityFeedResult,
  CohortInfo,
  FlowsResult,
  FrequencyResult,
  FunnelResult,
  FunnelResultStep,
  NumericAverageResult,
  NumericBucketResult,
  NumericSumResult,
  RetentionResult,
  SavedReportResult,
  SegmentationResult,
  UserEvent,
} from "../types/results/live-query.js";
import {
  FlowQueryResult,
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
} from "../types/results/query-engine.js";
import { pyTruthy } from "../types/results/result-base.js";
import type { WarningSink } from "./discovery.js";
import { passthrough, pythonTypeNameOf } from "./shared.js";

/** Bookmark types `query_saved_report` normalizes. */
export type SavedReportBookmarkType =
  "insights" | "funnels" | "retention" | "flows";

/** Flow visualization modes (`_transform_flow_result` `mode`). */
export type FlowMode = "sankey" | "paths" | "tree";

// --- CPython-shaped helpers ---

/**
 * Narrow an unknown to the `Record` shape Python's `dict` methods need.
 *
 * @param value - The candidate.
 * @returns The same value typed as a record (callers guard with
 *   {@link isPythonDict} first, exactly where Python's `isinstance`
 *   guard sits).
 */
function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value as Readonly<Record<string, unknown>>;
}

/**
 * Assert that a value really is a Python mapping before a `.get(...)` /
 * `.items()` / `.values()` call reads it.
 *
 * @remarks
 * CPython raises `AttributeError` the moment attribute lookup for the
 * mapping method fails on a non-mapping (`None.items()`,
 * `"str".get(...)`). JS would either throw the wrong class
 * (`Object.values(null)` → `TypeError`) or silently succeed
 * (`Object.hasOwn("str", "first")` → `false`), so the check is
 * explicit; the mapping test is {@link isPythonDict}. Found by the
 * differential oracle.
 * @param value - The candidate mapping.
 * @param attr - The mapping method Python was about to look up.
 * @returns The same value, typed as a record.
 * @throws {@link AttributeError} - When `value` is not a Python dict.
 * @example
 * ```typescript
 * pyMapping({ a: 1 }, "get"); // { a: 1 }
 * pyMapping(null, "items");
 * // throws AttributeError: 'NoneType' object has no attribute 'items'
 * ```
 */
export function pyMapping(
  value: unknown,
  attr: "get" | "items" | "keys" | "values",
): Readonly<Record<string, unknown>> {
  if (!isPythonDict(value)) {
    throw new AttributeError(
      `'${pythonTypeName(value)}' object has no attribute '${attr}'`,
    );
  }
  return asRecord(value);
}

/**
 * Read a member like `raw.get(key, {})` whose result is then consumed
 * with `.get(...)`.
 *
 * @remarks
 * Python raises `AttributeError` at the nested read when the member is
 * not a dict (`None.get(...)`, `"str".get(...)`), so the helper guards
 * with {@link pyMapping}; a plain `Object.hasOwn` read would silently
 * return `false` for str/list/number receivers.
 * @param data - The mapping.
 * @param key - The key to read.
 * @returns The member when present, otherwise an empty record.
 * @throws {@link AttributeError} - When the member is present but not a
 *   dict.
 */
function dictGetRecord(
  data: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  return pyMapping(dictGet(data, key, {}), "get");
}

/**
 * Return the first Python-truthy candidate, else the fallback
 * (`a or b or fallback`).
 *
 * @param candidates - The operands, in order.
 * @param fallback - Returned when every candidate is falsy.
 * @returns The first Python-truthy candidate, or `fallback`.
 */
function firstPyTruthy(
  candidates: readonly unknown[],
  fallback: unknown,
): unknown {
  for (const candidate of candidates) {
    if (pyTruthy(candidate)) {
      return candidate;
    }
  }
  return fallback;
}

/**
 * Add two JSON values with CPython's binary `+` dispatch
 * (`existing + count` in `_transform_funnel`: raw values are stored and
 * coerced at the operator site).
 *
 * @param a - The left operand.
 * @param b - The right operand.
 * @returns Number addition, string concatenation or list concatenation,
 *   exactly as CPython dispatches.
 * @throws {@link TypeError} - CPython's "unsupported operand type(s)
 *   for +" message with both operand type names, in order.
 */
function pyAdd(a: unknown, b: unknown): unknown {
  const aNum = typeof a === "number" || typeof a === "boolean";
  const bNum = typeof b === "number" || typeof b === "boolean";
  if (aNum && bNum) {
    return Number(a) + Number(b);
  }
  if (typeof a === "string" && typeof b === "string") {
    return a + b;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const left: readonly unknown[] = a;
    const right: readonly unknown[] = b;
    return [...left, ...right];
  }
  throw new TypeError(
    `unsupported operand type(s) for +: '${pythonTypeNameOf(a)}' and '${pythonTypeNameOf(b)}'`,
  );
}

/**
 * Evaluate CPython's `value > 0` on a raw stored value (the division
 * guards).
 *
 * @param value - The left operand.
 * @returns The comparison result (`bool` compares as an int).
 * @throws {@link TypeError} - CPython's "not supported between
 *   instances" message for every non-numeric operand.
 */
function pyGtZero(value: unknown): boolean {
  if (typeof value === "number") {
    return value > 0;
  }
  if (typeof value === "boolean") {
    return value;
  }
  throw new TypeError(
    `'>' not supported between instances of '${pythonTypeNameOf(value)}' and 'int'`,
  );
}

/**
 * Divide with CPython's true division `a / b` (`count / prev_count`,
 * `count / size`; every call site is guarded by {@link pyGtZero}, so
 * the denominator is a positive number here).
 *
 * @param a - The numerator.
 * @param b - The denominator.
 * @returns IEEE-754 division (bools divide as ints).
 * @throws {@link TypeError} - CPython's "unsupported operand type(s)
 *   for /" message with both operand type names, in order.
 */
function pyDiv(a: unknown, b: unknown): number {
  const aNum = typeof a === "number" || typeof a === "boolean";
  const bNum = typeof b === "number" || typeof b === "boolean";
  if (aNum && bNum) {
    return Number(a) / Number(b);
  }
  throw new TypeError(
    `unsupported operand type(s) for /: '${pythonTypeNameOf(a)}' and '${pythonTypeNameOf(b)}'`,
  );
}

/**
 * Evaluate CPython's `key in container` for a string key
 * (`"steps" in date_data`): a str container is a substring test, a
 * list is a membership test, everything else raises.
 *
 * @param key - The string key.
 * @param container - The candidate container.
 * @returns The membership result.
 * @throws {@link TypeError} - CPython 3.14's "is not a container or
 *   iterable" message for non-container operands.
 */
function pyIn(key: string, container: unknown): boolean {
  if (isPythonDict(container)) {
    return Object.hasOwn(asRecord(container), key);
  }
  if (typeof container === "string") {
    return container.includes(key);
  }
  if (Array.isArray(container)) {
    return container.includes(key);
  }
  throw new TypeError(
    `argument of type '${pythonTypeNameOf(container)}' is not a container or iterable`,
  );
}

/**
 * List the items CPython's `for x in value` would visit over the JSON
 * value domain (a dict iterates its keys, a str its code points, a list
 * its members; everything else raises).
 *
 * @param value - The iterable candidate.
 * @returns The items Python's `for` would visit, in order.
 * @throws {@link TypeError} - CPython's `'<T>' object is not iterable`.
 */
function pyIter(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    return codepoints(value);
  }
  if (isPythonDict(value)) {
    return Object.keys(asRecord(value));
  }
  throw new TypeError(`'${pythonTypeNameOf(value)}' object is not iterable`);
}

/**
 * Sum an iterable as CPython `sum(...)` does over API numbers.
 *
 * @remarks
 * Python's `sum` starts at the int `0` and uses `+`, so a non-numeric
 * member raises `TypeError`. JS `+` would silently concatenate, so the
 * type is checked first: JS coercion must never invent a result Python
 * refuses to produce.
 * @param values - The values to add.
 * @returns The sum.
 * @throws {@link TypeError} - When a member is neither a number nor a
 *   bool (Python: `unsupported operand type(s) for +`).
 */
function pySum(values: Iterable<unknown>): number {
  let total = 0;
  for (const value of values) {
    total += pyNumber(value);
  }
  return total;
}

/**
 * Coerce an operand as CPython's `int + x` / `x / y` positions do;
 * `bool` is an `int` subclass, so `True` adds as 1.
 *
 * @param value - The operand.
 * @returns The numeric value.
 * @throws {@link TypeError} - When Python's arithmetic would refuse the
 *   type.
 */
function pyNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  throw new TypeError(
    `unsupported operand type(s) for +: 'int' and '${pythonTypeNameOf(value)}'`,
  );
}

/**
 * Yield the per-segment counts lazily, as the `sum(...)` generator of
 * `_transform_segmentation` does: each `.values()` lookup raises
 * `AttributeError` only when the generator reaches it, interleaved with
 * the `+` coercions `pySum` applies.
 *
 * @param values - The `data.values` member.
 * @yields Every per-segment count, in Python's iteration order.
 * @throws {@link AttributeError} - When `values` or a segment is not a
 *   dict.
 */
function* segmentationCounts(values: unknown): Generator {
  for (const segmentValues of Object.values(pyMapping(values, "values"))) {
    yield* Object.values(pyMapping(segmentValues, "values"));
  }
}

/**
 * Matches step names like `"1. Signup"` and captures (index, event)
 * (`_STEP_PREFIX_RE`).
 *
 * Two Python-`re` fidelity details are spelled out rather than reusing
 * the JS shorthand classes: `\d` in a Python `str` pattern matches every
 * Unicode decimal digit (`\p{Nd}`), not just ASCII, and `\s` matches the
 * 29 code points `str.isspace()` reports. Python's `$` additionally
 * matches just before a single trailing newline, which the optional
 * `\n` reproduces. The capture group is `[^\n]` rather than `.`
 * because Python's `.` excludes only `\n` while JS `.` also excludes
 * `\r`, U+2028 and U+2029.
 */
const STEP_PREFIX_RE = new RegExp(
  String.raw`^(\p{Nd}+)\.[${[...PYTHON_STR_WHITESPACE]
    .map((cp) => String.raw`\u{${cp.toString(16)}}`)
    .join("")}]*([^\n]+)(?:\n)?$`,
  "u",
);

// ---------------------------------------------------------------------------
// `_extract_steps_from_date_data`
// ---------------------------------------------------------------------------

/**
 * Extract the steps of one date's funnel data, handling the regular and
 * the segmented response formats: without `on` the data is
 * `{"steps": [step1, step2, ...]}`, with `on` it is
 * `{"$overall": [step1, ...], "Chrome": [...], ...}`.
 *
 * @param dateData - A single date's data from the funnel response.
 * @returns The step dictionaries (`[]` for an unrecognized format or a
 *   non-list member).
 * @throws {@link AttributeError} - When `dateData` is a str or list that
 *   contains the key (Python's `.get` on a non-dict).
 * @throws {@link TypeError} - When `dateData` is not a container.
 * @example
 * ```typescript
 * extractStepsFromDateData({ steps: [{ event: "Signup", count: 10 }] });
 * // [{ event: "Signup", count: 10 }]
 * extractStepsFromDateData({ $overall: [{ count: 3 }], Chrome: [] });
 * // [{ count: 3 }]
 * ```
 * @see mixpanel_headless._internal.services.live_query._extract_steps_from_date_data
 */
export function extractStepsFromDateData(dateData: unknown): unknown[] {
  // Non-segmented format: data has "steps" key. Python's `in` is a
  // substring test on a str member and a membership test on a list —
  // and the `.get(...)` that follows raises `AttributeError` on both
  // (probed against CPython).
  if (pyIn("steps", dateData)) {
    const steps = dictGet(pyMapping(dateData, "get"), "steps", []);
    return Array.isArray(steps) ? steps : [];
  }

  // Segmented format: use $overall for aggregate data
  if (pyIn("$overall", dateData)) {
    const overall = dictGet(pyMapping(dateData, "get"), "$overall", []);
    return Array.isArray(overall) ? overall : [];
  }

  // Fallback: no recognized format
  return [];
}

// ---------------------------------------------------------------------------
// `_transform_funnel`
// ---------------------------------------------------------------------------

/**
 * Transform a raw `/funnels` response into a {@link FunnelResult}.
 *
 * @remarks
 * Aggregates step counts across every date, then recomputes conversion
 * rates: step 0 is `1.0`, step N is `count[N] / count[N-1]` (guarded),
 * and the overall rate is last/first (guarded). This arithmetic is
 * byte-fidelity critical (see the module header).
 * @param raw - Raw API response with a `data[date]` structure.
 * @param funnelId - Funnel identifier.
 * @param fromDate - Query start date.
 * @param toDate - Query end date.
 * @returns The typed result with aggregated steps and rates.
 * @throws {@link AttributeError} - When `data`, a date's data or a step
 *   is not a dict.
 * @throws {@link TypeError} - When a step count is not a number
 *   (Python's `+`, `>` and `/`).
 * @example
 * ```typescript
 * const result = transformFunnel(
 *   {
 *     data: {
 *       "2026-05-01": {
 *         steps: [
 *           { event: "Signup", count: 100 },
 *           { event: "Purchase", count: 25 },
 *         ],
 *       },
 *     },
 *   },
 *   42,
 *   "2026-05-01",
 *   "2026-05-01",
 * );
 * // result.conversion_rate === 0.25
 * // result.steps[1].conversion_rate === 0.25
 * ```
 * @see mixpanel_headless._internal.services.live_query._transform_funnel
 */
export function transformFunnel(
  raw: Readonly<Record<string, unknown>>,
  funnelId: number,
  fromDate: string,
  toDate: string,
): FunnelResult {
  // `raw.get("data", {})` then `data.values()` — a non-mapping `data`
  // member is an `AttributeError` in CPython, not a `TypeError`.
  const data = pyMapping(dictGet(raw, "data", {}), "values");

  // Aggregate steps across all dates: step_idx -> (event, total_count).
  // Counts are stored raw — Python coerces only at the `+` aggregation
  // site (`existing + count`).
  const aggregatedCounts = new Map<number, [unknown, unknown]>();

  for (const dateData of Object.values(data)) {
    const stepsData = extractStepsFromDateData(dateData);
    for (const [idx, stepRaw] of stepsData.entries()) {
      // `step.get(...)` — a non-dict step raises in CPython.
      const step = pyMapping(stepRaw, "get");
      const event = dictGet(
        step,
        "event",
        dictGet(step, "goal", `Step ${idx + 1}`),
      );
      const count = dictGet(step, "count", 0);
      const existingEntry = aggregatedCounts.get(idx);
      if (existingEntry === undefined) {
        aggregatedCounts.set(idx, [event, count]);
      } else {
        aggregatedCounts.set(idx, [event, pyAdd(existingEntry[1], count)]);
      }
    }
  }

  // Build the step list with recalculated conversion rates. The `> 0`
  // guards and `/` divisions run on the raw values, raising CPython's
  // operator TypeErrors exactly where Python does.
  const steps: FunnelResultStep[] = [];
  let prevCount: unknown = 0;
  const orderedSteps = [...aggregatedCounts].sort((a, b) => a[0] - b[0]);
  for (const [idx, [event, count]] of orderedSteps) {
    let convRate: number;
    if (idx === 0) {
      convRate = 1.0;
    } else if (pyGtZero(prevCount)) {
      convRate = pyDiv(count, prevCount);
    } else {
      convRate = 0.0;
    }
    steps.push(
      new FunnelResultStep({
        event: passthrough(event),
        count: passthrough(count),
        conversion_rate: convRate,
      }),
    );
    prevCount = count;
  }

  // Overall conversion rate: last step / first step
  let overallRate: number;
  const first = steps[0];
  const last = steps.at(-1);
  if (first !== undefined && last !== undefined) {
    overallRate = pyGtZero(first.count) ? pyDiv(last.count, first.count) : 0.0;
  } else {
    overallRate = 0.0;
  }

  return new FunnelResult({
    funnel_id: funnelId,
    funnel_name: "", // Not available from API
    from_date: fromDate,
    to_date: toDate,
    conversion_rate: overallRate,
    steps,
  });
}

// ---------------------------------------------------------------------------
// `_transform_retention`
// ---------------------------------------------------------------------------

/**
 * Transform a raw `/retention` response into a {@link RetentionResult}.
 *
 * @remarks
 * `retention[i] = counts[i] / cohort_size`, guarded by `size > 0` — a
 * zero-size cohort yields `0.0` for every period (never a division by
 * zero, never NaN).
 * @param raw - Raw API response keyed by cohort date.
 * @param bornEvent - Event that defines cohort membership.
 * @param returnEvent - Event that defines return.
 * @param fromDate - Query start date.
 * @param toDate - Query end date.
 * @param unit - Retention period unit.
 * @returns The typed result with cohorts sorted by date (ascending).
 * @throws {@link AttributeError} - When a cohort value is not a dict.
 * @throws {@link TypeError} - When `first` or a count is not a number,
 *   or `counts` is not iterable.
 * @example
 * ```typescript
 * const result = transformRetention(
 *   { "2026-05-01": { first: 200, counts: [100, 50] } },
 *   "Signup",
 *   "Purchase",
 *   "2026-05-01",
 *   "2026-05-07",
 *   "day",
 * );
 * // result.cohorts[0].retention → [0.5, 0.25]
 * ```
 * @see mixpanel_headless._internal.services.live_query._transform_retention
 */
// eslint-disable-next-line max-params -- positional parameters mirror the Python signature 1:1
export function transformRetention(
  raw: Readonly<Record<string, unknown>>,
  bornEvent: string,
  returnEvent: string,
  fromDate: string,
  toDate: string,
  unit: TimeUnit,
): RetentionResult {
  const cohorts: CohortInfo[] = [];

  // Sort by date for consistent ordering
  for (const date of sortedByCodepoint(Object.keys(raw))) {
    // `cohort_data.get("first", 0)` — a non-mapping cohort value is an
    // `AttributeError` in CPython.
    const cohortData = pyMapping(raw[date], "get");
    // `size` is stored raw; Python compares/divides only inside the
    // per-count comprehension, so an empty `counts` never touches it.
    // Iteration is Python `for` — a dict iterates keys, a str its
    // code points.
    const size = dictGet(cohortData, "first", 0);
    const counts = dictGet(cohortData, "counts", []);

    // Calculate retention percentages
    const retention = pyIter(counts).map((count) =>
      pyGtZero(size) ? pyDiv(count, size) : 0.0,
    );

    cohorts.push(new CohortInfo({ date, size: passthrough(size), retention }));
  }

  return new RetentionResult({
    born_event: bornEvent,
    return_event: returnEvent,
    from_date: fromDate,
    to_date: toDate,
    unit,
    cohorts,
  });
}

// ---------------------------------------------------------------------------
// `_transform_segmentation`
// ---------------------------------------------------------------------------

/**
 * Transform a raw `/segmentation` response into a
 * {@link SegmentationResult}, totalling every count in `data.values`.
 *
 * @param raw - Raw API response.
 * @param event - Event name that was queried.
 * @param fromDate - Query start date.
 * @param toDate - Query end date.
 * @param unit - Time aggregation unit.
 * @param on - Property used for segmentation (or `null`).
 * @returns The typed result with the calculated total.
 * @throws {@link AttributeError} - When `data`, `values` or a segment is
 *   not a dict.
 * @throws {@link TypeError} - When a count is not a number.
 * @example
 * ```typescript
 * const result = transformSegmentation(
 *   { data: { values: { Signup: { "2026-05-01": 3, "2026-05-02": 4 } } } },
 *   "Signup",
 *   "2026-05-01",
 *   "2026-05-02",
 *   "day",
 *   null,
 * );
 * // result.total === 7
 * ```
 * @see mixpanel_headless._internal.services.live_query._transform_segmentation
 */
// eslint-disable-next-line max-params -- positional parameters mirror the Python signature 1:1
export function transformSegmentation(
  raw: Readonly<Record<string, unknown>>,
  event: string,
  fromDate: string,
  toDate: string,
  unit: TimeUnit,
  on: string | null,
): SegmentationResult {
  // `raw.get("data", {}).get("values", {})` — non-dict members raise
  // `AttributeError` in CPython.
  const data = dictGetRecord(raw, "data");
  const values = dictGet(data, "values", {});

  // Calculate total by summing all counts. The generator is lazy in
  // Python: `sum(count for segment_values in values.values() for count
  // in segment_values.values())` — a bad count in an early segment
  // raises the `+` TypeError before a later segment's `.values()`
  // AttributeError is reached, so the TS twin iterates lazily too.
  const total = pySum(segmentationCounts(values));

  return new SegmentationResult({
    event,
    from_date: fromDate,
    to_date: toDate,
    unit,
    segment_property: on,
    total,
    series: passthrough(values),
  });
}

// ---------------------------------------------------------------------------
// `_transform_query_result`
// ---------------------------------------------------------------------------

/**
 * Transform a raw insights-query response into a {@link QueryResult}.
 *
 * @param raw - Raw API response from the insights query.
 * @param bookmarkParams - The bookmark params dict sent to the API.
 * @returns The typed result with every field populated.
 * @throws {@link QueryError} - When the response carries an `error` key
 *   (error-as-200) or is missing `series`.
 * @throws {@link AttributeError} - When `date_range` is not a dict.
 * @example
 * ```typescript
 * const result = transformQueryResult(
 *   {
 *     computed_at: "2026-05-02T00:00:00",
 *     date_range: { from_date: "2026-05-01", to_date: "2026-05-01" },
 *     headers: ["$event"],
 *     series: { Signup: { all: 7 } },
 *   },
 *   { events: [{ event: "Signup" }] },
 * );
 * // result.series → { Signup: { all: 7 } }
 * ```
 * @see mixpanel_headless._internal.services.live_query._transform_query_result
 */
export function transformQueryResult(
  raw: Readonly<Record<string, unknown>>,
  bookmarkParams: Readonly<Record<string, unknown>>,
): QueryResult {
  // Check for error responses that leaked through as HTTP 200
  if (Object.hasOwn(raw, "error")) {
    throw new QueryError(
      `Insights query failed: ${pythonStr(passthrough(raw["error"]))}`,
      {
        statusCode: 200,
        responseBody: raw,
        requestBody: bookmarkParams,
      },
    );
  }

  if (!Object.hasOwn(raw, "series")) {
    throw new QueryError(
      "Insights query returned unexpected response shape " +
        `(missing 'series' key). Keys present: ${pythonRepr(
          sortedByCodepoint(Object.keys(raw)),
        )}`,
      { statusCode: 200, responseBody: raw, requestBody: bookmarkParams },
    );
  }

  const dateRange = dictGetRecord(raw, "date_range");
  return new QueryResult({
    computed_at: passthrough(dictGet(raw, "computed_at", "")),
    from_date: passthrough(dictGet(dateRange, "from_date", "")),
    to_date: passthrough(dictGet(dateRange, "to_date", "")),
    headers: passthrough(dictGet(raw, "headers", [])),
    series: passthrough(raw["series"]),
    params: passthrough(bookmarkParams),
    meta: passthrough(dictGet(raw, "meta", {})),
  });
}

// ---------------------------------------------------------------------------
// `_extract_funnel_steps_from_series`
// ---------------------------------------------------------------------------

/**
 * Compute the sort key of a funnel step name: the numeric prefix, then
 * the raw name.
 *
 * @param name - The step name (e.g. `"10. Purchase"`).
 * @returns The `(index, name)` tuple, with `2**31` for unprefixed names
 *   so they sort last.
 * @see mixpanel_headless._internal.services.live_query._step_sort_key
 */
function stepSortKey(name: string): [number, string] {
  const digits = STEP_PREFIX_RE.exec(name)?.[1];
  return digits === undefined ? [2 ** 31, name] : [pythonInt(digits), name];
}

/**
 * Pivot the metric-keyed insights funnel series into a flat list of
 * step dicts.
 *
 * @param series - Raw series data from the insights API response.
 * @param warn - Sink for the unrecognized-format `UserWarning`.
 * @returns Step dicts with `event`, `count`, `step_conv_ratio`,
 *   `overall_conv_ratio`, `avg_time` and `avg_time_from_start` keys.
 * @throws {@link AttributeError} - When a metric member is not a dict.
 * @example
 * ```typescript
 * const warnings: string[] = [];
 * const steps = extractFunnelStepsFromSeries(
 *   {
 *     Funnel: {
 *       count: { "1. Signup": { all: 100 }, "2. Purchase": { all: 25 } },
 *       step_conv_ratio: {
 *         "1. Signup": { all: 1 },
 *         "2. Purchase": { all: 0.25 },
 *       },
 *     },
 *   },
 *   (message) => warnings.push(message),
 * );
 * // steps[1] → { event: "Purchase", count: 25, step_conv_ratio: 0.25, … }
 * ```
 * @see mixpanel_headless._internal.services.live_query._extract_funnel_steps_from_series
 */
// eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export function extractFunnelStepsFromSeries(
  series: unknown,
  warn: WarningSink,
): Array<Record<string, unknown>> {
  if (Array.isArray(series)) {
    return series as Array<Record<string, unknown>>;
  }

  if (!isPythonDict(series)) {
    return [];
  }

  const seriesDict = asRecord(series);

  // Direct "steps" key (alternative format)
  if (Object.hasOwn(seriesDict, "steps")) {
    const steps = seriesDict["steps"];
    if (Array.isArray(steps)) {
      return steps as Array<Record<string, unknown>>;
    }
  }

  // Top-level "$overall" key (legacy/alternative format)
  if (Object.hasOwn(seriesDict, "$overall")) {
    const overall = seriesDict["$overall"];
    if (isPythonDict(overall) && Object.hasOwn(asRecord(overall), "steps")) {
      const overallSteps = asRecord(overall)["steps"];
      if (Array.isArray(overallSteps)) {
        return overallSteps as Array<Record<string, unknown>>;
      }
    }
    if (Array.isArray(overall)) {
      return overall as Array<Record<string, unknown>>;
    }
  }

  // Insights API funnel format:
  //   series = {funnel_key: {metric: {step: {seg: val}}}}
  // With group_by: {funnel_key: {$overall: {metric: ...}, segment: {...}}}
  // With trends:   {funnel_key: {date: {metric: ...}, ...}}
  let funnelData: Readonly<Record<string, unknown>> | null = null;
  for (const value of Object.values(seriesDict)) {
    if (!isPythonDict(value)) {
      continue;
    }
    const valueDict = asRecord(value);
    // Direct metrics format (no group_by, mode=steps)
    if (Object.hasOwn(valueDict, "count")) {
      funnelData = valueDict;
      break;
    }
    // Segmented format (group_by): look for $overall
    if (Object.hasOwn(valueDict, "$overall")) {
      const overallVal = valueDict["$overall"];
      if (
        isPythonDict(overallVal) &&
        Object.hasOwn(asRecord(overallVal), "count")
      ) {
        funnelData = asRecord(overallVal);
        break;
      }
    }
    // Trends format: look for first date-like key with metrics
    for (const subVal of Object.values(valueDict)) {
      if (isPythonDict(subVal) && Object.hasOwn(asRecord(subVal), "count")) {
        funnelData = asRecord(subVal);
        break;
      }
    }
    if (funnelData !== null) {
      break;
    }
  }

  if (funnelData === null) {
    if (pyTruthy(seriesDict)) {
      warn(
        "Funnel query returned data in an unrecognized format " +
          `(series keys: ${pythonRepr(sortedByCodepoint(Object.keys(seriesDict)))}). ` +
          "The raw response is available in the 'series' field.",
      );
    }
    return [];
  }

  // Extract step names from the "count" metric (always present)
  const countData = dictGet(funnelData, "count", {});
  if (!isPythonDict(countData)) {
    return [];
  }

  // Step names are like "1. Signup" — sort by numeric prefix so that
  // "10." follows "2." (a lexicographic sort would not).
  const stepNames = Object.keys(asRecord(countData)).sort((a, b) => {
    const [ai, an] = stepSortKey(a);
    const [bi, bn] = stepSortKey(b);
    return ai === bi ? compareCodepoints(an, bn) : ai - bi;
  });

  /**
   * Read a metric value for a step, unwrapping the `"all"` segment
   * (`_get_val`).
   *
   * @param metric - The metric name.
   * @param stepName - The step key.
   * @returns The metric value (`0` when absent or `None`).
   */
  const getVal = (metric: string, stepName: string): unknown => {
    const metricData = dictGet(funnelData, metric, {});
    // `metric_data.get(step_name, {})` — a non-dict metric member
    // raises `AttributeError` in CPython.
    const stepData = dictGet(pyMapping(metricData, "get"), stepName, {});
    if (isPythonDict(stepData)) {
      return dictGet(asRecord(stepData), "all", 0);
    }
    return stepData === null ? 0 : stepData;
  };

  // Build step dicts
  const result: Array<Record<string, unknown>> = [];
  for (const stepName of stepNames) {
    const event = STEP_PREFIX_RE.exec(stepName)?.[2] ?? stepName;

    result.push({
      event,
      count: getVal("count", stepName),
      step_conv_ratio: getVal("step_conv_ratio", stepName),
      overall_conv_ratio: getVal("overall_conv_ratio", stepName),
      avg_time: getVal("avg_time", stepName),
      avg_time_from_start: getVal("avg_time_from_start", stepName),
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// `_transform_funnel_result`
// ---------------------------------------------------------------------------

/**
 * Transform a raw insights funnel response into a
 * {@link FunnelQueryResult}.
 *
 * @param raw - Raw API response from the insights query.
 * @param bookmarkParams - The bookmark params dict sent to the API.
 * @param warn - Sink for the unrecognized-format warning.
 * @returns The typed result with step data and metadata.
 * @throws {@link QueryError} - Error-as-200 or a missing `series` key.
 * @throws {@link AttributeError} - When `date_range` or a metric member
 *   is not a dict.
 * @example
 * ```typescript
 * const result = transformFunnelResult(
 *   {
 *     computed_at: "2026-05-02T00:00:00",
 *     date_range: { from_date: "2026-05-01", to_date: "2026-05-01" },
 *     series: { Funnel: { count: { "1. Signup": { all: 100 } } } },
 *   },
 *   { steps: [{ event: "Signup" }] },
 *   (message) => console.warn(message),
 * );
 * // result.steps_data[0].event === "Signup"
 * ```
 * @see mixpanel_headless._internal.services.live_query._transform_funnel_result
 */
export function transformFunnelResult(
  raw: Readonly<Record<string, unknown>>,
  bookmarkParams: Readonly<Record<string, unknown>>,
  warn: WarningSink,
): FunnelQueryResult {
  // Check for error responses that leaked through as HTTP 200
  if (Object.hasOwn(raw, "error")) {
    throw new QueryError(
      `Funnel query failed: ${pythonStr(passthrough(raw["error"]))}`,
      { statusCode: 200, responseBody: raw, requestBody: bookmarkParams },
    );
  }

  if (!Object.hasOwn(raw, "series")) {
    throw new QueryError(
      "Funnel query returned unexpected response shape " +
        `(missing 'series' key). Keys present: ${pythonRepr(
          sortedByCodepoint(Object.keys(raw)),
        )}`,
      { statusCode: 200, responseBody: raw, requestBody: bookmarkParams },
    );
  }

  const dateRange = dictGetRecord(raw, "date_range");
  const series = raw["series"];
  const stepsData = extractFunnelStepsFromSeries(series, warn);

  return new FunnelQueryResult({
    computed_at: passthrough(dictGet(raw, "computed_at", "")),
    from_date: passthrough(dictGet(dateRange, "from_date", "")),
    to_date: passthrough(dictGet(dateRange, "to_date", "")),
    steps_data: passthrough(stepsData),
    series: passthrough(series),
    params: passthrough(bookmarkParams),
    meta: passthrough(dictGet(raw, "meta", {})),
  });
}

// ---------------------------------------------------------------------------
// `_normalize_cohort_date` / `_extract_cohorts_and_average`
// ---------------------------------------------------------------------------

/**
 * Normalize an ISO-timestamp cohort key to `YYYY-MM-DD`. The slice is
 * code-point based — Python's `key[:10]` counts code points, not UTF-16
 * units.
 *
 * @param key - Cohort date key from the API response.
 * @returns The normalized date string.
 * @see mixpanel_headless._internal.services.live_query._normalize_cohort_date
 */
function normalizeCohortDate(key: string): string {
  return key.includes("T") ? cpSlice(key, 0, 10) : key;
}

/**
 * Split a cohort data dict into date-keyed cohorts and `$average`.
 *
 * @param data - Cohort data dict (date keys + optional `$average`).
 * @returns The `[cohorts, average]` pair.
 * @see mixpanel_headless._internal.services.live_query._extract_cohorts_and_average
 */
function extractCohortsAndAverage(
  data: Readonly<Record<string, unknown>>,
): [Record<string, Record<string, unknown>>, Record<string, unknown>] {
  let average: Record<string, unknown> = {};
  const cohorts: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "$average") {
      average = isPythonDict(value) ? asRecord(value) : {};
    } else if (isPythonDict(value)) {
      cohorts[normalizeCohortDate(key)] = asRecord(value);
    }
  }
  return [cohorts, average];
}

// ---------------------------------------------------------------------------
// `_transform_retention_result`
// ---------------------------------------------------------------------------

/**
 * Transform a raw insights retention response into a
 * {@link RetentionQueryResult}, unwrapping the single metric-name key
 * and splitting `$overall` from the named segments when the query was
 * segmented.
 *
 * @param raw - Raw API response from the insights query.
 * @param bookmarkParams - The bookmark params dict sent to the API.
 * @returns The typed result with cohort data and metadata.
 * @throws {@link QueryError} - Error-as-200, a missing/non-dict
 *   `series`, more than one top-level series key, or a non-dict metric
 *   value.
 * @throws {@link AttributeError} - When `date_range` is not a dict.
 * @example
 * ```typescript
 * const result = transformRetentionResult(
 *   {
 *     computed_at: "2026-05-08T00:00:00",
 *     date_range: { from_date: "2026-05-01", to_date: "2026-05-07" },
 *     series: {
 *       "A. Retention": { "2026-05-01T00:00:00": { "0": 1, "1": 0.5 } },
 *     },
 *   },
 *   { retention_type: "birth" },
 * );
 * // result.cohorts["2026-05-01"] → { "0": 1, "1": 0.5 }
 * ```
 * @see mixpanel_headless._internal.services.live_query._transform_retention_result
 */
export function transformRetentionResult(
  raw: Readonly<Record<string, unknown>>,
  bookmarkParams: Readonly<Record<string, unknown>>,
): RetentionQueryResult {
  // Check for error responses that leaked through as HTTP 200
  if (Object.hasOwn(raw, "error")) {
    throw new QueryError(
      `Retention query failed: ${pythonStr(passthrough(raw["error"]))}`,
      { statusCode: 200, responseBody: raw, requestBody: bookmarkParams },
    );
  }

  if (!Object.hasOwn(raw, "series")) {
    throw new QueryError(
      "Retention query returned unexpected response shape " +
        `(missing 'series' key). Keys present: ${pythonRepr(
          sortedByCodepoint(Object.keys(raw)),
        )}`,
      { statusCode: 200, responseBody: raw, requestBody: bookmarkParams },
    );
  }

  const dateRange = dictGetRecord(raw, "date_range");
  const series = dictGet(raw, "series", {});

  if (!isPythonDict(series)) {
    throw new QueryError(
      `Retention query 'series' field is ${pythonTypeNameOf(series)}, ` +
        "expected dict.",
      { statusCode: 200, responseBody: raw, requestBody: bookmarkParams },
    );
  }

  const seriesDict = asRecord(series);

  // Unwrap the metric name key: series = {"metric_name": {date_cohorts}}
  let cohortData: Readonly<Record<string, unknown>> = {};
  if (pyTruthy(seriesDict)) {
    const seriesKeys = Object.keys(seriesDict);
    if (seriesKeys.length > 1) {
      throw new QueryError(
        "Retention query returned segmented series with " +
          `${seriesKeys.length} keys that cannot be represented as a ` +
          "single RetentionQueryResult without losing data. " +
          `Keys: ${pythonRepr(sortedByCodepoint(seriesKeys))}`,
        { statusCode: 200, responseBody: raw, requestBody: bookmarkParams },
      );
    }
    let found = false;
    for (const value of Object.values(seriesDict)) {
      if (isPythonDict(value)) {
        cohortData = asRecord(value);
        found = true;
        break;
      }
    }
    if (!found) {
      // No dict value found — the metric key maps to a non-dict
      const metricKey = defined(seriesKeys[0], "retention series key");
      throw new QueryError(
        `Retention series value for key ${pythonRepr(metricKey)} is not a ` +
          `dict (got ${pythonTypeNameOf(seriesDict[metricKey])}). ` +
          "Expected cohort data dictionary.",
        { statusCode: 200, responseBody: raw, requestBody: bookmarkParams },
      );
    }
  }

  // Handle segmented responses: $overall + named segments
  const segments: Record<string, Record<string, Record<string, unknown>>> = {};
  const segmentAverages: Record<string, Record<string, unknown>> = {};

  let cohorts: Record<string, Record<string, unknown>>;
  let average: Record<string, unknown>;

  if (
    Object.hasOwn(cohortData, "$overall") &&
    isPythonDict(cohortData["$overall"])
  ) {
    // Extract aggregate from $overall
    const overallData = asRecord(cohortData["$overall"]);
    [cohorts, average] = extractCohortsAndAverage(overallData);

    // Extract named segments (everything except $overall)
    for (const [segKey, segValue] of Object.entries(cohortData)) {
      if (segKey === "$overall" || !isPythonDict(segValue)) {
        continue;
      }
      const [segCohorts, segAvg] = extractCohortsAndAverage(asRecord(segValue));
      setOwn(segments, segKey, segCohorts);
      if (pyTruthy(segAvg)) {
        setOwn(segmentAverages, segKey, segAvg);
      }
    }
  } else {
    // Unsegmented: extract $average and date-keyed cohorts directly
    [cohorts, average] = extractCohortsAndAverage(cohortData);
  }

  return new RetentionQueryResult({
    computed_at: passthrough(dictGet(raw, "computed_at", "")),
    from_date: passthrough(dictGet(dateRange, "from_date", "")),
    to_date: passthrough(dictGet(dateRange, "to_date", "")),
    cohorts: passthrough(cohorts),
    average: passthrough(average),
    params: passthrough(bookmarkParams),
    meta: passthrough(dictGet(raw, "meta", {})),
    segments: passthrough(segments),
    segment_averages: passthrough(segmentAverages),
  });
}

// ---------------------------------------------------------------------------
// Activity feed, saved reports, flows, frequency and numeric transforms
// ---------------------------------------------------------------------------

/**
 * Transform a raw activity-feed response into an
 * {@link ActivityFeedResult}.
 *
 * @param raw - Raw API response.
 * @param distinctIds - Queried user identifiers.
 * @param fromDate - Query start date.
 * @param toDate - Query end date.
 * @returns The typed result with chronological events and the
 *   stream/bookmark pagination cursor when present.
 * @throws {@link ValueError} - When an event has no `time` property
 *   (Python raises the builtin `ValueError`).
 * @throws {@link AttributeError} - When `results`, an event or its
 *   `properties` is not a dict.
 * @example
 * ```typescript
 * const result = transformActivityFeed(
 *   {
 *     results: {
 *       events: [{ event: "Signup", properties: { time: 1777600000 } }],
 *     },
 *   },
 *   ["user-42"],
 *   "2026-05-01",
 *   "2026-05-02",
 * );
 * // result.events[0].event === "Signup"
 * ```
 * @see mixpanel_headless._internal.services.live_query.LiveQueryService._transform_activity_feed
 */
export function transformActivityFeed(
  raw: Readonly<Record<string, unknown>>,
  distinctIds: readonly string[],
  fromDate: string | null,
  toDate: string | null,
): ActivityFeedResult {
  // `raw.get("results", {}).get(...)` — non-dict members raise
  // `AttributeError` in CPython; `for event_data in raw_events` is
  // Python iteration (a dict iterates keys).
  const results = dictGetRecord(raw, "results");
  const rawEvents = dictGet(results, "events", []);
  const sentinelEvent = dictGet(results, "sentinel_event", undefined);

  const events: UserEvent[] = [];
  for (const eventRaw of pyIter(rawEvents)) {
    const eventData = pyMapping(eventRaw, "get");
    const eventName = dictGet(eventData, "event", "");
    const props = dictGetRecord(eventData, "properties");

    // Convert Unix timestamp to datetime. Mixpanel events always carry
    // a `time` field; a missing one signals data corruption.
    const timestamp = dictGet(props, "time", null);
    if (timestamp === null) {
      throw new ValueError(
        `Event missing required 'time' field: ${String(
          dictGet(eventData, "event", "unknown"),
        )}`,
      );
    }
    const eventTime = fromTimestampUtcIso(timestampNumber(timestamp));

    events.push(
      new UserEvent({
        event: passthrough(eventName),
        time: eventTime,
        properties: props,
      }),
    );
  }

  return new ActivityFeedResult({
    distinct_ids: [...distinctIds],
    from_date: fromDate,
    to_date: toDate,
    events,
    sentinel_event: passthrough(
      sentinelEvent === undefined ? null : sentinelEvent,
    ),
  });
}

/**
 * Transform a raw saved-report response into a
 * {@link SavedReportResult}, normalizing the four endpoint shapes
 * (insights / funnels / retention / flows) into the one result type.
 *
 * @remarks
 * The synthetic `$funnel` / `$retention` / `$flows` headers Python
 * invents for report-type detection are reproduced.
 * @param raw - Raw API response.
 * @param bookmarkId - Saved report identifier.
 * @param bookmarkType - Type of bookmark that was queried; defaults to
 *   `"insights"`.
 * @returns The typed result.
 * @throws {@link AttributeError} - When `date_range` is not a dict, or
 *   a truthy funnel `data` is not a dict.
 * @example
 * ```typescript
 * const result = transformSavedReport(
 *   {
 *     computed_at: "2026-05-02T00:00:00",
 *     date_range: { from_date: "2026-05-01", to_date: "2026-05-01" },
 *     headers: ["$event"],
 *     series: { Signup: { all: 7 } },
 *   },
 *   123,
 * );
 * // result.bookmark_id === 123; result.headers → ["$event"]
 * ```
 * @see mixpanel_headless._internal.services.live_query.LiveQueryService._transform_saved_report
 */
export function transformSavedReport(
  raw: Readonly<Record<string, unknown>>,
  bookmarkId: number,
  bookmarkType: SavedReportBookmarkType = "insights",
): SavedReportResult {
  let computedAt: unknown;
  let fromDate: unknown;
  let toDate: unknown;
  let headers: unknown;
  let series: unknown;

  switch (bookmarkType) {
    case "insights": {
      // {computed_at, date_range: {from_date, to_date}, headers, series}
      computedAt = dictGet(raw, "computed_at", "");
      const dateRange = dictGetRecord(raw, "date_range");
      fromDate = dictGet(dateRange, "from_date", "");
      toDate = dictGet(dateRange, "to_date", "");
      headers = dictGet(raw, "headers", []);
      series = dictGet(raw, "series", {});

      break;
    }
    case "funnels": {
      // {computed_at, data: {date: {steps}}, meta}. Python tests
      // truthiness first (`sorted(data.keys()) if data else []`), so a
      // falsy non-dict `data` short-circuits while a truthy one raises
      // `AttributeError` at `.keys()`.
      computedAt = dictGet(raw, "computed_at", "");
      const data = dictGet(raw, "data", {});
      const dateKeys = pyTruthy(data)
        ? sortedByCodepoint(Object.keys(pyMapping(data, "keys")))
        : [];
      fromDate = dateKeys.length > 0 ? dateKeys[0] : "";
      toDate = dateKeys.length > 0 ? dateKeys.at(-1) : "";
      headers = ["$funnel"]; // Synthetic header for type detection
      series = data;

      break;
    }
    case "retention": {
      // {date: {first, counts, rates}} — the whole response is the data
      computedAt = ""; // Not provided by retention API
      const dateKeys = pyTruthy(raw) ? sortedByCodepoint(Object.keys(raw)) : [];
      fromDate = dateKeys.length > 0 ? dateKeys[0] : "";
      toDate = dateKeys.length > 0 ? dateKeys.at(-1) : "";
      headers = ["$retention"]; // Synthetic header for type detection
      series = raw; // Entire response is the data

      break;
    }
    case "flows": {
      // {computed_at, steps, breakdowns, overallConversionRate, metadata}
      computedAt = dictGet(raw, "computed_at", "");
      fromDate = ""; // Not provided by flows API
      toDate = "";
      headers = ["$flows"]; // Synthetic header for type detection
      series = {
        steps: dictGet(raw, "steps", []),
        breakdowns: dictGet(raw, "breakdowns", []),
        overallConversionRate: dictGet(raw, "overallConversionRate", 0.0),
      };

      break;
    }
    default: {
      // Fallback to insights behavior
      computedAt = dictGet(raw, "computed_at", "");
      const dateRange = dictGetRecord(raw, "date_range");
      fromDate = dictGet(dateRange, "from_date", "");
      toDate = dictGet(dateRange, "to_date", "");
      headers = dictGet(raw, "headers", []);
      series = dictGet(raw, "series", {});
    }
  }

  return new SavedReportResult({
    bookmark_id: bookmarkId,
    computed_at: passthrough(computedAt),
    from_date: passthrough(fromDate),
    to_date: passthrough(toDate),
    headers: passthrough(headers),
    series: passthrough(series),
  });
}

/**
 * Transform a raw `arb_funnels` flow response into a
 * {@link FlowQueryResult}.
 *
 * @param raw - Raw API response from the arb_funnels query.
 * @param bookmarkParams - The bookmark params dict sent to the API.
 * @param mode - Flow visualization mode (`"sankey"`, `"paths"` or
 *   `"tree"`; anything else reads as sankey).
 * @returns The typed result with steps, flows, breakdowns, conversion
 *   rate and metadata.
 * @throws {@link QueryError} - Error-as-200, or (outside tree mode) a
 *   body with no recognizable flow key.
 * @throws {@link AttributeError} - In tree mode, when a tree or its root
 *   is not a dict.
 * @example
 * ```typescript
 * const result = transformFlowResult(
 *   {
 *     computed_at: "2026-05-02T00:00:00",
 *     steps: [{ event: "Signup" }],
 *     flows: [],
 *   },
 *   { query_type: "flows_sankey" },
 *   "sankey",
 * );
 * // result.mode === "sankey"; result.trees → []
 * ```
 * @see mixpanel_headless._internal.services.live_query.LiveQueryService._transform_flow_result
 */
export function transformFlowResult(
  raw: Readonly<Record<string, unknown>>,
  bookmarkParams: Readonly<Record<string, unknown>>,
  mode: string,
): FlowQueryResult {
  // Check for error responses that leaked through as HTTP 200
  if (Object.hasOwn(raw, "error")) {
    throw new QueryError(
      `Flow query failed: ${pythonStr(passthrough(raw["error"]))}`,
      { statusCode: 200, responseBody: raw, requestBody: bookmarkParams },
    );
  }

  // Validate the expected response shape. Tree mode may legitimately
  // return only metadata with no `trees` key, so only sankey/paths
  // enforce structural presence.
  const expectedKeys = new Set([
    "steps",
    "flows",
    "trees",
    "computed_at",
    "metadata",
  ]);
  const rawKeys = Object.keys(raw);
  if (
    mode !== "tree" &&
    !Object.hasOwn(raw, "steps") &&
    !Object.hasOwn(raw, "flows") &&
    rawKeys.every((key) => !expectedKeys.has(key))
  ) {
    throw new QueryError(
      "Flow query returned unexpected response shape " +
        "(missing 'steps' and 'flows' keys). " +
        `Keys present: ${pythonRepr(sortedByCodepoint(rawKeys))}`,
      { statusCode: 200, responseBody: raw, requestBody: bookmarkParams },
    );
  }

  const computedAt = dictGet(raw, "computed_at", "");
  const steps = dictGet(raw, "steps", []);
  const flows = dictGet(raw, "flows", []);
  const breakdowns = dictGet(raw, "breakdowns", []);
  const overallConversionRate = dictGet(raw, "overallConversionRate", 0.0);
  const metadata = dictGet(raw, "metadata", {});

  // Parse tree data when in tree mode
  const trees: FlowTreeNode[] = [];
  if (mode === "tree") {
    // Python: `for tree_dict in raw.get("trees", [])` then
    // `tree_dict.get("root", {})` — the root value is read raw; a
    // truthy non-dict raises inside `_parse_tree_node`.
    for (const treeRaw of pyIter(dictGet(raw, "trees", []))) {
      const rootDict = dictGet(pyMapping(treeRaw, "get"), "root", {});
      if (pyTruthy(rootDict)) {
        const parsedRoot = parseTreeNode(rootDict);
        // The API returns a virtual root with `step=null`; the real
        // anchors are its children. A root with an event (test
        // fixtures) is kept as-is.
        if (pyTruthy(parsedRoot.event)) {
          trees.push(parsedRoot);
        } else {
          trees.push(...parsedRoot.children);
        }
      }
    }
  }

  // Determine the result mode literal
  const resultMode: FlowMode =
    mode === "tree" || mode === "paths" ? mode : "sankey";

  return new FlowQueryResult({
    computed_at: passthrough(computedAt),
    steps: passthrough(steps),
    flows: passthrough(flows),
    breakdowns: passthrough(breakdowns),
    overall_conversion_rate: passthrough(overallConversionRate),
    params: passthrough(bookmarkParams),
    meta: passthrough(metadata),
    mode: resultMode,
    trees,
  });
}

/**
 * Parse a recursive raw dict into a {@link FlowTreeNode}, accepting both
 * the live API's camelCase field names and the test fixtures'
 * snake_case twins.
 *
 * @param raw - Raw node dict with `step`, `children` and count fields.
 * @returns The parsed node, children first.
 * @throws {@link AttributeError} - When the node or a truthy `step` is
 *   not a dict.
 * @throws {@link TypeError} - When `children` is not iterable.
 * @example
 * ```typescript
 * const node = parseTreeNode({
 *   step: { event: "Signup", stepNumber: 1 },
 *   totalCount: 100,
 *   children: [],
 * });
 * // node.event === "Signup"; node.step_number === 1
 * ```
 * @see mixpanel_headless._internal.services.live_query.LiveQueryService._parse_tree_node
 */
export function parseTreeNode(raw: unknown): FlowTreeNode {
  // `raw.get("step") or {}` — a non-dict node raises at the `.get`.
  // The `step` value itself stays raw here: Python parses `children`
  // first and only then reads `step.get(...)`, so a bad child raises
  // before a bad step does.
  const rawMap = pyMapping(raw, "get");
  const stepRaw = dictGet(rawMap, "step", null);
  const stepVal: unknown = pyTruthy(stepRaw) ? stepRaw : {};
  const children = pyIter(dictGet(rawMap, "children", [])).map((c) =>
    parseTreeNode(c),
  );
  const step = pyMapping(stepVal, "get");

  // Support both camelCase (live API) and snake_case (test fixtures)
  const stepNumberRaw = dictGet(
    step,
    "stepNumber",
    dictGet(step, "step_number", 0),
  );
  const totalCount = dictGet(
    rawMap,
    "totalCount",
    dictGet(rawMap, "total_count", 0),
  );
  const dropOffCount = dictGet(
    rawMap,
    "dropOffTotalCount",
    dictGet(rawMap, "drop_off_total_count", 0),
  );
  const convertedCount = dictGet(
    rawMap,
    "convertedTotalCount",
    dictGet(rawMap, "converted_total_count", 0),
  );
  const anchorType = dictGet(
    step,
    "anchorType",
    dictGet(step, "anchor_type", "NORMAL"),
  );
  const isComputed = dictGet(
    step,
    "isComputed",
    dictGet(step, "is_computed", false),
  );

  // Time percentiles: camelCase or snake_case, may be null
  const tpStartRaw = dictGet(rawMap, "timePercentilesFromStart", null);
  const tpPrevRaw = dictGet(rawMap, "timePercentilesFromPrev", null);
  const tpStart = firstPyTruthy(
    [tpStartRaw, dictGet(rawMap, "time_percentiles_from_start", null)],
    {},
  );
  const tpPrev = firstPyTruthy(
    [tpPrevRaw, dictGet(rawMap, "time_percentiles_from_prev", null)],
    {},
  );

  return new FlowTreeNode({
    event: passthrough(dictGet(step, "event", "")),
    type: passthrough(dictGet(step, "type", "")),
    step_number: safeInt(stepNumberRaw),
    total_count: safeInt(totalCount),
    drop_off_count: safeInt(dropOffCount),
    converted_count: safeInt(convertedCount),
    anchor_type: passthrough(anchorType),
    is_computed: passthrough(isComputed),
    children,
    time_percentiles_from_start: passthrough(
      isPythonDict(tpStart) ? tpStart : {},
    ),
    time_percentiles_from_prev: passthrough(isPythonDict(tpPrev) ? tpPrev : {}),
  });
}

/**
 * Transform a raw saved-flows response into a {@link FlowsResult}.
 *
 * @param raw - Raw API response.
 * @param bookmarkId - Saved flows report identifier.
 * @returns The typed result.
 * @example
 * ```typescript
 * const result = transformFlows(
 *   { computed_at: "2026-05-02T00:00:00", steps: [], breakdowns: [] },
 *   77,
 * );
 * // result.bookmark_id === 77
 * ```
 * @see mixpanel_headless._internal.services.live_query.LiveQueryService._transform_flows
 */
export function transformFlows(
  raw: Readonly<Record<string, unknown>>,
  bookmarkId: number,
): FlowsResult {
  return new FlowsResult({
    bookmark_id: bookmarkId,
    computed_at: passthrough(dictGet(raw, "computed_at", "")),
    steps: passthrough(dictGet(raw, "steps", [])),
    breakdowns: passthrough(dictGet(raw, "breakdowns", [])),
    overall_conversion_rate: passthrough(
      dictGet(raw, "overallConversionRate", 0.0),
    ),
    metadata: passthrough(dictGet(raw, "metadata", {})),
  });
}

/**
 * Transform a raw frequency response into a {@link FrequencyResult}.
 *
 * @param raw - Raw API response.
 * @param event - Filtered event name (or `null`).
 * @param fromDate - Query start date.
 * @param toDate - Query end date.
 * @param unit - Overall time period.
 * @param addictionUnit - Measurement granularity.
 * @returns The typed result.
 * @example
 * ```typescript
 * const result = transformFrequency(
 *   { data: { "2026-05-01": { "1": 10, "2": 4 } } },
 *   null,
 *   "2026-05-01",
 *   "2026-05-07",
 *   "week",
 *   "day",
 * );
 * // result.data → { "2026-05-01": { "1": 10, "2": 4 } }
 * ```
 * @see mixpanel_headless._internal.services.live_query.LiveQueryService._transform_frequency
 */
// eslint-disable-next-line max-params -- positional parameters mirror the Python signature 1:1
export function transformFrequency(
  raw: Readonly<Record<string, unknown>>,
  event: string | null,
  fromDate: string,
  toDate: string,
  unit: TimeUnit,
  addictionUnit: HourDayUnit,
): FrequencyResult {
  return new FrequencyResult({
    event,
    from_date: fromDate,
    to_date: toDate,
    unit,
    addiction_unit: addictionUnit,
    data: passthrough(dictGet(raw, "data", {})),
  });
}

/**
 * Transform a raw numeric-bucket response into a
 * {@link NumericBucketResult}.
 *
 * @param raw - Raw API response.
 * @param event - Event name queried.
 * @param fromDate - Query start date.
 * @param toDate - Query end date.
 * @param on - Property expression used for bucketing.
 * @param unit - Time aggregation unit.
 * @returns The typed result.
 * @throws {@link AttributeError} - When `data` is not a dict.
 * @example
 * ```typescript
 * const result = transformNumericBucket(
 *   { data: { values: { "0 - 10": { "2026-05-01": 3 } } } },
 *   "Purchase",
 *   "2026-05-01",
 *   "2026-05-01",
 *   'properties["amount"]',
 *   "day",
 * );
 * // result.series → { "0 - 10": { "2026-05-01": 3 } }
 * ```
 * @see mixpanel_headless._internal.services.live_query.LiveQueryService._transform_numeric_bucket
 */
// eslint-disable-next-line max-params -- positional parameters mirror the Python signature 1:1
export function transformNumericBucket(
  raw: Readonly<Record<string, unknown>>,
  event: string,
  fromDate: string,
  toDate: string,
  on: string,
  unit: HourDayUnit,
): NumericBucketResult {
  const data = dictGetRecord(raw, "data");
  const values = dictGet(data, "values", {});

  return new NumericBucketResult({
    event,
    from_date: fromDate,
    to_date: toDate,
    property_expr: on,
    unit,
    series: passthrough(values),
  });
}

/**
 * Transform a raw sum response into a {@link NumericSumResult}.
 *
 * @param raw - Raw API response.
 * @param event - Event name queried.
 * @param fromDate - Query start date.
 * @param toDate - Query end date.
 * @param on - Property expression summed.
 * @param unit - Time aggregation unit.
 * @returns The typed result.
 * @example
 * ```typescript
 * const result = transformNumericSum(
 *   { results: { "2026-05-01": 1250.5 }, computed_at: "2026-05-02" },
 *   "Purchase",
 *   "2026-05-01",
 *   "2026-05-01",
 *   'properties["amount"]',
 *   "day",
 * );
 * // result.results → { "2026-05-01": 1250.5 }
 * ```
 * @see mixpanel_headless._internal.services.live_query.LiveQueryService._transform_numeric_sum
 */
// eslint-disable-next-line max-params -- positional parameters mirror the Python signature 1:1
export function transformNumericSum(
  raw: Readonly<Record<string, unknown>>,
  event: string,
  fromDate: string,
  toDate: string,
  on: string,
  unit: HourDayUnit,
): NumericSumResult {
  const results = dictGet(raw, "results", {});
  const computedAt = dictGet(raw, "computed_at", null);

  return new NumericSumResult({
    event,
    from_date: fromDate,
    to_date: toDate,
    property_expr: on,
    unit,
    results: passthrough(results),
    computed_at: passthrough(computedAt),
  });
}

/**
 * Transform a raw average response into a
 * {@link NumericAverageResult}.
 *
 * @param raw - Raw API response.
 * @param event - Event name queried.
 * @param fromDate - Query start date.
 * @param toDate - Query end date.
 * @param on - Property expression averaged.
 * @param unit - Time aggregation unit.
 * @returns The typed result.
 * @example
 * ```typescript
 * const result = transformNumericAverage(
 *   { results: { "2026-05-01": 41.7 } },
 *   "Purchase",
 *   "2026-05-01",
 *   "2026-05-01",
 *   'properties["amount"]',
 *   "day",
 * );
 * // result.results → { "2026-05-01": 41.7 }
 * ```
 * @see mixpanel_headless._internal.services.live_query.LiveQueryService._transform_numeric_average
 */
// eslint-disable-next-line max-params -- positional parameters mirror the Python signature 1:1
export function transformNumericAverage(
  raw: Readonly<Record<string, unknown>>,
  event: string,
  fromDate: string,
  toDate: string,
  on: string,
  unit: HourDayUnit,
): NumericAverageResult {
  const results = dictGet(raw, "results", {});

  return new NumericAverageResult({
    event,
    from_date: fromDate,
    to_date: toDate,
    property_expr: on,
    unit,
    results: passthrough(results),
  });
}
