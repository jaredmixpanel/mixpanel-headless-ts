// THROWAWAY (R10.9) — bundle entry for the B2-M1 edge + fuzz harness.
// Deleted by the B2 batch gate after arbiter sign-off (GF6 / B0 precedent).
export {
  validateFlowArgs,
  validateFunnelArgs,
  validateGroupByArgs,
  validateQueryArgs,
  validateRetentionArgs,
  validateTimeArgs,
} from "../../packages/core/src/query/validation.js";
export {
  _suggest,
  _validateCustomProperty,
  containsControlChars,
  isInvisibleOnly,
  matchesDateRe,
  _isValidDate,
  _isFinite,
} from "../../packages/core/src/query/validation-shared.js";
export {
  CohortBreakdown,
  CohortMetric,
  CustomPropertyRef,
  Exclusion,
  Filter,
  Formula,
  FunnelStep,
  GroupBy,
  HoldingConstant,
  InlineCustomProperty,
  Metric,
  PropertyInput,
  RetentionEvent,
  TimeComparison,
} from "../../packages/core/src/types/index.js";
export { ParamValidationError } from "../../packages/core/src/errors.js";
