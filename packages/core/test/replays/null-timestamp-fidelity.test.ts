// RrwebAnalyzer.analyze: an explicit `"timestamp": null` must raise like
// CPython's `int(None)`, while an ABSENT key defaults to 0 — `null ?? 0` would
// silently succeed. Python's `sorted(key=...)` computes the key for every
// element (even one-element lists), so the TS sort decorates first. Additive:
// no Python twin; every expectation is a recorded live-CPython probe result.

import { describe, expect, it } from "vitest";

import { RrwebAnalyzer } from "../../src/replays/rrweb-analyzer.js";

/** The int(None) ladder message CPython raises (probe-verified). */
const INT_NONE_RE =
  /int\(\) argument must be a string, a bytes-like object or a real number, not 'NoneType'/;

describe("RrwebAnalyzer.analyze: null vs absent timestamps", () => {
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
    expect(result.actions).toStrictEqual([]);
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
