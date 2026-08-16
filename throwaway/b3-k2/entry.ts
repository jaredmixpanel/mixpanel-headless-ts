/**
 * B3-K2 R10.9 harness entry point: the ONLY surface the Node driver
 * (`harness.mjs`) touches, so the differential runs against the real
 * `packages/core` sources rather than a re-implementation.
 *
 * Bundled by `run.sh` into `.build/entry.mjs` (git-ignored).
 *
 * @module throwaway/b3-k2/entry
 */

export * as builders from "../../packages/core/src/bookmarks/builders.js";
export {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  CustomPropertyRef,
  Filter,
  FrequencyBreakdown,
  FrequencyFilter,
  GroupBy,
  InlineCustomProperty,
  ListItemGroupMode,
  PropertyInput,
  TimeComparison,
} from "../../packages/core/src/types/index.js";
export {
  MixpanelHeadlessError,
  ParamTypeError,
  ParamValidationError,
} from "../../packages/core/src/errors.js";
