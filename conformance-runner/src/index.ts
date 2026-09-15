/**
 * Replay the Python-extracted conformance corpus against the port.
 *
 * The corpus (`corpus/`) is a committed snapshot pinned by
 * `corpus.config.json`. `runner.ts` dispatches vectors to the bindings; the
 * verdict taxonomy lives in `verdicts.ts`; equality goes through
 * `canonical.ts` and the order-preserving `lossless-json.ts`. Consumed by
 * `test/corpus.test.ts` and the `npm run conformance` CLI (`cli.ts`).
 *
 * @packageDocumentation
 */

export * from "./api-map.js";
export type * from "./api-map-types.js";
export * from "./batch-status.js";
export * from "./bindings.js";
export * from "./canonical.js";
export * from "./codecs.js";
export * from "./interactions.js";
export * from "./internal/guards.js";
export * from "./json-value.js";
export * from "./loader.js";
export * from "./lossless-json.js";
export * from "./naming.js";
export * from "./request-diff.js";
export * from "./runner.js";
export * from "./shims.js";
export * from "./transport-errors.js";
export {
  CONTRACT_TAG_CODECS,
  type ContractTagCodec,
  ENTITY_TAG_CODECS,
  fieldsFromBag,
} from "./vector-codecs.js";
export * from "./vector-fetch.js";
export type * from "./vector-types.js";
export * from "./verdicts.js";
