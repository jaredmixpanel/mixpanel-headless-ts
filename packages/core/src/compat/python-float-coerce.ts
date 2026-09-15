/**
 * CPython `float(x)` coercion ladder over the non-string arms; the string
 * arm delegates to `pythonFloat`. Consumed where a `float(value)` is
 * applied to an `Any`-typed payload value
 * (`FunnelQueryResult.overall_conversion_rate`).
 *
 * The trap this closes: a `floatValue(x) ?? 0.0` shortcut returns `0.0`
 * for `None`/lists/dicts where CPython raises `TypeError`, and `0.0` for
 * `True` where CPython returns `1.0`. Values inside `dict[str, Any]`
 * interiors are in-annotation, so those raises are contract. Probed
 * against CPython 3.14.6: `float(True)` is `1.0`; `float(None)` raises
 * `TypeError` naming `'NoneType'` (lists and dicts spell `'list'` and
 * `'dict'`); `float(10**400)` raises `OverflowError`; `float("1e400")`
 * saturates to `inf` (the string parse saturates, int conversion raises).
 */
// `python-builtins.ts` is an import-free leaf, so importing it here creates
// no layering cycle; the OverflowError twin exists once, there.
import { OverflowError } from "./python-builtins.js";
import { isPythonDict } from "./python-dict.js";
import { pythonFloat } from "./python-float.js";

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
  return "spelling" in value && typeof value.spelling === "string";
}

/**
 * Coerce a payload value exactly as CPython `float(x)` does.
 *
 * Arms, in ladder order:
 * - `number` → returned unchanged (`float(int)` / `float(float)`;
 *   non-finite doubles pass through — `float(inf)` is `inf`).
 * - `boolean` → `1.0` / `0.0` (`bool` is a real number in Python).
 * - `bigint` → the correctly-rounded double, or the `OverflowError`
 *   twin when the magnitude exceeds the double range (CPython
 *   `float(10**400)` raises; it never saturates an int to infinity).
 * - `string` → `pythonFloat` (the full CPython `float(str)`
 *   grammar, `PY_FLOAT_INVALID_LITERAL` on invalid literals).
 * - spelling wrapper (`{spelling: string}`, the rig float tag) → the
 *   spelling's value; an integer spelling (no `.`/`e`) beyond double
 *   range raises the `OverflowError` twin (it denotes a Python int),
 *   while float spellings saturate exactly like CPython's float parse.
 * - `null`/`undefined`, arrays, and plain dicts → the CPython
 *   `TypeError` twin (`not 'NoneType'` / `'list'` / `'dict'`).
 * - anything else → the CPython `TypeError` twin with the JS
 *   constructor name (message text is not part of the contract).
 *
 * @param value - The payload value (`Any`-typed interior domain).
 * @returns The coerced double.
 * @throws {@link TypeError} - Where CPython `float(x)` raises `TypeError`.
 * @throws {@link OverflowError} - Where CPython raises `OverflowError` (int too
 *   large to convert to float).
 * @throws {@link MixpanelHeadlessError} - Code `PY_FLOAT_INVALID_LITERAL` from
 *   the string arm.
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
      // Integer spelling beyond double range: a Python int, so the int
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
      `'${(value as { constructor?: { name?: string } }).constructor?.name ?? "object"}'`,
  );
}
