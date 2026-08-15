/**
 * `query` module of @mixpanel-headless/core (D11 layout) — internal
 * query builders and validators.
 *
 * NOT re-exported wholesale from `packages/core/src/index.ts`; the only
 * public member of this subtree is Python's `validate_bookmark`
 * (`__init__.py:9`), exported from the package barrel as
 * {@link validateBookmark} by B2 shard V1b.
 *
 * @module query
 * @internal
 */

export {
  validateFlowArgs,
  validateFunnelArgs,
  validateGroupByArgs,
  validateQueryArgs,
  validateRetentionArgs,
  validateTimeArgs,
  type ValidateFlowArgsOptions,
  type ValidateFunnelArgsOptions,
  type ValidateGroupByArgsOptions,
  type ValidateQueryArgsOptions,
  type ValidateRetentionArgsOptions,
  type ValidateTimeArgsOptions,
  validateBookmark,
  validateFlowBookmark,
  validateSortingBlock,
  type ValidateBookmarkOptions,
} from "./validation.js";
