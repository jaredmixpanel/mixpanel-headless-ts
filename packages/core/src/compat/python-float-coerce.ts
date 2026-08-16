/**
 * CPython `float(x)` coercion ladder over the non-string arms (rulebook
 * R11.7; B5-notes.md outbound ledger item 5 / b5-review-resolution.md
 * ASR-F6b). Part of the `pythonCompat` module (rulebook §11): ported
 * once, here; consumed by `FunnelQueryResult.overall_conversion_rate`
 * (the ledgered straggler site) and by any future `float(value)` twin
 * over an `Any`-typed payload value. The STRING arm delegates to
 * `pythonFloat` (R11.3) — no grammar is re-derived here (R10.8).
 *
 * The traps this closes: the pre-fix site used `floatValue(x) ?? 0.0`,
 * which returned `0.0` for `None`/lists/dicts where CPython raises
 * `TypeError`, and `0.0` for `True` where CPython returns `1.0`
 * (ratified Discrepancy #8: values inside `dict[str, Any]` interiors
 * are in-annotation, so their raises are contract).
 *
 * Every expected behavior was probed against CPython 3.14.6 on
 * 2026-08-16 (probe record: `context/phase3/notes/B6-notes.md`):
 * `float(True)` → `1.0`; `float(None)` → `TypeError "float() argument
 * must be a string or a real number, not 'NoneType'"` (list/dict spell
 * `'list'`/`'dict'`); `float(10**400)` → `OverflowError "int too large
 * to convert to float"`; `float("1e400")` → `inf` (string parse
 * saturates, int conversion raises).
 */
import { isPythonDict } from "./python-dict.js";
import { pythonFloat } from "./python-float.js";
// Import-free leaf module (its only exports are the minted builtin
// twins), so this compat module may import it without a layering cycle;
// the OverflowError twin exists ONCE there (R10.8).
import { OverflowError } from "../query/python-builtins.js";

/**
 * Whether a value is the rig's `$type: float` spelling wrapper (the
 * runner's `PyFloat`), duck-typed exactly like `floatValue`
 * (`types/results/result-base.ts`): integral-valued Python floats and
 * the non-finite constants ride rich payloads as tagged spellings.
 *
 * @param value - The candidate.
 * @returns `true` for an object carrying a string `spelling`.
 */
function isSpellingWrapper(value: object): value is { spelling: string } {
  return (
    "spelling" in value &&
    typeof (value as { spelling: unknown }).spelling === "string"
  );
}

/**
 * Coerce a payload value exactly as CPython `float(x)` does (R11.7).
 *
 * Arms, in ladder order:
 * - `number` → returned unchanged (`float(int)` / `float(float)`;
 *   non-finite doubles pass through — `float(inf)` is `inf`).
 * - `boolean` → `1.0` / `0.0` (`bool` is a real number in Python).
 * - `bigint` → the correctly-rounded double, or the `OverflowError`
 *   twin when the magnitude exceeds the double range (CPython
 *   `float(10**400)` raises; it never saturates an INT to infinity).
 * - `string` → `pythonFloat` (the full R11.3 CPython `float(str)`
 *   grammar, `PY_FLOAT_INVALID_LITERAL` on invalid literals).
 * - spelling wrapper (`{spelling: string}`, the rig float tag) → the
 *   spelling's value; an INTEGER spelling (no `.`/`e`) beyond double
 *   range raises the `OverflowError` twin (it denotes a Python int),
 *   while float spellings saturate exactly like CPython's float parse.
 * - `null`/`undefined`, arrays, and plain dicts → the CPython
 *   `TypeError` twin (`not 'NoneType'` / `'list'` / `'dict'`).
 * - anything else → the CPython `TypeError` twin with the JS
 *   constructor name (message text out of contract, R5.4).
 *
 * @param value - The payload value (`Any`-typed interior domain).
 * @returns The coerced double.
 * @throws TypeError - Where CPython `float(x)` raises `TypeError`.
 * @throws OverflowError - Where CPython raises `OverflowError` (int too
 *   large to convert to float).
 * @throws MixpanelHeadlessError - Code `PY_FLOAT_INVALID_LITERAL` from
 *   the string arm.
 *
 * @example
 * ```typescript
 * pythonFloatCoerce(true); // 1.0
 * pythonFloatCoerce("inf"); // Infinity
 * pythonFloatCoerce({ spelling: "18.0" }); // 18
 * pythonFloatCoerce(null); // throws TypeError (CPython wording)
 * ```
 */
export function pythonFloatCoerce(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1.0 : 0.0;
  }
  if (typeof value === "bigint") {
    const doubled = Number(value);
    if (!Number.isFinite(doubled)) {
      throw new OverflowError("int too large to convert to float");
    }
    return doubled;
  }
  if (typeof value === "string") {
    return pythonFloat(value);
  }
  if (value === null || value === undefined) {
    throw new TypeError(
      "float() argument must be a string or a real number, not 'NoneType'",
    );
  }
  if (Array.isArray(value)) {
    throw new TypeError(
      "float() argument must be a string or a real number, not 'list'",
    );
  }
  if (typeof value === "object" && isSpellingWrapper(value)) {
    const doubled = Number(value.spelling);
    if (
      !Number.isFinite(doubled) &&
      !/[.eE]|^(?:-?Infinity|NaN)$/.test(value.spelling)
    ) {
      // Integer spelling beyond double range: a Python INT, so the int
      // conversion rule applies (raise, never saturate).
      throw new OverflowError("int too large to convert to float");
    }
    return doubled;
  }
  if (isPythonDict(value)) {
    throw new TypeError(
      "float() argument must be a string or a real number, not 'dict'",
    );
  }
  throw new TypeError(
    "float() argument must be a string or a real number, not " +
      `'${(value as object).constructor?.name ?? "object"}'`,
  );
}
