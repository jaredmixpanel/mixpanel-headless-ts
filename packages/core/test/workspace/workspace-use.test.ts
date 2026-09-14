// Layer-3 translation of `tests/unit/test_workspace_use.py` — the
// B6-W1 classes (`TestUseWorkspace` :56, `TestUseProject` :72,
// `TestHTTPTransportPreservation` :132, `TestTargetMutualExclusion`
// :169, `TestUseUpdatesSessionAndClearsCaches` :255) plus the B7-A1
// de-deferred classes (`b7-packets.md` §3.4 / Caution #18 — this
// header now lists ZERO B7 deferrals): `TestUseAccount` (:89),
// `TestPersist` (:190), `TestUseAccountEnvVarPriority` (:221),
// `TestUseTargetEnvOverride` (:346),
// `TestUseAccountWorkspaceEnvValidation` (:384), and the four
// previously seam-stubbed cases inside the W1 classes
// (`test_target_alone_applies_three_axes` :176,
// `test_use_target_also_clears_caches` :301,
// `test_use_account_updates_me_cache_account_name` :311,
// `test_use_target_updates_me_cache_account_name` :333) — all driven
// through the REAL `resolverSeamsFromEffects` over the in-memory
// effect fakes (the tmp-config fixture re-expression, §3.4 header
// rule). The W1 seam-residue locks below are kept as-is.
//
// Construction in the W1 sections uses the session-bypass constructor;
// the B7 sections construct through the resolver axes where Python
// does (`Workspace(account="team", project="3713224")`).

import { describe, expect, it, vi } from "vitest";
import { Workspace, type ResolverSeams } from "../../src/workspace.js";
import {
  createMockClient,
  makeSession,
  type CannedResponse,
} from "../../test-support/client-test-helpers.js";
import type { Account } from "../../src/auth/account.js";
import type { Session } from "../../src/auth/session.js";
import { Secret } from "../../src/secret.js";
import { MixpanelHeadlessError, ConfigError } from "../../src/errors.js";
import { createAccountsNamespace } from "../../src/accounts/namespace.js";
import { createTargetsNamespace } from "../../src/accounts/targets-namespace.js";
import {
  persistActiveToConfig,
  resolverSeamsFromEffects,
  resolverSourcesFromEffects,
} from "../../src/accounts/resolver-seams.js";
import {
  makeEffects,
  setEnv,
  type EffectsBundle,
} from "../accounts/fake-auth-effects.js";

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
    // Python compares `id(client._http)` — the INNER pool. The TS twin
    // is the pool token `httpHandle()` (B6-ARB fidelity F3), asserted
    // through the facade path alongside the wrapper identity.
    const poolBefore = ws.client.httpHandle();

    await ws.use({ workspace: 42 });

    expect(ws.client).toBe(before);
    expect(ws.client).toBe(client);
    expect(ws.client.httpHandle()).toBe(poolBefore);
  });

  it("a project switch does NOT recreate the client", async () => {
    const { ws } = makeWorkspace();
    const before = ws.client;
    const poolBefore = ws.client.httpHandle();

    await ws.use({ project: "9999999" });

    expect(ws.client).toBe(before);
    expect(ws.client.httpHandle()).toBe(poolBefore);
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
    const poolBefore = ws.client.httpHandle();

    await ws.use({ account: "other" });

    expect(ws.client).toBe(before);
    expect(ws.client.httpHandle()).toBe(poolBefore);
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

// ---------------------------------------------------------------------------
// B7-A1: the de-deferred resolver classes over REAL seams
// (`b7-packets.md` §3.4).
// ---------------------------------------------------------------------------

/** The `two_accounts` fixture (`test_workspace_use.py:32-53`). */
async function twoAccountsBundle(): Promise<EffectsBundle> {
  const bundle = makeEffects();
  const accounts = createAccountsNamespace(bundle.effects);
  await accounts.add("team", {
    type: "service_account",
    region: "us",
    default_project: "3713224",
    username: "team.sa",
    secret: new Secret("team-secret"),
  });
  await accounts.add("other", {
    type: "service_account",
    region: "eu",
    default_project: "3713224",
    username: "other.sa",
    secret: new Secret("other-secret"),
  });
  bundle.config.setActive({ account: "team" });
  return bundle;
}

/**
 * Build `Workspace(account="team", project="3713224")` over the real
 * seams + a mock client (no request expected).
 */
function realSeamWorkspace(
  bundle: EffectsBundle,
  options: { project?: string } = {},
): Workspace {
  const canned: CannedResponse = { status: 200, json: [] };
  const { client } = createMockClient(TEAM_SESSION, () => canned);
  return new Workspace({
    account: "team",
    project: options.project ?? "3713224",
    sources: resolverSourcesFromEffects(bundle.effects),
    client,
    seams: {
      ...resolverSeamsFromEffects(bundle.effects),
      // Python `_persist_active` routing over the fake config
      // (`workspace.py:695-722` — the B8-owned effect member is wired
      // to `persistActiveToConfig` here).
      persistActive: (session) => persistActiveToConfig(bundle.config, session),
    },
  });
}

describe("TestUseAccount (test_workspace_use.py:89) — real seams", () => {
  it("use({account}) swaps to the new account", async () => {
    const bundle = await twoAccountsBundle();
    const ws = realSeamWorkspace(bundle);

    await ws.use({ account: "other" });

    expect(ws.account.name).toBe("other");
  });

  it("account swap re-resolves project from the NEW account (FR-033)", async () => {
    const bundle = await twoAccountsBundle();
    const ws = realSeamWorkspace(bundle, { project: "3018488" });

    await ws.use({ account: "other" });

    // `other.default_project` was seeded as "3713224" by the fixture.
    expect(ws.project.id).toBe("3713224");
  });

  it("account swap to an account with no default_project raises ConfigError", async () => {
    const bundle = await twoAccountsBundle();
    const accounts = createAccountsNamespace(bundle.effects);
    await accounts.add("browser_only", { type: "oauth_browser", region: "us" });
    const ws = realSeamWorkspace(bundle, { project: "3018488" });

    await ws.use({ account: "browser_only" }).then(
      () => {
        throw new Error("expected ConfigError");
      },
      (exc: unknown) => {
        expect(exc).toBeInstanceOf(ConfigError);
      },
    );
  });
});

describe("TestPersist (test_workspace_use.py:190) — real seams", () => {
  it("use({account, persist: true}) writes to [active]", async () => {
    const bundle = await twoAccountsBundle();
    const ws = realSeamWorkspace(bundle);

    await ws.use({ account: "other", persist: true });

    expect(bundle.config.getActive().account).toBe("other");
  });

  it("persist with a cleared workspace drops [active].workspace", async () => {
    const bundle = await twoAccountsBundle();
    bundle.config.setActive({ workspace: 42 });
    expect(bundle.config.getActive().workspace).toBe(42);
    const ws = realSeamWorkspace(bundle);

    // Account swap clears the in-session workspace per FR-033.
    await ws.use({ account: "other", persist: true });

    expect(ws.workspace).toBeNull();
    expect(bundle.config.getActive().workspace ?? null).toBeNull();
  });
});

describe("TestUseAccountEnvVarPriority (test_workspace_use.py:221) — real seams", () => {
  it("MP_PROJECT_ID overrides the new account's default_project", async () => {
    const bundle = await twoAccountsBundle();
    const ws = realSeamWorkspace(bundle);
    setEnv(bundle, "MP_PROJECT_ID", "5555555");

    await ws.use({ account: "other" });

    expect(ws.account.name).toBe("other");
    expect(ws.project.id).toBe("5555555");
  });

  it("MP_WORKSPACE_ID is applied on account swap when set", async () => {
    const bundle = await twoAccountsBundle();
    const ws = realSeamWorkspace(bundle);
    setEnv(bundle, "MP_WORKSPACE_ID", "987");

    await ws.use({ account: "other" });

    expect(ws.workspace).not.toBeNull();
    expect(ws.workspace?.id).toBe(987);
  });
});

describe("TestUseTargetEnvOverride (test_workspace_use.py:346) — real seams", () => {
  it("MP_PROJECT_ID beats the target's project (FR-017)", async () => {
    const bundle = await twoAccountsBundle();
    const targets = createTargetsNamespace(bundle.effects);
    targets.add("ecom", {
      account: "other",
      project: "3018488",
      workspace: 42,
    });
    const ws = realSeamWorkspace(bundle);
    setEnv(bundle, "MP_PROJECT_ID", "5555555");

    await ws.use({ target: "ecom" });

    expect(ws.project.id).toBe("5555555");
    // Account / workspace still come from the target.
    expect(ws.account.name).toBe("other");
    expect(ws.workspace).not.toBeNull();
    expect(ws.workspace?.id).toBe(42);
  });

  it("MP_WORKSPACE_ID overrides the target's workspace", async () => {
    const bundle = await twoAccountsBundle();
    const targets = createTargetsNamespace(bundle.effects);
    targets.add("ecom", {
      account: "other",
      project: "3018488",
      workspace: 42,
    });
    const ws = realSeamWorkspace(bundle);
    setEnv(bundle, "MP_WORKSPACE_ID", "987");

    await ws.use({ target: "ecom" });

    expect(ws.workspace).not.toBeNull();
    expect(ws.workspace?.id).toBe(987);
  });
});

describe("TestUseAccountWorkspaceEnvValidation (test_workspace_use.py:384) — real seams", () => {
  it("MP_WORKSPACE_ID=-1 raises on account swap, not a silent clear", async () => {
    const bundle = await twoAccountsBundle();
    const ws = realSeamWorkspace(bundle);
    setEnv(bundle, "MP_WORKSPACE_ID", "-1");

    await ws.use({ account: "other" }).then(
      () => {
        throw new Error("expected ConfigError");
      },
      (exc: unknown) => {
        expect(exc).toBeInstanceOf(ConfigError);
        expect((exc as ConfigError).message).toContain("MP_WORKSPACE_ID");
      },
    );
  });

  it("MP_WORKSPACE_ID=abc raises on account swap", async () => {
    const bundle = await twoAccountsBundle();
    const ws = realSeamWorkspace(bundle);
    setEnv(bundle, "MP_WORKSPACE_ID", "abc");

    await ws.use({ account: "other" }).then(
      () => {
        throw new Error("expected ConfigError");
      },
      (exc: unknown) => {
        expect(exc).toBeInstanceOf(ConfigError);
        expect((exc as ConfigError).message).toContain("MP_WORKSPACE_ID");
      },
    );
  });
});

describe("B7 de-deferred W1-class cases — real seams", () => {
  it("use({target}) alone applies all three axes (:176)", async () => {
    const bundle = await twoAccountsBundle();
    const targets = createTargetsNamespace(bundle.effects);
    targets.add("ecom", {
      account: "other",
      project: "3018488",
      workspace: 42,
    });
    const ws = realSeamWorkspace(bundle);

    await ws.use({ target: "ecom" });

    expect(ws.account.name).toBe("other");
    expect(ws.project.id).toBe("3018488");
    expect(ws.workspace).not.toBeNull();
    expect(ws.workspace?.id).toBe(42);
  });

  it("the target= branch of use() also clears caches (:301)", async () => {
    const bundle = await twoAccountsBundle();
    const targets = createTargetsNamespace(bundle.effects);
    targets.add("ecom", {
      account: "other",
      project: "3018488",
      workspace: 42,
    });
    const ws = realSeamWorkspace(bundle);
    const discovery = ws.discoveryService;

    await ws.use({ target: "ecom" });

    expect(ws.discoveryService).not.toBe(discovery);
    expect(ws.session.project.id).toBe("3018488");
  });

  it("use({account}) retargets the MeCache at the new account (:311)", async () => {
    const bundle = await twoAccountsBundle();
    const ws = realSeamWorkspace(bundle);
    expect(ws.meService.cacheAccountName).toBe("team");

    await ws.use({ account: "other" });

    expect(ws.meService.cacheAccountName).toBe("other");
  });

  it("use({target}) also retargets the MeCache (:333)", async () => {
    const bundle = await twoAccountsBundle();
    const targets = createTargetsNamespace(bundle.effects);
    targets.add("ecom", {
      account: "other",
      project: "3018488",
      workspace: 42,
    });
    const ws = realSeamWorkspace(bundle);
    expect(ws.meService.cacheAccountName).toBe("team");

    await ws.use({ target: "ecom" });

    expect(ws.meService.cacheAccountName).toBe("other");
  });
});
