// Result → chart adapters: pure functions over `toRows()` so the charts
// draw exactly the rows the table shows and the Markdown export carries.
// Result types come from the facade's signatures (the result classes are
// not on the browser barrel). Number formatting for the UI lives here too,
// in one place, so every count and ratio on the page reads the same way.

import type { Workspace } from "@mixpanel-headless/browser";

/** `ws.query`'s result (core `QueryResult`). */
export type TrendResult = Awaited<ReturnType<Workspace["query"]>>;

/** `ws.queryFunnel`'s result (core `FunnelQueryResult`). */
export type FunnelResult = Awaited<ReturnType<Workspace["queryFunnel"]>>;

/** `ws.queryRetention`'s result (core `RetentionQueryResult`). */
export type RetentionResult = Awaited<ReturnType<Workspace["queryRetention"]>>;

/** One point of a trend line. */
export interface SeriesPoint {
  /** Calendar day (`YYYY-MM-DD`). */
  readonly date: string;
  readonly value: number;
}

/** One line of the trend chart. */
export interface TrendLine {
  readonly name: string;
  readonly points: readonly SeriesPoint[];
}

/** One funnel step as the bar list shows it. */
export interface FunnelBar {
  readonly event: string;
  readonly count: number;
  /** Share of the first step that reached this one (bar width). */
  readonly overallRatio: number;
  /** Share of the previous step that reached this one (label). */
  readonly stepRatio: number;
}

/** One cohort row of the retention grid. */
export interface RetentionCohort {
  /** Cohort start day (`YYYY-MM-DD`). */
  readonly date: string;
  /** Cohort size (`first`). */
  readonly size: number;
  /** Rate per bucket, index 0 being the birth bucket. */
  readonly rates: readonly number[];
}

/** The retention grid: cohorts plus the bucket unit for the header. */
export interface RetentionGrid {
  readonly cohorts: readonly RetentionCohort[];
  /** `day` or `week` (from the query's params). */
  readonly unit: string;
}

/** How a retention cell is shaded: fill alpha on the brand colour, and whether the text is white. */
export interface CellShade {
  /** Alpha of the brand-coloured fill, 0–1. */
  readonly alpha: number;
  /** Whether the cell text is white rather than the body colour. */
  readonly inverse: boolean;
}

/** Lines drawn before the rest collapses into "Other". */
export const MAX_SERIES = 6;

/** Name of the collapsed line. */
export const OTHER_SERIES = "Other";

const COUNT_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const COMPACT_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const PCT_FORMAT = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});
const COMPACT_ABOVE = 10_000;

/**
 * Coerce a row cell to a number (`toRows()` cells are `unknown`).
 *
 * @param value - The cell.
 * @returns The number, or 0 for anything that is not one.
 */
function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Format a count for display: grouped digits, compact above 10 000.
 *
 * @param value - The count.
 * @returns e.g. `1,562` or `45.4K`.
 */
export function formatCount(value: number): string {
  return Math.abs(value) >= COMPACT_ABOVE
    ? COMPACT_FORMAT.format(value)
    : COUNT_FORMAT.format(value);
}

/**
 * Format a ratio as a percentage with at most one decimal.
 *
 * @param ratio - A ratio (1 = 100 %).
 * @returns e.g. `61%` or `23.2%`.
 */
export function formatPct(ratio: number): string {
  return PCT_FORMAT.format(ratio);
}

/**
 * Whether every point of every line is zero — the result has rows but
 * nothing happened, so the chart shows a flat line with a caption instead
 * of an axis over nothing.
 *
 * @param series - The lines the chart would draw.
 * @returns `true` when there is at least one point and none is non-zero.
 */
export function allZero(series: readonly TrendLine[]): boolean {
  const points = series.flatMap((line) => line.points);
  return points.length > 0 && points.every((point) => point.value === 0);
}

/** Rates up to this shade keep the body text colour; above it the text is white. */
const INVERSE_ABOVE = 0.55;
/**
 * The lowest fill alpha a white-text cell uses. On the light background,
 * white on the brand blue reaches 4.5:1 only from alpha 0.83, and the body
 * text holds 4.5:1 only up to alpha 0.65, so a fill that followed the rate
 * linearly would fail both between them; the white band therefore starts
 * here and the rate spreads over what is left.
 */
const INVERSE_MIN_ALPHA = 0.85;

/**
 * Shade for one retention cell: the fill alpha follows the rate below the
 * text switch and jumps to a band that keeps white text readable above it,
 * so the contrast stays at or above 4.5:1 in both colour schemes.
 *
 * @param rate - The cell's retention rate, 0–1 (clamped).
 * @returns The fill alpha and whether the text is white.
 */
export function cellShade(rate: number): CellShade {
  const clamped = Math.min(Math.max(rate, 0), 1);
  if (clamped <= INVERSE_ABOVE) {
    return { alpha: clamped, inverse: false };
  }
  const span = (clamped - INVERSE_ABOVE) / (1 - INVERSE_ABOVE);
  return {
    alpha: INVERSE_MIN_ALPHA + span * (1 - INVERSE_MIN_ALPHA),
    inverse: true,
  };
}

/**
 * Trend lines from a query result: one per segment (or one for the event),
 * dates ascending, missing days filled with 0. Lines are ordered by total
 * descending; beyond {@link MAX_SERIES} the remainder is summed into
 * {@link OTHER_SERIES} so the chart stays legible and the table keeps the
 * detail.
 *
 * @param result - The query result.
 * @returns At most {@link MAX_SERIES} lines.
 */
export function trendSeries(result: TrendResult): TrendLine[] {
  const byName = new Map<string, Map<string, number>>();
  const dates = new Set<string>();
  for (const row of result.toRows()) {
    const segment = row["segment"];
    const name = typeof segment === "string" ? segment : String(row["event"]);
    const date =
      typeof row["date"] === "string" ? row["date"].slice(0, 10) : "all";
    dates.add(date);
    const line = byName.get(name) ?? new Map<string, number>();
    line.set(date, (line.get(date) ?? 0) + asNumber(row["count"]));
    byName.set(name, line);
  }
  const sortedDates = [...dates].sort();
  const total = (line: ReadonlyMap<string, number>): number =>
    [...line.values()].reduce((a, b) => a + b, 0);
  const ranked = [...byName].sort(([, a], [, b]) => total(b) - total(a));
  const kept =
    ranked.length > MAX_SERIES ? ranked.slice(0, MAX_SERIES - 1) : ranked;
  const rest = ranked.slice(kept.length);
  if (rest.length > 0) {
    const other = new Map<string, number>();
    for (const [, line] of rest) {
      for (const [date, value] of line) {
        other.set(date, (other.get(date) ?? 0) + value);
      }
    }
    kept.push([OTHER_SERIES, other]);
  }
  return kept.map(([name, line]) => ({
    name,
    points: sortedDates.map((date) => ({ date, value: line.get(date) ?? 0 })),
  }));
}

/**
 * Funnel bars from a funnel result, one per step in order.
 *
 * @param funnel - The funnel result.
 * @returns The bars.
 */
export function funnelBars(funnel: FunnelResult): FunnelBar[] {
  return funnel.toRows().map((row) => ({
    event: String(row["event"]),
    count: asNumber(row["count"]),
    overallRatio: asNumber(row["overall_conv_ratio"]),
    stepRatio: asNumber(row["step_conv_ratio"]),
  }));
}

/**
 * Retention grid from a retention result: cohorts in row order, rates
 * indexed by bucket, the unit read from the query's own params.
 *
 * @param retention - The retention result.
 * @returns The grid.
 */
export function retentionGrid(retention: RetentionResult): RetentionGrid {
  const cohorts = new Map<string, number[]>();
  for (const row of retention.toRows()) {
    const date = String(row["cohort_date"]);
    const rates = cohorts.get(date) ?? [];
    rates[asNumber(row["bucket"])] = asNumber(row["rate"]);
    cohorts.set(date, rates);
  }
  const unit = readUnit(retention.params);
  return {
    unit,
    cohorts: [...cohorts].map(([date, rates]) => ({
      date,
      size: asNumber(retention.cohorts[date]?.["first"]),
      rates: Array.from(rates, (rate) => rate ?? 0),
    })),
  };
}

/**
 * `sections.show[0].behavior.retentionUnit` from bookmark params.
 *
 * @param params - The bookmark params the query sent.
 * @returns The unit, or `bucket` when the params do not carry one.
 */
function readUnit(params: unknown): string {
  let node: unknown = params;
  for (const step of ["sections", "show", 0, "behavior", "retentionUnit"]) {
    if (node === null || typeof node !== "object") {
      return "bucket";
    }
    node = (node as Record<string | number, unknown>)[step];
  }
  return typeof node === "string" ? node : "bucket";
}

/**
 * An SVG path for a small-multiple curve of rates: the first point at the
 * left edge, rate 1 at the top, rate 0 at the bottom (the ranking
 * report's retention curves, the conversion matrix's window sweep).
 *
 * @param curve - Rates in point order, 0–1 (clamped).
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
