// Unit tests for the lossless JSON parser (D6 rule 3 / D12 hard
// requirement): raw number tokens must survive loading verbatim.
import { describe, expect, it } from "vitest";
import { JsonNumber } from "../../src/client/json-value.js";
import {
  LosslessJsonError,
  parseLossless,
} from "../../src/client/lossless-json.js";

describe("parseLossless", () => {
  it("captures number tokens verbatim", () => {
    const value = parseLossless('{"a": 18.0, "b": 18, "c": 1e-7}') as {
      [key: string]: JsonNumber;
    };
    expect(value["a"]).toBeInstanceOf(JsonNumber);
    expect(value["a"]?.raw).toBe("18.0");
    expect(value["b"]?.raw).toBe("18");
    expect(value["c"]?.raw).toBe("1e-7");
  });

  it("distinguishes integer tokens from float tokens", () => {
    const int = parseLossless("18") as JsonNumber;
    const float = parseLossless("18.0") as JsonNumber;
    expect(int.isIntegerToken()).toBe(true);
    expect(float.isIntegerToken()).toBe(false);
  });

  it("preserves integers above 2^53 exactly", () => {
    const value = parseLossless("9007199254740993") as JsonNumber;
    expect(value.raw).toBe("9007199254740993");
    expect(value.isUnsafeInteger()).toBe(true);
    const safe = parseLossless("9007199254740992") as JsonNumber;
    expect(safe.isUnsafeInteger()).toBe(false);
  });

  it("parses nested structures, literals and escapes", () => {
    const value = parseLossless(
      '[null, true, false, "a\\nb\\u00e9", {"k": []}]',
    );
    expect(value).toEqual([null, true, false, "a\nbé", { k: [] }]);
  });

  it("applies last-wins semantics to duplicate keys", () => {
    const value = parseLossless('{"a": 1, "a": 2}') as {
      [key: string]: JsonNumber;
    };
    expect(value["a"]?.raw).toBe("2");
  });

  it("rejects trailing content", () => {
    expect(() => parseLossless("1 2")).toThrow(LosslessJsonError);
  });

  it("rejects malformed tokens", () => {
    expect(() => parseLossless("01")).toThrow(LosslessJsonError);
    expect(() => parseLossless("+1")).toThrow(LosslessJsonError);
    expect(() => parseLossless('"unterminated')).toThrow(LosslessJsonError);
    expect(() => parseLossless('{"a" 1}')).toThrow(LosslessJsonError);
    expect(() => parseLossless("[1,]")).toThrow(LosslessJsonError);
    expect(() => parseLossless("NaN")).toThrow(LosslessJsonError);
  });

  it("rejects raw control characters inside strings", () => {
    expect(() => parseLossless(`"a${String.fromCharCode(1)}b"`)).toThrow(
      LosslessJsonError,
    );
  });
});

// Arbiter fix F1 (b0-review-resolution): Python `json.loads` (and thus
// every `response.json()` body-parse site in api_client.py) accepts the
// three non-finite constants `NaN` / `Infinity` / `-Infinity` — probed
// live against CPython 3.14: exact case only, no `+Infinity`, no `-NaN`,
// no case variants. The opt-in `pythonConstants` flag mirrors that
// grammar for the wire body-parse sites; the DEFAULT stays strict RFC
// 8259 so vector/selftest JSON keeps D6 rule 5 enforcement.
describe("parseLossless pythonConstants (json.loads non-finite tokens)", () => {
  const opts = { pythonConstants: true } as const;

  it("parses the three constants as native non-finite numbers", () => {
    expect(parseLossless("NaN", opts)).toBeNaN();
    expect(parseLossless("Infinity", opts)).toBe(Infinity);
    expect(parseLossless("-Infinity", opts)).toBe(-Infinity);
  });

  it("parses the constants inside containers (json.loads parity)", () => {
    const value = parseLossless(
      '{"a": NaN, "b": [Infinity, -Infinity]}',
      opts,
    ) as {
      a: number;
      b: number[];
    };
    expect(value.a).toBeNaN();
    expect(value.b).toEqual([Infinity, -Infinity]);
  });

  it("rejects every variant json.loads rejects (probed: exact case only)", () => {
    for (const bad of [
      "nan",
      "NAN",
      "-NaN",
      "+Infinity",
      "infinity",
      "INFINITY",
      "Inf",
      "-Inf",
    ]) {
      expect(() => parseLossless(bad, opts)).toThrow(LosslessJsonError);
    }
  });

  it("still parses ordinary numbers as JsonNumber tokens under the flag", () => {
    const value = parseLossless('{"a": 18.0, "b": -2}', opts) as {
      [key: string]: JsonNumber;
    };
    expect(value["a"]).toBeInstanceOf(JsonNumber);
    expect(value["a"]?.raw).toBe("18.0");
    expect(value["b"]?.raw).toBe("-2");
  });

  it("DEFAULT stays strict: all three constants reject without the flag", () => {
    expect(() => parseLossless("NaN")).toThrow(LosslessJsonError);
    expect(() => parseLossless("Infinity")).toThrow(LosslessJsonError);
    expect(() => parseLossless("-Infinity")).toThrow(LosslessJsonError);
    expect(() => parseLossless('{"a": NaN}')).toThrow(LosslessJsonError);
  });
});
