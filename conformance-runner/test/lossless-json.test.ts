// Unit tests for the lossless JSON parser (D6 rule 3 / D12 hard
// requirement): raw number tokens must survive loading verbatim.
import { describe, expect, it } from "vitest";
import { JsonNumber } from "../src/json-value.js";
import { LosslessJsonError, parseLossless } from "../src/lossless-json.js";

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
