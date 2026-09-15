/**
 * CPython `repr(float)` / `str(float)` semantics, implemented once here.
 *
 * CPython renders a float from its shortest-round-trip decimal digits and
 * switches to exponent notation exactly when the decimal exponent is
 * `< -4` or `>= 16`; the exponent is always signed and zero-padded to at
 * least two digits, and integral floats in fixed notation keep a trailing
 * `".0"`. ECMAScript `String(n)` differs on all three points (window is
 * `<= -7` / `>= 21`, exponent unpadded, no `".0"`), which is why this
 * module exists.
 */

/**
 * Regular expression decomposing `Number.prototype.toExponential()` output
 * into leading digit, optional fraction digits, and signed exponent.
 */
const EXPONENTIAL_FORM = /^(\d)(?:\.(\d+))?e([+-]\d+)$/;

/**
 * Render a JS double exactly as CPython `repr(float)` would.
 *
 * @param value - Any double, including `-0`, `NaN` and the infinities.
 * @returns The CPython rendering: shortest round-trip digits; fixed
 *   notation with a mandatory decimal point (integral floats gain `".0"`)
 *   while the decimal exponent lies in `[-4, 16)`; otherwise exponent
 *   notation with a signed, two-digit zero-padded exponent. Non-finite
 *   values render as `"inf"`, `"-inf"` and `"nan"`; negative zero renders
 *   sign-preserving as `"-0.0"`.
 * @example
 * ```typescript
 * pythonFloatStr(18.0); // "18.0"  (JS String(18.0) is "18")
 * pythonFloatStr(1e16); // "1e+16" (JS String(1e16) is "10000000000000000")
 * pythonFloatStr(1e-5); // "1e-05" (two-digit zero-padded exponent)
 * pythonFloatStr(-0); // "-0.0"   (JS String(-0) is "0")
 * ```
 */
export function pythonFloatStr(value: number): string {
  if (Number.isNaN(value)) {
    return "nan";
  }
  if (value === Number.POSITIVE_INFINITY) {
    return "inf";
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return "-inf";
  }
  const negative = value < 0 || Object.is(value, -0);
  const magnitude = Math.abs(value);
  const body = magnitude === 0 ? "0.0" : formatPositive(magnitude);
  return negative ? `-${body}` : body;
}

/**
 * Format a finite, strictly positive double per the CPython float-repr
 * rules.
 *
 * The shortest-round-trip digit sequence is obtained from
 * `Number.prototype.toExponential()` with no argument, which the
 * ECMAScript spec defines as the fewest significand digits that uniquely
 * identify the double (ties to even) — the same digit selection CPython's
 * float repr performs.
 *
 * @param magnitude - A finite double with `magnitude > 0`.
 * @returns The CPython rendering of `magnitude` (no sign handling).
 * @throws {@link Error} - If `toExponential()` output does not match the expected
 *   grammar (unreachable for positive finite doubles; defensive guard).
 */
function formatPositive(magnitude: number): string {
  const exponential = magnitude.toExponential();
  const match = EXPONENTIAL_FORM.exec(exponential);
  if (match === null) {
    throw new Error(`unexpected toExponential() output: ${exponential}`);
  }
  const digits = (match[1] ?? "") + (match[2] ?? "");
  const exponent = Number(match[3] ?? "0");
  if (exponent >= -4 && exponent < 16) {
    if (exponent < 0) {
      return `0.${"0".repeat(-exponent - 1)}${digits}`;
    }
    if (digits.length <= exponent + 1) {
      return `${digits.padEnd(exponent + 1, "0")}.0`;
    }
    return `${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`;
  }
  const mantissa =
    digits.length > 1 ? `${digits.slice(0, 1)}.${digits.slice(1)}` : digits;
  const sign = exponent < 0 ? "-" : "+";
  const absoluteExponent = String(Math.abs(exponent)).padStart(2, "0");
  return `${mantissa}e${sign}${absoluteExponent}`;
}
