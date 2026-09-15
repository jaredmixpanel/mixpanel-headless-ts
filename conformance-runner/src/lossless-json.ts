/**
 * Re-export shim for the library's lossless JSON parser
 * (`packages/core/src/client/lossless-json.ts`).
 *
 * The parser lives in core so every wire response body parses losslessly in
 * the library itself, not only in the rig; the rig re-imports it and never
 * the other way round. Its unit suite is colocated with the parser.
 */
export { LosslessJsonError, parseLossless } from "@mixpanel-headless/core";
