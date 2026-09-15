// Workspace construction: session bypass, read-only properties, the resolver
// constructor kwargs (active resolution, explicit overrides, target) over
// injected ResolverSources, and the constructor-side workspace-guard codes.
// Mirrors tests/unit/test_workspace_init.py over an in-memory fake config;
// TestBridgeTokenMaterialization needs node:fs and lives in packages/node/test.

import { describe, expect, it, vi } from "vitest";

import { createAccountsNamespace } from "../../src/accounts/namespace.js";
import {
  resolverSeamsFromEffects,
  resolverSourcesFromEffects,
} from "../../src/accounts/resolver-seams.js";
import { createTargetsNamespace } from "../../src/accounts/targets-namespace.js";
import type { Account } from "../../src/auth/account.js";
import { ParamValidationError } from "../../src/errors.js";
import { Secret } from "../../src/secret.js";
import { Workspace } from "../../src/workspace.js";
import {
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";
import {
  type EffectsBundle,
  makeEffects,
} from "../accounts/fake-auth-effects.js";

describe("Session bypass", () => {
  // python: TestSessionBypass
  it("a pre-built Session is used as-is, ignoring config", () => {
    const account: Account = {
      type: "service_account",
      name: "custom",
      region: "in",
      username: "bypass",
      secret: new Secret("bs"),
    };
    const session = {
      account,
      project: { id: "11111" },
      workspace: null,
      headers: new Map<string, string>(),
    };
    const { client } = createMockClient(session, () => ({
      status: 200,
      json: {},
    }));

    const ws = new Workspace({ session, client });

    expect(ws.account.name).toBe("custom");
    expect(ws.project.id).toBe("11111");
  });

  it("use(...) reaches the same axes as the session= bypass (SC-010)", () => {
    const teamAccount: Account = {
      type: "service_account",
      name: "team",
      region: "us",
      username: "u",
      secret: new Secret("s"),
    };
    const sessionTwin = {
      account: teamAccount,
      project: { id: "3713224" },
      workspace: null,
      headers: new Map<string, string>(),
    };
    const { client } = createMockClient(sessionTwin, () => ({
      status: 200,
      json: {},
    }));
    const wsSession = new Workspace({ session: sessionTwin, client });

    const { client: chainClient } = createMockClient(
      makeSession({ name: "team", projectId: "1" }),
      () => ({ status: 200, json: {} }),
    );
    const wsChain = new Workspace({
      session: makeSession({ name: "team", projectId: "1" }),
      client: chainClient,
      seams: {
        getAccount: vi.fn().mockResolvedValue(teamAccount),
        resolveProjectAxis: vi.fn().mockResolvedValue("3713224"),
        envWorkspaceId: vi.fn().mockReturnValue(null),
      },
    });

    return wsChain.use({ account: "team" }).then(() => {
      expect(wsChain.account.name).toBe(wsSession.account.name);
      expect(wsChain.project.id).toBe(wsSession.project.id);
    });
  });
});

describe("Read only properties", () => {
  // python: TestReadOnlyProperties
  it("assignment to ws.account throws (getter with no setter)", () => {
    const session = makeSession();
    const { client } = createMockClient(session, () => ({
      status: 200,
      json: {},
    }));
    const ws = new Workspace({ session, client });

    expect(() => {
      (ws as unknown as { account: unknown }).account = ws.account;
    }).toThrow(TypeError);
  });

  it("assignment to ws.project throws (getter with no setter)", () => {
    const session = makeSession();
    const { client } = createMockClient(session, () => ({
      status: 200,
      json: {},
    }));
    const ws = new Workspace({ session, client });

    expect(() => {
      (ws as unknown as { project: unknown }).project = ws.project;
    }).toThrow(TypeError);
  });

  it("ws.session / ws.workspace mirror the bound session", () => {
    const session = makeSession({ workspaceId: 4242 });
    const { client } = createMockClient(session, () => ({
      status: 200,
      json: {},
    }));
    const ws = new Workspace({ session, client });

    expect(ws.session).toBe(session);
    expect(ws.workspace?.id).toBe(4242);
  });

  it("ws.api is the escape hatch onto the bound client", () => {
    const session = makeSession();
    const { client } = createMockClient(session, () => ({
      status: 200,
      json: {},
    }));
    const ws = new Workspace({ session, client });

    expect(ws.api).toBe(client);
  });
});

// --- The resolver constructor ---

/** The `two_accounts` fixture. */
async function twoAccounts(): Promise<EffectsBundle> {
  const bundle = makeEffects();
  const accounts = createAccountsNamespace(bundle.effects);
  await accounts.add("team", {
    type: "service_account",
    region: "us",
    default_project: "3713224",
    username: "u",
    secret: new Secret("s"),
  });
  await accounts.add("other", {
    type: "service_account",
    region: "eu",
    default_project: "3713224",
    username: "u2",
    secret: new Secret("s2"),
  });
  bundle.config.setActive({ account: "team" });
  return bundle;
}

describe("Active resolution", () => {
  // python: TestActiveResolution
  it("no axes → ws.account/project come from [active]", async () => {
    const bundle = await twoAccounts();

    const ws = new Workspace({
      sources: resolverSourcesFromEffects(bundle.effects),
    });

    expect(ws.account.name).toBe("team");
    expect(ws.project.id).toBe("3713224");
  });
});

describe("Explicit overrides", () => {
  // python: TestExplicitOverrides
  it("Workspace({account: 'other'}) switches account", async () => {
    const bundle = await twoAccounts();

    const ws = new Workspace({
      account: "other",
      sources: resolverSourcesFromEffects(bundle.effects),
    });

    expect(ws.account.name).toBe("other");
  });

  it("Workspace({project: ID}) switches project", async () => {
    const bundle = await twoAccounts();

    const ws = new Workspace({
      project: "9999999",
      sources: resolverSourcesFromEffects(bundle.effects),
    });

    expect(ws.project.id).toBe("9999999");
  });

  it("both kwargs together switch both axes", async () => {
    const bundle = await twoAccounts();

    const ws = new Workspace({
      account: "other",
      project: "9999999",
      sources: resolverSourcesFromEffects(bundle.effects),
    });

    expect(ws.account.name).toBe("other");
    expect(ws.project.id).toBe("9999999");
  });
});

describe("Target", () => {
  // python: TestTarget
  it("Workspace({target}) applies the target's three axes", async () => {
    const bundle = await twoAccounts();
    const targets = createTargetsNamespace(bundle.effects);
    targets.add("ecom", {
      account: "other",
      project: "3018488",
      workspace: 42,
    });

    const ws = new Workspace({
      target: "ecom",
      sources: resolverSourcesFromEffects(bundle.effects),
    });

    expect(ws.account.name).toBe("other");
    expect(ws.project.id).toBe("3018488");
    expect(ws.workspace).not.toBeNull();
    expect(ws.workspace?.id).toBe(42);
  });

  it("target= combined with any axis kwarg raises the WS1 guard", async () => {
    const bundle = await twoAccounts();
    const targets = createTargetsNamespace(bundle.effects);
    targets.add("ecom", { account: "other", project: "3018488" });

    expect(
      () =>
        new Workspace({
          target: "ecom",
          account: "team",
          sources: resolverSourcesFromEffects(bundle.effects),
        }),
    ).toThrow(ParamValidationError);
  });
});

describe("Coded workspace guard codes — constructor guards", () => {
  // python: TestCodedWorkspaceGuardCodes
  // All three cases exercise the constructor guard; the `use()` twins live
  // in workspace-facade.test.ts.
  it("Workspace({target, account}) raises WS1 before resolution", () => {
    let caught: unknown = null;
    try {
      // No sources on purpose: the guard must fire BEFORE the
      // resolution branch would notice they are missing.
      new Workspace({ target: "ecom", account: "team" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    expect((caught as ParamValidationError).code).toBe(
      "WS1_TARGET_MUTUALLY_EXCLUSIVE",
    );
  });

  it("Workspace({target, workspace}) raises WS1 before resolution", () => {
    let caught: unknown = null;
    try {
      new Workspace({ target: "ecom", workspace: 123 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    expect((caught as ParamValidationError).code).toBe(
      "WS1_TARGET_MUTUALLY_EXCLUSIVE",
    );
  });

  it("the WS1 guard stays catchable via its base classes", () => {
    // Python catches bare ValueError; the TS ParamValidationError's
    // nearest "bare" ancestor is Error (R5 — the code is the contract).
    let caught: unknown = null;
    try {
      new Workspace({ target: "ecom", project: "99" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toBeInstanceOf(ParamValidationError);
    expect((caught as ParamValidationError).code).toBe(
      "WS1_TARGET_MUTUALLY_EXCLUSIVE",
    );
  });
});

describe("Session bypass: session/use chain equivalence over real seams", () => {
  // python: TestSessionBypass::test_session_use_chain_equivalence
  it("Workspace().use(...) matches Workspace({session}) over real seams", async () => {
    const bundle = await twoAccounts();
    const teamAccount: Account = {
      type: "service_account",
      name: "team",
      region: "us",
      username: "u",
      secret: new Secret("s"),
    };
    const sessionTwin = {
      account: teamAccount,
      project: { id: "3713224" },
      workspace: null,
      headers: new Map<string, string>(),
    };
    const { client } = createMockClient(sessionTwin, () => ({
      status: 200,
      json: {},
    }));
    const wsSession = new Workspace({ session: sessionTwin, client });

    const wsChain = new Workspace({
      sources: resolverSourcesFromEffects(bundle.effects),
      seams: resolverSeamsFromEffects(bundle.effects),
    });
    await wsChain.use({ account: "team", project: "3713224" });

    expect(wsChain.account.name).toBe(wsSession.account.name);
    expect(wsChain.project.id).toBe(wsSession.project.id);
  });
});
