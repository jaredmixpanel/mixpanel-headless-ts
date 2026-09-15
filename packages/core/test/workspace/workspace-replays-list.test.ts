// Workspace.listReplays: argument validation, the kwargs forwarded to
// ReplaysService.discover, the missing-retention default and the five-property
// cap. Mirrors the list-side classes of tests/unit/test_workspace_replays.py.
// `assert_called_once_with(...)` reads the recorded options bag, whose keys are
// the camelCase service spellings; the WR* guards are asserted by error code.

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

// --- listReplays validation ---

describe("listReplays argument validation", () => {
  // python: TestListReplaysValidation
  it("neither arg raises", async () => {
    // python: test_neither_arg_raises
    const ws = makeWorkspace();
    installStubService(ws);
    await expectGuard(
      async () => ws.listReplays(),
      "WR4_REPLAY_SELECTOR_REQUIRED",
    );
  });

  it("both args raise", async () => {
    // python: test_both_args_raise
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

  it("distinct ID without window raises", async () => {
    // python: test_distinct_id_without_window_raises
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

  it("replay IDs without window works", async () => {
    // python: test_replay_ids_without_window_works
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    stub.discoverResult = [];
    const result = await ws.listReplays({ replay_ids: ["r-1"] });
    expect(result).toStrictEqual([]);
    expect(callsTo(stub, "discover")).toHaveLength(1);
  });

  it("empty result returns empty list", async () => {
    // python: test_empty_result_returns_empty_list
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

// --- listReplays issues the documented query call ---

describe("listReplays → discover kwargs", () => {
  // python: TestListReplaysQueryCall
  it("distinct ID path delegates", async () => {
    // python: test_distinct_id_path_delegates
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

  it("discover uses workspace query", async () => {
    // python: test_discover_uses_workspace_query
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

  it("replay IDs path uses 90 day lookback", async () => {
    // python: test_replay_ids_path_uses_90_day_lookback
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

// --- Retention default + warning ---

describe("missing retention defaults to 30 with a warning", () => {
  // python: TestRetentionWarning
  it("missing retention emits userwarning", async () => {
    // python: test_missing_retention_emits_userwarning
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

// --- events_for_replay validation ---

describe("the 5-property cap", () => {
  // python: TestEventsForReplayValidation
  it("six properties raises valueerror", async () => {
    // python: test_six_properties_raises_valueerror
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

  it("six properties raises for batched variant", async () => {
    // python: test_six_properties_raises_for_batched_variant
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

  it("five properties ok", async () => {
    // python: test_five_properties_ok
    const ws = makeWorkspace();
    const stub = installStubService(ws);
    await ws.eventsForReplay("r-1", {
      event_properties: ["a", "b", "c", "d", "e"],
    });
    expect(callsTo(stub, "eventsFor")).toHaveLength(1);
  });
});
