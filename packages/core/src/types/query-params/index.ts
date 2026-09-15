/**
 * Barrel for the query-param dataclass family (phase2-design C1/C7).
 *
 * P2-5a exports the filter/metric/group core; P2-5b adds the cohort
 * family; P2-5c adds the funnel/retention/flow/frequency family.
 * `guards.ts` is `@internal` plumbing and never barrel-exported;
 * `sanitizeRawCohort` and the cohort helper tables stay module-level
 * `@internal` exports (consumed by the conformance binding and tests,
 * not re-exported here).
 */
export {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  type DidEventOptions,
  type DidNotDoEventOptions,
  type HasPropertyOperator,
  type HasPropertyType,
} from "./cohort.js";
export {
  CustomPropertyRef,
  Filter,
  type FilterFields,
  type FilterValue,
  InlineCustomProperty,
  ListItemGroupMode,
  PropertyInput,
  type PropertySpec,
} from "./filter.js";
export { FlowStep, type FlowStepFields } from "./flow.js";
export {
  FrequencyBreakdown,
  type FrequencyBreakdownFields,
  FrequencyFilter,
  type FrequencyFilterFields,
} from "./frequency.js";
export {
  Exclusion,
  type ExclusionFields,
  FunnelStep,
  type FunnelStepFields,
  HoldingConstant,
  type HoldingConstantFields,
} from "./funnel.js";
export { GroupBy, type GroupByFields } from "./group-by.js";
export {
  CohortMetric,
  Formula,
  Metric,
  type MetricFields,
  TimeComparison,
} from "./metric.js";
export { RetentionEvent, type RetentionEventFields } from "./retention.js";
