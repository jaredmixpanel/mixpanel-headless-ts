// coerce.ts tests (R4.12) including fast-check property #5 from
// phase2-design C9: R4.12 table parity for coerceInt/coerceStr/coerceBool
// and default_factory-on-absent-only semantics.
//
// The example tables mirror a live pydantic-v2 probe (2026-08-15) run via
// TypeAdapter(int|float|str|bool).validate_python — see coerce.ts module
// docs for the one documented divergence (booleans rejected for
// int/float, the JSON-mode / R4.12 posture).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  coerceBool,
  coerceFloat,
  coerceInt,
  coerceStr,
  resolveWithDefault,
} from "../src/coerce.js";
import {
  ParamValidationError,
  ResponseValidationError,
} from "../src/errors.js";

describe("coerceInt", () => {
  it("accepts the R4.12 table: 42 / 42.0 / '42'", () => {
    expect(coerceInt(42)).toBe(42);
    expect(coerceInt(42.0)).toBe(42);
    expect(coerceInt("42")).toBe(42);
  });

  it("accepts pydantic-lax string forms", () => {
    expect(coerceInt(" 42 ")).toBe(42);
    expect(coerceInt("+42")).toBe(42);
    expect(coerceInt("-42")).toBe(-42);
    expect(coerceInt("42.0")).toBe(42);
    expect(coerceInt("1_000")).toBe(1000);
  });

  it("rejects the R4.12 table: 42.5 and booleans", () => {
    expect(() => coerceInt(42.5)).toThrow(ResponseValidationError);
    expect(() => coerceInt(true)).toThrow(ResponseValidationError);
    expect(() => coerceInt(false)).toThrow(ResponseValidationError);
  });

  it("rejects non-numeric strings, hex, empty, null, arrays", () => {
    for (const bad of [
      "0x10",
      "",
      "abc",
      "4 2",
      "1__0",
      "_1",
      "1_",
      null,
      [42],
      {},
      undefined,
      Number.NaN,
    ]) {
      expect(() => coerceInt(bad)).toThrow(ResponseValidationError);
    }
  });

  it("throws ParamValidationError at the 'param' boundary with field detail", () => {
    try {
      coerceInt("nope", { kind: "param", field: "project_id" });
      expect.unreachable();
    } catch (exc) {
      expect(exc).toBeInstanceOf(ParamValidationError);
      const err = exc as ParamValidationError;
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.details["field"]).toBe("project_id");
    }
  });

  it("property #5: integral numbers pass, fractional numbers throw", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        expect(coerceInt(n)).toBe(n);
        expect(coerceInt(String(n))).toBe(n);
      }),
    );
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noInteger: true, noDefaultInfinity: true }),
        (n) => {
          expect(() => coerceInt(n)).toThrow(ResponseValidationError);
        },
      ),
    );
  });
});

describe("coerceFloat", () => {
  it("accepts numbers and pydantic-lax float strings", () => {
    expect(coerceFloat(1.5)).toBe(1.5);
    expect(coerceFloat(1)).toBe(1);
    expect(coerceFloat("1.5")).toBe(1.5);
    expect(coerceFloat(" 2.5 ")).toBe(2.5);
    expect(coerceFloat("1e3")).toBe(1000);
    expect(coerceFloat("42.")).toBe(42);
    expect(coerceFloat(".5")).toBe(0.5);
    expect(coerceFloat("inf")).toBe(Number.POSITIVE_INFINITY);
    expect(coerceFloat("-Infinity")).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isNaN(coerceFloat("nan"))).toBe(true);
  });

  it("rejects booleans (JSON-mode posture), empty and junk strings", () => {
    expect(() => coerceFloat(true)).toThrow(ResponseValidationError);
    expect(() => coerceFloat(false)).toThrow(ResponseValidationError);
    for (const bad of ["", ".", "e3", "1.2.3", null, undefined, [1], {}]) {
      expect(() => coerceFloat(bad)).toThrow(ResponseValidationError);
    }
  });

  it("property: every finite double round-trips via its string form", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (n) => {
        expect(coerceFloat(n)).toBe(n);
        // String(-0) is "0" in JS, so the string leg loses the sign bit;
        // JSON cannot encode -0 either, so the boundary never sees it.
        if (!Object.is(n, -0)) {
          expect(coerceFloat(String(n))).toBe(n);
        }
      }),
    );
  });
});

describe("coerceStr", () => {
  it("passes strings through unchanged", () => {
    expect(coerceStr("x")).toBe("x");
    expect(coerceStr("")).toBe("");
  });

  it("does NOT coerce int/float/bool/null to string (R4.12)", () => {
    for (const bad of [42, 42.5, true, false, null, undefined, ["a"], {}]) {
      expect(() => coerceStr(bad)).toThrow(ResponseValidationError);
    }
  });

  it("property: arbitrary strings are identity, non-strings throw", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(coerceStr(s)).toBe(s);
      }),
    );
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.double(), fc.boolean(), fc.constant(null)),
        (v) => {
          expect(() => coerceStr(v)).toThrow(ResponseValidationError);
        },
      ),
    );
  });
});

describe("coerceBool", () => {
  const TRUE_SET = ["true", "t", "yes", "y", "on", "1"];
  const FALSE_SET = ["false", "f", "no", "n", "off", "0"];

  it("accepts exactly the R4.12 string sets, case-insensitively", () => {
    for (const s of TRUE_SET) {
      expect(coerceBool(s)).toBe(true);
      expect(coerceBool(s.toUpperCase())).toBe(true);
    }
    for (const s of FALSE_SET) {
      expect(coerceBool(s)).toBe(false);
      expect(coerceBool(s.toUpperCase())).toBe(false);
    }
    // Mixed-case spot checks from the pydantic probe.
    expect(coerceBool("TRUE")).toBe(true);
    expect(coerceBool("Yes")).toBe(true);
    expect(coerceBool("No")).toBe(false);
  });

  it("accepts booleans and the 0/1 numerics (incl. 0.0/1.0)", () => {
    expect(coerceBool(true)).toBe(true);
    expect(coerceBool(false)).toBe(false);
    expect(coerceBool(1)).toBe(true);
    expect(coerceBool(0)).toBe(false);
    expect(coerceBool(1.0)).toBe(true);
    expect(coerceBool(0.0)).toBe(false);
  });

  it("rejects everything else (2, 2.0, '1.0', 'tr', '', null)", () => {
    for (const bad of [
      2,
      -1,
      2.0,
      0.5,
      "1.0",
      "tr",
      "",
      " true",
      null,
      undefined,
      [],
      {},
    ]) {
      expect(() => coerceBool(bad)).toThrow(ResponseValidationError);
    }
  });

  it("property #5: strings outside the two sets always throw", () => {
    const members = new Set([...TRUE_SET, ...FALSE_SET]);
    fc.assert(
      fc.property(fc.string(), (s) => {
        if (members.has(s.toLowerCase())) {
          expect(typeof coerceBool(s)).toBe("boolean");
        } else {
          expect(() => coerceBool(s)).toThrow(ResponseValidationError);
        }
      }),
    );
  });
});

describe("resolveWithDefault (default_factory-on-absent-only)", () => {
  it("fires the factory only when the key is ABSENT", () => {
    expect(resolveWithDefault({}, "tags", () => ["d"])).toEqual(["d"]);
    expect(resolveWithDefault({ tags: ["x"] }, "tags", () => ["d"])).toEqual([
      "x",
    ]);
  });

  it("explicit null is returned verbatim — never replaced by the default", () => {
    expect(resolveWithDefault({ tags: null }, "tags", () => ["d"])).toBeNull();
  });

  it("property #5: factory fires iff the key is absent", () => {
    const SENTINEL = Symbol("default");
    fc.assert(
      fc.property(
        fc.string(),
        fc.option(fc.jsonValue(), { nil: undefined }),
        (key, value) => {
          const withKey: Record<string, unknown> = { [key]: value };
          expect(resolveWithDefault(withKey, key, () => SENTINEL)).toBe(value);
          const without: Record<string, unknown> = {};
          expect(resolveWithDefault(without, key, () => SENTINEL)).toBe(
            SENTINEL,
          );
        },
      ),
    );
  });
});
