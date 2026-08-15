/**
 * Barrel for the query-param dataclass family (phase2-design C1/C7).
 *
 * P2-5a exports the filter/metric/group core. The `cohort.ts` shells
 * (`CohortCriteria`/`CohortDefinition`) are deliberately NOT re-exported
 * yet — the P2-5b packet completes the family (factories, guards,
 * `toDict`, `CohortBreakdown`, `sanitizeRawCohort`) and adds them here.
 * `guards.ts` is `@internal` plumbing and never barrel-exported.
 */
export {
  CustomPropertyRef,
  Filter,
  InlineCustomProperty,
  ListItemGroupMode,
  PropertyInput,
  type FilterFields,
  type FilterValue,
  type PropertySpec,
} from "./filter.js";
export { GroupBy, type GroupByFields } from "./group-by.js";
export {
  CohortMetric,
  Formula,
  Metric,
  TimeComparison,
  type MetricFields,
} from "./metric.js";
