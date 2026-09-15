// Workspace.fetchReplay / fetchReplays / replaysForUser: sign-fetch-join,
// per-replay isolation, batching, retention threading, the events window and
// the coded WR* guards. Mirrors the fetch-side classes of
// tests/unit/test_workspace_replays.py; `pytest.raises(ValueError, match=…)`
// becomes the class + code assertion (ParamValidationError is that subclass).

import { describe, expect, it } from "vitest";

import { ParamValidationError, ReplayNotFoundError } from "../../src/errors.js";
import {
  Replay,
  ReplayEvent,
  SignedReplay,
} from "../../src/types/results/replay-models.js";
import { ReplayBundle } from "../../src/types/results/replays.js";
import { checkEventPropertiesCount } from "../../src/workspace-members/replay-methods.js";
import {
  callsTo,
  expectGuard,
  installStubService,
  makeWorkspace,
  summary,
} from "./workspace-replays-fixtures.js";

/**
 * Build a `SignedReplay` for fixture seeding (`_signed`).
 *
 * @param replayId - The replay id (default `"r-1"`).
 * @returns The signed handle.
 */
function signedFixture(replayId = "r-1"): SignedReplay {
  return new SignedReplay({
    replay_id: replayId,
    url: "https://cdn.test/srr-us/sha/",
    query_string: "URLPrefix=A&Signature=S",
    env: "prod",
    signed_at: 1716810000.0,
  });
}

/**
 * Build a minimal valid `Replay` (`_replay`).
 *
 * @param replayId - The replay id.
 * @returns The replay.
 */
function makeReplay(replayId: string): Replay {
  return new Replay({
    replay_id: replayId,
    distinct_id: null,
    project_id: 12345,
    start_time: 1716810000000,
    end_time: 1716810005000,
    retention_days: 30,
  });
}

// --- fetchReplay flow ---

describe("fetchReplay signs, fetches, joins", () => {
  // python: TestFetchReplay
  it("explicit retention skips discovery", async () => {
    // python: test_explicit_retention_skips_discovery
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.signResult = [signedFixture()];
    stub.fetchFilesResult = [
      { type: 4, data: {}, timestamp: 1716810000000 },
      { type: 3, data: {}, timestamp: 1716810015000 },
    ];

    const replay = await ws.fetchReplay("r-1", { retention_days: 30 });

    expect(callsTo(stub, "discover")).toHaveLength(0);
    expect(callsTo(stub, "sign")).toHaveLength(1);
    expect(callsTo(stub, "fetchFiles")).toHaveLength(1);
    expect(replay).toBeInstanceOf(Replay);
    expect(replay.replay_id).toBe("r-1");
    expect(replay.actions).toStrictEqual([]);
    expect(replay.duration_seconds).toBe(15.0);
    expect(replay.mixpanel_events).toStrictEqual([]);
  });

  it("include mixpanel events triggers follow up", async () => {
    // python: test_include_mixpanel_events_triggers_follow_up
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.signResult = [signedFixture()];
    stub.fetchFilesResult = [
      { type: 4, data: {}, timestamp: 1716810000000 },
      { type: 3, data: {}, timestamp: 1716810005000 },
    ];
    stub.eventsForResult = new Map([
      [
        "r-1",
        [
          new ReplayEvent({
            replay_id: "r-1",
            event_name: "Login",
            event_time: 1716810002,
            properties: { $browser: "Chrome" },
          }),
        ],
      ],
    ]);

    const replay = await ws.fetchReplay("r-1", {
      retention_days: 30,
      include_mixpanel_events: true,
    });

    // events_for fired exactly once, scoped to the replay's own day(s)
    // (rrweb timestamps 1716810000000–1716810005000 ms == 2024-05-27 UTC).
    const calls = callsTo(stub, "eventsFor");
    expect(calls).toHaveLength(1);
    const kwargs = calls[0]?.args[1] as Record<string, unknown>;
    expect(kwargs["fromDate"]).toBe("2024-05-27");
    expect(kwargs["toDate"]).toBe("2024-05-27");
    expect(replay.mixpanel_events).toHaveLength(1);
    expect(replay.mixpanel_events[0]?.event_name).toBe("Login");
  });

  it("default skips mixpanel events", async () => {
    // python: test_default_skips_mixpanel_events
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.signResult = [signedFixture()];
    stub.fetchFilesResult = [{ type: 4, data: {}, timestamp: 1716810000000 }];
    await ws.fetchReplay("r-1", { retention_days: 30 });
    expect(callsTo(stub, "eventsFor")).toHaveLength(0);
  });

  it("retention null discovers", async () => {
    // python: test_retention_none_discovers
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.discoverResult = [summary("r-1", { retentionDays: 7 })];
    stub.signResult = [signedFixture()];
    stub.fetchFilesResult = [{ type: 4, data: {}, timestamp: 1716810000000 }];

    const replay = await ws.fetchReplay("r-1"); // no retention_days

    const discoverCalls = callsTo(stub, "discover");
    expect(discoverCalls).toHaveLength(1);
    expect(discoverCalls[0]?.args[0]).toStrictEqual({
      distinctId: null,
      replayIds: ["r-1"],
      fromDate: null,
      toDate: null,
      limit: 100,
    });
    const fetchKwargs = callsTo(stub, "fetchFiles")[0]?.args[1] as Record<
      string,
      unknown
    >;
    expect(fetchKwargs["retentionDays"]).toBe(7);
    expect(replay.retention_days).toBe(7);
  });

  it("distinct ID is threaded", async () => {
    // python: test_distinct_id_is_threaded
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.signResult = [signedFixture()];
    stub.fetchFilesResult = [
      { type: 4, data: {}, timestamp: 1716810000000 },
      { type: 3, data: {}, timestamp: 1716810015000 },
    ];

    const replay = await ws.fetchReplay("r-1", {
      distinct_id: "u-42",
      retention_days: 30,
    });

    expect(replay.distinct_id).toBe("u-42");
  });
});

// --- replaysForUser ---

describe("replaysForUser composition", () => {
  // python: TestReplaysForUser
  it("method exists", () => {
    // python: test_method_exists
    const ws = makeWorkspace();
    expect(typeof ws.replaysForUser).toBe("function");
  });

  it("empty window returns empty bundle", async () => {
    // python: test_empty_window_returns_empty_bundle
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.discoverResult = [];
    const bundle = await ws.replaysForUser("u-42", {
      from_date: "2026-05-20",
      to_date: "2026-05-27",
    });
    expect(bundle).toBeInstanceOf(ReplayBundle);
    expect(bundle.replays).toStrictEqual([]);
    expect(callsTo(stub, "sign")).toHaveLength(0);
  });
});

// --- sign_replay / sign_replays wiring ---

describe("sign wiring", () => {
  // python: TestSignReplaysWiring
  it("sign replay returns first signed", async () => {
    // python: test_sign_replay_returns_first_signed
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.signResult = [signedFixture("r-1")];
    const out = await ws.signReplay("r-1");
    expect(out).toBeInstanceOf(SignedReplay);
    expect(out.replay_id).toBe("r-1");
    const calls = callsTo(stub, "sign");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toStrictEqual([["r-1"], "prod"]);
  });

  it("sign replays passes through", async () => {
    // python: test_sign_replays_passes_through
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.signResult = [signedFixture("r-1"), signedFixture("r-2")];
    const out = await ws.signReplays(["r-1", "r-2"], { env: "dev" });
    expect(out.map((s) => s.replay_id)).toStrictEqual(["r-1", "r-2"]);
    const calls = callsTo(stub, "sign");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toStrictEqual([["r-1", "r-2"], "dev"]);
  });
});

// --- events_for_replays window passthrough ---

describe("events window passthrough", () => {
  // python: TestEventsForReplaysWindow
  it("explicit window passes through", async () => {
    // python: test_explicit_window_passes_through
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    await ws.eventsForReplays(["r-1"], {
      from_date: "2026-05-20",
      to_date: "2026-05-21",
    });
    const kwargs = callsTo(stub, "eventsFor")[0]?.args[1] as Record<
      string,
      unknown
    >;
    expect(kwargs["fromDate"]).toBe("2026-05-20");
    expect(kwargs["toDate"]).toBe("2026-05-21");
  });

  it("default window is null", async () => {
    // python: test_default_window_is_none
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    await ws.eventsForReplay("r-1");
    const kwargs = callsTo(stub, "eventsFor")[0]?.args[1] as Record<
      string,
      unknown
    >;
    expect(kwargs["fromDate"]).toBeNull();
    expect(kwargs["toDate"]).toBeNull();
  });
});

// --- fetchReplays resilience ---

describe("fetchReplays per-replay isolation", () => {
  // python: TestFetchReplaysResilience
  it("one failure does not sink the bundle", async () => {
    // python: test_one_failure_does_not_sink_the_bundle
    const warnings: string[] = [];
    const ws = makeWorkspace({
      logger: {
        debug: () => undefined,
        warning: (message) => {
          warnings.push(message);
        },
      },
    });
    ws.fetchReplay = (replayId: string): Promise<Replay> => {
      if (replayId === "r-bad") {
        return Promise.reject(
          new ReplayNotFoundError("gone", {
            details: { replay_id: replayId },
            statusCode: 404,
          }),
        );
      }
      return Promise.resolve(makeReplay(replayId));
    };
    const bundle = await ws.fetchReplays(["r-1", "r-bad", "r-2"]);
    expect(new Set(bundle.replays.map((r) => r.replay_id))).toStrictEqual(
      new Set(["r-1", "r-2"]),
    );
    // The skipped replay is surfaced on the bundle (TS-only, additive) and
    // through the logger (Python's only signal) …
    expect(bundle.failures).toStrictEqual([
      { replay_id: "r-bad", error: expect.any(ReplayNotFoundError) },
    ]);
    expect(warnings.some((m) => m.includes("skipping replay r-bad"))).toBe(
      true,
    );
    // … but never in the encoded shape, which stays Python's.
    expect(Object.keys(bundle)).not.toContain("failures");
    expect(Object.keys(bundle.toJSON())).not.toContain("failures");
  });

  it("failures are listed in input order and empty when nothing failed", async () => {
    const ws = makeWorkspace();
    ws.fetchReplay = (replayId: string): Promise<Replay> =>
      replayId.startsWith("bad")
        ? Promise.reject(new Error(replayId))
        : Promise.resolve(makeReplay(replayId));
    const bundle = await ws.fetchReplays(["bad-1", "r-1", "bad-2", "r-2"], {
      concurrency: 1,
    });
    expect(bundle.failures.map((f) => f.replay_id)).toStrictEqual([
      "bad-1",
      "bad-2",
    ]);
    expect(bundle.failures.map((f) => f.error.message)).toStrictEqual([
      "bad-1",
      "bad-2",
    ]);
    expect((await ws.fetchReplays(["r-1"])).failures).toStrictEqual([]);
    // Derived bundles do not carry the failures over.
    expect(bundle.head(1).failures).toStrictEqual([]);
  });

  it("all failures raise first underlying error", async () => {
    // python: test_all_failures_raise_first_underlying_error
    const ws = makeWorkspace();
    ws.fetchReplay = (): Promise<Replay> =>
      Promise.reject(
        new ReplayNotFoundError("gone", { details: {}, statusCode: 404 }),
      );
    let caught: unknown;
    try {
      await ws.fetchReplays(["r-1", "r-2"]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ReplayNotFoundError);
  });

  it("a non-Error rejection is re-raised wrapped, with the value as cause", async () => {
    // Python can only raise BaseException; the port wraps anything else
    // (CLEANUP-PLAN.md §12 row 8.10) so `throw` always throws an Error.
    const ws = makeWorkspace();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection is the point of this test
    ws.fetchReplay = (): Promise<Replay> => Promise.reject("boom");
    let caught: unknown;
    try {
      await ws.fetchReplays(["r-1"]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("boom");
    expect((caught as Error).cause).toBe("boom");
  });
});

// --- replaysForUser default limit ---

describe("replaysForUser default limit", () => {
  // python: TestReplaysForUserLimit
  it("default limit is 20", async () => {
    // python: test_default_limit_is_20
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.discoverResult = []; // short-circuit before any fetch
    await ws.replaysForUser("u-42", {
      from_date: "2026-05-20",
      to_date: "2026-05-27",
    });
    const kwargs = callsTo(stub, "discover")[0]?.args[0] as Record<
      string,
      unknown
    >;
    expect(kwargs["limit"]).toBe(20);
  });
});

// --- fetchReplays Insights batching ---

describe("fetchReplays retention threading + batching", () => {
  // python: TestFetchReplaysBatching
  it("retention by ID passed to each fetch", async () => {
    // python: test_retention_by_id_passed_to_each_fetch
    const ws = makeWorkspace();
    const seen = new Map<string, unknown>();
    ws.fetchReplay = (
      rid: string,
      opts: { retention_days?: number | null },
    ): Promise<Replay> => {
      seen.set(rid, opts.retention_days);
      return Promise.resolve(makeReplay(rid));
    };
    await ws.fetchReplays(["r-1", "r-2"], {
      retention_by_id: new Map([
        ["r-1", 7],
        ["r-2", 90],
      ]),
    });
    expect(Object.fromEntries(seen)).toStrictEqual({ "r-1": 7, "r-2": 90 });
  });

  it("events joined in one batched call", async () => {
    // python: test_events_joined_in_one_batched_call
    const ws = makeWorkspace();
    const fetchOpts: Array<Record<string, unknown>> = [];
    ws.fetchReplay = (
      rid: string,
      opts: Record<string, unknown>,
    ): Promise<Replay> => {
      fetchOpts.push(opts);
      return Promise.resolve(makeReplay(rid));
    };
    const eventsCalls: unknown[][] = [];
    ws.eventsForReplays = (
      ids: readonly string[],
    ): Promise<Map<string, ReplayEvent[]>> => {
      eventsCalls.push([ids]);
      return Promise.resolve(
        new Map([
          [
            "r-1",
            [
              new ReplayEvent({
                replay_id: "r-1",
                event_name: "Login",
                event_time: 1716810002,
              }),
            ],
          ],
        ]),
      );
    };
    const bundle = await ws.fetchReplays(["r-1", "r-2"], {
      include_mixpanel_events: true,
    });

    // Exactly one batched events query, covering both replays.
    expect(eventsCalls).toHaveLength(1);
    expect(new Set(eventsCalls[0]?.[0] as readonly string[])).toStrictEqual(
      new Set(["r-1", "r-2"]),
    );
    // Per-replay fetch never fired its own events query (no fan-out).
    for (const opts of fetchOpts) {
      expect(opts["include_mixpanel_events"]).toBe(false);
    }
    // Events land on the right replay; the other stays empty.
    const byId = new Map(bundle.replays.map((r) => [r.replay_id, r]));
    expect(
      byId.get("r-1")?.mixpanel_events.map((e) => e.event_name),
    ).toStrictEqual(["Login"]);
    expect(byId.get("r-2")?.mixpanel_events).toStrictEqual([]);
  });

  it("no events call when flag off", async () => {
    // python: test_no_events_call_when_flag_off
    const ws = makeWorkspace();
    ws.fetchReplay = (rid: string): Promise<Replay> =>
      Promise.resolve(makeReplay(rid));
    let called = 0;
    ws.eventsForReplays = (): Promise<Map<string, ReplayEvent[]>> => {
      called += 1;
      return Promise.resolve(new Map());
    };
    await ws.fetchReplays(["r-1"]);
    expect(called).toBe(0);
  });
});

describe("replaysForUser threads retention", () => {
  // python: TestReplaysForUserThreadsRetention
  it("retention map built from summaries", async () => {
    // python: test_retention_map_built_from_summaries
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.discoverResult = [
      summary("r-1", { retentionDays: 7 }),
      summary("r-2", { retentionDays: 90 }),
    ];
    const fetchCalls: Array<Record<string, unknown>> = [];
    ws.fetchReplays = (
      _ids: readonly string[],
      opts: Record<string, unknown>,
    ): Promise<ReplayBundle> => {
      fetchCalls.push(opts);
      return Promise.resolve(
        new ReplayBundle({ replays: [], project_id: 12345 }),
      );
    };
    await ws.replaysForUser("u-42", {
      from_date: "2026-05-20",
      to_date: "2026-05-27",
    });
    const kwargs = fetchCalls[0] ?? {};
    expect(kwargs["retention_by_id"]).toStrictEqual(
      new Map([
        ["r-1", 7],
        ["r-2", 90],
      ]),
    );
    // Every replay is stamped with the user it was discovered for.
    expect(kwargs["distinct_id_by_id"]).toStrictEqual(
      new Map([
        ["r-1", "u-42"],
        ["r-2", "u-42"],
      ]),
    );
  });
});

// --- Coded guard errors — WR1/WR4/WR5 ---

describe("coded replay guards", () => {
  // python: TestCodedReplayGuardCodes
  it("WR1 direct raises coded error", () => {
    // python: test_wr1_direct_raises_coded_error
    let caught: unknown;
    try {
      checkEventPropertiesCount(["a", "b", "c", "d", "e", "f"]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    expect((caught as ParamValidationError).code).toBe(
      "WR1_TOO_MANY_EVENT_PROPERTIES",
    );
  });

  it("WR1 seam raises coded error", async () => {
    // python: test_wr1_seam_raises_coded_error
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () =>
        ws.eventsForReplay("r-1", {
          event_properties: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
        }),
      "WR1_TOO_MANY_EVENT_PROPERTIES",
    );
  });

  it("WR4 neither arg raises coded error", async () => {
    // python: test_wr4_neither_arg_raises_coded_error
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () => ws.listReplays(),
      "WR4_REPLAY_SELECTOR_REQUIRED",
    );
  });

  it("WR4 neither arg empty replay IDs raises coded error", async () => {
    // python: test_wr4_neither_arg_empty_replay_ids_raises_coded_error
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () => ws.listReplays({ replay_ids: [] }),
      "WR4_REPLAY_SELECTOR_REQUIRED",
    );
  });

  it("WR4 both args raise coded error", async () => {
    // python: test_wr4_both_args_raise_coded_error
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () => ws.listReplays({ distinct_id: "u-1", replay_ids: ["r-1"] }),
      "WR4_REPLAY_SELECTOR_REQUIRED",
    );
  });

  it("WR4 both args with dates raise coded error", async () => {
    // python: test_wr4_both_args_with_dates_raise_coded_error
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () =>
        ws.listReplays({
          distinct_id: "u-1",
          replay_ids: ["r-1"],
          from_date: "2026-05-20",
          to_date: "2026-05-27",
        }),
      "WR4_REPLAY_SELECTOR_REQUIRED",
    );
  });

  it("WR5 missing both dates raises coded error", async () => {
    // python: test_wr5_missing_both_dates_raises_coded_error
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () => ws.listReplays({ distinct_id: "u-1" }),
      "WR5_DATE_RANGE_REQUIRED",
    );
  });

  it("WR5 missing to date raises coded error", async () => {
    // python: test_wr5_missing_to_date_raises_coded_error
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () =>
        ws.listReplays({ distinct_id: "u-1", from_date: "2026-05-20" }),
      "WR5_DATE_RANGE_REQUIRED",
    );
  });

  it("wr guards stay catchable as value error", async () => {
    // python: test_wr_guards_stay_catchable_as_value_error
    // Python asserts the guard is catchable as a bare `ValueError`;
    // `ParamValidationError` is that subclass. The TS twin is the class
    // identity itself (there is no separate `ValueError` ancestor on
    // the coded-error tree).
    const ws = makeWorkspace();
    installStubService(ws);
    let caught: unknown;
    try {
      await ws.listReplays();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    expect((caught as ParamValidationError).code).toBe(
      "WR4_REPLAY_SELECTOR_REQUIRED",
    );
  });
});

// --- Additive: the window derivation is Python `int(ev["timestamp"])`, a
// subscript rather than a `.get`, so a missing key must raise the KeyError
// twin (not a TypeError from coercing `undefined`) ---

describe("fetchReplay window derivation: missing-timestamp error class", () => {
  it("an rrweb event without a timestamp key raises the KeyError twin", async () => {
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.signResult = [signedFixture()];
    stub.fetchFilesResult = [{ type: 4, data: {} }]; // no timestamp key

    const caught = await ws
      .fetchReplay("r-1", { retention_days: 30 })
      .then(() => null)
      .catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("KeyError");
  });
});
