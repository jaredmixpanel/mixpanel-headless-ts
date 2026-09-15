/**
 * OAuth constants shared by the Node and browser auth surfaces: the
 * per-region OAuth base URLs, the region gate that validates against
 * them, and the advisory DCR scope string. Both packages import these
 * names; nothing is duplicated.
 *
 * @see mixpanel_headless._internal.auth.client_registration
 */

import { OAuthError } from "../errors.js";

/** OAuth base URLs keyed by region, trailing slash included. */
export const OAUTH_BASE_URLS: Readonly<Record<string, string>> = {
  us: "https://mixpanel.com/oauth/",
  eu: "https://eu.mixpanel.com/oauth/",
  in: "https://in.mixpanel.com/oauth/",
};

/**
 * Validate a region against {@link OAUTH_BASE_URLS} and return its base
 * URL — the `OAuthFlow.__init__` gate shared by the Node flow
 * constructor and the browser redirect flow (same code, same message
 * shape).
 *
 * @param region - The caller-supplied region.
 * @returns The region's OAuth base URL (trailing slash).
 * @throws OAuthError - `OAUTH_CONFIG_ERROR` for unknown regions.
 * @see mixpanel_headless._internal.auth.flow.OAuthFlow
 */
export function requireOAuthBaseUrl(region: string): string {
  const baseUrl = OAUTH_BASE_URLS[region];
  if (baseUrl === undefined) {
    throw new OAuthError(
      `Unknown region: ${JSON.stringify(region)}. Must be one of: ${Object.keys(
        OAUTH_BASE_URLS,
      )
        .sort()
        .join(", ")}`,
      "OAUTH_CONFIG_ERROR",
    );
  }
  return baseUrl;
}

/**
 * Scopes sent in the DCR request body for server-side validation
 * (`_DEFAULT_SCOPE`). Advisory only — DCR does not store these on the
 * application model; the created app has an empty scope field, meaning
 * all scopes are allowed.
 */
export const DEFAULT_SCOPE: string =
  "projects analysis events insights segmentation retention " +
  "data:read funnels flows data_definitions dashboard_reports bookmarks";
