// Layer-3 translation of `tests/unit/test_naming.py` (153 lines, 13
// tests) — B7-A1 packet §3.4 (`b7-packets.md`).
//
// Mechanism substitution (header-cited per R10.2): Python's
// `MeResponse(organizations={id: MeOrgInfo(...)})` fixtures build the
// TS `MeResponse` model with nested raw records (the model coerces via
// `fieldSpecs.nested`). One extra guard (packet Caution #12): the
// post-fold ASCII invariant that makes `.slice` a safe truncation.

import { describe, expect, it } from "vitest";

import { defaultAccountName, slugify } from "../../src/accounts/naming.js";
import { MeResponse } from "../../src/client/me.js";

/** `_me_with_org` (`test_naming.py:93-97`). */
function meWithOrg(orgId: string, name: string): MeResponse {
  return new MeResponse({
    organizations: { [orgId]: { id: Number(orgId), name } },
  });
}

describe("TestSlugify (test_naming.py:24)", () => {
  const table: ReadonlyArray<readonly [string | null, string]> = [
    ["Acme Corp", "acme-corp"],
    ["ACME, Inc.", "acme-inc"],
    ["Café Industries", "cafe-industries"],
    ["  Acme  &  Sons ", "acme-sons"],
    ["1Password", "1password"],
    ["---", ""],
    ["", ""],
    [null, ""],
    ["Mixpanel 🎉 Co", "mixpanel-co"],
  ];

  it.each(table)("FR-015 table: slugify(%j) === %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("truncates to 32 chars and strips the trailing dash", () => {
    const longInput = "AAAAAAAAAA BBBBBBBBBB CCCCCCCCCC DDDDDDDDDD";
    const result = slugify(longInput);
    expect(result.length).toBeLessThanOrEqual(32);
    expect(result.endsWith("-")).toBe(false);
  });

  it("is idempotent for representative values", () => {
    for (const value of [
      "Acme Corp",
      "Café",
      "1234567890",
      "  spaces  ",
      "ünïçødé",
      "",
    ]) {
      const once = slugify(value);
      const twice = slugify(once);
      expect(twice).toBe(once);
    }
  });

  it("non-empty output satisfies ^[a-z0-9-]{1,32}$", () => {
    const pattern = /^[a-z0-9-]{1,32}$/;
    for (const value of [
      "Acme Corp",
      "ACME, Inc.",
      "Café Industries",
      "1Password",
      "Mixpanel 🎉",
    ]) {
      const result = slugify(value);
      expect(result).toMatch(pattern);
    }
  });

  it("the pre-truncation string is pure ASCII (Caution #12 invariant)", () => {
    // Locks the safety of `.slice(0, 32)`: after the ASCII fold every
    // remaining unit is a single code point, so the truncation cannot
    // split a surrogate pair.
    for (const value of ["Café 𝒳 Industries", "🎉🎉🎉", "ünïçødé-𝒳"]) {
      const result = slugify(value);
      for (const ch of result) {
        expect(ch.codePointAt(0)).toBeLessThanOrEqual(0x7f);
      }
    }
  });
});

describe("TestDefaultAccountName (test_naming.py:100)", () => {
  it("empty existing set returns the base slug unchanged", () => {
    const me = meWithOrg("100", "Acme Corp");
    expect(defaultAccountName(me, new Set())).toBe("acme-corp");
  });

  it("one collision returns -2", () => {
    const me = meWithOrg("100", "Acme Corp");
    expect(defaultAccountName(me, new Set(["acme-corp"]))).toBe("acme-corp-2");
  });

  it("two collisions return -3 (skips -1)", () => {
    const me = meWithOrg("100", "Acme Corp");
    expect(defaultAccountName(me, new Set(["acme-corp", "acme-corp-2"]))).toBe(
      "acme-corp-3",
    );
  });

  it("suffix finds the first unused (-2 and -4 taken → -3)", () => {
    const me = meWithOrg("100", "Acme Corp");
    expect(
      defaultAccountName(
        me,
        new Set(["acme-corp", "acme-corp-2", "acme-corp-4"]),
      ),
    ).toBe("acme-corp-3");
  });

  it("empty org name falls back to org-{id}", () => {
    const me = meWithOrg("100", "---");
    expect(defaultAccountName(me, new Set())).toBe("org-100");
  });

  it("org-id fallback also gets the -N suffix", () => {
    const me = meWithOrg("100", "---");
    expect(defaultAccountName(me, new Set(["org-100"]))).toBe("org-100-2");
  });

  it("empty organizations falls back to 'account'", () => {
    const me = new MeResponse({ organizations: {} });
    expect(defaultAccountName(me, new Set())).toBe("account");
  });

  it("'account' fallback also receives suffix treatment", () => {
    const me = new MeResponse({ organizations: {} });
    expect(defaultAccountName(me, new Set(["account"]))).toBe("account-2");
  });

  it("first org wins when multiple (insertion order)", () => {
    // Python asserts INSERTION order (`next(iter(...))`), which the
    // ordered `MeResponse.organizations` Map now preserves for ANY
    // key order (B8-MAPFIX, `user-ratifications.md:14-22` — the
    // former Caution #13 ascending-id caveat is closed; out-of-order
    // fixtures are locked in `naming-order.test.ts`).
    const me = new MeResponse({
      organizations: {
        "100": { id: 100, name: "Alpha" },
        "200": { id: 200, name: "Beta" },
      },
    });
    expect(defaultAccountName(me, new Set())).toBe("alpha");
  });
});
