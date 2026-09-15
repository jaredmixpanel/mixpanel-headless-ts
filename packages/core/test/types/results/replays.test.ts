// Translated replay-family tests (packet P2-6, phase2-design C6-d):
// assertion-for-assertion ports of
//   tests/unit/test_types_replay.py         (Replay convenience + frames)
//   tests/unit/test_types_replay_summary.py (ReplaySummary)
//   tests/unit/test_types_replay_event.py   (ReplayEvent)
//   tests/unit/test_types_signed_replay.py  (SignedReplay)
//   tests/unit/test_replay_bundle.py        (ReplayBundle projections/
//                                            filters + UA/RB1 coded guards)
//
// Not ported: the parametrized Coded*Codes suites of the four
// types_replay* files (their guard cases replay verbatim as the 60
// `types.Replay*`/`types.SignedReplay` corpus vectors — C8(c) lock #2);
// `summary_markdown` / `elements_df` / aggregations (`top_clicks`,
// `rage_clicks`, `long_pauses`, `error_sessions`) / `sample`
// determinism / analyzer + label suites (TODO(port), batch B5 — see
// the replays.ts module doc); frozen-dataclass immutability suites
// (compile-time `readonly`). Construction guard tests asserting
// `pytest.raises(ValueError, match="field")` translate to
// `{class, code}` assertions (message TEXT is out of contract, R5.4 —
// the code is the stronger, recorded contract).
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type MixpanelHeadlessError,
  ParamValidationError,
} from "../../../src/errors.js";
import { UserAction } from "../../../src/replays/user-action.js";
import {
  Replay,
  ReplayEvent,
  type ReplayEventFields,
  ReplaySummary,
  type ReplaySummaryFields,
  SignedReplay,
  type SignedReplayFields,
} from "../../../src/types/results/replay-models.js";
import { ReplayBundle } from "../../../src/types/results/replays.js";

/**
 * Assert a thunk throws the exact guard `{class, code}` pair.
 *
 * @param thunk - The construction under test.
 * @param code - Expected registry code.
 */
function expectGuard(thunk: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    thunk();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected ${code}`).toBeInstanceOf(ParamValidationError);
  expect((thrown as MixpanelHeadlessError).code).toBe(code);
}

// ---------------------------------------------------------------------------
// Fixtures (Python helpers, translated verbatim)
// ---------------------------------------------------------------------------

/** Meta-type rrweb event (Python `_meta`). */
function meta(ts: number, href: string): Record<string, unknown> {
  return { type: 4, data: { href, width: 1280, height: 800 }, timestamp: ts };
}

/** IncrementalSnapshot Click event (Python `_click`). */
function click(ts: number, nodeId: number): Record<string, unknown> {
  return {
    type: 3,
    data: { source: 2, type: 2, id: nodeId, x: 100, y: 200 },
    timestamp: ts,
  };
}

/** FullSnapshot event (Python `_full_snapshot`). */
function fullSnapshot(ts: number): Record<string, unknown> {
  return {
    type: 2,
    data: {
      node: { id: 1, type: 0, childNodes: [] },
      initialOffset: { left: 0, top: 0 },
    },
    timestamp: ts,
  };
}

/** Build a Replay with a tiny event stream (Python `_build`). */
function buildReplay(
  options: {
    rrweb_events?: ReadonlyArray<Record<string, unknown>>;
    actions?: readonly UserAction[];
    mixpanel_events?: readonly ReplayEvent[];
  } = {},
): Replay {
  const events = options.rrweb_events ?? [
    meta(1716810000000, "https://app.example.com/login"),
    fullSnapshot(1716810000500),
    click(1716810002000, 13),
    meta(1716810005000, "https://app.example.com/dashboard"),
  ];
  return new Replay({
    replay_id: "r-19221",
    distinct_id: "user-42",
    project_id: 3713224,
    start_time: 1716810000000,
    end_time: 1716810015000,
    retention_days: 30,
    rrweb_events: events,
    actions: options.actions ?? [],
    mixpanel_events: options.mixpanel_events ?? [],
  });
}

/** Construct a UserAction for label/aggregator tests (Python `_build_action`). */
function buildAction(
  options: {
    timestamp?: number;
    action?: string;
    target_desc?: string;
    url?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): UserAction {
  return new UserAction({
    timestamp: options.timestamp ?? 1716810000000,
    action: (options.action ?? "click") as UserAction["action"],
    target_node_id: 1,
    target_desc: options.target_desc ?? "button",
    url: options.url === undefined ? "https://example.com/login" : options.url,
    metadata: options.metadata ?? {},
  });
}

/** Build a Replay from actions (Python `_make_replay`). */
function makeReplay(replayId: string, actions: readonly UserAction[]): Replay {
  const start =
    actions.length > 0
      ? Math.min(...actions.map((a) => a.timestamp))
      : 1716810000000;
  const end =
    actions.length > 0
      ? Math.max(...actions.map((a) => a.timestamp))
      : 1716810060000;
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

/** Build the small synthetic bundle (Python `_sample_bundle`). */
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
    computed_at: "2026-08-15T00:00:00Z",
    project_id: 12345,
  });
}

// ---------------------------------------------------------------------------
// Replay (tests/unit/test_types_replay.py)
// ---------------------------------------------------------------------------

describe("Replay convenience (TestReplayConvenience)", () => {
  it("test_duration_seconds", () => {
    expect(buildReplay().duration_seconds).toBe(15.0);
  });

  it("test_to_rrweb_player_json_returns_sorted_dicts", () => {
    const unsorted = [
      click(1716810002000, 13),
      meta(1716810000000, "https://app.example.com/login"),
      meta(1716810005000, "https://app.example.com/dashboard"),
    ];
    const out = buildReplay({ rrweb_events: unsorted }).toRrwebPlayerJson();
    const timestamps = out.map((e) => e["timestamp"] as number);
    expect(timestamps).toStrictEqual([...timestamps].sort((a, b) => a - b));
  });

  it("test_page_path", () => {
    const actions = [
      new UserAction({
        timestamp: 1716810000000,
        action: "navigate",
        target_node_id: null,
        target_desc: "Navigated to https://app.example.com/login",
        url: "https://app.example.com/login",
        metadata: {},
      }),
      new UserAction({
        timestamp: 1716810005000,
        action: "navigate",
        target_node_id: null,
        target_desc: "Navigated to https://app.example.com/dashboard",
        url: "https://app.example.com/dashboard",
        metadata: {},
      }),
    ];
    expect(buildReplay({ actions }).pagePath()).toStrictEqual([
      "https://app.example.com/login",
      "https://app.example.com/dashboard",
    ]);
  });
});

describe("Replay events frame (TestReplayEventsDataFrame)", () => {
  it("test_columns_documented", () => {
    const cols = buildReplay().eventsRowColumns();
    for (const col of [
      "t",
      "type",
      "source",
      "mouse_type",
      "target_node_id",
      "url",
      "raw",
    ]) {
      expect(cols).toContain(col);
    }
  });

  it("test_row_per_event", () => {
    const r = buildReplay();
    expect(r.toEventsRows()).toHaveLength(r.rrweb_events.length);
  });
});

describe("Replay actions default empty (TestReplayActionsDefaultEmpty)", () => {
  it("test_actions_default_empty", () => {
    expect(buildReplay().actions).toStrictEqual([]);
  });

  it("test_actions_df_empty_with_schema", () => {
    const r = buildReplay();
    expect(r.toActionsRows()).toHaveLength(0);
    for (const col of [
      "t",
      "action",
      "target_node_id",
      "target_desc",
      "description",
      "url",
      "metadata",
    ]) {
      expect(r.actionsRowColumns()).toContain(col);
    }
  });

  it("test_df_default_is_actions_df", () => {
    const r = buildReplay();
    expect(r.toRows()).toStrictEqual(r.toActionsRows());
    expect(r.rowColumns()).toStrictEqual(r.actionsRowColumns());
  });
});

describe("Replay analyzer accessors, empty actions (TestReplayAnalyzerAccessorsEmptyActions)", () => {
  // test_summary_markdown_placeholder is NOT ported (summary_markdown
  // depends on the B5 rrweb analyzer — TODO(port)).

  it("test_errors_empty", () => {
    expect(buildReplay().toErrorsRows()).toHaveLength(0);
  });

  it("test_clicks_on_empty", () => {
    expect(buildReplay().clicksOnRows(() => true)).toHaveLength(0);
  });
});

describe("Replay mixpanel frame (TestReplayMixpanelDataFrame)", () => {
  it("test_mixpanel_df_empty_default", () => {
    const r = buildReplay();
    expect(r.toMixpanelRows()).toHaveLength(0);
    for (const col of ["t", "event_name", "properties"]) {
      expect(r.mixpanelRowColumns()).toContain(col);
    }
  });
});

// ---------------------------------------------------------------------------
// ReplaySummary (tests/unit/test_types_replay_summary.py)
// ---------------------------------------------------------------------------

/** ReplaySummary defaults (Python `_build`). */
function buildSummary(
  overrides: Partial<ReplaySummaryFields> = {},
): ReplaySummary {
  return new ReplaySummary({
    replay_id: "r-19221",
    distinct_id: "user-42",
    project_id: 3713224,
    start_time: 1716810000000,
    retention_days: 30,
    ...overrides,
  });
}

describe("ReplaySummary construction (TestReplaySummaryConstruction)", () => {
  it("test_happy_path", () => {
    const s = buildSummary();
    expect(s.replay_id).toBe("r-19221");
    expect(s.distinct_id).toBe("user-42");
    expect(s.project_id).toBe(3713224);
    expect(s.start_time).toBe(1716810000000);
    expect(s.retention_days).toBe(30);
  });

  it("test_distinct_id_none_allowed", () => {
    expect(buildSummary({ distinct_id: null }).distinct_id).toBeNull();
  });

  it("test_empty_replay_id_rejected", () => {
    expectGuard(() => buildSummary({ replay_id: "" }), "RS1_EMPTY_REPLAY_ID");
  });

  it("test_non_positive_project_id_rejected", () => {
    expectGuard(
      () => buildSummary({ project_id: 0 }),
      "RS2_PROJECT_ID_NOT_POSITIVE",
    );
    expectGuard(
      () => buildSummary({ project_id: -1 }),
      "RS2_PROJECT_ID_NOT_POSITIVE",
    );
  });

  it("test_non_positive_start_time_rejected", () => {
    expectGuard(
      () => buildSummary({ start_time: 0 }),
      "RS3_START_TIME_NOT_POSITIVE",
    );
    expectGuard(
      () => buildSummary({ start_time: -1 }),
      "RS3_START_TIME_NOT_POSITIVE",
    );
  });

  it("test_invalid_retention_rejected", () => {
    for (const badRetention of [0, 2, 5, 14, 60, 100]) {
      expectGuard(
        () => buildSummary({ retention_days: badRetention }),
        "RS4_INVALID_RETENTION_DAYS",
      );
    }
  });

  it("test_valid_retention_accepted", () => {
    for (const goodRetention of [1, 7, 30, 90]) {
      expect(
        buildSummary({ retention_days: goodRetention }).retention_days,
      ).toBe(goodRetention);
    }
  });
});

describe("ReplaySummary round trip (TestReplaySummaryRoundTrip)", () => {
  it("test_to_dict_round_trip", () => {
    const d = buildSummary().toJSON();
    expect(d["replay_id"]).toBe("r-19221");
    expect(d["distinct_id"]).toBe("user-42");
    expect(d["project_id"]).toBe(3713224);
    expect(d["start_time"]).toBe(1716810000000);
    expect(d["retention_days"]).toBe(30);
  });

  it("test_to_dict_json_serializable", () => {
    expect(() => JSON.stringify(buildSummary().toJSON())).not.toThrow();
  });
});

describe("ReplaySummary frame (TestReplaySummaryDataFrame)", () => {
  it("test_df_single_row", () => {
    const s = buildSummary();
    const rows = s.toRows();
    expect(rows).toHaveLength(1);
    for (const col of [
      "replay_id",
      "distinct_id",
      "project_id",
      "start_time",
      "retention_days",
    ]) {
      expect(s.rowColumns()).toContain(col);
    }
    expect(rows[0]?.["replay_id"]).toBe("r-19221");
    expect(rows[0]?.["retention_days"]).toBe(30);
  });

  it("test_df_cached (determinism)", () => {
    const s = buildSummary();
    expect(s.toRows()).toStrictEqual(s.toRows());
  });
});

// ---------------------------------------------------------------------------
// ReplayEvent (tests/unit/test_types_replay_event.py)
// ---------------------------------------------------------------------------

/** ReplayEvent defaults (Python `_build`). */
function buildEvent(overrides: Partial<ReplayEventFields> = {}): ReplayEvent {
  return new ReplayEvent({
    replay_id: "r-19221",
    event_name: "Login",
    event_time: 1716810000,
    properties: { $browser: "Chrome", plan: "pro" },
    ...overrides,
  });
}

describe("ReplayEvent construction (TestReplayEventConstruction)", () => {
  it("test_happy_path", () => {
    const e = buildEvent();
    expect(e.replay_id).toBe("r-19221");
    expect(e.event_name).toBe("Login");
    expect(e.event_time).toBe(1716810000);
    expect(e.properties).toStrictEqual({ $browser: "Chrome", plan: "pro" });
  });

  it("test_properties_none_allowed", () => {
    expect(buildEvent({ properties: null }).properties).toBeNull();
  });

  it("test_empty_replay_id_rejected", () => {
    expectGuard(() => buildEvent({ replay_id: "" }), "RE1_EMPTY_REPLAY_ID");
  });

  it("test_empty_event_name_rejected", () => {
    expectGuard(() => buildEvent({ event_name: "" }), "RE2_EMPTY_EVENT_NAME");
  });

  it("test_non_positive_event_time_rejected", () => {
    expectGuard(
      () => buildEvent({ event_time: 0 }),
      "RE3_EVENT_TIME_NOT_POSITIVE",
    );
    expectGuard(
      () => buildEvent({ event_time: -1 }),
      "RE3_EVENT_TIME_NOT_POSITIVE",
    );
  });
});

describe("ReplayEvent frame (TestReplayEventDataFrame)", () => {
  it("test_columns_documented", () => {
    const cols = buildEvent().rowColumns();
    for (const col of ["replay_id", "event_name", "event_time", "properties"]) {
      expect(cols).toContain(col);
    }
  });

  it("test_single_row", () => {
    expect(buildEvent().toRows()).toHaveLength(1);
  });

  it("test_values_round_trip", () => {
    const row = buildEvent().toRows()[0];
    expect(row?.["replay_id"]).toBe("r-19221");
    expect(row?.["event_name"]).toBe("Login");
    expect(row?.["event_time"]).toBe(1716810000);
  });
});

describe("ReplayEvent round trip (TestReplayEventRoundTrip)", () => {
  it("test_to_dict_round_trip", () => {
    const d = buildEvent().toJSON();
    expect(d["replay_id"]).toBe("r-19221");
    expect(d["event_name"]).toBe("Login");
    expect(d["event_time"]).toBe(1716810000);
    expect((d["properties"] as Record<string, unknown>)["$browser"]).toBe(
      "Chrome",
    );
  });

  it("test_to_dict_json_serializable", () => {
    expect(() => JSON.stringify(buildEvent().toJSON())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SignedReplay (tests/unit/test_types_signed_replay.py)
// ---------------------------------------------------------------------------

const QS = "URLPrefix=ABCDEF&Expires=1716810300&KeyName=K&Signature=zzzzzzzzzz";
const URL = "https://cdn.mxpnl.com/srr-us/abc123-3713224/";

/** SignedReplay defaults (Python `_build`). */
function buildSigned(
  overrides: Partial<SignedReplayFields> = {},
): SignedReplay {
  return new SignedReplay({
    replay_id: "r-19221",
    url: URL,
    query_string: QS,
    env: "prod",
    signed_at: 1716810000.0,
    ...overrides,
  });
}

describe("SignedReplay masking (TestSignedReplayMasking)", () => {
  it("test_repr_masks_query_string", () => {
    const r = String(buildSigned());
    expect(r).toContain(`<redacted ${String(QS.length)} chars>`);
    expect(r).not.toContain("Signature=");
    expect(r).not.toContain("URLPrefix=");
    expect(r).not.toContain("Expires=");
  });

  it("test_unique_signature_chunk_does_not_leak", () => {
    const distinctive =
      "URLPrefix=ABCDEFGHIJKL&Expires=NOPQRSTUVW&" +
      "KeyName=KEYY&Signature=ZYXWVUTSRQPONMLK";
    const s = buildSigned({ query_string: distinctive });
    const body = s.toString() + String(s);
    for (let start = 0; start < distinctive.length - 12; start += 1) {
      const chunk = distinctive.slice(start, start + 12);
      expect(body.includes(chunk), `chunk ${chunk} leaked`).toBe(false);
    }
    expect(body).not.toContain("ZYXWVUTSRQPONMLK");
  });

  it("test_repr_includes_other_fields", () => {
    const r = String(buildSigned());
    expect(r).toContain("r-19221");
    expect(r).toContain(URL);
    expect(r).toContain("'prod'");
  });
});

describe("SignedReplay expiration (TestSignedReplayExpiration)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("test_expires_at_is_signed_at_plus_300", () => {
    expect(buildSigned({ signed_at: 1716810000.0 }).expires_at).toBe(
      1716810300.0,
    );
  });

  it("test_is_expired_false_just_before_boundary", () => {
    const now = 1_716_810_000.0;
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    const s = buildSigned({ signed_at: now - 299 });
    expect(s.is_expired).toBe(false);
  });

  it("test_is_expired_true_at_boundary", () => {
    const s = buildSigned({ signed_at: Date.now() / 1000 - 300 });
    expect(s.is_expired).toBe(true);
  });

  it("test_is_expired_true_well_after", () => {
    const s = buildSigned({ signed_at: Date.now() / 1000 - 10_000 });
    expect(s.is_expired).toBe(true);
  });
});

describe("SignedReplay to_dict (TestSignedReplayToDict)", () => {
  it("test_includes_full_credential", () => {
    expect(buildSigned().toJSON()["query_string"]).toBe(QS);
  });

  it("test_includes_warning_key", () => {
    const d = buildSigned().toJSON();
    expect(Object.hasOwn(d, "_warning")).toBe(true);
    expect(d["_warning"]).toContain("bearer credential");
    expect(d["_warning"]).toContain("5 minutes");
  });

  it("test_includes_every_field", () => {
    const d = buildSigned().toJSON();
    for (const key of [
      "replay_id",
      "url",
      "query_string",
      "env",
      "signed_at",
    ]) {
      expect(Object.hasOwn(d, key), key).toBe(true);
    }
  });

  it("test_to_dict_json_serializable", () => {
    expect(() => JSON.stringify(buildSigned().toJSON())).not.toThrow();
  });
});

describe("SignedReplay validation (TestSignedReplayValidation)", () => {
  it("test_url_must_end_with_slash", () => {
    expectGuard(
      () => buildSigned({ url: "https://cdn.mxpnl.com/srr-us/abc123-3713224" }),
      "SR1_URL_NO_TRAILING_SLASH",
    );
  });

  it("test_empty_query_string_rejected", () => {
    expectGuard(
      () => buildSigned({ query_string: "" }),
      "SR2_EMPTY_QUERY_STRING",
    );
  });

  it("test_invalid_env_rejected", () => {
    for (const badEnv of ["staging", "PROD", "test", ""]) {
      expectGuard(
        () => buildSigned({ env: badEnv as "prod" }),
        "SR3_INVALID_ENV",
      );
    }
  });

  it("test_valid_env_accepted", () => {
    for (const goodEnv of ["prod", "dev"] as const) {
      expect(buildSigned({ env: goodEnv }).env).toBe(goodEnv);
    }
  });

  it("test_negative_signed_at_rejected", () => {
    expectGuard(
      () => buildSigned({ signed_at: -1.0 }),
      "SR4_SIGNED_AT_NEGATIVE",
    );
  });
});

// ---------------------------------------------------------------------------
// ReplayBundle (tests/unit/test_replay_bundle.py)
// ---------------------------------------------------------------------------

describe("ReplayBundle projections (TestReplayBundleProjections)", () => {
  // test_elements_df / test_elements_df_normalizes_urls are NOT ported
  // (elements_df depends on the B5 aggregators + url_normalizer —
  // TODO(port)).

  it("test_sessions_df", () => {
    const b = sampleBundle();
    const rows = b.toSessionsRows();
    expect(rows).toHaveLength(3);
    for (const col of [
      "replay_id",
      "n_actions",
      "n_clicks",
      "n_pages",
      "n_errors",
    ]) {
      expect(b.sessionsRowColumns()).toContain(col);
    }
    // r-2 has 3 clicks; r-3 has 1 error.
    const r2Row = rows.find((row) => row["replay_id"] === "r-2");
    expect(r2Row?.["n_clicks"]).toBe(3);
    const r3Row = rows.find((row) => row["replay_id"] === "r-3");
    expect(r3Row?.["n_errors"]).toBe(1);
  });

  it("test_actions_df_long_format", () => {
    const b = sampleBundle();
    expect(b.actionsRowColumns()).toContain("replay_id");
    // Total actions = 3 + 5 + 2 = 10
    expect(b.toActionsRows()).toHaveLength(10);
  });

  it("test_default_df_is_sessions", () => {
    const b = sampleBundle();
    expect(b.toRows()).toStrictEqual(b.toSessionsRows());
    expect(b.rowColumns()).toStrictEqual(b.sessionsRowColumns());
  });
});

describe("ReplayBundle filters (TestReplayBundleFilters)", () => {
  // test_error_sessions and test_sample_determinism are NOT ported
  // (error_sessions rides the B5 aggregators; sample() requires Python
  // Mersenne random.Random(seed) parity — TODO(port)).

  it("test_filter_predicate", () => {
    const b = sampleBundle();
    const out = b.filter((r) => r.replay_id === "r-1");
    expect(out.replays.map((r) => r.replay_id)).toStrictEqual(["r-1"]);
    // Original is unchanged (immutability).
    expect(b.replays).toHaveLength(3);
  });

  it("test_where_distinct_id", () => {
    const b = sampleBundle();
    const out = b.where({ distinct_id: null });
    // All synthetic replays have distinct_id=None; Python's
    // `where(distinct_id=None)` means "no filter" — all match.
    expect(out.replays).toHaveLength(3);
  });

  it("test_head_bound", () => {
    const b = sampleBundle();
    expect(b.head(2).replays).toHaveLength(2);
    expect(b.head(10).replays).toHaveLength(3); // bound clamped to total
  });
});

describe("UserAction coded guards (TestCodedUserActionCodes)", () => {
  it("test_zero_timestamp_raises_ua1", () => {
    expectGuard(
      () => buildAction({ timestamp: 0 }),
      "UA1_TIMESTAMP_NOT_POSITIVE",
    );
  });

  it("test_negative_timestamp_raises_ua1", () => {
    expectGuard(
      () => buildAction({ timestamp: -1 }),
      "UA1_TIMESTAMP_NOT_POSITIVE",
    );
  });

  it("test_empty_target_desc_click_raises_ua2", () => {
    expectGuard(
      () => buildAction({ action: "click", target_desc: "" }),
      "UA2_EMPTY_TARGET_DESC",
    );
  });

  it("test_empty_target_desc_input_raises_ua2", () => {
    expectGuard(
      () => buildAction({ action: "input", target_desc: "" }),
      "UA2_EMPTY_TARGET_DESC",
    );
  });
});

describe("ReplayBundle coded guards (TestCodedReplayBundleCodes)", () => {
  it("test_single_mismatched_replay_raises_rb1", () => {
    const replay = makeReplay("r-1", [buildAction()]);
    expectGuard(
      () =>
        new ReplayBundle({
          replays: [replay],
          computed_at: "2026-08-15T00:00:00Z",
          project_id: 99999,
        }),
      "RB1_PROJECT_ID_MISMATCH",
    );
  });

  it("test_one_of_two_mismatched_replays_raises_rb1", () => {
    const r1 = makeReplay("r-1", [buildAction()]);
    const r2 = makeReplay("r-2", [buildAction()]);
    expectGuard(
      () =>
        new ReplayBundle({
          replays: [r1, r2],
          computed_at: "2026-08-15T00:00:00Z",
          project_id: 12346,
        }),
      "RB1_PROJECT_ID_MISMATCH",
    );
  });
});
