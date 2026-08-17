/**
 * OAuth constants shared by the node and browser auth surfaces — the
 * B9-R2 core home (b9-packets.md §3.1 row 1: the fetch-pure hoist,
 * second R10.8 ruling of the packet; supersedes the B8 outbound
 * "copy-with-cite" instruction — both packages now import these names,
 * nothing is duplicated). Python home: `client_registration.py`.
 *
 * Moved MECHANICALLY from `packages/node/src/auth/oauth-constants.ts`
 * (`OAUTH_BASE_URLS`) and `packages/node/src/auth/client-registration.ts`
 * (`DEFAULT_SCOPE`); node re-exports from here (its B8 suites stay
 * green unchanged — the zero-behavior-change proof).
 */

/**
 * OAuth base URLs keyed by region, trailing slash included
 * (`OAUTH_BASE_URLS`, `client_registration.py:39-44`).
 */
export const OAUTH_BASE_URLS: Readonly<Record<string, string>> = {
  us: "https://mixpanel.com/oauth/",
  eu: "https://eu.mixpanel.com/oauth/",
  in: "https://in.mixpanel.com/oauth/",
};

/**
 * Scopes sent in the DCR request body for server-side validation
 * (`_DEFAULT_SCOPE`, `client_registration.py:46-52`). Advisory only —
 * DCR does NOT store these on the application model; the created app
 * has an empty scope field, meaning all scopes are allowed.
 */
export const DEFAULT_SCOPE: string =
  "projects analysis events insights segmentation retention " +
  "data:read funnels flows data_definitions dashboard_reports bookmarks";
