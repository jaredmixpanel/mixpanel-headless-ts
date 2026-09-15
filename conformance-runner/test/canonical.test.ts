// Unit tests for the D6 canonicalizer. These pin the TS implementation to
// the normative D6 rules; cross-language parity is verified separately by
// the shared canonical-selftest.json suite (canonical-selftest.test.ts).
import { describe, expect, it } from "vitest";

import {
  CanonicalizationError,
  canonicalize,
  canonicalizeError,
  canonicalizeInteractions,
  headersMatch,
  normalizeNumericString,
  renderCanonicalFloat,
} from "../src/canonical.js";
import { JsonNumber, type JsonValue } from "../src/json-value.js";
import { parseLossless } from "../src/lossless-json.js";

describe("canonicalize: objects (rule 1)", () => {
  it("sorts keys lexicographically", () => {
    expect(canonicalize({ b: 1, a: 2, c: 3 })).toBe('{"a":2,"b":1,"c":3}');
  });

  it("sorts keys by codepoint, not UTF-16 code units", () => {
    // U+1D11E (astral) must sort AFTER U+FF01 even though its first
    // UTF-16 code unit (0xD834) is smaller.
    const astral = String.fromCodePoint(0x1d11e);
    const bmp = String.fromCodePoint(0xff01);
    expect(canonicalize({ [astral]: 1, [bmp]: 2 })).toBe(
      `{"${bmp}":2,"${astral}":1}`,
    );
  });

  it("preserves null vs absent distinctly", () => {
    expect(canonicalize({ a: null })).toBe('{"a":null}');
    expect(canonicalize({})).toBe("{}");
  });

  it("treats undefined-valued members as absent", () => {
    const value = { a: 1, b: undefined as unknown as null };
    expect(canonicalize(value)).toBe('{"a":1}');
  });

  it("rejects non-JSON objects", () => {
    expect(() => canonicalize(new Date(0) as unknown as null)).toThrow(
      CanonicalizationError,
    );
  });
});

describe("canonicalize: strings (rule 2)", () => {
  it("emits verbatim non-ASCII with minimal escaping", () => {
    expect(canonicalize("héllo\nwörld")).toBe(String.raw`"héllo\nwörld"`);
  });

  it("escapes control characters", () => {
    expect(canonicalize(String.fromCharCode(1))).toBe(String.raw`"\u0001"`);
    expect(canonicalize("\t")).toBe(String.raw`"\t"`);
  });

  it("rejects lone surrogates", () => {
    expect(() => canonicalize("a\uD800b")).toThrow(CanonicalizationError);
    // A well-formed surrogate PAIR is fine.
    expect(canonicalize("𝄞")).toBe(`"𝄞"`);
  });
});

describe("canonicalize: number tokens (rule 3)", () => {
  it("renders integer tokens without exponent or fraction", () => {
    expect(canonicalize(new JsonNumber("18"))).toBe("18");
    expect(canonicalize(new JsonNumber("-7"))).toBe("-7");
  });

  it("normalizes the integer token -0 to 0", () => {
    expect(canonicalize(new JsonNumber("-0"))).toBe("0");
  });

  it("preserves integer tokens above 2^53 exactly", () => {
    expect(canonicalize(new JsonNumber("9007199254740993"))).toBe(
      "9007199254740993",
    );
  });

  it("keeps float tokens as floats even when integral", () => {
    expect(canonicalize(new JsonNumber("18.0"))).toBe("18.0");
    expect(canonicalize(new JsonNumber("1.8e1"))).toBe("18.0");
  });

  it("rejects float tokens that overflow a double", () => {
    expect(() => canonicalize(new JsonNumber("1e999"))).toThrow(
      CanonicalizationError,
    );
  });
});

describe("canonicalize: native numbers (rules 3/5)", () => {
  it("renders integral doubles as integers", () => {
    expect(canonicalize(18)).toBe("18");
  });

  it("renders non-integral doubles as floats", () => {
    expect(canonicalize(18.5)).toBe("18.5");
  });

  it("renders native negative zero as -0.0", () => {
    expect(canonicalize(-0)).toBe("-0.0");
  });

  it("renders bigints exactly", () => {
    expect(canonicalize(9007199254740993n)).toBe("9007199254740993");
  });

  it("rejects NaN and the infinities", () => {
    expect(() => canonicalize(Number.NaN)).toThrow(CanonicalizationError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(
      CanonicalizationError,
    );
  });
});

describe("renderCanonicalFloat (rule 5: ECMAScript toString)", () => {
  it("uses JS exponent thresholds, not Python's", () => {
    // Python repr(1e16) is "1e+16"; ECMAScript renders fixed notation
    // until 1e21. At/above 1e16 (Python's repr exponent threshold) no
    // ".0" integral marker exists in either language.
    expect(renderCanonicalFloat(1e16)).toBe("10000000000000000");
    expect(renderCanonicalFloat(1e21)).toBe("1e+21");
    expect(renderCanonicalFloat(1e-5)).toBe("0.00001");
    expect(renderCanonicalFloat(1e-7)).toBe("1e-7");
  });

  it("keeps integral floats float-marked below 1e16 (rule 3)", () => {
    expect(renderCanonicalFloat(18)).toBe("18.0");
    expect(renderCanonicalFloat(1e15)).toBe("1000000000000000.0");
    expect(renderCanonicalFloat(-1e16)).toBe("-10000000000000000");
  });

  it("special-cases negative zero", () => {
    expect(renderCanonicalFloat(-0)).toBe("-0.0");
  });
});

describe("numeric-string normalization (rule 4)", () => {
  it("normalizes only in number-typed filter.operand positions", () => {
    const entry = {
      selected_property_type: "number",
      filter: { operator: ">", operand: "18.0" },
    };
    expect(canonicalize(entry)).toBe(
      '{"filter":{"operand":"18","operator":">"},"selected_property_type":"number"}',
    );
  });

  it("normalizes each element of an array operand", () => {
    const entry = {
      selected_property_type: "number",
      filter: { operator: "between", operand: ["18.0", "18.50"] },
    };
    expect(canonicalize(entry)).toBe(
      '{"filter":{"operand":["18","18.5"],"operator":"between"},"selected_property_type":"number"}',
    );
  });

  it("leaves string-typed entries untouched", () => {
    const entry = {
      selected_property_type: "string",
      filter: { operator: "==", operand: "18.0" },
    };
    expect(canonicalize(entry)).toContain('"operand":"18.0"');
  });

  it("leaves operand outside a qualifying structure untouched", () => {
    expect(canonicalize({ operand: "18.0" })).toBe('{"operand":"18.0"}');
    expect(canonicalize({ filter: { operand: "18.0" } })).toBe(
      '{"filter":{"operand":"18.0"}}',
    );
  });

  it("does not normalize keys other than operand inside the filter", () => {
    const entry = {
      selected_property_type: "number",
      filter: { operator: "18.0", operand: "2.0" },
    };
    expect(canonicalize(entry)).toContain('"operator":"18.0"');
    expect(canonicalize(entry)).toContain('"operand":"2"');
  });

  it("does not descend past one array level", () => {
    const entry = {
      selected_property_type: "number",
      filter: { operand: [["18.0"]] },
    };
    expect(canonicalize(entry)).toContain('[["18.0"]]');
  });
});

describe("normalizeNumericString (Python float grammar)", () => {
  it("int-collapses integral values", () => {
    expect(normalizeNumericString("18.0")).toBe("18");
    // Python: repr(-0.0) is "-0.0"; stripping ".0" leaves "-0".
    expect(normalizeNumericString("-0.0")).toBe("-0");
    expect(normalizeNumericString("1e2")).toBe("100");
  });

  it("keeps rule-5 exponent form for large magnitudes", () => {
    expect(normalizeNumericString("1e21")).toBe("1e+21");
    expect(normalizeNumericString("1e16")).toBe("10000000000000000");
  });

  it("leaves non-finite parses unchanged (rendering them is illegal)", () => {
    expect(normalizeNumericString("nan")).toBe("nan");
    expect(normalizeNumericString("inf")).toBe("inf");
    expect(normalizeNumericString("-Infinity")).toBe("-Infinity");
    expect(normalizeNumericString("1e999")).toBe("1e999");
  });

  it("renders non-integral values shortest-round-trip", () => {
    expect(normalizeNumericString("18.50")).toBe("18.5");
    expect(normalizeNumericString(".5")).toBe("0.5");
  });

  it("accepts Python-specific spellings", () => {
    expect(normalizeNumericString("1_0")).toBe("10");
    expect(normalizeNumericString("  2.0  ")).toBe("2");
    expect(normalizeNumericString("1.")).toBe("1");
    expect(normalizeNumericString("1.e3")).toBe("1000");
  });

  it("returns unparseable strings unchanged", () => {
    expect(normalizeNumericString("not a number")).toBe("not a number");
    expect(normalizeNumericString("")).toBe("");
    expect(normalizeNumericString("1__0")).toBe("1__0");
    expect(normalizeNumericString("_1")).toBe("_1");
    expect(normalizeNumericString("1_")).toBe("1_");
    expect(normalizeNumericString(".")).toBe(".");
    expect(normalizeNumericString("e3")).toBe("e3");
    expect(normalizeNumericString("0x10")).toBe("0x10");
  });
});

describe("canonicalizeError (rule 6)", () => {
  it("drops advisory keys at the top level only", () => {
    expect(
      canonicalizeError({
        class: "BookmarkValidationError",
        message: "advisory",
        suggestion: "advisory",
        fix: { value: { name: "<EVENT_NAME>" } },
        code: "B8_MISSING_EVENT_NAME",
      }),
    ).toBe(
      '{"class":"BookmarkValidationError","code":"B8_MISSING_EVENT_NAME"}',
    );
  });

  it("drops advisory keys inside errors[] elements", () => {
    expect(
      canonicalizeError({
        class: "BookmarkValidationError",
        errors: [
          {
            path: "$.events[0]",
            code: "V7",
            severity: "error",
            message: "advisory",
            suggestion: "advisory",
          },
        ],
      }),
    ).toBe(
      '{"class":"BookmarkValidationError","errors":[{"code":"V7","path":"$.events[0]","severity":"error"}]}',
    );
  });

  it("never strips recursively inside details_contain", () => {
    expect(
      canonicalizeError({
        class: "MixpanelAPIError",
        details_contain: { response_body: { message: "wire data" } },
      }),
    ).toBe(
      '{"class":"MixpanelAPIError","details_contain":{"response_body":{"message":"wire data"}}}',
    );
  });

  it("passes non-object errors through", () => {
    expect(canonicalizeError("boom")).toBe('"boom"');
  });
});

describe("headersMatch (rules 7-8)", () => {
  it("throws on malformed expected values", () => {
    // The missing-header short-circuit fires first (Python parity), so
    // the malformed value must be reached via a present header.
    expect(headersMatch({ authorization: 42 }, {})).toBe(false);
    expect(() =>
      headersMatch({ authorization: 42 }, { authorization: "Basic x" }),
    ).toThrow(CanonicalizationError);
  });

  it("matches patterns unanchored like Python re.search", () => {
    expect(
      headersMatch(
        { authorization: { pattern: "Basic" } },
        {
          Authorization: "xx Basic yy",
        },
      ),
    ).toBe(true);
  });
});

describe("canonicalizeInteractions (rule 9)", () => {
  it("sorts loaded (JsonNumber-id) group members like native ones", () => {
    const loaded = parseLossless(
      '[{"unordered_group": 1, "request": {"method": "GET", "path": "/b", "params": {}}},' +
        ' {"unordered_group": 1, "request": {"method": "GET", "path": "/a", "params": {}}}]',
    ) as JsonValue[];
    const native: JsonValue[] = [
      {
        unordered_group: 1,
        request: { method: "GET", path: "/b", params: {} },
      },
      {
        unordered_group: 1,
        request: { method: "GET", path: "/a", params: {} },
      },
    ];
    expect(canonicalizeInteractions(loaded)).toBe(
      canonicalizeInteractions(native),
    );
    expect(canonicalizeInteractions(native)).toBe(
      '[{"request":{"method":"GET","params":{},"path":"/a"},"unordered_group":1},' +
        '{"request":{"method":"GET","params":{},"path":"/b"},"unordered_group":1}]',
    );
  });

  it("ignores boolean group markers (positions kept)", () => {
    const interactions: JsonValue[] = [
      { unordered_group: true, request: { method: "GET", path: "/z" } },
      { unordered_group: true, request: { method: "GET", path: "/a" } },
    ];
    const canonical = canonicalizeInteractions(interactions);
    // Positions kept: /z stays first because booleans are not group ids.
    expect(canonical.indexOf("/z")).toBeLessThan(canonical.indexOf("/a"));
  });
});

describe("integration with the lossless loader", () => {
  it("canonicalizes loaded documents (raw tokens preserved)", () => {
    const loaded = parseLossless('{"b": 18.0, "a": {"x": [1, 2.50]}}');
    expect(canonicalize(loaded)).toBe('{"a":{"x":[1,2.5]},"b":18.0}');
  });
});
