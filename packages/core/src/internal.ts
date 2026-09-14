/**
 * `@mixpanel-headless/core/internal` — the NOT-semver-stable surface.
 *
 * Exists for the verification rig (`conformance-runner`, `differential`)
 * and the platform packages (`@mixpanel-headless/node`,
 * `@mixpanel-headless/browser`), which need core plumbing that the public
 * barrel (`./index.ts`) deliberately does not promise to keep: validators,
 * bookmark builders, model bases, service classes, lock-test tables.
 * Anything here may change or disappear in a patch release. Application
 * code should import from `@mixpanel-headless/core` only.
 */

// ── Facade / services internals ─────────────────────────────────────────
export type { ReplayEnv } from "./services/entities/replays-signing.js";
export type { LiveActivityFeedOptions } from "./services/live-query.js";
export {
  ReplaysService,
  type DiscoverOptions,
  type EventsForOptions,
  type WalkCdnOptions,
} from "./services/replays.js";
export type { EventsInput } from "./workspace-query-params.js";

// ── Client plumbing ─────────────────────────────────────────────────────
export { iterJsonlLines } from "./client/jsonl.js";
export { paginateAll } from "./client/pagination.js";

// ── Error-code registry (generated) ─────────────────────────────────────
export {
  CODED_GUARD_REGISTRY,
  CODED_GUARD_TWIN_CODES,
  DEFAULT_ERROR_CODES,
  ERROR_CODES_GENERATED_FROM,
  EXCEPTION_CLASS_PARENTS,
} from "./errors-codes.gen.js";

// ── Model base, lock-test tables ────────────────────────────────────────
export {
  EntityModel,
  type EntityModelStatics,
} from "./types/entities/model-base.js";
export { ENUM_TABLES } from "./types/enums.js";
export { LITERAL_ALIAS_VALUES } from "./types/literals.js";
export { sanitizeRawCohort } from "./types/query-params/cohort.js";
export { filterUnchecked } from "./types/query-params/filter.js";

// ── Auth / accounts internals ───────────────────────────────────────────
export {
  persistActiveToConfig,
  resolverSeamsFromEffects,
  resolverSourcesFromEffects,
} from "./accounts/resolver-seams.js";
export { base64UrlEncodeBytes } from "./auth/pkce.js";
export { parseQs, pythonUnquote } from "./auth/query-params.js";
export { probeClientFromFetch } from "./auth/region-probe.js";

// ── Query validators, transforms, builders ──────────────────────────────
export { normalizeOnExpression } from "./query/expressions.js";
export { ValueError } from "./query/python-builtins.js";
export { buildSegfilterEntry } from "./query/segfilter.js";
export { transformEvent, transformProfile } from "./query/transforms.js";
export {
  extractCohortFilter,
  filterToSelector,
  filtersToSelector,
} from "./query/user-builders.js";
export {
  validateUserArgs,
  validateUserParams,
  type ValidateUserArgsOptions,
} from "./query/user-validators.js";
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
} from "./query/validation-args.js";
export {
  validateFlowBookmark,
  validateSortingBlock,
} from "./query/validation-bookmark.js";

// ── Bookmark builders, schema mirrors, enum tables ──────────────────────
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
  BOOKMARK_ENUMS_SOURCE_MODULE,
  BOOKMARK_ENUM_TABLES,
  MAX_CONVERSION_WINDOW,
  VALID_CHART_TYPES,
  bookmarkEnumTablesSnapshot,
} from "./bookmarks/enums.js";
export { validateWithPydantic } from "./bookmarks/schema-sorting.js";
export {
  BOOKMARK_MODEL_HANDLES,
  getRootModelForBookmarkType,
} from "./bookmarks/schema.js";

// ── Replays internals ───────────────────────────────────────────────────
export { RrwebAnalyzer } from "./replays/rrweb-analyzer.js";

// ── Module namespaces for the lock tests ─────────────────────────────────
// `error-codes-registry.test.ts` walks every Error subclass `errors.ts`
// exports; `query-vocabulary.test.ts` walks every runtime export of the
// query-params barrel. Both need the MODULE, not the public surface (which
// also carries `UrlSplitError`, `LosslessJsonError`, …).
export * as errorsModule from "./errors.js";
export * as queryParamsModule from "./types/query-params/index.js";
