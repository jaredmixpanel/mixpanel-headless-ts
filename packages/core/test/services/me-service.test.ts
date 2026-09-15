// B6-W1 Layer-3 translation of `tests/unit/test_me.py::TestMeService`
// (:458-682) — the half of `_internal/me.py` that W1 ports
// (`b6-packets.md` §3.3: models + `WorkspaceView` + `selectWorkspaceId`
// landed at B4-C1 in `client/me.ts`; `MeService` lands here; the ON-DISK
// `MeCache` (`me.py:413-607`) is B8-N2).
//
// The packet's §3 Layer-3 table does not name `test_me.py` (it lists the
// facade suites only), so this file is the shard's own translation of
// the MeService class — recorded in `B6-W1-notes.md` §Layer-3 so the
// review pair can see the addition rather than a gap.
//
// DEFERRED to B8-N2 (header-cited): `TestMeCache` (:228),
// `TestMeCacheConcurrency` (:331), `TestMeCacheSymlinkRejection` (:685)
// — all on-disk cache behaviour. The disk-cache leg of
// `test_fetch_uses_disk_cache` (:510) / `test_fetch_stores_in_disk_cache`
// (:523) is translated here against the INJECTED `MeCacheStore` seam
// (the in-memory default), which is the store-shaped invariant that
// survives without disk.

import { describe, expect, it, vi } from "vitest";

import type { JsonValue } from "../../src/client/json-value.js";
import { MeResponse, MeWorkspaceInfo } from "../../src/client/me.js";
import {
  AuthenticationError,
  ConfigError,
  QueryError,
} from "../../src/errors.js";
import {
  inMemoryMeCache,
  type MeCacheStore,
  type MeClient,
  MeService,
} from "../../src/services/me.js";
import { expectRejects } from "../../test-support/raises.js";

/** The `_make_me_response_dict()` twin (`test_me.py:412-456`). */
function meResponseDict(): Record<string, JsonValue> {
  return {
    user_id: 42,
    user_email: "test@example.com",
    user_name: "Test User",
    organizations: { "100": { id: 100, name: "Acme Corp" } },
    projects: {
      "3713224": {
        name: "AI Demo",
        organization_id: 100,
        timezone: "US/Pacific",
        has_workspaces: true,
      },
      "3018488": {
        name: "E-Commerce",
        organization_id: 100,
        timezone: "US/Eastern",
        has_workspaces: false,
      },
    },
    workspaces: {
      "3448413": {
        id: 3448413,
        name: "Default",
        project_id: 3713224,
        is_default: true,
      },
      "3448414": {
        id: 3448414,
        name: "Staging",
        project_id: 3713224,
        is_default: false,
      },
      "9999999": {
        id: 9999999,
        name: "Other",
        project_id: 3018488,
        is_default: true,
      },
    },
  } as unknown as Record<string, JsonValue>;
}

/** The `mock_api` fixture twin — a client exposing only `me()`. */
function mockApi(
  behaviour: () => Promise<Record<string, JsonValue>> = () =>
    Promise.resolve(meResponseDict()),
): { client: MeClient; calls: number[] } {
  const calls: number[] = [];
  const client: MeClient = {
    me: async (): Promise<Record<string, JsonValue>> => {
      calls.push(calls.length);
      return behaviour();
    },
  };
  return { client, calls };
}

/**
 * The `service` fixture twin.
 *
 * @param options - Optional cache / account-type overrides.
 * @returns The service, the client call log and the cache store.
 */
function makeService(
  options: {
    cache?: MeCacheStore;
    accountType?: "service_account" | "oauth_browser" | "oauth_token" | null;
    behaviour?: () => Promise<Record<string, JsonValue>>;
  } = {},
): { service: MeService; calls: number[]; cache: MeCacheStore } {
  const cache = options.cache ?? inMemoryMeCache("personal");
  const { client, calls } = mockApi(options.behaviour);
  const service = new MeService(client, cache, "us", {
    accountType: options.accountType ?? null,
  });
  return { service, calls, cache };
}

describe("MeService.fetch (test_me.py:487-532)", () => {
  it("calls the client on the first call", async () => {
    const { service, calls } = makeService();

    const result = await service.fetch();

    expect(calls).toHaveLength(1);
    expect(result.user_id).toBe(42);
    expect(result.user_email).toBe("test@example.com");
  });

  it("uses the in-memory cache on the second call", async () => {
    const { service, calls } = makeService();

    await service.fetch();
    await service.fetch();

    expect(calls).toHaveLength(1);
  });

  it("force_refresh bypasses every cache", async () => {
    const { service, calls } = makeService();

    await service.fetch();
    await service.fetch({ force_refresh: true });

    expect(calls).toHaveLength(2);
  });

  it("a second service reads the shared store instead of the API", async () => {
    const cache = inMemoryMeCache("personal");
    const { client, calls } = mockApi();
    const first = new MeService(client, cache, "us");
    await first.fetch();
    expect(calls).toHaveLength(1);

    const second = new MeService(client, cache, "us");
    const result = await second.fetch();

    expect(calls).toHaveLength(1);
    expect(result.user_id).toBe(42);
  });

  it("stores the response in the cache store", async () => {
    const { service, cache } = makeService();

    await service.fetch();

    const cached = await cache.get();
    expect(cached).not.toBeNull();
    expect(cached?.user_id).toBe(42);
  });

  it("peek() never calls the API", async () => {
    const { service, calls } = makeService();

    await expect(service.peek()).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("MeService.fetch error handling (test_me.py:534-597)", () => {
  it("401 raises an actionable ConfigError", async () => {
    const { service } = makeService({
      behaviour: () =>
        Promise.reject(
          new AuthenticationError("Invalid credentials", { statusCode: 401 }),
        ),
    });

    const error = await expectRejects(service.fetch(), "401 must raise");
    expect(error).toBeInstanceOf(ConfigError);
    const err = error as ConfigError;
    expect(err.message).toMatch(/invalid \(401\)/);
    expect(err.message).toContain("mp account login");
    expect(err.details["status_code"]).toBe(401);
    expect(err.details["account_name"]).toBe("personal");
  });

  it("403 on a service account surfaces the E-10 scope hint", async () => {
    const { service } = makeService({
      accountType: "service_account",
      behaviour: () =>
        Promise.reject(
          new QueryError("Permission denied", { statusCode: 403 }),
        ),
    });

    const error = await expectRejects(service.fetch(), "403 must raise");
    const err = error as ConfigError;
    expect(err.message).toBe(
      "Service account 'personal' is missing the `user_details` scope.\n\n" +
        "Re-mint the SA in Mixpanel Settings → Service Accounts with " +
        "that scope checked,\n" +
        "or pass --project ID explicitly to skip the /me lookup.",
    );
    expect(err.details["status_code"]).toBe(403);
    expect(err.details["account_name"]).toBe("personal");
  });

  it("403 without an account type uses the generic message", async () => {
    const { service } = makeService({
      behaviour: () =>
        Promise.reject(
          new QueryError("Permission denied", { statusCode: 403 }),
        ),
    });

    const error = await expectRejects(service.fetch(), "403 must raise");
    const err = error as ConfigError;
    expect(err.message).toMatch(/lacks \/me permission/);
    expect(err.message).toContain("--project");
    expect(err.details["status_code"]).toBe(403);
  });

  it("non-401/403 errors propagate unchanged", async () => {
    const { service } = makeService({
      behaviour: () =>
        Promise.reject(new QueryError("Bad request", { statusCode: 400 })),
    });

    await expect(service.fetch()).rejects.toBeInstanceOf(QueryError);
  });
});

describe("MeService.listProjects / findProject (test_me.py:601-630)", () => {
  it("returns projects sorted by name", async () => {
    const { service } = makeService();

    const projects = await service.listProjects();

    expect(projects).toHaveLength(2);
    expect(projects[0]?.[0]).toBe("3713224");
    expect(projects[0]?.[1].name).toBe("AI Demo");
    expect(projects[1]?.[0]).toBe("3018488");
    expect(projects[1]?.[1].name).toBe("E-Commerce");
  });

  it("fetches when nothing is cached", async () => {
    const { service, calls } = makeService();

    await service.listProjects();

    expect(calls).toHaveLength(1);
  });

  it("finds an existing project by id", async () => {
    const { service } = makeService();

    expect((await service.findProject("3713224"))?.name).toBe("AI Demo");
  });

  it("returns null for a missing project", async () => {
    const { service } = makeService();

    await expect(service.findProject("999999")).resolves.toBeNull();
  });
});

describe("MeService.listWorkspaces (test_me.py:633-658)", () => {
  it("lists every workspace across projects", async () => {
    const { service } = makeService();

    await expect(service.listWorkspaces()).resolves.toHaveLength(3);
  });

  it("filters by project id", async () => {
    const { service } = makeService();

    const workspaces = await service.listWorkspaces({
      project_id: "3713224",
    });

    expect(workspaces).toHaveLength(2);
    expect(new Set(workspaces.map((ws) => ws.name))).toStrictEqual(
      new Set(["Default", "Staging"]),
    );
  });

  it("sorts by name", async () => {
    const { service } = makeService();

    const workspaces = await service.listWorkspaces({
      project_id: "3713224",
    });

    expect(workspaces[0]?.name).toBe("Default");
    expect(workspaces[1]?.name).toBe("Staging");
  });

  it("returns empty for an unknown project", async () => {
    const { service } = makeService();

    await expect(
      service.listWorkspaces({ project_id: "999999" }),
    ).resolves.toStrictEqual([]);
  });

  it("a non-numeric project id raises ConfigError (me.py:833-840)", async () => {
    const { service } = makeService();

    await expect(
      service.listWorkspaces({ project_id: "abc" }),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});

describe("MeService.findDefaultWorkspace (test_me.py:660-682)", () => {
  it("finds the default workspace for a project", async () => {
    const { service } = makeService();

    const ws = await service.findDefaultWorkspace("3713224");

    expect(ws?.name).toBe("Default");
    expect(ws?.id).toBe(3448413);
  });

  it("returns null when no workspace is flagged default", async () => {
    const cache = inMemoryMeCache("personal");
    await cache.put(
      new MeResponse({
        user_id: 42,
        workspaces: {
          "100": new MeWorkspaceInfo({
            id: 100,
            name: "NonDefault",
            project_id: 555,
            is_default: false,
          }),
        },
      }),
    );
    const { service } = makeService({ cache });

    await expect(service.findDefaultWorkspace("555")).resolves.toBeNull();
  });
});

describe("MeService.resolveWorkspace (me.py:869-915) — the dagger path", () => {
  it("returns null on a cold cache WITHOUT calling the API", async () => {
    const { service, calls } = makeService();

    await expect(service.resolveWorkspace("3713224")).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("selects from the warm cache without a network call", async () => {
    const { service, calls } = makeService();
    await service.fetch();

    const resolved = await service.resolveWorkspace("3713224");

    expect(resolved).toBe(3448413);
    expect(calls).toHaveLength(1);
  });

  it("returns null for a non-numeric project id", async () => {
    const { service } = makeService();
    await service.fetch();

    await expect(service.resolveWorkspace("abc")).resolves.toBeNull();
  });

  it("returns null when the project has no views", async () => {
    const { service } = makeService();
    await service.fetch();

    await expect(service.resolveWorkspace("111")).resolves.toBeNull();
  });
});

describe("MeService cache-store seam", () => {
  it("exposes the bound account name (workspace.py:875 MeCache twin)", () => {
    const { service } = makeService();

    expect(service.cacheAccountName).toBe("personal");
  });

  it("invalidate() clears the store", async () => {
    const cache = inMemoryMeCache("personal");
    const put = vi.spyOn(cache, "put");
    const { service } = makeService({ cache });

    await service.fetch();

    expect(put).toHaveBeenCalledTimes(1);
    await cache.invalidate();
    // eslint-disable-next-line vitest/prefer-expect-resolves -- MeCacheStore.get is a MaybePromise seam; `.resolves` would throw on a synchronous store
    expect(await cache.get()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B7-A1: `TestMeServiceResolveWorkspace` (test_workspace_resolution.py
// :154) — landed here per `b7-packets.md` §3.4 (the stale B4-C1 "is
// B8" note in `client-workspace.test.ts` is corrected in that file,
// packet Caution #17). Three of the class's five cases are LITERAL
// DUPLICATES of the dagger-path section above and are cited rather
// than re-translated (R10.2): `test_no_workspaces_for_project_is_none`
// (:196) ≡ "returns null when the project has no views";
// `test_non_numeric_project_is_none` (:203) ≡ "returns null for a
// non-numeric project id"; `test_cold_cache_is_none_without_network`
// (:208) ≡ "returns null on a cold cache WITHOUT calling the API".
// ---------------------------------------------------------------------------

describe("TestMeServiceResolveWorkspace (test_workspace_resolution.py:154)", () => {
  it("picks the global view for the requested project (:175)", async () => {
    const raw: Record<string, JsonValue> = {
      user_id: 1,
      user_email: "ak@example.com",
      projects: { "4025120": { name: "demo", organization_id: 1 } },
      workspaces: {
        "1": {
          id: 1,
          name: "Console",
          project_id: 4025120,
          is_default: true,
          is_global: null,
          is_visible: null,
        },
        "2": {
          id: 2,
          name: "All Project Data",
          project_id: 4025120,
          is_default: null,
          is_global: true,
          is_visible: null,
        },
      },
    };
    const { service } = makeService({ behaviour: () => Promise.resolve(raw) });
    await service.fetch(); // warm, as the Python fixture does

    await expect(service.resolveWorkspace("4025120")).resolves.toBe(2);
  });

  it("only workspaces of the requested project are considered (:186)", async () => {
    const raw: Record<string, JsonValue> = {
      user_id: 1,
      user_email: "ak@example.com",
      projects: { "4025120": { name: "demo", organization_id: 1 } },
      workspaces: {
        "1": {
          id: 1,
          name: "All Project Data",
          project_id: 999,
          is_default: null,
          is_global: true,
          is_visible: null,
        },
        "2": {
          id: 2,
          name: "mine",
          project_id: 4025120,
          is_default: true,
          is_global: null,
          is_visible: null,
        },
      },
    };
    const { service } = makeService({ behaviour: () => Promise.resolve(raw) });
    await service.fetch();

    await expect(service.resolveWorkspace("4025120")).resolves.toBe(2);
  });
});
