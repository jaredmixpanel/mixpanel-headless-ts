// Workspace-facade scoping (B5-S2, packet §3 last table row): the home
// the B4-C1 header exclusion routed `tests/unit/test_query_workspace_
// scoping.py`'s facade classes to (`b4-packets.md:437`).
//
// OUTBOUND DEFERRALS TO B6-W1 (both header-cited, per packet §8):
//
// - `TestWorkspaceFacadeScoping` :379 — its single case is
//   `ws.use(workspace=4242)` followed by `ws.events()`. `Workspace.use()`
//   is a B6-W1 stub in TS (it throws `UNPORTED_MEMBER`), so the case
//   cannot run at B5. The packet routed the CLASS here on the assumption
//   that the facade half was `use()`-free; it is not. **B6-W1 must
//   translate it into this file.**
// - `TestDiscoveryCacheAcrossUse` :401 — the packet already defers this
//   one to B6-W1 for the same reason (`Workspace.use()` discards
//   `self._discovery`).
//
// The client-side classes of that Python file (:128-:324) were
// translated at B4-C1.
//
// What IS lockable at B5 is the other half of the same invariant: a
// workspace pinned on the SESSION scopes the facade's discovery call.
// That is an ADDITIVE lock (no Python twin — Python's fixture reaches it
// only through `use()`), and it is what makes the B6-W1 case a
// one-line delta.

import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
import {
  createMockClient,
  makeSession,
  type CannedResponse,
} from "../client/client-test-helpers.js";

describe("workspace facade scoping (session-pinned half)", () => {
  it("a session-pinned workspace scopes ws.events()", async () => {
    const canned: CannedResponse = { status: 200, json: ["Login"] };
    const { client, transport } = createMockClient(
      makeSession({ workspaceId: 4242 }),
      () => canned,
    );
    const ws = new Workspace({ session: makeSession({ workspaceId: 4242 }), client });

    await ws.events();

    expect(transport.captures.length).toBe(1);
    expect(transport.captures[0]!.params["workspace_id"]).toBe("4242");
  });

  it("an unpinned session sends no workspace_id on ws.events()", async () => {
    const canned: CannedResponse = { status: 200, json: ["Login"] };
    const { client, transport } = createMockClient(makeSession(), () => canned);
    const ws = new Workspace({ session: makeSession(), client });

    await ws.events();

    expect(transport.captures.length).toBe(1);
    expect(Object.hasOwn(transport.captures[0]!.params, "workspace_id")).toBe(
      false,
    );
  });
});
