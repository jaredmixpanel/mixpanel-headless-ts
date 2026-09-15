/**
 * Python `int(str)` parse grammar (rulebook R11.3). Part of the
 * `pythonCompat` module (rulebook §11): ported once, first; consumed by
 * `Retry-After` parsing (B0-2 `_parse_retry_after`) and R4.12 lax
 * coercion. No other module re-derives this grammar.
 *
 * The traps this closes: JS `parseInt` silently accepts trailing junk and
 * radix prefixes; `Number()` accepts `"0x5"`, `""` (as 0), exponents, and
 * fraction forms — CPython `int()` rejects every one of those, while ALSO
 * accepting underscores between digits, non-ASCII decimal digits
 * (`int("٤٢") == 42`), and a Unicode whitespace surround.
 */
import { MixpanelHeadlessError } from "../errors.js";
import {
  ASCII_NUMERIC_WHITESPACE,
  DIGIT_GROUP,
  transformDecimalAndSpaceToAscii,
} from "./numeric-parse.js";

/** ASCII-level grammar after the Unicode fold: `WS* [+-]? DIGITS WS*`. */
const INT_GRAMMAR = new RegExp(
  `^[${ASCII_NUMERIC_WHITESPACE}]*([+-]?)(${DIGIT_GROUP})[${ASCII_NUMERIC_WHITESPACE}]*$`,
);

/** The canonicalizer's exact-integer bound: 2^53 - 1. */
const MAX_SAFE = 9007199254740991n;

/**
 * Build the invalid-literal rejection, mirroring CPython's message shape.
 *
 * @param text - The rejected input.
 * @returns The coded error (message text is out of contract, R5.4).
 */
function invalidLiteral(text: string): MixpanelHeadlessError {
  return new MixpanelHeadlessError(
    `invalid literal for int() with base 10: ${JSON.stringify(text)}`,
    "PY_INT_INVALID_LITERAL",
  );
}

/**
 * Parse a string exactly as CPython `int(str)` does (rulebook R11.3).
 *
 * Grammar (after the pinned Unicode digit/whitespace fold): optional
 * surrounding whitespace, one optional `+`/`-`, base-10 digits with
 * underscores strictly between digits. Rejects float forms (`"5.5"`),
 * radix prefixes (`"0x5"`), `""`, `"inf"`, `"nan"`.
 *
 * Deviation from CPython by design: CPython returns arbitrary-precision
 * ints; this port returns a JS `number` and REJECTS results beyond
 * ±(2^53 − 1) with a coded error (the canonicalizer's 2^53 policy, R4.5
 * — no B0 consumer can produce one legitimately; `Retry-After` is
 * clamped at 60 downstream).
 *
 * @param text - The string to parse.
 * @returns The parsed integer as a JS `number` (`-0` normalizes to `0`,
 *   matching Python `int`, which has no negative zero).
 * @throws MixpanelHeadlessError - Code `PY_INT_INVALID_LITERAL` when the
 *   input is not a valid CPython base-10 integer literal; code
 *   `PY_INT_UNSAFE_INTEGER` when the parsed magnitude exceeds 2^53 − 1.
 * @throws TypeError - When `text` is not a string.
 * @example
 * ```typescript
 * pythonInt("  1_5  "); // 15
 * pythonInt("٤٢"); // 42  (non-ASCII decimal digits)
 * pythonInt("0x5"); // throws PY_INT_INVALID_LITERAL
 * ```
 */
export function pythonInt(text: string): number {
  if (typeof text !== "string") {
    throw new TypeError(`pythonInt expects a string, got ${typeof text}`);
  }
  const folded = transformDecimalAndSpaceToAscii(text);
  const match = folded === null ? null : INT_GRAMMAR.exec(folded);
  if (match === null) {
    throw invalidLiteral(text);
  }
  const digits = (match[2] as string).replaceAll("_", "");
  const magnitude = BigInt(digits);
  if (magnitude > MAX_SAFE) {
    throw new MixpanelHeadlessError(
      `int literal magnitude exceeds 2^53 - 1 (canonicalizer policy R4.5): ${digits}`,
      "PY_INT_UNSAFE_INTEGER",
    );
  }
  const value = Number(magnitude);
  // Python int has no -0: "-0" parses to plain 0.
  return match[1] === "-" && value !== 0 ? -value : value;
}

/**
 * CPython `int(value)` over an ARBITRARY object — the coercion ladder
 * (as opposed to {@link pythonInt}, which is the `int(str)` grammar
 * alone). Added at B5-S3 (`b5-packets.md` §9 Caution #3: the replay
 * walker's `int(e.get("timestamp", 0))` and the analyzer's
 * `int(event.get("timestamp", 0))` must TRUNCATE floats toward zero and
 * route strings through the CPython grammar, never `Number()`).
 *
 * Ladder, in CPython's dispatch order:
 * - `bool` → `1` / `0` (checked BEFORE number: `int(True) == 1`);
 * - `int` / `float` → truncation toward zero (`int(-1.9) == -1`);
 *   non-finite floats raise, exactly as CPython does;
 * - `str` → {@link pythonInt};
 * - anything else → `TypeError`, like CPython's
 *   "int() argument must be a string... not 'X'".
 *
 * @param value - The value to coerce.
 * @returns The integer.
 * @throws MixpanelHeadlessError - Code `PY_INT_INVALID_LITERAL` /
 *   `PY_INT_UNSAFE_INTEGER` from the string grammar, or
 *   `PY_INT_NON_FINITE` for `inf` / `nan` floats (CPython raises
 *   `OverflowError` / `ValueError`; both are non-`TypeError` value
 *   failures and the code is the contract, R5.4).
 * @throws TypeError - For a non-coercible type.
 * @example
 * ```typescript
 * pythonIntCoerce(18.9); // 18
 * pythonIntCoerce(-1.9); // -1  (truncates toward zero, not Math.floor)
 * pythonIntCoerce("  42 "); // 42
 * ```
 */
export function pythonIntCoerce(value: unknown): number {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new MixpanelHeadlessError(
        `cannot convert non-finite float to integer: ${String(value)}`,
        "PY_INT_NON_FINITE",
      );
    }
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    return pythonInt(value);
  }
  throw new TypeError(
    `int() argument must be a string, a bytes-like object or a real number, not '${
      value === null ? "NoneType" : typeof value
    }'`,
  );
}
