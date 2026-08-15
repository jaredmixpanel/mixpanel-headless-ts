/**
 * Bookmark validation engine — TS port of
 * `src/mixpanel_headless/_internal/validation.py`.
 *
 * Two validation layers:
 *
 * - {@link validateQueryArgs} and friends: validate arguments before
 *   bookmark construction (Layer 1, rules V0-V27, F*, R*, FL*, DG1).
 * - {@link validateBookmark} / {@link validateFlowBookmark} /
 *   {@link validateSortingBlock}: validate a BUILT params dict
 *   (Layer 2, rules B1-B26, FLB1-FLB6, S1-S9).
 *
 * Both layers return `ValidationError[]`; callers decide whether to
 * raise `BookmarkValidationError`.
 *
 * This barrel matches the playbook's home name for the module. V1a
 * re-exported the six Layer-1 validators; V1b added the bookmark half.
 *
 * @module validation
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
} from "./validation-args.js";

export {
  validateBookmark,
  validateFlowBookmark,
  validateSortingBlock,
  type ValidateBookmarkOptions,
} from "./validation-bookmark.js";
