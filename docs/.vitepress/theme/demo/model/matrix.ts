// The "Conversion matrix" report: which events lead where. Funnels shows
// one path at a time; here one two-step `queryFunnel` runs per ordered pair
// of a small event pool, the overall conversion of each fills a heatmap,
// and a greedy chain of the strongest pairs proposes a three-step funnel.
// The single-source rule holds as in the ranking report: the calls that run
// and the program the code panel prints come from the same event array and
// option literal (tests/demo-matrix.test.ts derives the pairs from the
// printed array and matches them to the executed calls), and the helper on
// screen is pinned to the source text of the one that chains.

import { type Call, type CallArg, renderCall } from "./call.js";
import type { ConversionWindow, TimeRange } from "./query-spec.js";
import type { FunnelResult } from "./series.js";

/**
 * Events the pool holds at most: `n × (n − 1)` funnel queries per run, so
 * five events cost twenty of the Query API's sixty per hour.
 */
export const MAX_POOL = 5;

/** Events the pool needs before a matrix says anything a funnel would not. */
export const MIN_POOL = 3;

/** Steps the best path chains. */
export const PATH_STEPS = 3;

/** Prettier's print width for the site. */
const PRINT_WIDTH = 80;

/** The report's UI state: the pool, the window, the range. */
export interface MatrixSpec {
  readonly kind: "matrix";
  readonly events: readonly string[];
  readonly conversionWindow: ConversionWindow;
  readonly last: TimeRange;
}

/** An ordered pair of events: the two steps of one funnel query. */
export type MatrixPair = readonly [from: string, to: string];

/** What `bestPath` returns. */
export interface BestPath {
  /** The chained events, first step first; shorter than asked when the pool runs out. */
  readonly events: readonly string[];
  /**
   * The product of the pairwise rates — an estimate of the three-step
   * funnel's overall conversion, not its measurement (that is what
   * running the funnel gives).
   */
  readonly estimate: number;
}

// The option literal every pair's call carries (and the loop prints).
const funnelOptions = (
  conversionWindow: ConversionWindow,
  last: TimeRange,
): Record<string, CallArg> => ({
  conversion_window: conversionWindow,
  last,
});

/**
 * Every ordered pair of the pool, in the order the printed program's
 * `flatMap` produces them: by first step, then by second.
 *
 * @param events - The pool.
 * @returns `n × (n − 1)` pairs.
 * @example
 * ```ts
 * orderedPairs(["A", "B", "C"]);
 * // [["A", "B"], ["A", "C"], ["B", "A"], ["B", "C"], ["C", "A"], ["C", "B"]]
 * ```
 */
export function orderedPairs(events: readonly string[]): MatrixPair[] {
  return events.flatMap((from) =>
    events.filter((to) => to !== from).map((to): MatrixPair => [from, to]),
  );
}

/**
 * The default pool: the top events in volume order, restricted to what
 * the data source can answer, capped at {@link MAX_POOL}.
 *
 * @param top - Event names as `ws.topEvents()` ordered them.
 * @param allowed - The events with funnel data, or `null` when every event
 *   is allowed (live mode).
 * @returns At most {@link MAX_POOL} events.
 * @example
 * ```ts
 * seedPool(["App Opened", "Search", "Signup"], ["Signup", "App Opened"]);
 * // ["App Opened", "Signup"]
 * ```
 */
export function seedPool(
  top: readonly string[],
  allowed: readonly string[] | null,
): string[] {
  return top
    .filter((event) => allowed === null || allowed.includes(event))
    .slice(0, MAX_POOL);
}

/**
 * One `queryFunnel` call per ordered pair, in {@link orderedPairs} order —
 * the calls the loop runs, bound to `matrix[i]` as the loop's `push` would.
 *
 * @param spec - The report's state.
 * @returns The calls to execute, sequentially.
 * @example
 * ```ts
 * matrixCalls({ kind: "matrix", events: ["A", "B"], conversionWindow: 7, last: 30 });
 * // [{ method: "queryFunnel", args: [["A", "B"], { conversion_window: 7, last: 30 }], binding: "matrix[0]", imports: [] },
 * //  { method: "queryFunnel", args: [["B", "A"], { conversion_window: 7, last: 30 }], binding: "matrix[1]", imports: [] }]
 * ```
 */
export function matrixCalls(spec: MatrixSpec): Call[] {
  return orderedPairs(spec.events).map((pair, i) => ({
    method: "queryFunnel",
    args: [[...pair], funnelOptions(spec.conversionWindow, spec.last)],
    binding: `matrix[${String(i)}]`,
    imports: [],
  }));
}

/**
 * The calls a cell's window sweep runs: the same pair at each window not
 * fetched yet, each bound to `sweep<window>`.
 *
 * @param pair - The cell's pair.
 * @param windows - The windows still to fetch, ascending.
 * @param last - The matrix run's range (the sweep must match its cell).
 * @returns One call per window.
 * @example
 * ```ts
 * sweepCalls(["Signup", "Note Saved"], [1, 14, 30], 30)[0];
 * // { method: "queryFunnel", args: [["Signup", "Note Saved"], { conversion_window: 1, last: 30 }], binding: "sweep1", imports: [] }
 * ```
 */
export function sweepCalls(
  pair: MatrixPair,
  windows: readonly ConversionWindow[],
  last: TimeRange,
): Call[] {
  return windows.map((window) => ({
    method: "queryFunnel",
    args: [[...pair], funnelOptions(window, last)],
    binding: `sweep${String(window)}`,
    imports: [],
  }));
}

/**
 * The program the code panel shows for a run: the event array, the pairs
 * derived from it, the loop over `queryFunnel` with the same option
 * literal the calls carry, the best path — then, once a cell's sweep has
 * run, its calls as plain statements. Laid out as Prettier prints it, so a
 * copied block survives the site's formatter unchanged.
 *
 * @param spec - The report's state.
 * @param sweep - The sweep calls that have run, if any.
 * @returns The program text, trailing newline included.
 * @example
 * ```ts
 * renderMatrixProgram({ kind: "matrix", events: ["A", "B"], conversionWindow: 7, last: 30 });
 * // const events = ["A", "B"]; // one per line once the statement passes 80 columns
 * // const pairs = events.flatMap((from) =>
 * //   events.filter((to) => to !== from).map((to) => [from, to] as const),
 * // );
 * // const matrix = [];
 * // for (const [from, to] of pairs) {
 * //   matrix.push(
 * //     await ws.queryFunnel([from, to], { conversion_window: 7, last: 30 }),
 * //   );
 * // }
 * // const path = bestPath(events, matrix, { steps: 3 });
 * ```
 */
export function renderMatrixProgram(
  spec: MatrixSpec,
  sweep: readonly Call[] = [],
): string {
  // The array stays on one line while the whole statement fits the print
  // width (Prettier's rule), otherwise one event per line.
  const items = spec.events.map((event) => JSON.stringify(event));
  const inline = `const events = [${items.join(", ")}];`;
  const events =
    inline.length <= PRINT_WIDTH
      ? inline
      : `const events = [\n${items.map((item) => `  ${item},\n`).join("")}];`;
  // The option bag stays on one line: the statement fits the print width
  // whatever the window and range, since neither operand is an event name.
  const options = `{ conversion_window: ${String(spec.conversionWindow)}, last: ${String(spec.last)} }`;
  return [
    events,
    "const pairs = events.flatMap((from) =>",
    "  events.filter((to) => to !== from).map((to) => [from, to] as const),",
    ");",
    "const matrix = [];",
    "for (const [from, to] of pairs) {",
    "  matrix.push(",
    `    await ws.queryFunnel([from, to], ${options}),`,
    "  );",
    "}",
    `const path = bestPath(events, matrix, { steps: ${String(PATH_STEPS)} });`,
    ...sweep.map((call) => renderCall(call)),
    "",
  ].join("\n");
}

/**
 * Chain the strongest pairs into a funnel: start at the ordered pair with
 * the highest overall conversion, then extend from its last event to the
 * unused event it converts to best, until the path has `steps` events or
 * no event is left. Ties go to the earlier pair in pool order. The
 * estimate is the product of the pairwise rates — the real funnel over
 * the same steps is what "Open as funnel" runs.
 *
 * @param events - The pool, index-aligned with `orderedPairs(events)`.
 * @param matrix - One `queryFunnel` result per ordered pair, in that
 *   order; `null` where the query failed.
 * @param options - `steps`: how many events to chain.
 * @returns The path and its estimate (`[]` and 0 when nothing converted).
 * @example
 * ```ts
 * bestPath(events, matrix, { steps: 3 });
 * // { events: ["Signup", "Note Saved", "Note Shared"], estimate: 0.2318 }
 * ```
 */
export function bestPath(
  events: readonly string[],
  matrix: ReadonlyArray<FunnelResult | null>,
  options: { readonly steps: number },
): BestPath {
  const pairs = orderedPairs(events);
  const rate = (from: string, to: string): number => {
    const i = pairs.findIndex(([a, b]) => a === from && b === to);
    return matrix[i]?.overall_conversion_rate ?? 0;
  };
  let start: MatrixPair | null = null;
  for (const pair of pairs) {
    if (start === null || rate(...pair) > rate(...start)) {
      start = pair;
    }
  }
  if (start === null || rate(...start) <= 0) {
    return { events: [], estimate: 0 };
  }
  const path = [...start];
  let estimate = rate(...start);
  while (path.length < options.steps) {
    const from = path.at(-1) ?? "";
    let next: string | null = null;
    for (const to of events) {
      if (
        !path.includes(to) &&
        (next === null || rate(from, to) > rate(from, next))
      ) {
        next = to;
      }
    }
    if (next === null || rate(from, next) <= 0) {
      break;
    }
    path.push(next);
    estimate *= rate(from, next);
  }
  return { events: path, estimate };
}

/**
 * The source of {@link bestPath} as the code panel shows it under "Show
 * bestPath". tests/demo-matrix.test.ts holds this text to the function's
 * declaration in this file, so the helper on screen cannot drift from the
 * one that chains.
 */
export const BEST_PATH_SOURCE = `function bestPath(
  events: readonly string[],
  matrix: ReadonlyArray<FunnelResult | null>,
  options: { readonly steps: number },
): BestPath {
  const pairs = orderedPairs(events);
  const rate = (from: string, to: string): number => {
    const i = pairs.findIndex(([a, b]) => a === from && b === to);
    return matrix[i]?.overall_conversion_rate ?? 0;
  };
  let start: MatrixPair | null = null;
  for (const pair of pairs) {
    if (start === null || rate(...pair) > rate(...start)) {
      start = pair;
    }
  }
  if (start === null || rate(...start) <= 0) {
    return { events: [], estimate: 0 };
  }
  const path = [...start];
  let estimate = rate(...start);
  while (path.length < options.steps) {
    const from = path.at(-1) ?? "";
    let next: string | null = null;
    for (const to of events) {
      if (
        !path.includes(to) &&
        (next === null || rate(from, to) > rate(from, next))
      ) {
        next = to;
      }
    }
    if (next === null || rate(from, next) <= 0) {
      break;
    }
    path.push(next);
    estimate *= rate(from, next);
  }
  return { events: path, estimate };
}
`;

/**
 * The matrix as Markdown rows: one per first step under a `from` column,
 * then one column per second step holding the raw overall conversion
 * (blank on the diagonal and where the query failed).
 *
 * @param events - The pool.
 * @param matrix - Results in {@link orderedPairs} order, `null` for failures.
 * @returns One row per event, in pool order.
 * @example
 * ```ts
 * matrixRows(["A", "B"], matrix); // [{ from: "A", A: "", B: 0.61 }, { from: "B", A: 0.02, B: "" }]
 * ```
 */
export function matrixRows(
  events: readonly string[],
  matrix: ReadonlyArray<FunnelResult | null>,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  const pairs = orderedPairs(events);
  return events.map((from) => {
    const row: Record<string, unknown> = { from };
    for (const to of events) {
      const i = pairs.findIndex(([a, b]) => a === from && b === to);
      row[to] = i === -1 ? "" : (matrix[i]?.overall_conversion_rate ?? "");
    }
    return row;
  });
}

/**
 * The columns of the Markdown export: `from`, then one per event.
 *
 * @param events - The pool.
 * @returns The column names.
 */
export function matrixColumns(events: readonly string[]): string[] {
  return ["from", ...events];
}
