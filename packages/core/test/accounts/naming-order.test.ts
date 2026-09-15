// NEW Layer-3 lock for the user-ratified org-ordering fix
// (`context/phase3/design/user-ratifications.md:14-22`, 2026-08-16;
// executed as the early-B8 task B8-MAPFIX per `b8-packets.md` §0.3.1 /
// §2.3): `MeResponse` container maps parse into an insertion-order-
// preserving `ReadonlyMap` sourced from the lossless JSON layer, so
// `defaultAccountName`'s first-org pick matches Python dict insertion
// order EXACTLY — including when `/me` emits organizations out of
// ascending-id order. Supersedes the B7-ARB-A R2 exclusion
// (`b7-reviewA-resolution.md`; playbook Discrepancy #13).
//
// Python twins asserted against (behavior arbiter): `json.loads`
// preserves object key order; `MeResponse.organizations` is a
// `dict[str, MeOrgInfo]` (insertion-ordered); `default_account_name`
// picks `next(iter(me.organizations.items()))` (`naming.py:122-124`);
// `resolve_workspace` iterates `me.workspaces.values()` in insertion
// order (`me.py:869-915`).

import { describe, expect, it } from "vitest";

import { defaultAccountName } from "../../src/accounts/naming.js";
import { type JsonValue, toNativeJson } from "../../src/client/json-value.js";
import { parseLossless } from "../../src/client/lossless-json.js";
import { MeOrgInfo, MeResponse, MeWorkspaceInfo } from "../../src/client/me.js";
import {
  inMemoryMeCache,
  type MeClient,
  MeService,
} from "../../src/services/me.js";

/**
 * Build a MeResponse through the REAL wire path: lossless parse of the
 * body text (key order captured at the parser), `toNativeJson`
 * normalization, then `MeResponse.fromDict` — exactly the
 * `services/me.ts:283` / `accounts-ops.ts:155` construction.
 *
 * @param body - The raw `/me` JSON body text.
 * @returns The parsed response.
 */
function meFromWireText(body: string): MeResponse {
  return MeResponse.fromDict(toNativeJson(parseLossless(body) as JsonValue));
}

describe("org-ordering ratification lock (user-ratifications.md:14-22)", () => {
  it("wire path: out-of-ascending org ids pick the FIRST-LISTED org", () => {
    // Python: json.loads preserves ["200", "100"]; first pick is 200.
    const me = meFromWireText(
      `{"organizations": {` +
        `"200": {"id": 200, "name": "Beta Systems"}, ` +
        `"100": {"id": 100, "name": "Acme Corp"}}}`,
    );
    expect(defaultAccountName(me, new Set())).toBe("beta-systems");
  });

  it("wire path: integer-like key AFTER a non-integer key stays second", () => {
    // JS object literals hoist "300" before "team-x"; Python keeps
    // the source order ["team-x", "300"] — first pick is team-x.
    const me = meFromWireText(
      `{"organizations": {` +
        `"team-x": {"id": 7, "name": "Team X"}, ` +
        `"300": {"id": 300, "name": "Charlie LLC"}}}`,
    );
    expect(defaultAccountName(me, new Set())).toBe("team-x");
  });

  it("wire path: empty-slug first org falls back to org-{first key}", () => {
    // First LISTED org ("50", name "---") slugifies empty → the
    // fallback must use the FIRST-LISTED key, not the ascending-first.
    const me = meFromWireText(
      `{"organizations": {` +
        `"50": {"id": 50, "name": "---"}, ` +
        `"10": {"id": 10, "name": "Acme"}}}`,
    );
    expect(defaultAccountName(me, new Set())).toBe("org-50");
  });

  it("collision suffixes derive from the insertion-order base", () => {
    const me = meFromWireText(
      `{"organizations": {` +
        `"200": {"id": 200, "name": "Beta Systems"}, ` +
        `"100": {"id": 100, "name": "Acme Corp"}}}`,
    );
    expect(defaultAccountName(me, new Set(["beta-systems"]))).toBe(
      "beta-systems-2",
    );
  });

  it("Map-input construction preserves caller order", () => {
    // A TS caller who NEEDS out-of-ascending order passes a Map — the
    // one JS container that can hold integer-like keys in insertion
    // order (R4.8 ReadonlyMap).
    const me = new MeResponse({
      organizations: new Map([
        ["200", new MeOrgInfo({ id: 200, name: "Beta Systems" })],
        ["100", new MeOrgInfo({ id: 100, name: "Acme Corp" })],
      ]),
    });
    expect(defaultAccountName(me, new Set())).toBe("beta-systems");
  });

  it("organizations is an insertion-ordered ReadonlyMap after the wire parse", () => {
    const me = meFromWireText(
      `{"organizations": {` +
        `"9": {"id": 9, "name": "Last Id First"}, ` +
        `"alpha": {"id": 1, "name": "Alpha"}, ` +
        `"3": {"id": 3, "name": "Three"}}}`,
    );
    expect([...me.organizations.keys()]).toEqual(["9", "alpha", "3"]);
    expect(me.organizations.get("9")).toBeInstanceOf(MeOrgInfo);
    expect(me.organizations.get("9")?.name).toBe("Last Id First");
  });

  it("MeService.resolveWorkspace tie-break follows insertion order", async () => {
    // Neither workspace is global/default/"All Project Data" and both
    // are visible → the selection ladder's "first non-hidden" arm
    // returns the FIRST view in Python dict order (`me.py:377-380`),
    // which is workspace 902 here despite 450 sorting first
    // numerically.
    const body =
      `{"workspaces": {` +
      `"902": {"id": 902, "name": "Zeta", "project_id": 1}, ` +
      `"450": {"id": 450, "name": "Console", "project_id": 1}}}`;
    const client: MeClient = {
      me: () =>
        Promise.resolve(parseLossless(body) as Record<string, JsonValue>),
    };
    const svc = new MeService(client, inMemoryMeCache("personal"), "us");
    await svc.fetch();
    expect(await svc.resolveWorkspace("1")).toBe(902);
    expect(
      [...(await svc.peek())!.workspaces.values()].map((ws) => ws.id),
    ).toEqual([902, 450]);
  });

  it("workspaces entries reconstruct as MeWorkspaceInfo in a Map", () => {
    const me = meFromWireText(
      `{"workspaces": {` +
        `"902": {"id": 902, "name": "Zeta", "project_id": 1}}}`,
    );
    expect(me.workspaces.get("902")).toBeInstanceOf(MeWorkspaceInfo);
  });

  it("toJSON round-trips the container CONTENT (order via Map, not JSON)", () => {
    const me = meFromWireText(
      `{"organizations": {` +
        `"200": {"id": 200, "name": "Beta Systems"}, ` +
        `"100": {"id": 100, "name": "Acme Corp"}}}`,
    );
    const dumped = me.toJSON();
    expect(dumped["organizations"]).toEqual({
      "100": {
        id: 100,
        name: "Acme Corp",
        role: null,
        permissions: null,
      },
      "200": {
        id: 200,
        name: "Beta Systems",
        role: null,
        permissions: null,
      },
    });
  });
});
