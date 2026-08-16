// B5-ARB regression locks (finding FID-F3, `b5-review-resolution.md`):
// Python's `int(e.get("timestamp", 0))` defaults ONLY when the key is
// ABSENT — an explicit JSON `"timestamp": null` reaches `int(None)` and
// raises `TypeError`. The pre-fix TS spelled the read
// `pythonIntCoerce(x["timestamp"] ?? 0)`, and `null ?? 0` silently
// coerced to `0` (wrong success, oracle-confirmed through both
// bridges). Python's `sorted(key=...)` also computes the key for EVERY
// element — including single-element lists where a JS comparator would
// never run — so the TS sort decorates first.
//
// Every expectation below is a live-CPython probe result recorded in
// the resolution document. ADDITIVE — substitutes for no Python file.

import { describe, expect, it } from "vitest";
import { RrwebAnalyzer } from "../../src/replays/rrweb-analyzer.js";

/** The int(None) ladder message CPython raises (probe-verified). */
const INT_NONE_RE =
  /int\(\) argument must be a string, a bytes-like object or a real number, not 'NoneType'/;

describe("FID-F3: RrwebAnalyzer.analyze null vs absent timestamps", () => {
  it("a SINGLE event with timestamp:null raises (Python computes sort keys for 1-element lists)", () => {
    const analyzer = new RrwebAnalyzer();
    expect(() =>
      analyzer.analyze([{ type: 3, data: { source: 3 }, timestamp: null }]),
    ).toThrow(INT_NONE_RE);
  });

  it("a single event with an ABSENT timestamp key defaults to 0 and succeeds", () => {
    // CPython: analyze([{type:3, data:{source:3}}]) -> AnalyzerResult
    const analyzer = new RrwebAnalyzer();
    const result = analyzer.analyze([{ type: 3, data: { source: 3 } }]);
    expect(result.actions).toEqual([]);
  });

  it("two events with one null timestamp raise before any processing", () => {
    const analyzer = new RrwebAnalyzer();
    expect(() =>
      analyzer.analyze([
        { type: 3, data: { source: 3 }, timestamp: 1 },
        { type: 3, data: { source: 3 }, timestamp: null },
      ]),
    ).toThrow(INT_NONE_RE);
  });

  it("string timestamps still parse through the CPython int() ladder", () => {
    // CPython: timestamp "3000" -> ok
    const analyzer = new RrwebAnalyzer();
    expect(() =>
      analyzer.analyze([{ type: 3, data: { source: 3 }, timestamp: "3000" }]),
    ).not.toThrow();
  });
});
