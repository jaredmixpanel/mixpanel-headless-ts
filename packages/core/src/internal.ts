/**
 * `@mixpanel-headless/core/internal` — exported plumbing that is not
 * semver-stable: validators, bookmark builders, model bases, service
 * classes and the lock-test tables that the platform packages
 * (`@mixpanel-headless/node`, `@mixpanel-headless/browser`) and the
 * verification rig (`conformance-runner`, `differential`) need beyond the
 * public barrel. Anything here may change or disappear in a patch
 * release; application code imports from `@mixpanel-headless/core` only.
 *
 * @packageDocumentation
 */

// --- Facade / services internals ---
export type { ReplayEnv } from "./services/entities/replays-signing.js";
export {
  type DiscoverOptions,
  type EventsForOptions,
  ReplaysService,
  type WalkCdnOptions,
} from "./services/replays.js";

// --- Client plumbing, invariants ---
export type { ClientCore } from "./client/core.js";
export { iterJsonlLines } from "./client/jsonl.js";
export { paginateAll } from "./client/pagination.js";
export { exceptionMessage } from "./invariant.js";

// --- Error-code registry (generated) ---
export {
  CODED_GUARD_REGISTRY,
  CODED_GUARD_TWIN_CODES,
  DEFAULT_ERROR_CODES,
  ERROR_CODES_GENERATED_FROM,
  EXCEPTION_CLASS_PARENTS,
} from "./errors-codes.gen.js";

// --- Model base, lock-test tables ---
export {
  describeValue,
  modelFail,
  requireIsoText,
} from "./types/entities/decode-utils.js";
export {
  EntityModel,
  type EntityModelStatics,
} from "./types/entities/model-base.js";
export { ENUM_TABLES } from "./types/enums.js";
export { LITERAL_ALIAS_VALUES } from "./types/literals.js";
export { filterUnchecked } from "./types/query-params/filter.js";
export { sanitizeRawCohort } from "./types/query-params/guards.js";

// --- Auth / accounts internals ---
export {
  persistActiveToConfig,
  resolverSeamsFromEffects,
  resolverSourcesFromEffects,
} from "./accounts/resolver-seams.js";
export { requireOAuthBaseUrl } from "./auth/oauth-constants.js";
export { base64UrlEncodeBytes } from "./auth/pkce.js";
export { parseQs, pythonUnquote } from "./auth/query-params.js";
export { probeClientFromFetch } from "./auth/region-probe.js";

// --- Query validators, transforms, builders ---
export { normalizeOnExpression } from "./query/expressions.js";
export { buildSegfilterEntry } from "./query/segfilter.js";
export { transformEvent, transformProfile } from "./query/transforms.js";
export {
  extractCohortFilter,
  filtersToSelector,
  filterToSelector,
} from "./query/user-builders.js";
export {
  validateUserArgs,
  type ValidateUserArgsOptions,
  validateUserParams,
} from "./query/user-validators.js";
export {
  validateFlowArgs,
  type ValidateFlowArgsOptions,
  validateFunnelArgs,
  type ValidateFunnelArgsOptions,
  validateGroupByArgs,
  type ValidateGroupByArgsOptions,
  validateQueryArgs,
  type ValidateQueryArgsOptions,
  validateRetentionArgs,
  type ValidateRetentionArgsOptions,
  validateTimeArgs,
  type ValidateTimeArgsOptions,
} from "./query/validation-args.js";
export {
  validateFlowBookmark,
  validateSortingBlock,
} from "./query/validation-bookmark.js";

// --- Bookmark builders, schema mirrors, enum tables ---
export {
  buildDateRange,
  buildFilterEntry,
  buildFilterSection,
  buildFlowCohortFilter,
  buildFlowPropertyFilter,
  buildFrequencyFilterEntry,
  buildGroupSection,
  buildTimeSection,
} from "./bookmarks/builders.js";
export {
  BOOKMARK_ENUM_TABLES,
  BOOKMARK_ENUMS_SOURCE_MODULE,
  bookmarkEnumTablesSnapshot,
  MAX_CONVERSION_WINDOW,
  VALID_CHART_TYPES,
} from "./bookmarks/enums.js";
export {
  BOOKMARK_MODEL_HANDLES,
  getRootModelForBookmarkType,
} from "./bookmarks/schema.js";
export { validateWithPydantic } from "./bookmarks/schema-sorting.js";

// --- Replays internals ---
export {
  DOMTracker,
  type DOMTrackerOptions,
  RrwebAnalyzer,
} from "./replays/rrweb-analyzer.js";

// --- Python-parity internals (`compat/`) ---
export { dateTodayIso, isLeapYear } from "./compat/python-dates.js";
export { isPythonValue } from "./compat/python-str.js";
export { isFloatCarrier } from "./compat/python-values.js";

// --- Module namespaces for the lock tests ---
// `error-codes-registry.test.ts` walks every Error subclass `errors.ts`
// exports; `query-vocabulary.test.ts` walks every runtime export of the
// query-params barrel. Both need the module namespace, not the public
// surface (which also carries `UrlSplitError`, `LosslessJsonError`, …).
export * as errorsModule from "./errors.js";
export * as queryParamsModule from "./types/query-params/index.js";
