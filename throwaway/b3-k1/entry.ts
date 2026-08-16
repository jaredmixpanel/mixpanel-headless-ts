/**
 * B3-K1 R10.9 harness entry point: the ONLY surface the Node driver
 * (`harness.mjs`) is allowed to touch, so the differential runs against
 * the real `packages/core` sources rather than a re-implementation.
 *
 * Bundled by `run.sh` into `.build/entry.mjs` (git-ignored).
 *
 * @module throwaway/b3-k1/entry
 */

export {
  BOOKMARK_MODEL_HANDLES,
  PARTIAL_UPDATE_SUB_MODELS,
  getRootModelForBookmarkType,
} from "../../packages/core/src/bookmarks/schema.js";
export * as enums from "../../packages/core/src/bookmarks/enums.js";
