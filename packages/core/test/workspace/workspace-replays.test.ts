// Translated Workspace replay-member tests (packet B5-S3,
// `b5-packets.md` §5): assertion-for-assertion ports (R10.2) of ALL
// THIRTEEN classes of
//   tests/unit/test_workspace_replays.py
//     TestListReplaysValidation        :97
//     TestListReplaysQueryCall         :148
//     TestRetentionWarning             :237
//     TestEventsForReplayValidation    :284
//     TestFetchReplay                  :317
//     TestReplaysForUser               :432
//     TestSignReplaysWiring            :465
//     TestEventsForReplaysWindow       :493
//     TestFetchReplaysResilience       :522
//     TestReplaysForUserLimit          :560
//     TestFetchReplaysBatching         :578
//     TestReplaysForUserThreadsRetention :634
//     TestCodedReplayGuardCodes        :664
//
// Translation notes:
// - `ws._replays_svc = MagicMock()` → `ws.replaysService = stub` (the
//   settable accessor mirrors Python's attribute write); the stub is a
//   recording object cast to `ReplaysService`.
// - `svc.discover.assert_called_once_with(distinct_id=…, replay_ids=…,
//   from_date=…, to_date=…, limit=…)` → an assertion on the recorded
//   options bag, whose keys are the camelCase service spellings
//   (`ReplaysService.discover` is `_internal`; only the FACADE keeps
//   Python's snake_case, R3.2).
// - `pytest.raises(ValueError, match=…)` on the WR* guards → the
//   `{class, code}` assertion (R5.4). The Python file asserts BOTH the
//   message (TestListReplaysValidation) and the code
//   (TestCodedReplayGuardCodes); the port keeps the code assertions and
//   the message-substring ones become the same code, since
//   `ParamValidationError` IS the `ValueError` subclass Python's
//   `test_wr_guards_stay_catchable_as_value_error` pins.
// - `warnings.catch_warnings(record=True)` → the injected
//   {@link WarningSink} threaded through the Workspace constructor.
// - `ws.fetch_replay = MagicMock(side_effect=…)` → a method override on
//   the instance; `call.kwargs[...]` → the recorded options bag.
// - Every member is `async` in the port (R6.1), so every call awaits.
import { describe, expect, it } from "vitest";

import { ParamValidationError, ReplayNotFoundError } from "../../src/errors.js";
import { ReplaysService } from "../../src/services/replays.js";
import {
  Replay,
  ReplayBundle,
  ReplayEvent,
  ReplaySummary,
  SignedReplay,
} from "../../src/types/results/replays.js";
import { checkEventPropertiesCount, Workspace } from "../../src/workspace.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** One recorded stub-service call. */
interface ServiceCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

/** The recording stand-in for `ReplaysService` (the MagicMock twin). */
interface StubService {
  readonly calls: ServiceCall[];
  discoverResult: ReplaySummary[];
  signResult: SignedReplay[];
  fetchFilesResult: Array<Record<string, unknown>>;
  eventsForResult: Map<string, ReplayEvent[]>;
}

/**
 * Build a `Workspace` bound to a fake session (`_make_workspace`,
 * `test_workspace_replays.py:39-44`).
 *
 * @param options - Optional `warn` sink and App-API handler.
 * @returns The workspace under test.
 */
function makeWorkspace(
  options: {
    warn?: (message: string) => void;
    handler?: (request: CapturedFetchRequest) => CannedResponse;
  } = {},
): Workspace {
  const { client } = createMockClient(
    makeSession({ projectId: "12345" }),
    options.handler ?? (() => ({ status: 200, json: [] })),
  );
  return new Workspace({
    session: client.session,
    client,
    ...(options.warn === undefined ? {} : { warn: options.warn }),
  });
}

/**
 * Replace the workspace's lazy `ReplaysService` with a recording stub
 * (`_install_mock_replays_service`, `:47-51`).
 *
 * @param ws - The workspace to patch.
 * @returns The stub, with its call log.
 */
function installStubService(ws: Workspace): StubService {
  const stub: StubService = {
    calls: [],
    discoverResult: [],
    signResult: [],
    fetchFilesResult: [],
    eventsForResult: new Map(),
  };
  const impl = {
    discover: async (...args: unknown[]): Promise<ReplaySummary[]> => {
      stub.calls.push({ method: "discover", args });
      return stub.discoverResult;
    },
    sign: async (...args: unknown[]): Promise<SignedReplay[]> => {
      stub.calls.push({ method: "sign", args });
      return stub.signResult;
    },
    fetchFiles: async (
      ...args: unknown[]
    ): Promise<Array<Record<string, unknown>>> => {
      stub.calls.push({ method: "fetchFiles", args });
      return stub.fetchFilesResult;
    },
    eventsFor: async (
      ...args: unknown[]
    ): Promise<Map<string, ReplayEvent[]>> => {
      stub.calls.push({ method: "eventsFor", args });
      return stub.eventsForResult;
    },
  };
  ws.replaysService = impl as unknown as ReplaysService;
  return stub;
}

/**
 * Pull the recorded calls for one stub method.
 *
 * @param stub - The stub service.
 * @param method - The method name.
 * @returns The matching calls.
 */
function callsTo(stub: StubService, method: string): readonly ServiceCall[] {
  return stub.calls.filter((c) => c.method === method);
}

/**
 * Build a `ReplaySummary` for fixture seeding (`_summary`, `:54-64`).
 *
 * @param replayId - The replay id (default `"r-1"`).
 * @param options - `retentionDays` / `distinctId` overrides.
 * @returns The summary.
 */
function summary(
  replayId = "r-1",
  options: { retentionDays?: number; distinctId?: string | null } = {},
): ReplaySummary {
  return new ReplaySummary({
    replay_id: replayId,
    distinct_id: options.distinctId === undefined ? "u-42" : options.distinctId,
    project_id: 12345,
    start_time: 1716810000000,
    retention_days: options.retentionDays ?? 30,
  });
}

/**
 * Build a `SignedReplay` for fixture seeding (`_signed`, `:67-76`).
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
 * Build a minimal valid `Replay` (`_replay`, `:79-89`).
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

/**
 * Assert a rejected promise carries the expected guard `{class, code}`.
 *
 * @param thunk - The call under test.
 * @param code - The expected registry code.
 */
async function expectGuard(
  thunk: () => Promise<unknown>,
  code: string,
): Promise<void> {
  let caught: unknown;
  try {
    await thunk();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ParamValidationError);
  expect((caught as ParamValidationError).code).toBe(code);
}

// =============================================================================
// list_replays validation
// =============================================================================

describe("list_replays argument validation (TestListReplaysValidation)", () => {
  it("test_neither_arg_raises", async () => {
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () => ws.listReplays(),
      "WR4_REPLAY_SELECTOR_REQUIRED",
    );
  });

  it("test_both_args_raise", async () => {
    const ws = makeWorkspace();
    installStubService(ws);
    let caught: unknown;
    try {
      await ws.listReplays({ distinct_id: "u-1", replay_ids: ["r-1"] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    expect((caught as ParamValidationError).message).toContain(
      "both were given",
    );
  });

  it("test_distinct_id_without_window_raises", async () => {
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () => ws.listReplays({ distinct_id: "u-1" }),
      "WR5_DATE_RANGE_REQUIRED",
    );
    await expectGuard(
      async () =>
        ws.listReplays({ distinct_id: "u-1", from_date: "2026-05-20" }),
      "WR5_DATE_RANGE_REQUIRED",
    );
  });

  it("test_replay_ids_without_window_works", async () => {
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.discoverResult = [];
    const result = await ws.listReplays({ replay_ids: ["r-1"] });
    expect(result).toStrictEqual([]);
    expect(callsTo(stub, "discover")).toHaveLength(1);
  });

  it("test_empty_result_returns_empty_list", async () => {
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.discoverResult = [];
    const out = await ws.listReplays({
      distinct_id: "u-1",
      from_date: "2026-05-20",
      to_date: "2026-05-27",
    });
    expect(out).toStrictEqual([]);
  });
});

// =============================================================================
// list_replays issues the documented query call
// =============================================================================

describe("list_replays → discover kwargs (TestListReplaysQueryCall)", () => {
  it("test_distinct_id_path_delegates", async () => {
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.discoverResult = [summary()];

    const result = await ws.listReplays({
      distinct_id: "u-42",
      from_date: "2026-05-20",
      to_date: "2026-05-27",
    });

    expect(result.map((s) => s.toJSON())).toStrictEqual([summary().toJSON()]);
    const calls = callsTo(stub, "discover");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0]).toStrictEqual({
      distinctId: "u-42",
      replayIds: null,
      fromDate: "2026-05-20",
      toDate: "2026-05-27",
      limit: 100,
    });
  });

  it("test_discover_uses_workspace_query", async () => {
    const ws = makeWorkspace();
    const calls: Array<[string, Readonly<Record<string, unknown>>]> = [];
    ws.replaysService = new ReplaysService(ws.client, {
      queryFn: async (events, options) => {
        calls.push([events, options]);
        return { series: {} };
      },
    });

    await ws.listReplays({
      distinct_id: "u-42",
      from_date: "2026-05-20",
      to_date: "2026-05-27",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("$mp_session_record");
    const kwargs = calls[0]?.[1] ?? {};
    const gb = (kwargs["group_by"] ?? []) as readonly string[];
    expect(gb).toContain("$mp_replay_id");
    expect(gb).toContain("$mp_replay_retention_period");
    expect(kwargs["math"]).toBe("min");
    expect(kwargs["math_property"]).toBe("$time");
    expect(kwargs["from_date"]).toBe("2026-05-20");
    expect(kwargs["to_date"]).toBe("2026-05-27");
  });

  it("test_replay_ids_path_uses_90_day_lookback", async () => {
    const ws = makeWorkspace();
    const calls: Array<Readonly<Record<string, unknown>>> = [];
    ws.replaysService = new ReplaysService(ws.client, {
      queryFn: async (_events, options) => {
        calls.push(options);
        return { series: {} };
      },
    });

    await ws.listReplays({ replay_ids: ["r-1"] });

    const kwargs = calls[0] ?? {};
    expect(kwargs["last"]).toBe(90);
    expect(Object.hasOwn(kwargs, "from_date")).toBe(false);
    expect(Object.hasOwn(kwargs, "to_date")).toBe(false);
  });
});

// =============================================================================
// Retention default + warning
// =============================================================================

describe("missing retention defaults to 30 with a warning (TestRetentionWarning)", () => {
  it("test_missing_retention_emits_userwarning", async () => {
    const recorded: string[] = [];
    const ws = makeWorkspace({ warn: (message) => recorded.push(message) });
    ws.replaysService = new ReplaysService(ws.client, {
      queryFn: async () => ({
        series: {
          "Session Recording Checkpoint [Minimum Time]": {
            $overall: { all: 1716810000 },
            "r-1": { $overall: { all: 1716810000 } },
          },
        },
      }),
      warn: (message) => recorded.push(message),
    });

    const result = await ws.listReplays({
      distinct_id: "u-42",
      from_date: "2026-05-20",
      to_date: "2026-05-27",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.retention_days).toBe(30);
    expect(
      recorded.some((w) => w.includes("$mp_replay_retention_period")),
    ).toBe(true);
  });
});

// =============================================================================
// events_for_replay validation
// =============================================================================

describe("the 5-property cap (TestEventsForReplayValidation)", () => {
  it("test_six_properties_raises_valueerror", async () => {
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () =>
        ws.eventsForReplay("r-1", {
          event_properties: ["a", "b", "c", "d", "e", "f"],
        }),
      "WR1_TOO_MANY_EVENT_PROPERTIES",
    );
  });

  it("test_six_properties_raises_for_batched_variant", async () => {
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () =>
        ws.eventsForReplays(["r-1"], {
          event_properties: ["a", "b", "c", "d", "e", "f"],
        }),
      "WR1_TOO_MANY_EVENT_PROPERTIES",
    );
  });

  it("test_five_properties_ok", async () => {
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    await ws.eventsForReplay("r-1", {
      event_properties: ["a", "b", "c", "d", "e"],
    });
    expect(callsTo(stub, "eventsFor")).toHaveLength(1);
  });
});

// =============================================================================
// fetch_replay flow
// =============================================================================

describe("fetch_replay signs, fetches, joins (TestFetchReplay)", () => {
  it("test_explicit_retention_skips_discovery", async () => {
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

  it("test_include_mixpanel_events_triggers_follow_up", async () => {
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

  it("test_default_skips_mixpanel_events", async () => {
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.signResult = [signedFixture()];
    stub.fetchFilesResult = [{ type: 4, data: {}, timestamp: 1716810000000 }];
    await ws.fetchReplay("r-1", { retention_days: 30 });
    expect(callsTo(stub, "eventsFor")).toHaveLength(0);
  });

  it("test_retention_none_discovers", async () => {
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

  it("test_distinct_id_is_threaded", async () => {
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

// =============================================================================
// replays_for_user
// =============================================================================

describe("replays_for_user composition (TestReplaysForUser)", () => {
  it("test_method_exists", () => {
    const ws = makeWorkspace();
    expect(typeof ws.replaysForUser).toBe("function");
  });

  it("test_empty_window_returns_empty_bundle", async () => {
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

// =============================================================================
// sign_replay / sign_replays
// =============================================================================

describe("sign wiring (TestSignReplaysWiring)", () => {
  it("test_sign_replay_returns_first_signed", async () => {
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

  it("test_sign_replays_passes_through", async () => {
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

// =============================================================================
// events_for_replays window passthrough
// =============================================================================

describe("events window passthrough (TestEventsForReplaysWindow)", () => {
  it("test_explicit_window_passes_through", async () => {
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

  it("test_default_window_is_none", async () => {
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

// =============================================================================
// fetch_replays resilience
// =============================================================================

describe("fetch_replays per-replay isolation (TestFetchReplaysResilience)", () => {
  it("test_one_failure_does_not_sink_the_bundle", async () => {
    const ws = makeWorkspace();
    ws.fetchReplay = async (replayId: string): Promise<Replay> => {
      if (replayId === "r-bad") {
        throw new ReplayNotFoundError("gone", {
          details: { replay_id: replayId },
          statusCode: 404,
        });
      }
      return makeReplay(replayId);
    };
    const bundle = await ws.fetchReplays(["r-1", "r-bad", "r-2"]);
    expect(new Set(bundle.replays.map((r) => r.replay_id))).toStrictEqual(
      new Set(["r-1", "r-2"]),
    );
  });

  it("test_all_failures_raise_first_underlying_error", async () => {
    const ws = makeWorkspace();
    ws.fetchReplay = async (): Promise<Replay> => {
      throw new ReplayNotFoundError("gone", { details: {}, statusCode: 404 });
    };
    let caught: unknown;
    try {
      await ws.fetchReplays(["r-1", "r-2"]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ReplayNotFoundError);
  });
});

// =============================================================================
// replays_for_user default limit
// =============================================================================

describe("replays_for_user default limit (TestReplaysForUserLimit)", () => {
  it("test_default_limit_is_20", async () => {
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

// =============================================================================
// fetch_replays Insights batching
// =============================================================================

describe("fetch_replays retention threading + batching (TestFetchReplaysBatching)", () => {
  it("test_retention_by_id_passed_to_each_fetch", async () => {
    const ws = makeWorkspace();
    const seen = new Map<string, unknown>();
    ws.fetchReplay = async (
      rid: string,
      opts: { retention_days?: number | null } = {},
    ): Promise<Replay> => {
      seen.set(rid, opts.retention_days);
      return makeReplay(rid);
    };
    await ws.fetchReplays(["r-1", "r-2"], {
      retention_by_id: new Map([
        ["r-1", 7],
        ["r-2", 90],
      ]),
    });
    expect(Object.fromEntries(seen)).toStrictEqual({ "r-1": 7, "r-2": 90 });
  });

  it("test_events_joined_in_one_batched_call", async () => {
    const ws = makeWorkspace();
    const fetchOpts: Array<Record<string, unknown>> = [];
    ws.fetchReplay = async (
      rid: string,
      opts: Record<string, unknown> = {},
    ): Promise<Replay> => {
      fetchOpts.push(opts);
      return makeReplay(rid);
    };
    const eventsCalls: unknown[][] = [];
    ws.eventsForReplays = async (
      ids: readonly string[],
    ): Promise<Map<string, ReplayEvent[]>> => {
      eventsCalls.push([ids]);
      return new Map([
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
      ]);
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

  it("test_no_events_call_when_flag_off", async () => {
    const ws = makeWorkspace();
    ws.fetchReplay = async (rid: string): Promise<Replay> => makeReplay(rid);
    let called = 0;
    ws.eventsForReplays = async (): Promise<Map<string, ReplayEvent[]>> => {
      called += 1;
      return new Map();
    };
    await ws.fetchReplays(["r-1"]);
    expect(called).toBe(0);
  });
});

describe("replays_for_user threads retention (TestReplaysForUserThreadsRetention)", () => {
  it("test_retention_map_built_from_summaries", async () => {
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.discoverResult = [
      summary("r-1", { retentionDays: 7 }),
      summary("r-2", { retentionDays: 90 }),
    ];
    const fetchCalls: Array<Record<string, unknown>> = [];
    ws.fetchReplays = async (
      _ids: readonly string[],
      opts: Record<string, unknown> = {},
    ): Promise<ReplayBundle> => {
      fetchCalls.push(opts);
      return new ReplayBundle({ replays: [], project_id: 12345 });
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

// =============================================================================
// Coded guard errors — WR1/WR4/WR5
// =============================================================================

describe("coded replay guards (TestCodedReplayGuardCodes)", () => {
  it("test_wr1_direct_raises_coded_error", () => {
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

  it("test_wr1_seam_raises_coded_error", async () => {
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

  it("test_wr4_neither_arg_raises_coded_error", async () => {
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () => ws.listReplays(),
      "WR4_REPLAY_SELECTOR_REQUIRED",
    );
  });

  it("test_wr4_neither_arg_empty_replay_ids_raises_coded_error", async () => {
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () => ws.listReplays({ replay_ids: [] }),
      "WR4_REPLAY_SELECTOR_REQUIRED",
    );
  });

  it("test_wr4_both_args_raise_coded_error", async () => {
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () => ws.listReplays({ distinct_id: "u-1", replay_ids: ["r-1"] }),
      "WR4_REPLAY_SELECTOR_REQUIRED",
    );
  });

  it("test_wr4_both_args_with_dates_raise_coded_error", async () => {
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

  it("test_wr5_missing_both_dates_raises_coded_error", async () => {
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () => ws.listReplays({ distinct_id: "u-1" }),
      "WR5_DATE_RANGE_REQUIRED",
    );
  });

  it("test_wr5_missing_to_date_raises_coded_error", async () => {
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () =>
        ws.listReplays({ distinct_id: "u-1", from_date: "2026-05-20" }),
      "WR5_DATE_RANGE_REQUIRED",
    );
  });

  it("test_wr_guards_stay_catchable_as_value_error", async () => {
    // Python asserts the guard is catchable as a bare `ValueError`;
    // `ParamValidationError` is that subclass. The TS twin is the class
    // identity itself (there is no separate `ValueError` ancestor on
    // the coded-error tree — R5.3).
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

// =============================================================================
// B5-ARB FID-F5 (additive — `b5-review-resolution.md`): the window
// derivation is Python `int(ev["timestamp"])` (`workspace.py:10946`) —
// a SUBSCRIPT, not a `.get`, so a missing key raises `KeyError` (the
// pre-fix TS fell through `pythonIntCoerce(undefined)` to a TypeError
// naming 'undefined').
// =============================================================================

describe("FID-F5: fetch_replay window derivation missing-timestamp class", () => {
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
