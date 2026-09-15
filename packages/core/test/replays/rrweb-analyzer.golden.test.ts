// RrwebAnalyzer golden suite: the analyzer's frozen projection of each fixture
// stream must equal the golden written by the Python repo's
// `conformance/goldens/rrweb/generate.py`. Goldens are GENERATED — regenerate
// (`uv run python conformance/goldens/rrweb/generate.py`, then copy the
// `*.golden.json` files into `./goldens/`), never hand-edit them. Additive.
import { describe, expect, it } from "vitest";

import {
  analyzeEvents,
  RrwebAnalyzer,
} from "../../src/replays/rrweb-analyzer.js";
import sampleEvents from "./fixtures/sample-replay-001.json" with { type: "json" };
import syntheticMixed001 from "./fixtures/synthetic-mixed-001.input.json" with { type: "json" };
import emptyStreamGolden from "./goldens/empty-stream.golden.json" with { type: "json" };
import sampleGolden from "./goldens/sample-replay-001.golden.json" with { type: "json" };
import syntheticGolden from "./goldens/synthetic-mixed-001.golden.json" with { type: "json" };

/** The frozen golden shape the Python generator writes. */
interface Golden {
  readonly actions: ReadonlyArray<Record<string, unknown>>;
  readonly markdown: string;
  readonly page_visits: ReadonlyArray<Record<string, unknown>>;
  readonly console_errors: ReadonlyArray<Record<string, unknown>>;
}

/**
 * Run the TS analyzer and project the SAME shape the Python generator
 * freezes (`conformance/goldens/rrweb/generate.py::_freeze`).
 *
 * @param events - Raw rrweb event dicts.
 * @returns The comparable projection.
 */
function freeze(
  events: ReadonlyArray<Readonly<Record<string, unknown>>>,
): Golden {
  const result = new RrwebAnalyzer().analyze(events);
  return {
    actions: result.actions.map((a) => a.toJSON()),
    markdown: result.markdown_summary,
    page_visits: result.pages.map((p) => ({
      timestamp: p.timestamp,
      url: p.url,
    })),
    console_errors: result.errors.map((e) => ({
      timestamp: e.timestamp,
      message: e.message,
      url: e.url,
    })),
  };
}

describe("rrweb analyzer goldens", () => {
  // sample-replay-001 is the Python repo's tests/fixtures/rrweb stream;
  // synthetic-mixed-001 is defined by the generator to widen coverage.
  it.each([
    ["sample-replay-001", sampleEvents, sampleGolden],
    ["synthetic-mixed-001", syntheticMixed001, syntheticGolden],
    ["empty-stream", [], emptyStreamGolden],
  ] as ReadonlyArray<
    readonly [string, ReadonlyArray<Readonly<Record<string, unknown>>>, unknown]
  >)("matches the Python golden for %s", (_name, events, golden) => {
    expect(freeze(events)).toStrictEqual(golden);
  });

  it("analyzeEvents() agrees with analyze().markdown_summary", () => {
    // The generator cross-checks the same invariant on the Python side.
    for (const events of [sampleEvents, syntheticMixed001] as ReadonlyArray<
      ReadonlyArray<Readonly<Record<string, unknown>>>
    >) {
      expect(analyzeEvents(events)).toBe(
        new RrwebAnalyzer().analyze(events).markdown_summary,
      );
    }
  });
});
