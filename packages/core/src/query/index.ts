/**
 * `query` module of @mixpanel-headless/core (D11 layout) — internal
 * query builders and validators.
 *
 * NOT re-exported from `packages/core/src/index.ts`; the only public
 * member of this subtree is `validate_bookmark`, which B2 shard V1b
 * adds to the package barrel.
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
} from "./validation.js";
