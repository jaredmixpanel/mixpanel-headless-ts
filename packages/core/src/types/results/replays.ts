/**
 * `ReplayBundle` — a collection of session replays with aggregate
 * frames. The bundle sits at the top of the replay family: it composes
 * the per-replay dataclasses (`replay-models.ts`), the bundle
 * aggregations (`replays/aggregators.ts`), the label functions
 * (`replays/replay-labels.ts`) and, for `sample`, CPython
 * `random.Random(seed)` parity (`compat/python-random.ts`). Nothing
 * below it imports this module. `sessions_df` / `actions_df` /
 * `events_df` / `mixpanel_df` become `toSessionsRows()` /
 * `toActionsRows()` / `toEventsRows()` / `toMixpanelRows()`; the main
 * `.df` delegates to the sessions frame.
 *
 * @see mixpanel_headless.types.ReplayBundle
 */

import { compareCodepoints, compareCodeUnits } from "../../compat/index.js";
import { pythonSample } from "../../compat/python-random.js";
import { ParamValidationError } from "../../errors.js";
import {
  errorSessions,
  longPauses,
  rageClicks,
  realClicks,
  topClicks,
} from "../../replays/aggregators.js";
import { defaultLabelFn, urlNormalizer } from "../../replays/replay-labels.js";
import type { UserAction } from "../../replays/user-action.js";
import { Replay, rrwebEventRow } from "./replay-models.js";
import {
  decodeFail,
  expectInt,
  expectNullCache,
  expectPayload,
  expectStr,
  rejectUnknownKeys,
  type Row,
} from "./result-base.js";

/**
 * One replay `fetch_replays` skipped. TS-only: Python's `ReplayBundle`
 * has no such field because its `fetch_replays` only logs the skipped id.
 */
export interface ReplayFetchFailure {
  /** The replay that was skipped. */
  readonly replay_id: string;
  /** Why it was skipped (`ReplayNotFoundError`, a CDN stall, a parse error, …). */
  readonly error: Error;
}

/** Declared fields of {@link ReplayBundle} (Python field order). */
export interface ReplayBundleFields {
  /**
   * Replays in the bundle.
   *
   * @defaultValue `[]`
   */
  readonly replays?: readonly Replay[];
  /**
   * When the bundle was computed (ISO text).
   *
   * @defaultValue `""`
   */
  readonly computed_at?: string;
  /**
   * Owning project ID (`0` when unset).
   *
   * @defaultValue `0`
   */
  readonly project_id?: number;
  /**
   * Replays `fetch_replays` skipped (TS-only, additive; see
   * {@link ReplayBundle.failures}).
   *
   * @defaultValue `[]`
   */
  readonly failures?: readonly ReplayFetchFailure[] | undefined;
  /** Codec-visible DataFrame cache slots — always `null` in TS. */
  readonly _df_cache?: null | undefined;
  /** Codec-visible sessions-frame cache slot — always `null` in TS. */
  readonly _sessions_df_cache?: null | undefined;
  /** Codec-visible actions-frame cache slot — always `null` in TS. */
  readonly _actions_df_cache?: null | undefined;
  /** Codec-visible events-frame cache slot — always `null` in TS. */
  readonly _events_df_cache?: null | undefined;
  /** Codec-visible mixpanel-frame cache slot — always `null` in TS. */
  readonly _mixpanel_df_cache?: null | undefined;
  /** Codec-visible elements-frame cache slot — always `null` in TS. */
  readonly _elements_df_cache?: null | undefined;
}

/**
 * A collection of session replays with aggregate frames.
 *
 * @remarks
 * Python's `sessions_df` / `actions_df` / `events_df` / `mixpanel_df` /
 * `elements_df` become `toSessionsRows()` / `toActionsRows()` /
 * `toEventsRows()` / `toMixpanelRows()` / `toElementsRows()`; the main
 * `toRows()` delegates to the sessions frame. Derived bundles (`filter`,
 * `where`, `head`, `sample`, `findPattern`, `errorSessions`) keep
 * `computed_at` and `project_id`.
 * @example
 * ```ts
 * const bundle = await ws.fetchReplays(replayIds);
 * bundle.toRows();
 * // [{ replay_id: "r1", distinct_id: "u1", start_time: "2026-01-15T12:00:00",
 * //    end_time: "2026-01-15T12:05:00", duration_s: 300, retention_days: 30,
 * //    n_events: 120, n_actions: 14, n_clicks: 6, n_inputs: 2, n_pages: 3,
 * //    n_errors: 0, n_mp_events: 4, entry_url: "https://app.example.com/",
 * //    exit_url: "https://app.example.com/checkout" }]
 * bundle.where({ has_event: "Purchase" }).topClicks(3);
 * // [{ target_desc: "button#buy", count: 9 }, …]
 * ```
 * @see mixpanel_headless.types.ReplayBundle
 */
export class ReplayBundle {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** Replays in the bundle. */
  readonly replays: readonly Replay[];

  /** When the bundle was computed (ISO text). */
  readonly computed_at: string;

  /** Owning project ID (`0` when unset). */
  readonly project_id: number;

  /** Codec-visible sessions-frame cache slot (`@internal`) — always `null`. */
  readonly _sessions_df_cache: null = null;

  /** Codec-visible actions-frame cache slot (`@internal`) — always `null`. */
  readonly _actions_df_cache: null = null;

  /** Codec-visible events-frame cache slot (`@internal`) — always `null`. */
  readonly _events_df_cache: null = null;

  /** Codec-visible mixpanel-frame cache slot (`@internal`) — always `null`. */
  readonly _mixpanel_df_cache: null = null;

  /** Codec-visible elements-frame cache slot (`@internal`) — always `null`. */
  readonly _elements_df_cache: null = null;

  /**
   * Backing store of {@link failures}. A private field so the codec's
   * `Object.entries` walk (and `toJSON()`) never see it: the encoded
   * shape of every bundle stays byte-identical to Python's.
   */
  readonly #failures: readonly ReplayFetchFailure[];

  /**
   * Create a replay bundle (guard fires exactly as Python's
   * `__post_init__`).
   *
   * @param fields - Declared fields; Python defaults apply to absent
   *   optionals.
   * @throws {@link ParamValidationError} - `RB1_PROJECT_ID_MISMATCH` when
   *   `project_id` is set (truthy) and any replay carries a different
   *   project ID.
   */
  constructor(fields: ReplayBundleFields = {}) {
    this.replays = fields.replays ?? [];
    this.computed_at = fields.computed_at ?? "";
    this.project_id = fields.project_id ?? 0;
    this.#failures = fields.failures ?? [];
    // RB1_PROJECT_ID_MISMATCH: all replays must match a set project_id.
    if (
      this.project_id &&
      this.replays.some((r) => r.project_id !== this.project_id)
    ) {
      const mismatches = this.replays
        .filter((r) => r.project_id !== this.project_id)
        .map((r) => r.replay_id);
      throw new ParamValidationError(
        `ReplayBundle.project_id=${String(this.project_id)} but the following ` +
          `replays carry a different project_id: ${JSON.stringify(mismatches)}`,
        "RB1_PROJECT_ID_MISMATCH",
      );
    }
  }

  /**
   * The replays `fetch_replays` skipped under its per-replay failure
   * isolation, in input order — so a partial bundle is never silently
   * short. Empty for bundles built any other way, and not carried over by
   * the derived-bundle members (`filter`, `head`, `sample`).
   *
   * @remarks
   * A prototype getter, not an own property, so `toJSON()` and the
   * conformance codec do not see it.
   * @returns The skipped replays with their errors.
   */
  // Divergence: Python only logs the skipped ids (`fetch_replays`
  // `logger.warning`); the structured record is TS-only, following the
  // `failed_pages` meta precedent of the parallel user query.
  get failures(): readonly ReplayFetchFailure[] {
    return this.#failures;
  }

  /**
   * Build the pre-pandas rows of Python's `sessions_df`: one summary row
   * per replay.
   *
   * @returns The rows list.
   * @see mixpanel_headless.types.ReplayBundle.sessions_df
   */
  toSessionsRows(): readonly Row[] {
    return this.replays.map((r) => {
      const nClicks = r.actions.filter((a) => a.action === "click").length;
      const nInputs = r.actions.filter((a) => a.action === "input").length;
      const nErrors = r.actions.filter(
        (a) => a.action === "console_error",
      ).length;
      const navigations = r.actions.filter((a) => a.action === "navigate");
      const entryUrl = navigations.length > 0 ? navigations[0]?.url : null;
      const exitUrl = navigations.length > 0 ? navigations.at(-1)?.url : null;
      return {
        replay_id: r.replay_id,
        distinct_id: r.distinct_id,
        start_time: r.start_time,
        end_time: r.end_time,
        duration_s: r.duration_seconds,
        retention_days: r.retention_days,
        n_events: r.rrweb_events.length,
        n_actions: r.actions.length,
        n_clicks: nClicks,
        n_inputs: nInputs,
        n_pages: navigations.length,
        n_errors: nErrors,
        n_mp_events: r.mixpanel_events.length,
        entry_url: entryUrl ?? null,
        exit_url: exitUrl ?? null,
      };
    });
  }

  /**
   * Column contract of the `sessions_df` frame (explicit
   * `columns=cols`).
   *
   * @returns The column list.
   */
  sessionsRowColumns(): readonly string[] {
    return [
      "replay_id",
      "distinct_id",
      "start_time",
      "end_time",
      "duration_s",
      "retention_days",
      "n_events",
      "n_actions",
      "n_clicks",
      "n_inputs",
      "n_pages",
      "n_errors",
      "n_mp_events",
      "entry_url",
      "exit_url",
    ];
  }

  /**
   * Build the pre-pandas rows of Python's bundle `actions_df`: the
   * action rows of every replay, each prefixed with its `replay_id`.
   *
   * @returns The rows list.
   * @see mixpanel_headless.types.ReplayBundle.actions_df
   */
  toActionsRows(): readonly Row[] {
    const rows: Row[] = [];
    for (const r of this.replays) {
      for (const a of r.actions) {
        rows.push({
          replay_id: r.replay_id,
          t: a.timestamp,
          action: a.action,
          target_node_id: a.target_node_id,
          target_desc: a.target_desc,
          description: a.description,
          url: a.url,
          metadata: { ...a.metadata },
        });
      }
    }
    return rows;
  }

  /**
   * Column contract of the bundle `actions_df` frame.
   *
   * @returns The column list.
   */
  actionsRowColumns(): readonly string[] {
    return [
      "replay_id",
      "t",
      "action",
      "target_node_id",
      "target_desc",
      "description",
      "url",
      "metadata",
    ];
  }

  /**
   * Build the pre-pandas rows of Python's bundle `events_df`: projected
   * rrweb rows with `replay_id` added after projection, exactly as
   * Python mutates the row dict (so the key lands last).
   *
   * @returns The rows list.
   * @see mixpanel_headless.types.ReplayBundle.events_df
   */
  toEventsRows(): readonly Row[] {
    const rows: Row[] = [];
    for (const r of this.replays) {
      for (const event of r.rrweb_events) {
        const row = rrwebEventRow(event);
        row["replay_id"] = r.replay_id;
        rows.push(row);
      }
    }
    return rows;
  }

  /**
   * Column contract of the bundle `events_df` frame (explicit
   * `columns=cols` — `replay_id` first, unlike the row-dict insertion
   * order).
   *
   * @returns The column list.
   */
  eventsRowColumns(): readonly string[] {
    return [
      "replay_id",
      "t",
      "type",
      "source",
      "mouse_type",
      "target_node_id",
      "url",
      "raw",
    ];
  }

  /**
   * Build the pre-pandas rows of Python's bundle `mixpanel_df`: one row
   * per correlated Mixpanel event across every replay.
   *
   * @returns The rows list.
   * @see mixpanel_headless.types.ReplayBundle.mixpanel_df
   */
  toMixpanelRows(): readonly Row[] {
    const rows: Row[] = [];
    for (const r of this.replays) {
      for (const e of r.mixpanel_events) {
        rows.push({
          replay_id: r.replay_id,
          t: e.event_time,
          event_name: e.event_name,
          properties: e.properties,
        });
      }
    }
    return rows;
  }

  /**
   * Column contract of the bundle `mixpanel_df` frame.
   *
   * @returns The column list.
   */
  mixpanelRowColumns(): readonly string[] {
    return ["replay_id", "t", "event_name", "properties"];
  }

  /**
   * Build the main `.df` rows — Python's `df` property returns
   * `sessions_df`.
   *
   * @returns The sessions rows.
   */
  toRows(): readonly Row[] {
    return this.toSessionsRows();
  }

  /**
   * Column contract of the main `.df` frame.
   *
   * @returns The sessions column list.
   */
  rowColumns(): readonly string[] {
    return this.sessionsRowColumns();
  }

  /**
   * Return a new bundle keeping only the replays matching a predicate
   * (same `computed_at` / `project_id`).
   *
   * @param predicate - Keep test.
   * @returns The filtered bundle.
   * @see mixpanel_headless.types.ReplayBundle.filter
   */
  filter(predicate: (replay: Replay) => boolean): ReplayBundle {
    return new ReplayBundle({
      replays: this.replays.filter((replay) => predicate(replay)),
      computed_at: this.computed_at,
      project_id: this.project_id,
    });
  }

  /**
   * Return a new bundle keeping the replays that satisfy every provided
   * condition.
   *
   * @param options - Filter conditions, each unconstrained when omitted:
   *   `distinct_id` (exact distinct-ID match), `contains_url` (substring
   *   of any navigate URL), `has_event` (name of a correlated Mixpanel
   *   event), `min_duration_s` / `max_duration_s` (inclusive bounds in
   *   seconds).
   * @returns The filtered bundle.
   * @example
   * ```ts
   * bundle.where({ contains_url: "/checkout", min_duration_s: 30 });
   * ```
   * @see mixpanel_headless.types.ReplayBundle.where
   */
  where(options: {
    readonly distinct_id?: string | null;
    readonly contains_url?: string | null;
    readonly has_event?: string | null;
    readonly min_duration_s?: number | null;
    readonly max_duration_s?: number | null;
  }): ReplayBundle {
    const distinctId = options.distinct_id ?? null;
    const containsUrl = options.contains_url ?? null;
    const hasEvent = options.has_event ?? null;
    const minDurationS = options.min_duration_s ?? null;
    const maxDurationS = options.max_duration_s ?? null;
    const ok = (r: Replay): boolean => {
      if (distinctId !== null && r.distinct_id !== distinctId) {
        return false;
      }
      if (
        containsUrl !== null &&
        r.actions.every(
          (a) =>
            !(a.action === "navigate" && (a.url ?? "").includes(containsUrl)),
        )
      ) {
        return false;
      }
      if (
        hasEvent !== null &&
        r.mixpanel_events.every((e) => e.event_name !== hasEvent)
      ) {
        return false;
      }
      if (minDurationS !== null && r.duration_seconds < minDurationS) {
        return false;
      }
      return maxDurationS === null || !(r.duration_seconds > maxDurationS);
    };
    return this.filter(ok);
  }

  /**
   * Return a new bundle with the first `n` replays.
   *
   * @param n - Maximum replays to keep.
   * @defaultValue `n` is `5`
   * @returns The truncated bundle.
   * @see mixpanel_headless.types.ReplayBundle.head
   */
  head(n = 5): ReplayBundle {
    return new ReplayBundle({
      replays: this.replays.slice(0, n),
      computed_at: this.computed_at,
      project_id: this.project_id,
    });
  }

  /**
   * Build one row per `(target_desc, normalized_url)` with click counts
   * — Python's `elements_df`.
   *
   * @remarks
   * Counts exclude focus-only interactions (a real click fires both a
   * `focused` and a `clicked` action; counting both double-counts every
   * click). URLs are normalized via `urlNormalizer` so the same element
   * on parameterized pages aggregates into one row.
   * @returns `{target_desc, url, n_clicks, n_unique_replays}` rows;
   *   empty when the bundle has no genuine clicks.
   * @see mixpanel_headless.types.ReplayBundle.elements_df
   */
  toElementsRows(): readonly Row[] {
    const clicks = realClicks(this.toActionsRows());
    if (clicks.length === 0) {
      return [];
    }
    // `groupby(["target_desc", "url"], dropna=False).agg(...)` — pandas
    // sorts the composite group key ascending; the URL column is the
    // normalized one (`clicks.assign(url=...)`), and Python's
    // `url_normalizer(u) if u else u` leaves a falsy URL untouched.
    const groups = new Map<
      string,
      {
        target_desc: unknown;
        url: unknown;
        n_clicks: number;
        replays: Set<unknown>;
      }
    >();
    for (const row of clicks) {
      const rawUrl = row["url"];
      const url =
        typeof rawUrl === "string" && rawUrl !== ""
          ? urlNormalizer(rawUrl)
          : rawUrl;
      const key = JSON.stringify([row["target_desc"] ?? null, url ?? null]);
      let entry = groups.get(key);
      if (entry === undefined) {
        entry = {
          target_desc: row["target_desc"],
          url,
          n_clicks: 0,
          replays: new Set<unknown>(),
        };
        groups.set(key, entry);
      }
      entry.n_clicks += 1;
      // `n_unique_replays=("replay_id", "nunique")` — pandas' nunique
      // skips NaN; the column is never null in this projection.
      entry.replays.add(row["replay_id"]);
    }
    return [...groups]
      .sort((a, b) => compareCodepoints(a[0], b[0]))
      .map(([, entry]) => ({
        target_desc: entry.target_desc,
        url: entry.url,
        n_clicks: entry.n_clicks,
        n_unique_replays: entry.replays.size,
      }));
  }

  /**
   * Column contract of the `elements_df` frame.
   *
   * @returns The column list.
   */
  elementsRowColumns(): readonly string[] {
    return ["target_desc", "url", "n_clicks", "n_unique_replays"];
  }

  /**
   * Rank the most-clicked targets across every replay in the bundle.
   *
   * @param n - Maximum number of click targets to return.
   * @defaultValue `n` is `10`
   * @returns `{target_desc, count}` rows, descending by count.
   * @see mixpanel_headless.types.ReplayBundle.top_clicks
   */
  topClicks(n = 10): readonly Row[] {
    return topClicks(this, n);
  }

  /**
   * Find rage-click bursts — repeated clicks on one target in a tight
   * window.
   *
   * @param options - Burst definition: `threshold`, the clicks needed to
   *   count as a burst (default `3`), and `windowMs`, the window in
   *   milliseconds (default `1000`).
   * @returns `{replay_id, t_start, target_desc, count}` rows.
   * @example
   * ```ts
   * bundle.rageClicks({ threshold: 4, windowMs: 800 });
   * // [{ replay_id: "r1", t_start: 12.4, target_desc: "button#buy", count: 5 }]
   * ```
   * @see mixpanel_headless.types.ReplayBundle.rage_clicks
   */
  rageClicks(
    options: { threshold?: number; windowMs?: number } = {},
  ): readonly Row[] {
    return rageClicks(this, options);
  }

  /**
   * Find idle stretches between consecutive actions longer than a
   * threshold.
   *
   * @param thresholdS - Minimum pause length in seconds.
   * @defaultValue `thresholdS` is `10`
   * @returns `{replay_id, t_start, duration_s}` rows.
   * @see mixpanel_headless.types.ReplayBundle.long_pauses
   */
  longPauses(thresholdS = 10): readonly Row[] {
    return longPauses(this, thresholdS);
  }

  /**
   * Return a new bundle of the replays whose action labels contain
   * `actionSequence` as a contiguous subsequence.
   *
   * @param actionSequence - Labels to look for, in order. An empty list
   *   matches every replay (returns a full clone).
   * @param options - Labeling overrides: `labelFn` maps an action to its
   *   label (defaults to `defaultLabelFn`).
   * @returns The filtered bundle.
   * @example
   * ```ts
   * bundle.findPattern(["click:button#buy@/cart", "click:button#pay@/checkout"]);
   * ```
   * @see mixpanel_headless.types.ReplayBundle.find_pattern
   */
  findPattern(
    actionSequence: readonly string[],
    options: { labelFn?: (action: UserAction) => string } = {},
  ): ReplayBundle {
    const fn = options.labelFn ?? defaultLabelFn;
    const target = [...actionSequence];
    if (target.length === 0) {
      return new ReplayBundle({
        replays: [...this.replays],
        computed_at: this.computed_at,
        project_id: this.project_id,
      });
    }
    return this.filter((r) => {
      const labels = r.actions.map((a) => fn(a));
      for (let i = 0; i <= labels.length - target.length; i += 1) {
        if (target.every((label, k) => labels[i + k] === label)) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Return a new bundle of only the replays that emitted a console error.
   *
   * @returns The filtered bundle; empty when the bundle has no console
   *   errors.
   * @see mixpanel_headless.types.ReplayBundle.error_sessions
   */
  errorSessions(): ReplayBundle {
    const ids = new Set(errorSessions(this));
    return this.filter((r) => ids.has(r.replay_id));
  }

  /**
   * Return a new bundle with up to `n` replays, deterministic per `seed`.
   *
   * @remarks
   * Sampling reproduces CPython's `random.Random(seed).sample`, so the
   * same seed selects the same replays in both runtimes, not merely
   * self-consistently.
   * @param n - How many replays to sample.
   * @param seed - Integer seed for reproducible sampling. When `null` or
   *   omitted, `entropy` is required: core has no `os.urandom` seam.
   * @param entropy - 32-bit seed words used when `seed` is `null`.
   * @defaultValue `n` is `5`, `seed` is `null`
   * @returns A bundle whose `replays` has length `min(n, total)`.
   * @throws {@link MixpanelHeadlessError} - Code `PY_RANDOM_SEED_UNSUPPORTED`
   *   when neither a seed nor entropy is supplied.
   * @example
   * ```ts
   * bundle.sample(3, 42).replays.map((r) => r.replay_id);
   * ```
   * @see mixpanel_headless.types.ReplayBundle.sample
   */
  sample(
    n = 5,
    seed: number | null = null,
    entropy?: readonly number[],
  ): ReplayBundle {
    // Python `rng.sample` raises when k > population; clamp first.
    const k = Math.min(n, this.replays.length);
    const chosen = pythonSample([...this.replays], k, seed, entropy);
    return new ReplayBundle({
      replays: chosen,
      computed_at: this.computed_at,
      project_id: this.project_id,
    });
  }

  /**
   * Render a Markdown rollup of the bundle: header totals plus
   * per-session timelines.
   *
   * @returns A markdown string; `"# No replays in bundle\n"` when the
   *   bundle is empty.
   * @see mixpanel_headless.types.ReplayBundle.summary_markdown
   */
  summaryMarkdown(): string {
    if (this.replays.length === 0) {
      return "# No replays in bundle\n";
    }
    const sections = [
      "# Bundle summary",
      "",
      `- replays: ${String(this.replays.length)}`,
    ];
    const rows = this.toSessionsRows();
    if (rows.length > 0) {
      const sum = (column: string): number =>
        rows.reduce((acc, row) => acc + Number(row[column] ?? 0), 0);
      sections.push(
        `- total events: ${String(Math.trunc(sum("n_events")))}`,
        `- total actions: ${String(Math.trunc(sum("n_actions")))}`,
        `- total errors: ${String(Math.trunc(sum("n_errors")))}`,
      );
    }
    sections.push("");
    for (const r of this.replays) {
      // Python wraps each per-replay render in `except NotImplementedError`;
      // `Replay.summary_markdown` cannot raise it, so that fallback branch
      // is unreachable in both runtimes and has no twin here.
      sections.push(r.summaryMarkdown(), "\n---\n");
    }
    return sections.join("\n");
  }

  /**
   * Return a copy of this bundle — Python's `join_mixpanel_events()`
   * body ignores `properties` and returns a copy.
   *
   * @param _properties - Ignored, as in Python.
   * @returns A copy of this bundle.
   * @see mixpanel_headless.types.ReplayBundle.join_mixpanel_events
   */
  joinMixpanelEvents(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for arity parity with Python's `join_mixpanel_events(properties=None)`, whose body ignores it too
    _properties?: readonly string[] | null,
  ): ReplayBundle {
    return new ReplayBundle({
      replays: [...this.replays],
      computed_at: this.computed_at,
      project_id: this.project_id,
    });
  }

  /**
   * Build action-count comparison rows against another bundle: value
   * counts per action label over the sorted union of labels.
   *
   * @param other - The bundle to compare against.
   * @returns `{action, self_count, other_count, delta}` rows.
   * @see mixpanel_headless.types.ReplayBundle.compare
   */
  compareRows(other: ReplayBundle): readonly Row[] {
    const countByAction = (bundle: ReplayBundle): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const row of bundle.toActionsRows()) {
        const action = row["action"] as string;
        counts.set(action, (counts.get(action) ?? 0) + 1);
      }
      return counts;
    };
    const a = countByAction(this);
    const b = countByAction(other);
    // Python `sorted()` orders by code point; the engine's code-unit
    // order is kept for the same reason as `query-engine.ts#sortedKeys`
    // (action labels are ASCII, so the two never differ here).
    const keys = [...new Set([...a.keys(), ...b.keys()])].sort(
      compareCodeUnits,
    );
    return keys.map((k) => ({
      action: k,
      self_count: a.get(k) ?? 0,
      other_count: b.get(k) ?? 0,
      delta: (a.get(k) ?? 0) - (b.get(k) ?? 0),
    }));
  }

  /**
   * Column contract of the `compare()` frame (explicit
   * `columns=[...]`).
   *
   * @returns The column list.
   */
  compareRowColumns(): readonly string[] {
    return ["action", "self_count", "other_count", "delta"];
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      computed_at: this.computed_at,
      project_id: this.project_id,
      replays: this.replays.map((r) => r.toJSON()),
    };
  }

  /**
   * Strictly decode a recorded field-walk payload (`replays` accepts
   * decoded instances or plain dicts).
   *
   * @param raw - The payload.
   * @returns The reconstructed instance (guards fire).
   * @throws {@link ResponseValidationError} - On unknown keys or wrong types.
   * @throws {@link ParamValidationError} - When the `RB1_PROJECT_ID_MISMATCH`
   *   guard fires.
   * @internal
   */
  static fromDict(raw: unknown): ReplayBundle {
    const cls = "ReplayBundle";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "replays",
        "computed_at",
        "project_id",
        "_df_cache",
        "_sessions_df_cache",
        "_actions_df_cache",
        "_events_df_cache",
        "_mixpanel_df_cache",
        "_elements_df_cache",
      ]),
      cls,
    );
    for (const cache of [
      "_df_cache",
      "_sessions_df_cache",
      "_actions_df_cache",
      "_events_df_cache",
      "_mixpanel_df_cache",
      "_elements_df_cache",
    ]) {
      expectNullCache(payload, cache, cls);
    }
    if (
      Object.hasOwn(payload, "replays") &&
      !Array.isArray(payload["replays"])
    ) {
      decodeFail(cls, "replays", "array", payload["replays"]);
    }
    return new ReplayBundle({
      ...(Object.hasOwn(payload, "replays")
        ? {
            replays: (payload["replays"] as readonly unknown[]).map((item) =>
              item instanceof Replay ? item : Replay.fromDict(item),
            ),
          }
        : {}),
      ...(Object.hasOwn(payload, "computed_at")
        ? { computed_at: expectStr(payload, "computed_at", cls) }
        : {}),
      ...(Object.hasOwn(payload, "project_id")
        ? { project_id: expectInt(payload, "project_id", cls) }
        : {}),
    });
  }
}
