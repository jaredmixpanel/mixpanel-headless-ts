// `pythonStrip` — CPython `str.strip()` against the pinned 29-codepoint
// whitespace table (CPython 3.14.6 / Unicode 16.0.0): strips U+001C..U+001F,
// which JS `trim()` keeps, and keeps U+FEFF, which JS `trim()` strips.
// No Python test file behind this suite; the fast-check properties are TS-only.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { codepoints } from "../../src/compat/codepoint.js";
import { pythonStrip } from "../../src/compat/python-strip.js";
import { PYTHON_STR_WHITESPACE } from "../../src/compat/whitespace.gen.js";

describe("pythonStrip — CPython str.strip() semantics", () => {
  it("strips the ASCII whitespace both ends", () => {
    expect(pythonStrip(" \t\r\n hello \v\f ")).toBe("hello");
  });

  it("strips U+001C..U+001F (Python-only: JS trim() keeps them)", () => {
    expect(pythonStrip("\u001Chi\u001F")).toBe("hi");
    expect("\u001Chi\u001F".trim()).toBe("\u001Chi\u001F"); // the JS contrast
  });

  it("keeps U+FEFF (JS-only trim member: Python str.strip() keeps the BOM)", () => {
    expect(pythonStrip("\uFEFFhi\uFEFF")).toBe("\uFEFFhi\uFEFF");
    expect("\uFEFFhi\uFEFF".trim()).toBe("hi"); // the JS contrast
  });

  it("strips NBSP and the non-ASCII Unicode space block", () => {
    expect(pythonStrip("\u00A0hi\u00A0")).toBe("hi");
    expect(pythonStrip("\u2000\u2003hi\u3000")).toBe("hi");
    expect(pythonStrip("hi\u0085\u2028")).toBe("hi");
  });

  it("returns the empty string for empty and all-whitespace input", () => {
    expect(pythonStrip("")).toBe("");
    expect(pythonStrip(" \t\u3000\u001C")).toBe("");
  });

  it("leaves interior whitespace untouched", () => {
    expect(pythonStrip("  a \t b  ")).toBe("a \t b");
  });

  it("never splits a surrogate pair (non-BMP payload)", () => {
    expect(pythonStrip(" 𝒳 ")).toBe("𝒳");
    expect(pythonStrip("𝒳")).toBe("𝒳");
  });

  it("matches the pinned 29-codepoint table exactly", () => {
    expect(PYTHON_STR_WHITESPACE.size).toBe(29);
    for (const cp of PYTHON_STR_WHITESPACE) {
      const ch = String.fromCodePoint(cp);
      expect(pythonStrip(`${ch}x${ch}`)).toBe("x");
    }
  });
});

describe("pythonStrip — properties (fast-check)", () => {
  it("is idempotent and produces a substring with clean ends", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (s) => {
        const stripped = pythonStrip(s);
        expect(pythonStrip(stripped)).toBe(stripped);
        expect(s.includes(stripped)).toBe(true);
        fc.pre(stripped.length > 0);
        const first = stripped.codePointAt(0)!;
        const last = codepoints(stripped).at(-1)!;
        expect(PYTHON_STR_WHITESPACE.has(first)).toBe(false);
        expect(PYTHON_STR_WHITESPACE.has(last.codePointAt(0)!)).toBe(false);
      }),
    );
  });

  it("wrapping with pinned whitespace never changes the result", () => {
    const wsChar = fc
      .constantFrom(...PYTHON_STR_WHITESPACE)
      .map((cp) => String.fromCodePoint(cp));
    fc.assert(
      fc.property(fc.string(), wsChar, wsChar, (s, left, right) => {
        expect(pythonStrip(left + s + right)).toBe(pythonStrip(s));
      }),
    );
  });
});
