/**
 * Bundle-level aggregations over normalized actions — TS port of
 * `mixpanel_headless/_internal/replays/aggregators.py` (172 lines,
 * whole file) for Phase-3 batch B5, shard S3
 * (`context/phase3/design/b5-packets.md` §5).
 *
 * Python returns `pandas.DataFrame`s; the port returns ROW ARRAYS plus
 * a paired column-list function, exactly like the Phase-2 C6 `toRows()`
 * / `rowColumns()` precedent on every result class. A pandas
 * `groupby(...).size()` over an insertion-ordered frame is
 * reproduced with an insertion-ordered `Map`, and
 * `sort_values(..., ascending=False)` with a STABLE sort so ties keep
 * their first-seen order (pandas' default `quicksort` is NOT stable,
 * but `groupby` already emits sorted-by-key groups, so the observable
 * ordering of a tie is the key order — see {@link topClicks}).
 *
 * Conventions (carried verbatim from the Python module docstring):
 * - counts are integers; rates are floats in `[0, 1]`;
 * - click-pattern thresholds are in milliseconds, `longPauses` in
 *   seconds;
 * - empty input is always a valid empty row list with the documented
 *   columns — never a throw on a zero-action bundle.
 */

import { compareCodepoints } from "../compat/codepoint.js";
import type { Replay, ReplayBundle } from "../types/results/replays.js";
import type { Row } from "../types/results/result-base.js";

/**
 * Genuine clicks from an `actions_df` row list — drops focus-only
 * interactions (`real_clicks`, `aggregators.py:26-49`).
 *
 * A real user click fires BOTH a `focused` and a `clicked` rrweb
 * interaction, and the analyzer maps both to the `click` action
 * literal. Counting both double-counts every click and inflates element
 * rankings, so this keeps the `clicked` / `double-clicked` /
 * `right-clicked` rows and drops the paired `focused` ones
 * (`metadata['interaction'] === 'focused'`).
 *
 * @param actionsRows - A bundle or replay `actions_df` projection.
 * @returns The subset of click rows excluding focus-only interactions.
 *   Rows with no `interaction` metadata are kept (treated as genuine
 *   clicks).
 */
export function realClicks(actionsRows: readonly Row[]): readonly Row[] {
  if (actionsRows.length === 0) {
    return actionsRows;
  }
  const clicks = actionsRows.filter((row) => row["action"] === "click");
  if (clicks.length === 0) {
    return clicks;
  }
  return clicks.filter((row) => {
    // Python `(m or {}).get("interaction")` — a None/empty metadata
    // yields `None`, which is `!= "focused"`, so the row is KEPT.
    const metadata = row["metadata"];
    const interaction =
      metadata !== null &&
      metadata !== undefined &&
      typeof metadata === "object" &&
      !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)["interaction"]
        : undefined;
    return interaction !== "focused";
  });
}

/** One `top_clicks` output row. */
export interface TopClickRow extends Row {
  /** The element label. */
  target_desc: unknown;
  /** How many genuine clicks landed on it. */
  count: number;
}

/**
 * Column contract of the {@link topClicks} frame
 * (`pd.DataFrame(columns=["target_desc", "count"])`).
 *
 * @returns The column list.
 */
export function topClicksRowColumns(): readonly string[] {
  return ["target_desc", "count"];
}

/**
 * Top-N click targets across the bundle (`top_clicks`,
 * `aggregators.py:52-77`).
 *
 * Counts genuine clicks only: focus-only interactions are excluded via
 * {@link realClicks} so each user click counts once.
 *
 * @param bundle - The bundle to aggregate.
 * @param n - How many click targets to return. Default 10.
 * @returns Rows with `target_desc` / `count`, sorted descending by
 *   count.
 */
export function topClicks(bundle: ReplayBundle, n = 10): TopClickRow[] {
  const clicks = realClicks(bundle.toActionsRows());
  if (clicks.length === 0) {
    return [];
  }
  // `groupby("target_desc", dropna=False).size()` — pandas sorts group
  // KEYS ascending by default (`sort=True`), so the pre-`sort_values`
  // frame is key-ordered; the subsequent descending count sort is
  // stable in this port, which reproduces pandas' observable tie order
  // for the string keys this frame carries.
  const counts = new Map<string, { key: unknown; count: number }>();
  for (const row of clicks) {
    const key = row["target_desc"];
    const mapKey = typeof key === "string" ? key : JSON.stringify(key ?? null);
    const entry = counts.get(mapKey);
    if (entry === undefined) {
      counts.set(mapKey, { key, count: 1 });
    } else {
      entry.count += 1;
    }
  }
  const grouped = [...counts.values()].sort((a, b) =>
    compareCodepoints(String(a.key), String(b.key)),
  );
  grouped.sort((a, b) => b.count - a.count);
  return grouped
    .slice(0, n)
    .map((entry) => ({ target_desc: entry.key, count: entry.count }));
}

/** One `rage_clicks` output row. */
export interface RageClickRow extends Row {
  /** The replay the burst was found in. */
  replay_id: string;
  /** Timestamp (ms) of the burst's first click. */
  t_start: number;
  /** The clicked element label. */
  target_desc: string;
  /** How many clicks the burst contains. */
  count: number;
}

/**
 * Column contract of the {@link rageClicks} frame.
 *
 * @returns The column list.
 */
export function rageClicksRowColumns(): readonly string[] {
  return ["replay_id", "t_start", "target_desc", "count"];
}

/**
 * Bursts of ≥ `threshold` clicks on the same target within `windowMs`
 * (`rage_clicks`, `aggregators.py:80-129`).
 *
 * @param bundle - The bundle to scan.
 * @param options - `threshold` (default 3) and `windowMs` (default
 *   1000).
 * @returns One row per rage burst.
 */
export function rageClicks(
  bundle: ReplayBundle,
  options: { threshold?: number; windowMs?: number } = {},
): RageClickRow[] {
  const threshold = options.threshold ?? 3;
  const windowMs = options.windowMs ?? 1000;
  const rows: RageClickRow[] = [];
  for (const replay of bundle.replays) {
    // Drop focus-only interactions: the analyzer maps both a real click
    // and its paired focus event to action="click", so counting the
    // focus row inflates burst sizes. Same predicate realClicks() uses.
    const clicks = replay.actions.filter(
      (a) => a.action === "click" && a.metadata["interaction"] !== "focused",
    );
    let i = 0;
    while (i < clicks.length) {
      let j = i + 1;
      const anchor = clicks[i] as (typeof clicks)[number];
      while (
        j < clicks.length &&
        (clicks[j] as (typeof clicks)[number]).target_desc ===
          anchor.target_desc &&
        (clicks[j] as (typeof clicks)[number]).timestamp - anchor.timestamp <=
          windowMs
      ) {
        j += 1;
      }
      const burst = j - i;
      if (burst >= threshold) {
        rows.push({
          replay_id: replay.replay_id,
          t_start: anchor.timestamp,
          target_desc: anchor.target_desc,
          count: burst,
        });
        i = j;
      } else {
        i += 1;
      }
    }
  }
  return rows;
}

/** One `long_pauses` output row. */
export interface LongPauseRow extends Row {
  /** The replay the pause was found in. */
  replay_id: string;
  /** Timestamp (ms) of the action preceding the pause. */
  t_start: number;
  /** The pause length in seconds. */
  duration_s: number;
}

/**
 * Column contract of the {@link longPauses} frame.
 *
 * @returns The column list.
 */
export function longPausesRowColumns(): readonly string[] {
  return ["replay_id", "t_start", "duration_s"];
}

/**
 * Idle stretches between consecutive actions longer than `thresholdS`
 * (`long_pauses`, `aggregators.py:132-155`).
 *
 * @param bundle - The bundle to scan.
 * @param thresholdS - Minimum pause length in seconds. Default 10.
 * @returns One row per qualifying gap.
 */
export function longPauses(
  bundle: ReplayBundle,
  thresholdS = 10,
): LongPauseRow[] {
  // Python `int(threshold_s * 1000)` — truncation toward zero on the
  // PRODUCT, so a fractional threshold rounds down in ms.
  const thresholdMs = Math.trunc(thresholdS * 1000);
  const rows: LongPauseRow[] = [];
  for (const replay of bundle.replays) {
    // Python `zip(actions, actions[1:])` — consecutive pairs.
    for (let i = 0; i + 1 < replay.actions.length; i += 1) {
      const prev = replay.actions[i] as (typeof replay.actions)[number];
      const curr = replay.actions[i + 1] as (typeof replay.actions)[number];
      const gapMs = curr.timestamp - prev.timestamp;
      if (gapMs >= thresholdMs) {
        rows.push({
          replay_id: replay.replay_id,
          t_start: prev.timestamp,
          duration_s: gapMs / 1000.0,
        });
      }
    }
  }
  return rows;
}

/**
 * Replay IDs that emitted at least one `console_error` action
 * (`error_sessions`, `aggregators.py:158-172`).
 *
 * @param bundle - The bundle to scan.
 * @returns Replay IDs in input order. Empty when the bundle has no
 *   console errors.
 */
export function errorSessions(bundle: ReplayBundle): string[] {
  return bundle.replays
    .filter((replay: Replay) =>
      replay.actions.some((a) => a.action === "console_error"),
    )
    .map((replay: Replay) => replay.replay_id);
}
