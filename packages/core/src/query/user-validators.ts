/**
 * Validation rules for `query_user()` arguments and parameters.
 *
 * Source: `src/mixpanel_headless/_internal/query/user_validators.py`
 * (Python revision: `ts-port/phase2-contract-support` HEAD, 580 LOC —
 * whole file).
 *
 * Two validation functions following the two-layer pattern:
 *
 * - {@link validateUserArgs}: validates Python-level arguments before
 *   engage param construction (Layer 1, rules U0-U30). There is
 *   deliberately **no U9** — the Python docstring records it as
 *   "enforced at call site" and no `U9` literal exists in source.
 * - {@link validateUserParams}: validates the engage params dict after
 *   construction (Layer 2, rules UP1-UP4).
 *
 * Both return `ValidationError[]`; callers decide whether to raise
 * `BookmarkValidationError`. Emission order is contract
 * (b2-packets.md Cautions §11): every `errors.push` sits at its Python
 * source position, including the interleaving of U29 between U25 and
 * U11 and of U26-U28 between U17 and U18.
 *
 * R11.7: `pythonStrip` (never `String.trim()`) at the three Python
 * `.strip()` sites (`user_validators.py:186, :237, :273`); JSON parsing
 * goes through the core `parseLossless` with `pythonConstants`
 * (`json.loads` accepts `NaN`/`Infinity`/`-Infinity` — B0 arbiter F1),
 * never bare `JSON.parse`.
 *
 * @module user-validators
 * @internal
 */

import { LosslessJsonError, parseLossless } from "../client/lossless-json.js";
import { DECIMAL_DIGIT_RUNS } from "../compat/decimal-digits.gen.js";
import {
  isPythonDict,
  pythonNumberStr,
  pythonRepr,
  pythonStrip,
  pythonTypeName,
  zfill,
} from "../compat/index.js";
import {
  RuntimeError as PyRuntimeError,
  ValueError as PyValueError,
} from "../compat/python-builtins.js";
import { dateTodayIso } from "../compat/python-dates.js";
import { PYTHON_STR_WHITESPACE } from "../compat/whitespace.gen.js";
import { ParamValidationError, ValidationError } from "../errors.js";
import { CohortDefinition } from "../types/query-params/cohort.js";
import { Filter } from "../types/query-params/filter.js";
import { isCohortFilter } from "./user-builders.js";
import {
  asciiDigitsToInt,
  errorCollector,
  isValidDate,
  matchesDateRe,
  type PushError,
} from "./validation-shared.js";

// =============================================================================
// Module tables (user_validators.py:26-34)
// =============================================================================

/**
 * Escape a codepoint for inclusion in a RegExp character class.
 *
 * @param cp - The codepoint.
 * @returns A `\uXXXX` / `\u{XXXXX}` escape (always safe inside `[...]`).
 */
function classEscape(cp: number): string {
  return cp <= 0xffff
    ? String.raw`\u${zfill(cp.toString(16), 4)}`
    : String.raw`\u{${cp.toString(16)}}`;
}

/**
 * RegExp character-class body for Python's `\s` in a **str** pattern.
 *
 * R11.7 / Caution §4: JS `\s` is NOT Python `\s` (JS has U+FEFF and
 * lacks U+001C-U+001F). Python's str-pattern `\s` is exactly the
 * `str.isspace()` set — verified empirically over the full codepoint
 * range against CPython 3.14.6 (B2-M3 probe, notes file) — which is
 * the pinned {@link PYTHON_STR_WHITESPACE} table.
 */
const PY_SPACE_CLASS = [...PYTHON_STR_WHITESPACE]
  .map((cp) => classEscape(cp))
  .join("");

/**
 * RegExp character-class body for Python's `\d` in a **str** pattern:
 * the Unicode decimal-digit (category Nd) set from the pinned CPython
 * table, NOT the ASCII-only JS `\d`.
 */
const PY_DIGIT_CLASS = DECIMAL_DIGIT_RUNS.map(([start, , length]) =>
  length === 1
    ? classEscape(start)
    : `${classEscape(start)}-${classEscape(start + length - 1)}`,
).join("");

/**
 * Port of `_ACTION_RE` (`user_validators.py:27-34`).
 *
 * The Python pattern is
 * `^(count\(\)|extremes\(properties\[".+"\]\)|percentile\(properties\[".+"\],\s*[\d.]+\)|numeric_summary\(properties\[".+"\]\))$`
 * compiled with **str** semantics. Three spellings must be translated
 * rather than copied:
 *
 * - `.` matches any codepoint except `\n`. JS `.` additionally excludes
 *   `\r`, U+2028 and U+2029, so it is spelled `[^\n]` here.
 * - `\s` → {@link PY_SPACE_CLASS} (pinned CPython table).
 * - `\d` → {@link PY_DIGIT_CLASS} (pinned CPython Nd table).
 *
 * Python's `$` also matches immediately before ONE trailing `\n`;
 * that half is handled by {@link matchesActionRe}, not by the pattern
 * (JS `$` without `m` is strict end-of-input).
 *
 * The `u` flag makes the classes and `[^\n]` operate on codepoints,
 * matching Python's per-codepoint `str` semantics (R11.6).
 */
const ACTION_RE = new RegExp(
  `^(${String.raw`count\(\)`}${String.raw`|extremes\(properties\["[^\n]+"\]\)`}${String.raw`|percentile\(properties\["[^\n]+"\],[${PY_SPACE_CLASS}]*[${PY_DIGIT_CLASS}.]+\)`}${String.raw`|numeric_summary\(properties\["[^\n]+"\]\)`})$`,
  "u",
);

/**
 * `_ACTION_RE.match(action)` truthiness with Python `re` `$` semantics.
 *
 * @param action - Candidate action expression.
 * @returns True when the Python regex would match.
 */
function matchesActionRe(action: string): boolean {
  // Python `$` matches at the end OR just before a single trailing
  // newline; `count()\n` matches, `count()\n\n` does not (probed).
  const core = action.endsWith("\n") ? action.slice(0, -1) : action;
  return ACTION_RE.test(core);
}

// =============================================================================
// Calendar comparison for rule U8 (the `date.today()` seam is `dateTodayIso`)
// =============================================================================

/**
 * Compare two canonical `YYYY-MM-DD` strings as calendar dates
 * (Python `date > date`).
 *
 * Both operands are ASCII-canonical by construction: `left` passed
 * {@link isValidDate} and `right` comes from the `today` seam.
 *
 * @param left - Left operand.
 * @param right - Right operand.
 * @returns True when `left` is strictly later than `right`.
 */
function isoDateGreater(left: string, right: string): boolean {
  const a = isoParts(left);
  const b = isoParts(right);
  for (let i = 0; i < 3; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (x !== y) {
      return x > y;
    }
  }
  return false;
}

/**
 * Split a canonical `YYYY-MM-DD` string into `[year, month, day]`.
 *
 * @param iso - The date string.
 * @returns The three numeric components.
 */
function isoParts(iso: string): [number, number, number] {
  return [
    asciiDigitsToInt(iso.slice(0, 4)),
    asciiDigitsToInt(iso.slice(5, 7)),
    asciiDigitsToInt(iso.slice(8, 10)),
  ];
}

// =============================================================================
// _normalize_filters (user_validators.py:37-55)
// =============================================================================

/**
 * Normalize the `where` argument into a flat list of Filter objects.
 *
 * Port of `_normalize_filters` (`user_validators.py:37-55`). String
 * expressions and `None` return an empty list since they contain no
 * Filter objects to inspect. Anything else is spread — Python's
 * `list(where)`, which raises `TypeError` for a non-iterable exactly
 * as the JS spread does.
 *
 * The return type is `unknown[]`, not `Filter[]`: Python's `list(where)`
 * performs no element type-check, and rule U0 exists precisely to
 * report the non-Filter members (R4.9 — the validator IS the type
 * police).
 *
 * @param where - Raw where argument from the caller.
 * @returns List of candidate filter items (possibly empty).
 */
function normalizeFilters(
  where: Filter | readonly unknown[] | string | null,
): unknown[] {
  if (where === null || typeof where === "string") {
    return [];
  }
  if (where instanceof Filter) {
    return [where];
  }
  return [...where];
}

// =============================================================================
// validate_user_args (user_validators.py:58-476)
// =============================================================================

/** Options bag for {@link validateUserArgs} (Python is all-kwonly). */
export interface ValidateUserArgsOptions {
  /** Filter profiles by property values. */
  readonly where?: Filter | readonly unknown[] | string | null;
  /** Filter by cohort membership (saved id or inline definition). */
  readonly cohort?: number | CohortDefinition | null;
  /** Output properties to include. */
  readonly properties?: readonly string[] | null;
  /** Property to sort by. */
  readonly sort_by?: string | null;
  /**
   * Sort direction. Accepted and ignored — Python marks the parameter
   * `# noqa: ARG001` (`user_validators.py:64`); rule UP1 checks the
   * built params dict instead.
   */
  readonly sort_order?: "ascending" | "descending";
  /** Maximum profiles to return; `null` means fetch all (Python default `1`). */
  readonly limit?: number | null;
  /** Full-text search term. */
  readonly search?: string | null;
  /** Single user lookup. */
  readonly distinct_id?: string | null;
  /** Batch user lookup. */
  readonly distinct_ids?: readonly string[] | null;
  /**
   * Group profile query. Accepted and ignored — Python marks the
   * parameter `# noqa: ARG001` (`user_validators.py:69`).
   */
  readonly group_id?: string | null;
  /** Point-in-time query date (`YYYY-MM-DD`) or timestamp. */
  readonly as_of?: string | number | null;
  /** Output mode (Python default `"aggregate"`). */
  readonly mode?: "profiles" | "aggregate";
  /** Aggregation function (Python default `"count"`). */
  readonly aggregate?: "count" | "extremes" | "percentile" | "numeric_summary";
  /** Property to aggregate on. */
  readonly aggregate_property?: string | null;
  /** Percentile value (0-100, exclusive). */
  readonly percentile?: number | null;
  /** Cohort IDs for segmented aggregation. */
  readonly segment_by?: readonly number[] | null;
  /** Enable concurrent fetching (Python default `false`). */
  readonly parallel?: boolean;
  /** Max concurrent workers (Python default `5`). */
  readonly workers?: number;
  /** Include non-members in cohort queries (Python default `false`). */
  readonly include_all_users?: boolean;
  /**
   * Clock seam for rule U8 — returns today's date as `YYYY-MM-DD`.
   *
   * Python reads `date.today()` inline; the library defaults to the
   * real local clock. The conformance binding injects the frozen
   * record-epoch date through `context.shims` so vector replay and
   * differential fuzz see the clock the recorder saw
   * (b2-packets.md §V2 trap 2b).
   */
  readonly today?: () => string;
}

/**
 * U0: every `where` item must be a `Filter`; returns the survivors —
 * every later `where[i]` path indexes THIS list, exactly as Python's
 * re-enumeration of the rebound `filters` does.
 *
 * @param push - The validator's error sink.
 * @param rawFilters - Normalized `where` items (loose elements).
 * @returns The `Filter` instances, in order.
 */
function checkWhereFilters(
  push: PushError,
  rawFilters: readonly unknown[],
): Filter[] {
  for (const [i, item] of rawFilters.entries()) {
    if (!(item instanceof Filter)) {
      push(
        `where[${i}]`,
        `expected Filter instance, got ${pythonTypeName(item)}`,
        "U0",
      );
    }
  }
  return rawFilters.filter((f): f is Filter => f instanceof Filter);
}

/**
 * U3, U4, U5: limit, distinct_ids and sort_by shapes.
 *
 * @param push - The validator's error sink.
 * @param limit - Maximum profiles (`null` = fetch all).
 * @param distinctIds - Batch lookup ids, or `null`.
 * @param sortBy - Sort property, or `null`.
 */
function checkProfileSelectors(
  push: PushError,
  limit: number | null,
  distinctIds: readonly string[] | null,
  sortBy: string | null,
): void {
  // U3: limit must be positive (None means fetch all)
  if (limit !== null && limit <= 0) {
    push(
      "limit",
      `limit must be a positive integer (got ${pythonNumberStr(limit)})`,
      "U3",
    );
  }

  // U4: distinct_ids must be non-empty list
  if (distinctIds !== null && distinctIds.length === 0) {
    push("distinct_ids", "distinct_ids must be a non-empty list", "U4");
  }

  // U5: sort_by must be non-empty string
  if (sortBy !== null && pythonStrip(sortBy) === "") {
    push("sort_by", "sort_by must be a non-empty string", "U5");
  }
}

/**
 * U6 / U8: a string `as_of` is a valid calendar date that is not in
 * the future (single parse).
 *
 * Python: `_DATE_RE.match(as_of)` then
 * `contextlib.suppress(ValueError): date.fromisoformat(as_of)`. The
 * gate keeps `fromisoformat`'s wider CPython 3.11+ grammar unreachable
 * (probed: Unicode-Nd spellings and a trailing newline pass `_DATE_RE`
 * but raise ValueError), so the ported pair `matchesDateRe` +
 * `isValidDate` is exact.
 *
 * @param push - The validator's error sink.
 * @param asOf - The `as_of` string.
 * @param today - Clock seam returning today's `YYYY-MM-DD`.
 */
function checkAsOf(push: PushError, asOf: string, today: () => string): void {
  const parsedDate = matchesDateRe(asOf) && isValidDate(asOf) ? asOf : null;
  if (parsedDate === null) {
    push(
      "as_of",
      `as_of must be a valid YYYY-MM-DD date string (got ${pythonRepr(asOf)})`,
      "U6",
    );
  } else if (isoDateGreater(parsedDate, today())) {
    push(
      "as_of",
      `as_of must not be in the future (got ${asOf}, today is ${today()})`,
      "U8",
    );
  }
}

/**
 * U10 / U25: filter property names are non-empty strings — two passes,
 * because Python emits every U10 before any U25.
 *
 * @param push - The validator's error sink.
 * @param filters - The `Filter` instances.
 */
function checkFilterProperties(
  push: PushError,
  filters: readonly Filter[],
): void {
  // U10: Filter property names must be non-empty
  for (const [i, f] of filters.entries()) {
    if (typeof f._property === "string" && pythonStrip(f._property) === "") {
      push(
        `where[${i}]._property`,
        "filter property name must be a non-empty string",
        "U10",
      );
    }
  }

  // U25: Filter property must be a string for engage queries
  for (const [i, f] of filters.entries()) {
    if (!isCohortFilter(f) && typeof f._property !== "string") {
      push(
        `where[${i}]._property`,
        "filter property must be a string for query_user() " +
          `(got ${pythonTypeName(f._property)})`,
        "U25",
      );
    }
  }
}

/**
 * U29 / U11: the output property list is non-empty and so is each name.
 *
 * @param push - The validator's error sink.
 * @param properties - Output properties (non-null).
 */
function checkOutputProperties(
  push: PushError,
  properties: readonly string[],
): void {
  // U29: properties must be non-empty list (if provided)
  if (properties.length === 0) {
    push("properties", "properties must be a non-empty list", "U29");
  }

  // U11: properties items must be non-empty strings
  for (const [i, prop] of properties.entries()) {
    if (pythonStrip(prop) === "") {
      push(
        `properties[${i}]`,
        "property name must be a non-empty string",
        "U11",
      );
    }
  }
}

/**
 * U12 / U13: cohort filters in `where` — no `not_in_cohort`, at most
 * one `in_cohort`.
 *
 * @param push - The validator's error sink.
 * @param filters - The `Filter` instances.
 * @param inCohortCount - Number of `Filter.in_cohort()` entries.
 */
function checkCohortFilters(
  push: PushError,
  filters: readonly Filter[],
  inCohortCount: number,
): void {
  // U12: Filter.not_in_cohort() not supported
  for (const [i, f] of filters.entries()) {
    if (isCohortFilter(f) && f._operator === "does not contain") {
      push(
        `where[${i}]`,
        "Filter.not_in_cohort() is not supported in " +
          "query_user() where clauses",
        "U12",
      );
    }
  }

  // U13: At most one Filter.in_cohort() in where list
  if (inCohortCount > 1) {
    push(
      "where",
      "at most one Filter.in_cohort() is allowed in where " +
        `(found ${pythonNumberStr(inCohortCount)})`,
      "U13",
    );
  }
}

/**
 * U14 / U15: `aggregate_property` is present exactly when the aggregate
 * needs one.
 *
 * @param push - The validator's error sink.
 * @param mode - Output mode.
 * @param aggregate - Aggregation function.
 * @param aggregateProperty - Property to aggregate on, or `null`.
 */
function checkAggregateProperty(
  push: PushError,
  mode: string,
  aggregate: string,
  aggregateProperty: string | null,
): void {
  // U14: aggregate_property required when aggregate is not "count"
  if (
    mode === "aggregate" &&
    aggregate !== "count" &&
    aggregateProperty === null
  ) {
    push(
      "aggregate_property",
      "aggregate_property is required when aggregate " +
        `is ${pythonRepr(aggregate)} (not 'count')`,
      "U14",
    );
  }

  // U15: aggregate_property must not be set when aggregate is "count"
  if (
    mode === "aggregate" &&
    aggregate === "count" &&
    aggregateProperty !== null
  ) {
    push(
      "aggregate_property",
      "aggregate_property must not be set when aggregate is 'count'",
      "U15",
    );
  }
}

/**
 * U16 / U17: `segment_by` needs aggregate mode and positive cohort IDs.
 *
 * @param push - The validator's error sink.
 * @param mode - Output mode.
 * @param segmentBy - Cohort IDs (non-null).
 */
function checkSegmentBy(
  push: PushError,
  mode: string,
  segmentBy: readonly number[],
): void {
  // U16: segment_by requires mode="aggregate"
  if (mode !== "aggregate") {
    push("segment_by", "segment_by requires mode='aggregate'", "U16");
  }

  // U17: segment_by IDs must be positive integers
  for (const [i, sid] of segmentBy.entries()) {
    if (sid <= 0) {
      push(
        `segment_by[${i}]`,
        `segment_by IDs must be positive integers (got ${pythonNumberStr(sid)})`,
        "U17",
      );
    }
  }
}

/**
 * U26-U28: `percentile` is present exactly for the percentile
 * aggregate and lies in (0, 100).
 *
 * @param push - The validator's error sink.
 * @param mode - Output mode.
 * @param aggregate - Aggregation function.
 * @param percentile - Percentile value, or `null`.
 */
function checkPercentile(
  push: PushError,
  mode: string,
  aggregate: string,
  percentile: number | null,
): void {
  // U26: percentile required when aggregate is "percentile"
  if (
    mode === "aggregate" &&
    aggregate === "percentile" &&
    percentile === null
  ) {
    push(
      "percentile",
      "percentile is required when aggregate is 'percentile'",
      "U26",
    );
  }

  // U27: percentile must not be set when aggregate is not "percentile"
  if (
    mode === "aggregate" &&
    aggregate !== "percentile" &&
    percentile !== null
  ) {
    push(
      "percentile",
      "percentile must not be set when aggregate is " +
        `${pythonRepr(aggregate)} (only valid for aggregate='percentile')`,
      "U27",
    );
  }

  // U28: percentile must be between 0 and 100 (exclusive)
  if (percentile !== null && !(0 < percentile && percentile < 100)) {
    push(
      "percentile",
      "percentile must be between 0 and 100 exclusive " +
        `(got ${pythonNumberStr(percentile)})`,
      "U28",
    );
  }
}

/** The arguments U18-U22 and U30 reject outside `mode="profiles"`. */
interface ProfilesOnlyArgs {
  /** Whether concurrent fetching was requested. */
  readonly parallel: boolean;
  /** Sort property, or `null`. */
  readonly sortBy: string | null;
  /** Full-text search term, or `null`. */
  readonly search: string | null;
  /** Single lookup id, or `null`. */
  readonly distinctId: string | null;
  /** Batch lookup ids, or `null`. */
  readonly distinctIds: readonly string[] | null;
  /** Output properties, or `null`. */
  readonly properties: readonly string[] | null;
  /** Point-in-time date or timestamp, or `null`. */
  readonly asOf: string | number | null;
}

/**
 * U18-U22, U30: the profile-mode-only arguments.
 *
 * @param push - The validator's error sink.
 * @param args - The arguments.
 */
function checkProfilesOnlyArgs(push: PushError, args: ProfilesOnlyArgs): void {
  const {
    parallel,
    sortBy,
    search,
    distinctId,
    distinctIds,
    properties,
    asOf,
  } = args;

  // U18: parallel only applies to mode="profiles"
  if (parallel) {
    push("parallel", "parallel=True only applies to mode='profiles'", "U18");
  }

  // U19: sort_by only applies to mode="profiles"
  if (sortBy !== null) {
    push("sort_by", "sort_by only applies to mode='profiles'", "U19");
  }

  // U20: search only applies to mode="profiles"
  if (search !== null) {
    push("search", "search only applies to mode='profiles'", "U20");
  }

  // U21: distinct_id/distinct_ids only apply to mode="profiles"
  if (distinctId !== null || distinctIds !== null) {
    push(
      "distinct_id",
      "distinct_id/distinct_ids only apply to mode='profiles'",
      "U21",
    );
  }

  // U22: properties only applies to mode="profiles"
  if (properties !== null) {
    push("properties", "properties only applies to mode='profiles'", "U22");
  }

  // U30: as_of only applies to mode="profiles"
  if (asOf !== null) {
    push("as_of", "as_of only applies to mode='profiles'", "U30");
  }
}

/**
 * U24: an inline `CohortDefinition` must serialize.
 *
 * Python catches `(ValueError, TypeError, RuntimeError)`, so the TS
 * catch names all three arms plus the dual-inheriting
 * `ParamValidationError` (`exceptions.py:97`): `ValueError` /
 * `RuntimeError` are the `compat/python-builtins.ts` twins and
 * `TypeError` is native. Everything else propagates exactly as Python
 * lets `KeyError` / `AttributeError` / `RecursionError` propagate.
 *
 * The catch is deliberately this wide: the library `toDict()` path
 * can only raise `ParamValidationError | TypeError`, but the Python
 * integration suite patches `to_dict` to raise `RuntimeError` and
 * `ValueError` and pins U24 for both.
 *
 * @param push - The validator's error sink.
 * @param cohort - The inline cohort definition.
 */
function checkCohortDefinition(
  push: PushError,
  cohort: CohortDefinition,
): void {
  try {
    cohort.toDict();
  } catch (error) {
    if (!(
      error instanceof ParamValidationError ||
      error instanceof TypeError ||
      error instanceof PyValueError ||
      error instanceof PyRuntimeError
    )) {
      throw error;
    }
    push(
      "cohort",
      `CohortDefinition.to_dict() failed: ${error.message}`,
      "U24",
    );
  }
}

/** {@link ValidateUserArgsOptions} with every Python default applied. */
interface ResolvedUserArgs {
  /** `where`, `None` for absent. */
  readonly where: Filter | readonly unknown[] | string | null;
  /** `cohort`, `None` for absent. */
  readonly cohort: number | CohortDefinition | null;
  /** `properties`, `None` for absent. */
  readonly properties: readonly string[] | null;
  /** `sort_by`, `None` for absent. */
  readonly sortBy: string | null;
  /** `search`, `None` for absent. */
  readonly search: string | null;
  /** `distinct_id`, `None` for absent. */
  readonly distinctId: string | null;
  /** `distinct_ids`, `None` for absent. */
  readonly distinctIds: readonly string[] | null;
  /** `as_of`, `None` for absent. */
  readonly asOf: string | number | null;
  /** `aggregate_property`, `None` for absent. */
  readonly aggregateProperty: string | null;
  /** `percentile`, `None` for absent. */
  readonly percentile: number | null;
  /** `segment_by`, `None` for absent. */
  readonly segmentBy: readonly number[] | null;
  /** `limit` — Python default `1`; an explicit `null` means fetch all. */
  readonly limit: number | null;
  /** `mode` — Python default `"aggregate"`. */
  readonly mode: string;
  /** `aggregate` — Python default `"count"`. */
  readonly aggregate: string;
  /** `parallel` — Python default `False`. */
  readonly parallel: boolean;
  /** `workers` — Python default `5`. */
  readonly workers: number;
  /** `include_all_users` — Python default `False`. */
  readonly includeAllUsers: boolean;
  /** The U8 clock seam — the local clock unless injected. */
  readonly today: () => string;
}

/**
 * Apply the Python keyword defaults.
 *
 * The seven parameters with NON-`None` Python defaults (`limit`,
 * `mode`, `aggregate`, `parallel`, `workers`, `include_all_users`,
 * `today`) distinguish absent from `null`: `null` must reach the
 * comparisons verbatim, exactly as Python would see an explicit `None`
 * (e.g. `aggregate=None` makes `aggregate != "count"` true → U14, which
 * a `?? "count"` collapse would silently suppress). Every other field
 * takes the `?? null` form because its Python default IS `None`
 * (R4.10/R4.11).
 *
 * @param options - The caller's argument bag.
 * @returns The defaulted arguments.
 */
function resolveUserArgs(options: ValidateUserArgsOptions): ResolvedUserArgs {
  return {
    where: options.where ?? null,
    cohort: options.cohort ?? null,
    properties: options.properties ?? null,
    sortBy: options.sort_by ?? null,
    search: options.search ?? null,
    distinctId: options.distinct_id ?? null,
    distinctIds: options.distinct_ids ?? null,
    asOf: options.as_of ?? null,
    aggregateProperty: options.aggregate_property ?? null,
    percentile: options.percentile ?? null,
    segmentBy: options.segment_by ?? null,
    limit: options.limit === undefined ? 1 : options.limit,
    mode: options.mode ?? "aggregate",
    aggregate: options.aggregate ?? "count",
    parallel: options.parallel ?? false,
    workers: options.workers ?? 5,
    includeAllUsers: options.include_all_users ?? false,
    today: options.today ?? dateTodayIso,
  };
}

/**
 * Validate `query_user()` arguments before engage param construction.
 *
 * Implements rules U0-U30 (U9 is enforced at the call site and has no
 * code here). Returns all errors found in a single pass, enabling
 * callers to fix multiple issues at once.
 *
 * @param options - Argument bag; every field is optional and takes the
 *   Python default when absent. Absent and `null` are equivalent
 *   wherever the Python default is `None` — the one exception is
 *   `limit`, whose Python default is `1` while `None` means "fetch
 *   all", so an explicit `null` is NOT the same as omitting it.
 * @returns List of `ValidationError` objects; an empty list means all
 *   arguments are valid.
 * @example
 * ```typescript
 * const errors = validateUserArgs({
 *   distinct_id: "user1",
 *   distinct_ids: ["user2"],
 * });
 * // [ValidationError { path: "distinct_id", code: "U1", … }]
 * ```
 */
export function validateUserArgs(
  options: ValidateUserArgsOptions = {},
): ValidationError[] {
  const {
    where,
    cohort,
    properties,
    sortBy,
    search,
    distinctId,
    distinctIds,
    asOf,
    aggregateProperty,
    percentile,
    segmentBy,
    limit,
    mode,
    aggregate,
    parallel,
    workers,
    includeAllUsers,
    today,
  } = resolveUserArgs(options);

  const { errors, push } = errorCollector();
  // Python rebinds the single name `filters` after the U0 pass; TS
  // splits it into two bindings so the narrowed element type survives.
  const rawFilters = normalizeFilters(where);

  // U1: distinct_id and distinct_ids mutually exclusive
  if (distinctId !== null && distinctIds !== null) {
    push(
      "distinct_id",
      "distinct_id and distinct_ids are mutually exclusive; " +
        "provide one or the other, not both",
      "U1",
    );
  }

  const validFilters = checkWhereFilters(push, rawFilters);

  // U2: cohort param and Filter.in_cohort() in where mutually exclusive
  const inCohortCount = validFilters.filter(
    (f) => isCohortFilter(f) && f._operator === "contains",
  ).length;
  if (cohort !== null && inCohortCount > 0) {
    push(
      "cohort",
      "cohort param and Filter.in_cohort() in where are " +
        "mutually exclusive; use one or the other",
      "U2",
    );
  }

  checkProfileSelectors(push, limit, distinctIds, sortBy);
  if (typeof asOf === "string") {
    checkAsOf(push, asOf, today);
  }

  // U7: include_all_users requires cohort (param or Filter.in_cohort in where)
  if (includeAllUsers && cohort === null && inCohortCount === 0) {
    push(
      "include_all_users",
      "include_all_users=True requires a cohort parameter",
      "U7",
    );
  }

  // U9: Enforced at runtime in _resolve_and_build_user_params (type guard)

  checkFilterProperties(push, validFilters);
  if (properties !== null) {
    checkOutputProperties(push, properties);
  }
  checkCohortFilters(push, validFilters, inCohortCount);
  checkAggregateProperty(push, mode, aggregate, aggregateProperty);
  if (segmentBy !== null) {
    checkSegmentBy(push, mode, segmentBy);
  }
  checkPercentile(push, mode, aggregate, percentile);
  if (mode !== "profiles") {
    checkProfilesOnlyArgs(push, {
      parallel,
      sortBy,
      search,
      distinctId,
      distinctIds,
      properties,
      asOf,
    });
  }

  // U23: workers must be between 1 and 5
  if (workers < 1 || workers > 5) {
    push(
      "workers",
      `workers must be between 1 and 5 (got ${pythonNumberStr(workers)})`,
      "U23",
    );
  }

  if (cohort instanceof CohortDefinition) {
    checkCohortDefinition(push, cohort);
  }

  return errors;
}

// =============================================================================
// validate_user_params (user_validators.py:479-580)
// =============================================================================

/**
 * Render an arbitrary value the way a Python `!r` conversion would
 * (display-only, R5.4 — never contract).
 *
 * @param value - The value to repr.
 * @returns A Python-flavoured repr string.
 */
function pythonReprLoose(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return pythonRepr(value);
  }
  if (value === undefined) {
    return "None";
  }
  return `<${pythonTypeName(value)}>`;
}

/**
 * Validate engage params dict after construction.
 *
 * Implements rules UP1-UP4. Checks the generated params dict for
 * structural correctness.
 *
 * Watchlist #7: every `"key" in params` test is `Object.hasOwn`, never
 * the JS `in` operator (`"toString" in obj` is true in JS, false in
 * Python).
 *
 * @param params - Engage API params dict to validate.
 * @returns List of `ValidationError` objects; an empty list means all
 *   params are valid.
 * @example
 * ```typescript
 * const errors = validateUserParams({ sort_order: "invalid" });
 * // [ValidationError { path: "sort_order", code: "UP1", … }]
 * ```
 */
export function validateUserParams(
  params: Readonly<Record<string, unknown>>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // UP1: sort_order must be "ascending" or "descending"
  if (
    Object.hasOwn(params, "sort_order") &&
    params["sort_order"] !== "ascending" &&
    params["sort_order"] !== "descending"
  ) {
    errors.push(
      new ValidationError(
        "sort_order",
        "sort_order must be 'ascending' or 'descending' " +
          `(got ${pythonReprLoose(params["sort_order"])})`,
        "UP1",
      ),
    );
  }

  // UP2: filter_by_cohort must have "id" or "raw_cohort" key
  if (Object.hasOwn(params, "filter_by_cohort")) {
    let fbc: unknown = params["filter_by_cohort"];
    if (typeof fbc === "string") {
      try {
        // GATE-R5 / B0 arbiter F1: `json.loads` accepts NaN/Infinity.
        fbc = parseLossless(fbc, { pythonConstants: true });
      } catch (error) {
        // B0 arbiter F3: only the JSONDecodeError analog is caught; a
        // parser RangeError propagates like Python's RecursionError.
        if (!(error instanceof LosslessJsonError)) {
          throw error;
        }
        errors.push(
          new ValidationError(
            "filter_by_cohort",
            `filter_by_cohort is not valid JSON: ${error.message}`,
            "UP2",
          ),
        );
        return errors;
      }
    }
    if (
      isPythonDict(fbc) &&
      !Object.hasOwn(fbc, "id") &&
      !Object.hasOwn(fbc, "raw_cohort")
    ) {
      errors.push(
        new ValidationError(
          "filter_by_cohort",
          "filter_by_cohort must contain an 'id' or 'raw_cohort' key",
          "UP2",
        ),
      );
    }
  }

  // UP3: output_properties must be non-empty array if present
  if (Object.hasOwn(params, "output_properties")) {
    let opVal: unknown = params["output_properties"];
    // Handle both raw list and JSON-encoded string forms
    if (typeof opVal === "string") {
      try {
        opVal = parseLossless(opVal, { pythonConstants: true });
      } catch (error) {
        // Python: `contextlib.suppress(json.JSONDecodeError)` — the
        // undecodable string is simply kept (and is not a list).
        if (!(error instanceof LosslessJsonError)) {
          throw error;
        }
      }
    }
    if (Array.isArray(opVal) && opVal.length === 0) {
      errors.push(
        new ValidationError(
          "output_properties",
          "output_properties must be a non-empty array",
          "UP3",
        ),
      );
    }
  }

  // UP4: action must be valid aggregation expression
  if (Object.hasOwn(params, "action")) {
    const action: unknown = params["action"];
    if (typeof action !== "string" || !matchesActionRe(action)) {
      errors.push(
        new ValidationError(
          "action",
          "action must be a valid aggregation expression " +
            'like count(), extremes(properties["prop"]), ' +
            'percentile(properties["prop"], N), ' +
            'or numeric_summary(properties["prop"]) ' +
            `(got ${pythonReprLoose(action)})`,
          "UP4",
        ),
      );
    }
  }

  return errors;
}
