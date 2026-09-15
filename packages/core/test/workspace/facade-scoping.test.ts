// Workspace scoping through the facade: a workspace pinned on the session
// or via `use({ workspace })` is sent as `workspace_id` on discovery calls,
// and `use()` discards the discovery cache. Mirrors the facade classes of
// `tests/unit/test_query_workspace_scoping.py` (`TestWorkspaceFacadeScoping`,
// `TestDiscoveryCacheAcrossUse`); the session-pinned half is additive.

import { describe, expect, it } from "vitest";

import { Workspace } from "../../src/workspace.js";
import {
  type CannedResponse,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

describe("Workspace facade scoping (session-pinned half, additive)", () => {
  it("a session-pinned workspace scopes ws.events()", async () => {
    const canned: CannedResponse = { status: 200, json: ["Login"] };
    const { client, transport } = createMockClient(
      makeSession({ workspaceId: 4242 }),
      () => canned,
    );
    const ws = new Workspace({
      session: makeSession({ workspaceId: 4242 }),
      client,
    });

    await ws.events();

    expect(transport.captures).toHaveLength(1);
    expect(transport.captures[0]!.params["workspace_id"]).toBe("4242");
  });

  it("an unpinned session sends no workspace_id on ws.events()", async () => {
    const canned: CannedResponse = { status: 200, json: ["Login"] };
    const { client, transport } = createMockClient(makeSession(), () => canned);
    const ws = new Workspace({ session: makeSession(), client });

    await ws.events();

    expect(transport.captures).toHaveLength(1);
    expect(Object.hasOwn(transport.captures[0]!.params, "workspace_id")).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// The Python facade classes — both reach the pin through `Workspace.use()`.
// ---------------------------------------------------------------------------

describe("Workspace facade scoping", () => {
  // python: TestWorkspaceFacadeScoping
  it("use({workspace: N}) then events() sends the pin", async () => {
    const canned: CannedResponse = { status: 200, json: ["Login"] };
    const { client, transport } = createMockClient(makeSession(), () => canned);
    const ws = new Workspace({ session: makeSession(), client });

    await ws.use({ workspace: 4242 });
    await ws.events();
    await ws.close();

    expect(transport.captures).toHaveLength(1);
    expect(transport.captures[0]!.params["workspace_id"]).toBe("4242");
  });
});

describe("Discovery cache across use", () => {
  // python: TestDiscoveryCacheAcrossUse
  it("use() discards the cached discovery results", async () => {
    const canned: CannedResponse = { status: 200, json: ["Login"] };
    const { client, transport } = createMockClient(makeSession(), () => canned);
    const ws = new Workspace({ session: makeSession(), client });

    await ws.events();
    await ws.events();
    // Cache hit: the repeat call must NOT issue a second request.
    expect(transport.captures).toHaveLength(1);

    await ws.use({ workspace: 4242 });
    await ws.events();
    await ws.close();

    // The swap discarded the cache, so a fresh request went out.
    expect(transport.captures).toHaveLength(2);
  });
});
