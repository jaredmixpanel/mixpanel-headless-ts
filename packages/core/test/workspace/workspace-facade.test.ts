// B6-W1 Layer-3 translation of `tests/unit/test_workspace.py` — the
// classes the packet assigns to W1 (`b6-packets.md` §3 table):
// `TestLiveQueries` (:118), `TestDiscovery` (:439), `TestContextManager`
// (:712), `TestLimitValidation` (:754), `TestWorkspacesMethod` (:808),
// `TestProjectsMethod` (:861), `TestCodedWorkspaceGuardCodes` (:919).
//
// DEFERRED (header-cited, not dropped):
//
// - `TestCredentialResolution` (:96) → B7. The class body is empty in
//   Python (every case was removed in B1 "Fix 10"); nothing to port.
// - `TestCodedWorkspaceGuardCodes::test_ws1_init_target_with_account`
//   (:969), `…_with_workspace` (:975) and
//   `test_ws_guards_stay_catchable_as_value_error` (:1021) → B7: all
//   three call the CONSTRUCTOR guard (`workspace.py:455-465`), which
//   lives behind the B7 resolver kwargs (`b6-packets.md` §14 Caution 4).
//   The `use()` twin of the same guard (:981, :993) IS translated here.
//
// COVERED BY EQUAL-OR-STRONGER B5/B6 TWINS (exclusion citations added at
// B6-ARB, `b6-review-resolution.md` Finding B — the original header
// claimed the classes whole while translating a subset, an R10.2
// misclaim):
//
// - `TestLiveQueries::test_query_saved_report_delegation` (:293) →
//   `workspace-bookmarks.test.ts` `TestQuerySavedReport
//   (test_workspace_bookmarks.py:210)` (8 tests, delegation + kwargs).
// - `TestDiscovery` (:439): 9 of 11 cases have twins in the B5
//   translation `discovery-facade.test.ts` — `property_values` (:478) →
//   :99, `subproperties` (:498) → :112/:127, `funnels` (:523) → :137,
//   `cohorts` (:544) → :147, `top_events` (:572) → :191,
//   `clear_discovery_cache` (:594) → :210/:224, `lexicon_schemas`
//   (:610) + `…_with_entity_type_filter` (:649) → :233, `lexicon_schema`
//   (:678) → :255. The `events`/`properties` delegation pair (:442,
//   :460) is translated below.
// - The remaining 7 `TestLiveQueries` delegation cases (:210-:431) had
//   NO Layer-3 twin anywhere and are translated below (B6-ARB fix).
//
// Python's `Workspace(session=…, _api_client=…)` factory becomes
// `new Workspace({session, client})`; the `try/finally: ws.close()`
// wrapper is kept (B6-W1 ports `close()`), unlike the B5 translations
// which had to drop it (`workspace-test-helpers.ts:6-10`).

import { describe, expect, it, vi } from "vitest";
import { Workspace } from "../../src/workspace.js";
import {
  createMockClient,
  makeSession,
  type CannedResponse,
  type CapturedFetchRequest,
} from "../client/client-test-helpers.js";
import type { MixpanelClient } from "../../src/client/client.js";
import { ParamValidationError } from "../../src/errors.js";
import { validateLimit } from "../../src/services/queries/streaming.js";
import { validateBusinessContextLevel } from "../../src/workspace-members/lifecycle.js";
import {
  MeProjectInfo,
  MeWorkspaceInfo,
  MeResponse,
} from "../../src/client/me.js";
import { MeService, inMemoryMeCache } from "../../src/services/me.js";
import {
  ActivityFeedResult,
  EventCountsResult,
  FrequencyResult,
  FunnelResult,
  NumericAverageResult,
  NumericBucketResult,
  NumericSumResult,
  PropertyCountsResult,
  RetentionResult,
  SegmentationResult,
} from "../../src/types/results/live-query.js";

/** The `_TEST_SESSION` twin (`test_workspace.py:38-46`). */
const TEST_SESSION = makeSession({
  name: "test_account",
  projectId: "12345",
  username: "test_user",
  secret: "test_secret",
});

/**
 * The `workspace_factory` fixture twin — a facade over a mock client.
 *
 * @param handler - Canned-response handler (never reached by the
 *   delegation cases, which stub the services).
 * @returns The facade plus its transport.
 */
function makeWorkspace(
  handler: (request: CapturedFetchRequest) => CannedResponse = () => ({
    status: 200,
    json: {},
  }),
): { ws: Workspace; client: MixpanelClient } {
  const { client } = createMockClient(TEST_SESSION, handler);
  return { ws: new Workspace({ session: TEST_SESSION, client }), client };
}

describe("TestLiveQueries (test_workspace.py:118) — live-query delegation", () => {
  it("segmentation() delegates to the live-query service (T043)", async () => {
    const { ws } = makeWorkspace();
    const result = new SegmentationResult({
      event: "Test",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      segment_property: null,
      total: 100,
      series: {},
    });
    const segmentation = vi.fn().mockResolvedValue(result);
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      segmentation,
    } as never);

    const got = await ws.segmentation("Test", {
      from_date: "2024-01-01",
      to_date: "2024-01-31",
    });

    expect(got.total).toBe(100);
    expect(segmentation).toHaveBeenCalledTimes(1);
    await ws.close();
  });

  it("funnel() delegates to the live-query service (T044)", async () => {
    const { ws } = makeWorkspace();
    const result = new FunnelResult({
      funnel_id: 123,
      funnel_name: "Test Funnel",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      conversion_rate: 0.5,
      steps: [],
    });
    const funnel = vi.fn().mockResolvedValue(result);
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      funnel,
    } as never);

    const got = await ws.funnel(123, {
      from_date: "2024-01-01",
      to_date: "2024-01-31",
    });

    expect(got.funnel_id).toBe(123);
    expect(funnel).toHaveBeenCalledTimes(1);
    await ws.close();
  });

  it("retention() delegates to the live-query service (T045)", async () => {
    const { ws } = makeWorkspace();
    const result = new RetentionResult({
      born_event: "Sign Up",
      return_event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      cohorts: [],
    });
    const retention = vi.fn().mockResolvedValue(result);
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      retention,
    } as never);

    const got = await ws.retention({
      born_event: "Sign Up",
      return_event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
    });

    expect(got.born_event).toBe("Sign Up");
    expect(retention).toHaveBeenCalledTimes(1);
    await ws.close();
  });

  // The 7 cases below were translated at B6-ARB (Finding B) — they had
  // no Layer-3 twin anywhere before.

  it("eventCounts() delegates to the live-query service (T047)", async () => {
    const { ws } = makeWorkspace();
    const result = new EventCountsResult({
      events: ["A", "B"],
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      type: "general",
      series: {},
    });
    const eventCounts = vi.fn().mockResolvedValue(result);
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      eventCounts,
    } as never);

    const got = await ws.eventCounts(["A", "B"], {
      from_date: "2024-01-01",
      to_date: "2024-01-31",
    });

    expect(got.events).toEqual(["A", "B"]);
    expect(eventCounts).toHaveBeenCalledTimes(1);
    await ws.close();
  });

  it("propertyCounts() delegates to the live-query service (T048)", async () => {
    const { ws } = makeWorkspace();
    const result = new PropertyCountsResult({
      event: "Test",
      property_name: "country",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      type: "general",
      series: {},
    });
    const propertyCounts = vi.fn().mockResolvedValue(result);
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      propertyCounts,
    } as never);

    const got = await ws.propertyCounts("Test", "country", {
      from_date: "2024-01-01",
      to_date: "2024-01-31",
    });

    expect(got.property_name).toBe("country");
    expect(propertyCounts).toHaveBeenCalledTimes(1);
    await ws.close();
  });

  it("activityFeed() delegates to the live-query service (T049)", async () => {
    const { ws } = makeWorkspace();
    const result = new ActivityFeedResult({
      distinct_ids: ["user1"],
      from_date: null,
      to_date: null,
      events: [],
    });
    const activityFeed = vi.fn().mockResolvedValue(result);
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      activityFeed,
    } as never);

    const got = await ws.activityFeed(["user1"]);

    expect(got.distinct_ids).toEqual(["user1"]);
    expect(activityFeed).toHaveBeenCalledTimes(1);
    await ws.close();
  });

  it("frequency() delegates to the live-query service (T051)", async () => {
    const { ws } = makeWorkspace();
    const result = new FrequencyResult({
      event: null,
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      unit: "day",
      addiction_unit: "hour",
      data: {},
    });
    const frequency = vi.fn().mockResolvedValue(result);
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      frequency,
    } as never);

    const got = await ws.frequency({
      from_date: "2024-01-01",
      to_date: "2024-01-31",
    });

    expect(got.unit).toBe("day");
    expect(frequency).toHaveBeenCalledTimes(1);
    await ws.close();
  });

  it("segmentationNumeric() delegates to the live-query service (T052)", async () => {
    const { ws } = makeWorkspace();
    const result = new NumericBucketResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      property_expr: 'properties["amount"]',
      unit: "day",
      series: {},
    });
    const segmentationNumeric = vi.fn().mockResolvedValue(result);
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      segmentationNumeric,
    } as never);

    const got = await ws.segmentationNumeric("Purchase", {
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      on: 'properties["amount"]',
    });

    expect(got.event).toBe("Purchase");
    expect(segmentationNumeric).toHaveBeenCalledTimes(1);
    await ws.close();
  });

  it("segmentationSum() delegates to the live-query service (T053)", async () => {
    const { ws } = makeWorkspace();
    const result = new NumericSumResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      property_expr: 'properties["amount"]',
      unit: "day",
      results: {},
    });
    const segmentationSum = vi.fn().mockResolvedValue(result);
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      segmentationSum,
    } as never);

    const got = await ws.segmentationSum("Purchase", {
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      on: 'properties["amount"]',
    });

    expect(got.event).toBe("Purchase");
    expect(segmentationSum).toHaveBeenCalledTimes(1);
    await ws.close();
  });

  it("segmentationAverage() delegates to the live-query service (T054)", async () => {
    const { ws } = makeWorkspace();
    const result = new NumericAverageResult({
      event: "Purchase",
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      property_expr: 'properties["amount"]',
      unit: "day",
      results: {},
    });
    const segmentationAverage = vi.fn().mockResolvedValue(result);
    vi.spyOn(ws, "liveQueryService", "get").mockReturnValue({
      segmentationAverage,
    } as never);

    const got = await ws.segmentationAverage("Purchase", {
      from_date: "2024-01-01",
      to_date: "2024-01-31",
      on: 'properties["amount"]',
    });

    expect(got.event).toBe("Purchase");
    expect(segmentationAverage).toHaveBeenCalledTimes(1);
    await ws.close();
  });
});

describe("TestDiscovery (test_workspace.py:439) — discovery delegation", () => {
  it("events() delegates to the discovery service", async () => {
    const { ws } = makeWorkspace();
    const listEvents = vi.fn().mockResolvedValue(["Login", "Purchase"]);
    vi.spyOn(ws, "discoveryService", "get").mockReturnValue({
      listEvents,
    } as never);

    const events = await ws.events();

    expect(events).toEqual(["Login", "Purchase"]);
    expect(listEvents).toHaveBeenCalledTimes(1);
    await ws.close();
  });

  it("properties() delegates to the discovery service", async () => {
    const { ws } = makeWorkspace();
    const listProperties = vi.fn().mockResolvedValue(["plan", "country"]);
    vi.spyOn(ws, "discoveryService", "get").mockReturnValue({
      listProperties,
    } as never);

    const properties = await ws.properties("Login");

    expect(properties).toEqual(["plan", "country"]);
    expect(listProperties).toHaveBeenCalledWith("Login");
    await ws.close();
  });
});

describe("TestContextManager (test_workspace.py:712)", () => {
  it("`await using` disposal closes the facade (the __enter__ twin)", async () => {
    // Python's `with ws as entered: assert entered is ws` locks that the
    // context manager hands back the SAME object. The TS twin is
    // `Symbol.asyncDispose` (R6.2) — there is no `__enter__` return
    // value, so the invariant that survives translation is that
    // disposal runs `close()` on this instance.
    const { ws, client } = makeWorkspace();
    const close = vi.spyOn(client, "close");

    await ws[Symbol.asyncDispose]();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("close() calls the client's close()", async () => {
    const { ws, client } = makeWorkspace();
    const close = vi.spyOn(client, "close");

    await ws.close();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("close() is idempotent (`safe to call multiple times`)", async () => {
    const { ws, client } = makeWorkspace();

    await ws.close();
    await ws.close();

    expect(client.isHttpOpen()).toBe(false);
  });
});

describe("TestLimitValidation (test_workspace.py:754)", () => {
  it("streamEvents rejects a limit over 100000", async () => {
    const { ws } = makeWorkspace();
    await expect(async () => {
      for await (const _event of ws.streamEvents({
        from_date: "2024-01-01",
        to_date: "2024-01-31",
        limit: 100001,
      })) {
        void _event;
      }
    }).rejects.toThrow(/limit must be at most 100000/);
    await ws.close();
  });

  it("streamEvents rejects a zero or negative limit", async () => {
    const { ws } = makeWorkspace();
    await expect(async () => {
      for await (const _event of ws.streamEvents({
        from_date: "2024-01-01",
        to_date: "2024-01-31",
        limit: 0,
      })) {
        void _event;
      }
    }).rejects.toThrow(/limit must be at least 1/);
    await ws.close();
  });
});

/**
 * Install a stub MeService on the facade (the Python tests assign
 * `ws._me_service = MagicMock()`).
 *
 * @param ws - The facade.
 * @param stub - The partial service.
 */
function stubMeService(ws: Workspace, stub: Partial<MeService>): void {
  vi.spyOn(ws, "meService", "get").mockReturnValue(stub as MeService);
}

describe("TestWorkspacesMethod (test_workspace.py:808)", () => {
  it("workspaces() returns WorkspaceRefs built from MeWorkspaceInfo", async () => {
    const { ws } = makeWorkspace();
    const listWorkspaces = vi.fn().mockResolvedValue([
      new MeWorkspaceInfo({
        id: 1,
        name: "Default",
        project_id: 12345,
        is_default: true,
      }),
      new MeWorkspaceInfo({
        id: 2,
        name: "Staging",
        project_id: 12345,
        is_default: false,
      }),
    ]);
    stubMeService(ws, { listWorkspaces } as unknown as Partial<MeService>);

    const result = await ws.workspaces();

    // Defaults to the current project's id from the session.
    expect(listWorkspaces).toHaveBeenCalledWith({ project_id: "12345" });
    expect(result.map((w) => [w.id, w.name, w.is_default])).toEqual([
      [1, "Default", true],
      [2, "Staging", false],
    ]);
  });

  it("workspaces({project_id}) passes the override through", async () => {
    const { ws } = makeWorkspace();
    const listWorkspaces = vi.fn().mockResolvedValue([]);
    stubMeService(ws, { listWorkspaces } as unknown as Partial<MeService>);

    await ws.workspaces({ project_id: "9999999" });

    expect(listWorkspaces).toHaveBeenCalledWith({ project_id: "9999999" });
  });
});

describe("TestProjectsMethod (test_workspace.py:861)", () => {
  it("projects() returns Project records built from MeProjectInfo tuples", async () => {
    const { ws } = makeWorkspace();
    const listProjects = vi.fn().mockResolvedValue([
      [
        "100",
        new MeProjectInfo({
          name: "Alpha",
          organization_id: 42,
          timezone: "US/Pacific",
        }),
      ],
      ["200", new MeProjectInfo({ name: "Beta", organization_id: 43 })],
    ]);
    stubMeService(ws, { listProjects } as unknown as Partial<MeService>);

    const result = await ws.projects();

    expect(listProjects).toHaveBeenCalledWith();
    expect(
      result.map((p) => [p.id, p.name, p.organization_id, p.timezone]),
    ).toEqual([
      ["100", "Alpha", 42, "US/Pacific"],
      ["200", "Beta", 43, null],
    ]);
  });

  it("projects({refresh: true}) force-refreshes the /me cache first", async () => {
    const { ws } = makeWorkspace();
    const fetch = vi.fn().mockResolvedValue(new MeResponse());
    const listProjects = vi.fn().mockResolvedValue([]);
    stubMeService(ws, { fetch, listProjects } as unknown as Partial<MeService>);

    await ws.projects({ refresh: true });

    expect(fetch).toHaveBeenCalledWith({ force_refresh: true });
  });
});

describe("TestCodedWorkspaceGuardCodes (test_workspace.py:919)", () => {
  it("WR2: validateLimit below the minimum raises the coded error", () => {
    try {
      validateLimit(0);
      expect.unreachable("validateLimit(0) must throw");
    } catch (exc) {
      expect(exc).toBeInstanceOf(ParamValidationError);
      expect((exc as ParamValidationError).code).toBe("WR2_LIMIT_TOO_SMALL");
    }
  });

  it("WR2: streamEvents surfaces the code for a negative limit", async () => {
    const { ws } = makeWorkspace();
    try {
      for await (const _event of ws.streamEvents({
        from_date: "2024-01-01",
        to_date: "2024-01-31",
        limit: -5,
      })) {
        void _event;
      }
      expect.unreachable("stream must throw");
    } catch (exc) {
      expect(exc).toBeInstanceOf(ParamValidationError);
      expect((exc as ParamValidationError).code).toBe("WR2_LIMIT_TOO_SMALL");
    }
    await ws.close();
  });

  it("WR3: validateLimit above the maximum raises the coded error", () => {
    try {
      validateLimit(100_001);
      expect.unreachable("validateLimit(100001) must throw");
    } catch (exc) {
      expect((exc as ParamValidationError).code).toBe("WR3_LIMIT_TOO_LARGE");
    }
  });

  it("WR3: streamEvents surfaces the code for an oversized limit", async () => {
    const { ws } = makeWorkspace();
    try {
      for await (const _event of ws.streamEvents({
        from_date: "2024-01-01",
        to_date: "2024-01-31",
        limit: 200_000,
      })) {
        void _event;
      }
      expect.unreachable("stream must throw");
    } catch (exc) {
      expect((exc as ParamValidationError).code).toBe("WR3_LIMIT_TOO_LARGE");
    }
    await ws.close();
  });

  it("WS1: use({target, account}) raises the coded error", async () => {
    const { ws } = makeWorkspace();
    await expect(
      ws.use({ target: "ecom", account: "team" }),
    ).rejects.toMatchObject({ code: "WS1_TARGET_MUTUALLY_EXCLUSIVE" });
    await ws.close();
  });

  it("WS1: use({target, project}) raises the coded error", async () => {
    const { ws } = makeWorkspace();
    await expect(
      ws.use({ target: "ecom", project: "99" }),
    ).rejects.toMatchObject({ code: "WS1_TARGET_MUTUALLY_EXCLUSIVE" });
    await ws.close();
  });

  it("WS2: the level validator rejects a non-literal level", () => {
    try {
      validateBusinessContextLevel("org");
      expect.unreachable("validateBusinessContextLevel('org') must throw");
    } catch (exc) {
      expect(exc).toBeInstanceOf(ParamValidationError);
      expect((exc as ParamValidationError).code).toBe("WS2_INVALID_LEVEL");
    }
  });

  it("WS2: getBusinessContext surfaces the code before any client call", async () => {
    const { ws, client } = makeWorkspace();
    const spy = vi.spyOn(client, "getBusinessContext");

    await expect(
      ws.getBusinessContext({
        level: "organisation" as "organization",
      }),
    ).rejects.toMatchObject({ code: "WS2_INVALID_LEVEL" });
    expect(spy).not.toHaveBeenCalled();
    await ws.close();
  });
});

describe("MeService construction (workspace.py:866-885)", () => {
  it("the lazy accessor builds one service bound to the session", () => {
    const { ws } = makeWorkspace();

    const first = ws.meService;
    const second = ws.meService;

    expect(first).toBeInstanceOf(MeService);
    expect(second).toBe(first);
  });

  it("the in-memory cache store round-trips a response", async () => {
    const cache = inMemoryMeCache("team");
    expect(cache.accountName).toBe("team");
    expect(await cache.get()).toBeNull();
    const response = new MeResponse({ user_email: "a@b.c" });
    await cache.put(response);
    expect(await cache.get()).toBe(response);
    await cache.invalidate();
    expect(await cache.get()).toBeNull();
  });
});
