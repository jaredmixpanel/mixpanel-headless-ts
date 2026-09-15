/**
 * D6 canonicalization algorithm — TS implementation.
 *
 * Normative spec: `docs/history/phase1/design/phase1-design.md` §D6 (Python
 * twin: `conformance/runner/canonical.py`). Both implementations must be
 * behaviorally identical; parity is verified by the shared
 * `canonical-selftest.json` pairs (D6/D12) executed by both suites.
 *
 * Given a JSON-like value, {@link canonicalize} produces a canonical JSON
 * string. Comparison between the two runners is string equality of the
 * canonical forms. The rules implemented here:
 *
 * 1.  Object keys sorted by Unicode CODEPOINT (not UTF-16 code units);
 *     absent key ≠ key:null — both preserved and compared distinctly.
 * 2.  Strings verbatim (no NFC/NFD), minimal-escape JSON form; lone
 *     surrogates rejected.
 * 3.  Numbers rendered from the RAW JSON NUMBER TOKEN ({@link JsonNumber}):
 *     integer tokens render without exponent/fraction; fraction/exponent
 *     tokens render via float rendering even when integral (`18.0` stays
 *     `"18.0"`).
 * 4.  Numeric-string normalization ONLY in segfilter number-filter operand
 *     positions (structural clause; R10.11).
 * 5.  Floats: ECMAScript `Number::toString` semantics; negative zero
 *     renders `"-0.0"`; `NaN`/`Infinity` are illegal.
 * 6.  Error objects: `message`/`suggestion`/`fix` dropped at KNOWN
 *     error-object levels only ({@link canonicalizeError}).
 * 10. `$type`-tagged inputs are ordinary objects here.
 * 11. bytes values are ordinary `$type`-tagged objects.
 *
 * Rules 7-9 (auth-header pattern match, header-key lowercasing, unordered
 * group sorting) are provided as the comparator helpers
 * {@link headersMatch} and {@link canonicalizeInteractions}, mirroring the
 * Python twin's `headers_match` / `canonicalize_interactions` exactly.
 */

import { codepoints } from "@mixpanel-headless/core";

import { isPlainObject } from "./internal/guards.js";
import { JsonNumber, type JsonValue } from "./json-value.js";

/** Error raised when a value cannot be canonicalized (illegal per D6). */
export class CanonicalizationError extends Error {
  /**
   * Create a canonicalization error.
   *
   * @param message - Description of the D6 rule violation.
   */
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

/**
 * Whether the value in an operand position is subject to numeric-string
 * normalization (D6 rule 4).
 *
 * - `"no"`: not an operand position.
 * - `"direct"`: the value AT `filter.operand` of a number-typed segfilter.
 * - `"element"`: an element of an array-valued `filter.operand`.
 */
type OperandPosition = "no" | "direct" | "element";

/** Traversal context threaded through the serializer. */
interface Context {
  /** Operand-position state for the CURRENT value (rule 4). */
  readonly operand: OperandPosition;
  /**
   * Whether the current OBJECT is the `filter` member of a number-typed
   * segfilter entry, i.e. its `operand` member is a normalization position.
   */
  readonly operandActive: boolean;
}

/** The inert context: no rule-4 position applies. */
const PLAIN_CONTEXT: Context = { operand: "no", operandActive: false };

/**
 * Produce the canonical JSON string for a value (D6).
 *
 * @param value - A JSON-like value. Numbers may be {@link JsonNumber} raw
 *   tokens (loaded vectors) or native `number`/`bigint` (live TS library
 *   outputs).
 * @returns The canonical UTF-8 JSON string.
 * @throws CanonicalizationError - On `NaN`/`Infinity`, lone surrogates,
 *   float-token overflow, `undefined` array elements, or non-JSON values.
 * @example
 * ```typescript
 * canonicalize({ b: new JsonNumber("18.0"), a: null });
 * // '{"a":null,"b":18.0}'
 * ```
 */
export function canonicalize(value: JsonValue): string {
  return serialize(value, PLAIN_CONTEXT);
}

/**
 * Canonicalize an `expect.error` value with rule-6 advisory stripping.
 *
 * Drops `message`, `suggestion`, and `fix` at KNOWN ERROR-OBJECT LEVELS
 * ONLY: the top-level error object and each element of its `errors[]`
 * array. NEVER recursive — a server body embedded at
 * `details_contain.response_body` may legitimately contain a `message`
 * member that IS wire data and must survive.
 *
 * @param value - The error value (typically an object with `class`,
 *   `code`, `errors`, `details_contain`, ...).
 * @returns The canonical JSON string of the stripped value.
 * @throws CanonicalizationError - Propagated from {@link canonicalize}.
 * @example
 * ```typescript
 * canonicalizeError({ class: "E", message: "gone", errors: [] });
 * // '{"class":"E","errors":[]}'
 * ```
 */
export function canonicalizeError(value: JsonValue): string {
  return canonicalize(stripAdvisoryKeys(value));
}

/** Advisory keys excluded from error comparison (R5.4 / D6 rule 6). */
const ADVISORY_KEYS = ["message", "suggestion", "fix"] as const;

/**
 * Apply rule-6 stripping to an error value (non-recursive, known levels).
 *
 * @param value - The raw error value.
 * @returns A copy with advisory keys removed at the top level and inside
 *   each object element of `errors[]`; non-object inputs pass through.
 */
function stripAdvisoryKeys(value: JsonValue): JsonValue {
  if (!isPlainObject(value)) {
    return value;
  }
  const top: Record<string, JsonValue> = {};
  for (const [key, member] of Object.entries(value)) {
    if ((ADVISORY_KEYS as readonly string[]).includes(key)) {
      continue;
    }
    top[key] = member;
  }
  const errors = top["errors"];
  if (Array.isArray(errors)) {
    top["errors"] = errors.map((element) => {
      if (!isPlainObject(element)) {
        return element;
      }
      const stripped: Record<string, JsonValue> = {};
      for (const [key, member] of Object.entries(element)) {
        if ((ADVISORY_KEYS as readonly string[]).includes(key)) {
          continue;
        }
        stripped[key] = member;
      }
      return stripped;
    });
  }
  return top;
}

/**
 * Serialize any value to canonical JSON under a traversal context.
 *
 * @param value - The value to serialize.
 * @param context - Rule-4 operand-position state.
 * @returns Canonical JSON text for `value`.
 * @throws CanonicalizationError - On illegal values (see
 *   {@link canonicalize}).
 */
function serialize(value: JsonValue, context: Context): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    const normalized =
      context.operand === "no" ? value : normalizeNumericString(value);
    return escapeJsonString(normalized);
  }
  if (typeof value === "number") {
    return renderNativeNumber(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof JsonNumber) {
    return renderNumberToken(value);
  }
  if (Array.isArray(value)) {
    return serializeArray(value, context);
  }
  if (isPlainObject(value)) {
    return serializeObject(value, context);
  }
  throw new CanonicalizationError(
    `value is not JSON-canonicalizable: ${describe(value)}`,
  );
}

/**
 * Serialize an array, propagating rule-4 element positions.
 *
 * When the array itself sits at a `filter.operand` normalization position
 * (`operand: "direct"`), each ELEMENT becomes an `"element"` position;
 * nesting deeper than one level is never normalized (D6 rule 4 names
 * "element of `filter.operand` when it is an array" only).
 *
 * @param value - The array to serialize.
 * @param context - Rule-4 state for the array itself.
 * @returns Canonical JSON text.
 * @throws CanonicalizationError - If an element is `undefined` or illegal.
 */
function serializeArray(value: JsonValue[], context: Context): string {
  const elementContext: Context =
    context.operand === "direct"
      ? { operand: "element", operandActive: false }
      : PLAIN_CONTEXT;
  const parts: string[] = [];
  // Widened on purpose: live outputs from the library under test are
  // untyped, and a stray `undefined` must fail loudly here rather than
  // serialize as the token `undefined` and surface as a puzzling diff.
  const elements: ReadonlyArray<JsonValue | undefined> = value;
  for (const element of elements) {
    if (element === undefined) {
      throw new CanonicalizationError("array elements must not be undefined");
    }
    parts.push(serialize(element, elementContext));
  }
  return `[${parts.join(",")}]`;
}

/**
 * Serialize an object with codepoint-sorted keys (rule 1) and rule-4
 * position detection.
 *
 * Rule 4's structural clause: an object with
 * `selected_property_type: "number"` marks its object-valued `filter`
 * member as operand-active; inside that filter object, the `operand`
 * member is a normalization position. `undefined`-valued members are
 * treated as ABSENT (matching `JSON.stringify` for live TS outputs);
 * explicit `null` is preserved (absent ≠ null).
 *
 * @param value - The object to serialize.
 * @param context - Rule-4 state for this object.
 * @returns Canonical JSON text.
 * @throws CanonicalizationError - Propagated from member serialization.
 */
function serializeObject(
  value: Record<string, JsonValue>,
  context: Context,
): string {
  const qualifies =
    value["selected_property_type"] === "number" &&
    isPlainObject(value["filter"]);
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort(compareCodePoints);
  const parts: string[] = [];
  for (const key of keys) {
    const member = value[key] as JsonValue;
    const memberContext: Context = {
      operand: context.operandActive && key === "operand" ? "direct" : "no",
      operandActive: qualifies && key === "filter",
    };
    parts.push(`${escapeJsonString(key)}:${serialize(member, memberContext)}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * Render a raw JSON number token canonically (D6 rule 3).
 *
 * Integer tokens (no fraction/exponent) render as exact integers via
 * `BigInt` (normalizing `-0` to `0`, preserving digits above 2^53).
 * Fraction/exponent tokens render via float rendering even when integral.
 *
 * @param token - The raw number token.
 * @returns Canonical number text.
 * @throws CanonicalizationError - If a float token overflows to infinity.
 */
function renderNumberToken(token: JsonNumber): string {
  if (token.isIntegerToken()) {
    return BigInt(token.raw).toString();
  }
  const value = token.toNumber();
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError(
      `float token overflows a double: ${token.raw}`,
    );
  }
  return renderCanonicalFloat(value);
}

/**
 * Render a native JS number canonically.
 *
 * Live TS library outputs carry no int/float token distinction, so
 * integral doubles (other than `-0`) render as integers and everything
 * else as floats.
 *
 * @param value - The native number.
 * @returns Canonical number text.
 * @throws CanonicalizationError - On `NaN` or `Infinity` (illegal, rule 5).
 */
function renderNativeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError(
      `NaN/Infinity are illegal in canonical JSON: ${String(value)}`,
    );
  }
  if (Number.isInteger(value) && !Object.is(value, -0)) {
    return BigInt(value).toString();
  }
  return renderCanonicalFloat(value);
}

/**
 * Magnitude at which Python `repr(float)` switches to exponent form.
 *
 * Below this, integral floats carry Python's `<digits>.0` marker (D6 rule
 * 3: `18.0` stays `"18.0"`); at or above it the Python twin renders via
 * its repr-exponent → ECMAScript conversion, which produces the plain
 * `String(x)` form with NO `.0` marker (e.g. `1e16` →
 * `"10000000000000000"`). Mirrors `_JS_PLAIN_INTEGRAL_LIMIT` in
 * `conformance/runner/canonical.py`.
 */
const JS_PLAIN_INTEGRAL_LIMIT = 1e16;

/**
 * Canonical float rendering (D6 rules 3/5).
 *
 * ECMAScript `Number::toString` semantics (shortest round-trip, JS
 * exponent thresholds and exponent formatting) with two D6 adjustments
 * mirroring the Python twin (`repr` + exponent-form conversion):
 * negative zero renders sign-preserving as `"-0.0"` (ECMAScript
 * `String(-0)` is `"0"`), and an integral double BELOW the Python
 * exponent threshold (1e16) gains a trailing `".0"` so float-token
 * provenance survives (`18.0` stays `"18.0"`, D6 rule 3). At or above
 * the threshold no `.0` marker exists in either language.
 *
 * @param value - A finite double reached via a float position.
 * @returns Canonical float text.
 * @example
 * ```typescript
 * renderCanonicalFloat(18); // "18.0"
 * renderCanonicalFloat(1e16); // "10000000000000000"  (no .0 marker)
 * renderCanonicalFloat(1e-7); // "1e-7"  (Python repr would be "1e-07")
 * renderCanonicalFloat(-0); // "-0.0"
 * ```
 */
export function renderCanonicalFloat(value: number): string {
  if (Object.is(value, -0)) {
    return "-0.0";
  }
  const text = String(value);
  if (Number.isInteger(value) && Math.abs(value) < JS_PLAIN_INTEGRAL_LIMIT) {
    return `${text}.0`;
  }
  return text;
}

/**
 * Rule-4 numeric-string normalization for segfilter number-filter
 * operands.
 *
 * Parses the string with the PYTHON float grammar (underscore grouping,
 * optional leading/trailing whitespace, `inf`/`infinity`/`nan`, forms like
 * `"1."`/`".5"`/`"1.e3"`). Strings that do not parse — OR that parse to a
 * non-finite value (`"inf"`/`"nan"` spellings, overflowing exponents) —
 * are returned UNCHANGED (no normalization; rendering non-finite values
 * is illegal under rule 5, mirroring the Python twin's `None` return).
 * Parsed finite values render via the rule-5 form
 * ({@link renderCanonicalFloat}) with the trailing `".0"` marker stripped
 * (int-collapse: `"18.0"` → `"18"`, `"-0.0"` → `"-0"`, `"18.50"` →
 * `"18.5"`).
 *
 * @param value - The operand-position string.
 * @returns The normalized string, or `value` verbatim when unparseable
 *   or non-finite.
 * @example
 * ```typescript
 * normalizeNumericString("18.0"); // "18"
 * normalizeNumericString("18.50"); // "18.5"
 * normalizeNumericString("inf"); // "inf" (unchanged)
 * normalizeNumericString("not a number"); // "not a number"
 * ```
 */
export function normalizeNumericString(value: string): string {
  const parsed = parsePythonFloat(value);
  if (parsed === undefined || !Number.isFinite(parsed)) {
    return value;
  }
  const rendered = renderCanonicalFloat(parsed);
  return rendered.endsWith(".0") ? rendered.slice(0, -2) : rendered;
}

/**
 * Characters Python `str.strip()` removes (`str.isspace()` set), used by
 * `float(str)` before parsing.
 */
const PYTHON_WHITESPACE =
  "\t\n\u000B\f\r\u001C\u001D\u001E\u001F \u0085\u00A0\u1680" +
  "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A" +
  "\u2028\u2029\u202F\u205F\u3000";

/** Matches Python-strippable whitespace at both ends of a string. */
const PYTHON_TRIM = new RegExp(
  `^[${PYTHON_WHITESPACE}]+|[${PYTHON_WHITESPACE}]+$`,
  "g",
);

/** Python `float()` grammar: infinities and NaN (case-insensitive). */
const PYTHON_INF_NAN = /^[+-]?(?:inf(?:inity)?|nan)$/i;

/**
 * Python `float()` grammar: decimal forms with optional underscore digit
 * grouping (underscores only BETWEEN digits) and optional exponent.
 * Accepts `"1."`, `".5"`, `"1.e3"`, `"1_0.5"`; rejects `"_1"`, `"1_"`,
 * `"1__0"`, `"."`, `"e3"`.
 */
const PYTHON_FLOAT =
  /^[+-]?(?:(?:\d(?:_?\d)*)?\.\d(?:_?\d)*|\d(?:_?\d)*\.?)(?:[eE][+-]?\d(?:_?\d)*)?$/;

/**
 * Parse a string exactly as Python `float(str)` would.
 *
 * @param text - The candidate numeric string.
 * @returns The parsed double (possibly `NaN`/`Infinity` for `nan`/`inf`
 *   spellings or overflow), or `undefined` when Python would raise
 *   `ValueError`.
 */
function parsePythonFloat(text: string): number | undefined {
  const trimmed = text.replaceAll(PYTHON_TRIM, "");
  if (trimmed === "") {
    return undefined;
  }
  if (PYTHON_INF_NAN.test(trimmed)) {
    const negative = trimmed.startsWith("-");
    if (/nan$/i.test(trimmed)) {
      return Number.NaN;
    }
    return negative ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  if (!PYTHON_FLOAT.test(trimmed)) {
    return undefined;
  }
  return Number(trimmed.replaceAll("_", ""));
}

/**
 * Escape a string as minimal-escape JSON (D6 rule 2), rejecting lone
 * surrogates.
 *
 * Minimal-escape form: only `"` , `\` and control characters are escaped
 * (short escapes `\b\t\n\f\r` where they exist, `\u00XX` otherwise);
 * non-ASCII text is emitted verbatim (no NFC/NFD change). This matches
 * both `JSON.stringify` and Python `json.dumps(ensure_ascii=False)`.
 *
 * @param value - The string to escape.
 * @returns The quoted, escaped JSON string token.
 * @throws CanonicalizationError - If `value` contains a lone surrogate
 *   (illegal in vectors; UTF-8 cannot encode it — D6 rule 2).
 */
function escapeJsonString(value: string): string {
  for (const ch of value) {
    const code = ch.codePointAt(0) as number;
    if (code >= 0xd800 && code <= 0xdfff) {
      throw new CanonicalizationError(
        `lone surrogate U+${code.toString(16).toUpperCase()} is illegal in vectors`,
      );
    }
  }
  return JSON.stringify(value);
}

/**
 * Compare two strings by Unicode CODEPOINT order (rule 1).
 *
 * Differs from the default UTF-16 code-unit comparison for astral
 * characters (U+10000 and above) vs the U+E000..U+FFFF range (Python
 * `sorted()` compares by codepoint, so the two sides must share this
 * order).
 *
 * @param a - Left key.
 * @param b - Right key.
 * @returns Negative, zero, or positive per standard comparator contract.
 */
function compareCodePoints(a: string, b: string): number {
  const aPoints = codepoints(a);
  const bPoints = codepoints(b);
  const length = Math.min(aPoints.length, bPoints.length);
  for (let i = 0; i < length; i += 1) {
    const ac = (aPoints[i] as string).codePointAt(0) as number;
    const bc = (bPoints[i] as string).codePointAt(0) as number;
    if (ac !== bc) {
      return ac - bc;
    }
  }
  return aPoints.length - bPoints.length;
}

/**
 * Compare captured request headers against `headers_contain` (D6 rules
 * 7-8; mirror of the Python twin's `headers_match`).
 *
 * Subset semantics per the vector schema: ONLY listed headers are
 * compared; headers present in `actualHeaders` but absent from
 * `headersContain` are ignored (the D5.6 allowlist means transport-added
 * headers never appear in vectors, and a selftest case proves the ignore
 * behavior on both sides). Keys are lowercased on both sides before
 * comparison (rule 8); a `{"pattern": ...}` expected value (always used
 * for `authorization`, D5.2) is matched as an unanchored regex against
 * the actual value (rule 7), and plain-string expected values compare by
 * equality (case-sensitive values, case-insensitive keys).
 *
 * @param headersContain - The vector's expected-header object; values are
 *   strings or `{"pattern": <regex>}` objects.
 * @param actualHeaders - The headers captured from the replayed request.
 * @returns `true` when every listed header is present and matches.
 * @throws CanonicalizationError - If an expected value is neither a
 *   string nor a `{"pattern": ...}` object (malformed vector).
 */
export function headersMatch(
  headersContain: Record<string, JsonValue>,
  actualHeaders: Record<string, string>,
): boolean {
  const actualLower = new Map<string, string>();
  for (const [key, member] of Object.entries(actualHeaders)) {
    actualLower.set(key.toLowerCase(), member);
  }
  for (const [key, expected] of Object.entries(headersContain)) {
    const actual = actualLower.get(key.toLowerCase());
    if (actual === undefined) {
      return false;
    }
    if (typeof expected === "string") {
      if (actual !== expected) {
        return false;
      }
      continue;
    }
    if (isPlainObject(expected) && typeof expected["pattern"] === "string") {
      if (!new RegExp(expected["pattern"]).test(actual)) {
        return false;
      }
      continue;
    }
    throw new CanonicalizationError(
      `malformed headers_contain value for ${JSON.stringify(key)}`,
    );
  }
  return true;
}

/**
 * Canonicalize an interaction list after the rule-9 group sort (D6.9;
 * mirror of the Python twin's `canonicalize_interactions`).
 *
 * Interactions WITHOUT `unordered_group` keep their positions; members
 * sharing a group id are reordered among the positions the group
 * occupies, sorted (stably, by codepoint order) on the canonical
 * `(method, path, params)` key — the identical sort `emit.py` applies at
 * write time, so comparing two sequences canonicalized here is
 * order-insensitive exactly within groups.
 *
 * @param interactions - Serialized interaction objects in observed order
 *   (loaded vectors carry {@link JsonNumber} leaves; live captures carry
 *   native numbers — both group-id spellings are unified).
 * @returns The canonical JSON string of the group-sorted interaction
 *   list.
 * @throws CanonicalizationError - If any interaction violates the
 *   canonicalization rules.
 */
export function canonicalizeInteractions(interactions: JsonValue[]): string {
  const result: JsonValue[] = [...interactions];
  const groups = new Map<string, number[]>();
  for (const [position, interaction_] of interactions.entries()) {
    const interaction = interaction_;
    if (!isPlainObject(interaction)) {
      continue;
    }
    const key = groupIdKey(interaction["unordered_group"]);
    if (key !== undefined) {
      const members = groups.get(key) ?? [];
      members.push(position);
      groups.set(key, members);
    }
  }
  for (const positions of groups.values()) {
    const members = positions
      .map((position) => interactions[position] as JsonValue)
      .sort((a, b) =>
        compareCodePoints(interactionSortKey(a), interactionSortKey(b)),
      );
    for (const [index, position] of positions.entries()) {
      result[position] = members[index] as JsonValue;
    }
  }
  return canonicalize(result);
}

/**
 * Unify an `unordered_group` id into a map key (integers only).
 *
 * Mirrors the Python twin's `isinstance(group, int) and not bool` check:
 * integer {@link JsonNumber} tokens, native integral numbers, and
 * bigints qualify; booleans, floats, and everything else do not.
 *
 * @param group - The raw `unordered_group` member value.
 * @returns A canonical integer key string, or `undefined` when the value
 *   is not an integer group id.
 */
function groupIdKey(group: JsonValue | undefined): string | undefined {
  if (group instanceof JsonNumber && group.isIntegerToken()) {
    return BigInt(group.raw).toString();
  }
  if (typeof group === "number" && Number.isInteger(group)) {
    return BigInt(group).toString();
  }
  if (typeof group === "bigint") {
    return group.toString();
  }
  return undefined;
}

/**
 * Compute the canonical `(method, path, params)` key of an interaction
 * (D2/D6 rule 9), mirroring the Python twin's `_interaction_sort_key`.
 *
 * @param interaction - A serialized interaction object.
 * @returns Canonical JSON of the request's method/path/params triple
 *   (absent members become `null`).
 */
function interactionSortKey(interaction: JsonValue): string {
  const request = isPlainObject(interaction)
    ? interaction["request"]
    : undefined;
  const requestMap = isPlainObject(request) ? request : {};
  return canonicalize([
    requestMap["method"] ?? null,
    requestMap["path"] ?? null,
    requestMap["params"] ?? null,
  ]);
}

/**
 * Describe a non-canonicalizable value for error messages.
 *
 * @param value - The offending value.
 * @returns A short human-readable description.
 */
function describe(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  const name =
    proto && "constructor" in proto
      ? ((proto.constructor as { name?: string }).name ?? typeof value)
      : typeof value;
  return name;
}
