// Layer-3 translation of `tests/pbt/test_naming_pbt.py` (154 lines, 8
// Hypothesis properties) — B7-A1 packet §3.4 (`b7-packets.md`).
//
// Strategy shapes preserved: org names from letters/digits/punctuation/
// separators up to U+017F (Latin Extended-A), 0..80 chars; org ids
// digit strings 1..10; existing sets over `[a-z0-9-]{1,64}`, ≤ 20.
// Fuzz-domain note (packet Caution #12): the alphabet is
// Latin-1/Latin-Extended by construction, matching the Python
// strategy — full-Unicode NFKD skew is disclosed in the shard notes.
// Mechanism substitution (R10.2, header-cited): Hypothesis
// `st.characters(whitelist_categories=…)` becomes an explicit
// codepoint filter over the same category set (L, N, P, Z).

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MeResponse } from "../../src/client/me.js";
import { defaultAccountName, slugify } from "../../src/accounts/naming.js";

/** Category test for the Python `whitelist_categories=("L","N","P","Z")`. */
function inCategories(cp: number): boolean {
  const ch = String.fromCodePoint(cp);
  return /[\p{L}\p{N}\p{P}\p{Z}]/u.test(ch);
}

/** The `_org_name_strategy` twin (max_codepoint=0x017F, 0..80). */
const orgNames = fc
  .array(fc.integer({ min: 0x20, max: 0x017f }).filter(inCategories), {
    minLength: 0,
    maxLength: 80,
  })
  .map((cps) => cps.map((cp) => String.fromCodePoint(cp)).join(""));

const SLUG_PATTERN = /^[a-z0-9-]{1,32}$/;

/** The `_org_id_strategy` twin (digit strings 1..10). */
const orgIds = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 10 })
  .map((digits) => digits.join(""))
  // Python `MeOrgInfo(id=int(org_id))` — avoid ids that lose the
  // round-trip through Number for 10-digit strings with leading zeros.
  .map((s) => (s.startsWith("0") ? `1${s.slice(1)}` : s));

/** The `_existing_set_strategy` twin. */
const existingSets = fc
  .array(
    fc
      .array(
        fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")),
        { minLength: 1, maxLength: 64 },
      )
      .map((chars) => chars.join("")),
    { minLength: 0, maxLength: 20 },
  )
  .map((names) => new Set(names));

/** The `me_responses()` composite twin. */
const meResponses = fc
  .tuple(fc.boolean(), orgIds, orgNames)
  .map(([hasOrg, orgId, name]) =>
    hasOrg
      ? new MeResponse({
          organizations: { [orgId]: { id: Number(orgId), name } },
        })
      : new MeResponse({ organizations: {} }),
  );

describe("naming PBT (test_naming_pbt.py)", () => {
  it("slugify is idempotent (:45)", () => {
    fc.assert(
      fc.property(orgNames, (value) => {
        const once = slugify(value);
        expect(slugify(once)).toBe(once);
      }),
      { numRuns: 100 },
    );
  });

  it("non-empty output matches ^[a-z0-9-]{1,32}$ (:53)", () => {
    fc.assert(
      fc.property(orgNames, (value) => {
        const result = slugify(value);
        if (result !== "") {
          expect(result).toMatch(SLUG_PATTERN);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("never produces leading or trailing dash (:63)", () => {
    fc.assert(
      fc.property(orgNames, (value) => {
        const result = slugify(value);
        if (result !== "") {
          expect(result.startsWith("-")).toBe(false);
          expect(result.endsWith("-")).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("no consecutive dashes (:72)", () => {
    fc.assert(
      fc.property(orgNames, (value) => {
        expect(slugify(value)).not.toContain("--");
      }),
      { numRuns: 100 },
    );
  });

  it("default_account_name never returns a name in existing (:101)", () => {
    fc.assert(
      fc.property(meResponses, existingSets, (me, existing) => {
        expect(existing.has(defaultAccountName(me, existing))).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("default_account_name is deterministic (:110)", () => {
    fc.assert(
      fc.property(meResponses, existingSets, (me, existing) => {
        expect(defaultAccountName(me, existing)).toBe(
          defaultAccountName(me, existing),
        );
      }),
      { numRuns: 100 },
    );
  });

  it("collision suffix starts at -2, never -1 (:120)", () => {
    fc.assert(
      fc.property(meResponses, (me) => {
        const base = defaultAccountName(me, new Set());
        const bumped = defaultAccountName(me, new Set([base]));
        expect(bumped).not.toBe(`${base}-1`);
      }),
      { numRuns: 100 },
    );
  });

  it("collision suffixes are monotonic (:136)", () => {
    fc.assert(
      fc.property(meResponses, (me) => {
        const base = defaultAccountName(me, new Set());
        const existing = new Set<string>([base]);
        const seen: number[] = [];
        for (let i = 0; i < 5; i += 1) {
          const next = defaultAccountName(me, existing);
          if (next.startsWith(`${base}-`)) {
            const suffixStr = next.slice(base.length + 1);
            if (/^\d+$/.test(suffixStr)) {
              seen.push(Number(suffixStr));
            }
          }
          existing.add(next);
        }
        expect(seen).toEqual([...seen].sort((a, b) => a - b));
        expect(new Set(seen).size).toBe(seen.length);
      }),
      { numRuns: 100 },
    );
  });
});
