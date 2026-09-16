// The playground's conversion matrix (docs/.vitepress/theme/demo/model/
// matrix.ts): the loop program the code panel prints is built from the
// same event array and option literal as the calls that run (the pairs are
// re-derived here from the printed array with the program's own
// expression), it is laid out as Prettier would print it, the helper shown
// under it is the helper that chains (its source text is held to the
// module), and the matrix over the demo fixtures tells the story the
// fixtures were made to tell.

import { format } from "prettier";
import { describe, expect, it } from "vitest";

import { DEMO_FIXTURES } from "../docs/.vitepress/theme/demo/fixtures/demo-project.gen.js";
import {
  READ_METHODS,
  runCall,
} from "../docs/.vitepress/theme/demo/model/call.js";
import { fixtureCoverage } from "../docs/.vitepress/theme/demo/model/fixture-fetch.js";
import {
  BEST_PATH_SOURCE,
  bestPath,
  matrixCalls,
  matrixColumns,
  matrixRows,
  type MatrixSpec,
  MAX_POOL,
  MIN_POOL,
  orderedPairs,
  PATH_STEPS,
  renderMatrixProgram,
  seedPool,
  sweepCalls,
} from "../docs/.vitepress/theme/demo/model/matrix.js";
import {
  CONVERSION_WINDOWS,
  type ConversionWindow,
  TIME_RANGES,
} from "../docs/.vitepress/theme/demo/model/query-spec.js";
import type { FunnelResult } from "../docs/.vitepress/theme/demo/model/series.js";
import {
  declarationOf,
  fixtureWorkspace,
  reparse,
} from "./demo-program-helpers.js";

const MODULE = "docs/.vitepress/theme/demo/model/matrix.ts";

const today = (): Date => new Date(2026, 8, 15);

/** The events the fixtures record funnels for, in their order. */
const POOL = fixtureCoverage(DEMO_FIXTURES).funnelEvents;

/** The default offline run: the whole pool, a 7-day window, 30 days. */
const DEFAULT_SPEC: MatrixSpec = {
  kind: "matrix",
  events: seedPool(
    DEMO_FIXTURES.topEvents.map((row) => row.event),
    POOL,
  ),
  conversionWindow: 7,
  last: 30,
};

const SMALL_SPEC: MatrixSpec = {
  kind: "matrix",
  events: ["Signup", "Note Saved", "Note Shared"],
  conversionWindow: 7,
  last: 30,
};

/**
 * A funnel result that reports one overall rate (for the synthetic
 * `bestPath` cases).
 *
 * @param rate - The overall conversion.
 * @returns A stand-in result.
 */
const fake = (rate: number): FunnelResult =>
  ({ overall_conversion_rate: rate }) as unknown as FunnelResult;

/**
 * The event array and option literal of a rendered program, as printed.
 *
 * @param program - `renderMatrixProgram(spec)`.
 * @returns The two literals' text.
 */
function literals(program: string): { events: string; options: string } {
  const events = /^const events = (\[[\s\S]*?\]);$/mu.exec(program);
  const call = /await ws\.queryFunnel\(\[from, to\], (\{[^}]*\})\),$/mu.exec(
    program,
  );
  expect(events, "events literal").not.toBeNull();
  expect(call, "queryFunnel call").not.toBeNull();
  return { events: events?.[1] ?? "", options: call?.[1] ?? "" };
}

/**
 * Run a matrix's calls the way the page does — sequentially, through
 * `runCall` — and return the results in pair order.
 *
 * @param spec - The report.
 * @returns One result per ordered pair.
 */
async function runMatrix(spec: MatrixSpec): Promise<FunnelResult[]> {
  const ws = fixtureWorkspace(today);
  const matrix: FunnelResult[] = [];
  for (const call of matrixCalls(spec)) {
    matrix.push((await runCall(ws, call)) as FunnelResult);
  }
  return matrix;
}

/**
 * One cell of a run's matrix.
 *
 * @param spec - The report.
 * @param matrix - Its results.
 * @param from - First step.
 * @param to - Second step.
 * @returns The overall conversion of `from → to`.
 */
function cell(
  spec: MatrixSpec,
  matrix: readonly FunnelResult[],
  from: string,
  to: string,
): number {
  const i = orderedPairs(spec.events).findIndex(
    ([a, b]) => a === from && b === to,
  );
  expect(i, `${from} → ${to}`).toBeGreaterThan(-1);
  return matrix[i]?.overall_conversion_rate ?? Number.NaN;
}

describe("orderedPairs and the pool", () => {
  it("lists every ordered pair by first step, then second", () => {
    expect(orderedPairs(["A", "B", "C"])).toStrictEqual([
      ["A", "B"],
      ["A", "C"],
      ["B", "A"],
      ["B", "C"],
      ["C", "A"],
      ["C", "B"],
    ]);
    expect(orderedPairs([])).toStrictEqual([]);
  });

  it("the default offline pool is exactly the fixtures' funnel pool, in top-event order", () => {
    expect(DEFAULT_SPEC.events).toStrictEqual([
      "App Opened",
      "Note Saved",
      "Note Shared",
      "Signup",
      "Upgrade",
    ]);
    expect([...DEFAULT_SPEC.events].sort()).toStrictEqual([...POOL].sort());
    expect(DEFAULT_SPEC.events).toHaveLength(MAX_POOL);
    expect(MIN_POOL).toBeLessThanOrEqual(MAX_POOL);
  });

  it("seeds from the top events, capped at the pool size, within the allowed set", () => {
    const top = Array.from({ length: 9 }, (_, i) => `E${String(i)}`);
    expect(seedPool(top, null)).toStrictEqual(top.slice(0, MAX_POOL));
    expect(seedPool(top, ["E4", "E1", "E9"])).toStrictEqual(["E1", "E4"]);
  });
});

describe("matrixCalls", () => {
  it("builds one queryFunnel call per ordered pair, in pair order, with the same option literal", () => {
    const calls = matrixCalls(DEFAULT_SPEC);
    const pairs = orderedPairs(DEFAULT_SPEC.events);
    expect(calls).toHaveLength(MAX_POOL * (MAX_POOL - 1));
    for (const [i, call] of calls.entries()) {
      expect(call.method).toBe("queryFunnel");
      expect(READ_METHODS).toContain(call.method);
      expect(call.args).toStrictEqual([
        [...(pairs[i] ?? [])],
        { conversion_window: 7, last: 30 },
      ]);
      expect(call.binding).toBe(`matrix[${String(i)}]`);
      expect(call.imports).toStrictEqual([]);
    }
  });

  it("never emits limit", () => {
    for (const call of matrixCalls(DEFAULT_SPEC)) {
      expect(JSON.stringify(call.args)).not.toContain("limit");
    }
  });
});

describe("sweepCalls", () => {
  it("binds each window's call to sweep<window>, under the run's range", () => {
    const calls = sweepCalls(["Signup", "Note Saved"], [1, 14, 30], 90);
    expect(calls.map((call) => call.binding)).toStrictEqual([
      "sweep1",
      "sweep14",
      "sweep30",
    ]);
    expect(calls.map((call) => call.args)).toStrictEqual(
      [1, 14, 30].map((window) => [
        ["Signup", "Note Saved"],
        { conversion_window: window, last: 90 },
      ]),
    );
    expect(sweepCalls(["A", "B"], [], 30)).toStrictEqual([]);
  });
});

describe("renderMatrixProgram", () => {
  it("prints the default offline run", () => {
    expect(renderMatrixProgram(SMALL_SPEC))
      .toBe(`const events = ["Signup", "Note Saved", "Note Shared"];
const pairs = events.flatMap((from) =>
  events.filter((to) => to !== from).map((to) => [from, to] as const),
);
const matrix = [];
for (const [from, to] of pairs) {
  matrix.push(
    await ws.queryFunnel([from, to], { conversion_window: 7, last: 30 }),
  );
}
const path = bestPath(events, matrix, { steps: 3 });
`);
  });

  it("keeps the event array inline at exactly 80 columns and breaks it beyond", () => {
    const [first = ""] = renderMatrixProgram(DEFAULT_SPEC).split("\n", 1);
    expect(first).toHaveLength(80);
    expect(first).toBe(
      'const events = ["App Opened", "Note Saved", "Note Shared", "Signup", "Upgrade"];',
    );
    const wider: MatrixSpec = {
      ...DEFAULT_SPEC,
      events: [...DEFAULT_SPEC.events.slice(0, 4), "Settings Changed"],
    };
    expect(renderMatrixProgram(wider)).toMatch(
      /^const events = \[\n {2}"App Opened",\n {2}"Note Saved",\n {2}"Note Shared",\n {2}"Signup",\n {2}"Settings Changed",\n\];\n/u,
    );
  });

  const ROUND_TRIP: ReadonlyArray<readonly [string, MatrixSpec]> = [
    ["three events", SMALL_SPEC],
    ["the default pool", DEFAULT_SPEC],
    [
      "a 14-day window over 90 days",
      { ...DEFAULT_SPEC, conversionWindow: 14, last: 90 },
    ],
  ];

  it.each(ROUND_TRIP)(
    "re-parses to the executed calls' arguments: %s",
    (_name, spec) => {
      const { events, options } = literals(renderMatrixProgram(spec));
      const parsedEvents = reparse(events) as string[];
      const parsedOptions = reparse(options);
      // The pairs as the printed program derives them, expression for expression.
      const pairs = parsedEvents.flatMap((from) =>
        parsedEvents
          .filter((to) => to !== from)
          .map((to) => [from, to] as const),
      );
      const calls = matrixCalls(spec);
      expect(pairs).toHaveLength(calls.length);
      for (const [i, call] of calls.entries()) {
        expect(call.args).toStrictEqual([[...(pairs[i] ?? [])], parsedOptions]);
      }
    },
  );

  const LAYOUTS: ReadonlyArray<readonly [string, MatrixSpec]> = [
    ["three events", SMALL_SPEC],
    ["the default pool", DEFAULT_SPEC],
    [
      "five long names at the longest window and range",
      {
        ...DEFAULT_SPEC,
        events: Array.from(
          { length: MAX_POOL },
          (_, i) => `Conversion Matrix Event Number ${String(i + 1)}`,
        ),
        conversionWindow: 30,
        last: 90,
      },
    ],
  ];

  it.each(LAYOUTS)(
    "is laid out as Prettier prints it: %s",
    async (_name, spec) => {
      const program = renderMatrixProgram(spec);
      await expect(format(program, { parser: "typescript" })).resolves.toBe(
        program,
      );
    },
  );

  it("appends a cell's sweep as plain statements, still as Prettier prints them", async () => {
    const sweep = sweepCalls(["Signup", "Note Saved"], [1, 14, 30], 30);
    const program = renderMatrixProgram(DEFAULT_SPEC, sweep);
    expect(program.split("\n").slice(-13, -1).join("\n"))
      .toBe(`const sweep1 = await ws.queryFunnel(["Signup", "Note Saved"], {
  conversion_window: 1,
  last: 30,
});
const sweep14 = await ws.queryFunnel(["Signup", "Note Saved"], {
  conversion_window: 14,
  last: 30,
});
const sweep30 = await ws.queryFunnel(["Signup", "Note Saved"], {
  conversion_window: 30,
  last: 30,
});`);
    await expect(format(program, { parser: "typescript" })).resolves.toBe(
      program,
    );
  });

  it("ends the loop with the best path over three steps", () => {
    expect(renderMatrixProgram(SMALL_SPEC)).toContain(
      `const path = bestPath(events, matrix, { steps: ${String(PATH_STEPS)} });`,
    );
    expect(PATH_STEPS).toBe(3);
  });
});

describe("BEST_PATH_SOURCE", () => {
  it("is the declaration of bestPath in the module", () => {
    expect(BEST_PATH_SOURCE).toBe(declarationOf(MODULE, "bestPath"));
  });
});

describe("bestPath over the demo fixtures", () => {
  it("chains Signup → Note Saved → Note Shared at about 23% for the default run", async () => {
    const matrix = await runMatrix(DEFAULT_SPEC);
    const path = bestPath(DEFAULT_SPEC.events, matrix, { steps: PATH_STEPS });
    expect(path.events).toStrictEqual(["Signup", "Note Saved", "Note Shared"]);
    expect(path.estimate).toBeGreaterThan(0.22);
    expect(path.estimate).toBeLessThan(0.24);
    expect(path.estimate).toBeCloseTo(
      cell(DEFAULT_SPEC, matrix, "Signup", "Note Saved") *
        cell(DEFAULT_SPEC, matrix, "Note Saved", "Note Shared"),
      12,
    );
  });

  it("estimates within a point of the real three-step funnel", async () => {
    const matrix = await runMatrix(DEFAULT_SPEC);
    const path = bestPath(DEFAULT_SPEC.events, matrix, { steps: PATH_STEPS });
    const funnel = await fixtureWorkspace(today).queryFunnel([...path.events], {
      conversion_window: DEFAULT_SPEC.conversionWindow,
      last: DEFAULT_SPEC.last,
    });
    expect(
      Math.abs(funnel.overall_conversion_rate - path.estimate),
    ).toBeLessThan(0.01);
  });

  it("the matrix has visible structure", async () => {
    const matrix = await runMatrix(DEFAULT_SPEC);
    const at = (from: string, to: string): number =>
      cell(DEFAULT_SPEC, matrix, from, to);
    expect(at("Signup", "Note Saved")).toBeGreaterThan(0.55);
    expect(at("Signup", "Note Saved")).toBe(
      Math.max(...matrix.map((result) => result.overall_conversion_rate)),
    );
    expect(at("Note Saved", "Note Shared")).toBeGreaterThan(0.3);
    expect(at("Signup", "Upgrade")).toBeLessThan(0.1);
    expect(at("App Opened", "Signup")).toBeLessThan(0.05);
    for (const result of matrix) {
      expect(result.overall_conversion_rate).toBeGreaterThan(0);
      expect(result.overall_conversion_rate).toBeLessThanOrEqual(1);
    }
  });

  it.each(
    CONVERSION_WINDOWS.flatMap((conversionWindow) =>
      TIME_RANGES.map((last) => [conversionWindow, last] as const),
    ),
  )(
    "keeps the same path at a %d-day window over %d days",
    async (conversionWindow: ConversionWindow, last) => {
      const spec: MatrixSpec = { ...DEFAULT_SPEC, conversionWindow, last };
      const matrix = await runMatrix(spec);
      expect(
        bestPath(spec.events, matrix, { steps: PATH_STEPS }).events,
      ).toStrictEqual(["Signup", "Note Saved", "Note Shared"]);
    },
  );
});

describe("bestPath", () => {
  const events = ["A", "B", "C", "D"];
  /**
   * A matrix from a rate table.
   *
   * @param rates - `from>to` → rate; missing pairs are `null` (failed).
   * @returns Results in pair order.
   */
  const matrixOf = (
    rates: Readonly<Record<string, number>>,
  ): Array<FunnelResult | null> =>
    orderedPairs(events).map(([from, to]) => {
      const rate = rates[`${from}>${to}`];
      return rate === undefined ? null : fake(rate);
    });

  it("starts at the strongest pair and extends to the best unused event", () => {
    const matrix = matrixOf({
      "A>B": 0.5,
      "B>C": 0.4,
      "B>D": 0.45,
      "D>C": 0.3,
      "C>A": 0.2,
    });
    expect(bestPath(events, matrix, { steps: 3 })).toStrictEqual({
      events: ["A", "B", "D"],
      estimate: 0.5 * 0.45,
    });
    expect(bestPath(events, matrix, { steps: 2 })).toStrictEqual({
      events: ["A", "B"],
      estimate: 0.5,
    });
    // `B → A` is unused-only: the path never revisits an event.
    expect(bestPath(events, matrix, { steps: 4 }).events).toStrictEqual([
      "A",
      "B",
      "D",
      "C",
    ]);
  });

  it("starts at the strongest pair even when it is not the first", () => {
    const matrix = matrixOf({ "A>B": 0.5, "D>C": 0.9, "C>A": 0.7 });
    expect(bestPath(events, matrix, { steps: 3 }).events).toStrictEqual([
      "D",
      "C",
      "A",
    ]);
  });

  it("breaks ties by pool order", () => {
    const matrix = matrixOf({ "A>B": 0.5, "C>D": 0.5, "B>C": 0.2, "B>D": 0.2 });
    expect(bestPath(events, matrix, { steps: 3 }).events).toStrictEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("stops early when no unused event converts, and skips failed pairs", () => {
    expect(
      bestPath(events, matrixOf({ "A>B": 0.3 }), { steps: 3 }),
    ).toStrictEqual({ events: ["A", "B"], estimate: 0.3 });
    expect(
      bestPath(["A", "B"], matrixOf({ "A>B": 0.3 }).slice(0, 2), { steps: 3 }),
    ).toStrictEqual({ events: ["A", "B"], estimate: 0.3 });
  });

  it("returns an empty path when nothing converted", () => {
    expect(bestPath(events, matrixOf({}), { steps: 3 })).toStrictEqual({
      events: [],
      estimate: 0,
    });
    expect(bestPath([], [], { steps: 3 })).toStrictEqual({
      events: [],
      estimate: 0,
    });
  });
});

describe("matrixRows and matrixColumns", () => {
  it("exports raw rates under a from column and one column per event", async () => {
    const matrix = await runMatrix(SMALL_SPEC);
    const columns = matrixColumns(SMALL_SPEC.events);
    expect(columns).toStrictEqual([
      "from",
      "Signup",
      "Note Saved",
      "Note Shared",
    ]);
    const rows = matrixRows(SMALL_SPEC.events, matrix);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.["from"]).toBe("Signup");
    expect(rows[0]?.["Signup"]).toBe("");
    expect(rows[0]?.["Note Saved"]).toBe(
      cell(SMALL_SPEC, matrix, "Signup", "Note Saved"),
    );
    expect(rows[2]?.["Note Shared"]).toBe("");
  });

  it("leaves a failed pair blank", () => {
    const rows = matrixRows(["A", "B"], [null, fake(0.2)]);
    expect(rows).toStrictEqual([
      { from: "A", A: "", B: "" },
      { from: "B", A: 0.2, B: "" },
    ]);
  });
});
