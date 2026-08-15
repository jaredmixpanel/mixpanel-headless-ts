// THROWAWAY (R10.9) — bundle entry for the B2-M3 edge + fuzz harness.
// Deleted by the B2 batch gate after arbiter sign-off (GF6 / B0 precedent).
export {
  validateUserArgs,
  validateUserParams,
} from "../../packages/core/src/query/user-validators.js";
export { isCohortFilter } from "../../packages/core/src/query/user-builders.js";
export {
  CohortCriteria,
  CohortDefinition,
  CustomPropertyRef,
  Filter,
  InlineCustomProperty,
} from "../../packages/core/src/types/index.js";
export { ParamValidationError } from "../../packages/core/src/errors.js";
