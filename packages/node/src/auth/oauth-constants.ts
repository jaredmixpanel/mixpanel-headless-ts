/**
 * Re-export of the core OAuth constants — the values moved to
 * `packages/core/src/auth/oauth-constants.ts` at B9-R2 (b9-packets.md
 * §3.1 row 1, the fetch-pure hoist; R10.8: shared internals ported
 * once, by name — supersedes the B8 "copy-with-cite" outbound row).
 * Keeping this file preserves every existing node import path; the
 * untouched B8 suites are the zero-behavior-change proof.
 *
 * (History: the B8 home note hoisted `OAUTH_BASE_URLS` here from the
 * DCR module so N2's `flow.ts` never depended on N3 — that layering
 * concern dissolves with the core home.)
 */

export { OAUTH_BASE_URLS } from "@mixpanel-headless/core";
