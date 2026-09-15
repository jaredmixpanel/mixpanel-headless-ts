/**
 * @mixpanel-headless/core — the public, semver-stable surface of the
 * isomorphic core (R9.1: no Node built-ins, no undici, no `process`).
 *
 * Every export is listed by name, grouped by area; nothing is re-exported
 * wholesale. Names the platform packages and the verification rig need
 * beyond this list live on `./internal.ts` (`@mixpanel-headless/core/internal`),
 * which is NOT semver-stable.
 */

// ── Facade — `Workspace` and its per-method option types ────────────────
export type { MeCacheStore } from "./services/me.js";
export {
  type ReportLinkParamsInput,
  Workspace,
  type WorkspaceCreateReportLinkOptions,
  type WorkspaceEventCountsOptions,
  type WorkspaceEventsForReplayOptions,
  type WorkspaceEventsOptions,
  type WorkspaceFetchReplayOptions,
  type WorkspaceFetchReplaysOptions,
  type WorkspaceFlowQueryOptions,
  type WorkspaceFrequencyOptions,
  type WorkspaceFunnelOptions,
  type WorkspaceFunnelQueryOptions,
  type WorkspaceLexiconSchemasOptions,
  type WorkspaceListReplaysOptions,
  type WorkspaceLogger,
  type WorkspaceMeOptions,
  type WorkspaceNumericOptions,
  type WorkspaceOptions,
  type WorkspaceProjectsOptions,
  type WorkspacePropertyCountsOptions,
  type WorkspacePropertyValuesOptions,
  type WorkspaceQueryOptions,
  type WorkspaceQueryReportLinkOptions,
  type WorkspaceReplaysForUserOptions,
  type WorkspaceRetentionOptions,
  type WorkspaceRetentionQueryOptions,
  type WorkspaceRunFlowParamsOptions,
  type WorkspaceRunParamsOptions,
  type WorkspaceRunUserParamsOptions,
  type WorkspaceSavedReportLinkOptions,
  type WorkspaceSchemaGraphOptions,
  type WorkspaceSegmentationNumericOptions,
  type WorkspaceSegmentationOptions,
  type WorkspaceSignReplayOptions,
  type WorkspaceStreamReplayOptions,
  type WorkspaceSubpropertiesOptions,
  type WorkspaceTopEventsOptions,
  type WorkspaceUseOptions,
  type WorkspaceUserQueryOptions,
  type WorkspaceWorkspacesOptions,
} from "./workspace.js";
export type {
  WorkspaceGetAlertCountOptions,
  WorkspaceGetAlertHistoryOptions,
  WorkspaceListAlertsOptions,
  WorkspaceListAnnotationsOptions,
} from "./workspace-members/annotations-webhooks-alerts.js";
export {
  validateBookmarkParamsSchema,
  type ValidateBookmarkParamsSchemaOptions,
  type WorkspaceGetBookmarkHistoryOptions,
  type WorkspaceListBookmarksV2Options,
  type WorkspaceListCohortsFullOptions,
} from "./workspace-members/bookmarks-cohorts.js";
export type {
  WorkspaceListBlueprintTemplatesOptions,
  WorkspaceListDashboardsOptions,
} from "./workspace-members/dashboards.js";
export type {
  WorkspaceConcludeExperimentOptions,
  WorkspaceGetFlagHistoryOptions,
  WorkspaceListExperimentsOptions,
  WorkspaceListFeatureFlagsOptions,
} from "./workspace-members/flags-experiments.js";
export type {
  WorkspaceDownloadLookupTableOptions,
  WorkspaceListLookupTablesOptions,
  WorkspaceUploadLookupTableOptions,
} from "./workspace-members/governance-data.js";
export type {
  WorkspaceExportLexiconOptions,
  WorkspaceGetEventDefinitionsOptions,
  WorkspaceGetPropertyDefinitionsOptions,
} from "./workspace-members/lexicon-tracking.js";
export type {
  BusinessContextLevel,
  BusinessContextScopeOptions,
} from "./workspace-members/lifecycle.js";
export type {
  WorkspaceDeleteSchemasOptions,
  WorkspaceGetSchemaEnforcementOptions,
  WorkspaceListDataVolumeAnomaliesOptions,
  WorkspaceListSchemaRegistryOptions,
} from "./workspace-members/schemas-audit.js";

// ── Client — factory, option types, JSON model, endpoints, /me models ───
export {
  type ClientAppRequestOptions,
  type ClientCore,
  type ClientRequestOptions,
  type ClientUseOptions,
  createMixpanelClient,
  type CustomHeaderEnvSource,
  type HttpHandle,
  type MixpanelClient,
  type MixpanelClientOptions,
  type QueryHostRequestOptions,
} from "./client/client.js";
export {
  type EntryPoint,
  getEntryPoint,
  setEntryPoint,
} from "./client/headers.js";
export {
  JsonNumber,
  type JsonValue,
  toNativeJson,
} from "./client/json-value.js";
export {
  LosslessJsonError,
  parseLossless,
  type ParseLosslessOptions,
} from "./client/lossless-json.js";
export {
  MeOrgInfo,
  type MeOrgInfoInit,
  MeProjectInfo,
  type MeProjectInfoInit,
  MeResponse,
  type MeResponseInit,
  MeWorkspaceInfo,
  type MeWorkspaceInfoInit,
  type WorkspaceResolver,
  type WorkspaceView,
} from "./client/me.js";
export {
  type EndpointKind,
  type EndpointOverrides,
  endpointOverridesFromEnv,
  type EndpointOverridesSource,
  ENDPOINTS,
} from "./client/url.js";

// ── Errors, Secret, coercion ────────────────────────────────────────────
export {
  coerceBool,
  coerceFloat,
  coerceInt,
  coerceInt64,
  type CoerceKind,
  type CoerceOptions,
  coerceStr,
  resolveWithDefault,
} from "./coerce.js";
export {
  AccountExistsError,
  AccountInUseError,
  AccountNotFoundError,
  APIError,
  type APIErrorOptions,
  AuthenticationError,
  type AuthenticationErrorOptions,
  BookmarkValidationError,
  BusinessContextValidationError,
  ConfigError,
  DateRangeTooLargeError,
  type ErrorDict,
  EventNotFoundError,
  InvalidArgumentError,
  type InvalidArgumentErrorOptions,
  type InvalidArgumentViolation,
  MixpanelHeadlessError,
  OAuthError,
  ParamTypeError,
  ParamValidationError,
  ProjectNotFoundError,
  QueryError,
  type QueryErrorOptions,
  RateLimitError,
  type RateLimitErrorOptions,
  type RegionProbeAttempt,
  RegionProbeError,
  type RegionProbeErrorOptions,
  RegionProbeNetworkError,
  ReplayNotFoundError,
  ReportLinkError,
  type ReportLinkErrorOptions,
  ReportLinkNotFoundError,
  ReportLinkParseError,
  ReportLinkScopeMismatchError,
  ResponseValidationError,
  ServerError,
  type ServerErrorOptions,
  SessionReplayAccessError,
  SessionReplayError,
  type SessionReplayErrorOptions,
  ShortLinkResolutionError,
  SignedURLExpiredError,
  UnsupportedReplayFormatError,
  UnsupportedReportLinkError,
  ValidationError,
  type ValidationSeverity,
  WorkspaceScopeError,
} from "./errors.js";
export { Secret } from "./secret.js";

// ── Entity models (App API request/response dataclasses) ────────────────
export {
  AccountSummary,
  type AccountSummaryInit,
  AccountTestResult,
  type AccountTestResultInit,
  OAuthLoginResult,
  type OAuthLoginResultInit,
  Target,
  type TargetInit,
} from "./types/entities/accounts.js";
export {
  AlertBookmark,
  type AlertBookmarkInit,
  AlertCount,
  type AlertCountInit,
  AlertCreator,
  type AlertCreatorInit,
  AlertHistoryPagination,
  type AlertHistoryPaginationInit,
  AlertHistoryResponse,
  type AlertHistoryResponseInit,
  AlertProject,
  type AlertProjectInit,
  AlertScreenshotResponse,
  type AlertScreenshotResponseInit,
  AlertValidation,
  type AlertValidationInit,
  AlertWorkspace,
  type AlertWorkspaceInit,
  CreateAlertParams,
  type CreateAlertParamsInit,
  CustomAlert,
  type CustomAlertInit,
  UpdateAlertParams,
  type UpdateAlertParamsInit,
  ValidateAlertsForBookmarkParams,
  type ValidateAlertsForBookmarkParamsInit,
  ValidateAlertsForBookmarkResponse,
  type ValidateAlertsForBookmarkResponseInit,
} from "./types/entities/alerts.js";
export {
  Annotation,
  type AnnotationInit,
  AnnotationTag,
  type AnnotationTagInit,
  AnnotationUser,
  type AnnotationUserInit,
  CreateAnnotationParams,
  type CreateAnnotationParamsInit,
  CreateAnnotationTagParams,
  type CreateAnnotationTagParamsInit,
  UpdateAnnotationParams,
  type UpdateAnnotationParamsInit,
} from "./types/entities/annotations.js";
export {
  Bookmark,
  BookmarkHistoryPagination,
  type BookmarkHistoryPaginationInit,
  BookmarkHistoryResponse,
  type BookmarkHistoryResponseInit,
  type BookmarkInit,
  BookmarkMetadata,
  type BookmarkMetadataInit,
  BookmarkUrl,
  type BookmarkUrlInit,
  BulkUpdateBookmarkEntry,
  type BulkUpdateBookmarkEntryInit,
  CreateBookmarkParams,
  type CreateBookmarkParamsInit,
  UpdateBookmarkParams,
  type UpdateBookmarkParamsInit,
} from "./types/entities/bookmarks.js";
export {
  BUSINESS_CONTEXT_MAX_CHARS,
  BusinessContext,
  BusinessContextChain,
  type BusinessContextChainInit,
  type BusinessContextInit,
} from "./types/entities/business-context.js";
export {
  BulkUpdateCohortEntry,
  type BulkUpdateCohortEntryInit,
  Cohort,
  CohortCreator,
  type CohortCreatorInit,
  type CohortInit,
  CreateCohortParams,
  type CreateCohortParamsInit,
  UpdateCohortParams,
  type UpdateCohortParamsInit,
} from "./types/entities/cohorts.js";
export {
  CursorPagination,
  type CursorPaginationInit,
  PaginatedResponse,
  type PaginatedResponseInit,
  PublicWorkspace,
  type PublicWorkspaceInit,
} from "./types/entities/common.js";
export {
  BlueprintCard,
  type BlueprintCardInit,
  BlueprintConfig,
  type BlueprintConfigInit,
  BlueprintFinishParams,
  type BlueprintFinishParamsInit,
  BlueprintTemplate,
  type BlueprintTemplateInit,
  CreateDashboardParams,
  type CreateDashboardParamsInit,
  CreateRcaDashboardParams,
  type CreateRcaDashboardParamsInit,
  Dashboard,
  type DashboardInit,
  DashboardRow,
  DashboardRowContent,
  type DashboardRowContentInit,
  type DashboardRowInit,
  RcaSourceData,
  type RcaSourceDataInit,
  UpdateDashboardParams,
  type UpdateDashboardParamsInit,
  UpdateReportLinkParams,
  type UpdateReportLinkParamsInit,
  UpdateTextCardParams,
  type UpdateTextCardParamsInit,
} from "./types/entities/dashboards.js";
export {
  ComposedPropertyValue,
  type ComposedPropertyValueInit,
  CreateCustomEventParams,
  type CreateCustomEventParamsInit,
  CreateCustomPropertyParams,
  type CreateCustomPropertyParamsInit,
  CreateDropFilterParams,
  type CreateDropFilterParamsInit,
  CustomEvent,
  CustomEventAlternative,
  type CustomEventAlternativeInit,
  type CustomEventInit,
  CustomProperty,
  type CustomPropertyInit,
  DropFilter,
  type DropFilterInit,
  DropFilterLimitsResponse,
  type DropFilterLimitsResponseInit,
  LookupTable,
  type LookupTableInit,
  LookupTableUploadUrl,
  type LookupTableUploadUrlInit,
  MarkLookupTableReadyParams,
  type MarkLookupTableReadyParamsInit,
  UpdateCustomPropertyParams,
  type UpdateCustomPropertyParamsInit,
  UpdateDropFilterParams,
  type UpdateDropFilterParamsInit,
  UpdateLookupTableParams,
  type UpdateLookupTableParamsInit,
  UploadLookupTableParams,
  type UploadLookupTableParamsInit,
} from "./types/entities/data-governance.js";
export {
  CreateExperimentParams,
  type CreateExperimentParamsInit,
  DuplicateExperimentParams,
  type DuplicateExperimentParamsInit,
  Experiment,
  ExperimentConcludeParams,
  type ExperimentConcludeParamsInit,
  ExperimentCreator,
  type ExperimentCreatorInit,
  ExperimentDecideParams,
  type ExperimentDecideParamsInit,
  type ExperimentInit,
  UpdateExperimentParams,
  type UpdateExperimentParamsInit,
} from "./types/entities/experiments.js";
export {
  CreateFeatureFlagParams,
  type CreateFeatureFlagParamsInit,
  FeatureFlag,
  type FeatureFlagInit,
  FlagHistoryParams,
  type FlagHistoryParamsInit,
  FlagHistoryResponse,
  type FlagHistoryResponseInit,
  FlagLimitsResponse,
  type FlagLimitsResponseInit,
  SetTestUsersParams,
  type SetTestUsersParamsInit,
  UpdateFeatureFlagParams,
  type UpdateFeatureFlagParamsInit,
} from "./types/entities/feature-flags.js";
export {
  BulkEventUpdate,
  type BulkEventUpdateInit,
  BulkPropertyUpdate,
  type BulkPropertyUpdateInit,
  BulkUpdateEventsParams,
  type BulkUpdateEventsParamsInit,
  BulkUpdatePropertiesParams,
  type BulkUpdatePropertiesParamsInit,
  CreateTagParams,
  type CreateTagParamsInit,
  EventDefinition,
  type EventDefinitionInit,
  LexiconTag,
  type LexiconTagInit,
  PropertyDefinition,
  type PropertyDefinitionInit,
  UpdateEventDefinitionParams,
  type UpdateEventDefinitionParamsInit,
  UpdatePropertyDefinitionParams,
  type UpdatePropertyDefinitionParamsInit,
  UpdateTagParams,
  type UpdateTagParamsInit,
} from "./types/entities/lexicon.js";
export {
  AuditResponse,
  type AuditResponseInit,
  AuditViolation,
  type AuditViolationInit,
  BulkAnomalyEntry,
  type BulkAnomalyEntryInit,
  BulkCreateSchemasParams,
  type BulkCreateSchemasParamsInit,
  BulkCreateSchemasResponse,
  type BulkCreateSchemasResponseInit,
  BulkPatchResult,
  type BulkPatchResultInit,
  BulkUpdateAnomalyParams,
  type BulkUpdateAnomalyParamsInit,
  CreateDeletionRequestParams,
  type CreateDeletionRequestParamsInit,
  DataVolumeAnomaly,
  type DataVolumeAnomalyInit,
  DeleteSchemasResponse,
  type DeleteSchemasResponseInit,
  EventDeletionRequest,
  type EventDeletionRequestInit,
  InitSchemaEnforcementParams,
  type InitSchemaEnforcementParamsInit,
  PreviewDeletionFiltersParams,
  type PreviewDeletionFiltersParamsInit,
  ReplaceSchemaEnforcementParams,
  type ReplaceSchemaEnforcementParamsInit,
  SchemaEnforcementConfig,
  type SchemaEnforcementConfigInit,
  SchemaEntry,
  type SchemaEntryInit,
  UpdateAnomalyParams,
  type UpdateAnomalyParamsInit,
  UpdateSchemaEnforcementParams,
  type UpdateSchemaEnforcementParamsInit,
} from "./types/entities/schemas.js";
export {
  CreateWebhookParams,
  type CreateWebhookParamsInit,
  ProjectWebhook,
  type ProjectWebhookInit,
  UpdateWebhookParams,
  type UpdateWebhookParamsInit,
  WebhookMutationResult,
  type WebhookMutationResultInit,
  WebhookTestParams,
  type WebhookTestParamsInit,
  WebhookTestResult,
  type WebhookTestResultInit,
} from "./types/entities/webhooks.js";

// ── Result models ───────────────────────────────────────────────────────
export {
  ReportLink,
  type ReportLinkFields,
  type ReportLinkQueryResult,
  ResolvedReport,
  type ResolvedReportFields,
} from "./types/report-links.js";
export {
  BookmarkInfo,
  type BookmarkInfoFields,
  FunnelInfo,
  type FunnelInfoFields,
  LexiconDefinition,
  type LexiconDefinitionFields,
  LexiconMetadata,
  type LexiconMetadataFields,
  LexiconProperty,
  type LexiconPropertyFields,
  LexiconSchema,
  type LexiconSchemaFields,
  ProfilePageResult,
  type ProfilePageResultFields,
  SavedCohort,
  type SavedCohortFields,
  SchemaGraphResult,
  type SchemaGraphResultFields,
  SubPropertyInfo,
  type SubPropertyInfoFields,
  TopEvent,
  type TopEventFields,
} from "./types/results/discovery.js";
export {
  ActivityFeedResult,
  type ActivityFeedResultFields,
  CohortInfo,
  type CohortInfoFields,
  EventCountsResult,
  type EventCountsResultFields,
  FlowsResult,
  type FlowsResultFields,
  FrequencyResult,
  type FrequencyResultFields,
  FunnelResult,
  type FunnelResultFields,
  FunnelResultStep,
  type FunnelResultStepFields,
  NumericAverageResult,
  type NumericAverageResultFields,
  NumericBucketResult,
  type NumericBucketResultFields,
  NumericSumResult,
  type NumericSumResultFields,
  PropertyCountsResult,
  type PropertyCountsResultFields,
  RetentionResult,
  type RetentionResultFields,
  SavedReportResult,
  type SavedReportResultFields,
  SegmentationResult,
  type SegmentationResultFields,
  UserEvent,
  type UserEventFields,
} from "./types/results/live-query.js";
export {
  FlowQueryResult,
  type FlowQueryResultFields,
  FlowTreeNode,
  type FlowTreeNodeFields,
  FunnelQueryResult,
  type FunnelQueryResultFields,
  QueryResult,
  type QueryResultFields,
  RetentionQueryResult,
  type RetentionQueryResultFields,
  type UserQueryMode,
  UserQueryResult,
  type UserQueryResultFields,
} from "./types/results/query-engine.js";
export {
  Replay,
  ReplayBundle,
  type ReplayBundleFields,
  ReplayEvent,
  type ReplayEventFields,
  type ReplayFields,
  ReplaySummary,
  type ReplaySummaryFields,
  SignedReplay,
  type SignedReplayFields,
  UserAction,
  type UserActionFields,
} from "./types/results/replays.js";
export type {
  FlowEdge,
  FlowStepNode,
  FunnelStepData,
  QueryMeta,
  RetentionCohortData,
} from "./types/results/typed-dicts.js";

// ── Query vocabulary (`types/query-params`) ─────────────────────────────
export {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  type DidEventOptions,
  type DidNotDoEventOptions,
  type HasPropertyOperator,
  type HasPropertyType,
} from "./types/query-params/cohort.js";
export {
  CustomPropertyRef,
  Filter,
  type FilterFields,
  type FilterValue,
  InlineCustomProperty,
  ListItemGroupMode,
  PropertyInput,
  type PropertySpec,
} from "./types/query-params/filter.js";
export { FlowStep, type FlowStepFields } from "./types/query-params/flow.js";
export {
  FrequencyBreakdown,
  type FrequencyBreakdownFields,
  FrequencyFilter,
  type FrequencyFilterFields,
} from "./types/query-params/frequency.js";
export {
  Exclusion,
  type ExclusionFields,
  FunnelStep,
  type FunnelStepFields,
  HoldingConstant,
  type HoldingConstantFields,
} from "./types/query-params/funnel.js";
export { GroupBy, type GroupByFields } from "./types/query-params/group-by.js";
export {
  CohortMetric,
  Formula,
  Metric,
  type MetricFields,
  TimeComparison,
} from "./types/query-params/metric.js";
export {
  RetentionEvent,
  type RetentionEventFields,
} from "./types/query-params/retention.js";

// ── Literal unions, membership tuples, enums ────────────────────────────
export {
  AlertFrequencyPreset,
  CustomPropertyResourceType,
  type EnumTableEntry,
  ExperimentStatus,
  FeatureFlagStatus,
  FlagContractStatus,
  PropertyResourceType,
  ServingMethod,
  WebhookAuthType,
} from "./types/enums.js";
export {
  ACCOUNT_TYPE_VALUES,
  type AccountType,
  BOOKMARK_TYPE_VALUES,
  type BookmarkType,
  COHORT_AGGREGATION_TYPE_VALUES,
  type CohortAggregationType,
  CONVERSION_WINDOW_UNIT_VALUES,
  type ConversionWindowUnit,
  COUNT_TYPE_VALUES,
  type CountType,
  CUSTOM_PROPERTY_TYPE_VALUES,
  type CustomPropertyType,
  ENTITY_TYPE_VALUES,
  type EntityType,
  FILTER_DATE_UNIT_VALUES,
  FILTER_OPERATOR_VALUES,
  FILTER_PROPERTY_TYPE_VALUES,
  type FilterDateUnit,
  type FilterOperator,
  type FilterOperatorInput,
  type FilterPropertyType,
  FILTERS_COMBINATOR_VALUES,
  type FiltersCombinator,
  FLOW_ANCHOR_TYPE_VALUES,
  FLOW_CHART_TYPE_VALUES,
  FLOW_CONVERSION_WINDOW_UNIT_VALUES,
  FLOW_COUNT_TYPE_VALUES,
  FLOW_NODE_TYPE_VALUES,
  FLOW_SESSION_EVENT_VALUES,
  type FlowAnchorType,
  type FlowChartType,
  type FlowConversionWindowUnit,
  type FlowCountType,
  type FlowNodeType,
  type FlowSessionEvent,
  FREQUENCY_FILTER_OPERATOR_VALUES,
  type FrequencyFilterOperator,
  FUNNEL_MATH_TYPE_VALUES,
  FUNNEL_MODE_VALUES,
  FUNNEL_ORDER_VALUES,
  FUNNEL_REENTRY_MODE_VALUES,
  type FunnelMathType,
  type FunnelMode,
  type FunnelOrder,
  type FunnelReentryMode,
  HOUR_DAY_UNIT_VALUES,
  type HourDayUnit,
  INSIGHTS_MODE_VALUES,
  type InsightsMode,
  MATH_TYPE_VALUES,
  type MathType,
  PER_USER_AGGREGATION_VALUES,
  type PerUserAggregation,
  QUERY_TIME_UNIT_VALUES,
  type QueryTimeUnit,
  type Region,
  REGION_VALUES,
  REPORT_LINK_TYPE_VALUES,
  type ReportLinkType,
  RETENTION_ALIGNMENT_VALUES,
  RETENTION_MATH_TYPE_VALUES,
  RETENTION_MODE_VALUES,
  RETENTION_UNBOUNDED_MODE_VALUES,
  type RetentionAlignment,
  type RetentionMathType,
  type RetentionMode,
  type RetentionUnboundedMode,
  SAVED_REPORT_TYPE_VALUES,
  type SavedReportType,
  SEGMENT_METHOD_VALUES,
  type SegmentMethod,
  TIME_COMPARISON_TYPE_VALUES,
  TIME_COMPARISON_UNIT_VALUES,
  TIME_UNIT_VALUES,
  type TimeComparisonType,
  type TimeComparisonUnit,
  type TimeUnit,
} from "./types/literals.js";

// ── Auth — accounts, sessions, tokens, OAuth primitives, resolver, region probe
export {
  type Account,
  accountAuthHeader,
  type AccountAuthHeaderOptions,
  type AccountName,
  isLongLived,
  type OAuthBrowserAccount,
  type OAuthTokenAccount,
  parseAccount,
  type ParseAccountOptions,
  type ProjectId,
  type ServiceAccount,
  type TargetName,
  type TokenResolver,
  type WorkspaceId,
} from "./auth/account.js";
export {
  CREDENTIAL_KEYS,
  type CredentialStore,
} from "./auth/credential-store.js";
export { DEFAULT_SCOPE, OAUTH_BASE_URLS } from "./auth/oauth-constants.js";
export {
  buildAuthorizeUrl,
  postTokenRequest,
  type PostTokenRequestContext,
  registerClient,
  type RegisterClientOptions,
} from "./auth/oauth-http.js";
export { PkceChallenge } from "./auth/pkce.js";
export { CallbackResult, parsePastedRedirect } from "./auth/redirect-parse.js";
export {
  type ClientFactory,
  type ProbeClient,
  probeRegion,
  probeRegionForCredential,
  type ProbeRegionForCredentialOptions,
  type ProbeRegionOptions,
  type ProbeResponse,
  type RegionProbeResult,
} from "./auth/region-probe.js";
export {
  type BridgeView,
  type ResolverConfigSource,
  type ResolverEnv,
  type ResolverSources,
  resolveSession,
  type ResolveSessionOptions,
} from "./auth/resolver.js";
export {
  type ActiveSession,
  parseActiveSession,
  parseProject,
  parseSession,
  parseWorkspaceRef,
  type Project,
  type Session,
  sessionAuthHeader,
  sessionReplace,
  type SessionReplaceUpdate,
  type WorkspaceRef,
} from "./auth/session.js";
export {
  type OAuthClientInfo,
  OAuthTokens,
  type OAuthTokensFields,
  parseOAuthClientInfo,
  parseOAuthTokens,
  pythonUtcIsoformat,
  type TokenClockOptions,
} from "./auth/token.js";

// ── Accounts — the injectable effects contract and namespace factories ──
export {
  type AddAccountParams,
  type AddTargetOptions,
  type ApplySessionUpdate,
  type AuthEffects,
  type BridgeEffects,
  type ConfigWrites,
  defaultAuthEffects,
  type MeCacheEffects,
  type OAuthFlowEffects,
  type SetActiveUpdate,
  type TokenStore,
  UNPORTED_AUTH_SEAMS,
  type UpdateAccountFields,
} from "./accounts/auth-effects.js";
export {
  loginUnified,
  type LoginUnifiedOptions,
} from "./accounts/login-unified.js";
export {
  type AccountsNamespace,
  createAccountsNamespace,
} from "./accounts/namespace.js";
export {
  createSessionNamespace,
  type SessionNamespace,
  type SessionUseOptions,
} from "./accounts/session-namespace.js";
export {
  createTargetsNamespace,
  type TargetsAddOptions,
  type TargetsNamespace,
} from "./accounts/targets-namespace.js";

// ── Public members of `query/`, `replays/`, `bookmarks/` ────────────────
export { inferBookmarkType } from "./bookmarks/infer-type.js";
export {
  validateBookmark,
  type ValidateBookmarkOptions,
} from "./query/validation-bookmark.js";
export {
  defaultLabelFn,
  selectorLabelFn,
  urlNormalizer,
} from "./replays/replay-labels.js";

// ── Python-parity helpers (`compat/`) ───────────────────────────────────
export {
  codepoints,
  compareCodepoints,
  compareCodeUnits,
  cpLength,
  cpSlice,
  sortedByCodepoint,
} from "./compat/codepoint.js";
export { isPythonDict } from "./compat/python-dict.js";
export { pythonFloat } from "./compat/python-float.js";
export { pythonFloatCoerce } from "./compat/python-float-coerce.js";
export { pythonFloatStr } from "./compat/python-float-str.js";
export { pythonInt, pythonIntCoerce } from "./compat/python-int.js";
export { pythonJsonDumps } from "./compat/python-json-dumps.js";
export { pythonJsonDumpsCanonical } from "./compat/python-json-dumps-canonical.js";
export {
  pythonRepr,
  pythonStr,
  type PythonValue,
} from "./compat/python-str.js";
export { pythonStrip } from "./compat/python-strip.js";
export {
  type SplitResult,
  urljoin,
  urlsplit,
  UrlSplitError,
  urlunsplit,
} from "./compat/urllib.js";
export { zfill } from "./compat/zfill.js";

/** Package name constant exercised by the skeleton smoke test. */
export const CORE_PACKAGE_NAME = "@mixpanel-headless/core";
