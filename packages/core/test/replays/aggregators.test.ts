// Translated aggregator tests (packet B5-S3, `b5-packets.md` §5):
// assertion-for-assertion ports (R10.2) of
//   tests/unit/test_replay_bundle.py
//     TestReplayBundleAggregations :325   (all 5)
//     TestAggregatorFunctions      :459   (all 3)
// PLUS the four asserts that Phase 2 excluded from
// `test/types/results/replays.test.ts` pending this shard's TODO(port)
// closure (that file's headers at :707-710 and :745-748 cite them):
//     TestReplayBundleProjections::test_elements_df
//     TestReplayBundleProjections::test_elements_df_normalizes_urls
//     TestReplayBundleFilters::test_error_sessions
//     TestReplayBundleFilters::test_sample_determinism
//
// pandas frames port as row arrays (C6 `toRows()` precedent), so
// `df.iloc[0]["count"]` becomes `rows[0].count` and `len(df)` becomes
// `rows.length`.
//
// `sample()`'s CPython parity (decision S3-D1) has its own dedicated
// probe lock in `test/compat/python-random.test.ts`; the assert here is
// the Python one (same seed → same sample).
import { describe, expect, it } from "vitest";

import {
  longPauses,
  rageClicks,
  topClicks,
} from "../../src/replays/aggregators.js";
import { UserAction } from "../../src/replays/user-action.js";
import { Replay } from "../../src/types/results/replay-models.js";
import { ReplayBundle } from "../../src/types/results/replays.js";

/**
 * Construct a `UserAction` (Python `_build_action`,
 * `test_replay_bundle.py:49-64`).
 *
 * @param overrides - Field overrides applied over the Python defaults.
 * @returns The constructed action.
 */
function buildAction(
  overrides: {
    timestamp?: number;
    action?: string;
    target_desc?: string;
    url?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): UserAction {
  return new UserAction({
    timestamp: overrides.timestamp ?? 1716810000000,
    action: (overrides.action ?? "click") as UserAction["action"],
    target_node_id: 1,
    target_desc: overrides.target_desc ?? "button",
    url:
      overrides.url === undefined ? "https://example.com/login" : overrides.url,
    metadata: overrides.metadata ?? {},
  });
}

/**
 * Build a `Replay` with the given actions (Python `_make_replay`,
 * `test_replay_bundle.py:67-89`).
 *
 * @param replayId - The replay id.
 * @param actions - The action list.
 * @returns The constructed replay.
 */
function makeReplay(replayId: string, actions: UserAction[]): Replay {
  let start: number;
  let end: number;
  if (actions.length > 0) {
    start = Math.min(...actions.map((a) => a.timestamp));
    end = Math.max(...actions.map((a) => a.timestamp));
  } else {
    start = 1716810000000;
    end = 1716810060000;
  }
  const navEvents = actions
    .filter((a) => a.action === "navigate")
    .map((a) => ({ type: 4, data: { href: a.url }, timestamp: a.timestamp }));
  return new Replay({
    replay_id: replayId,
    distinct_id: null,
    project_id: 12345,
    start_time: start,
    end_time: Math.max(end, start),
    retention_days: 30,
    rrweb_events:
      navEvents.length > 0
        ? navEvents
        : [{ type: 4, data: { href: "/" }, timestamp: start }],
    actions,
    mixpanel_events: [],
  });
}

/**
 * Build the shared aggregation fixture (Python `_sample_bundle`,
 * `test_replay_bundle.py:194-247`).
 *
 * @returns The three-replay bundle.
 */
function sampleBundle(): ReplayBundle {
  const r1 = makeReplay("r-1", [
    buildAction({
      timestamp: 1,
      action: "navigate",
      target_desc: "/login",
      url: "/login",
    }),
    buildAction({
      timestamp: 100,
      action: "click",
      target_desc: "button.signin",
      url: "/login",
    }),
    buildAction({
      timestamp: 200,
      action: "navigate",
      target_desc: "/dashboard",
      url: "/dashboard",
    }),
  ]);
  const r2 = makeReplay("r-2", [
    buildAction({
      timestamp: 1,
      action: "navigate",
      target_desc: "/login",
      url: "/login",
    }),
    buildAction({
      timestamp: 50,
      action: "click",
      target_desc: "button.signin",
      url: "/login",
    }),
    buildAction({
      timestamp: 70,
      action: "click",
      target_desc: "button.signin",
      url: "/login",
    }),
    buildAction({
      timestamp: 90,
      action: "click",
      target_desc: "button.signin",
      url: "/login",
    }),
    buildAction({
      timestamp: 1_000_000,
      action: "navigate",
      target_desc: "/dashboard",
      url: "/dashboard",
    }),
  ]);
  const r3 = makeReplay("r-3", [
    buildAction({
      timestamp: 1,
      action: "navigate",
      target_desc: "/login",
      url: "/login",
    }),
    buildAction({
      timestamp: 500,
      action: "console_error",
      target_desc: "TypeError",
      url: "/login",
    }),
  ]);
  return new ReplayBundle({
    replays: [r1, r2, r3],
    computed_at: "2026-05-27T00:00:00Z",
    project_id: 12345,
  });
}

describe("bundle aggregation methods (TestReplayBundleAggregations)", () => {
  it("test_top_clicks", () => {
    const out = sampleBundle().topClicks();
    expect(out[0]?.["target_desc"]).toBe("button.signin");
    expect(out[0]?.["count"]).toBe(4);
  });

  it("test_top_clicks_excludes_focus", () => {
    const r = makeReplay("r-f", [
      buildAction({
        timestamp: 10,
        action: "click",
        target_desc: "btn",
        url: "/x",
        metadata: { interaction: "focused" },
      }),
      buildAction({
        timestamp: 20,
        action: "click",
        target_desc: "btn",
        url: "/x",
        metadata: { interaction: "clicked" },
      }),
    ]);
    const b = new ReplayBundle({
      replays: [r],
      computed_at: "t",
      project_id: 12345,
    });
    const out = b.topClicks().find((row) => row["target_desc"] === "btn");
    expect(out?.["count"]).toBe(1);
  });

  it("test_rage_clicks", () => {
    const out = sampleBundle().rageClicks({ threshold: 3, windowMs: 100 });
    expect(out).toHaveLength(1);
    expect(out[0]?.["replay_id"]).toBe("r-2");
    expect(out[0]?.["count"]).toBe(3);
  });

  it("test_rage_clicks_excludes_focus", () => {
    const base = 1716810000000;
    // Three genuine clicks within the window = one real 3-burst.
    const real = makeReplay(
      "r-real",
      [0, 10, 20].map((ts) =>
        buildAction({
          timestamp: base + ts,
          action: "click",
          target_desc: "button.go",
          url: "/x",
          metadata: { interaction: "clicked" },
        }),
      ),
    );
    // Two genuine clicks padded with focus rows must NOT reach 3.
    const padded = makeReplay(
      "r-padded",
      (
        [
          [0, "focused"],
          [10, "clicked"],
          [20, "focused"],
          [30, "clicked"],
        ] as ReadonlyArray<readonly [number, string]>
      ).map(([ts, interaction]) =>
        buildAction({
          timestamp: base + ts,
          action: "click",
          target_desc: "button.go",
          url: "/x",
          metadata: { interaction },
        }),
      ),
    );
    const b = new ReplayBundle({
      replays: [real, padded],
      computed_at: "t",
      project_id: 12345,
    });
    const out = b.rageClicks({ threshold: 3, windowMs: 100 });
    expect(new Set(out.map((row) => row["replay_id"]))).toStrictEqual(
      new Set(["r-real"]),
    );
  });

  it("test_long_pauses", () => {
    const out = sampleBundle().longPauses(10);
    expect(out.some((row) => row["replay_id"] === "r-2")).toBe(true);
  });
});

describe("module-level aggregators (TestAggregatorFunctions)", () => {
  it("test_rage_clicks_module", () => {
    const out = rageClicks(sampleBundle(), { threshold: 3, windowMs: 100 });
    expect(out).toHaveLength(1);
  });

  it("test_long_pauses_module", () => {
    const out = longPauses(sampleBundle(), 10);
    expect(out.length).toBeGreaterThanOrEqual(1);
  });

  it("test_top_clicks_module", () => {
    expect(topClicks(sampleBundle())[0]?.target_desc).toBe("button.signin");
  });
});

describe("elements frame — the Phase-2 deferrals (TestReplayBundleProjections)", () => {
  it("test_elements_df", () => {
    const rows = sampleBundle().toElementsRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(sampleBundle().elementsRowColumns()).toContain("n_clicks");
    const row = rows.find((r) => r["target_desc"] === "button.signin");
    // 1 click from r1 + 3 from r2 = 4
    expect(row?.["n_clicks"]).toBe(4);
  });

  it("test_elements_df_normalizes_urls", () => {
    const r = makeReplay("r-n", [
      buildAction({
        timestamp: 10,
        action: "click",
        target_desc: "row",
        url: "/users/1/profile",
      }),
      buildAction({
        timestamp: 20,
        action: "click",
        target_desc: "row",
        url: "/users/2/profile",
      }),
    ]);
    const b = new ReplayBundle({
      replays: [r],
      computed_at: "t",
      project_id: 12345,
    });
    const rows = b
      .toElementsRows()
      .filter((row) => row["target_desc"] === "row");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["url"]).toBe("/users/:id/profile");
    expect(rows[0]?.["n_clicks"]).toBe(2);
  });
});

describe("error-session + sample filters — the Phase-2 deferrals (TestReplayBundleFilters)", () => {
  it("test_error_sessions", () => {
    const out = sampleBundle().errorSessions();
    expect(out.replays.map((r) => r.replay_id)).toStrictEqual(["r-3"]);
  });

  it("test_sample_determinism", () => {
    const b = sampleBundle();
    const a = b.sample(2, 42).replays.map((r) => r.replay_id);
    const c = b.sample(2, 42).replays.map((r) => r.replay_id);
    expect(a).toStrictEqual(c);
    expect(a).toHaveLength(2);
  });
});
