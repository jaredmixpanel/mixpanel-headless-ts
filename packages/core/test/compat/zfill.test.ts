// TS-2 (D18 B/TS-2): tests written FIRST from R11.4 semantics + the D13 case
// list. Every expected value below was produced by CPython `str.zfill` (the
// oracle) on 2026-08-14; see the docstring of `zfill` for the semantics.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { zfill } from "../../src/compat/zfill.js";

describe("zfill — D13 case list", () => {
  it('pads a negative number after the sign: ("-1", 3) -> "-01"', () => {
    expect(zfill("-1", 3)).toBe("-01");
  });

  it('pads an unsigned string on the left: ("5", 3) -> "005"', () => {
    expect(zfill("5", 3)).toBe("005");
  });

  it('pads a plus-signed string after the sign: ("+7", 3) -> "+07"', () => {
    expect(zfill("+7", 3)).toBe("+07");
  });

  it('pads the empty string with zeros only: ("", 2) -> "00"', () => {
    expect(zfill("", 2)).toBe("00");
  });

  it("returns the input unchanged when width is smaller than the input", () => {
    expect(zfill("12345", 3)).toBe("12345");
  });

  it("counts CODEPOINTS, not UTF-16 units, for non-BMP input (R10.9 edge set)", () => {
    // Python len("😀") == 1, so zfill(3) adds TWO zeros; a UTF-16-length
    // implementation would add only one.
    expect(zfill("😀", 3)).toBe("00😀");
    expect(zfill("𝟘", 3)).toBe("00𝟘");
  });

  it("handles sign + non-BMP payload together", () => {
    expect(zfill("-😀", 4)).toBe("-00😀");
  });
});

describe("zfill — CPython oracle edge cases", () => {
  it("pads a bare sign character after the sign", () => {
    expect(zfill("-", 3)).toBe("-00");
    expect(zfill("+", 1)).toBe("+");
  });

  it("moves only the FIRST character when it is a sign", () => {
    // CPython: "--1".zfill(5) == "-00-1"
    expect(zfill("--1", 5)).toBe("-00-1");
  });

  it("pads non-numeric strings exactly like numeric ones", () => {
    expect(zfill("abc", 5)).toBe("00abc");
    expect(zfill("-abc", 6)).toBe("-00abc");
  });

  it("handles zero and negative widths as no-ops", () => {
    expect(zfill("", 0)).toBe("");
    expect(zfill("5", -2)).toBe("5");
  });

  it("throws TypeError for a non-integer width (CPython raises TypeError)", () => {
    expect(() => zfill("5", 2.5)).toThrow(TypeError);
    expect(() => zfill("5", Number.NaN)).toThrow(TypeError);
    expect(() => zfill("5", Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

/**
 * Slow reference implementation of Python `str.zfill` used by the
 * fast-check properties.
 *
 * Deliberately constructed differently from the production code: it works
 * on an exploded codepoint array and prepends zeros one at a time.
 *
 * @param value - Input string (any codepoints).
 * @param width - Target codepoint width (assumed integral).
 * @returns The zero-filled string per CPython semantics.
 */
function referenceZfill(value: string, width: number): string {
  const codepoints = [...value];
  const sign =
    codepoints[0] === "+" || codepoints[0] === "-" ? codepoints[0] : "";
  const rest = sign === "" ? codepoints : codepoints.slice(1);
  while (sign.length + rest.length < width) {
    rest.unshift("0");
  }
  return sign + rest.join("");
}

describe("zfill — fast-check properties", () => {
  const widthArb = fc.integer({ min: -5, max: 60 });
  const stringArbs: readonly [string, fc.Arbitrary<string>][] = [
    ["ascii-ish strings", fc.string()],
    [
      "full-unicode strings (non-BMP included)",
      fc.string({ unit: "grapheme" }),
    ],
  ];

  const edgeExamples: [string, number][] = [
    ["-1", 3],
    ["5", 3],
    ["+7", 3],
    ["", 2],
    ["😀", 3],
    ["-😀", 4],
    ["--1", 5],
    ["12345", 3],
  ];

  for (const [label, stringArb] of stringArbs) {
    it(`matches the slow reference for ${label}`, () => {
      fc.assert(
        fc.property(stringArb, widthArb, (value, width) => {
          expect(zfill(value, width)).toBe(referenceZfill(value, width));
        }),
        { examples: edgeExamples },
      );
    });

    it(`output codepoint length is max(len, width) for ${label}`, () => {
      fc.assert(
        fc.property(stringArb, widthArb, (value, width) => {
          const inputLength = [...value].length;
          expect([...zfill(value, width)].length).toBe(
            Math.max(inputLength, width),
          );
        }),
        { examples: edgeExamples },
      );
    });

    it(`is the identity when width <= codepoint length for ${label}`, () => {
      fc.assert(
        fc.property(stringArb, widthArb, (value, width) => {
          fc.pre([...value].length >= width);
          expect(zfill(value, width)).toBe(value);
        }),
      );
    });
  }

  it("preserves integer value for signed decimal strings", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 0, max: 40 }), (n, width) => {
        const text = String(n);
        expect(Number(zfill(text, width))).toBe(n);
      }),
      {
        examples: [
          [-1, 3],
          [0, 2],
          [7, 3],
        ],
      },
    );
  });
});
