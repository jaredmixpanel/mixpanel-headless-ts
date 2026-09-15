/**
 * Browser-local coded errors. These codes are browser-build policy
 * surfaces with no Python twin by construction, so they are not added
 * to `errors-codes.gen.ts` (that file is generated from the Python
 * contract artifact and hand-edit-tripwired —
 * `scripts/generate-error-codes.mjs`); they live here as exported
 * constants instead. Assertions and docs key on the code, never on
 * message text.
 */

import { MixpanelHeadlessError } from "@mixpanel-headless/core";

/**
 * Code for the service-account Basic-auth runtime refusal. Raised on
 * every ingress path that could install a `service_account` on a
 * browser-built facade: service-account Basic credentials are
 * long-lived secrets that must not ship to a browser origin, even
 * though CORS would technically permit the calls.
 */
export const BROWSER_SERVICE_ACCOUNT_REFUSED =
  "BROWSER_SERVICE_ACCOUNT_REFUSED";

/**
 * Code for the Export-API browser exclusion. The export hosts serve no
 * CORS headers, so browser calls are dead on arrival; the transport
 * guard refuses them with this code before any network attempt.
 */
export const BROWSER_EXPORT_UNSUPPORTED = "BROWSER_EXPORT_UNSUPPORTED";

/**
 * Code for `completeLogin` called with no (or an already-consumed,
 * expired or corrupted) pending-login record for the region. No Python
 * twin by construction: Python holds the login state in-process, so a
 * "return with no pending state" cannot arise there — this is the
 * replay / expired-tab branch of the browser redirect split. Recovery
 * is a fresh `beginLogin`.
 */
export const BROWSER_NO_PENDING_LOGIN = "BROWSER_NO_PENDING_LOGIN";

/**
 * Error for browser-build capability refusals.
 *
 * Thrown when a caller reaches for a surface the browser build refuses
 * on policy or platform grounds: service-account Basic auth
 * ({@link BROWSER_SERVICE_ACCOUNT_REFUSED}), Export-API streaming
 * ({@link BROWSER_EXPORT_UNSUPPORTED}) and a redirect return with no
 * pending login ({@link BROWSER_NO_PENDING_LOGIN}). The message is
 * explanatory (it names what was received, why it is refused, and what
 * to use instead); programs must key on
 * {@link MixpanelHeadlessError.code}.
 *
 * @example
 * ```typescript
 * try {
 *   createBrowserWorkspace({ session: serviceAccountSession });
 * } catch (error) {
 *   if (error instanceof BrowserUnsupportedError) {
 *     console.log(error.code); // "BROWSER_SERVICE_ACCOUNT_REFUSED"
 *   }
 * }
 * ```
 */
export class BrowserUnsupportedError extends MixpanelHeadlessError {}
