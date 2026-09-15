// Layer-3 translation of `tests/unit/test_042_edge_cases.py::
// TestSessionReplaceSentinel` (:168-239) — B7-A2 packet §2.4 (B6 ledger
// `b6-packets.md:1032` inbound deferral).
//
// Mechanism substitution (header-cited per R10.2): Python's
// `Session.replace(**kwargs)` sentinel (workspace `None` clears vs
// OMITTED preserves) translates to `sessionReplace`'s key-presence
// semantics (`Object.hasOwn` — `auth/session.ts:393-424`).
import { describe, expect, it } from "vitest";

import { parseAccount } from "../../src/auth/account.js";
import {
  type Session,
  sessionReplace,
  type WorkspaceRef,
} from "../../src/auth/session.js";

/**
 * The `base_session` fixture: all three axes populated.
 *
 * @returns A fresh session value.
 */
function baseSession(): Session {
  return {
    account: parseAccount({
      type: "service_account",
      name: "team",
      region: "us",
      username: "u",
      secret: "s",
    }),
    project: { id: "3713224" },
    workspace: { id: 42 },
    headers: new Map([["X-Custom", "value"]]),
  };
}

describe("TestSessionReplaceSentinel", () => {
  it("test_workspace_none_clears", () => {
    const s2 = sessionReplace(baseSession(), { workspace: null });
    expect(s2.workspace).toBeNull();
  });

  it("test_workspace_omitted_preserves", () => {
    const base = baseSession();
    const s2 = sessionReplace(base, {});
    expect(s2.workspace).toStrictEqual(base.workspace);
  });

  it("test_headers_empty_dict_clears", () => {
    const s2 = sessionReplace(baseSession(), { headers: new Map() });
    expect([...s2.headers]).toStrictEqual([]);
  });

  it("test_headers_omitted_preserves", () => {
    const s2 = sessionReplace(baseSession(), {});
    expect([...s2.headers]).toStrictEqual([["X-Custom", "value"]]);
  });

  it("test_three_call_chain_distinguishes_clear_from_preserve", () => {
    const base = baseSession();
    const swapped: WorkspaceRef = { id: 99 };
    const sCleared = sessionReplace(base, { workspace: null });
    const sPreserved = sessionReplace(base, {});
    const sSwapped = sessionReplace(base, { workspace: swapped });
    expect(sCleared.workspace).toBeNull();
    expect(sPreserved.workspace).toStrictEqual(base.workspace);
    expect(sSwapped.workspace).not.toBeNull();
    expect(sSwapped.workspace?.id).toBe(99);
  });
});
