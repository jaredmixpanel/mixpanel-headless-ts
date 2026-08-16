// B6-W1 Layer-3 translation of `tests/unit/test_workspace_init.py` — the
// two classes the packet assigns to W1 (`b6-packets.md` §3 table):
// `TestSessionBypass` (:115) and `TestReadOnlyProperties` (:151).
//
// DEFERRED (header-cited): `TestActiveResolution` (:66),
// `TestExplicitOverrides` (:76), `TestTarget` (:96) → B7 (the resolver
// constructor kwargs); `TestBridgeTokenMaterialization` (:167) → B8
// (bridge/token disk I/O).
//
// `TestSessionBypass::test_session_use_chain_equivalence` (:130) is
// SPLIT: its `Workspace().use(account=…, project=…)` half needs the B7
// resolver constructor AND the `getAccount` seam, so the assertion that
// survives at W1 is the chain half against a stubbed seam — the
// session-bypass twin is compared field-for-field.

import { describe, expect, it, vi } from "vitest";
import { Workspace } from "../../src/workspace.js";
import {
  createMockClient,
  makeSession,
} from "../client/client-test-helpers.js";
import type { Account } from "../../src/auth/account.js";
import { Secret } from "../../src/secret.js";

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
