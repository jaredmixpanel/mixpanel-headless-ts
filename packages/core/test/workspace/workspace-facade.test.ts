// Workspace facade: delegation to LiveQueryService / DiscoveryService, the
// context-manager close(), limit validation, workspaces() / projects(), the coded
// workspace-guard codes on use(), MeService construction and resolver wiring.
// Mirrors those classes of tests/unit/test_workspace.py; constructor-guard cases
// live in workspace-init.test.ts, most TestDiscovery cases in discovery-facade.test.ts.

import { describe, expect, it, vi } from "vitest";

import { createAccountsNamespace } from "../../src/accounts/namespace.js";
import { resolverSeamsFromEffects } from "../../src/accounts/resolver-seams.js";
import type { MixpanelClient } from "../../src/client/client.js";
import {
  MeProjectInfo,
  MeResponse,
  MeWorkspaceInfo,
} from "../../src/client/me.js";
import { ParamValidationError } from "../../src/errors.js";
import { Secret } from "../../src/secret.js";
import { inMemoryMeCache, MeService } from "../../src/services/me.js";
import { validateLimit } from "../../src/services/queries/streaming.js";
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
import { Workspace } from "../../src/workspace.js";
import { validateBusinessContextLevel } from "../../src/workspace-members/lifecycle.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  drain,
  makeSession,
} from "../../test-support/client-test-helpers.js";
import { expectRejects, expectThrows } from "../../test-support/raises.js";
import { makeEffects } from "../accounts/fake-auth-effects.js";

/** The `_TEST_SESSION` twin. */
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

describe("Live queries — live-query delegation", () => {
  // python: TestLiveQueries
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

    expect(got.events).toStrictEqual(["A", "B"]);
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

    expect(got.distinct_ids).toStrictEqual(["user1"]);
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

describe("Discovery — discovery delegation", () => {
  // python: TestDiscovery
  it("events() delegates to the discovery service", async () => {
    const { ws } = makeWorkspace();
    const listEvents = vi.fn().mockResolvedValue(["Login", "Purchase"]);
    vi.spyOn(ws, "discoveryService", "get").mockReturnValue({
      listEvents,
    } as never);

    const events = await ws.events();

    expect(events).toStrictEqual(["Login", "Purchase"]);
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

    expect(properties).toStrictEqual(["plan", "country"]);
    expect(listProperties).toHaveBeenCalledWith("Login");
    await ws.close();
  });
});

describe("Context manager", () => {
  // python: TestContextManager
  it("`await using` disposal closes the facade (the __enter__ twin)", async () => {
    // Python's `with ws as entered: assert entered is ws` locks that the
    // context manager hands back the SAME object. The TS twin is
    // `Symbol.asyncDispose` — there is no `__enter__` return
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

describe("Limit validation", () => {
  // python: TestLimitValidation
  it("streamEvents rejects a limit over 100000", async () => {
    const { ws } = makeWorkspace();
    await expect(
      drain(
        ws.streamEvents({
          from_date: "2024-01-01",
          to_date: "2024-01-31",
          limit: 100001,
        }),
      ),
    ).rejects.toThrow(/limit must be at most 100000/);
    await ws.close();
  });

  it("streamEvents rejects a zero or negative limit", async () => {
    const { ws } = makeWorkspace();
    await expect(
      drain(
        ws.streamEvents({
          from_date: "2024-01-01",
          to_date: "2024-01-31",
          limit: 0,
        }),
      ),
    ).rejects.toThrow(/limit must be at least 1/);
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

describe("Workspaces method", () => {
  // python: TestWorkspacesMethod
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
    stubMeService(ws, { listWorkspaces });

    const result = await ws.workspaces();

    // Defaults to the current project's id from the session.
    expect(listWorkspaces).toHaveBeenCalledWith({ project_id: "12345" });
    expect(result.map((w) => [w.id, w.name, w.is_default])).toStrictEqual([
      [1, "Default", true],
      [2, "Staging", false],
    ]);
  });

  it("workspaces({project_id}) passes the override through", async () => {
    const { ws } = makeWorkspace();
    const listWorkspaces = vi.fn().mockResolvedValue([]);
    stubMeService(ws, { listWorkspaces });

    await ws.workspaces({ project_id: "9999999" });

    expect(listWorkspaces).toHaveBeenCalledWith({ project_id: "9999999" });
  });
});

describe("Projects method", () => {
  // python: TestProjectsMethod
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
    stubMeService(ws, { listProjects });

    const result = await ws.projects();

    expect(listProjects).toHaveBeenCalledWith();
    expect(
      result.map((p) => [p.id, p.name, p.organization_id, p.timezone]),
    ).toStrictEqual([
      ["100", "Alpha", 42, "US/Pacific"],
      ["200", "Beta", 43, null],
    ]);
  });

  it("projects({refresh: true}) force-refreshes the /me cache first", async () => {
    const { ws } = makeWorkspace();
    const fetch = vi.fn().mockResolvedValue(new MeResponse());
    const listProjects = vi.fn().mockResolvedValue([]);
    stubMeService(ws, { fetch, listProjects });

    await ws.projects({ refresh: true });

    expect(fetch).toHaveBeenCalledWith({ force_refresh: true });
  });
});

describe("Coded workspace guard codes", () => {
  // python: TestCodedWorkspaceGuardCodes
  it("WR2: validateLimit below the minimum raises the coded error", () => {
    const error = expectThrows(
      () => validateLimit(0),
      "validateLimit(0) must throw",
    );
    expect(error).toBeInstanceOf(ParamValidationError);
    expect((error as ParamValidationError).code).toBe("WR2_LIMIT_TOO_SMALL");
  });

  it("WR2: streamEvents surfaces the code for a negative limit", async () => {
    const { ws } = makeWorkspace();
    const error = await expectRejects(
      () =>
        drain(
          ws.streamEvents({
            from_date: "2024-01-01",
            to_date: "2024-01-31",
            limit: -5,
          }),
        ),
      "stream must throw",
    );
    expect(error).toBeInstanceOf(ParamValidationError);
    expect((error as ParamValidationError).code).toBe("WR2_LIMIT_TOO_SMALL");
    await ws.close();
  });

  it("WR3: validateLimit above the maximum raises the coded error", () => {
    const error = expectThrows(
      () => validateLimit(100_001),
      "validateLimit(100001) must throw",
    );
    expect((error as ParamValidationError).code).toBe("WR3_LIMIT_TOO_LARGE");
  });

  it("WR3: streamEvents surfaces the code for an oversized limit", async () => {
    const { ws } = makeWorkspace();
    const error = await expectRejects(
      () =>
        drain(
          ws.streamEvents({
            from_date: "2024-01-01",
            to_date: "2024-01-31",
            limit: 200_000,
          }),
        ),
      "stream must throw",
    );
    expect((error as ParamValidationError).code).toBe("WR3_LIMIT_TOO_LARGE");
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
    const error = expectThrows(
      () => validateBusinessContextLevel("org"),
      "validateBusinessContextLevel('org') must throw",
    );
    expect(error).toBeInstanceOf(ParamValidationError);
    expect((error as ParamValidationError).code).toBe("WS2_INVALID_LEVEL");
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

describe("MeService construction", () => {
  it("the lazy accessor builds one service bound to the session", () => {
    const { ws } = makeWorkspace();

    const first = ws.meService;
    const second = ws.meService;

    expect(first).toBeInstanceOf(MeService);
    expect(second).toBe(first);
  });

  it("the in-memory cache store round-trips a response", async () => {
    /* eslint-disable vitest/prefer-expect-resolves -- MeCacheStore.get is a
       MaybePromise seam; `.resolves` would throw on a synchronous store. */
    const cache = inMemoryMeCache("team");
    expect(cache.accountName).toBe("team");
    expect(await cache.get()).toBeNull();
    const response = new MeResponse({ user_email: "a@b.c" });
    await cache.put(response);
    expect(await cache.get()).toBe(response);
    await cache.invalidate();
    expect(await cache.get()).toBeNull();
    /* eslint-enable vitest/prefer-expect-resolves */
  });
});

// --- Facade resolver wiring ---
// The httpx MockTransport handler becomes the `createMockClient` canned
// handler; the tmp-`$HOME` MeCache isolation is inherent (in-memory cache
// factory); the account-swap case's ConfigManager becomes the in-memory
// effects fake plus the real `resolverSeamsFromEffects`.

/** `_me_dict` twin. */
function meDict(
  workspaces: Record<string, unknown>,
  projects: Record<string, unknown>,
): Record<string, unknown> {
  return {
    user_id: 1,
    user_email: "ak@example.com",
    projects,
    workspaces,
  };
}

/** `_ws` twin. */
function wsEntry(
  wid: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: wid,
    name: "view",
    project_id: 4025120,
    is_default: null,
    is_global: null,
    is_visible: null,
    ...overrides,
  };
}

describe("Facade resolver wiring", () => {
  // python: TestFacadeResolverWiring
  it("a warm /me resolves without hitting /workspaces/public", async () => {
    const calls: string[] = [];
    const session = makeSession({
      name: "facade",
      projectId: "4025120",
      username: "u",
      secret: "s",
    });
    const { client } = createMockClient(session, (request) => {
      calls.push(new URL(request.url).pathname);
      if (request.url.endsWith("/me")) {
        return {
          status: 200,
          json: {
            results: meDict(
              {
                "2": wsEntry(2, {
                  project_id: 4025120,
                  name: "All Project Data",
                  is_global: true,
                }),
              },
              { "4025120": { name: "demo", organization_id: 1 } },
            ),
          },
        };
      }
      return { status: 200, json: { results: [] } };
    });
    const ws = new Workspace({ session, client });

    await ws.me(); // warm the per-account /me cache (as `mp login` would)
    await expect(ws.api.resolveWorkspaceId()).resolves.toBe(2);
    expect(calls.some((p) => p.includes("workspaces/public"))).toBe(false);
    await ws.close();
  });

  it("after use({project}), the resolver selects the new project's view", async () => {
    const session = makeSession({
      name: "facade",
      projectId: "4025120",
      username: "u",
      secret: "s",
    });
    const { client } = createMockClient(session, (request) => {
      if (request.url.endsWith("/me")) {
        return {
          status: 200,
          json: {
            results: meDict(
              {
                "2": wsEntry(2, { project_id: 4025120, is_global: true }),
                "3": wsEntry(3, { project_id: 777, is_global: true }),
              },
              {
                "4025120": { name: "a", organization_id: 1 },
                "777": { name: "b", organization_id: 1 },
              },
            ),
          },
        };
      }
      return { status: 200, json: { results: [] } };
    });
    const ws = new Workspace({ session, client });

    await ws.me();
    await expect(ws.api.resolveWorkspaceId()).resolves.toBe(2);
    await ws.use({ project: "777" });
    await expect(ws.api.resolveWorkspaceId()).resolves.toBe(3);
    await ws.close();
  });

  it("after use({account}), the resolver reads the NEW account's cold cache", async () => {
    const bundle = makeEffects();
    const accounts = createAccountsNamespace(bundle.effects);
    await accounts.add("acct_a", {
      type: "service_account",
      region: "us",
      default_project: "100",
      username: "ua",
      secret: new Secret("sa"),
    });
    await accounts.add("acct_b", {
      type: "service_account",
      region: "us",
      default_project: "200",
      username: "ub",
      secret: new Secret("sb"),
    });

    const session = makeSession({
      name: "acct_a",
      projectId: "100",
      username: "ua",
      secret: "sa",
    });
    const { client } = createMockClient(session, (request) => {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/me")) {
        // Account A's /me: a global workspace (11) for project 100.
        return {
          status: 200,
          json: {
            results: meDict(
              { "11": wsEntry(11, { project_id: 100, is_global: true }) },
              { "100": { name: "a", organization_id: 1 } },
            ),
          },
        };
      }
      if (path.includes("workspaces/public")) {
        // Account B's project (200) public workspace.
        return {
          status: 200,
          json: {
            results: [
              {
                id: 22,
                name: "B default",
                project_id: 200,
                is_default: true,
              },
            ],
          },
        };
      }
      return { status: 200, json: { results: [] } };
    });
    const ws = new Workspace({
      session,
      client,
      seams: resolverSeamsFromEffects(bundle.effects),
    });

    await ws.me(); // warm acct_a's /me cache
    await expect(ws.api.resolveWorkspaceId()).resolves.toBe(11);
    await ws.use({ account: "acct_b" }); // acct_b's /me cache is cold
    await expect(ws.api.resolveWorkspaceId()).resolves.toBe(22);
    await ws.close();
  });

  it("a resolver wired onto an injected client is not overwritten", async () => {
    const session = makeSession({
      name: "facade",
      projectId: "4025120",
      username: "u",
      secret: "s",
    });
    const { client } = createMockClient(session, () => ({
      status: 200,
      json: [],
    }));
    const custom = vi.fn().mockResolvedValue(99);
    client.setWorkspaceResolver(custom);

    new Workspace({ session, client });

    // Facade left the caller's resolver in place.
    await expect(client.resolveWorkspaceId()).resolves.toBe(99);
    expect(custom).toHaveBeenCalledTimes(1);
  });
});
