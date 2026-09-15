// `pythonFloatStr` — CPython `repr(float)`: shortest round-trip digits,
// exponent notation exactly when the decimal exponent is < -4 or >= 16, a
// two-digit zero-padded exponent, and a trailing ".0" on integral floats (bare
// `String(x)` gives "18" for 18.0). No Python test file behind this suite; the
// expected strings are CPython's and the fast-check properties are TS-only.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { pythonFloatStr } from "../../src/compat/python-float-str.js";

describe("pythonFloatStr — CPython repr(float) table", () => {
  const oracle: Array<[number, string]> = [
    // Integral floats keep ".0" (str(18.0) == "18.0"; JS String gives "18").
    [18.0, "18.0"],
    [-18.0, "-18.0"],
    [0.0, "0.0"],
    [2 ** 53, "9007199254740992.0"],
    // Fractional floats.
    [1.5, "1.5"],
    [0.1, "0.1"],
    [1 / 3, "0.3333333333333333"],
    [123456.789, "123456.789"],
    // Exponent-threshold window, high side: switch at decimal exponent 16.
    [1e15, "1000000000000000.0"],
    [9999999999999998.0, "9999999999999998.0"],
    [1e16, "1e+16"],
    // 9.999999999999999e15 rounds to the double 1e16 exactly.
    // eslint-disable-next-line no-loss-of-precision -- the rounding IS the test
    [9.999999999999999e15, "1e+16"],
    // eslint-disable-next-line no-loss-of-precision -- nearest double is ...156e16
    [1.7976931348623157e16, "1.7976931348623156e+16"],
    [1.2345678901234568e17, "1.2345678901234568e+17"],
    [1e21, "1e+21"],
    // Exponent-threshold window, low side: switch at decimal exponent -5.
    [1e-4, "0.0001"],
    [0.00012345, "0.00012345"],
    [1e-5, "1e-05"], // two-digit zero-padded exponent
    [-1e-5, "-1e-05"],
    [1e-6, "1e-06"],
    [2.5e-10, "2.5e-10"],
    [3.14159e-100, "3.14159e-100"],
    // Extremes: subnormal min and max double (exponent > 2 digits unpadded).
    [5e-324, "5e-324"],
    [1.7976931348623157e308, "1.7976931348623157e+308"],
  ];

  for (const [input, expected] of oracle) {
    it(`renders ${String(input)} as "${expected}"`, () => {
      expect(pythonFloatStr(input)).toBe(expected);
    });
  }

  it('renders negative zero as "-0.0" (sign-preserving; JS String(-0) is "0")', () => {
    expect(pythonFloatStr(-0)).toBe("-0.0");
  });

  it("renders non-finite values the way CPython repr does", () => {
    expect(pythonFloatStr(Number.POSITIVE_INFINITY)).toBe("inf");
    expect(pythonFloatStr(Number.NEGATIVE_INFINITY)).toBe("-inf");
    expect(pythonFloatStr(Number.NaN)).toBe("nan");
  });
});

/**
 * Slow reference implementation used by the fast-check properties.
 *
 * Independent construction: extracts the shortest-round-trip digits from
 * `String(x)` (the production code parses `Number.prototype.toExponential`
 * instead) and re-derives the CPython fixed/exponent formatting rules.
 *
 * @param value - Finite, nonzero, positive double.
 * @returns CPython `repr(float)` of `value`.
 */
function referenceFloatStr(value: number): string {
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text);
  if (match === null) {
    throw new Error(`reference parser cannot handle: ${text}`);
  }
  const intPart = match[1] ?? "";
  const fracPart = match[2] ?? "";
  const extraExponent = match[3] === undefined ? 0 : Number(match[3]);
  const combined = intPart + fracPart;
  const firstSignificant = combined.search(/[1-9]/);
  if (firstSignificant === -1) {
    throw new Error(`reference expects nonzero input, got: ${text}`);
  }
  const digits = combined.slice(firstSignificant).replace(/0+$/, "");
  const exponent = intPart.length - 1 - firstSignificant + extraExponent;
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
  const magnitude = String(Math.abs(exponent)).padStart(2, "0");
  return `${mantissa}e${sign}${magnitude}`;
}

describe("pythonFloatStr — fast-check properties", () => {
  const finiteDoubles = fc.double({ noNaN: true, noDefaultInfinity: true });
  // Float-relevant edge values plus the exponent-window boundaries.
  const edgeExamples: Array<[number]> = [
    [18.0],
    [1.5],
    [-0.0],
    [0.0],
    [1e15],
    [1e16],
    // eslint-disable-next-line no-loss-of-precision -- the rounding IS the test
    [9.999999999999999e15],
    [1e-4],
    [1e-5],
    [5e-324],
    [2 ** 53],
    [1.7976931348623157e308],
  ];

  /**
   * The reference rendering: signed zero spelled out, else the sign plus
   * the slow reference of the magnitude.
   *
   * @param x - A finite double.
   * @returns The expected `str(x)` text.
   */
  function expectedFloatStr(x: number): string {
    if (x === 0) {
      return Object.is(x, -0) ? "-0.0" : "0.0";
    }
    const sign = x < 0 ? "-" : "";
    return sign + referenceFloatStr(Math.abs(x));
  }

  it("matches the slow String(x)-based reference for all finite doubles", () => {
    fc.assert(
      fc.property(finiteDoubles, (x) => {
        expect(pythonFloatStr(x)).toBe(expectedFloatStr(x));
      }),
      { examples: edgeExamples },
    );
  });

  it("round-trips: Number(pythonFloatStr(x)) recovers x exactly (incl. -0)", () => {
    fc.assert(
      fc.property(finiteDoubles, (x) => {
        expect(Object.is(Number(pythonFloatStr(x)), x)).toBe(true);
      }),
      { examples: edgeExamples },
    );
  });

  it("always emits a CPython-shaped literal (dot in fixed form, signed 2+ digit exponent)", () => {
    fc.assert(
      fc.property(finiteDoubles, (x) => {
        expect(pythonFloatStr(x)).toMatch(
          /^-?(?:\d+\.\d+|\d(?:\.\d+)?e[+-]\d{2,})$/,
        );
      }),
      { examples: edgeExamples },
    );
  });

  it("uses exponent notation exactly when |x| >= 1e16 or |x| < 1e-4", () => {
    fc.assert(
      fc.property(finiteDoubles, (x) => {
        fc.pre(x !== 0);
        const magnitude = Math.abs(x);
        const usesExponent = pythonFloatStr(x).includes("e");
        expect(usesExponent).toBe(magnitude >= 1e16 || magnitude < 1e-4);
      }),
      { examples: edgeExamples },
    );
  });
});
