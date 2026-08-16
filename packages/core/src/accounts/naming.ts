/**
 * Pure-functional account-name derivation from `/me` — TS port of
 * `mixpanel_headless/_internal/auth/naming.py` (whole file, B7-A1
 * packet §3.1, `b7-packets.md`).
 *
 * Both functions are pure: no I/O, no env access, no clock reads, no
 * random sampling (R9.1). Determinism is required by the property tests
 * in `test/accounts/naming.pbt.test.ts`.
 *
 * Unicode caveat (packet Caution #12, TS-2 style): {@link slugify} runs
 * NFKD on V8's Unicode tables where CPython pins its own — no pinned
 * table is feasible for full NFKD, so the naming fuzz domain is biased
 * to ASCII/Latin-1/ligatures and residual skew is disclosed in the
 * shard RUN record. The 32-char truncation happens AFTER the ASCII
 * fold (pure ASCII by then), so `String.prototype.slice` is safe — the
 * invariant is asserted in `test/accounts/naming.test.ts` rather than
 * importing `cpSlice`.
 */

import type { MeResponse } from "../client/me.js";

/**
 * Upper bound on slug length (`naming.py:30`). Leaves headroom under
 * the `_AccountBase.name` 64-char ceiling so `-2` collision suffixes
 * never push a derived name over the model constraint.
 */
const SLUG_MAX_LEN = 32;

/**
 * Matches any run of characters outside the slug alphabet (lowercase
 * ASCII letters or digits) — replaced with a single `-`
 * (`naming.py:35`).
 */
const NON_SLUG_CHARS = /[^a-z0-9]+/g;

/**
 * Reduce an org name to the `[a-z0-9-]{0,32}` subset (port of
 * `slugify`, `naming.py:40-83`).
 *
 * Six-step normalization (applied in order):
 *
 * 1. Coerce `null` / empty input to `""`.
 * 2. NFKD-normalize and ASCII-fold (drop every codepoint above 0x7F —
 *    the `encode("ascii", errors="ignore")` twin).
 * 3. Lowercase (pure ASCII by this point, so `toLowerCase` matches
 *    `str.lower`).
 * 4. Replace any run of non-`[a-z0-9]` characters with a single `-`.
 * 5. Strip leading and trailing `-`.
 * 6. Truncate to 32 characters; strip any trailing `-` left by the
 *    truncation.
 *
 * @param value - An arbitrary string (typically an organization name).
 *   `null`/`undefined` is treated as the empty string.
 * @returns The slug, matching `^[a-z0-9-]{0,32}$`. Empty string when no
 *   input characters survived normalization (e.g. for `"---"`) —
 *   callers MUST handle that case (typically via the `org-{org_id}`
 *   fallback in {@link defaultAccountName}).
 *
 * @example
 * ```typescript
 * slugify("Acme Corp");        // "acme-corp"
 * slugify("Café Industries");  // "cafe-industries"
 * slugify("---");              // ""
 * ```
 */
export function slugify(value: string | null | undefined): string {
  // Python `if not value` — None and "" both fall through (watchlist #6
  // does not apply: the input is typed string, never a number).
  if (value === undefined || value === null || value === "") {
    return "";
  }
  const normalized = value.normalize("NFKD");
  // ASCII fold: `normalized.encode("ascii", errors="ignore")` drops
  // every non-ASCII CODEPOINT; iterate by codepoint so astral chars
  // are dropped whole (never split into surrogate halves).
  let folded = "";
  for (const ch of normalized) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp <= 0x7f) {
      folded += ch;
    }
  }
  const lowered = folded.toLowerCase();
  const dashed = lowered
    .replace(NON_SLUG_CHARS, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (dashed.length <= SLUG_MAX_LEN) {
    return dashed;
  }
  // Post-fold the string is pure ASCII, so `.slice` == codepoint slice.
  return dashed.slice(0, SLUG_MAX_LEN).replace(/-+$/, "");
}

/**
 * Pick a default account name from `/me`, suffixing on collision (port
 * of `default_account_name`, `naming.py:85-133`).
 *
 * Picks the first organization from `me.organizations` as the slug
 * source. When the slugified org name is empty, falls back to
 * `org-{org_id}`. When `me.organizations` is itself empty, falls back
 * to the literal `"account"`. Collision suffixes start at `-2` (never
 * `-1`) and increment monotonically until a unique name is found.
 *
 * ORDER (USER RATIFICATION 2026-08-16,
 * `context/phase3/design/user-ratifications.md:14-22` — supersedes the
 * B7-ARB-A R2 exclusion, `b7-reviewA-resolution.md`, and closes
 * playbook Discrepancy #13's result-affecting site): Python's "first
 * organization" is dict INSERTION order (`next(iter(...))`,
 * `naming.py:122`), and `MeResponse.organizations` is now an
 * insertion-order-preserving `ReadonlyMap` sourced from the lossless
 * JSON layer's key-order capture (B8-MAPFIX), so the first-org pick
 * matches Python exactly — including when `/me` emits organizations
 * out of ascending-id order. The former ascending-id fuzz-domain
 * exclusion is REMOVED (out-of-order org strategies run in
 * `test/accounts/naming-order.test.ts` and the B8-MAPFIX R10.9
 * harness).
 *
 * @param me - Parsed `/me` response.
 * @param existing - Set of already-taken local account names. Treated
 *   as immutable; never modified.
 * @returns A unique account name matching `^[a-zA-Z0-9_-]{1,64}$`.
 *
 * @example
 * ```typescript
 * // me.organizations == {"100": {id: 100, name: "Acme Corp"}}
 * defaultAccountName(me, new Set());          // "acme-corp"
 * defaultAccountName(me, new Set(["acme-corp"])); // "acme-corp-2"
 * ```
 */
export function defaultAccountName(
  me: MeResponse,
  existing: ReadonlySet<string>,
): string {
  // `next(iter(me.organizations.items()))` (`naming.py:122`) — the
  // ReadonlyMap iterates in Python-dict insertion order (B8-MAPFIX).
  const first = me.organizations.entries().next();
  let base: string;
  if (first.done === true) {
    base = "account";
  } else {
    const [firstOrgId, firstOrg] = first.value;
    base = slugify(firstOrg.name);
    if (base === "") {
      base = `org-${firstOrgId}`;
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
