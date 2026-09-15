/**
 * Query-parameter value types: the typed filters, metrics, breakdowns and
 * per-step specifications that `Workspace` query methods accept.
 *
 * Every class mirrors a frozen dataclass in the Python `types` module and
 * validates itself at construction with the same rule codes. `guards.ts`
 * (the shared validators) is internal and not re-exported here.
 *
 * @see mixpanel_headless.types
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
