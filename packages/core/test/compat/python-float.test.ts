// B0-1: tests written FIRST from R11.3 semantics. Every expected
// value below was produced by CPython 3.14.6 `float(str)` (the oracle) on
// 2026-08-15; the parse-grammar probes are recorded in
// docs/history/phase3/notes/B0-notes.md (Python repo).
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { pythonFloat } from "../../src/compat/python-float.js";
import { pythonFloatStr } from "../../src/compat/python-float-str.js";
import { MixpanelHeadlessError } from "../../src/errors.js";

/**
 * Assert `pythonFloat` rejects `text` with `PY_FLOAT_INVALID_LITERAL`.
 *
 * @param text - The input under test.
 */
function expectRejects(text: string): void {
  let thrown: unknown;
  try {
    pythonFloat(text);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(MixpanelHeadlessError);
  expect((thrown as MixpanelHeadlessError).code).toBe(
    "PY_FLOAT_INVALID_LITERAL",
  );
}

describe("pythonFloat — decimal and exponent grammar (CPython float(str))", () => {
  it("parses plain decimal forms", () => {
    expect(pythonFloat("1.5")).toBe(1.5);
    expect(pythonFloat("42")).toBe(42);
    expect(pythonFloat("0.0001")).toBe(0.0001);
  });

  it("parses dangling-dot and leading-dot forms", () => {
    expect(pythonFloat(".5")).toBe(0.5);
    expect(pythonFloat("5.")).toBe(5);
    expect(pythonFloat("1.")).toBe(1);
    expect(pythonFloat("1.e1")).toBe(10);
    expect(pythonFloat(".5e1")).toBe(5);
  });

  it("rejects a bare dot and dot-exponent with no digits", () => {
    expectRejects(".");
    expectRejects("+.");
    expectRejects(".e1");
    expectRejects("e5");
  });

  it("parses exponents in either case with optional signs", () => {
    expect(pythonFloat("1e5")).toBe(1e5);
    expect(pythonFloat("1E5")).toBe(1e5);
    expect(pythonFloat("+1e+5")).toBe(1e5);
    expect(pythonFloat("2e-3")).toBe(0.002);
  });

  it("rejects incomplete exponents and float-in-exponent", () => {
    expectRejects("1e");
    expectRejects("1e+");
    expectRejects("5e5.5");
  });

  it("preserves negative zero", () => {
    expect(Object.is(pythonFloat("-0.0"), -0)).toBe(true);
    expect(Object.is(pythonFloat("-0"), -0)).toBe(true);
  });

  it("rejects the empty string, bare signs, and non-numeric text", () => {
    expectRejects("");
    expectRejects(" ");
    expectRejects("+");
    expectRejects("-");
    expectRejects("abc");
    expectRejects("0x5");
    expectRejects("0b1");
    expectRejects("1j");
    expectRejects("𝒳"); // R10.9 non-BMP edge
  });
});

describe("pythonFloat — inf/nan spellings (case-insensitive, signed)", () => {
  it("accepts inf and infinity in any casing", () => {
    expect(pythonFloat("inf")).toBe(Infinity);
    expect(pythonFloat("Infinity")).toBe(Infinity);
    expect(pythonFloat("-iNf")).toBe(-Infinity);
    expect(pythonFloat("+INFINITY")).toBe(Infinity);
    expect(pythonFloat(" inf ")).toBe(Infinity);
  });

  it("accepts nan in any casing with either sign", () => {
    expect(Number.isNaN(pythonFloat("nan"))).toBe(true);
    expect(Number.isNaN(pythonFloat("+nAn"))).toBe(true);
    expect(Number.isNaN(pythonFloat("-nan"))).toBe(true);
  });

  it("rejects prefixes and overruns of the special spellings", () => {
    expectRejects("in");
    expectRejects("infinit");
    expectRejects("infinityy");
    expectRejects("nans");
  });

  it("overflows to signed infinity exactly like CPython (never an error)", () => {
    expect(pythonFloat("1e400")).toBe(Infinity);
    expect(pythonFloat("-1e400")).toBe(-Infinity);
  });
});

describe("pythonFloat — underscores (between digits only)", () => {
  it("accepts underscores between digits in every component", () => {
    expect(pythonFloat("1_0")).toBe(10);
    expect(pythonFloat("1_0.5")).toBe(10.5);
    expect(pythonFloat("1_0e1_0")).toBe(1e11);
    expect(pythonFloat("1e5_0")).toBe(1e50);
  });

  it("rejects misplaced underscores", () => {
    expectRejects("1__0");
    expectRejects("_1.5");
    expectRejects("1_.5");
    expectRejects("1._5");
    expectRejects("1.5_");
    expectRejects("1.5e_5");
    expectRejects("1_");
  });
});

describe("pythonFloat — Unicode digits and whitespace (pinned tables)", () => {
  it("parses non-ASCII decimal digits in mantissa and exponent", () => {
    expect(pythonFloat("٤٢")).toBe(42);
    expect(pythonFloat("١٢.٣٤")).toBe(12.34);
    expect(pythonFloat("١e٢")).toBe(100);
    expect(pythonFloat("𝟙.𝟝")).toBe(1.5); // non-BMP digits
  });

  it("strips the numeric whitespace set but not U+001C..U+001F or U+FEFF", () => {
    expect(pythonFloat("\t1.5\n")).toBe(1.5);
    expect(pythonFloat("\u00A01.5\u3000")).toBe(1.5);
    expectRejects("\u001C1.5\u001F");
    expectRejects("\uFEFF1.5");
  });

  it("rejects interior whitespace", () => {
    expectRejects("1 .5");
  });
});

describe("pythonFloat — properties (fast-check)", () => {
  it("round-trips every finite double through CPython repr (pythonFloatStr)", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (x) => {
        expect(pythonFloat(pythonFloatStr(x))).toBe(x);
      }),
    );
  });

  it("round-trips every finite double through ECMAScript String()", () => {
    // -0 excluded: String(-0) is "0" (sign lost BEFORE the parse); the
    // "-0.0" spelling itself is covered by the grammar suite above.
    fc.assert(
      fc.property(
        fc
          .double({ noNaN: true, noDefaultInfinity: true })
          .filter((x) => !Object.is(x, -0)),
        (x) => {
          expect(pythonFloat(String(x))).toBe(x);
        },
      ),
    );
  });

  it("is whitespace-wrap invariant over the pinned numeric set", () => {
    const ws = fc.constantFrom("", " ", "\t", "\u0085", "\u00A0", "\u2003");
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        ws,
        ws,
        (x, left, right) => {
          // pythonFloatStr preserves the "-0.0" sign, so the wrap
          // invariance holds for every finite double including -0.
          expect(pythonFloat(left + pythonFloatStr(x) + right)).toBe(x);
        },
      ),
    );
  });

  it("throws only MixpanelHeadlessError PY_FLOAT_INVALID_LITERAL on rejection", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        let error: unknown = null;
        try {
          pythonFloat(text);
        } catch (error_) {
          error = error_;
        }
        // Accepted literals are covered by the round-trip properties;
        // this one constrains rejections only.
        fc.pre(error !== null);
        expect(error).toBeInstanceOf(MixpanelHeadlessError);
        expect((error as MixpanelHeadlessError).code).toBe(
          "PY_FLOAT_INVALID_LITERAL",
        );
      }),
    );
  });
});
