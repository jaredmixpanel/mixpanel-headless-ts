/**
 * Re-export shim: the JSON value model moved into the library at Phase-3
 * B0-2 (`packages/core/src/client/json-value.ts`) alongside the
 * `parseLossless` relocation (playbook P3-4 B0-2 / gates-review GF5:
 * judge-uses-library direction — the rig re-imports from core; the
 * library never imports from the rig). Rig-internal import paths stay
 * stable through this shim, and `instanceof JsonNumber` identity is
 * preserved because there is exactly ONE class definition (core's).
 */
export {
  JsonNumber,
  type JsonValue,
} from "../../packages/core/src/client/json-value.js";
