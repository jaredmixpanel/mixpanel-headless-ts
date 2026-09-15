/**
 * Pure account-name derivation from `/me`: {@link slugify} and
 * {@link defaultAccountName}. No I/O, env, clock or randomness — the
 * property tests rely on determinism. {@link slugify} runs NFKD on the
 * engine's Unicode tables where CPython pins its own; no pinned table is
 * feasible for full NFKD, so the fuzz domain is biased to ASCII, Latin-1
 * and ligatures. The 32-character truncation happens after the ASCII
 * fold, so `String.prototype.slice` is a codepoint slice there.
 *
 * @see mixpanel_headless._internal.auth.naming
 */

import type { MeResponse } from "../client/me.js";

/**
 * Upper bound on slug length. Leaves headroom under the
 * `_AccountBase.name` 64-char ceiling so `-2` collision suffixes never
 * push a derived name over the model constraint.
 */
const SLUG_MAX_LEN = 32;

/**
 * Matches any run of characters outside the slug alphabet (lowercase
 * ASCII letters or digits) — replaced with a single `-`.
 */
const NON_SLUG_CHARS = /[^a-z0-9]+/g;

/**
 * Reduce an organization name to the `[a-z0-9-]{0,32}` subset.
 *
 * @remarks
 * Six-step normalization, applied in order:
 * 1. Coerce `null` / empty input to `""`.
 * 2. NFKD-normalize and ASCII-fold (drop every codepoint above 0x7F —
 *    the `encode("ascii", errors="ignore")` twin).
 * 3. Lowercase (pure ASCII by this point, so `toLowerCase` matches
 *    `str.lower`).
 * 4. Replace any run of non-`[a-z0-9]` characters with a single `-`.
 * 5. Strip leading and trailing `-`.
 * 6. Truncate to 32 characters; strip any trailing `-` left by the
 *    truncation.
 * @param value - An arbitrary string (typically an organization name).
 *   `null`/`undefined` is treated as the empty string.
 * @returns The slug, matching `^[a-z0-9-]{0,32}$`. Empty string when no
 *   input characters survived normalization (e.g. for `"---"`) —
 *   callers must handle that case (typically via the `org-{org_id}`
 *   fallback in {@link defaultAccountName}).
 * @example
 * ```typescript
 * slugify("Acme Corp");        // "acme-corp"
 * slugify("Café Industries");  // "cafe-industries"
 * slugify("---");              // ""
 * ```
 * @see mixpanel_headless._internal.auth.naming.slugify
 */
export function slugify(value: string | null | undefined): string {
  // Python `if not value` — None and "" both fall through.
  if (value === undefined || value === null || value === "") {
    return "";
  }
  // Divergence: NFKD runs on the host engine's Unicode tables, CPython's
  // `unicodedata` on its own pinned version; a codepoint whose
  // compatibility decomposition changed between the two can slug
  // differently.
  const normalized = value.normalize("NFKD");
  // ASCII fold: `normalized.encode("ascii", errors="ignore")` drops
  // every non-ASCII codepoint; iterate by codepoint so astral chars
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
    .replaceAll(NON_SLUG_CHARS, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (dashed.length <= SLUG_MAX_LEN) {
    return dashed;
  }
  // Post-fold the string is pure ASCII, so `.slice` == codepoint slice.
  return dashed.slice(0, SLUG_MAX_LEN).replace(/-+$/, "");
}

/**
 * Pick a default account name from `/me`, suffixing on collision.
 *
 * @remarks
 * The first organization in `me.organizations` is the slug
 * source. When the slugified org name is empty, falls back to
 * `org-{org_id}`. When `me.organizations` is itself empty, falls back
 * to the literal `"account"`. Collision suffixes start at `-2` (never
 * `-1`) and increment monotonically until a unique name is found.
 * Python's "first organization" is dict insertion order
 * (`next(iter(...))`); `MeResponse.organizations` is an
 * insertion-ordered `ReadonlyMap` fed by the lossless JSON layer's
 * key-order capture, so the pick matches Python even when `/me` lists
 * organizations out of ascending-id order.
 * @param me - Parsed `/me` response.
 * @param existing - Set of already-taken local account names. Treated
 *   as immutable; never modified.
 * @returns A unique account name matching `^[a-zA-Z0-9_-]{1,64}$`.
 * @example
 * ```typescript
 * // me.organizations == {"100": {id: 100, name: "Acme Corp"}}
 * defaultAccountName(me, new Set());          // "acme-corp"
 * defaultAccountName(me, new Set(["acme-corp"])); // "acme-corp-2"
 * ```
 * @see mixpanel_headless._internal.auth.naming.default_account_name
 */
export function defaultAccountName(
  me: MeResponse,
  existing: ReadonlySet<string>,
): string {
  // `next(iter(me.organizations.items()))` — the
  // ReadonlyMap iterates in Python-dict insertion order.
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
