// B6-W1 Layer-3 translation of `tests/unit/test_workspace_use.py` — the
// classes the packet assigns to W1 (`b6-packets.md` §3 table):
// `TestUseWorkspace` (:56), `TestUseProject` (:72),
// `TestHTTPTransportPreservation` (:132), `TestTargetMutualExclusion`
// (:169), `TestUseUpdatesSessionAndClearsCaches` (:255).
//
// DEFERRED (header-cited, per the same table): `TestUseAccount` (:89),
// `TestPersist` (:190), `TestUseAccountEnvVarPriority` (:221),
// `TestUseTargetEnvOverride` (:346),
// `TestUseAccountWorkspaceEnvValidation` (:384) → B7. All five drive the
// `account=` / `target=` / `persist=` branches through config, bridge
// and env resolution, i.e. through the W1-D1 `ResolverSeams` whose
// DEFAULT implementations throw `UNPORTED_RESOLVER_SEAM` here. Their W1
// residue — that each seam is consulted at the right point, with the
// right argument, and that the guard fires BEFORE any of them — is
// locked below.
//
// Two cases inside the classes W1 owns are also seam-bound and deferred
// with them: `TestTargetMutualExclusion::test_target_alone_applies_
// three_axes` (:176) and `TestUseUpdatesSessionAndClearsCaches::
// {test_use_target_also_clears_caches (:301),
// test_use_account_updates_me_cache_account_name (:311),
// test_use_target_updates_me_cache_account_name (:333)}`. The account-
// name bookkeeping those last two pin IS locked here through the seam
// (a stub `getAccount` returning the new account).
//
// Construction: Python's fixtures build `Workspace(account="team",
// project="3713224")` — the B7 resolver constructor. The translation
// uses the session-bypass constructor (`Workspace(session=…)`,
// `test_workspace_init.py:115`), which the Python suite treats as
// equivalent for the (account, project, workspace) triple
// (`TestSessionBypass::test_session_use_chain_equivalence` :130).

import { describe, expect, it, vi } from "vitest";
import { Workspace, type ResolverSeams } from "../../src/workspace.js";
import {
  createMockClient,
  makeSession,
  type CannedResponse,
} from "../client/client-test-helpers.js";
import type { Account } from "../../src/auth/account.js";
import type { Session } from "../../src/auth/session.js";
import { Secret } from "../../src/secret.js";
import { MixpanelHeadlessError, ConfigError } from "../../src/errors.js";

/** The `team` account of the `two_accounts` fixture (:33-54). */
const TEAM_SESSION: Session = makeSession({
  name: "team",
  region: "us",
  projectId: "3713224",
  username: "team.sa",
  secret: "team-secret",
});

/** The `other` account of the same fixture (eu region). */
const OTHER_ACCOUNT: Account = {
  type: "service_account",
  name: "other",
  region: "eu",
  username: "other.sa",
  secret: new Secret("other-secret"),
  default_project: "3713224",
};

/**
 * Build a facade over a mock client (no request is expected).
 *
 * @param seams - Optional resolver-seam overrides (B7's surface).
 * @returns The facade plus the client it is bound to.
 */
function makeWorkspace(seams?: Partial<ResolverSeams>): {
  ws: Workspace;
  client: ReturnType<typeof createMockClient>["client"];
} {
  const canned: CannedResponse = { status: 200, json: [] };
  const { client } = createMockClient(TEAM_SESSION, () => canned);
  const ws = new Workspace({
    session: TEAM_SESSION,
    client,
    ...(seams !== undefined ? { seams } : {}),
  });
  return { ws, client };
}

describe("TestUseWorkspace (test_workspace_use.py:56)", () => {
  it("use({workspace: N}) updates ws.workspace.id", async () => {
    const { ws } = makeWorkspace();

    await ws.use({ workspace: 42 });

    expect(ws.workspace).not.toBeNull();
    expect(ws.workspace?.id).toBe(42);
  });

  it("use() returns self for fluent chaining", async () => {
    const { ws } = makeWorkspace();

    expect(await ws.use({ workspace: 42 })).toBe(ws);
  });
});

describe("TestUseProject (test_workspace_use.py:72)", () => {
  it("use({project: P}) updates ws.project.id", async () => {
    const { ws } = makeWorkspace();

    await ws.use({ project: "9999999" });

    expect(ws.project.id).toBe("9999999");
  });

  it("use({project: P}) preserves the account", async () => {
    const { ws } = makeWorkspace();
    const before = ws.account;

    await ws.use({ project: "9999999" });

    expect(ws.account).toEqual(before);
  });
});

describe("TestHTTPTransportPreservation (test_workspace_use.py:132) — R6.2", () => {
  it("a workspace switch does NOT recreate the client", async () => {
    const { ws, client } = makeWorkspace();
    const before = ws.client;

    await ws.use({ workspace: 42 });

    // Python compares `id(client._http)`; the TS invariant is the
    // client instance identity (the pool lives inside it).
    expect(ws.client).toBe(before);
    expect(ws.client).toBe(client);
  });

  it("a project switch does NOT recreate the client", async () => {
    const { ws } = makeWorkspace();
    const before = ws.client;

    await ws.use({ project: "9999999" });

    expect(ws.client).toBe(before);
  });

  it("an account switch does NOT recreate the client", async () => {
    const getAccount = vi.fn().mockResolvedValue(OTHER_ACCOUNT);
    const resolveProjectAxis = vi.fn().mockResolvedValue("3713224");
    const envWorkspaceId = vi.fn().mockReturnValue(null);
    const { ws } = makeWorkspace({
      getAccount,
      resolveProjectAxis,
      envWorkspaceId,
    });
    const before = ws.client;

    await ws.use({ account: "other" });

    expect(ws.client).toBe(before);
    expect(ws.account.name).toBe("other");
  });
});

describe("TestTargetMutualExclusion (test_workspace_use.py:169)", () => {
  it("use({target, account}) raises before any resolution work", async () => {
    const resolveSession = vi.fn();
    const getAccount = vi.fn();
    const { ws } = makeWorkspace({ resolveSession, getAccount });

    await expect(
      ws.use({ target: "ecom", account: "other" }),
    ).rejects.toBeInstanceOf(Error);
    // Guard order (packet §14 Caution 4): NOTHING resolved.
    expect(resolveSession).not.toHaveBeenCalled();
    expect(getAccount).not.toHaveBeenCalled();
  });

  it("use({target}) alone routes through the resolveSession seam", async () => {
    // W1 residue of `test_target_alone_applies_three_axes` (:176): the
    // three axes come from the resolved session; B7 owns the resolution
    // itself (target file I/O + env precedence).
    const resolved: Session = {
      account: OTHER_ACCOUNT,
      project: { id: "3018488" },
      workspace: { id: 42 },
      headers: new Map<string, string>(),
    };
    const resolveSession = vi.fn().mockResolvedValue(resolved);
    const { ws } = makeWorkspace({ resolveSession });

    await ws.use({ target: "ecom" });

    expect(resolveSession).toHaveBeenCalledWith({ target: "ecom" });
    expect(ws.account.name).toBe("other");
    expect(ws.project.id).toBe("3018488");
    expect(ws.workspace?.id).toBe(42);
  });
});

describe("TestUseUpdatesSessionAndClearsCaches (test_workspace_use.py:255)", () => {
  it("after use({project: X}), session.project.id is X", async () => {
    const { ws } = makeWorkspace();
    expect(ws.session.project.id).toBe("3713224");

    await ws.use({ project: "9999999" });

    expect(ws.session.project.id).toBe("9999999");
  });

  it("after use({account: B}), the bound session reflects B's region", async () => {
    const { ws } = makeWorkspace({
      getAccount: vi.fn().mockResolvedValue(OTHER_ACCOUNT),
      resolveProjectAxis: vi.fn().mockResolvedValue("3713224"),
      envWorkspaceId: vi.fn().mockReturnValue(null),
    });

    await ws.use({ account: "other" });

    expect(ws.session.account.region).toBe("eu");
  });

  it("use() resets the discovery / live-query / me-service caches", async () => {
    const { ws } = makeWorkspace();
    // Force-create the cached services.
    const discovery = ws.discoveryService;
    const liveQuery = ws.liveQueryService;
    const meService = ws.meService;

    await ws.use({ project: "9999999" });

    // All three MUST be rebuilt against the new session.
    expect(ws.discoveryService).not.toBe(discovery);
    expect(ws.liveQueryService).not.toBe(liveQuery);
    expect(ws.meService).not.toBe(meService);
  });

  it("use({account: B}) retargets the MeCache at B's storage dir", async () => {
    const { ws } = makeWorkspace({
      getAccount: vi.fn().mockResolvedValue(OTHER_ACCOUNT),
      resolveProjectAxis: vi.fn().mockResolvedValue("3713224"),
      envWorkspaceId: vi.fn().mockReturnValue(null),
    });
    expect(ws.meService.cacheAccountName).toBe("team");

    await ws.use({ account: "other" });

    expect(ws.meService.cacheAccountName).toBe("other");
  });
});

describe("W1-D1 resolver seams (outbound deferral to B7)", () => {
  it("the default resolveSession seam throws UNPORTED_RESOLVER_SEAM", async () => {
    const { ws } = makeWorkspace();
    await expect(ws.use({ target: "ecom" })).rejects.toMatchObject({
      code: "UNPORTED_RESOLVER_SEAM",
    });
  });

  it("the default getAccount seam throws UNPORTED_RESOLVER_SEAM", async () => {
    const { ws } = makeWorkspace();
    await expect(ws.use({ account: "other" })).rejects.toMatchObject({
      code: "UNPORTED_RESOLVER_SEAM",
    });
  });

  it("the default resolveProjectAxis seam throws UNPORTED_RESOLVER_SEAM", async () => {
    const { ws } = makeWorkspace({
      getAccount: vi.fn().mockResolvedValue(OTHER_ACCOUNT),
    });
    await expect(ws.use({ account: "other" })).rejects.toMatchObject({
      code: "UNPORTED_RESOLVER_SEAM",
    });
  });

  it("the default envWorkspaceId seam throws UNPORTED_RESOLVER_SEAM", async () => {
    const { ws } = makeWorkspace({
      getAccount: vi.fn().mockResolvedValue(OTHER_ACCOUNT),
      resolveProjectAxis: vi.fn().mockResolvedValue("3713224"),
    });
    await expect(ws.use({ account: "other" })).rejects.toMatchObject({
      code: "UNPORTED_RESOLVER_SEAM",
    });
  });

  it("the default persistActive seam throws UNPORTED_RESOLVER_SEAM", async () => {
    const { ws } = makeWorkspace();
    await expect(
      ws.use({ project: "9999999", persist: true }),
    ).rejects.toMatchObject({ code: "UNPORTED_RESOLVER_SEAM" });
    // The swap itself already happened (Python persists AFTER the swap,
    // `workspace.py:691-693`).
    expect(ws.project.id).toBe("9999999");
  });

  it("every seam default is a MixpanelHeadlessError (catchable as one)", async () => {
    const { ws } = makeWorkspace();
    await expect(ws.use({ target: "t" })).rejects.toBeInstanceOf(
      MixpanelHeadlessError,
    );
  });

  it("an account swap with no resolvable project raises ConfigError", async () => {
    // `workspace.py:653-654` (`_format_no_project_error`) — FR-033: the
    // prior session's project is NEVER carried forward.
    const { ws } = makeWorkspace({
      getAccount: vi.fn().mockResolvedValue(OTHER_ACCOUNT),
      resolveProjectAxis: vi.fn().mockResolvedValue(null),
    });

    await expect(ws.use({ account: "other" })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("an explicit workspace= on an account swap skips the env seam", async () => {
    // `workspace.py:661-668`: `if workspace is not None` short-circuits
    // `_env_workspace_id()`.
    const envWorkspaceId = vi.fn().mockReturnValue(999);
    const { ws } = makeWorkspace({
      getAccount: vi.fn().mockResolvedValue(OTHER_ACCOUNT),
      resolveProjectAxis: vi.fn().mockResolvedValue("3713224"),
      envWorkspaceId,
    });

    await ws.use({ account: "other", workspace: 77 });

    expect(envWorkspaceId).not.toHaveBeenCalled();
    expect(ws.workspace?.id).toBe(77);
  });

  it("persistActive receives the post-swap session", async () => {
    const persistActive = vi.fn().mockResolvedValue(undefined);
    const { ws } = makeWorkspace({ persistActive });

    await ws.use({ project: "9999999", persist: true });

    expect(persistActive).toHaveBeenCalledTimes(1);
    expect(persistActive.mock.calls[0]?.[0]).toBe(ws.session);
  });
});
