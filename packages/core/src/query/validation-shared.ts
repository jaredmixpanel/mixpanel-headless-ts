/**
 * Shared validation helpers, custom-property scanning, and the
 * difflib-faithful fuzzy matcher.
 *
 * Internal module — not exported from the package barrel.
 *
 * Source: `src/mixpanel_headless/_internal/validation.py` (ranges
 * 91-508: custom-property scan, shared tables/helpers, fuzzy helpers,
 * `_validate_data_group_id`). Python revision:
 * `ts-port/phase2-contract-support` HEAD.
 *
 * Fidelity notes (b2-packets.md Cautions):
 * - §3/§4 (R11.7): `pythonStrip` everywhere Python calls `.strip()`;
 *   `_INVISIBLE_RE` is built from the pinned
 *   `compat/whitespace.gen.ts` table (Python str-pattern `\s` ==
 *   `str.isspace()` set), never a JS `\s` class.
 * - §8: Python `float` values reach TS either as non-integral /
 *   non-finite JS numbers or as the conformance rig's PyFloat carrier
 *   duck-shape `{ spelling: string }` (precedent:
 *   `types/vector-codecs.ts` SignedReplay decode); {@link isPythonFloat}
 *   and {@link _isFinite} classify both spellings.
 * - §9 (R11.6): `len(str)` bounds count codepoints via `cpLength`.
 * - §6: `_suggest` is a faithful `difflib.get_close_matches` port —
 *   SequenceMatcher `ratio()` with the `real_quick_ratio`/`quick_ratio`
 *   pre-filters, candidates from `sortedByCodepoint(valid)`, n=3,
 *   cutoff=0.5, `heapq.nlargest` tie order. Autojunk is implemented
 *   verbatim (it only activates when the query string is >= 200
 *   codepoints — irrelevant at enum sizes but kept for faithfulness).
 *
 * @module validation-shared
 * @internal
 */

import { ValidationError } from "../errors.js";
import {
  CustomPropertyRef,
  InlineCustomProperty,
  Filter,
  FrequencyFilter,
  FunnelStep,
  GroupBy,
  Metric,
} from "../types/index.js";
import type { FlowStep, RetentionEvent } from "../types/index.js";
import {
  cpLength,
  pythonRepr,
  pythonStrip,
  sortedByCodepoint,
} from "../compat/index.js";
import { PYTHON_STR_WHITESPACE } from "../compat/whitespace.gen.js";
import { DECIMAL_DIGIT_RUNS } from "../compat/decimal-digits.gen.js";

// =============================================================================
// Module constants (validation.py:91-92, 338-366, 1162-1176, 1484-1495)
// =============================================================================

/** Port of `_CP_INPUT_KEY_RE` (`validation.py:91`) — ASCII-only class. */
const _CP_INPUT_KEY_RE = /^[A-Z]$/;

/** Port of `_CP_MAX_FORMULA_LENGTH` (`validation.py:92`). */
export const _CP_MAX_FORMULA_LENGTH = 20_000;

/**
 * Port of `_SESSION_MATH` (`validation.py:338`): session-based math
 * types requiring `conversion_window_unit='session'`.
 */
export const _SESSION_MATH: ReadonlySet<string> = new Set([
  "conversion_rate_session",
]);

/**
 * Port of `_FORMULA_POSITION_RE` (`validation.py:342`) — ASCII-only
 * class, safe as a JS regex.
 */
export const _FORMULA_POSITION_RE = /[A-Z]/g;

/**
 * Codepoint test for the `_CONTROL_CHAR_RE` class (`validation.py:343`,
 * `[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]`).
 *
 * Ported as an explicit codepoint predicate rather than a JS regex: the
 * character class is ASCII-explicit (no `\s`/`\d` shorthand) so the two
 * spellings are equivalent, and the predicate form avoids embedding raw
 * control characters in a regex literal.
 *
 * @param cp - Codepoint to test.
 * @returns True when the codepoint is in the Python class.
 */
function isControlCodepoint(cp: number): boolean {
  return (
    cp <= 0x08 ||
    cp === 0x0b ||
    cp === 0x0c ||
    (cp >= 0x0e && cp <= 0x1f) ||
    cp === 0x7f
  );
}

/**
 * The literal extras of `_INVISIBLE_RE` (`validation.py:363`) beyond
 * the Python `\s` class: U+200B ZWSP, U+200C ZWNJ, U+200D ZWJ,
 * U+FEFF BOM, U+00AD SOFT HYPHEN, U+2060 WORD JOINER.
 */
const _INVISIBLE_EXTRAS: ReadonlySet<number> = new Set([
  0x200b, 0x200c, 0x200d, 0xfeff, 0x00ad, 0x2060,
]);

/** Port of `_MAX_LAST_DAYS` (`validation.py:364`) — 10 years. */
export const _MAX_LAST_DAYS = 3650;

/** Port of `_MAX_ROLLING` (`validation.py:365`) — rolling window cap. */
export const _MAX_ROLLING = 365;

/**
 * Port of `_MAX_FILTER_VALUES` (`validation.py:366`) — server rejects
 * very large filter value lists. Consumed by the V1b bookmark
 * validators (B20B/B21); declared here with the other module
 * constants exactly as in the Python source.
 */
export const _MAX_FILTER_VALUES = 1000;

/**
 * Port of `_VALID_RETENTION_MATH_PUBLIC` (`validation.py:1162-1164`):
 * public-facing retention math types (Layer 1).
 */
export const _VALID_RETENTION_MATH_PUBLIC: ReadonlySet<string> = new Set([
  "retention_rate",
  "unique",
  "total",
  "average",
]);

/**
 * Port of `_VALID_RETENTION_MODES` (`validation.py:1172`): valid
 * display modes for retention queries.
 */
export const _VALID_RETENTION_MODES: ReadonlySet<string> = new Set([
  "curve",
  "trends",
  "table",
]);

/** Port of `_MAX_RETENTION_BUCKETS` (`validation.py:1175`). */
export const _MAX_RETENTION_BUCKETS = 730;

/** Port of `_MAX_FLOW_STEPS_DIRECTION` (`validation.py:1484`). */
export const _MAX_FLOW_STEPS_DIRECTION = 5;

/** Port of `_MAX_FLOW_CARDINALITY` (`validation.py:1487`). */
export const _MAX_FLOW_CARDINALITY = 50;

/**
 * Port of `_FLOW_MAX_WINDOW` (`validation.py:1490-1494`): maximum
 * conversion window per unit (366-day equivalent for a leap year).
 * ReadonlyMap per R4.8.
 */
export const _FLOW_MAX_WINDOW: ReadonlyMap<string, number> = new Map([
  ["month", 12],
  ["week", 52],
  ["day", 366],
]);

// =============================================================================
// Python value-classification helpers (Caution §8)
// =============================================================================

/**
 * Duck-type check for the conformance rig's PyFloat carrier — a
 * non-number object with a string `spelling` field, produced when a
 * Python float (integral spelling like `18.0`, or the non-finite
 * spellings `Infinity`/`-Infinity`/`NaN`) rides a decoded kwargs bag.
 *
 * Precedent: the SignedReplay codec unwrap in
 * `types/vector-codecs.ts` (b2-packets.md Caution §8). Recognizing
 * the shape here lets `isinstance(x, float)` branches (e.g. retention
 * R5_BUCKET_SIZES_INTEGER) classify carriers exactly where Python
 * classifies floats, without any binding-side unwrapping.
 *
 * @param value - Candidate value.
 * @returns True when `value` carries the PyFloat duck-shape.
 */
export function isFloatCarrier(
  value: unknown,
): value is { readonly spelling: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "spelling" in value &&
    typeof (value as { spelling: unknown }).spelling === "string"
  );
}

/**
 * TS analog of Python `isinstance(value, float)`.
 *
 * A JS number is a Python float when it is non-integral or non-finite
 * (integral finite JS numbers are Python ints in the ported value
 * domain); a PyFloat carrier ({@link isFloatCarrier}) is always a
 * float.
 *
 * @param value - Candidate value.
 * @returns True when Python would classify the value as a `float`.
 */
export function isPythonFloat(value: unknown): boolean {
  if (typeof value === "number") {
    return !Number.isInteger(value);
  }
  return isFloatCarrier(value);
}

/**
 * TS analog of Python `isinstance(value, int) and not isinstance(value,
 * bool)` — the bool-before-int guard order from Caution §8.
 *
 * @param value - Candidate value.
 * @returns True when Python would classify the value as a non-bool int.
 */
export function isPythonInt(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Display-only `type(x).__name__` analog for ported message text
 * (out of contract, R5.4).
 *
 * @param value - The value whose Python type name to approximate.
 * @returns The Python type name Python would print for the
 *   equivalent value.
 */
export function pythonTypeName(value: unknown): string {
  if (value === null || value === undefined) {
    return "NoneType";
  }
  if (typeof value === "boolean") {
    return "bool";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "int" : "float";
  }
  if (isFloatCarrier(value)) {
    return "float";
  }
  if (typeof value === "string") {
    return "str";
  }
  if (Array.isArray(value)) {
    return "list";
  }
  if (typeof value === "object") {
    return value.constructor.name;
  }
  return typeof value;
}

/**
 * Render a list of strings as a Python `list` repr (display-only
 * message helper for the `{sorted(...)}` f-string interpolations).
 *
 * @param items - The (already ordered) list members.
 * @returns Python-style list repr, e.g. `['birth', 'interval_start']`.
 */
export function pythonListRepr(items: readonly string[]): string {
  return `[${items.map((item) => pythonRepr(item)).join(", ")}]`;
}

/**
 * Render a number the way a Python f-string would (display-only, R5.4).
 *
 * JS cannot distinguish `18` from `18.0`, so this delegates to
 * {@link pythonRepr}'s documented number caveat: safe integers render
 * as Python `int`, everything else (including `nan` / `inf`) via
 * `pythonFloatStr`. `null` renders as `None`.
 *
 * @param value - The number (or `null`) to render.
 * @returns The Python `str()` rendering.
 */
export function pythonNumberStr(value: number | null): string {
  if (value === null) {
    return "None";
  }
  return pythonRepr(value);
}

/**
 * `str(value)` for the loosely-typed enum arguments that Python passes
 * through `str(...)` before fuzzy matching (`validation.py:1409`
 * `str(mode)`, `:1421` `str(unit)`).
 *
 * Only the shapes those call sites can actually receive are modelled:
 * strings pass through, `None` renders `"None"`, and anything else
 * falls back to {@link pythonTypeName} (a display-only approximation —
 * out of contract per R5.4).
 *
 * @param value - Candidate enum value.
 * @returns The Python `str()` rendering.
 */
export function pythonStrLoose(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "None";
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (typeof value === "number") {
    return pythonRepr(value);
  }
  return `<${pythonTypeName(value)}>`;
}

// =============================================================================
// Character / date / finiteness helpers (validation.py:346-402)
// =============================================================================

/**
 * Check whether a string contains ASCII control characters.
 *
 * Port of `contains_control_chars` (`validation.py:346-360`): detects
 * `\x00-\x08`, `\x0b`, `\x0c`, `\x0e-\x1f`, and `\x7f` (DEL).
 *
 * @param s - The string to check.
 * @returns True if `s` contains at least one control character.
 */
export function containsControlChars(s: string): boolean {
  for (const ch of s) {
    if (isControlCodepoint(ch.codePointAt(0) as number)) {
      return true;
    }
  }
  return false;
}

/**
 * Port of `_INVISIBLE_RE.match(s)` truthiness (`validation.py:363`):
 * true when EVERY codepoint of `s` is Python-`\s` whitespace (the
 * pinned `str.isspace()` table) or one of the six invisible literals.
 * True for the empty string (`[...]*` matches zero chars), exactly as
 * the Python regex. Python's `$`-before-trailing-newline nuance is a
 * no-op here because `\n` is itself in the class.
 *
 * @param s - The string to classify.
 * @returns True when the string is invisible-only.
 */
export function isInvisibleOnly(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (!PYTHON_STR_WHITESPACE.has(cp) && !_INVISIBLE_EXTRAS.has(cp)) {
      return false;
    }
  }
  return true;
}

/**
 * Unicode decimal-digit (category Nd) test from the pinned CPython
 * table — Python str-pattern `\d` matches exactly this set
 * (`Py_UNICODE_ISDECIMAL`), NOT the ASCII-only JS `\d`.
 *
 * @param cp - Codepoint to test.
 * @returns True when the codepoint is a Unicode decimal digit.
 */
function isDecimalDigit(cp: number): boolean {
  for (const [start, , length] of DECIMAL_DIGIT_RUNS) {
    if (cp >= start && cp < start + length) {
      return true;
    }
  }
  return false;
}

/**
 * Port of `_DATE_RE.match(s)` truthiness (`validation.py:341`,
 * pattern `^\d{4}-\d{2}-\d{2}$`) with Python `re` semantics:
 *
 * - `\d` matches Unicode decimal digits (category Nd), not just
 *   ASCII — see {@link isDecimalDigit};
 * - `$` also matches just before ONE trailing `\n`.
 *
 * @param s - Candidate date string.
 * @returns True when the Python regex would match.
 */
export function matchesDateRe(s: string): boolean {
  const core = s.endsWith("\n") ? s.slice(0, -1) : s;
  const cps = Array.from(core);
  if (cps.length !== 10) {
    return false;
  }
  for (let i = 0; i < 10; i++) {
    const cp = (cps[i] as string).codePointAt(0) as number;
    if (i === 4 || i === 7) {
      if (cp !== 0x2d) {
        return false;
      }
    } else if (!isDecimalDigit(cp)) {
      return false;
    }
  }
  return true;
}

/** Days per month in a non-leap year (calendar table, watchlist #5). */
const _DAYS_IN_MONTH: readonly number[] = [
  31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
];

/**
 * Check if a YYYY-MM-DD string is a valid calendar date.
 *
 * Port of `_is_valid_date` (`validation.py:369-384`), which defers to
 * `datetime.date.fromisoformat`. Implemented as a PURE calendar check
 * (watchlist #5 — never `new Date(...)`): Gregorian leap rule, month
 * 1-12, day vs month length, year 1-9999 (`date.MINYEAR`).
 *
 * Contract note: callers only reach this through the
 * {@link matchesDateRe} gate, whose accepted set is wider than ASCII
 * (Unicode Nd digits, one trailing newline). CPython's
 * `fromisoformat` C parser accepts ONLY ASCII digits in exactly
 * `YYYY-MM-DD` here, so any gated-but-non-ASCII spelling returns
 * false — matching Python's `ValueError → False` path
 * (`fromisoformat`'s wider grammar — basic format, week dates — can
 * never pass the gate, so it is intentionally not reproduced).
 *
 * @param dateStr - Date string (regex-gated by the caller).
 * @returns True if the date is a valid calendar date.
 */
export function _isValidDate(dateStr: string): boolean {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(dateStr)) {
    return false;
  }
  const year = asciiDigitsToInt(dateStr.slice(0, 4));
  const month = asciiDigitsToInt(dateStr.slice(5, 7));
  const day = asciiDigitsToInt(dateStr.slice(8, 10));
  if (year < 1) {
    return false;
  }
  if (month < 1 || month > 12) {
    return false;
  }
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDay =
    month === 2 && isLeap ? 29 : (_DAYS_IN_MONTH[month - 1] as number);
  return day >= 1 && day <= maxDay;
}

/**
 * Convert a pre-validated run of ASCII digits to a number (no
 * `parseInt`/`Number` per R11.7; input is guaranteed `[0-9]+` by the
 * caller's regex).
 *
 * @param digits - ASCII digit string.
 * @returns The base-10 integer value.
 */
function asciiDigitsToInt(digits: string): number {
  let value = 0;
  for (let i = 0; i < digits.length; i++) {
    value = value * 10 + (digits.charCodeAt(i) - 0x30);
  }
  return value;
}

/**
 * Python-`str` codepoint-wise `a > b` comparison (R11.5 — JS `>` on
 * strings compares UTF-16 units, which diverges for non-BMP vs
 * U+E000..U+FFFF mixes).
 *
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns True when Python would evaluate `a > b`.
 */
export function codepointGreater(a: string, b: string): boolean {
  const as = Array.from(a);
  const bs = Array.from(b);
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    const ca = (as[i] as string).codePointAt(0) as number;
    const cb = (bs[i] as string).codePointAt(0) as number;
    if (ca !== cb) {
      return ca > cb;
    }
  }
  return as.length > bs.length;
}

/**
 * Check if a numeric value is finite (not NaN, not Inf).
 *
 * Port of `_is_finite` (`validation.py:387-402`): `None` → true;
 * `float` → `math.isfinite`; anything else (ints included) → true.
 * PyFloat carriers are classified per Caution §8: the non-finite
 * spellings are the only non-finite carriers.
 *
 * @param value - Numeric value to check (loose input domain, R4.9).
 * @returns True if finite or not a float at all.
 */
export function _isFinite(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (isFloatCarrier(value)) {
    return !["Infinity", "-Infinity", "NaN"].includes(value.spelling);
  }
  return true;
}

// =============================================================================
// difflib.get_close_matches port (Caution §6)
// =============================================================================

/**
 * Faithful port of `difflib.SequenceMatcher` restricted to the
 * surface `get_close_matches` uses (`isjunk=None`, `autojunk=True`):
 * `set_seq1`/`set_seq2`, `find_longest_match`, `get_matching_blocks`,
 * `ratio`, `quick_ratio`, `real_quick_ratio`. Sequences are codepoint
 * arrays (Python `str` indexing is by codepoint, R11.6).
 *
 * Reference: CPython 3.14 `Lib/difflib.py`.
 *
 * @internal
 */
class SequenceMatcher {
  /** Sequence 1 (the candidate) as codepoints. */
  private a: readonly string[] = [];

  /** Sequence 2 (the query word) as codepoints. */
  private b: readonly string[] = [];

  /** Element → ascending indices in `b` (popular entries removed). */
  private b2j = new Map<string, number[]>();

  /** Autojunk "popular" elements excluded from `b2j`. */
  private bpopular = new Set<string>();

  /** Element → occurrence count over the FULL `b` (for quick_ratio). */
  private fullbcount: Map<string, number> | null = null;

  /** Cached matching blocks for the current (a, b) pair. */
  private matchingBlocks:
    readonly (readonly [number, number, number])[] | null = null;

  /**
   * Set the first sequence (the candidate string).
   *
   * @param a - Candidate string.
   */
  setSeq1(a: string): void {
    this.a = Array.from(a);
    this.matchingBlocks = null;
  }

  /**
   * Set the second sequence (the query word) and chain its index map
   * (`__chain_b`), applying the autojunk rule verbatim: when
   * `len(b) >= 200`, elements occurring more than `len(b)//100 + 1`
   * times are "popular" and dropped from `b2j`.
   *
   * @param b - Query string.
   */
  setSeq2(b: string): void {
    this.b = Array.from(b);
    this.matchingBlocks = null;
    this.fullbcount = null;
    const b2j = new Map<string, number[]>();
    for (let i = 0; i < this.b.length; i++) {
      const elt = this.b[i] as string;
      const indices = b2j.get(elt);
      if (indices === undefined) {
        b2j.set(elt, [i]);
      } else {
        indices.push(i);
      }
    }
    this.bpopular = new Set();
    const n = this.b.length;
    if (n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      for (const [elt, idxs] of b2j) {
        if (idxs.length > ntest) {
          this.bpopular.add(elt);
        }
      }
      for (const elt of this.bpopular) {
        b2j.delete(elt);
      }
    }
    this.b2j = b2j;
  }

  /**
   * Find the longest matching block in `a[alo:ahi]` / `b[blo:bhi]` —
   * verbatim port of `find_longest_match` (with `bjunk` empty, the
   * junk-extension loops reduce to no-ops and are omitted; the
   * non-junk extension loops are kept).
   *
   * @param alo - Start index in `a`.
   * @param ahi - End index (exclusive) in `a`.
   * @param blo - Start index in `b`.
   * @param bhi - End index (exclusive) in `b`.
   * @returns `[besti, bestj, bestsize]`.
   */
  private findLongestMatch(
    alo: number,
    ahi: number,
    blo: number,
    bhi: number,
  ): readonly [number, number, number] {
    const { a, b, b2j } = this;
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      const indices = b2j.get(a[i] as string);
      if (indices !== undefined) {
        for (const j of indices) {
          if (j < blo) {
            continue;
          }
          if (j >= bhi) {
            break;
          }
          const k = (j2len.get(j - 1) ?? 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) {
            besti = i - k + 1;
            bestj = j - k + 1;
            bestsize = k;
          }
        }
      }
      j2len = newj2len;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize += 1;
    }
    return [besti, bestj, bestsize];
  }

  /**
   * Compute (and cache) the matching blocks — verbatim port of the
   * iterative-queue `get_matching_blocks`, including the
   * adjacent-block merge and the terminating `(la, lb, 0)` sentinel.
   *
   * @returns The merged, sorted matching blocks.
   */
  private getMatchingBlocks(): readonly (readonly [number, number, number])[] {
    if (this.matchingBlocks !== null) {
      return this.matchingBlocks;
    }
    const la = this.a.length;
    const lb = this.b.length;
    const queue: [number, number, number, number][] = [[0, la, 0, lb]];
    const blocks: [number, number, number][] = [];
    while (queue.length > 0) {
      const [alo, ahi, blo, bhi] = queue.pop() as [
        number,
        number,
        number,
        number,
      ];
      const [i, j, k] = this.findLongestMatch(alo, ahi, blo, bhi);
      if (k > 0) {
        blocks.push([i, j, k]);
        if (alo < i && blo < j) {
          queue.push([alo, i, blo, j]);
        }
        if (i + k < ahi && j + k < bhi) {
          queue.push([i + k, ahi, j + k, bhi]);
        }
      }
    }
    blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
    let i1 = 0;
    let j1 = 0;
    let k1 = 0;
    const nonAdjacent: (readonly [number, number, number])[] = [];
    for (const [i2, j2, k2] of blocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2;
      } else {
        if (k1 > 0) {
          nonAdjacent.push([i1, j1, k1]);
        }
        i1 = i2;
        j1 = j2;
        k1 = k2;
      }
    }
    if (k1 > 0) {
      nonAdjacent.push([i1, j1, k1]);
    }
    nonAdjacent.push([la, lb, 0]);
    this.matchingBlocks = nonAdjacent;
    return nonAdjacent;
  }

  /**
   * `_calculate_ratio(matches, length)` — `2.0*M/T`, or 1.0 for two
   * empty sequences.
   *
   * @param matches - Matched element count.
   * @param length - `len(a) + len(b)`.
   * @returns The similarity ratio.
   */
  private static calculateRatio(matches: number, length: number): number {
    if (length > 0) {
      return (2.0 * matches) / length;
    }
    return 1.0;
  }

  /**
   * Exact similarity ratio over the matching blocks.
   *
   * @returns `2.0*M/T` where M sums the matched block sizes.
   */
  ratio(): number {
    let matches = 0;
    for (const [, , size] of this.getMatchingBlocks()) {
      matches += size;
    }
    return SequenceMatcher.calculateRatio(
      matches,
      this.a.length + this.b.length,
    );
  }

  /**
   * Upper bound on {@link ratio} from element multisets (verbatim
   * `quick_ratio`, including the `avail` bookkeeping).
   *
   * @returns The quick upper bound.
   */
  quickRatio(): number {
    if (this.fullbcount === null) {
      const fullbcount = new Map<string, number>();
      for (const elt of this.b) {
        fullbcount.set(elt, (fullbcount.get(elt) ?? 0) + 1);
      }
      this.fullbcount = fullbcount;
    }
    const fullbcount = this.fullbcount;
    const avail = new Map<string, number>();
    let matches = 0;
    for (const elt of this.a) {
      const numb = avail.has(elt)
        ? (avail.get(elt) as number)
        : (fullbcount.get(elt) ?? 0);
      avail.set(elt, numb - 1);
      if (numb > 0) {
        matches += 1;
      }
    }
    return SequenceMatcher.calculateRatio(
      matches,
      this.a.length + this.b.length,
    );
  }

  /**
   * Fastest upper bound on {@link ratio} from lengths alone.
   *
   * @returns `2*min(la, lb) / (la + lb)`.
   */
  realQuickRatio(): number {
    const la = this.a.length;
    const lb = this.b.length;
    return SequenceMatcher.calculateRatio(Math.min(la, lb), la + lb);
  }
}

/**
 * Faithful port of `difflib.get_close_matches(word, possibilities,
 * n, cutoff)` (CPython 3.14), including the `heapq.nlargest` result
 * order: descending `(ratio, candidate)` tuple comparison — ratio
 * first, then candidate string descending by codepoint on ties.
 *
 * @param word - The query word.
 * @param possibilities - Candidate strings, in the caller's order.
 * @param n - Maximum number of close matches (must be > 0).
 * @param cutoff - Similarity threshold in [0, 1].
 * @returns The best (at most `n`) matches, best first.
 * @throws RangeError - When `n <= 0` or `cutoff` is outside [0, 1]
 *   (Python raises `ValueError`; RangeError is the TS analog and no
 *   caller in this module can trigger it).
 */
export function getCloseMatches(
  word: string,
  possibilities: readonly string[],
  n = 3,
  cutoff = 0.6,
): string[] {
  if (!(n > 0)) {
    throw new RangeError(`n must be > 0: ${String(n)}`);
  }
  if (!(cutoff >= 0.0 && cutoff <= 1.0)) {
    throw new RangeError(`cutoff must be in [0.0, 1.0]: ${String(cutoff)}`);
  }
  const result: [number, string][] = [];
  const s = new SequenceMatcher();
  s.setSeq2(word);
  for (const x of possibilities) {
    s.setSeq1(x);
    if (
      s.realQuickRatio() >= cutoff &&
      s.quickRatio() >= cutoff &&
      s.ratio() >= cutoff
    ) {
      result.push([s.ratio(), x]);
    }
  }
  // heapq.nlargest(n, result) == sorted(result, reverse=True)[:n];
  // tuple comparison breaks ratio ties by candidate string, and
  // Python string comparison is codepoint-wise.
  result.sort((p, q) => {
    if (p[0] !== q[0]) {
      return q[0] - p[0];
    }
    if (p[1] === q[1]) {
      return 0;
    }
    return codepointGreater(q[1], p[1]) ? 1 : -1;
  });
  return result.slice(0, n).map(([, x]) => x);
}

// =============================================================================
// Fuzzy matching helpers (validation.py:410-464)
// =============================================================================

/**
 * Find closest matches for a mistyped enum value.
 *
 * Port of `_suggest` (`validation.py:410-428`): candidates are
 * `sorted(valid)` (codepoint sort, R11.5), n=3, cutoff=0.5; `None`
 * when nothing clears the cutoff.
 *
 * @param value - The invalid value to match against.
 * @param valid - Set of valid values.
 * @param n - Maximum number of suggestions (default 3).
 * @param cutoff - Minimum similarity ratio (default 0.5).
 * @returns Frozen array of closest matches, or null if none.
 */
export function _suggest(
  value: string,
  valid: ReadonlySet<string>,
  n = 3,
  cutoff = 0.5,
): readonly string[] | null {
  const matches = getCloseMatches(
    value,
    sortedByCodepoint([...valid]),
    n,
    cutoff,
  );
  return matches.length > 0 ? matches : null;
}

/**
 * Build a validation error for an invalid enum value with suggestions.
 *
 * Port of `_enum_error` (`validation.py:431-464`). Message text is
 * display-only (R5.4) but ported faithfully, including the
 * `sorted(valid)[:5]` sample list repr in the no-suggestion branch.
 *
 * @param path - JSONPath-like location.
 * @param field - Human-readable field name.
 * @param value - The invalid value.
 * @param valid - Set of valid values.
 * @param code - Machine-readable error code.
 * @param severity - Error severity level (default `"error"`).
 * @returns ValidationError with fuzzy-matched suggestions.
 */
export function _enumError(
  path: string,
  field: string,
  value: string,
  valid: ReadonlySet<string>,
  code: string,
  severity: "error" | "warning" = "error",
): ValidationError {
  const suggestion = _suggest(value, valid);
  let msg: string;
  if (suggestion !== null && suggestion.length > 0) {
    msg = `Invalid ${field} '${value}'`;
  } else {
    const sample = sortedByCodepoint([...valid]).slice(0, 5);
    msg = `Invalid ${field} '${value}'. Valid (${String(valid.size)} total): ${pythonListRepr(sample)}`;
  }
  return new ValidationError(path, msg, code, severity, suggestion);
}

// =============================================================================
// data_group_id validation (validation.py:472-508)
// =============================================================================

/**
 * Validate the `data_group_id` parameter if provided.
 *
 * Port of `_validate_data_group_id` (`validation.py:472-508`). Guard
 * order matters (Caution §8): the bool reject fires BEFORE the int
 * check because Python `bool` IS `int`.
 *
 * @param dataGroupId - Data group ID to validate (loose input, R4.9);
 *   `null`/absent skips validation.
 * @returns List with one `ValidationError` if invalid, empty otherwise.
 */
export function _validateDataGroupId(dataGroupId: unknown): ValidationError[] {
  if (dataGroupId !== null && dataGroupId !== undefined) {
    if (typeof dataGroupId === "boolean" || !isPythonInt(dataGroupId)) {
      return [
        new ValidationError(
          "data_group_id",
          `data_group_id must be a positive integer, got ${pythonTypeName(dataGroupId)}`,
          "DG1_INVALID_DATA_GROUP_ID",
        ),
      ];
    }
    if ((dataGroupId as number) <= 0) {
      return [
        new ValidationError(
          "data_group_id",
          `data_group_id must be a positive integer (got ${String(dataGroupId)})`,
          "DG1_INVALID_DATA_GROUP_ID",
        ),
      ];
    }
  }
  return [];
}

// =============================================================================
// Custom property validation + scanning (validation.py:95-335)
// =============================================================================

/**
 * Validate a custom property specification (rules CP1-CP6).
 *
 * Port of `_validate_custom_property` (`validation.py:95-188`).
 * CP5's formula length bound counts CODEPOINTS (`cpLength`, R11.6).
 *
 * @param prop - A `CustomPropertyRef` or `InlineCustomProperty`.
 * @param path - JSONPath-like location for error reporting.
 * @returns List of validation errors; empty means valid.
 */
export function _validateCustomProperty(
  prop: CustomPropertyRef | InlineCustomProperty,
  path: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (prop instanceof CustomPropertyRef) {
    // CP1: id must be a positive integer
    if (prop.id <= 0) {
      errors.push(
        new ValidationError(
          path,
          `custom property ID must be a positive integer (got ${String(prop.id)})`,
          "CP1_INVALID_ID",
        ),
      );
    }
  } else if (prop instanceof InlineCustomProperty) {
    // CP2: formula must be non-empty
    if (pythonStrip(prop.formula) === "") {
      errors.push(
        new ValidationError(
          path,
          "inline custom property formula must be non-empty",
          "CP2_EMPTY_FORMULA",
        ),
      );
    }

    // CP3: inputs must have at least one entry
    if (Object.keys(prop.inputs).length === 0) {
      errors.push(
        new ValidationError(
          path,
          "inline custom property must have at least one input",
          "CP3_EMPTY_INPUTS",
        ),
      );
    }

    // CP4: input keys must be single uppercase letters A-Z
    for (const key of Object.keys(prop.inputs)) {
      if (!_CP_INPUT_KEY_RE.test(key)) {
        errors.push(
          new ValidationError(
            path,
            `inline custom property input keys must be ` +
              `single uppercase letters (A-Z), got ${pythonRepr(key)}`,
            "CP4_INVALID_INPUT_KEY",
          ),
        );
      }
    }

    // CP5: formula must not exceed max length
    if (cpLength(prop.formula) > _CP_MAX_FORMULA_LENGTH) {
      errors.push(
        new ValidationError(
          path,
          `inline custom property formula exceeds maximum ` +
            `length of 20,000 characters (got ${String(cpLength(prop.formula))})`,
          "CP5_FORMULA_TOO_LONG",
        ),
      );
    }

    // CP6: each PropertyInput.name must be non-empty
    for (const [key, pi] of Object.entries(prop.inputs)) {
      if (pythonStrip(pi.name) === "") {
        errors.push(
          new ValidationError(
            path,
            `inline custom property input ${pythonRepr(key)} has an ` +
              `empty property name`,
            "CP6_EMPTY_INPUT_NAME",
          ),
        );
      }
    }
  }

  return errors;
}

/**
 * Scan a list of Filter objects for custom property references.
 *
 * Port of `_scan_filters_for_custom_properties`
 * (`validation.py:191-215`).
 *
 * @param filters - Filter objects to scan.
 * @param basePath - JSONPath prefix for error reporting (e.g.
 *   `"events[0]"` or `"steps[1]"`).
 * @returns List of validation errors for invalid custom properties.
 */
export function _scanFiltersForCustomProperties(
  filters: readonly Filter[],
  basePath: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (let i = 0; i < filters.length; i++) {
    const f = filters[i] as Filter;
    if (
      f._property instanceof CustomPropertyRef ||
      f._property instanceof InlineCustomProperty
    ) {
      const fpath = `${basePath}.filters[${String(i)}]`;
      errors.push(..._validateCustomProperty(f._property, fpath));
    }
  }
  return errors;
}

/**
 * Options bag for {@link _scanCustomProperties} — mirrors the all-kwonly,
 * all-default-`None` Python signature (R3.9: absent and `null` are
 * equivalent).
 */
export interface ScanCustomPropertiesOptions {
  /** Breakdown specification (may contain custom properties). */
  readonly group_by?: unknown;
  /** Filter specification (may contain custom properties). */
  readonly where?: unknown;
  /** Event specifications (Metric property/filters scanned). */
  readonly events?: readonly unknown[] | null;
  /** Funnel step specifications (FunnelStep.filters scanned). */
  readonly funnel_steps?: readonly unknown[] | null;
  /** Flow step specifications (FlowStep.filters scanned). */
  readonly flow_steps?: readonly FlowStep[] | null;
  /** Retention event pair `[born_event, return_event]`. */
  readonly retention_events?: readonly RetentionEvent[] | null;
}

/**
 * Scan all query positions for custom properties and validate.
 *
 * Port of `_scan_custom_properties` (`validation.py:218-335`):
 * collects `CustomPropertyRef`/`InlineCustomProperty` values from
 * group_by, where, events, funnel/flow steps and retention events,
 * and runs {@link _validateCustomProperty} on each, in source order.
 *
 * @param options - The scan positions (all optional).
 * @returns List of validation errors; empty means all valid.
 */
export function _scanCustomProperties(
  options: ScanCustomPropertiesOptions,
): ValidationError[] {
  const {
    group_by = null,
    where = null,
    events = null,
    funnel_steps = null,
    flow_steps = null,
    retention_events = null,
  } = options;
  const errors: ValidationError[] = [];

  // Scan group_by
  if (group_by !== null && group_by !== undefined) {
    const groups: readonly unknown[] = Array.isArray(group_by)
      ? group_by
      : [group_by];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (
        g instanceof GroupBy &&
        (g.property instanceof CustomPropertyRef ||
          g.property instanceof InlineCustomProperty)
      ) {
        const gpath = groups.length > 1 ? `group_by[${String(i)}]` : "group_by";
        errors.push(..._validateCustomProperty(g.property, gpath));
      }
    }
  }

  // Scan where (filters) — skip FrequencyFilter instances (no _property)
  if (where !== null && where !== undefined) {
    const filters: readonly unknown[] = Array.isArray(where) ? where : [where];
    for (let i = 0; i < filters.length; i++) {
      const f = filters[i];
      if (f instanceof FrequencyFilter) {
        if (f.event_filters !== null && f.event_filters.length > 0) {
          for (let fi = 0; fi < f.event_filters.length; fi++) {
            const ef = f.event_filters[fi] as Filter;
            if (
              ef._property instanceof CustomPropertyRef ||
              ef._property instanceof InlineCustomProperty
            ) {
              const fpath = `where[${String(i)}].event_filters[${String(fi)}]`;
              errors.push(..._validateCustomProperty(ef._property, fpath));
            }
          }
        }
        continue;
      }
      if (
        f instanceof Filter &&
        (f._property instanceof CustomPropertyRef ||
          f._property instanceof InlineCustomProperty)
      ) {
        const fpath = filters.length > 1 ? `where[${String(i)}]` : "where";
        errors.push(..._validateCustomProperty(f._property, fpath));
      }
    }
  }

  // Scan events (Metric.property AND Metric.filters)
  if (events !== null && events !== undefined) {
    for (let idx = 0; idx < events.length; idx++) {
      const item = events[idx];
      if (item instanceof Metric) {
        if (
          item.property instanceof CustomPropertyRef ||
          item.property instanceof InlineCustomProperty
        ) {
          errors.push(
            ..._validateCustomProperty(item.property, `events[${String(idx)}]`),
          );
        }
        if (item.filters !== null && item.filters.length > 0) {
          errors.push(
            ..._scanFiltersForCustomProperties(
              item.filters,
              `events[${String(idx)}]`,
            ),
          );
        }
      }
    }
  }

  // Scan funnel steps (FunnelStep.filters) — instanceof-gated in source
  if (funnel_steps !== null && funnel_steps !== undefined) {
    for (let idx = 0; idx < funnel_steps.length; idx++) {
      const step = funnel_steps[idx];
      if (
        step instanceof FunnelStep &&
        step.filters !== null &&
        step.filters.length > 0
      ) {
        errors.push(
          ..._scanFiltersForCustomProperties(
            step.filters,
            `steps[${String(idx)}]`,
          ),
        );
      }
    }
  }

  // Scan flow steps (FlowStep.filters)
  if (flow_steps !== null && flow_steps !== undefined) {
    for (let idx = 0; idx < flow_steps.length; idx++) {
      const fstep = flow_steps[idx] as FlowStep;
      if (fstep.filters !== null && fstep.filters.length > 0) {
        errors.push(
          ..._scanFiltersForCustomProperties(
            fstep.filters,
            `steps[${String(idx)}]`,
          ),
        );
      }
    }
  }

  // Scan retention events (RetentionEvent.filters)
  // retention_events is always [born_event, return_event]
  if (retention_events !== null && retention_events !== undefined) {
    for (let idx = 0; idx < retention_events.length; idx++) {
      const rev = retention_events[idx] as RetentionEvent;
      if (rev.filters !== null && rev.filters.length > 0) {
        const label = idx === 0 ? "born_event" : "return_event";
        errors.push(..._scanFiltersForCustomProperties(rev.filters, label));
      }
    }
  }

  return errors;
}
