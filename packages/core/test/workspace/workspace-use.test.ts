// Workspace.use(): workspace / project / target / account switches, HTTP
// transport preservation, target mutual exclusion, session updates and cache
// clearing, persistence and env-var precedence. Mirrors
// tests/unit/test_workspace_use.py; the seam-stubbed sections use the
// session-bypass constructor, the real-seam sections resolverSeamsFromEffects.

import { describe, expect, it, vi } from "vitest";

import { createAccountsNamespace } from "../../src/accounts/namespace.js";
import {
  persistActiveToConfig,
  resolverSeamsFromEffects,
  resolverSourcesFromEffects,
} from "../../src/accounts/resolver-seams.js";
import { createTargetsNamespace } from "../../src/accounts/targets-namespace.js";
import type { Account } from "../../src/auth/account.js";
import type { Session } from "../../src/auth/session.js";
import { ConfigError, MixpanelHeadlessError } from "../../src/errors.js";
import { Secret } from "../../src/secret.js";
import { Workspace } from "../../src/workspace.js";
import type { ResolverSeams } from "../../src/workspace-members/lifecycle.js";
import {
  type CannedResponse,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";
import {
  type EffectsBundle,
  makeEffects,
  setEnv,
} from "../accounts/fake-auth-effects.js";

/** The `team` account of the `two_accounts` fixture. */
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
 * @param seams - Optional resolver-seam overrides.
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
    ...(seams === undefined ? {} : { seams }),
  });
  return { ws, client };
}

describe("Use workspace", () => {
  // python: TestUseWorkspace
  it("use({workspace: N}) updates ws.workspace.id", async () => {
    const { ws } = makeWorkspace();

    await ws.use({ workspace: 42 });

    expect(ws.workspace).not.toBeNull();
    expect(ws.workspace?.id).toBe(42);
  });

  it("use() returns self for fluent chaining", async () => {
    const { ws } = makeWorkspace();

    await expect(ws.use({ workspace: 42 })).resolves.toBe(ws);
  });
});

describe("Use project", () => {
  // python: TestUseProject
  it("use({project: P}) updates ws.project.id", async () => {
    const { ws } = makeWorkspace();

    await ws.use({ project: "9999999" });

    expect(ws.project.id).toBe("9999999");
  });

  it("use({project: P}) preserves the account", async () => {
    const { ws } = makeWorkspace();
    const before = ws.account;

    await ws.use({ project: "9999999" });

    expect(ws.account).toStrictEqual(before);
  });
});

describe("HTTP transport preservation", () => {
  // python: TestHTTPTransportPreservation
  it("a workspace switch does NOT recreate the client", async () => {
    const { ws, client } = makeWorkspace();
    const before = ws.client;
    // Python compares `id(client._http)` — the INNER pool. The TS twin
    // is the pool token `httpHandle()`, asserted
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

describe("Target mutual exclusion", () => {
  // python: TestTargetMutualExclusion
  it("use({target, account}) raises before any resolution work", async () => {
    const resolveSession = vi.fn();
    const getAccount = vi.fn();
    const { ws } = makeWorkspace({ resolveSession, getAccount });

    await expect(
      ws.use({ target: "ecom", account: "other" }),
    ).rejects.toBeInstanceOf(Error);
    // Guard order: nothing is resolved.
    expect(resolveSession).not.toHaveBeenCalled();
    expect(getAccount).not.toHaveBeenCalled();
  });

  it("use({target}) alone routes through the resolveSession seam", async () => {
    // The three axes come from the resolved session; the resolution itself
    // (target file I/O + env precedence) is covered over real seams below.
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

describe("Use updates session and clears caches", () => {
  // python: TestUseUpdatesSessionAndClearsCaches
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

describe("resolver seams (stubbed)", () => {
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
    // `workspace.py`).
    expect(ws.project.id).toBe("9999999");
  });

  it("every seam default is a MixpanelHeadlessError (catchable as one)", async () => {
    const { ws } = makeWorkspace();
    await expect(ws.use({ target: "t" })).rejects.toBeInstanceOf(
      MixpanelHeadlessError,
    );
  });

  it("an account swap with no resolvable project raises ConfigError", async () => {
    // `workspace.py` (`_format_no_project_error`) — FR-033: the
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
    // `workspace.py`: `if workspace is not None` short-circuits
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

// --- The resolver classes over real seams ---

/** The `two_accounts` fixture. */
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
      // Python `_persist_active` routing over the fake config: the effect
      // member is wired to `persistActiveToConfig` here.
      persistActive: (session) => persistActiveToConfig(bundle.config, session),
    },
  });
}

describe("Use account — real seams", () => {
  // python: TestUseAccount
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
      (error: unknown) => {
        expect(error).toBeInstanceOf(ConfigError);
      },
    );
  });
});

describe("Persist — real seams", () => {
  // python: TestPersist
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

describe("Use account env var priority — real seams", () => {
  // python: TestUseAccountEnvVarPriority
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

describe("Use target env override — real seams", () => {
  // python: TestUseTargetEnvOverride
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

describe("Use account workspace env validation — real seams", () => {
  // python: TestUseAccountWorkspaceEnvValidation
  it("MP_WORKSPACE_ID=-1 raises on account swap, not a silent clear", async () => {
    const bundle = await twoAccountsBundle();
    const ws = realSeamWorkspace(bundle);
    setEnv(bundle, "MP_WORKSPACE_ID", "-1");

    await ws.use({ account: "other" }).then(
      () => {
        throw new Error("expected ConfigError");
      },
      (error: unknown) => {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as ConfigError).message).toContain("MP_WORKSPACE_ID");
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
      (error: unknown) => {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as ConfigError).message).toContain("MP_WORKSPACE_ID");
      },
    );
  });
});

describe("target and cache cases over real seams", () => {
  it("use({target}) alone applies all three axes", async () => {
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

  it("the target= branch of use() also clears caches", async () => {
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

  it("use({account}) retargets the MeCache at the new account", async () => {
    const bundle = await twoAccountsBundle();
    const ws = realSeamWorkspace(bundle);
    expect(ws.meService.cacheAccountName).toBe("team");

    await ws.use({ account: "other" });

    expect(ws.meService.cacheAccountName).toBe("other");
  });

  it("use({target}) also retargets the MeCache", async () => {
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
