// B0-1 (P3-4): tests written FIRST from R11.5/R11.6 semantics. Expected
// values produced by CPython 3.14.6 `len`/slicing/`sorted` (the oracle)
// on 2026-08-15.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  codepoints,
  cpLength,
  cpSlice,
  sortedByCodepoint,
} from "../../src/compat/codepoint.js";

describe("cpLength — Python len(str) counts codepoints (R11.6)", () => {
  it("counts BMP strings like UTF-16", () => {
    expect(cpLength("")).toBe(0);
    expect(cpLength("abc")).toBe(3);
  });

  it("counts non-BMP characters once (JS .length counts twice)", () => {
    expect(cpLength("𝒳")).toBe(1);
    expect("𝒳").toHaveLength(2); // the JS contrast
    expect(cpLength("a𝒳b😀")).toBe(4);
  });
});

describe("codepoints — Python list(str) splits by code point", () => {
  it("keeps surrogate pairs whole", () => {
    expect(codepoints("a\u{1D518}b")).toEqual(["a", "\u{1D518}", "b"]);
    expect(codepoints("")).toEqual([]);
  });
});

describe("cpSlice — Python str slice semantics (R11.6)", () => {
  it("slices by codepoint index, never splitting surrogate pairs", () => {
    expect(cpSlice("a𝒳b", 0, 2)).toBe("a𝒳");
    expect(cpSlice("𝒳😀𝒴", 1, 2)).toBe("😀");
    expect(cpSlice("😀😀😀", 0, 1)).toBe("😀");
  });

  it("defaults to the full string (both ends open)", () => {
    expect(cpSlice("hello")).toBe("hello");
    expect(cpSlice("hello", 2)).toBe("llo");
    expect(cpSlice("hello", undefined, 2)).toBe("he");
  });

  it("clamps out-of-range indices like Python (text[:500] on short text)", () => {
    expect(cpSlice("abc", 0, 500)).toBe("abc");
    expect(cpSlice("abc", -500, 500)).toBe("abc");
    expect(cpSlice("abc", 5, 9)).toBe("");
  });

  it("resolves negative indices from the end, by codepoint", () => {
    expect(cpSlice("hello", -3)).toBe("llo");
    expect(cpSlice("hello", 0, -1)).toBe("hell");
    expect(cpSlice("a𝒳b", -2)).toBe("𝒳b");
    expect(cpSlice("a𝒳b", 0, -2)).toBe("a");
  });

  it("returns empty when start >= end after normalization", () => {
    expect(cpSlice("hello", 3, 2)).toBe("");
    expect(cpSlice("hello", -1, 1)).toBe("");
    expect(cpSlice("", 0, 10)).toBe("");
  });

  it("rejects non-integer indices like Python (TypeError)", () => {
    expect(() => cpSlice("abc", 1.5)).toThrow(TypeError);
    expect(() => cpSlice("abc", 0, 1.5)).toThrow(TypeError);
  });

  it("splits and re-joins losslessly (fast-check)", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), fc.integer(), (s, i) => {
        expect(cpSlice(s, 0, i) + cpSlice(s, i)).toBe(s);
      }),
    );
  });

  it("prefix length matches min(n, cpLength) for n >= 0 (fast-check)", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), fc.nat(), (s, n) => {
        expect(cpLength(cpSlice(s, 0, n))).toBe(Math.min(n, cpLength(s)));
      }),
    );
  });
});

describe("sortedByCodepoint — Python sorted() string order (R11.5)", () => {
  it("orders by codepoint where UTF-16 unit order disagrees", () => {
    // U+FF61 (｡) < U+1F600 (😀) by codepoint; JS default sort compares
    // UTF-16 units (0xD83D < 0xFF61) and inverts the pair.
    expect(sortedByCodepoint(["｡", "😀"])).toStrictEqual(["｡", "😀"]);
    expect(sortedByCodepoint(["😀", "｡"])).toStrictEqual(["｡", "😀"]);
    expect(["😀", "｡"].sort()).toStrictEqual(["😀", "｡"]); // the JS contrast
  });

  it("sorts prefixes first (Python: 'ab' < 'abc')", () => {
    expect(sortedByCodepoint(["abc", "ab", "a", ""])).toStrictEqual([
      "",
      "a",
      "ab",
      "abc",
    ]);
  });

  it("keeps duplicates and is stable", () => {
    expect(sortedByCodepoint(["b", "a", "b", "a"])).toStrictEqual([
      "a",
      "a",
      "b",
      "b",
    ]);
  });

  it("returns a NEW array and leaves the input untouched", () => {
    const input = ["b", "a"];
    const result = sortedByCodepoint(input);
    expect(result).toStrictEqual(["a", "b"]);
    expect(input).toStrictEqual(["b", "a"]);
    expect(result).not.toBe(input);
  });

  it("handles the empty list", () => {
    expect(sortedByCodepoint([])).toStrictEqual([]);
  });

  it("is a sorted permutation matching JS sort on BMP-only input (fast-check)", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (values) => {
        const result = sortedByCodepoint(values);
        expect([...result].sort()).toStrictEqual([...values].sort());
        // BMP-only strings: codepoint order == UTF-16 order.
        fc.pre(values.every((v) => codepoints(v).every((c) => c.length === 1)));
        expect(result).toStrictEqual([...values].sort());
      }),
    );
  });

  it("output is pairwise ordered under codepoint comparison (fast-check)", () => {
    const cpKey = (s: string): readonly number[] =>
      codepoints(s).map((c) => c.codePointAt(0)!);
    const lessOrEqual = (a: string, b: string): boolean => {
      const ka = cpKey(a);
      const kb = cpKey(b);
      for (let i = 0; i < Math.min(ka.length, kb.length); i += 1) {
        const da = ka[i]!;
        const db = kb[i]!;
        if (da !== db) {
          return da < db;
        }
      }
      return ka.length <= kb.length;
    };
    fc.assert(
      fc.property(fc.array(fc.string({ unit: "binary" })), (values) => {
        const result = sortedByCodepoint(values);
        for (let i = 1; i < result.length; i += 1) {
          expect(lessOrEqual(result[i - 1]!, result[i]!)).toBe(true);
        }
      }),
    );
  });
});
