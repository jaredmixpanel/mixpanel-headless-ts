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
export {
  Workspace,
  type ReportLinkParamsInput,
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

// ── Client — factory, option types, JSON model, endpoints, /me models ───
export {
  createMixpanelClient,
  type ClientAppRequestOptions,
  type ClientCore,
  type ClientRequestOptions,
  type ClientUseOptions,
  type CustomHeaderEnvSource,
  type HttpHandle,
  type MixpanelClient,
  type MixpanelClientOptions,
  type QueryHostRequestOptions,
} from "./client/client.js";
export {
  getEntryPoint,
  setEntryPoint,
  type EntryPoint,
} from "./client/headers.js";
export {
  JsonNumber,
  toNativeJson,
  type JsonValue,
} from "./client/json-value.js";
export {
  LosslessJsonError,
  parseLossless,
  type ParseLosslessOptions,
} from "./client/lossless-json.js";
export {
  MeOrgInfo,
  MeProjectInfo,
  MeResponse,
  MeWorkspaceInfo,
  type MeOrgInfoInit,
  type MeProjectInfoInit,
  type MeResponseInit,
  type MeWorkspaceInfoInit,
  type WorkspaceResolver,
  type WorkspaceView,
} from "./client/me.js";
export {
  ENDPOINTS,
  endpointOverridesFromEnv,
  type EndpointKind,
  type EndpointOverrides,
  type EndpointOverridesSource,
} from "./client/url.js";

// ── Errors, Secret, coercion ────────────────────────────────────────────
export {
  coerceBool,
  coerceFloat,
  coerceInt,
  coerceInt64,
  coerceStr,
  resolveWithDefault,
  type CoerceKind,
  type CoerceOptions,
} from "./coerce.js";
export {
  APIError,
  AccountExistsError,
  AccountInUseError,
  AccountNotFoundError,
  AuthenticationError,
  BookmarkValidationError,
  BusinessContextValidationError,
  ConfigError,
  DateRangeTooLargeError,
  EventNotFoundError,
  InvalidArgumentError,
  MixpanelHeadlessError,
  OAuthError,
  ParamTypeError,
  ParamValidationError,
  ProjectNotFoundError,
  QueryError,
  RateLimitError,
  RegionProbeError,
  RegionProbeNetworkError,
  ReplayNotFoundError,
  ReportLinkError,
  ReportLinkNotFoundError,
  ReportLinkParseError,
  ReportLinkScopeMismatchError,
  ResponseValidationError,
  ServerError,
  SessionReplayAccessError,
  SessionReplayError,
  ShortLinkResolutionError,
  SignedURLExpiredError,
  UnsupportedReplayFormatError,
  UnsupportedReportLinkError,
  ValidationError,
  WorkspaceScopeError,
  type APIErrorOptions,
  type AuthenticationErrorOptions,
  type ErrorDict,
  type InvalidArgumentErrorOptions,
  type InvalidArgumentViolation,
  type QueryErrorOptions,
  type RateLimitErrorOptions,
  type RegionProbeAttempt,
  type RegionProbeErrorOptions,
  type ReportLinkErrorOptions,
  type ServerErrorOptions,
  type SessionReplayErrorOptions,
  type ValidationSeverity,
} from "./errors.js";
export { Secret } from "./secret.js";

// ── Entity models (App API request/response dataclasses) ────────────────
export {
  AccountSummary,
  AccountTestResult,
  OAuthLoginResult,
  Target,
  type AccountSummaryInit,
  type AccountTestResultInit,
  type OAuthLoginResultInit,
  type TargetInit,
} from "./types/entities/accounts.js";
export {
  AlertBookmark,
  AlertCount,
  AlertCreator,
  AlertHistoryPagination,
  AlertHistoryResponse,
  AlertProject,
  AlertScreenshotResponse,
  AlertValidation,
  AlertWorkspace,
  CreateAlertParams,
  CustomAlert,
  UpdateAlertParams,
  ValidateAlertsForBookmarkParams,
  ValidateAlertsForBookmarkResponse,
  type AlertBookmarkInit,
  type AlertCountInit,
  type AlertCreatorInit,
  type AlertHistoryPaginationInit,
  type AlertHistoryResponseInit,
  type AlertProjectInit,
  type AlertScreenshotResponseInit,
  type AlertValidationInit,
  type AlertWorkspaceInit,
  type CreateAlertParamsInit,
  type CustomAlertInit,
  type UpdateAlertParamsInit,
  type ValidateAlertsForBookmarkParamsInit,
  type ValidateAlertsForBookmarkResponseInit,
} from "./types/entities/alerts.js";
export {
  Annotation,
  AnnotationTag,
  AnnotationUser,
  CreateAnnotationParams,
  CreateAnnotationTagParams,
  UpdateAnnotationParams,
  type AnnotationInit,
  type AnnotationTagInit,
  type AnnotationUserInit,
  type CreateAnnotationParamsInit,
  type CreateAnnotationTagParamsInit,
  type UpdateAnnotationParamsInit,
} from "./types/entities/annotations.js";
export {
  Bookmark,
  BookmarkHistoryPagination,
  BookmarkHistoryResponse,
  BookmarkMetadata,
  BookmarkUrl,
  BulkUpdateBookmarkEntry,
  CreateBookmarkParams,
  UpdateBookmarkParams,
  type BookmarkHistoryPaginationInit,
  type BookmarkHistoryResponseInit,
  type BookmarkInit,
  type BookmarkMetadataInit,
  type BookmarkUrlInit,
  type BulkUpdateBookmarkEntryInit,
  type CreateBookmarkParamsInit,
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
  Cohort,
  CohortCreator,
  CreateCohortParams,
  UpdateCohortParams,
  type BulkUpdateCohortEntryInit,
  type CohortCreatorInit,
  type CohortInit,
  type CreateCohortParamsInit,
  type UpdateCohortParamsInit,
} from "./types/entities/cohorts.js";
export {
  CursorPagination,
  PaginatedResponse,
  PublicWorkspace,
  type CursorPaginationInit,
  type PaginatedResponseInit,
  type PublicWorkspaceInit,
} from "./types/entities/common.js";
export {
  BlueprintCard,
  BlueprintConfig,
  BlueprintFinishParams,
  BlueprintTemplate,
  CreateDashboardParams,
  CreateRcaDashboardParams,
  Dashboard,
  DashboardRow,
  DashboardRowContent,
  RcaSourceData,
  UpdateDashboardParams,
  UpdateReportLinkParams,
  UpdateTextCardParams,
  type BlueprintCardInit,
  type BlueprintConfigInit,
  type BlueprintFinishParamsInit,
  type BlueprintTemplateInit,
  type CreateDashboardParamsInit,
  type CreateRcaDashboardParamsInit,
  type DashboardInit,
  type DashboardRowContentInit,
  type DashboardRowInit,
  type RcaSourceDataInit,
  type UpdateDashboardParamsInit,
  type UpdateReportLinkParamsInit,
  type UpdateTextCardParamsInit,
} from "./types/entities/dashboards.js";
export {
  ComposedPropertyValue,
  CreateCustomEventParams,
  CreateCustomPropertyParams,
  CreateDropFilterParams,
  CustomEvent,
  CustomEventAlternative,
  CustomProperty,
  DropFilter,
  DropFilterLimitsResponse,
  LookupTable,
  LookupTableUploadUrl,
  MarkLookupTableReadyParams,
  UpdateCustomPropertyParams,
  UpdateDropFilterParams,
  UpdateLookupTableParams,
  UploadLookupTableParams,
  type ComposedPropertyValueInit,
  type CreateCustomEventParamsInit,
  type CreateCustomPropertyParamsInit,
  type CreateDropFilterParamsInit,
  type CustomEventAlternativeInit,
  type CustomEventInit,
  type CustomPropertyInit,
  type DropFilterInit,
  type DropFilterLimitsResponseInit,
  type LookupTableInit,
  type LookupTableUploadUrlInit,
  type MarkLookupTableReadyParamsInit,
  type UpdateCustomPropertyParamsInit,
  type UpdateDropFilterParamsInit,
  type UpdateLookupTableParamsInit,
  type UploadLookupTableParamsInit,
} from "./types/entities/data-governance.js";
export {
  CreateExperimentParams,
  DuplicateExperimentParams,
  Experiment,
  ExperimentConcludeParams,
  ExperimentCreator,
  ExperimentDecideParams,
  UpdateExperimentParams,
  type CreateExperimentParamsInit,
  type DuplicateExperimentParamsInit,
  type ExperimentConcludeParamsInit,
  type ExperimentCreatorInit,
  type ExperimentDecideParamsInit,
  type ExperimentInit,
  type UpdateExperimentParamsInit,
} from "./types/entities/experiments.js";
export {
  CreateFeatureFlagParams,
  FeatureFlag,
  FlagHistoryParams,
  FlagHistoryResponse,
  FlagLimitsResponse,
  SetTestUsersParams,
  UpdateFeatureFlagParams,
  type CreateFeatureFlagParamsInit,
  type FeatureFlagInit,
  type FlagHistoryParamsInit,
  type FlagHistoryResponseInit,
  type FlagLimitsResponseInit,
  type SetTestUsersParamsInit,
  type UpdateFeatureFlagParamsInit,
} from "./types/entities/feature-flags.js";
export {
  BulkEventUpdate,
  BulkPropertyUpdate,
  BulkUpdateEventsParams,
  BulkUpdatePropertiesParams,
  CreateTagParams,
  EventDefinition,
  LexiconTag,
  PropertyDefinition,
  UpdateEventDefinitionParams,
  UpdatePropertyDefinitionParams,
  UpdateTagParams,
  type BulkEventUpdateInit,
  type BulkPropertyUpdateInit,
  type BulkUpdateEventsParamsInit,
  type BulkUpdatePropertiesParamsInit,
  type CreateTagParamsInit,
  type EventDefinitionInit,
  type LexiconTagInit,
  type PropertyDefinitionInit,
  type UpdateEventDefinitionParamsInit,
  type UpdatePropertyDefinitionParamsInit,
  type UpdateTagParamsInit,
} from "./types/entities/lexicon.js";
export {
  AuditResponse,
  AuditViolation,
  BulkAnomalyEntry,
  BulkCreateSchemasParams,
  BulkCreateSchemasResponse,
  BulkPatchResult,
  BulkUpdateAnomalyParams,
  CreateDeletionRequestParams,
  DataVolumeAnomaly,
  DeleteSchemasResponse,
  EventDeletionRequest,
  InitSchemaEnforcementParams,
  PreviewDeletionFiltersParams,
  ReplaceSchemaEnforcementParams,
  SchemaEnforcementConfig,
  SchemaEntry,
  UpdateAnomalyParams,
  UpdateSchemaEnforcementParams,
  type AuditResponseInit,
  type AuditViolationInit,
  type BulkAnomalyEntryInit,
  type BulkCreateSchemasParamsInit,
  type BulkCreateSchemasResponseInit,
  type BulkPatchResultInit,
  type BulkUpdateAnomalyParamsInit,
  type CreateDeletionRequestParamsInit,
  type DataVolumeAnomalyInit,
  type DeleteSchemasResponseInit,
  type EventDeletionRequestInit,
  type InitSchemaEnforcementParamsInit,
  type PreviewDeletionFiltersParamsInit,
  type ReplaceSchemaEnforcementParamsInit,
  type SchemaEnforcementConfigInit,
  type SchemaEntryInit,
  type UpdateAnomalyParamsInit,
  type UpdateSchemaEnforcementParamsInit,
} from "./types/entities/schemas.js";
export {
  CreateWebhookParams,
  ProjectWebhook,
  UpdateWebhookParams,
  WebhookMutationResult,
  WebhookTestParams,
  WebhookTestResult,
  type CreateWebhookParamsInit,
  type ProjectWebhookInit,
  type UpdateWebhookParamsInit,
  type WebhookMutationResultInit,
  type WebhookTestParamsInit,
  type WebhookTestResultInit,
} from "./types/entities/webhooks.js";

// ── Result models ───────────────────────────────────────────────────────
export {
  ReportLink,
  ResolvedReport,
  type ReportLinkFields,
  type ReportLinkQueryResult,
  type ResolvedReportFields,
} from "./types/report-links.js";
export {
  BookmarkInfo,
  FunnelInfo,
  LexiconDefinition,
  LexiconMetadata,
  LexiconProperty,
  LexiconSchema,
  ProfilePageResult,
  SavedCohort,
  SchemaGraphResult,
  SubPropertyInfo,
  TopEvent,
  type BookmarkInfoFields,
  type FunnelInfoFields,
  type LexiconDefinitionFields,
  type LexiconMetadataFields,
  type LexiconPropertyFields,
  type LexiconSchemaFields,
  type ProfilePageResultFields,
  type SavedCohortFields,
  type SchemaGraphResultFields,
  type SubPropertyInfoFields,
  type TopEventFields,
} from "./types/results/discovery.js";
export {
  ActivityFeedResult,
  CohortInfo,
  EventCountsResult,
  FlowsResult,
  FrequencyResult,
  FunnelResult,
  FunnelResultStep,
  NumericAverageResult,
  NumericBucketResult,
  NumericSumResult,
  PropertyCountsResult,
  RetentionResult,
  SavedReportResult,
  SegmentationResult,
  UserEvent,
  type ActivityFeedResultFields,
  type CohortInfoFields,
  type EventCountsResultFields,
  type FlowsResultFields,
  type FrequencyResultFields,
  type FunnelResultFields,
  type FunnelResultStepFields,
  type NumericAverageResultFields,
  type NumericBucketResultFields,
  type NumericSumResultFields,
  type PropertyCountsResultFields,
  type RetentionResultFields,
  type SavedReportResultFields,
  type SegmentationResultFields,
  type UserEventFields,
} from "./types/results/live-query.js";
export {
  FlowQueryResult,
  FlowTreeNode,
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
  UserQueryResult,
  type FlowQueryResultFields,
  type FlowTreeNodeFields,
  type FunnelQueryResultFields,
  type QueryResultFields,
  type RetentionQueryResultFields,
  type UserQueryMode,
  type UserQueryResultFields,
} from "./types/results/query-engine.js";
export {
  Replay,
  ReplayBundle,
  ReplayEvent,
  ReplaySummary,
  SignedReplay,
  UserAction,
  type ReplayBundleFields,
  type ReplayEventFields,
  type ReplayFields,
  type ReplaySummaryFields,
  type SignedReplayFields,
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
  InlineCustomProperty,
  ListItemGroupMode,
  PropertyInput,
  type FilterFields,
  type FilterValue,
  type PropertySpec,
} from "./types/query-params/filter.js";
export { FlowStep, type FlowStepFields } from "./types/query-params/flow.js";
export {
  FrequencyBreakdown,
  FrequencyFilter,
  type FrequencyBreakdownFields,
  type FrequencyFilterFields,
} from "./types/query-params/frequency.js";
export {
  Exclusion,
  FunnelStep,
  HoldingConstant,
  type ExclusionFields,
  type FunnelStepFields,
  type HoldingConstantFields,
} from "./types/query-params/funnel.js";
export { GroupBy, type GroupByFields } from "./types/query-params/group-by.js";
export {
  CohortMetric,
  Formula,
  Metric,
  TimeComparison,
  type MetricFields,
} from "./types/query-params/metric.js";
export {
  RetentionEvent,
  type RetentionEventFields,
} from "./types/query-params/retention.js";

// ── Literal unions, membership tuples, enums ────────────────────────────
export {
  AlertFrequencyPreset,
  CustomPropertyResourceType,
  ExperimentStatus,
  FeatureFlagStatus,
  FlagContractStatus,
  PropertyResourceType,
  ServingMethod,
  WebhookAuthType,
  type EnumTableEntry,
} from "./types/enums.js";
export {
  ACCOUNT_TYPE_VALUES,
  BOOKMARK_TYPE_VALUES,
  COHORT_AGGREGATION_TYPE_VALUES,
  CONVERSION_WINDOW_UNIT_VALUES,
  COUNT_TYPE_VALUES,
  CUSTOM_PROPERTY_TYPE_VALUES,
  ENTITY_TYPE_VALUES,
  FILTERS_COMBINATOR_VALUES,
  FILTER_DATE_UNIT_VALUES,
  FILTER_OPERATOR_VALUES,
  FILTER_PROPERTY_TYPE_VALUES,
  FLOW_ANCHOR_TYPE_VALUES,
  FLOW_CHART_TYPE_VALUES,
  FLOW_CONVERSION_WINDOW_UNIT_VALUES,
  FLOW_COUNT_TYPE_VALUES,
  FLOW_NODE_TYPE_VALUES,
  FLOW_SESSION_EVENT_VALUES,
  FREQUENCY_FILTER_OPERATOR_VALUES,
  FUNNEL_MATH_TYPE_VALUES,
  FUNNEL_MODE_VALUES,
  FUNNEL_ORDER_VALUES,
  FUNNEL_REENTRY_MODE_VALUES,
  HOUR_DAY_UNIT_VALUES,
  INSIGHTS_MODE_VALUES,
  MATH_TYPE_VALUES,
  PER_USER_AGGREGATION_VALUES,
  QUERY_TIME_UNIT_VALUES,
  REGION_VALUES,
  REPORT_LINK_TYPE_VALUES,
  RETENTION_ALIGNMENT_VALUES,
  RETENTION_MATH_TYPE_VALUES,
  RETENTION_MODE_VALUES,
  RETENTION_UNBOUNDED_MODE_VALUES,
  SAVED_REPORT_TYPE_VALUES,
  SEGMENT_METHOD_VALUES,
  TIME_COMPARISON_TYPE_VALUES,
  TIME_COMPARISON_UNIT_VALUES,
  TIME_UNIT_VALUES,
  type AccountType,
  type BookmarkType,
  type CohortAggregationType,
  type ConversionWindowUnit,
  type CountType,
  type CustomPropertyType,
  type EntityType,
  type FilterDateUnit,
  type FilterOperator,
  type FilterOperatorInput,
  type FilterPropertyType,
  type FiltersCombinator,
  type FlowAnchorType,
  type FlowChartType,
  type FlowConversionWindowUnit,
  type FlowCountType,
  type FlowNodeType,
  type FlowSessionEvent,
  type FrequencyFilterOperator,
  type FunnelMathType,
  type FunnelMode,
  type FunnelOrder,
  type FunnelReentryMode,
  type HourDayUnit,
  type InsightsMode,
  type MathType,
  type PerUserAggregation,
  type QueryTimeUnit,
  type Region,
  type ReportLinkType,
  type RetentionAlignment,
  type RetentionMathType,
  type RetentionMode,
  type RetentionUnboundedMode,
  type SavedReportType,
  type SegmentMethod,
  type TimeComparisonType,
  type TimeComparisonUnit,
  type TimeUnit,
} from "./types/literals.js";

// ── Auth — accounts, sessions, tokens, OAuth primitives, resolver, region probe
export {
  accountAuthHeader,
  isLongLived,
  parseAccount,
  type Account,
  type AccountAuthHeaderOptions,
  type AccountName,
  type OAuthBrowserAccount,
  type OAuthTokenAccount,
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
  registerClient,
  type PostTokenRequestContext,
  type RegisterClientOptions,
} from "./auth/oauth-http.js";
export { PkceChallenge } from "./auth/pkce.js";
export { CallbackResult, parsePastedRedirect } from "./auth/redirect-parse.js";
export {
  probeRegion,
  probeRegionForCredential,
  type ClientFactory,
  type ProbeClient,
  type ProbeRegionForCredentialOptions,
  type ProbeRegionOptions,
  type ProbeResponse,
  type RegionProbeResult,
} from "./auth/region-probe.js";
export {
  resolveSession,
  type BridgeView,
  type ResolveSessionOptions,
  type ResolverConfigSource,
  type ResolverEnv,
  type ResolverSources,
} from "./auth/resolver.js";
export {
  parseActiveSession,
  parseProject,
  parseSession,
  parseWorkspaceRef,
  sessionAuthHeader,
  sessionReplace,
  type ActiveSession,
  type Project,
  type Session,
  type SessionReplaceUpdate,
  type WorkspaceRef,
} from "./auth/session.js";
export {
  OAuthTokens,
  parseOAuthClientInfo,
  parseOAuthTokens,
  pythonUtcIsoformat,
  type OAuthClientInfo,
  type OAuthTokensFields,
  type TokenClockOptions,
} from "./auth/token.js";

// ── Accounts — the injectable effects contract and namespace factories ──
export {
  UNPORTED_AUTH_SEAMS,
  defaultAuthEffects,
  type AddAccountParams,
  type AddTargetOptions,
  type ApplySessionUpdate,
  type AuthEffects,
  type BridgeEffects,
  type ConfigWrites,
  type MeCacheEffects,
  type OAuthFlowEffects,
  type SetActiveUpdate,
  type TokenStore,
  type UpdateAccountFields,
} from "./accounts/auth-effects.js";
export {
  loginUnified,
  type LoginUnifiedOptions,
} from "./accounts/login-unified.js";
export {
  createAccountsNamespace,
  type AccountsNamespace,
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
  compareCodepoints,
  cpLength,
  cpSlice,
  sortedByCodepoint,
} from "./compat/codepoint.js";
export { isPythonDict } from "./compat/python-dict.js";
export { pythonFloatCoerce } from "./compat/python-float-coerce.js";
export { pythonFloatStr } from "./compat/python-float-str.js";
export { pythonFloat } from "./compat/python-float.js";
export { pythonInt, pythonIntCoerce } from "./compat/python-int.js";
export { pythonJsonDumpsCanonical } from "./compat/python-json-dumps-canonical.js";
export { pythonJsonDumps } from "./compat/python-json-dumps.js";
export {
  pythonRepr,
  pythonStr,
  type PythonValue,
} from "./compat/python-str.js";
export { pythonStrip } from "./compat/python-strip.js";
export {
  UrlSplitError,
  urljoin,
  urlsplit,
  urlunsplit,
  type SplitResult,
} from "./compat/urllib.js";
export { zfill } from "./compat/zfill.js";

/** Package name constant exercised by the skeleton smoke test. */
export const CORE_PACKAGE_NAME = "@mixpanel-headless/core";
