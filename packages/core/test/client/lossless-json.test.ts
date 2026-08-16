// Unit tests for the lossless JSON parser (D6 rule 3 / D12 hard
// requirement): raw number tokens must survive loading verbatim.
import { describe, expect, it } from "vitest";
import {
  JsonNumber,
  orderedEntries,
  orderedKeys,
  toNativeJson,
} from "../../src/client/json-value.js";
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

// ---------------------------------------------------------------------------
// Ordered-entries capability (B8-MAPFIX, user ratification
// `user-ratifications.md:14-22`): the parser records SOURCE key order
// wherever the built plain object cannot represent it (out-of-order
// integer-like keys), read back via `orderedKeys` / `orderedEntries`.
// Python twin: `json.loads` dict key order.
// ---------------------------------------------------------------------------

describe("parseLossless ordered entries (B8-MAPFIX)", () => {
  it("captures source order for out-of-ascending integer-like keys", () => {
    const value = parseLossless('{"200": 1, "100": 2}') as Record<
      string,
      unknown
    >;
    // JS enumeration hoists ascending…
    expect(Object.keys(value)).toEqual(["100", "200"]);
    // …the sidecar keeps Python's source order.
    expect(orderedKeys(value)).toEqual(["200", "100"]);
    expect(orderedEntries(value).map(([k]) => k)).toEqual(["200", "100"]);
  });

  it("mixed integer-like and plain keys keep full source order", () => {
    const value = parseLossless('{"b": 1, "3": 2, "a": 3, "1": 4}') as Record<
      string,
      unknown
    >;
    expect(orderedKeys(value)).toEqual(["b", "3", "a", "1"]);
  });

  it("in-order objects carry no sidecar and fall back to Object.keys", () => {
    const value = parseLossless('{"100": 1, "200": 2, "zeta": 3}') as Record<
      string,
      unknown
    >;
    expect(Object.getOwnPropertySymbols(value)).toEqual([]);
    expect(orderedKeys(value)).toEqual(["100", "200", "zeta"]);
  });

  it("duplicate keys: FIRST position wins, LAST value wins (json.loads)", () => {
    // Python: json.loads('{"2": 1, "1": 2, "2": 3}') → {"2": 3, "1": 2}
    // with key order ["2", "1"].
    const value = parseLossless('{"2": 1, "1": 2, "2": 3}') as Record<
      string,
      JsonNumber
    >;
    expect(orderedKeys(value)).toEqual(["2", "1"]);
    expect(value["2"]?.raw).toBe("3");
    expect(value["1"]?.raw).toBe("2");
  });

  it("the sidecar is invisible to enumeration and JSON.stringify", () => {
    const value = parseLossless('{"9": true, "1": false}') as Record<
      string,
      unknown
    >;
    expect(Object.keys(value)).toEqual(["1", "9"]);
    expect(JSON.stringify(value)).toBe('{"1":false,"9":true}');
    expect({ ...value }).toEqual({ "1": false, "9": true });
  });

  it("toNativeJson propagates the sidecar through conversion", () => {
    const parsed = parseLossless(
      '{"outer": {"42": {"x": 1}, "7": {"x": 2}}}',
    ) as Record<string, unknown>;
    const native = toNativeJson(parsed as never) as Record<
      string,
      Record<string, unknown>
    >;
    expect(orderedKeys(native["outer"] as object)).toEqual(["42", "7"]);
  });

  it("nested objects capture order independently", () => {
    const parsed = parseLossless(
      '{"a": {"5": 1, "3": 2}, "b": {"3": 1, "5": 2}}',
    ) as Record<string, Record<string, unknown>>;
    expect(orderedKeys(parsed["a"] as object)).toEqual(["5", "3"]);
    expect(orderedKeys(parsed["b"] as object)).toEqual(["3", "5"]);
  });
});
