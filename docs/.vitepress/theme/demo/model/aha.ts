// The "Aha moments" report: which early behaviour predicts retention.
// Mixpanel has no report for it and none is needed — one `queryRetention`
// per candidate event in a loop, then a ranking of the average curves at a
// target bucket. The single-source rule holds here too: the loop the code
// panel prints and the calls that run are built from the same candidate
// array and option literal (tests/demo-aha.test.ts re-parses the printed
// text back to the executed arguments), and the ranking helper the panel
// shows is pinned to the source text of the one that ranks.

import { type Call, type CallArg, printArg } from "./call.js";
import type { RetentionUnit, TimeRange } from "./query-spec.js";
import type { RetentionResult } from "./series.js";

/**
 * Candidates the report accepts at once. Each is one retention query, and
 * the Query API allows five concurrent and sixty per hour per project, so
 * a project with thousands of events is sampled from its top events rather
 * than swept.
 */
export const MAX_CANDIDATES = 10;

/** The bucket the ranking compares at (week 4 or day 4). */
export const TARGET_BUCKET = 4;

/** The report's UI state: the born event, its candidates, unit and range. */
export interface AhaSpec {
  readonly kind: "aha";
  readonly born: string;
  readonly candidates: readonly string[];
  readonly retentionUnit: RetentionUnit;
  readonly last: TimeRange;
}

/** One candidate in the ranking. */
export interface RankedCandidate {
  /** 1 for the highest rate. */
  readonly rank: number;
  readonly event: string;
  /** Average retention at the ranking's bucket, 0–1. */
  readonly rate: number;
  /** `rate` minus the median candidate's rate (percentage points / 100). */
  readonly lift: number;
  /** The average curve from bucket 0 up to the ranking's bucket. */
  readonly curve: readonly number[];
  /** Cohorts the average covers. */
  readonly cohorts: number;
  /** Users across those cohorts (`first` summed). */
  readonly entrants: number;
}

/** What `rankByRetention` returns. */
export interface Ranking {
  /** The bucket compared: the target, or shallower when a curve is shorter. */
  readonly bucket: number;
  /** The median candidate's rate, the reference every lift is against. */
  readonly median: number;
  /** Highest rate first. */
  readonly rows: readonly RankedCandidate[];
}

/** Columns of the Markdown export, in order. */
export const RANKING_COLUMNS = [
  "rank",
  "event",
  "rate",
  "lift",
  "cohorts",
  "entrants",
] as const;

const UNIT_DAYS: Readonly<Record<RetentionUnit, number>> = { day: 1, week: 7 };

// The option literal every candidate's call carries (and the loop prints).
const retentionOptions = (spec: AhaSpec): Record<string, CallArg> => ({
  retention_unit: spec.retentionUnit,
  last: spec.last,
});

/**
 * The deepest bucket the range can fill, capped at {@link TARGET_BUCKET}: a
 * cohort born at the start of the range has seen `ceil(last / unit)`
 * buckets counting bucket 0. Below 1 there is nothing to rank by.
 *
 * @param spec - Unit and range.
 * @returns The bucket index (0 when the range holds a single unit).
 * @example
 * ```ts
 * plannedBucket({ kind: "aha", born: "Signup", candidates: [], retentionUnit: "week", last: 7 }); // 0
 * plannedBucket({ kind: "aha", born: "Signup", candidates: [], retentionUnit: "week", last: 30 }); // 4
 * ```
 */
export function plannedBucket(spec: AhaSpec): number {
  const buckets = Math.ceil(spec.last / UNIT_DAYS[spec.retentionUnit]);
  return Math.min(TARGET_BUCKET, buckets - 1);
}

/**
 * The default candidate set: the top events in volume order, minus the
 * born event, restricted to what the data source can answer, capped at
 * {@link MAX_CANDIDATES}.
 *
 * @param top - Event names as `ws.topEvents()` ordered them.
 * @param born - The born event (never a candidate of itself).
 * @param allowed - Return events with data for this born event, or `null`
 *   when every event is allowed (live mode).
 * @returns At most {@link MAX_CANDIDATES} events.
 * @example
 * ```ts
 * seedCandidates(["App Opened", "Note Saved", "Signup"], "Signup", null);
 * // ["App Opened", "Note Saved"]
 * ```
 */
export function seedCandidates(
  top: readonly string[],
  born: string,
  allowed: readonly string[] | null,
): string[] {
  return top
    .filter((event) => event !== born)
    .filter((event) => allowed === null || allowed.includes(event))
    .slice(0, MAX_CANDIDATES);
}

/**
 * One `queryRetention` call per candidate, in candidate order — the calls
 * the loop runs, bound to `results[i]` as the loop's `push` would.
 *
 * @param spec - The report's state.
 * @returns The calls to execute, sequentially.
 * @example
 * ```ts
 * ahaCalls({ kind: "aha", born: "Signup", candidates: ["Search"], retentionUnit: "week", last: 30 });
 * // [{ method: "queryRetention", args: ["Signup", "Search", { retention_unit: "week", last: 30 }], binding: "results[0]", imports: [] }]
 * ```
 */
export function ahaCalls(spec: AhaSpec): Call[] {
  return spec.candidates.map((event, i) => ({
    method: "queryRetention",
    args: [spec.born, event, retentionOptions(spec)],
    binding: `results[${String(i)}]`,
    imports: [],
  }));
}

/**
 * The program the code panel shows for a run: the candidate array, the
 * loop over `queryRetention` with the same option literal the calls carry,
 * then the ranking. Laid out as Prettier prints it, so a copied block
 * survives the site's formatter unchanged.
 *
 * @param spec - The report's state.
 * @returns The program text, trailing newline included.
 * @example
 * ```ts
 * renderAhaProgram({ kind: "aha", born: "Signup", candidates: ["Search"], retentionUnit: "week", last: 30 });
 * // const candidates = ["Search"];
 * // const results = [];
 * // for (const event of candidates) {
 * //   results.push(
 * //     await ws.queryRetention("Signup", event, {
 * //       retention_unit: "week",
 * //       last: 30,
 * //     }),
 * //   );
 * // }
 * // const ranking = rankByRetention(candidates, results, { bucket: 4 });
 * ```
 */
export function renderAhaProgram(spec: AhaSpec): string {
  const candidates = printArg([...spec.candidates]);
  const options = printArg(retentionOptions(spec), 2);
  return [
    `const candidates = ${candidates};`,
    "const results = [];",
    "for (const event of candidates) {",
    "  results.push(",
    `    await ws.queryRetention(${printArg(spec.born)}, event, ${options}),`,
    "  );",
    "}",
    `const ranking = rankByRetention(candidates, results, { bucket: ${String(TARGET_BUCKET)} });`,
    "",
  ].join("\n");
}

/**
 * Rank candidate events by their average retention at a bucket. The bucket
 * compared is the target, or the deepest one every candidate's average
 * reaches when a curve is shorter, so a short range compares like with
 * like. Each row's lift is against the median candidate's rate.
 *
 * @param candidates - Event names, index-aligned with `results`.
 * @param results - One `queryRetention` result per candidate.
 * @param options - `bucket`: the target bucket index (week 4 → `4`).
 * @returns The ranking, highest rate first.
 * @example
 * ```ts
 * const ranking = rankByRetention(["Search", "Note Shared"], results, { bucket: 4 });
 * ranking.rows[0]; // { rank: 1, event: "Note Shared", rate: 0.41, lift: 0.11, … }
 * ```
 */
export function rankByRetention(
  candidates: readonly string[],
  results: readonly RetentionResult[],
  options: { readonly bucket: number },
): Ranking {
  const curves = results.map((result) => {
    const rates = result.average["rates"];
    return Array.isArray(rates) ? rates.map(Number) : [];
  });
  const bucket = Math.max(
    0,
    Math.min(options.bucket, ...curves.map((curve) => curve.length - 1)),
  );
  const rows = candidates.map((event, i) => {
    const curve = curves[i] ?? [];
    const result = results[i];
    const cohorts = result === undefined ? [] : Object.values(result.cohorts);
    return {
      event,
      rate: curve[bucket] ?? 0,
      curve: curve.slice(0, bucket + 1),
      cohorts: cohorts.length,
      entrants: cohorts.reduce(
        (sum, cohort) => sum + Number(cohort["first"] ?? 0),
        0,
      ),
    };
  });
  rows.sort((a, b) => b.rate - a.rate);
  const middle = Math.floor(rows.length / 2);
  const median =
    rows.length % 2 === 1
      ? (rows[middle]?.rate ?? 0)
      : ((rows[middle - 1]?.rate ?? 0) + (rows[middle]?.rate ?? 0)) / 2;
  return {
    bucket,
    median,
    rows: rows.map((row, i) => ({
      rank: i + 1,
      ...row,
      lift: row.rate - median,
    })),
  };
}

/**
 * The source of {@link rankByRetention} as the code panel shows it under
 * "Show rankByRetention". tests/demo-aha.test.ts holds this text to the
 * function's declaration in this file, so the helper on screen cannot
 * drift from the one that ranks.
 */
export const RANK_BY_RETENTION_SOURCE = `function rankByRetention(
  candidates: readonly string[],
  results: readonly RetentionResult[],
  options: { readonly bucket: number },
): Ranking {
  const curves = results.map((result) => {
    const rates = result.average["rates"];
    return Array.isArray(rates) ? rates.map(Number) : [];
  });
  const bucket = Math.max(
    0,
    Math.min(options.bucket, ...curves.map((curve) => curve.length - 1)),
  );
  const rows = candidates.map((event, i) => {
    const curve = curves[i] ?? [];
    const result = results[i];
    const cohorts = result === undefined ? [] : Object.values(result.cohorts);
    return {
      event,
      rate: curve[bucket] ?? 0,
      curve: curve.slice(0, bucket + 1),
      cohorts: cohorts.length,
      entrants: cohorts.reduce(
        (sum, cohort) => sum + Number(cohort["first"] ?? 0),
        0,
      ),
    };
  });
  rows.sort((a, b) => b.rate - a.rate);
  const middle = Math.floor(rows.length / 2);
  const median =
    rows.length % 2 === 1
      ? (rows[middle]?.rate ?? 0)
      : ((rows[middle - 1]?.rate ?? 0) + (rows[middle]?.rate ?? 0)) / 2;
  return {
    bucket,
    median,
    rows: rows.map((row, i) => ({
      rank: i + 1,
      ...row,
      lift: row.rate - median,
    })),
  };
}
`;

/**
 * The ranking as Markdown rows under {@link RANKING_COLUMNS}: raw numbers,
 * the export must not lose precision.
 *
 * @param ranking - The ranking.
 * @returns One row per candidate, rank order.
 * @example
 * ```ts
 * rankingRows(ranking)[0]; // { rank: 1, event: "Note Shared", rate: 0.41, lift: 0.11, cohorts: 5, entrants: 2090 }
 * ```
 */
export function rankingRows(
  ranking: Ranking,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  return ranking.rows.map((row) => ({
    rank: row.rank,
    event: row.event,
    rate: row.rate,
    lift: row.lift,
    cohorts: row.cohorts,
    entrants: row.entrants,
  }));
}

/**
 * An SVG path for a small-multiple retention curve: bucket 0 at the left
 * edge, rate 1 at the top, rate 0 at the bottom.
 *
 * @param curve - Rates by bucket, 0–1 (clamped).
 * @param width - Drawing width in user units.
 * @param height - Drawing height in user units.
 * @returns The `d` attribute, empty for an empty curve.
 * @example
 * ```ts
 * sparklinePath([1, 0.5, 0.25], 40, 10); // "M0.0,0.0 L20.0,5.0 L40.0,7.5"
 * ```
 */
export function sparklinePath(
  curve: readonly number[],
  width: number,
  height: number,
): string {
  const step = curve.length > 1 ? width / (curve.length - 1) : 0;
  return curve
    .map((rate, i) => {
      const y = height - Math.min(Math.max(rate, 0), 1) * height;
      return `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
