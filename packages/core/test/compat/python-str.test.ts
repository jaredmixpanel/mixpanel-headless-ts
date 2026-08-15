// TS-2 (D18 B/TS-2): tests written FIRST from R11.1 semantics + the D13 case
// list (semantic-trap watchlist item 8: str(True)/str(None) -> "True"/"None";
// bare String() would emit "true"/"null"). Every expected value below was
// produced by CPython str()/repr() (the oracle) on 2026-08-14.
import { describe, expect, it } from "vitest";
import { pythonRepr, pythonStr } from "../../src/compat/python-str.js";
import type { PythonValue } from "../../src/compat/python-str.js";

describe("pythonStr — D13 case list", () => {
  it('renders True/False capitalized: str(True) -> "True"', () => {
    expect(pythonStr(true)).toBe("True");
    expect(pythonStr(false)).toBe("False");
  });

  it('renders None: str(None) -> "None"', () => {
    expect(pythonStr(null)).toBe("None");
  });

  it("returns strings verbatim (str of a str adds no quotes)", () => {
    expect(pythonStr("hello")).toBe("hello");
    expect(pythonStr("")).toBe("");
    expect(pythonStr("😀")).toBe("😀");
    expect(pythonStr("it's")).toBe("it's");
  });

  it("renders list repr where contractual", () => {
    expect(pythonStr([1, 2, 3])).toBe("[1, 2, 3]");
    expect(pythonStr([])).toBe("[]");
    expect(pythonStr(["x", "y"])).toBe("['x', 'y']");
    expect(pythonStr([true, null, 1.5])).toBe("[True, None, 1.5]");
  });

  it("renders dict repr where contractual", () => {
    expect(pythonStr({})).toBe("{}");
    expect(pythonStr({ a: 1 })).toBe("{'a': 1}");
    expect(pythonStr({ a: true, b: null })).toBe("{'a': True, 'b': None}");
    expect(pythonStr({ k: [1, "two"] })).toBe("{'k': [1, 'two']}");
  });

  it("renders numbers: integers bare, floats via CPython float repr", () => {
    expect(pythonStr(18)).toBe("18");
    expect(pythonStr(-5)).toBe("-5");
    expect(pythonStr(1.5)).toBe("1.5");
    // Floats inside containers use float repr, exponent rule included.
    expect(pythonStr([1.5, 1e16])).toBe("[1.5, 1e+16]");
    expect(pythonStr({ f: -0 })).toBe("{'f': -0.0}");
  });

  it("renders bigints as plain decimal (Python int str, arbitrary precision)", () => {
    expect(pythonStr(9007199254740993n)).toBe("9007199254740993");
    expect(pythonStr(-42n)).toBe("-42");
  });
});

describe("pythonRepr — CPython string repr rules", () => {
  it("quotes with single quotes by default", () => {
    expect(pythonRepr("hello")).toBe("'hello'");
    expect(pythonRepr("a b")).toBe("'a b'");
    expect(pythonRepr(" ")).toBe("' '");
  });

  it("switches to double quotes when the string contains ' but not \"", () => {
    expect(pythonRepr("it's")).toBe('"it\'s"');
  });

  it('keeps single quotes when the string contains " only', () => {
    expect(pythonRepr('say "hi"')).toBe("'say \"hi\"'");
  });

  it("escapes the single quote when BOTH quote kinds appear", () => {
    expect(pythonRepr("both ' and \"")).toBe("'both \\' and \"'");
  });

  it("escapes backslash, tab, newline, carriage return", () => {
    expect(pythonRepr("back\\slash")).toBe("'back\\\\slash'");
    expect(pythonRepr("tab\tnewline\n")).toBe("'tab\\tnewline\\n'");
    expect(pythonRepr("\r")).toBe("'\\r'");
  });

  it("escapes non-printable characters below U+0100 as \\xXX", () => {
    expect(pythonRepr("null\x00char")).toBe("'null\\x00char'");
    expect(pythonRepr("\x1b[0m")).toBe("'\\x1b[0m'");
    expect(pythonRepr("\x7f")).toBe("'\\x7f'");
    expect(pythonRepr("\x85")).toBe("'\\x85'");
    expect(pythonRepr("nb\xa0space")).toBe("'nb\\xa0space'");
    expect(pythonRepr("\xad")).toBe("'\\xad'");
  });

  it("escapes non-printable BMP characters as \\uXXXX", () => {
    expect(pythonRepr("​")).toBe("'\\u200b'");
    expect(pythonRepr(" ")).toBe("'\\u2028'");
  });

  it("escapes non-printable astral characters as \\UXXXXXXXX", () => {
    expect(pythonRepr("\u{e0001}")).toBe("'\\U000e0001'");
  });

  it("keeps printable non-BMP characters verbatim (R10.9 non-BMP edge)", () => {
    expect(pythonRepr("😀")).toBe("'😀'");
    expect(pythonRepr("\u{1d7d8}")).toBe("'\u{1d7d8}'");
    expect(pythonRepr("mixed😀\x01end")).toBe("'mixed😀\\x01end'");
  });

  it("escapes lone surrogates (illegal in vectors, but never mangled)", () => {
    expect(pythonRepr("\ud800")).toBe("'\\ud800'");
  });

  it("reprs booleans, None and numbers like the top-level forms", () => {
    expect(pythonRepr(true)).toBe("True");
    expect(pythonRepr(null)).toBe("None");
    expect(pythonRepr(18)).toBe("18");
    expect(pythonRepr(1.5)).toBe("1.5");
  });

  it("renders self-referential containers the way CPython does", () => {
    const list: PythonValue[] = [];
    list.push(list);
    expect(pythonRepr(list)).toBe("[[...]]");
    const dict: { [key: string]: PythonValue } = {};
    dict["x"] = dict;
    expect(pythonRepr(dict)).toBe("{'x': {...}}");
  });

  it("rejects undefined — absent is not None (watchlist item 4 tri-state)", () => {
    expect(() => pythonStr(undefined as unknown as PythonValue)).toThrow(
      TypeError,
    );
    expect(() => pythonRepr(undefined as unknown as PythonValue)).toThrow(
      TypeError,
    );
  });
});
