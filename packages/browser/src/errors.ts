/**
 * Browser-local coded errors (b9-packets.md §2.3). These codes are
 * browser-build policy surfaces with NO Python twin by construction,
 * so they are NOT added to `errors-codes.gen.ts` (that file is
 * generated from the Python contract artifact and hand-edit-tripwired
 * — `scripts/gen-error-codes.mjs`); they live here as exported
 * constants instead. R5: assertions and docs key on the CODE, never
 * message text.
 */

import { MixpanelHeadlessError } from "../../core/src/errors.js";

/**
 * Code for the service-account Basic-auth runtime refusal (rulebook
 * R9.3: "service-account Basic auth REFUSED at runtime in browser
 * builds with an explanatory coded error"). Raised on every §2.3
 * ingress path that could install a `service_account` on a
 * browser-built facade.
 */
export const BROWSER_SERVICE_ACCOUNT_REFUSED =
  "BROWSER_SERVICE_ACCOUNT_REFUSED";

/**
 * Code for the Export-API browser exclusion (plan §4.3 tier table:
 * Export is Node-only — the export hosts serve no CORS headers, so
 * browser calls are dead on arrival; the transport guard refuses them
 * with this code BEFORE any network attempt).
 */
export const BROWSER_EXPORT_UNSUPPORTED = "BROWSER_EXPORT_UNSUPPORTED";

/**
 * Error for browser-build capability refusals (R9.3 / plan §4.3).
 *
 * Thrown when a caller reaches for a surface the browser build refuses
 * on policy or platform grounds: service-account Basic auth
 * ({@link BROWSER_SERVICE_ACCOUNT_REFUSED}) and Export-API streaming
 * ({@link BROWSER_EXPORT_UNSUPPORTED}). The message is explanatory per
 * R9.3 (names what was received, why it is refused, and what to use
 * instead); programs must key on {@link MixpanelHeadlessError.code}.
 */
export class BrowserUnsupportedError extends MixpanelHeadlessError {
  /**
   * Initialize the refusal error.
   *
   * @param message - Human-readable explanation (out of contract, R5.4).
   * @param code - One of the `BROWSER_*` codes above.
   * @param details - Additional structured data (snake_case keys).
   * @param options - Standard `ErrorOptions` (`cause` threading).
   */
  constructor(
    message: string,
    code: string,
    details?: Readonly<Record<string, unknown>> | null,
    options?: ErrorOptions,
  ) {
    super(message, code, details, options);
  }
}
