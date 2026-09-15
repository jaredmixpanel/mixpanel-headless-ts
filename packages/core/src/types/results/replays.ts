/**
 * `ReplayBundle` — a collection of session replays with aggregate
 * frames, the TS port of `mixpanel_headless.types.ReplayBundle`.
 *
 * The bundle sits at the top of the replay family: it composes the
 * per-replay dataclasses (`./replay-models.ts`), the bundle aggregations
 * (`replays/aggregators.ts`), the label functions
 * (`replays/replay-labels.ts`) and — for `sample` — full CPython
 * `random.Random(seed)` parity (`compat/python-random.ts`). Nothing
 * below it imports this module.
 *
 * Multi-frame surface: `sessions_df`/`actions_df`/`events_df`/
 * `mixpanel_df` become `toSessionsRows()`/`toActionsRows()`/
 * `toEventsRows()`/`toMixpanelRows()`; the main `.df` delegates to the
 * sessions frame. The codec-visible cache slots stay `null` (see
 * `replay-models.ts`).
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
 * One replay `fetch_replays` skipped — TS-only. Python's `ReplayBundle`
 * has no such field: its `fetch_replays` only logs the skipped id.
 */
export interface ReplayFetchFailure {
  /** The replay that was skipped. */
  readonly replay_id: string;
  /** Why it was skipped (`ReplayNotFoundError`, a CDN stall, a parse error, …). */
  readonly error: Error;
}

/** Declared fields of {@link ReplayBundle} (Python field order). */
export interface ReplayBundleFields {
  /** Replays in the bundle. Default: `[]`. */
  readonly replays?: readonly Replay[];
  /** When the bundle was computed (ISO text). Default: `""`. */
  readonly computed_at?: string;
  /** Owning project ID (`0` when unset). Default: `0`. */
  readonly project_id?: number;
  /**
   * Replays `fetch_replays` skipped (TS-only, additive; see
   * {@link ReplayBundle.failures}). Default: `[]`.
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
 * A collection of replays with aggregate frames — TS port of
 * `types.ReplayBundle`.
 *
 * Multi-frame surface: `sessions_df`/`actions_df`/`events_df`/
 * `mixpanel_df` become `toSessionsRows()`/`toActionsRows()`/
 * `toEventsRows()`/`toMixpanelRows()`; the main `.df` delegates to the
 * sessions frame. See the module doc for the B5-deferred members.
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
   * @throws ParamValidationError - `RB1_PROJECT_ID_MISMATCH` when
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
   * short. Empty for bundles built any other way, and NOT carried over by
   * the derived-bundle members (`filter`, `head`, `sample`).
   *
   * Divergence: Python only logs the skipped ids (`fetch_replays`
   * `logger.warning`); the structured record is TS-only, following the
   * `failed_pages` meta precedent of the parallel user query. A prototype
   * getter, not an own property, so `toJSON()` / the conformance codec
   * do not see it.
   *
   * @returns The skipped replays with their errors.
   */
  get failures(): readonly ReplayFetchFailure[] {
    return this.#failures;
  }

  /**
   * Pre-pandas rows of the Python `sessions_df` body: one summary row
   * per replay.
   *
   * @returns The rows list.
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
   * Pre-pandas rows of the Python bundle `actions_df` body (replay-id
   * prefixed action rows across every replay).
   *
   * @returns The rows list.
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
   * Pre-pandas rows of the Python bundle `events_df` body (projected
   * rrweb rows with `replay_id` added AFTER projection, exactly as
   * Python mutates the row dict — the key lands LAST).
   *
   * @returns The rows list.
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
   * `columns=cols` — `replay_id` FIRST, unlike the row-dict insertion
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
   * Pre-pandas rows of the Python bundle `mixpanel_df` body.
   *
   * @returns The rows list.
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
   * The main `.df` contract — Python's `df` property returns
   * `sessions_df`.
   *
   * @returns.
   */
  toRows(): readonly Row[] {
    return this.toSessionsRows();
  }

  /**
   * Column contract of the main `.df` frame.
   *
   * @returns.
   */
  rowColumns(): readonly string[] {
    return this.sessionsRowColumns();
  }

  /**
   * New bundle keeping only replays matching a predicate — mirror of
   * Python `filter()` (same `computed_at`/`project_id`).
   *
   * @param predicate - Keep test.
   * @returns The filtered bundle.
   */
  filter(predicate: (replay: Replay) => boolean): ReplayBundle {
    return new ReplayBundle({
      replays: this.replays.filter((replay) => predicate(replay)),
      computed_at: this.computed_at,
      project_id: this.project_id,
    });
  }

  /**
   * Declarative filter — mirror of Python `where()` (all provided
   * conditions must hold).
   *
   * @param options - Filter conditions.
   * @param options.distinct_id - Exact distinct-ID match.
   * @param options.contains_url - Substring of any navigate URL.
   * @param options.has_event - Name of a correlated Mixpanel event.
   * @param options.min_duration_s - Minimum duration (inclusive).
   * @param options.max_duration_s - Maximum duration (inclusive).
   * @returns The filtered bundle.
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
   * New bundle with the first `n` replays — mirror of Python
   * `head()`.
   *
   * @param n - Max replays to keep. Default: `5`.
   * @returns The truncated bundle.
   */
  head(n = 5): ReplayBundle {
    return new ReplayBundle({
      replays: this.replays.slice(0, n),
      computed_at: this.computed_at,
      project_id: this.project_id,
    });
  }

  /**
   * One row per `(target_desc, normalized_url)` with click counts
   * (Python `elements_df` property, `types.py`). Closed at
   * B5-S3 — the `real_clicks` + `url_normalizer` dependencies landed
   * with the aggregators.
   *
   * Counts exclude focus-only interactions (a real click fires both a
   * `focused` and a `clicked` action; counting both double-counts every
   * click). URLs are normalized via `urlNormalizer` so the same element
   * on parameterized pages aggregates into one row.
   *
   * @returns `{target_desc, url, n_clicks, n_unique_replays}` rows;
   *   empty when the bundle has no genuine clicks.
   */
  toElementsRows(): readonly Row[] {
    const clicks = realClicks(this.toActionsRows());
    if (clicks.length === 0) {
      return [];
    }
    // `groupby(["target_desc", "url"], dropna=False).agg(...)` — pandas
    // sorts the composite group key ascending; the URL column is the
    // NORMALIZED one (`clicks.assign(url=...)`), and Python's
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
      // SKIPS NaN; the column is never null in this projection.
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
   * Rank the most-clicked targets across every replay in the bundle
   * (Python `top_clicks`, `types.py`).
   *
   * @param n - Maximum number of click targets to return. Default 10.
   * @returns `{target_desc, count}` rows, descending by count.
   */
  topClicks(n = 10): readonly Row[] {
    return topClicks(this, n);
  }

  /**
   * Find rage-click bursts — repeated clicks on one target in a tight
   * window (Python `rage_clicks`, `types.py`).
   *
   * @param options - `threshold` (default 3) / `windowMs` (default
   *   1000).
   * @returns `{replay_id, t_start, target_desc, count}` rows.
   */
  rageClicks(
    options: { threshold?: number; windowMs?: number } = {},
  ): readonly Row[] {
    return rageClicks(this, options);
  }

  /**
   * Find idle stretches between consecutive actions longer than a
   * threshold (Python `long_pauses`, `types.py`).
   *
   * @param thresholdS - Minimum pause length in seconds. Default 10.
   * @returns `{replay_id, t_start, duration_s}` rows.
   */
  longPauses(thresholdS = 10): readonly Row[] {
    return longPauses(this, thresholdS);
  }

  /**
   * New bundle whose action labels contain `actionSequence` as a
   * CONTIGUOUS subsequence (Python `find_pattern`,
   * `types.py`).
   *
   * @param actionSequence - Labels to look for, in order. An empty list
   *   matches every replay (returns a full clone).
   * @param options - Optional `labelFn` override (defaults to
   *   `defaultLabelFn`).
   * @returns The filtered bundle.
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
   * New bundle of only the replays that emitted a console error
   * (Python `error_sessions`, `types.py`).
   *
   * @returns The filtered bundle; empty when the bundle has no console
   *   errors.
   */
  errorSessions(): ReplayBundle {
    const ids = new Set(errorSessions(this));
    return this.filter((r) => ids.has(r.replay_id));
  }

  /**
   * New bundle with up to `n` replays, deterministic per `seed`
   * (Python `sample`, `types.py`). Closed at B5-S3 with
   * FULL CPython `random.Random(seed).sample` parity (decision S3-D1,
   * `B5-S3-notes.md`) — the same seed selects the same replays in both
   * runtimes, not merely self-consistently.
   *
   * @param n - How many replays to sample. Default 5.
   * @param seed - Optional integer seed for reproducible sampling.
   *   `null` / omitted needs `entropy` (there is no `os.urandom` seam
   *   in `core`, R9.5).
   * @param entropy - 32-bit seed words used when `seed` is `null`.
   * @returns A bundle whose `replays` has length `min(n, total)`.
   * @throws MixpanelHeadlessError - Code `PY_RANDOM_SEED_UNSUPPORTED`
   *   when neither a seed nor entropy is supplied.
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
   * Markdown rollup of the bundle: header totals plus per-session
   * timelines (Python `summary_markdown`, `types.py`).
   *
   * @returns A markdown string; `"# No replays in bundle\n"` when the
   *   bundle is empty.
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
      // Python wraps each per-replay render in `except NotImplementedError`
      // — a Phase-2-era holdover from the unported `summary_markdown`.
      // The member is implemented now and cannot raise it, so the
      // fallback branch is unreachable in both runtimes.
      sections.push(r.summaryMarkdown(), "\n---\n");
    }
    return sections.join("\n");
  }

  /**
   * Identity copy — mirror of Python `join_mixpanel_events()` (the
   * Python body ignores `properties` and returns a copy).
   *
   * @param properties - Ignored, as in Python.
   * @returns A copy of this bundle.
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
   * Action-count comparison rows against another bundle — mirror of
   * Python `compare()` (value counts per action label, sorted union
   * of keys).
   *
   * @param other - The bundle to compare against.
   * @returns `{action, self_count, other_count, delta}` rows.
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
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @throws ParamValidationError - When the RB1 guard fires.
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
