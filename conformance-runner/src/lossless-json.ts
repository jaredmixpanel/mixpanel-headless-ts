/**
 * Re-export shim: `parseLossless` moved into the library at Phase-3 B0-2
 * (`packages/core/src/client/lossless-json.ts`) so every wire response
 * body parses losslessly in the LIBRARY (GATE-VERDICT R5), not only in
 * the rig. The rig re-imports from core (GF5 direction rule); its unit
 * suite moved with the parser (colocated per R7.1).
 */
export { LosslessJsonError, parseLossless } from "@mixpanel-headless/core";
