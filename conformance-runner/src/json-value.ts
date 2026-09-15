/**
 * Re-export shim for the library's JSON value model
 * (`packages/core/src/client/json-value.ts`).
 *
 * The rig re-imports from core and the library never imports from the rig.
 * Rig-internal import paths stay stable through this shim, and
 * `instanceof JsonNumber` identity is preserved because there is exactly one
 * class definition (core's).
 */
export { JsonNumber, type JsonValue } from "@mixpanel-headless/core";
