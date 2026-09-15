// B0-1 (P3-4): tests written FIRST from R11.3 semantics. Every expected
// value below was produced by CPython 3.14.6 `int(str)` (the oracle) on
// 2026-08-15; the parse-grammar probes are recorded in
// context/phase3/notes/B0-notes.md (Python repo).
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { pythonInt } from "../../src/compat/python-int.js";
import { MixpanelHeadlessError } from "../../src/errors.js";

/**
 * Assert `pythonInt` rejects `text` with the given machine code.
 *
 * @param text - The input under test.
 * @param code - The expected `MixpanelHeadlessError` code.
 */
function expectRejects(text: string, code = "PY_INT_INVALID_LITERAL"): void {
  let thrown: unknown;
  try {
    pythonInt(text);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(MixpanelHeadlessError);
  expect((thrown as MixpanelHeadlessError).code).toBe(code);
}

describe("pythonInt — base grammar (CPython int(str))", () => {
  it("parses plain decimal digits", () => {
    expect(pythonInt("42")).toBe(42);
    expect(pythonInt("007")).toBe(7);
    expect(pythonInt("0")).toBe(0);
  });

  it("honours a single leading sign", () => {
    expect(pythonInt("+42")).toBe(42);
    expect(pythonInt("-42")).toBe(-42);
    expect(Object.is(pythonInt("-0"), 0)).toBe(true); // Python int has no -0
  });

  it("rejects doubled or misplaced signs", () => {
    expectRejects("++1");
    expectRejects("--1");
    expectRejects("+-1");
    expectRejects("1-");
    expectRejects("+ 1"); // whitespace between sign and digits
  });

  it("rejects the empty string, bare signs, and whitespace-only input", () => {
    expectRejects("");
    expectRejects("+");
    expectRejects("-");
    expectRejects(" ");
  });

  it("rejects float forms and non-base-10 prefixes (R11.3)", () => {
    expectRejects("5.5");
    expectRejects("5.");
    expectRejects(".5");
    expectRejects("1e5");
    expectRejects("0x5");
    expectRejects("0b1");
    expectRejects("1j");
  });

  it("rejects inf and nan spellings (int never accepts them)", () => {
    expectRejects("inf");
    expectRejects("nan");
    expectRejects("-inf");
    expectRejects("Infinity");
  });
});

describe("pythonInt — underscores (PEP 515: between digits only)", () => {
  it("accepts single underscores between digits", () => {
    expect(pythonInt("1_0")).toBe(10);
    expect(pythonInt("-1_0")).toBe(-10);
    expect(pythonInt("00_0")).toBe(0);
    expect(pythonInt("1_2_3")).toBe(123);
  });

  it("rejects doubled, leading, trailing, and sign-adjacent underscores", () => {
    expectRejects("1__0");
    expectRejects("_1");
    expectRejects("1_");
    expectRejects("+_1");
    expectRejects("0_x");
  });
});

describe("pythonInt — surrounding whitespace (CPython numeric set)", () => {
  it("strips ASCII numeric whitespace", () => {
    expect(pythonInt("\t42\n")).toBe(42);
    expect(pythonInt("  1_5  ")).toBe(15);
    expect(pythonInt(" \v\f\r 7 ")).toBe(7);
  });

  it("strips non-ASCII Unicode whitespace (NEL, NBSP, EM SPACE, IDEOGRAPHIC)", () => {
    expect(pythonInt("\u008542\u00A0")).toBe(42);
    expect(pythonInt("\u200342\u3000")).toBe(42);
  });

  it("rejects U+001C..U+001F (isspace-true but numeric-parse-rejected)", () => {
    // CPython probe 2026-08-15: int('\x1c42\x1f') raises ValueError even
    // though '\x1c'.isspace() is True — Py_ISSPACE excludes 1C..1F.
    expectRejects("\x1C42\x1F");
    expectRejects("\x1D7");
  });

  it("rejects U+FEFF (JS trims the BOM; Python never does)", () => {
    expectRejects("\uFEFF42");
  });

  it("rejects interior whitespace", () => {
    expectRejects(" 4 2 ");
  });
});

describe("pythonInt — non-ASCII decimal digits (pinned Unicode 16 table)", () => {
  it("parses Arabic-Indic digits: int('٤٢') == 42", () => {
    expect(pythonInt("٤٢")).toBe(42);
  });

  it("parses mixed-script and signed non-ASCII digits", () => {
    expect(pythonInt("４２")).toBe(42); // fullwidth
    expect(pythonInt("-๑๒๓")).toBe(-123); // Thai
    expect(pythonInt("१_०")).toBe(10); // Devanagari with underscore
  });

  it("parses non-BMP digits (𝟘 MATHEMATICAL DOUBLE-STRUCK ZERO)", () => {
    expect(pythonInt("𝟘")).toBe(0);
    expect(pythonInt("𝟙𝟚")).toBe(12);
  });

  it("rejects digit-like but non-decimal characters (², 〇)", () => {
    expectRejects("²");
    expectRejects("〇");
  });

  it("rejects non-BMP non-digit strings (R10.9 edge: '𝒳')", () => {
    expectRejects("𝒳");
  });
});

describe("pythonInt — 2^53−1 safety bound (canonicalizer policy, R4.5)", () => {
  it("accepts the exact bounds", () => {
    expect(pythonInt("9007199254740991")).toBe(9007199254740991);
    expect(pythonInt("-9007199254740991")).toBe(-9007199254740991);
  });

  it("throws PY_INT_UNSAFE_INTEGER just past the bounds", () => {
    expectRejects("9007199254740992", "PY_INT_UNSAFE_INTEGER");
    expectRejects("-9007199254740992", "PY_INT_UNSAFE_INTEGER");
    expectRejects("123456789012345678901234567890", "PY_INT_UNSAFE_INTEGER");
  });

  it("ignores leading zeros when judging magnitude", () => {
    expect(pythonInt("0009007199254740991")).toBe(9007199254740991);
  });
});

describe("pythonInt — properties (fast-check)", () => {
  it("round-trips every safe integer through its decimal rendering", () => {
    fc.assert(
      fc.property(fc.maxSafeInteger(), (n) => {
        expect(pythonInt(String(n))).toBe(n);
      }),
    );
  });

  it("is whitespace-wrap invariant over the pinned numeric set", () => {
    const ws = fc.constantFrom(
      "",
      " ",
      "\t",
      "\n",
      "\u0085",
      "\u00A0",
      "\u2003",
      "\u3000",
    );
    fc.assert(
      fc.property(fc.maxSafeInteger(), ws, ws, (n, left, right) => {
        expect(pythonInt(left + String(n) + right)).toBe(n);
      }),
    );
  });

  it("accepts an underscore inserted between any two digits", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 1_000_000 }),
        fc.nat(),
        (n, seed) => {
          const text = String(n);
          const cut = 1 + (seed % (text.length - 1));
          expect(pythonInt(`${text.slice(0, cut)}_${text.slice(cut)}`)).toBe(n);
        },
      ),
    );
  });

  it("never returns a non-integer or unsafe number", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        let value: number;
        try {
          value = pythonInt(text);
        } catch (error) {
          expect(error).toBeInstanceOf(MixpanelHeadlessError);
          return;
        }
        expect(Number.isSafeInteger(value)).toBe(true);
      }),
    );
  });
});
