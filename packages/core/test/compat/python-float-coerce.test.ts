// B6-GATE (R11.7 straggler sweep, B5-notes.md outbound ledger item 5 /
// b5-review-resolution.md ASR-F6b): tests written FIRST from CPython
// `float(x)` non-string semantics. Every expected value/message below was
// produced by CPython 3.14.6 (the oracle) on 2026-08-16 — probe record in
// context/phase3/notes/B6-notes.md (Python repo). The string arm is
// `pythonFloat` (R11.3, already locked by python-float.test.ts); this
// suite locks the coercion LADDER around it.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OverflowError } from "../../src/compat/python-builtins.js";
import { pythonFloatCoerce } from "../../src/compat/python-float-coerce.js";
import { MixpanelHeadlessError } from "../../src/errors.js";

describe("pythonFloatCoerce — number and bool arms (CPython float(x))", () => {
  it("returns native numbers unchanged (float(int)/float(float))", () => {
    expect(pythonFloatCoerce(42)).toBe(42);
    expect(pythonFloatCoerce(1.5)).toBe(1.5);
    expect(pythonFloatCoerce(0.12)).toBe(0.12);
    expect(Object.is(pythonFloatCoerce(-0), -0)).toBe(true);
  });

  it("passes non-finite numbers through (float(inf) is inf)", () => {
    expect(pythonFloatCoerce(Infinity)).toBe(Infinity);
    expect(pythonFloatCoerce(-Infinity)).toBe(-Infinity);
    expect(Number.isNaN(pythonFloatCoerce(NaN))).toBe(true);
  });

  it("coerces booleans exactly as CPython (float(True) is 1.0)", () => {
    expect(pythonFloatCoerce(true)).toBe(1.0);
    expect(pythonFloatCoerce(false)).toBe(0.0);
  });

  it("identity holds across the finite double domain (PBT)", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        (value) => {
          expect(pythonFloatCoerce(value)).toBe(value);
        },
      ),
    );
  });
});

describe("pythonFloatCoerce — string arm delegates to pythonFloat (R11.3)", () => {
  it("parses CPython-only spellings", () => {
    expect(pythonFloatCoerce("inf")).toBe(Infinity);
    expect(pythonFloatCoerce("1_0.5")).toBe(10.5);
    expect(pythonFloatCoerce(".5")).toBe(0.5);
  });

  it("rejects invalid literals with PY_FLOAT_INVALID_LITERAL", () => {
    let thrown: unknown;
    try {
      pythonFloatCoerce("");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MixpanelHeadlessError);
    expect((thrown as MixpanelHeadlessError).code).toBe(
      "PY_FLOAT_INVALID_LITERAL",
    );
  });
});

describe("pythonFloatCoerce — rig float-tag wrapper arm ($type: float)", () => {
  it("unwraps spelling-carrying wrappers (integral Python floats)", () => {
    expect(pythonFloatCoerce({ spelling: "18.0" })).toBe(18);
    expect(pythonFloatCoerce({ spelling: "1e+16" })).toBe(1e16);
  });

  it("unwraps the non-finite canonical spellings", () => {
    expect(pythonFloatCoerce({ spelling: "Infinity" })).toBe(Infinity);
    expect(pythonFloatCoerce({ spelling: "-Infinity" })).toBe(-Infinity);
    expect(Number.isNaN(pythonFloatCoerce({ spelling: "NaN" }))).toBe(true);
  });
});

describe("pythonFloatCoerce — CPython TypeError twins (Discrepancy #8 in-annotation raises)", () => {
  it("raises TypeError on None exactly as CPython", () => {
    expect(() => pythonFloatCoerce(null)).toThrow(TypeError);
    expect(() => pythonFloatCoerce(null)).toThrow(
      "float() argument must be a string or a real number, not 'NoneType'",
    );
    // `undefined` is the same absent-value spelling in the JS domain.
    expect(() => pythonFloatCoerce(undefined)).toThrow(TypeError);
  });

  it("raises TypeError on a list exactly as CPython", () => {
    expect(() => pythonFloatCoerce([])).toThrow(TypeError);
    expect(() => pythonFloatCoerce([1])).toThrow(
      "float() argument must be a string or a real number, not 'list'",
    );
  });

  it("raises TypeError on a dict exactly as CPython", () => {
    expect(() => pythonFloatCoerce({})).toThrow(TypeError);
    expect(() => pythonFloatCoerce({ a: 1 })).toThrow(
      "float() argument must be a string or a real number, not 'dict'",
    );
  });
});

describe("pythonFloatCoerce — huge-int spellings (OverflowError twin)", () => {
  // CPython float(10**400) raises OverflowError. In the JS domain such a
  // value only appears as an integral spelling wrapper (rig transport) —
  // native doubles saturate to Infinity long before. Not fuzz-observable
  // (the 2^53 codec policy bars huge ints from the oracle wire, R4.5) —
  // this unit lock is the only TS-side lock, disclosed in the strategy
  // domain note.
  it("raises the OverflowError twin on an integer spelling beyond double range", () => {
    expect(() =>
      pythonFloatCoerce({ spelling: `1${"0".repeat(400)}` }),
    ).toThrow(OverflowError);
    expect(() =>
      pythonFloatCoerce({ spelling: `-1${"0".repeat(400)}` }),
    ).toThrow("int too large to convert to float");
  });

  it("does NOT overflow-guard float spellings (float('1e400') is inf)", () => {
    expect(pythonFloatCoerce({ spelling: "1e400" })).toBe(Infinity);
  });
});
