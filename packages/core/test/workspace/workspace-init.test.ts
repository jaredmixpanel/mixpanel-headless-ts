// Layer-3 translation of `tests/unit/test_workspace_init.py`:
// B6-W1 classes `TestSessionBypass` (:115) and `TestReadOnlyProperties`
// (:151); B7-A1 classes `TestActiveResolution` (:66),
// `TestExplicitOverrides` (:76), `TestTarget` (:96) — the resolver
// constructor kwargs over injected `ResolverSources`
// (`b7-packets.md` §3.4; the Python `two_accounts` tmp-config fixture
// re-expresses over the in-memory fake config, header rule).
//
// `TestBridgeTokenMaterialization` (:167) is translated at B8-N2 in
// `packages/node/test/workspace-bridge-materialization.test.ts` (the
// constructor's bridge-token materialization side effect,
// `workspace.py:476-513`, needs node:fs — the core-purity eslint
// boundary covers core TEST files too; disclosed relocation, B8-N2
// notes). ZERO deferrals remain in this header.
//
// `TestSessionBypass::test_session_use_chain_equivalence` (:130) is
// SPLIT: the W1 chain half runs against stubbed seams below; the FULL
// `Workspace().use(account=…, project=…)` twin (resolver constructor +
// real seams) is in the B7 section at the bottom.

import { describe, expect, it, vi } from "vitest";
import { Workspace } from "../../src/workspace.js";
import {
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";
import type { Account } from "../../src/auth/account.js";
import { ParamValidationError } from "../../src/errors.js";
import { Secret } from "../../src/secret.js";
import { createAccountsNamespace } from "../../src/accounts/namespace.js";
import { createTargetsNamespace } from "../../src/accounts/targets-namespace.js";
import {
  resolverSeamsFromEffects,
  resolverSourcesFromEffects,
} from "../../src/accounts/resolver-seams.js";
import {
  makeEffects,
  type EffectsBundle,
} from "../accounts/fake-auth-effects.js";

describe("TestSessionBypass (test_workspace_init.py:115)", () => {
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

describe("TestReadOnlyProperties (test_workspace_init.py:151)", () => {
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

  it("ws.api is the escape hatch onto the bound client (workspace.py:4464)", () => {
    const session = makeSession();
    const { client } = createMockClient(session, () => ({
      status: 200,
      json: {},
    }));
    const ws = new Workspace({ session, client });

    expect(ws.api).toBe(client);
  });
});

// ---------------------------------------------------------------------------
// B7-A1: the resolver constructor (`b7-packets.md` §3.4).
// ---------------------------------------------------------------------------

/** The `two_accounts` fixture (`test_workspace_init.py:41-63`). */
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

describe("TestActiveResolution (test_workspace_init.py:66)", () => {
  it("no axes → ws.account/project come from [active]", async () => {
    const bundle = await twoAccounts();

    const ws = new Workspace({
      sources: resolverSourcesFromEffects(bundle.effects),
    });

    expect(ws.account.name).toBe("team");
    expect(ws.project.id).toBe("3713224");
  });
});

describe("TestExplicitOverrides (test_workspace_init.py:76)", () => {
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

describe("TestTarget (test_workspace_init.py:96)", () => {
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

describe("TestCodedWorkspaceGuardCodes — B7 constructor rows (test_workspace.py:969)", () => {
  // De-deferred from `workspace-facade.test.ts` (the ":969/:975/:1021 →
  // B7" header rows): all three call the CONSTRUCTOR guard, which now
  // exists (`b7-packets.md` §3.4 / Caution #18).
  it("Workspace({target, account}) raises WS1 before resolution (:969)", () => {
    let caught: unknown = null;
    try {
      // No sources on purpose: the guard must fire BEFORE the
      // resolution branch would notice they are missing.
      new Workspace({ target: "ecom", account: "team" });
    } catch (exc) {
      caught = exc;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    expect((caught as ParamValidationError).code).toBe(
      "WS1_TARGET_MUTUALLY_EXCLUSIVE",
    );
  });

  it("Workspace({target, workspace}) raises WS1 before resolution (:975)", () => {
    let caught: unknown = null;
    try {
      new Workspace({ target: "ecom", workspace: 123 });
    } catch (exc) {
      caught = exc;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    expect((caught as ParamValidationError).code).toBe(
      "WS1_TARGET_MUTUALLY_EXCLUSIVE",
    );
  });

  it("the WS1 guard stays catchable via its base classes (:1021)", () => {
    // Python catches bare ValueError; the TS ParamValidationError's
    // nearest "bare" ancestor is Error (R5 — the code is the contract).
    let caught: unknown = null;
    try {
      new Workspace({ target: "ecom", project: "99" });
    } catch (exc) {
      caught = exc;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toBeInstanceOf(ParamValidationError);
    expect((caught as ParamValidationError).code).toBe(
      "WS1_TARGET_MUTUALLY_EXCLUSIVE",
    );
  });
});

describe("TestSessionBypass::test_session_use_chain_equivalence — FULL twin (test_workspace_init.py:130)", () => {
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
