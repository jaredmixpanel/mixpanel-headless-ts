// Insertion-order guarantee of the `MeResponse` container maps: the wire
// path parses organizations/workspaces into an order-preserving
// `ReadonlyMap`, so `defaultAccountName`'s first-org pick and
// `MeService.resolveWorkspace`'s tie-break match Python dict order even
// when `/me` lists ids out of ascending order. TS additions; no Python twin.

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
 * normalization, then `MeResponse.fromDict` — the same construction
 * `services/me.ts` and `accounts-ops.ts` perform.
 *
 * @param body - The raw `/me` JSON body text.
 * @returns The parsed response.
 */
function meFromWireText(body: string): MeResponse {
  return MeResponse.fromDict(toNativeJson(parseLossless(body)));
}

describe("MeResponse container order follows the wire", () => {
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
    // order.
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
    expect([...me.organizations.keys()]).toStrictEqual(["9", "alpha", "3"]);
    expect(me.organizations.get("9")).toBeInstanceOf(MeOrgInfo);
    expect(me.organizations.get("9")?.name).toBe("Last Id First");
  });

  it("MeService.resolveWorkspace tie-break follows insertion order", async () => {
    // Neither workspace is global/default/"All Project Data" and both
    // are visible → the selection ladder's "first non-hidden" arm
    // returns the FIRST view in Python dict order (`me.py`),
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
    await expect(svc.resolveWorkspace("1")).resolves.toBe(902);
    expect(
      [...(await svc.peek())!.workspaces.values()].map((ws) => ws.id),
    ).toStrictEqual([902, 450]);
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
    expect(dumped["organizations"]).toStrictEqual({
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
