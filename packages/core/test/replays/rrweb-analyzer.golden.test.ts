// rrweb-analyzer GOLDEN suite (plan Layer 3,
// `context/typescript-port-plan.md:351-354`; packet B5-S3 §5
// "Golden-file suite").
//
// The goldens under `goldens/` are GENERATED — never hand-edit them.
// Regenerate from the Python repo (the behaviour arbiter):
//
//   uv run python conformance/goldens/rrweb/generate.py
//   cp conformance/goldens/rrweb/*.golden.json \
//      ../mixpanel-headless-ts/packages/core/test/replays/goldens/
//
// Fixture provenance:
// - `sample-replay-001` — copied verbatim from the Python repo's
//   `tests/fixtures/rrweb/sample-replay-001.json` (the same stream the
//   `authored-sample-replay-001-golden` corpus vector replays).
// - `synthetic-mixed-001` — defined in the generator; widens coverage to
//   selection over a non-BMP text node, ancestor-context descriptions,
//   the markdown (×N) run collapse, mutation add/remove/text/attribute,
//   checkbox input, scroll, console-plugin errors, and the two no-op
//   branches (non-error level, unknown interaction type).
// - `empty-stream` — the `analyze([])` early return.
//
// The READ-ONLY `analytics` repo's `iron/replay-embed/__test__/
// fixtures.ts` was inspected per packet §5: its builders
// (`metaEvent`/`fullSnapshotEvent`/`interactionEvent`) produce strictly
// simpler streams than the two fixtures above, so nothing was extracted.
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
