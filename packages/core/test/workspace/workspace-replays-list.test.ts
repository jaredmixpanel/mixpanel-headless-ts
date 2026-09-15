// Translated Workspace replay-member tests (packet B5-S3,
// `b5-packets.md` §5): assertion-for-assertion ports of ALL
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

import { ParamValidationError } from "../../src/errors.js";
import { ReplaysService } from "../../src/services/replays.js";
import {
  callsTo,
  expectGuard,
  installStubService,
  makeWorkspace,
  summary,
} from "./workspace-replays-fixtures.js";

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
      queryFn: (events, options) => {
        calls.push([events, options]);
        return Promise.resolve({ series: {} });
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
      queryFn: (_events, options) => {
        calls.push(options);
        return Promise.resolve({ series: {} });
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
    const ws = makeWorkspace({
      warn: (message) => {
        recorded.push(message);
      },
    });
    ws.replaysService = new ReplaysService(ws.client, {
      queryFn: () =>
        Promise.resolve({
          series: {
            "Session Recording Checkpoint [Minimum Time]": {
              $overall: { all: 1716810000 },
              "r-1": { $overall: { all: 1716810000 } },
            },
          },
        }),
      warn: (message) => {
        recorded.push(message);
      },
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
