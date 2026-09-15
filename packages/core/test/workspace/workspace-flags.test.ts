// Workspace feature-flag members (CRUD, lifecycle, operations) over the
// injected fetch seam, with the client pinned to workspace 100 as Python does.
// Mirrors tests/unit/test_workspace_flags.py (all three classes); `model_extra`
// is the `__extras` spillover bag. Additive: the create/get/update empty-response
// guards and the getFlagHistory query-param assembly the wire suite never reaches.

import { describe, expect, it } from "vitest";

import {
  CreateFeatureFlagParams,
  FeatureFlag,
  FlagHistoryResponse,
  FlagLimitsResponse,
  SetTestUsersParams,
  UpdateFeatureFlagParams,
} from "../../src/types/entities/feature-flags.js";
import {
  FeatureFlagStatus,
  FlagContractStatus,
  ServingMethod,
} from "../../src/types/enums.js";
import { Workspace } from "../../src/workspace.js";
import {
  createFeatureFlag as createFeatureFlagMember,
  getFeatureFlag as getFeatureFlagMember,
  getFlagHistory as getFlagHistoryMember,
  updateFeatureFlag as updateFeatureFlagMember,
} from "../../src/workspace-members/flags-experiments.js";
import {
  type CannedHandler,
  CLIENT_SESSION,
  createMockClient,
  FACADE_SESSION,
  type FakeTransport,
  ok,
} from "../../test-support/client-test-helpers.js";
import { stubClient } from "../../test-support/workspace-test-helpers.js";

/**
 * Build a Workspace whose client routes through `handler`
 * (`_make_workspace`).
 *
 * @param handler - The canned-response handler.
 * @returns The facade plus the transport capture log.
 */
function makeWorkspace(handler: CannedHandler): {
  ws: Workspace;
  transport: FakeTransport;
} {
  const { client, transport } = createMockClient(CLIENT_SESSION, handler);
  client.setWorkspaceId(100);
  return { ws: new Workspace({ session: FACADE_SESSION, client }), transport };
}

/**
 * A minimal feature flag dict matching the API shape (`_flag_json`).
 *
 * @param id - Flag UUID.
 * @param name - Flag name.
 * @param key - Flag key.
 * @returns The payload record.
 */
function flagJson(
  id = "abc-123",
  name = "Test Flag",
  key = "test_flag",
): Record<string, unknown> {
  return {
    id,
    project_id: 12345,
    name,
    key,
    status: "disabled",
    context: "default",
    serving_method: "client",
    ruleset: {},
    created: "2026-01-01T00:00:00Z",
    modified: "2026-01-01T00:00:00Z",
  };
}

// --- Workspace feature flag CRUD ---

describe("Workspace feature flag CRUD", () => {
  // python: TestWorkspaceFeatureFlagCRUD
  it("listFeatureFlags() returns list of FeatureFlag objects", async () => {
    const { ws } = makeWorkspace(() =>
      ok([
        flagJson("id-1", "Flag A", "flag_a"),
        flagJson("id-2", "Flag B", "flag_b"),
      ]),
    );
    const flags = await ws.listFeatureFlags();

    expect(flags).toHaveLength(2);
    expect(flags[0]).toBeInstanceOf(FeatureFlag);
    expect(flags[0]?.id).toBe("id-1");
    expect(flags[0]?.name).toBe("Flag A");
    expect(flags[1]?.id).toBe("id-2");
    expect(flags[1]?.name).toBe("Flag B");
  });

  it("listFeatureFlags() returns empty list when no flags exist", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    await expect(ws.listFeatureFlags()).resolves.toStrictEqual([]);
  });

  it("list_feature_flags(include_archived=True) passes param to API", async () => {
    const { ws, transport } = makeWorkspace(() => ok([flagJson()]));
    const flags = await ws.listFeatureFlags({ include_archived: true });

    expect(flags).toHaveLength(1);
    expect(flags[0]).toBeInstanceOf(FeatureFlag);
    expect(transport.captures).toHaveLength(1);
    expect(transport.captures[0]?.url).toContain("include_archived=true");
  });

  it("listFeatureFlags() returns FeatureFlag instances with correct fields", async () => {
    const { ws } = makeWorkspace(() => ok([flagJson()]));
    const flags = await ws.listFeatureFlags();

    expect(flags).toHaveLength(1);
    const flag = flags[0];
    expect(flag).toBeInstanceOf(FeatureFlag);
    expect(flag?.status).toBe(FeatureFlagStatus.DISABLED);
    expect(flag?.serving_method).toBe(ServingMethod.CLIENT);
  });

  it("createFeatureFlag() returns the created FeatureFlag", async () => {
    const { ws } = makeWorkspace(() =>
      ok(flagJson("new-id", "New Flag", "new_flag")),
    );
    const params = new CreateFeatureFlagParams({
      name: "New Flag",
      key: "new_flag",
    });
    const flag = await ws.createFeatureFlag(params);

    expect(flag).toBeInstanceOf(FeatureFlag);
    expect(flag.id).toBe("new-id");
    expect(flag.name).toBe("New Flag");
    expect(flag.key).toBe("new_flag");
  });

  it("createFeatureFlag() sends optional fields when provided", async () => {
    const { ws } = makeWorkspace(() => {
      const data = flagJson("new-id", "Dark Mode", "dark_mode");
      data["description"] = "Toggle dark mode";
      data["status"] = "enabled";
      return ok(data);
    });
    const params = new CreateFeatureFlagParams({
      name: "Dark Mode",
      key: "dark_mode",
      description: "Toggle dark mode",
      status: FeatureFlagStatus.ENABLED,
    });
    const flag = await ws.createFeatureFlag(params);

    expect(flag.description).toBe("Toggle dark mode");
    expect(flag.status).toBe(FeatureFlagStatus.ENABLED);
  });

  it("getFeatureFlag() returns a single FeatureFlag by ID", async () => {
    const { ws } = makeWorkspace(() =>
      ok(flagJson("abc-123", "My Flag", "my_flag")),
    );
    const flag = await ws.getFeatureFlag("abc-123");

    expect(flag).toBeInstanceOf(FeatureFlag);
    expect(flag.id).toBe("abc-123");
    expect(flag.name).toBe("My Flag");
  });

  it("getFeatureFlag() preserves extra fields from the API", async () => {
    const { ws } = makeWorkspace(() => {
      const data = flagJson();
      data["custom_metadata"] = { team: "platform" };
      return ok(data);
    });
    const flag = await ws.getFeatureFlag("abc-123");

    expect(flag.__extras["custom_metadata"]).toStrictEqual({
      team: "platform",
    });
  });

  it("updateFeatureFlag() returns the updated FeatureFlag", async () => {
    const { ws } = makeWorkspace(() => {
      const data = flagJson("abc-123", "Updated", "test_flag");
      data["status"] = "enabled";
      return ok(data);
    });
    const params = new UpdateFeatureFlagParams({
      name: "Updated",
      key: "test_flag",
      status: FeatureFlagStatus.ENABLED,
      ruleset: { variants: [] },
    });
    const flag = await ws.updateFeatureFlag("abc-123", params);

    expect(flag).toBeInstanceOf(FeatureFlag);
    expect(flag.name).toBe("Updated");
    expect(flag.status).toBe(FeatureFlagStatus.ENABLED);
  });

  it("deleteFeatureFlag() resolves to undefined on success", async () => {
    const { ws } = makeWorkspace(() => ({ status: 204 }));
    await expect(ws.deleteFeatureFlag("abc-123")).resolves.toBeUndefined();
  });

  it("deleteFeatureFlag() handles 200 response too", async () => {
    const { ws } = makeWorkspace(() => ok({}));
    await expect(ws.deleteFeatureFlag("abc-123")).resolves.toBeUndefined();
  });
});

// --- Workspace feature flag lifecycle ---

describe("Workspace feature flag lifecycle", () => {
  // python: TestWorkspaceFeatureFlagLifecycle
  it("archiveFeatureFlag() resolves to undefined on success", async () => {
    const { ws } = makeWorkspace(() => ({ status: 204 }));
    await expect(ws.archiveFeatureFlag("abc-123")).resolves.toBeUndefined();
  });

  it("restoreFeatureFlag() returns the restored FeatureFlag", async () => {
    const { ws } = makeWorkspace(() =>
      ok(flagJson("abc-123", "Restored", "restored")),
    );
    const flag = await ws.restoreFeatureFlag("abc-123");

    expect(flag).toBeInstanceOf(FeatureFlag);
    expect(flag.id).toBe("abc-123");
    expect(flag.name).toBe("Restored");
  });

  it("duplicateFeatureFlag() returns the duplicated FeatureFlag", async () => {
    const { ws } = makeWorkspace(() =>
      ok(flagJson("dup-456", "Copy of Test", "test_flag_copy")),
    );
    const flag = await ws.duplicateFeatureFlag("abc-123");

    expect(flag).toBeInstanceOf(FeatureFlag);
    expect(flag.id).toBe("dup-456");
    expect(flag.name).toBe("Copy of Test");
    expect(flag.key).toBe("test_flag_copy");
  });
});

// --- Workspace feature flag operations ---

describe("Workspace feature flag operations", () => {
  // python: TestWorkspaceFeatureFlagOperations
  it("setFlagTestUsers() resolves to undefined on success", async () => {
    const { ws } = makeWorkspace(() => ({ status: 204 }));
    const params = new SetTestUsersParams({
      users: { on: "user-1", off: "user-2" },
    });
    await expect(
      ws.setFlagTestUsers("abc-123", params),
    ).resolves.toBeUndefined();
  });

  it("setFlagTestUsers() accepts empty user mapping", async () => {
    const { ws } = makeWorkspace(() => ({ status: 204 }));
    const params = new SetTestUsersParams({ users: {} });
    await expect(
      ws.setFlagTestUsers("abc-123", params),
    ).resolves.toBeUndefined();
  });

  it("getFlagHistory() returns FlagHistoryResponse", async () => {
    const { ws } = makeWorkspace(() =>
      ok({
        events: [
          [1, "created"],
          [2, "enabled"],
        ],
        count: 2,
      }),
    );
    const history = await ws.getFlagHistory("abc-123");

    expect(history).toBeInstanceOf(FlagHistoryResponse);
    expect(history.events).toHaveLength(2);
    expect(history.count).toBe(2);
  });

  it("getFlagHistory() handles empty history", async () => {
    const { ws } = makeWorkspace(() => ok({ events: [], count: 0 }));
    const history = await ws.getFlagHistory("abc-123");

    expect(history).toBeInstanceOf(FlagHistoryResponse);
    expect(history.events).toStrictEqual([]);
    expect(history.count).toBe(0);
  });

  it("getFlagLimits() returns FlagLimitsResponse", async () => {
    const { ws } = makeWorkspace(() =>
      ok({
        limit: 100,
        is_trial: false,
        current_usage: 42,
        contract_status: "active",
      }),
    );
    const limits = await ws.getFlagLimits();

    expect(limits).toBeInstanceOf(FlagLimitsResponse);
    expect(limits.limit).toBe(100);
    expect(limits.is_trial).toBe(false);
    expect(limits.current_usage).toBe(42);
    expect(limits.contract_status).toBe(FlagContractStatus.ACTIVE);
  });

  it("getFlagLimits() correctly parses trial account limits", async () => {
    const { ws } = makeWorkspace(() =>
      ok({
        limit: 10,
        is_trial: true,
        current_usage: 3,
        contract_status: "grace_period",
      }),
    );
    const limits = await ws.getFlagLimits();

    expect(limits).toBeInstanceOf(FlagLimitsResponse);
    expect(limits.is_trial).toBe(true);
    expect(limits.contract_status).toBe(FlagContractStatus.GRACE_PERIOD);
  });
});

// --- Additive: facade-local branches Python's wire suite never reaches ---

describe("ADDITIVE: getFlagHistory query-param assembly", () => {
  it("omits `params` entirely when neither key is supplied", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "getFlagHistory",
      { events: [], count: 0 },
      calls,
    );
    await getFlagHistoryMember(client, "abc-123");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("abc-123");
    expect(calls[0]?.[1]).toStrictEqual({ params: null });
  });

  it("stringifies page_size and forwards page verbatim", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "getFlagHistory",
      { events: [], count: 0 },
      calls,
    );
    await getFlagHistoryMember(client, "abc-123", {
      page: "cursor-2",
      page_size: 50,
    });

    expect(calls[0]?.[1]).toStrictEqual({
      params: { page: "cursor-2", page_size: "50" },
    });
  });

  it("sends only the supplied key (page_size alone)", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "getFlagHistory",
      { events: [], count: 0 },
      calls,
    );
    await getFlagHistoryMember(client, "abc-123", { page_size: 5 });

    expect(calls[0]?.[1]).toStrictEqual({ params: { page_size: "5" } });
  });
});

describe("ADDITIVE: empty-response guards (UNKNOWN_ERROR)", () => {
  const cases: ReadonlyArray<[string, () => Promise<unknown>]> = [
    [
      "create_feature_flag",
      (): Promise<unknown> =>
        createFeatureFlagMember(
          stubClient("createFeatureFlag", null),
          new CreateFeatureFlagParams({ name: "n", key: "k" }),
        ),
    ],
    [
      "get_feature_flag",
      (): Promise<unknown> =>
        getFeatureFlagMember(stubClient("getFeatureFlag", null), "f1"),
    ],
    [
      "update_feature_flag",
      (): Promise<unknown> =>
        updateFeatureFlagMember(
          stubClient("updateFeatureFlag", null),
          "f1",
          new UpdateFeatureFlagParams({
            name: "n",
            key: "k",
            status: FeatureFlagStatus.ENABLED,
            ruleset: {},
          }),
        ),
    ],
  ];

  it.each(cases)(
    "%s raises MixpanelHeadlessError(UNKNOWN_ERROR) on a null payload",
    async (pythonName, call) => {
      await expect(call()).rejects.toMatchObject({
        name: "MixpanelHeadlessError",
        code: "UNKNOWN_ERROR",
        message: `API returned empty response for ${pythonName}`,
      });
    },
  );
});
