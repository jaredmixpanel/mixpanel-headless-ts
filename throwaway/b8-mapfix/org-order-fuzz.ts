/**
 * B8-MAPFIX R10.9 harness, part 1 — fast-check org-ordering fuzz
 * (`b8-packets.md` §2.5 row 6: "fast-check over org-map key orders
 * (integer-like + non-integer-like mixes) → first-pick equals
 * mini-model insertion-order pick (the exclusion REMOVED per the
 * ratification — this row is the proof)").
 *
 * Domain: 0..6 orgs with SHUFFLED key order, keys drawn from
 * integer-like id spellings AND non-integer spellings (`team-x`
 * style), org names over the naming PBT alphabet plus empty/dash-only
 * (exercising the `org-{id}` fallback), plus a random existing-name
 * set (collision suffixes). Each case is rendered to JSON TEXT with
 * keys in the generated order and parsed through the REAL wire path
 * (`parseLossless` → `toNativeJson` → `MeResponse.fromDict`) — the
 * exact `services/me.ts:283` construction — then
 * `defaultAccountName(me, existing)` is compared against a mini-model
 * that picks the FIRST GENERATED entry (Python dict insertion order)
 * and re-derives base/fallback/suffix from `slugify` alone.
 *
 * Run: `npx vite-node throwaway/b8-mapfix/org-order-fuzz.ts`
 */

import fc from "fast-check";
import { parseLossless } from "../../packages/core/src/client/lossless-json.js";
import {
  toNativeJson,
  type JsonValue,
} from "../../packages/core/src/client/json-value.js";
import { MeResponse } from "../../packages/core/src/client/me.js";
import {
  defaultAccountName,
  slugify,
} from "../../packages/core/src/accounts/naming.js";

/** One generated organization entry. */
interface OrgCase {
  readonly key: string;
  readonly id: number;
  readonly name: string;
}

/** Org display names: slug-friendly, unicode-ish, empty, dash-only. */
const orgName = fc.oneof(
  fc.constantFrom("Acme Corp", "Beta Systems", "Café Industries", "---", ""),
  fc
    .array(
      fc.constantFrom(
        ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_.é",
      ),
      { minLength: 0, maxLength: 20 },
    )
    .map((chars) => chars.join("")),
);

/** Key spellings: integer-like (the hoisted class) or plain strings. */
const orgKey = fc.oneof(
  fc.integer({ min: 0, max: 999999 }).map(String),
  fc
    .tuple(fc.constantFrom("team", "org", "x"), fc.nat({ max: 999 }))
    .map(([p, n]) => `${p}-${String(n)}`),
);

/** A whole organizations map in GENERATED (insertion) order. */
const orgList: fc.Arbitrary<OrgCase[]> = fc
  .array(fc.tuple(orgKey, fc.nat({ max: 999999 }), orgName), {
    minLength: 0,
    maxLength: 6,
  })
  .map((entries) => {
    const seen = new Set<string>();
    const out: OrgCase[] = [];
    for (const [key, id, name] of entries) {
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ key, id, name });
      }
    }
    return out;
  });

/** Existing account-name sets (collision pressure). */
const existingSet = fc
  .array(
    fc.constantFrom(
      "acme-corp",
      "beta-systems",
      "account",
      "account-2",
      "team-1",
      "org-100",
      "cafe-industries",
    ),
    { minLength: 0, maxLength: 5 },
  )
  .map((names) => new Set(names));

/**
 * Render the /me body with org keys in generated order.
 *
 * @param orgs - The generated entries.
 * @returns JSON text whose object key order equals the list order.
 */
function renderBody(orgs: readonly OrgCase[]): string {
  const members = orgs
    .map(
      (o) =>
        `${JSON.stringify(o.key)}: {"id": ${String(o.id)}, ` +
        `"name": ${JSON.stringify(o.name)}}`,
    )
    .join(", ");
  return `{"organizations": {${members}}}`;
}

/**
 * Mini-model: Python `default_account_name` over the GENERATED order
 * (insertion order = list order; reuses `slugify` — the property
 * under test is the ORDER PICK, not the slug transform).
 *
 * @param orgs - Entries in insertion order.
 * @param existing - Taken names.
 * @returns The expected account name.
 */
function miniModel(
  orgs: readonly OrgCase[],
  existing: ReadonlySet<string>,
): string {
  let base: string;
  const first = orgs[0];
  if (first === undefined) {
    base = "account";
  } else {
    base = slugify(first.name);
    if (base === "") {
      base = `org-${first.key}`;
    }
  }
  if (!existing.has(base)) {
    return base;
  }
  let suffix = 2;
  for (;;) {
    const candidate = `${base}-${String(suffix)}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
}

const SEED = 20260816;
const NUM_RUNS = 1000;
let checked = 0;

fc.assert(
  fc.property(orgList, existingSet, (orgs, existing) => {
    const me = MeResponse.fromDict(
      toNativeJson(parseLossless(renderBody(orgs)) as JsonValue),
    );
    const actual = defaultAccountName(me, existing);
    const expected = miniModel(orgs, existing);
    if (actual !== expected) {
      throw new Error(
        `divergence: orgs=${JSON.stringify(orgs)} ` +
          `existing=${JSON.stringify([...existing])} ` +
          `ts=${actual} model=${expected}`,
      );
    }
    checked += 1;
  }),
  { seed: SEED, numRuns: NUM_RUNS },
);

console.log(
  `org-order-fuzz: examples ${String(checked)} (>=500 budget) ` +
    `divergences 0 seed ${String(SEED)}`,
);
