/**
 * OAuth base URLs keyed by Mixpanel region — TS home of the
 * `OAUTH_BASE_URLS` constant (`client_registration.py:39-44`).
 *
 * HOME NOTE (b8-packets.md §3.1 row 2): the Python constant lives in
 * `client_registration.py`; the port hoists it here so N2's `flow.ts`
 * (refresh half) does not depend on N3's DCR module. N3 imports it
 * from here; B9's browser package copies the VALUES with a cite (core
 * may not import node — packet §8 outbound row 2).
 */

/** OAuth base URLs keyed by region (trailing slash included). */
export const OAUTH_BASE_URLS: Readonly<Record<string, string>> = {
  us: "https://mixpanel.com/oauth/",
  eu: "https://eu.mixpanel.com/oauth/",
  in: "https://in.mixpanel.com/oauth/",
};
