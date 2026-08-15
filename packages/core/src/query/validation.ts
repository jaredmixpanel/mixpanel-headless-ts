/**
 * Bookmark validation engine — TS port of
 * `src/mixpanel_headless/_internal/validation.py`.
 *
 * Two validation layers:
 *
 * - {@link validateQueryArgs} and friends: validate arguments before
 *   bookmark construction (Layer 1, rules V0-V27, F*, R*, FL*, DG1).
 * - `validateBookmark` (Layer 2, rules B1-B26): B2 shard V1b — not yet
 *   landed.
 *
 * Both layers return `ValidationError[]`; callers decide whether to
 * raise `BookmarkValidationError`.
 *
 * This barrel matches the playbook's home name for the module. V1a
 * re-exports the six Layer-1 validators; V1b extends it with the
 * bookmark validators.
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
