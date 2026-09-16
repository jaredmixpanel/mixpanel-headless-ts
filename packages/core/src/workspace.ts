/**
 * The `Workspace` facade — one class carrying every public operation of
 * the Python `Workspace`: queries, discovery, session replays, lifecycle
 * and `/me`, and the entity CRUD families. The class owns the session,
 * the wire client and the lazily built services; each member is a thin
 * delegation into `workspace-members/*` (entity bodies) or
 * `workspace-query-params.ts` (the param builders), never a
 * re-implementation of what the client or a service already does.
 *
 * @see mixpanel_headless.workspace.Workspace
 */

import type { Account } from "./auth/account.js";
import { resolveSession } from "./auth/resolver.js";
import type { Project, Session, WorkspaceRef } from "./auth/session.js";
import { createMixpanelClient, type MixpanelClient } from "./client/client.js";
import type { MeResponse } from "./client/me.js";
import { pythonInt } from "./compat/python-int.js";
import { MixpanelHeadlessError } from "./errors.js";
import { generateSlug } from "./report-links.js";
import { DiscoveryService, type WarningSink } from "./services/discovery.js";
import {
  type LiveActivityFeedOptions,
  type LiveQuerySavedReportOptions,
  LiveQueryService,
} from "./services/live-query.js";
import {
  inMemoryMeCache,
  type MeCacheStore,
  MeService,
} from "./services/me.js";
import {
  streamEvents as streamEventsVeneer,
  type StreamEventsOptions,
  streamProfiles as streamProfilesVeneer,
  type StreamProfilesOptions,
} from "./services/queries/streaming.js";
import { ReplaysService } from "./services/replays.js";
import type {
  AlertCount,
  AlertHistoryResponse,
  AlertScreenshotResponse,
  CreateAlertParams,
  CustomAlert,
  UpdateAlertParams,
  ValidateAlertsForBookmarkParams,
  ValidateAlertsForBookmarkResponse,
} from "./types/entities/alerts.js";
import type {
  Annotation,
  AnnotationTag,
  CreateAnnotationParams,
  CreateAnnotationTagParams,
  UpdateAnnotationParams,
} from "./types/entities/annotations.js";
import type {
  Bookmark,
  BookmarkHistoryResponse,
  BulkUpdateBookmarkEntry,
  CreateBookmarkParams,
  UpdateBookmarkParams,
} from "./types/entities/bookmarks.js";
import type {
  BusinessContext,
  BusinessContextChain,
} from "./types/entities/business-context.js";
import type {
  BulkUpdateCohortEntry,
  Cohort,
  CreateCohortParams,
  UpdateCohortParams,
} from "./types/entities/cohorts.js";
import type { PublicWorkspace } from "./types/entities/common.js";
import type {
  BlueprintConfig,
  BlueprintFinishParams,
  BlueprintTemplate,
  CreateDashboardParams,
  CreateRcaDashboardParams,
  Dashboard,
  UpdateDashboardParams,
  UpdateReportLinkParams,
  UpdateTextCardParams,
} from "./types/entities/dashboards.js";
import type {
  CreateCustomEventParams,
  CreateCustomPropertyParams,
  CreateDropFilterParams,
  CustomEvent,
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
} from "./types/entities/data-governance.js";
import type {
  CreateExperimentParams,
  DuplicateExperimentParams,
  Experiment,
  ExperimentDecideParams,
  UpdateExperimentParams,
} from "./types/entities/experiments.js";
import type {
  CreateFeatureFlagParams,
  FeatureFlag,
  FlagHistoryResponse,
  FlagLimitsResponse,
  SetTestUsersParams,
  UpdateFeatureFlagParams,
} from "./types/entities/feature-flags.js";
import type {
  BulkUpdateEventsParams,
  BulkUpdatePropertiesParams,
  CreateTagParams,
  EventDefinition,
  LexiconTag,
  PropertyDefinition,
  UpdateEventDefinitionParams,
  UpdatePropertyDefinitionParams,
  UpdateTagParams,
} from "./types/entities/lexicon.js";
import type {
  AuditResponse,
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
} from "./types/entities/schemas.js";
import type {
  CreateWebhookParams,
  ProjectWebhook,
  UpdateWebhookParams,
  WebhookMutationResult,
  WebhookTestParams,
  WebhookTestResult,
} from "./types/entities/webhooks.js";
import type { BookmarkType, EntityType } from "./types/literals.js";
import type { FlowStep } from "./types/query-params/flow.js";
import type { FunnelStep } from "./types/query-params/funnel.js";
import type { RetentionEvent } from "./types/query-params/retention.js";
import type {
  ReportLink,
  ReportLinkQueryResult,
  ResolvedReport,
} from "./types/report-links.js";
import type {
  BookmarkInfo,
  FunnelInfo,
  LexiconSchema,
  SavedCohort,
  SchemaGraphResult,
  SubPropertyInfo,
  TopEvent,
} from "./types/results/discovery.js";
import type {
  ActivityFeedResult,
  EventCountsResult,
  FlowsResult,
  FrequencyResult,
  FunnelResult,
  NumericAverageResult,
  NumericBucketResult,
  NumericSumResult,
  PropertyCountsResult,
  RetentionResult,
  SavedReportResult,
  SegmentationResult,
} from "./types/results/live-query.js";
import type {
  FlowQueryResult,
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
  UserQueryResult,
} from "./types/results/query-engine.js";
import type {
  Replay,
  ReplayEvent,
  ReplaySummary,
  SignedReplay,
} from "./types/results/replay-models.js";
import type { ReplayBundle } from "./types/results/replays.js";
import type {
  WorkspaceGetAlertCountOptions,
  WorkspaceGetAlertHistoryOptions,
  WorkspaceListAlertsOptions,
  WorkspaceListAnnotationsOptions,
} from "./workspace-members/annotations-webhooks-alerts.js";
import * as annotationsWebhooksAlerts from "./workspace-members/annotations-webhooks-alerts.js";
import type {
  WorkspaceGetBookmarkHistoryOptions,
  WorkspaceListBookmarksV2Options,
  WorkspaceListCohortsFullOptions,
} from "./workspace-members/bookmarks-cohorts.js";
import * as bookmarksCohorts from "./workspace-members/bookmarks-cohorts.js";
import type {
  WorkspaceListBlueprintTemplatesOptions,
  WorkspaceListDashboardsOptions,
} from "./workspace-members/dashboards.js";
import * as dashboards from "./workspace-members/dashboards.js";
import type {
  WorkspaceConcludeExperimentOptions,
  WorkspaceGetFlagHistoryOptions,
  WorkspaceListExperimentsOptions,
  WorkspaceListFeatureFlagsOptions,
} from "./workspace-members/flags-experiments.js";
import * as flagsExperiments from "./workspace-members/flags-experiments.js";
import * as governanceData from "./workspace-members/governance-data.js";
import {
  defaultMonotonic,
  type LookupUploadSeams,
  unportedReadFile,
  type WorkspaceDownloadLookupTableOptions,
  type WorkspaceListLookupTablesOptions,
  type WorkspaceUploadLookupTableOptions,
} from "./workspace-members/governance-data.js";
import type {
  WorkspaceExportLexiconOptions,
  WorkspaceGetEventDefinitionsOptions,
  WorkspaceGetPropertyDefinitionsOptions,
} from "./workspace-members/lexicon-tracking.js";
import * as lexiconTracking from "./workspace-members/lexicon-tracking.js";
import * as lifecycle from "./workspace-members/lifecycle.js";
import {
  type BusinessContextHost,
  type BusinessContextScopeOptions,
  guardTargetExclusivity,
  mergeResolverSeams,
  noProjectError,
  type ResolverSeams,
} from "./workspace-members/lifecycle.js";
import {
  type ReportLinkParamsInput,
  type ResolvedWorkspaceLogger,
  resolveWorkspaceLogger,
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
} from "./workspace-members/options.js";
import * as replayMethods from "./workspace-members/replay-methods.js";
import * as reportLinkMethods from "./workspace-members/report-link-methods.js";
import type {
  WorkspaceDeleteSchemasOptions,
  WorkspaceGetSchemaEnforcementOptions,
  WorkspaceListDataVolumeAnomaliesOptions,
  WorkspaceListSchemaRegistryOptions,
} from "./workspace-members/schemas-audit.js";
import * as schemasAudit from "./workspace-members/schemas-audit.js";
import { requireEntityId, requireInt64Id } from "./workspace-members/shared.js";
import * as userQueryEngine from "./workspace-members/user-query-engine.js";
import {
  type EventsInput,
  flowModeFromParams,
  type ParamsDict,
  resolveAndBuildFlowParams,
  resolveAndBuildFunnelParams,
  resolveAndBuildParams,
  resolveAndBuildRetentionParams,
  resolveAndBuildUserParams,
} from "./workspace-query-params.js";

/** `last` default of the four query builders (`Workspace.query(last=30)`). */
const DEFAULT_QUERY_LAST_DAYS = 30;

/**
 * Main facade for Mixpanel operations, bound to one resolved
 * {@link Session}.
 *
 * @remarks
 * Construct it either with a pre-built `session` (the resolver bypass)
 * or with the resolver axes `account` / `project` / `workspace` /
 * `target` plus injected {@link WorkspaceOptions.sources}; the core
 * package never reads config files or the environment itself, so the
 * Python-equivalent `Workspace()` with on-disk defaults lives in
 * `@mixpanel-headless/node`. {@link Workspace.use} swaps axes in place.
 * @example
 * ```typescript
 * const ws = new Workspace({ session });
 * const events = await ws.events();
 * await ws.use({ project: "123456" });
 * ```
 * @see mixpanel_headless.workspace.Workspace
 */
export class Workspace {
  /** The resolved session bound to this facade (`self._session`). */
  #session: Session;

  /**
   * The bound wire client (Python `self._api_client`).
   *
   * @internal
   */
  readonly client: MixpanelClient;

  /** Lazily-created discovery service (`self._discovery`). */
  #discovery: DiscoveryService | null = null;

  /** Lazily-created live query service (`self._live_query`). */
  #liveQuery: LiveQueryService | null = null;

  /** Lazily-created session-replay service (`self._replays_svc`). */
  #replays: ReplaysService | null = null;

  /** Lazily-created `/me` service (`self._me_service`). */
  #meService: MeService | null = null;

  /** `self._account_name` — the MeCache scope, refreshed on `use()`. */
  #accountName: string;

  // Python also carries `self._initial_workspace_id`, read only by the
  // client-recreation arm of `_get_api_client()`. This port has no such
  // arm: `close()` releases the pool in place and the `readonly client`
  // keeps its own pin, so the field is deliberately absent rather than
  // dead.

  /** The resolution seams `use()` consumes (see {@link ResolverSeams}). */
  readonly #seams: ResolverSeams;

  /** Factory for the `/me` cache store handed to each MeService. */
  readonly #meCacheFactory: (accountName: string) => MeCacheStore;

  /**
   * Per-account memo of cache stores. Python's `MeCache(account_name=…)`
   * re-reads the same per-account disk file however many times the lazy
   * `MeService` is rebuilt, so a `use(project=…)` swap keeps the warm
   * cache; the in-memory default must share state the same way, so the
   * factory runs once per account name per facade.
   */
  readonly #meCacheStores = new Map<string, MeCacheStore>();

  /** `warnings.warn` sink handed to the discovery service. */
  readonly #warn: WarningSink | undefined;

  /** The log seam; {@link NOOP_LOGGER} unless the host injected one. */
  readonly #logger: ResolvedWorkspaceLogger;
  /** The `generate_slug` seam of `createReportLink`. */
  readonly #generateSlug: () => string;

  /** `Path(...).read_bytes()` seam of `uploadLookupTable`. */
  readonly #readFile: (path: string) => Promise<Uint8Array>;

  /** `time.monotonic()` seam (seconds) of the upload poll. */
  readonly #monotonic: () => number;

  /**
   * Create a workspace facade.
   *
   * @param options - A resolved session, or the resolver axes plus
   *   injected sources; optionally an injected client and seams.
   * @throws {@link ParamValidationError} - `WS1_TARGET_MUTUALLY_EXCLUSIVE`
   *   when `target` is combined with `account` / `project` / `workspace`.
   * @throws {@link MixpanelHeadlessError} - `UNPORTED_AUTH_SEAM` when
   *   neither `session` nor `sources` is given.
   * @throws {@link ConfigError} - The account or project axis cannot be
   *   resolved from the sources.
   * @see mixpanel_headless.workspace.Workspace.__init__
   */
  constructor(options: WorkspaceOptions) {
    // The exclusivity guard fires before any resolution side effect, as
    // in Python.
    guardTargetExclusivity(options);
    let session: Session;
    if (options.session === undefined) {
      const sources = options.sources;
      if (sources === undefined) {
        // Python's bare `Workspace()` reads the bridge file and config
        // from disk (and materializes bridge tokens as a side effect).
        // Core is runtime-agnostic, so that wiring ships in
        // `@mixpanel-headless/node` (`createNodeWorkspaceSources()`)
        // and sessionless construction here requires injected sources.
        throw new MixpanelHeadlessError(
          "Workspace construction without `session` requires injected " +
            "`sources` in @mixpanel-headless/core (packages/node: " +
            "createNodeWorkspaceSources())",
          "UNPORTED_AUTH_SEAM",
          { seam: "workspaceSources" },
        );
      }
      session = resolveSession(
        {
          account: options.account ?? null,
          project: options.project ?? null,
          workspace: options.workspace ?? null,
          target: options.target ?? null,
        },
        sources,
      );
    } else {
      session = options.session;
    }
    this.#session = session;
    this.client =
      options.client ??
      createMixpanelClient({
        session,
        ...options.clientOptions,
      });
    this.#accountName = session.account.name;
    this.#seams = mergeResolverSeams(options.seams);
    this.#meCacheFactory = options.meCache ?? inMemoryMeCache;
    this.#warn = options.warn;
    this.#logger = resolveWorkspaceLogger(options.logger);
    this.#generateSlug = options.generateSlug ?? ((): string => generateSlug());
    this.#readFile = options.readFile ?? unportedReadFile;
    this.#monotonic = options.monotonic ?? defaultMonotonic;
    this.#installWorkspaceResolver();
  }

  /**
   * The resolved session bound to this facade. Read-only: `use()` swaps
   * it in place.
   *
   * @returns The current session.
   * @see mixpanel_headless.workspace.Workspace.session
   */
  get session(): Session {
    return this.#session;
  }

  /**
   * Wire the facade's `/me` cache into the client's workspace
   * auto-resolver. The closure reads {@link meService} on every call, so
   * it keeps pointing at the current service across `use()` cache
   * clears; a resolver already installed on an injected client is left
   * in place.
   *
   * @see mixpanel_headless.workspace.Workspace._install_workspace_resolver
   */
  #installWorkspaceResolver(): void {
    if (this.client.hasWorkspaceResolver) {
      return;
    }
    this.client.setWorkspaceResolver((pid: string) =>
      this.meService.resolveWorkspace(pid),
    );
  }

  /**
   * Get or create the discovery service.
   *
   * @returns The memoized service.
   * @internal
   * @see mixpanel_headless.workspace.Workspace._discovery_service
   */
  get discoveryService(): DiscoveryService {
    if (this.#discovery === null) {
      this.#discovery = new DiscoveryService(this.client, {
        ...(this.#warn === undefined ? {} : { warn: this.#warn }),
        logger: this.#logger,
      });
    }
    return this.#discovery;
  }

  /**
   * Swap one or more session axes in place and return `this` for
   * chaining.
   *
   * @remarks
   * `target` is mutually exclusive with `account` / `project` /
   * `workspace`. The wire client — and with it the connection pool — is
   * preserved across every switch: the swap is delegated to
   * {@link MixpanelClient.use}, which rebuilds the auth header in place,
   * and every lazy service is then discarded so subsequent reads observe
   * the new session. `use({ workspace })` pins App-API and Query-host
   * scoping; raw export streaming stays project-scoped by design.
   * @param options - The axes to swap plus `persist`.
   * @returns `this`.
   * @throws {@link ParamValidationError} - `WS1_TARGET_MUTUALLY_EXCLUSIVE`.
   * @throws {@link MixpanelHeadlessError} - `UNPORTED_RESOLVER_SEAM` when
   *   the `target` / `account` / `persist: true` branches run on a facade
   *   built without resolver seams.
   * @throws {@link ConfigError} - An `account` swap resolves no project.
   * @example
   * ```typescript
   * for (const project of await ws.projects()) {
   *   await ws.use({ project: project.id });
   * }
   * ```
   * @see mixpanel_headless.workspace.Workspace.use
   */
  async use(options: WorkspaceUseOptions = {}): Promise<this> {
    guardTargetExclusivity(options);

    const account = options.account ?? null;
    const project = options.project ?? null;
    const workspace = options.workspace ?? null;
    const target = options.target ?? null;

    let newAccount: Account | null = null;
    let newProject: Project | null;
    let newWorkspace: WorkspaceRef | null;

    if (target !== null) {
      // Route through the same resolver as construction so
      // env > param > target > bridge > config applies.
      const resolved = await this.#seams.resolveSession({ target });
      newAccount = resolved.account;
      newProject = resolved.project;
      newWorkspace = resolved.workspace ?? null;
    } else if (account === null) {
      newProject = project === null ? null : { id: project };
      newWorkspace = workspace === null ? null : { id: workspace };
    } else {
      // Explicit account swap: the project re-resolves against the new
      // account; the workspace axis is cleared unless supplied explicitly
      // or by MP_WORKSPACE_ID.
      newAccount = await this.#seams.getAccount(account);
      const projectId = await this.#seams.resolveProjectAxis({
        explicit: project,
        target_project: null,
        account: newAccount,
      });
      if (projectId === null) {
        throw noProjectError(newAccount);
      }
      newProject = { id: projectId };
      if (workspace === null) {
        const envWs = await this.#seams.envWorkspaceId();
        newWorkspace = envWs === null ? null : { id: envWs };
      } else {
        newWorkspace = { id: workspace };
      }
    }

    await this.client.use({
      account: newAccount,
      project: newProject,
      workspace: newWorkspace,
    });
    this.#session = this.client.session;

    // Clear the lazy services so subsequent reads observe the new
    // session rather than the prior one.
    this.#accountName = this.#session.account.name;
    this.#discovery = null;
    this.#liveQuery = null;
    this.#meService = null;
    this.#replays = null;
    this.#installWorkspaceResolver();

    if (options.persist === true) {
      await this.#seams.persistActive(this.#session);
    }
    return this;
  }

  /**
   * Close the HTTP resources. Idempotent and safe to call repeatedly; a
   * later call on the facade reopens them.
   *
   * @remarks
   * Python nulls `self._api_client` and lets `_get_api_client()` build a
   * replacement on the next call; this port keeps the `readonly client`
   * and closes the pool in place — the client's own `close()` drops the
   * pool and `ensureHttp()` recreates it on the next request, so a
   * post-close call behaves as Python's recreated client does.
   * @returns Nothing.
   * @see mixpanel_headless.workspace.Workspace.close
   */
  async close(): Promise<void> {
    // Divergence: Python's recreated client forgets a runtime
    // `set_workspace_id()` pin and re-applies the initial one; the kept
    // client retains its current pin (PORTING.md).
    await this.client.close();
  }

  /**
   * `await using` support — delegates to {@link close}, the
   * `__exit__` twin.
   *
   * @returns Nothing.
   */
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  // --- Query members ---

  /**
   * Get or create the live query service.
   *
   * @returns The memoized service.
   * @internal
   * @see mixpanel_headless.workspace.Workspace._live_query_service
   */
  get liveQueryService(): LiveQueryService {
    if (this.#liveQuery === null) {
      this.#liveQuery = new LiveQueryService(this.client, {
        ...(this.#warn === undefined ? {} : { warn: this.#warn }),
      });
    }
    return this.#liveQuery;
  }

  /**
   * Run a segmentation query against the Mixpanel API.
   *
   * @param event - Event name to query.
   * @param options - Required date window plus `on` / `unit` / `where`.
   * @returns Time-series data with the calculated total.
   * @throws {@link ConfigError} - Credentials not available.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} - Wire
   *   failures.
   * @example
   * ```typescript
   * const r = await ws.segmentation("Login", {
   *   from_date: "2026-01-01",
   *   to_date: "2026-01-31",
   *   unit: "week",
   * });
   * ```
   * @see mixpanel_headless.workspace.Workspace.segmentation
   */
  async segmentation(
    event: string,
    options: WorkspaceSegmentationOptions,
  ): Promise<SegmentationResult> {
    const { from_date, to_date, ...rest } = options;
    return this.liveQueryService.segmentation(event, from_date, to_date, rest);
  }

  /**
   * Run a funnel analysis query.
   *
   * @param funnelId - ID of the saved funnel.
   * @param options - Required date window plus `unit` / `on`.
   * @returns Step conversion rates.
   * @throws {@link ConfigError} - Credentials not available.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} - Wire
   *   failures.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `funnelId`
   *   is not a positive integer (network-free guard, before any request).
   * @example
   * ```typescript
   * const r = await ws.funnel(12345, { from_date: "2026-01-01", to_date: "2026-01-31" });
   * ```
   * @see mixpanel_headless.workspace.Workspace.funnel
   */
  async funnel(
    funnelId: number,
    options: WorkspaceFunnelOptions,
  ): Promise<FunnelResult> {
    requireEntityId("funnel_id", funnelId);
    const { from_date, to_date, ...rest } = options;
    return this.liveQueryService.funnel(funnelId, from_date, to_date, rest);
  }

  /**
   * Run a retention analysis query.
   *
   * @param options - Born/return events, the date window and the
   *   interval knobs (all keyword-only in Python).
   * @returns Cohort retention data.
   * @throws {@link ConfigError} - Credentials not available.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.retention
   */
  async retention(
    options: WorkspaceRetentionOptions,
  ): Promise<RetentionResult> {
    const { born_event, return_event, from_date, to_date, ...rest } = options;
    return this.liveQueryService.retention(
      born_event,
      return_event,
      from_date,
      to_date,
      rest,
    );
  }

  /**
   * Get counts for multiple events.
   *
   * @param events - Event names.
   * @param options - Required date window plus `type` / `unit`.
   * @returns Time series per event.
   * @throws {@link ConfigError} - Credentials not available.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} - Wire
   *   failures.
   * @example
   * ```typescript
   * const r = await ws.eventCounts(["Login", "Purchase"], {
   *   from_date: "2026-01-01",
   *   to_date: "2026-01-31",
   *   unit: "day",
   * });
   * ```
   * @see mixpanel_headless.workspace.Workspace.event_counts
   */
  async eventCounts(
    events: readonly string[],
    options: WorkspaceEventCountsOptions,
  ): Promise<EventCountsResult> {
    const { from_date, to_date, ...rest } = options;
    return this.liveQueryService.eventCounts(events, from_date, to_date, rest);
  }

  /**
   * Get event counts broken down by property value.
   *
   * @param event - Event name.
   * @param propertyName - Property to break down by.
   * @param options - Required date window plus `type` / `unit` /
   *   `values` / `limit`.
   * @returns Time series per property value.
   * @throws {@link ConfigError} - Credentials not available.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} - Wire
   *   failures.
   * @example
   * ```typescript
   * const r = await ws.propertyCounts("Purchase", "plan", {
   *   from_date: "2026-01-01",
   *   to_date: "2026-01-31",
   *   limit: 10,
   * });
   * ```
   * @see mixpanel_headless.workspace.Workspace.property_counts
   */
  async propertyCounts(
    event: string,
    propertyName: string,
    options: WorkspacePropertyCountsOptions,
  ): Promise<PropertyCountsResult> {
    const { from_date, to_date, ...rest } = options;
    return this.liveQueryService.propertyCounts(
      event,
      propertyName,
      from_date,
      to_date,
      rest,
    );
  }

  /**
   * Get the activity feed for specific users.
   *
   * Events come back oldest-first within a page; when `limit` is set
   * the most recent events lead and `sentinel_event` pages backward.
   *
   * @param distinctIds - User identifiers.
   * @param options - Dates / limit / include / exclude / search /
   *   pagination.
   * @returns The events plus the `sentinel_event` cursor.
   * @throws {@link ConfigError} - Credentials not available.
   * @throws {@link QueryError} - Both `include_events` and `exclude_events`
   *   given (and the other wire rejections).
   * @example
   * ```typescript
   * const feed = await ws.activityFeed(["user-1"], { from_date: "2026-01-01", to_date: "2026-01-31", limit: 100 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.activity_feed
   */
  async activityFeed(
    distinctIds: readonly string[],
    options: LiveActivityFeedOptions = {},
  ): Promise<ActivityFeedResult> {
    return this.liveQueryService.activityFeed(distinctIds, options);
  }

  /**
   * Query a saved report by bookmark type.
   *
   * @param bookmarkId - ID of the saved report.
   * @param options - `bookmark_type` plus the funnel date window.
   * @returns The normalized report data.
   * @throws {@link ConfigError} - Credentials not available.
   * @throws {@link QueryError} - Invalid `bookmark_id` or report not found.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   * @example
   * ```typescript
   * const report = await ws.querySavedReport(987, {
   *   bookmark_type: "funnels",
   *   from_date: "2026-01-01",
   *   to_date: "2026-01-31",
   * });
   * ```
   * @see mixpanel_headless.workspace.Workspace.query_saved_report
   */
  async querySavedReport(
    bookmarkId: number,
    options: LiveQuerySavedReportOptions = {},
  ): Promise<SavedReportResult> {
    requireEntityId("bookmark_id", bookmarkId);
    return this.liveQueryService.querySavedReport(bookmarkId, options);
  }

  /**
   * Query a saved Flows report.
   *
   * @param bookmarkId - ID of the saved flows report.
   * @returns Steps, breakdowns and the conversion rate.
   * @throws {@link ConfigError} - Credentials not available.
   * @throws {@link QueryError} - Invalid `bookmark_id` or report not found.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.query_saved_flows
   */
  async querySavedFlows(bookmarkId: number): Promise<FlowsResult> {
    requireEntityId("bookmark_id", bookmarkId);
    return this.liveQueryService.querySavedFlows(bookmarkId);
  }

  /**
   * Analyze the event frequency distribution.
   *
   * @param options - Required date window plus `unit` /
   *   `addiction_unit` / `event` / `where`.
   * @returns The frequency distribution.
   * @throws {@link ConfigError} - Credentials not available.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.frequency
   */
  async frequency(
    options: WorkspaceFrequencyOptions,
  ): Promise<FrequencyResult> {
    const { from_date, to_date, ...rest } = options;
    return this.liveQueryService.frequency(from_date, to_date, rest);
  }

  /**
   * Bucket events by numeric property ranges.
   *
   * @param event - Event name.
   * @param options - Required date window and `on`, plus `unit` /
   *   `where` / `type`.
   * @returns The bucketed data.
   * @throws {@link ConfigError} - Credentials not available.
   * @throws {@link QueryError} - Invalid parameters or a non-numeric property.
   * @example
   * ```typescript
   * const r = await ws.segmentationNumeric("Purchase", {
   *   from_date: "2026-01-01",
   *   to_date: "2026-01-31",
   *   on: 'properties["amount"]',
   * });
   * ```
   * @see mixpanel_headless.workspace.Workspace.segmentation_numeric
   */
  async segmentationNumeric(
    event: string,
    options: WorkspaceSegmentationNumericOptions,
  ): Promise<NumericBucketResult> {
    const { from_date, to_date, on, ...rest } = options;
    return this.liveQueryService.segmentationNumeric(
      event,
      from_date,
      to_date,
      on,
      rest,
    );
  }

  /**
   * Calculate the sum of a numeric property over time.
   *
   * @param event - Event name.
   * @param options - Required date window and `on`, plus `unit` /
   *   `where`.
   * @returns Sum values per period.
   * @throws {@link ConfigError} - Credentials not available.
   * @throws {@link QueryError} - Invalid parameters or a non-numeric property.
   * @example
   * ```typescript
   * const r = await ws.segmentationSum("Purchase", {
   *   from_date: "2026-01-01",
   *   to_date: "2026-01-31",
   *   on: 'properties["amount"]',
   * });
   * ```
   * @see mixpanel_headless.workspace.Workspace.segmentation_sum
   */
  async segmentationSum(
    event: string,
    options: WorkspaceNumericOptions,
  ): Promise<NumericSumResult> {
    const { from_date, to_date, on, ...rest } = options;
    return this.liveQueryService.segmentationSum(
      event,
      from_date,
      to_date,
      on,
      rest,
    );
  }

  /**
   * Calculate the average of a numeric property over time.
   *
   * @param event - Event name.
   * @param options - Required date window and `on`, plus `unit` /
   *   `where`.
   * @returns Average values per period.
   * @throws {@link ConfigError} - Credentials not available.
   * @throws {@link QueryError} - Invalid parameters or a non-numeric property.
   * @example
   * ```typescript
   * const r = await ws.segmentationAverage("Purchase", {
   *   from_date: "2026-01-01",
   *   to_date: "2026-01-31",
   *   on: 'properties["amount"]',
   * });
   * ```
   * @see mixpanel_headless.workspace.Workspace.segmentation_average
   */
  async segmentationAverage(
    event: string,
    options: WorkspaceNumericOptions,
  ): Promise<NumericAverageResult> {
    const { from_date, to_date, on, ...rest } = options;
    return this.liveQueryService.segmentationAverage(
      event,
      from_date,
      to_date,
      on,
      rest,
    );
  }

  // --- Insights query ---

  /**
   * Run a typed insights query.
   *
   * Builds bookmark params from the arguments, POSTs them inline to
   * `/api/query/insights`, and returns the structured result.
   *
   * @param events - Event name(s): a string, a `Metric`, a
   *   `CohortMetric`, a `Formula`, or a sequence mixing them (Formula
   *   members are extracted and appended as formula show clauses).
   * @param options - The 17 keyword-only knobs plus `limit` (segments
   *   to return, 1 to 50000; default 3000).
   * @returns The series data and metadata.
   * @throws {@link ValueError} - `limit` is not an integer from 1 to 50000.
   * @throws {@link BookmarkValidationError} - Argument or bookmark validation.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} - Wire
   *   failures.
   * @example
   * ```typescript
   * const result = await ws.query("Login", { math: "unique", last: 7 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.query
   */
  async query(
    events: EventsInput,
    options: WorkspaceQueryOptions = {},
  ): Promise<QueryResult> {
    const params = this.#resolveQueryParams(events, options);
    return this.liveQueryService.query(params, this.#projectId(), {
      limit: options.limit ?? null,
    });
  }

  /**
   * Run pre-built insights bookmark params against the Mixpanel API.
   *
   * The execution half of {@link buildParams}. Use it when the params
   * need editing before they run, or when they express something the
   * typed builders do not cover, such as a lookup-table join breakdown.
   *
   * @param params - Bookmark params dict, normally from
   *   {@link buildParams}. Sent as the request `bookmark`.
   * @param options - `limit` (segments to return, 1 to 50000; default
   *   3000) and `workspace_id` (data view override).
   * @returns The series data and metadata.
   * @throws {@link ValueError} - `limit` is not an integer from 1 to 50000.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} - Wire
   *   failures.
   * @example
   * ```typescript
   * const params = await ws.buildParams("Login", { group_by: "$city", last: 7 });
   * params["sections"]["filter"] = myCustomFilter;
   * const result = await ws.runParams(params, { limit: 50_000 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.run_params
   */
  async runParams(
    params: Readonly<Record<string, unknown>>,
    options: WorkspaceRunParamsOptions = {},
  ): Promise<QueryResult> {
    return this.liveQueryService.query(params, this.#projectId(), {
      limit: options.limit ?? null,
      workspace_id: options.workspace_id ?? null,
    });
  }

  /**
   * Build validated insights bookmark params without calling the API.
   *
   * @param events - Same input union as {@link query}.
   * @param options - The same 17 keyword-only knobs.
   * @returns Bookmark params with `sections` and `displayOptions`.
   * @throws {@link BookmarkValidationError} - Argument or bookmark validation.
   * @example
   * ```typescript
   * const params = await ws.buildParams("Login", { math: "unique", group_by: "$city", last: 7 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.build_params
   */
  buildParams(
    events: EventsInput,
    options: WorkspaceQueryOptions = {},
  ): Promise<ParamsDict> {
    return asPromise(() => this.#resolveQueryParams(events, options));
  }

  /**
   * Shared body of {@link query} and {@link buildParams} — the option
   * unpacking Python spells out twice.
   *
   * @param events - The events input.
   * @param options - The keyword-only knobs.
   * @returns The validated bookmark params.
   * @throws {@link BookmarkValidationError} - Any validation layer.
   */
  #resolveQueryParams(
    events: EventsInput,
    options: WorkspaceQueryOptions,
  ): ParamsDict {
    return resolveAndBuildParams({
      events,
      from_date: options.from_date ?? null,
      to_date: options.to_date ?? null,
      last: options.last ?? DEFAULT_QUERY_LAST_DAYS,
      unit: options.unit ?? "day",
      math: options.math ?? "total",
      math_property: options.math_property ?? null,
      per_user: options.per_user ?? null,
      percentile_value: options.percentile_value ?? null,
      group_by: options.group_by ?? null,
      where: options.where ?? null,
      formula: options.formula ?? null,
      formula_label: options.formula_label ?? null,
      rolling: options.rolling ?? null,
      cumulative: options.cumulative ?? false,
      mode: options.mode ?? "timeseries",
      time_comparison: options.time_comparison ?? null,
      data_group_id: options.data_group_id ?? null,
      ...(options.today === undefined ? {} : { today: options.today }),
    });
  }

  // --- Funnel query ---

  /**
   * Run a typed funnel query.
   *
   * @param steps - Funnel steps (strings or `FunnelStep` objects).
   * @param options - The 17 keyword-only knobs plus `limit` (segments
   *   to return, 1 to 50000; default 3000).
   * @returns Step data, conversion rates and metadata.
   * @throws {@link ValueError} - `limit` is not an integer from 1 to 50000.
   * @throws {@link BookmarkValidationError} - Argument or bookmark validation.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} - Wire
   *   failures.
   * @example
   * ```typescript
   * const r = await ws.queryFunnel(["Signup", "Purchase"], { conversion_window: 7, last: 30 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.query_funnel
   */
  async queryFunnel(
    steps: ReadonlyArray<string | FunnelStep>,
    options: WorkspaceFunnelQueryOptions = {},
  ): Promise<FunnelQueryResult> {
    const params = this.#resolveFunnelParams(steps, options);
    return this.liveQueryService.queryFunnel(params, this.#projectId(), {
      limit: options.limit ?? null,
    });
  }

  /**
   * Run pre-built funnel bookmark params against the Mixpanel API.
   *
   * The execution half of {@link buildFunnelParams}.
   *
   * @param params - Funnel bookmark params dict, normally from
   *   {@link buildFunnelParams}. Sent as the request `bookmark`.
   * @param options - `limit` (segments to return, 1 to 50000; default
   *   3000) and `workspace_id` (data view override).
   * @returns Step data, conversion rates and metadata.
   * @throws {@link ValueError} - `limit` is not an integer from 1 to 50000.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} - Wire
   *   failures.
   * @example
   * ```typescript
   * const params = await ws.buildFunnelParams(["Signup", "Purchase"]);
   * const result = await ws.runFunnelParams(params, { limit: 50_000 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.run_funnel_params
   */
  async runFunnelParams(
    params: Readonly<Record<string, unknown>>,
    options: WorkspaceRunParamsOptions = {},
  ): Promise<FunnelQueryResult> {
    return this.liveQueryService.queryFunnel(params, this.#projectId(), {
      limit: options.limit ?? null,
      workspace_id: options.workspace_id ?? null,
    });
  }

  /**
   * Build validated funnel bookmark params without calling the API.
   *
   * @param steps - Funnel steps (strings or `FunnelStep` objects).
   * @param options - The same 17 keyword-only knobs.
   * @returns Bookmark params with `sections` and `displayOptions`.
   * @throws {@link BookmarkValidationError} - Argument or bookmark validation.
   * @example
   * ```typescript
   * const params = await ws.buildFunnelParams(["Signup", "Purchase"], { order: "strict" });
   * ```
   * @see mixpanel_headless.workspace.Workspace.build_funnel_params
   */
  buildFunnelParams(
    steps: ReadonlyArray<string | FunnelStep>,
    options: WorkspaceFunnelQueryOptions = {},
  ): Promise<ParamsDict> {
    return asPromise(() => this.#resolveFunnelParams(steps, options));
  }

  /**
   * Shared body of {@link queryFunnel} and
   * {@link buildFunnelParams}.
   *
   * @param steps - The step specs.
   * @param options - The keyword-only knobs.
   * @returns The validated bookmark params.
   * @throws {@link BookmarkValidationError} - Any validation layer.
   */
  #resolveFunnelParams(
    steps: ReadonlyArray<string | FunnelStep>,
    options: WorkspaceFunnelQueryOptions,
  ): ParamsDict {
    return resolveAndBuildFunnelParams({
      steps,
      conversion_window: options.conversion_window ?? 14,
      conversion_window_unit: options.conversion_window_unit ?? "day",
      order: options.order ?? "loose",
      math: options.math ?? "conversion_rate_unique",
      math_property: options.math_property ?? null,
      from_date: options.from_date ?? null,
      to_date: options.to_date ?? null,
      last: options.last ?? DEFAULT_QUERY_LAST_DAYS,
      unit: options.unit ?? "day",
      group_by: options.group_by ?? null,
      where: options.where ?? null,
      exclusions: options.exclusions ?? null,
      holding_constant: options.holding_constant ?? null,
      mode: options.mode ?? "steps",
      reentry_mode: options.reentry_mode ?? null,
      time_comparison: options.time_comparison ?? null,
      data_group_id: options.data_group_id ?? null,
      ...(options.today === undefined ? {} : { today: options.today }),
    });
  }

  // --- Flow query ---

  /**
   * Run a typed flow query.
   *
   * @param event - Anchor event(s): a string, a `FlowStep`, or a list.
   * @param options - The 16 keyword-only knobs.
   * @returns Steps, flows, breakdowns and metadata.
   * @throws {@link BookmarkValidationError} - Argument or bookmark validation.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} - Wire
   *   failures.
   * @example
   * ```typescript
   * const r = await ws.queryFlow("Login", { forward: 3, mode: "tree", last: 7 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.query_flow
   */
  async queryFlow(
    event: string | FlowStep | ReadonlyArray<string | FlowStep>,
    options: WorkspaceFlowQueryOptions = {},
  ): Promise<FlowQueryResult> {
    const params = this.#resolveFlowParams(event, options);
    return this.liveQueryService.queryFlow(
      params,
      this.#projectId(),
      options.mode ?? "sankey",
    );
  }

  /**
   * Run pre-built flow bookmark params against the Mixpanel API.
   *
   * The execution half of {@link buildFlowParams}. The chart mode is
   * read from the params via `flowModeFromParams` unless
   * `options.mode` overrides it.
   *
   * @param params - Flow bookmark params dict, normally from
   *   {@link buildFlowParams}. Sent as the request `bookmark`.
   * @param options - `mode` (override; default derived from the params)
   *   and `workspace_id` (data view override).
   * @returns Steps, flows, breakdowns and metadata.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} - Wire
   *   failures.
   * @example
   * ```typescript
   * const params = await ws.buildFlowParams("Login", { mode: "tree", last: 7 });
   * const result = await ws.runFlowParams(params); // runs as tree
   * ```
   * @see mixpanel_headless.workspace.Workspace.run_flow_params
   */
  async runFlowParams(
    params: Readonly<Record<string, unknown>>,
    options: WorkspaceRunFlowParamsOptions = {},
  ): Promise<FlowQueryResult> {
    const resolvedMode = options.mode ?? flowModeFromParams(params);
    return this.liveQueryService.queryFlow(
      params,
      this.#projectId(),
      resolvedMode,
      { workspace_id: options.workspace_id ?? null },
    );
  }

  /**
   * Build validated flow bookmark params without calling the API.
   *
   * @param event - Anchor event(s).
   * @param options - The same 16 keyword-only knobs.
   * @returns The flat flow bookmark params dict.
   * @throws {@link BookmarkValidationError} - Argument or bookmark validation.
   * @example
   * ```typescript
   * const params = await ws.buildFlowParams("Login", { reverse: 2, last: 7 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.build_flow_params
   */
  buildFlowParams(
    event: string | FlowStep | ReadonlyArray<string | FlowStep>,
    options: WorkspaceFlowQueryOptions = {},
  ): Promise<ParamsDict> {
    return asPromise(() => this.#resolveFlowParams(event, options));
  }

  /**
   * Shared body of {@link queryFlow} and {@link buildFlowParams}.
   *
   * @param event - The anchor event input.
   * @param options - The keyword-only knobs.
   * @returns The validated flow bookmark params.
   * @throws {@link BookmarkValidationError} - Any validation layer.
   */
  #resolveFlowParams(
    event: string | FlowStep | ReadonlyArray<string | FlowStep>,
    options: WorkspaceFlowQueryOptions,
  ): ParamsDict {
    return resolveAndBuildFlowParams({
      event,
      forward: options.forward ?? 3,
      reverse: options.reverse ?? 0,
      from_date: options.from_date ?? null,
      to_date: options.to_date ?? null,
      last: options.last ?? DEFAULT_QUERY_LAST_DAYS,
      conversion_window: options.conversion_window ?? 7,
      conversion_window_unit: options.conversion_window_unit ?? "day",
      count_type: options.count_type ?? "unique",
      cardinality: options.cardinality ?? 3,
      collapse_repeated: options.collapse_repeated ?? false,
      hidden_events: options.hidden_events ?? null,
      mode: options.mode ?? "sankey",
      where: options.where ?? null,
      data_group_id: options.data_group_id ?? null,
      segments: options.segments ?? null,
      exclusions: options.exclusions ?? null,
      ...(options.today === undefined ? {} : { today: options.today }),
    });
  }

  // --- Retention query ---

  /**
   * Run a typed retention query.
   *
   * @param bornEvent - Event defining cohort membership.
   * @param returnEvent - Event defining return.
   * @param options - The 15 keyword-only knobs plus `limit` (segments
   *   to return, 1 to 50000; default 3000).
   * @returns Cohort data, averages and metadata.
   * @throws {@link ValueError} - `limit` is not an integer from 1 to 50000.
   * @throws {@link BookmarkValidationError} - Argument or bookmark validation.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} - Wire
   *   failures.
   * @example
   * ```typescript
   * const r = await ws.queryRetention("Signup", "Login", { retention_unit: "week", last: 90 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.query_retention
   */
  async queryRetention(
    bornEvent: string | RetentionEvent,
    returnEvent: string | RetentionEvent,
    options: WorkspaceRetentionQueryOptions = {},
  ): Promise<RetentionQueryResult> {
    const params = this.#resolveRetentionParams(
      bornEvent,
      returnEvent,
      options,
    );
    return this.liveQueryService.queryRetention(params, this.#projectId(), {
      limit: options.limit ?? null,
    });
  }

  /**
   * Run pre-built retention bookmark params against the Mixpanel API.
   *
   * The execution half of {@link buildRetentionParams}.
   *
   * @param params - Retention bookmark params dict, normally from
   *   {@link buildRetentionParams}. Sent as the request `bookmark`.
   * @param options - `limit` (segments to return, 1 to 50000; default
   *   3000) and `workspace_id` (data view override).
   * @returns Cohort data, averages and metadata.
   * @throws {@link ValueError} - `limit` is not an integer from 1 to 50000.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} - Wire
   *   failures.
   * @example
   * ```typescript
   * const params = await ws.buildRetentionParams("Signup", "Login");
   * const result = await ws.runRetentionParams(params, { limit: 50_000 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.run_retention_params
   */
  async runRetentionParams(
    params: Readonly<Record<string, unknown>>,
    options: WorkspaceRunParamsOptions = {},
  ): Promise<RetentionQueryResult> {
    return this.liveQueryService.queryRetention(params, this.#projectId(), {
      limit: options.limit ?? null,
      workspace_id: options.workspace_id ?? null,
    });
  }

  /**
   * Build validated retention bookmark params without calling the API.
   *
   * @param bornEvent - Event defining cohort membership.
   * @param returnEvent - Event defining return.
   * @param options - The same 15 keyword-only knobs.
   * @returns Bookmark params with `sections`, `displayOptions`,
   *   `sorting` and `columnWidths`.
   * @throws {@link BookmarkValidationError} - Argument or bookmark validation.
   * @example
   * ```typescript
   * const params = await ws.buildRetentionParams("Signup", "Login", { retention_unit: "day" });
   * ```
   * @see mixpanel_headless.workspace.Workspace.build_retention_params
   */
  buildRetentionParams(
    bornEvent: string | RetentionEvent,
    returnEvent: string | RetentionEvent,
    options: WorkspaceRetentionQueryOptions = {},
  ): Promise<ParamsDict> {
    return asPromise(() =>
      this.#resolveRetentionParams(bornEvent, returnEvent, options),
    );
  }

  /**
   * Shared body of {@link queryRetention} and
   * {@link buildRetentionParams}.
   *
   * @param bornEvent - The born-event input.
   * @param returnEvent - The return-event input.
   * @param options - The keyword-only knobs.
   * @returns The validated bookmark params.
   * @throws {@link BookmarkValidationError} - Any validation layer.
   */
  #resolveRetentionParams(
    bornEvent: string | RetentionEvent,
    returnEvent: string | RetentionEvent,
    options: WorkspaceRetentionQueryOptions,
  ): ParamsDict {
    return resolveAndBuildRetentionParams({
      born_event: bornEvent,
      return_event: returnEvent,
      retention_unit: options.retention_unit ?? "week",
      alignment: options.alignment ?? "birth",
      bucket_sizes: options.bucket_sizes ?? null,
      math: options.math ?? "retention_rate",
      from_date: options.from_date ?? null,
      to_date: options.to_date ?? null,
      last: options.last ?? DEFAULT_QUERY_LAST_DAYS,
      unit: options.unit ?? "day",
      group_by: options.group_by ?? null,
      where: options.where ?? null,
      mode: options.mode ?? "curve",
      unbounded_mode: options.unbounded_mode ?? null,
      retention_cumulative: options.retention_cumulative ?? false,
      time_comparison: options.time_comparison ?? null,
      data_group_id: options.data_group_id ?? null,
      ...(options.today === undefined ? {} : { today: options.today }),
    });
  }

  // --- User query engine ---

  /**
   * Query user profiles from Mixpanel's Engage API.
   *
   * Builds the engage params and hands them to {@link runUserParams},
   * which routes on the params: an aggregate `action` key goes to the
   * engage stats endpoint; anything else fetches profile pages
   * sequentially, or concurrently when `parallel` is set and
   * `limit !== 1`.
   *
   * @param options - The 19 keyword-only knobs.
   * @returns Profiles/aggregate payload with metadata.
   * @throws {@link BookmarkValidationError} - Argument or param validation.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} |
   *   {@link ServerError} - Wire failures.
   * @see mixpanel_headless.workspace.Workspace.query_user
   */
  async queryUser(
    options: WorkspaceUserQueryOptions = {},
  ): Promise<UserQueryResult> {
    const limit = options.limit === undefined ? 1 : options.limit;
    const parallel = options.parallel ?? false;
    const workers =
      options.workers ?? userQueryEngine.DEFAULT_USER_QUERY_WORKERS;
    const params = this.#resolveUserParams(options);

    return this.runUserParams(params, { limit, parallel, workers });
  }

  /**
   * Run pre-built Engage API params against the Mixpanel API.
   *
   * The execution half of {@link buildUserParams}. The mode is read
   * from the params: a dict that carries an aggregate `action` key runs
   * as an aggregate query, any other dict runs as a profiles query.
   * `limit`, `parallel` and `workers` are execution settings that
   * {@link buildUserParams} does not store, so they are passed here
   * with the same defaults as {@link queryUser}.
   *
   * @param params - Engage API params dict, normally from
   *   {@link buildUserParams}.
   * @param options - `limit` (default `1`; `null` fetches all),
   *   `parallel` (default `false`) and `workers` (default `5`).
   * @returns Profiles/aggregate payload with metadata.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} |
   *   {@link ServerError} - Wire failures.
   * @example
   * ```typescript
   * const params = await ws.buildUserParams({
   *   mode: "profiles",
   *   where: Filter.equals("plan", "premium"),
   * });
   * params["output_properties"] = JSON.stringify(["$email", "ltv"]);
   * const result = await ws.runUserParams(params, { limit: 500, parallel: true });
   * ```
   * @see mixpanel_headless.workspace.Workspace.run_user_params
   */
  async runUserParams(
    params: ParamsDict,
    options: WorkspaceRunUserParamsOptions = {},
  ): Promise<UserQueryResult> {
    return userQueryEngine.runUserParams(
      this.#userQueryHost(),
      params,
      options,
    );
  }

  /**
   * Build validated engage params without calling the API.
   *
   * @param options - The same 19 keyword-only knobs.
   * @returns The engage params dict.
   * @throws {@link BookmarkValidationError} - Argument or param validation.
   * @see mixpanel_headless.workspace.Workspace.build_user_params
   */
  buildUserParams(
    options: WorkspaceUserQueryOptions = {},
  ): Promise<ParamsDict> {
    return asPromise(() => this.#resolveUserParams(options));
  }

  /**
   * Shared body of {@link queryUser} and {@link buildUserParams}.
   *
   * @param options - The keyword-only knobs.
   * @returns The validated engage params dict.
   * @throws {@link BookmarkValidationError} - Any validation layer.
   */
  // eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
  #resolveUserParams(options: WorkspaceUserQueryOptions): ParamsDict {
    return resolveAndBuildUserParams({
      where: options.where ?? null,
      cohort: options.cohort ?? null,
      properties: options.properties ?? null,
      sort_by: options.sort_by ?? null,
      sort_order: options.sort_order ?? "descending",
      search: options.search ?? null,
      distinct_id: options.distinct_id ?? null,
      distinct_ids: options.distinct_ids ?? null,
      group_id: options.group_id ?? null,
      as_of: options.as_of ?? null,
      mode: options.mode ?? "aggregate",
      aggregate: options.aggregate ?? "count",
      aggregate_property: options.aggregate_property ?? null,
      percentile: options.percentile ?? null,
      segment_by: options.segment_by ?? null,
      limit: options.limit === undefined ? 1 : options.limit,
      parallel: options.parallel ?? false,
      workers: options.workers ?? userQueryEngine.DEFAULT_USER_QUERY_WORKERS,
      include_all_users: options.include_all_users ?? false,
      ...(options.today === undefined ? {} : { today: options.today }),
    });
  }

  /**
   * The facade slice the user-query engines read.
   *
   * @returns The host view over this facade.
   */
  #userQueryHost(): userQueryEngine.UserQueryHost {
    return { client: this.client, logger: this.#logger };
  }

  /**
   * `int(self._session.project.id)` — the
   * project id every inline query body carries.
   *
   * @returns The numeric project id.
   * @throws {@link MixpanelHeadlessError} - `PY_INT_INVALID_LITERAL` when the
   *   stored id is not an integer literal (CPython's `int(str)` grammar).
   */
  #projectId(): number {
    return pythonInt(this.session.project.id);
  }

  // --- Discovery/lexicon members ---

  /**
   * List event names in the Mixpanel project.
   *
   * Defaults to the widest window `/events/names` accepts
   * (`limit=5000`, `from_date=2000-01-01`, `to_date=today`); the wire
   * layer retries a date-range-gated 403 with the project's
   * `max_data_history_days` ceiling. The result reflects events seen in
   * the window — it is not the Lexicon registry.
   *
   * Cached per `(limit, from_date, to_date)` for the facade's lifetime.
   *
   * @param options - Optional limit / date bounds.
   * @returns Alphabetically sorted event names.
   * @throws {@link AuthenticationError} - Credentials rejected.
   * @throws {@link QueryError} - Non-gate 403s and other 4xx errors.
   * @see mixpanel_headless.workspace.Workspace.events
   */
  async events(options: WorkspaceEventsOptions = {}): Promise<string[]> {
    return this.discoveryService.listEvents(options);
  }

  /**
   * List all property names for an event. Cached per event.
   *
   * @param event - Event name.
   * @returns Alphabetically sorted property names.
   * @throws {@link EventNotFoundError} - Unknown event (with suggestions).
   * @see mixpanel_headless.workspace.Workspace.properties
   */
  async properties(event: string): Promise<string[]> {
    return this.discoveryService.listProperties(event);
  }

  /**
   * Get sample values for a property. Cached per
   * `(property, event, limit)`.
   *
   * @param propertyName - Property to get values for.
   * @param options - Optional event filter and limit.
   * @returns Sample property values as strings (unsorted).
   * @throws {@link AuthenticationError} - Credentials rejected.
   * @example
   * ```typescript
   * const values = await ws.propertyValues("plan", { event: "Purchase", limit: 20 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.property_values
   */
  async propertyValues(
    propertyName: string,
    options: WorkspacePropertyValuesOptions = {},
  ): Promise<string[]> {
    return this.discoveryService.listPropertyValues(propertyName, options);
  }

  /**
   * List inferred subproperties of a list-of-object property.
   *
   * Only scalar sub-values (string / number / boolean / ISO datetime
   * string) are reported; nested dicts and lists are skipped because
   * `GroupBy.list_item` / `Filter.list_contains` cannot use them.
   *
   * @param propertyName - Top-level property name (e.g. `"cart"`).
   * @param options - Optional event scope and sample size.
   * @returns Alphabetically sorted subproperty infos.
   * @throws {@link AuthenticationError} - Credentials rejected.
   *
   * Emits the injected {@link WarningSink} (Python `UserWarning`) for
   * mixed scalar types, mixed scalar/nested shapes, and all-null keys.
   * @example
   * ```typescript
   * for (const sp of await ws.subproperties("cart", { event: "Cart Viewed" })) {
   *   console.log(sp.name, sp.type, sp.sample_values);
   * }
   * ```
   * @see mixpanel_headless.workspace.Workspace.subproperties
   */
  async subproperties(
    propertyName: string,
    options: WorkspaceSubpropertiesOptions = {},
  ): Promise<SubPropertyInfo[]> {
    return this.discoveryService.listSubproperties(propertyName, options);
  }

  /**
   * List saved funnels. Cached.
   *
   * @returns Funnel infos sorted by name.
   * @throws {@link AuthenticationError} - Credentials rejected.
   * @see mixpanel_headless.workspace.Workspace.funnels
   */
  async funnels(): Promise<FunnelInfo[]> {
    return this.discoveryService.listFunnels();
  }

  /**
   * List saved cohorts. Cached.
   *
   * @returns Saved cohorts sorted by name.
   * @throws {@link AuthenticationError} - Credentials rejected.
   * @see mixpanel_headless.workspace.Workspace.cohorts
   */
  async cohorts(): Promise<SavedCohort[]> {
    return this.discoveryService.listCohorts();
  }

  /**
   * List saved reports (bookmarks). Not cached.
   *
   * @param bookmarkType - Optional report-type filter.
   * @returns Bookmark metadata rows (empty when none exist).
   * @throws {@link QueryError} - Permission denied or invalid type parameter.
   * @see mixpanel_headless.workspace.Workspace.list_bookmarks
   */
  async listBookmarks(
    bookmarkType: BookmarkType | null = null,
  ): Promise<BookmarkInfo[]> {
    return this.discoveryService.listBookmarks(bookmarkType);
  }

  /**
   * List today's most active events. Not cached — real-time data.
   *
   * @param options - Counting method and limit.
   * @returns Top events with `event`, `count` and `percent_change`.
   * @throws {@link AuthenticationError} - Credentials rejected.
   * @see mixpanel_headless.workspace.Workspace.top_events
   */
  async topEvents(
    options: WorkspaceTopEventsOptions = {},
  ): Promise<TopEvent[]> {
    return this.discoveryService.listTopEvents({
      type: options.type ?? "general",
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    });
  }

  /**
   * Clear cached discovery results.
   *
   * @remarks
   * Mirrors Python's guard exactly: when the discovery service has never
   * been created there is nothing to clear and no service is constructed
   * as a side effect.
   * @returns Nothing.
   * @see mixpanel_headless.workspace.Workspace.clear_discovery_cache
   */
  clearDiscoveryCache(): Promise<void> {
    if (this.#discovery !== null) {
      this.#discovery.clearCache();
    }
    return Promise.resolve();
  }

  /**
   * List Lexicon schemas. Cached for the facade's lifetime — the
   * Lexicon API allows only 5 requests/minute.
   *
   * @param options - Optional entity-type filter.
   * @returns Schemas sorted by `(entity_type, name)`.
   * @throws {@link AuthenticationError} - Credentials rejected.
   * @see mixpanel_headless.workspace.Workspace.lexicon_schemas
   */
  async lexiconSchemas(
    options: WorkspaceLexiconSchemasOptions = {},
  ): Promise<LexiconSchema[]> {
    return this.discoveryService.listSchemas(options);
  }

  /**
   * Get one Lexicon schema. Cached.
   *
   * @param entityType - Entity type (`"event"` / `"profile"`).
   * @param name - Entity name.
   * @returns The schema.
   * @throws {@link QueryError} - Schema not found.
   * @example
   * ```typescript
   * const schema = await ws.lexiconSchema("event", "Purchase");
   * ```
   * @see mixpanel_headless.workspace.Workspace.lexicon_schema
   */
  async lexiconSchema(
    entityType: EntityType,
    name: string,
  ): Promise<LexiconSchema> {
    return this.discoveryService.getSchema(entityType, name);
  }

  /**
   * Gather the full Lexicon schema and the event↔property
   * relationships. Cached
   * per `(include_density, include_user_properties)`.
   *
   * The adjacency comes from the query API's per-event properties
   * gather, which tolerates large projects (the App API join it
   * replaces timed out at the ~120s gateway deadline); on very large
   * projects the gather can still take minutes.
   *
   * Group properties are not gathered (headless has no data-groups
   * listing to enumerate them).
   *
   * @param options - Density / user-property / refresh switches.
   * @returns The schema graph, with row views and `toGraph()`.
   * @throws {@link AuthenticationError} - Credentials rejected.
   * @example
   * ```typescript
   * const schema = await ws.schemaGraph();
   * schema.propertiesForEvent("Purchase");
   * schema.toGraph();
   * ```
   * @see mixpanel_headless.workspace.Workspace.schema_graph
   */
  async schemaGraph(
    options: WorkspaceSchemaGraphOptions = {},
  ): Promise<SchemaGraphResult> {
    return this.discoveryService.getSchemaGraph(options);
  }

  // --- Session-replay members ---

  /**
   * Get or create the session-replay service.
   *
   * @remarks
   * Constructed on first access with the bound {@link query} injected as
   * its `queryFn`, so `ReplaysService.discover` / `eventsFor` can issue
   * Insights queries without a hard dependency on `Workspace` (the same
   * circular-import-free injection Python uses). Settable, mirroring
   * Python's `self._replays_svc = ...` attribute write — the seam the
   * test suites and the conformance bindings substitute a stub through.
   * @returns The memoized service.
   * @internal
   * @see mixpanel_headless.workspace.Workspace._replays_service
   */
  get replaysService(): ReplaysService {
    if (this.#replays === null) {
      this.#replays = new ReplaysService(this.client, {
        queryFn: async (
          events: string,
          options: Readonly<Record<string, unknown>>,
        ) => this.query(events, options),
        ...(this.#warn === undefined ? {} : { warn: this.#warn }),
        logger: this.#logger,
      });
    }
    return this.#replays;
  }

  /**
   * Replace the memoized replays service (Python's plain attribute
   * write).
   *
   * @param service - The service to bind.
   * @internal
   */
  set replaysService(service: ReplaysService) {
    this.#replays = service;
  }

  /**
   * The facade slice the replay members read; the service and the
   * project id stay lazy (thunks) so they resolve where Python reads them.
   *
   * @returns The host view over this facade.
   */
  #replayHost(): replayMethods.ReplayHost {
    return {
      client: this.client,
      logger: this.#logger,
      replaysService: () => this.replaysService,
      projectId: () => this.#projectId(),
      listReplays: (options) => this.listReplays(options),
      eventsForReplay: (replayId, options) =>
        this.eventsForReplay(replayId, options),
      eventsForReplays: (replayIds, options) =>
        this.eventsForReplays(replayIds, options),
      fetchReplay: (replayId, options) => this.fetchReplay(replayId, options),
      fetchReplays: (replayIds, options) =>
        this.fetchReplays(replayIds, options),
    };
  }

  /**
   * List replays for a user, or hydrate summaries for explicit IDs.
   *
   * Exactly one of `distinct_id` or `replay_ids` must be provided.
   * When `distinct_id` is set, `from_date` and `to_date` are required.
   *
   * @param options - The selector, the optional window, and the limit.
   * @returns `ReplaySummary` rows, possibly empty.
   * @throws {@link ParamValidationError} - Neither or both selectors
   *   (`WR4_REPLAY_SELECTOR_REQUIRED`), or `distinct_id` without a date
   *   window (`WR5_DATE_RANGE_REQUIRED`).
   * @throws {@link QueryError} - Underlying Insights API failure.
   * @see mixpanel_headless.workspace.Workspace.list_replays
   */
  async listReplays(
    options: WorkspaceListReplaysOptions = {},
  ): Promise<ReplaySummary[]> {
    return replayMethods.listReplays(this.#replayHost(), options);
  }

  /**
   * Mixpanel events that occurred during a single replay's time window.
   *
   * @param replayId - The replay to fetch events for.
   * @param options - Extra group keys and the optional window.
   * @returns Ordered `ReplayEvent`s; empty when the window has none.
   * @throws {@link ParamValidationError} - More than 5 `event_properties`
   *   (`WR1_TOO_MANY_EVENT_PROPERTIES`).
   * @throws {@link QueryError} - Underlying Insights API failure.
   * @example
   * ```typescript
   * const events = await ws.eventsForReplay("replay-id", { event_properties: ["$current_url"] });
   * ```
   * @see mixpanel_headless.workspace.Workspace.events_for_replay
   */
  async eventsForReplay(
    replayId: string,
    options: WorkspaceEventsForReplayOptions = {},
  ): Promise<ReplayEvent[]> {
    return replayMethods.eventsForReplay(this.#replayHost(), replayId, options);
  }

  /**
   * Batched version of {@link eventsForReplay} — single round-trip.
   *
   * @param replayIds - Replays to fetch events for.
   * @param options - Extra group keys and the optional window.
   * @returns `replay_id` → ordered `ReplayEvent` list, as a `Map` so
   *   integer-like ids keep their order; replays with no events are
   *   omitted.
   * @throws {@link ParamValidationError} - More than 5 `event_properties`
   *   (`WR1_TOO_MANY_EVENT_PROPERTIES`).
   * @throws {@link QueryError} - Underlying Insights API failure.
   * @example
   * ```typescript
   * const byReplay = await ws.eventsForReplays(["r1", "r2"], {
   *   from_date: "2026-01-01",
   *   to_date: "2026-01-31",
   * });
   * ```
   * @see mixpanel_headless.workspace.Workspace.events_for_replays
   */
  async eventsForReplays(
    replayIds: readonly string[],
    options: WorkspaceEventsForReplayOptions = {},
  ): Promise<Map<string, ReplayEvent[]>> {
    return replayMethods.eventsForReplays(
      this.#replayHost(),
      replayIds,
      options,
    );
  }

  /**
   * Sign a single replay ID; sugar over {@link signReplays}.
   *
   * @param replayId - Replay to sign.
   * @param options - `env` (`"prod"` default).
   * @returns One `SignedReplay`. `query_string` is a 5-minute bearer
   *   credential — treat it like a session token.
   * @throws {@link SessionReplayAccessError} - Sensitive-data flag set.
   * @throws {@link QueryError} | {@link ServerError} - Other 4xx / 5xx.
   * @example
   * ```typescript
   * const signed = await ws.signReplay("replay-id", { env: "prod" });
   * ```
   * @see mixpanel_headless.workspace.Workspace.sign_replay
   */
  async signReplay(
    replayId: string,
    options: WorkspaceSignReplayOptions = {},
  ): Promise<SignedReplay> {
    return replayMethods.signReplay(this.#replayHost(), replayId, options);
  }

  /**
   * Sign multiple replays via the bulk endpoint.
   *
   * @param replayIds - Replays to sign.
   * @param options - `env` (`"prod"` default).
   * @returns `SignedReplay`s in input order.
   * @throws {@link SessionReplayAccessError} - Sensitive-data flag set.
   * @throws {@link QueryError} | {@link ServerError} - Other 4xx / 5xx.
   * @example
   * ```typescript
   * const signed = await ws.signReplays(["r1", "r2"], { env: "prod" });
   * ```
   * @see mixpanel_headless.workspace.Workspace.sign_replays
   */
  async signReplays(
    replayIds: readonly string[],
    options: WorkspaceSignReplayOptions = {},
  ): Promise<SignedReplay[]> {
    return replayMethods.signReplays(this.#replayHost(), replayIds, options);
  }

  /**
   * Sign, fetch, and assemble a single `Replay`.
   *
   * @remarks
   * Runs the vendored rrweb analyzer to populate `Replay.actions`; the
   * raw `rrweb_events` list is also populated for downstream tools.
   * Python's event-loop caveat (`asyncio.run` cannot run inside a
   * running loop) has no TS counterpart — this member is `async` and
   * composes naturally; the Python docstring's advice to drive
   * `walk_cdn_async` directly maps to `ReplaysService.walkCdnAsync` on
   * `@mixpanel-headless/core/internal`.
   * @param replayId - The replay to fetch.
   * @param options - Retention / bounds / concurrency / join knobs.
   * @returns A `Replay` with `rrweb_events` and `actions` populated.
   * @throws {@link ReplayNotFoundError} - First CDN file 404'd, or the walk
   *   yielded zero events.
   * @throws {@link SessionReplayAccessError} - Sensitive-data flag set.
   * @throws {@link SignedURLExpiredError} - Signed URL expired during fetch.
   * @throws {@link ParamValidationError} - More than 5 `event_properties`.
   * @example
   * ```typescript
   * const replay = await ws.fetchReplay("replay-id", { include_mixpanel_events: true });
   * ```
   * @see mixpanel_headless.workspace.Workspace.fetch_replay
   */
  async fetchReplay(
    replayId: string,
    options: WorkspaceFetchReplayOptions = {},
  ): Promise<Replay> {
    return replayMethods.fetchReplay(this.#replayHost(), replayId, options);
  }

  /**
   * Yield raw rrweb events one at a time, fetched batched-parallel under
   * the hood.
   *
   * @remarks
   * An item-level `yield*` over the service generator, so nothing
   * buffers. Python's private-event-loop plumbing
   * (`asyncio.new_event_loop` + `run_until_complete(gen.__anext__())`)
   * has no TS counterpart: the async generator composes directly, and
   * the `finally: gen.aclose()` contract is what `for await` +
   * `AsyncGenerator.return()` already guarantee.
   * @param replayId - The replay to stream.
   * @param options - Retention / bounds / concurrency / re-sign policy.
   * @yields Raw rrweb event dicts in timestamp order.
   * @throws {@link ReplayNotFoundError} - First CDN file 404'd.
   * @throws {@link SignedURLExpiredError} - Re-sign retry exhausted or
   *   disabled.
   * @throws {@link SessionReplayAccessError} - Sensitive-data flag set.
   * @example
   * ```typescript
   * for await (const event of ws.streamReplay("replay-id", { max_files: 50 })) {
   *   console.log(event["timestamp"]);
   * }
   * ```
   * @see mixpanel_headless.workspace.Workspace.stream_replay
   */
  async *streamReplay(
    replayId: string,
    options: WorkspaceStreamReplayOptions = {},
  ): AsyncGenerator<Readonly<Record<string, unknown>>, void, undefined> {
    yield* replayMethods.streamReplay(this.#replayHost(), replayId, options);
  }

  /**
   * Fetch several replays in parallel and return them as a `ReplayBundle`.
   *
   * @remarks
   * Materializes each replay via {@link fetchReplay} and bundles them.
   * Outer `concurrency` parallelizes across replays; inner
   * `cdn_concurrency` parallelizes each replay's CDN file walk. Python
   * uses a `ThreadPoolExecutor` purely so each replay's `asyncio.run`
   * gets its own event loop — the port needs no such isolation, so the
   * outer level is bounded-concurrency promise scheduling with the same
   * worker cap, the same input-order output and the same per-replay
   * failure isolation: a replay that 404s, stalls, or fails to parse is
   * logged, recorded on `ReplayBundle.failures` and skipped; only an
   * all-fail batch throws (the first underlying error, preserving its
   * type).
   * @param replayIds - Replays to fetch.
   * @param options - Env / bounds / concurrency / join / retention and
   *   distinct-id maps.
   * @returns A `ReplayBundle` with `replays` in input order (failed
   *   replays omitted).
   * @throws {@link MixpanelHeadlessError} - Only when every requested replay
   *   failed; the first underlying error propagates with its type.
   * @throws {@link ParamValidationError} - More than 5 `event_properties`.
   * @example
   * ```typescript
   * const bundle = await ws.fetchReplays(["r1", "r2"], { concurrency: 4 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.fetch_replays
   */
  async fetchReplays(
    replayIds: readonly string[],
    options: WorkspaceFetchReplaysOptions = {},
  ): Promise<ReplayBundle> {
    return replayMethods.fetchReplays(this.#replayHost(), replayIds, options);
  }

  /**
   * Discovery + fetch in one call.
   *
   * Composes {@link listReplays} and {@link fetchReplays}. Defaults
   * `include_mixpanel_events` to `true` since this is the "show me what
   * this user did" convenience method. The default `limit` is a
   * conservative 20 — each replay materializes its full byte stream.
   *
   * @param distinctId - Mixpanel user identifier.
   * @param options - The required window plus the limit / join knobs.
   * @returns A `ReplayBundle`; empty when no replays exist in the
   *   window.
   * @throws {@link ParamValidationError} - More than 5 `event_properties`.
   * @example
   * ```typescript
   * const bundle = await ws.replaysForUser("user-1", {
   *   from_date: "2026-01-01",
   *   to_date: "2026-01-31",
   *   limit: 5,
   * });
   * ```
   * @see mixpanel_headless.workspace.Workspace.replays_for_user
   */
  async replaysForUser(
    distinctId: string,
    options: WorkspaceReplaysForUserOptions,
  ): Promise<ReplayBundle> {
    return replayMethods.replaysForUser(
      this.#replayHost(),
      distinctId,
      options,
    );
  }

  /**
   * Sign + fetch + analyze a replay, returning only the markdown
   * timeline.
   *
   * @param replayId - The replay to analyze.
   * @returns The markdown timeline (`Replay.summaryMarkdown()`).
   * @throws {@link ReplayNotFoundError} - First CDN file 404'd.
   * @throws {@link SessionReplayAccessError} - Sensitive-data flag set.
   * @see mixpanel_headless.workspace.Workspace.analyze_replay
   */
  async analyzeReplay(replayId: string): Promise<string> {
    return replayMethods.analyzeReplay(this.#replayHost(), replayId);
  }
  // --- Lifecycle, /me and business context ---

  /**
   * The resolved account of the current session.
   *
   * @returns The account.
   * @see mixpanel_headless.workspace.Workspace.account
   */
  get account(): Account {
    return this.#session.account;
  }

  /**
   * The resolved project of the current session.
   *
   * @returns The project.
   * @see mixpanel_headless.workspace.Workspace.project
   */
  get project(): Project {
    return this.#session.project;
  }

  /**
   * The resolved workspace, or `null` when scoping stays lazy.
   *
   * @returns The workspace reference, if one is pinned.
   * @see mixpanel_headless.workspace.Workspace.workspace
   */
  get workspace(): WorkspaceRef | null {
    return this.#session.workspace ?? null;
  }

  /**
   * Direct access to the wire client — the escape hatch for endpoints
   * the facade does not cover.
   *
   * @returns The bound client.
   * @see mixpanel_headless.workspace.Workspace.api
   */
  get api(): MixpanelClient {
    return this.client;
  }

  /**
   * Get or create the `/me` service.
   *
   * @returns The memoized service, scoped to the current account.
   * @internal
   */
  get meService(): MeService {
    if (this.#meService === null) {
      let store = this.#meCacheStores.get(this.#accountName);
      if (store === undefined) {
        store = this.#meCacheFactory(this.#accountName);
        this.#meCacheStores.set(this.#accountName, store);
      }
      this.#meService = new MeService(
        this.client,
        store,
        this.#session.account.region,
        { accountType: this.#session.account.type },
      );
    }
    return this.#meService;
  }

  /**
   * The `/me` service only if it has already been created — the
   * `self._me_service is None` peek `_cached_organization_id` performs.
   * Never constructs one.
   *
   * @returns The service, or `null` before first use.
   * @internal
   */
  get meServiceIfCreated(): MeService | null {
    return this.#meService;
  }

  /**
   * List every public workspace of the current project.
   *
   * @returns The project's `PublicWorkspace` models.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.list_workspaces
   */
  async listWorkspaces(): Promise<PublicWorkspace[]> {
    return this.client.listWorkspaces();
  }

  /**
   * Resolve the workspace ID used for scoped requests.
   *
   * @returns The resolved workspace ID.
   * @throws {@link WorkspaceScopeError} - No workspace resolvable.
   * @see mixpanel_headless.workspace.Workspace.resolve_workspace_id
   */
  async resolveWorkspaceId(): Promise<number> {
    return this.client.resolveWorkspaceId();
  }

  /**
   * Fetch the `/me` response for the current credentials, cached for 24
   * hours by the injected store.
   *
   * @param options - `force_refresh` bypasses the caches.
   * @returns The `/me` response.
   * @throws {@link ConfigError} - Credentials lack `/me` access (401/403).
   * @throws {@link QueryError} - Any other API error.
   * @see mixpanel_headless.workspace.Workspace.me
   */
  async me(options: WorkspaceMeOptions = {}): Promise<MeResponse> {
    return this.meService.fetch({
      force_refresh: options.force_refresh ?? false,
    });
  }

  /**
   * List the projects the credentials can access, via the `/me` API.
   *
   * @param options - `refresh` bypasses the `/me` caches first.
   * @returns Projects sorted by name.
   * @throws {@link ConfigError} - Credentials lack `/me` access.
   * @example
   * ```typescript
   * for (const project of await ws.projects()) {
   *   await ws.use({ project: project.id });
   * }
   * ```
   * @see mixpanel_headless.workspace.Workspace.projects
   */
  async projects(options: WorkspaceProjectsOptions = {}): Promise<Project[]> {
    const service = this.meService;
    if (options.refresh === true) {
      await service.fetch({ force_refresh: true });
    }
    const entries = await service.listProjects();
    return entries.map(([pid, info]) => ({
      id: pid,
      name: info.name,
      organization_id: info.organization_id,
      timezone: info.timezone,
    }));
  }

  /**
   * List a project's workspaces via the `/me` API.
   *
   * @param options - `project_id` (defaults to the current project)
   *   and `refresh`.
   * @returns Workspace references sorted by name.
   * @throws {@link ConfigError} - Credentials lack `/me` access, or a
   *   non-numeric `project_id`.
   * @see mixpanel_headless.workspace.Workspace.workspaces
   */
  async workspaces(
    options: WorkspaceWorkspacesOptions = {},
  ): Promise<WorkspaceRef[]> {
    const service = this.meService;
    if (options.refresh === true) {
      await service.fetch({ force_refresh: true });
    }
    const pid = options.project_id ?? this.#session.project.id;
    const infos = await service.listWorkspaces({ project_id: pid });
    return infos.map((info) => ({
      id: info.id,
      name: info.name,
      is_default: info.is_default,
    }));
  }

  /**
   * Stream raw events from the Export API. Project-scoped by design,
   * even when a workspace is pinned.
   *
   * @param options - Date window plus filters / `raw`.
   * @yields Event dicts, in export order.
   * @throws {@link ParamValidationError} - `WR2_LIMIT_TOO_SMALL` /
   *   `WR3_LIMIT_TOO_LARGE` (on the first pull).
   * @example
   * ```typescript
   * for await (const event of ws.streamEvents({ from_date: "2026-01-01", to_date: "2026-01-02" })) {
   *   console.log(event);
   * }
   * ```
   * @see mixpanel_headless.workspace.Workspace.stream_events
   */
  async *streamEvents(
    options: StreamEventsOptions,
  ): AsyncGenerator<unknown, void, undefined> {
    yield* streamEventsVeneer(this.client, options);
  }

  /**
   * Stream user profiles from the Engage API.
   *
   * @param options - Filters plus `raw`.
   * @yields Profile dicts, page by page.
   * @throws {@link ParamValidationError} - The mutually-exclusive-filter
   *   guards (on the first pull).
   * @see mixpanel_headless.workspace.Workspace.stream_profiles
   */
  async *streamProfiles(
    options: StreamProfilesOptions = {},
  ): AsyncGenerator<unknown, void, undefined> {
    yield* streamProfilesVeneer(this.client, options);
  }

  /**
   * Read business context at the given scope.
   *
   * @param options - `level` (default `"project"`) and an optional
   *   explicit `organization_id`.
   * @returns The populated context (`content: ""` when unset).
   * @throws {@link ParamValidationError} - `WS2_INVALID_LEVEL`.
   * @throws {@link WorkspaceScopeError} - `ORGANIZATION_AMBIGUOUS`.
   * @throws {@link MixpanelHeadlessError} - Response missing `content`.
   * @see mixpanel_headless.workspace.Workspace.get_business_context
   */
  async getBusinessContext(
    options: BusinessContextScopeOptions = {},
  ): Promise<BusinessContext> {
    return lifecycle.getBusinessContext(this.#businessContextHost(), options);
  }

  /**
   * Replace business context at the given scope.
   *
   * @param content - New markdown content (empty string clears).
   * @param options - `level` / `organization_id`.
   * @returns The context echoed by the server.
   * @throws {@link BusinessContextValidationError} - Content over 50,000
   *   characters (no HTTP call is made).
   * @throws {@link ParamValidationError} - `WS2_INVALID_LEVEL`.
   * @throws {@link WorkspaceScopeError} - `ORGANIZATION_AMBIGUOUS` at the
   *   organization level.
   * @throws {@link MixpanelHeadlessError} - Response missing `content`.
   * @example
   * ```typescript
   * await ws.setBusinessContext("# Acme\nB2B SaaS, EMEA focus.", { level: "project" });
   * ```
   * @see mixpanel_headless.workspace.Workspace.set_business_context
   */
  async setBusinessContext(
    content: string,
    options: BusinessContextScopeOptions = {},
  ): Promise<BusinessContext> {
    return lifecycle.setBusinessContext(
      this.#businessContextHost(),
      content,
      options,
    );
  }

  /**
   * Clear business context at the given scope — the
   * documented alias for `set_business_context("")`.
   *
   * @param options - `level` / `organization_id`.
   * @returns The cleared context.
   * @throws {@link ParamValidationError} - `WS2_INVALID_LEVEL`.
   * @throws {@link WorkspaceScopeError} - `ORGANIZATION_AMBIGUOUS` at the
   *   organization level.
   * @see mixpanel_headless.workspace.Workspace.clear_business_context
   */
  async clearBusinessContext(
    options: BusinessContextScopeOptions = {},
  ): Promise<BusinessContext> {
    return this.setBusinessContext("", options);
  }

  /**
   * Read organization and project business context together in one
   * request.
   *
   * @returns Both scopes; `organization.organization_id` stays `null`
   *   when the `/me` cache is cold (single-round-trip guarantee).
   * @throws {@link MixpanelHeadlessError} - Response missing `org_context` or
   *   `project_context`.
   * @see mixpanel_headless.workspace.Workspace.get_business_context_chain
   */
  async getBusinessContextChain(): Promise<BusinessContextChain> {
    return lifecycle.getBusinessContextChain(this.#businessContextHost());
  }

  /**
   * The facade slice the business-context member module reads.
   *
   * @returns The host view over this facade.
   * @internal
   */
  #businessContextHost(): BusinessContextHost {
    return {
      client: this.client,
      projectId: this.#session.project.id,
      meService: () => this.meService,
      meServiceIfCreated: () => this.meServiceIfCreated,
    };
  }

  // --- Dashboard members ---

  /**
   * List dashboards for the current project/workspace.
   *
   * @param options - Optional `ids` filter.
   * @returns The `Dashboard` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed API response payload
   *   (`RESPONSE_VALIDATION_ERROR`).
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @example
   * ```typescript
   * for (const d of await ws.listDashboards()) {
   *   console.log(`${d.title} (id=${String(d.id)})`);
   * }
   * ```
   * @see mixpanel_headless.workspace.Workspace.list_dashboards
   */
  async listDashboards(
    options: WorkspaceListDashboardsOptions = {},
  ): Promise<Dashboard[]> {
    return dashboards.listDashboards(this.client, options);
  }

  /**
   * Create a new dashboard.
   *
   * @param params - Dashboard creation parameters.
   * @returns The newly created `Dashboard`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.create_dashboard
   */
  async createDashboard(params: CreateDashboardParams): Promise<Dashboard> {
    return dashboards.createDashboard(this.client, params);
  }

  /**
   * Fetch a single dashboard by id.
   *
   * @param dashboardId - Dashboard identifier.
   * @returns The `Dashboard`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.get_dashboard
   */
  async getDashboard(dashboardId: number): Promise<Dashboard> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.getDashboard(this.client, dashboardId);
  }

  /**
   * Update an existing dashboard.
   *
   * @param dashboardId - Dashboard identifier.
   * @param params - Fields to update.
   * @returns The updated `Dashboard`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   * @example
   * ```typescript
   * await ws.updateDashboard(12, new UpdateDashboardParams({ title: "Renamed" }));
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_dashboard
   */
  async updateDashboard(
    dashboardId: number,
    params: UpdateDashboardParams,
  ): Promise<Dashboard> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.updateDashboard(this.client, dashboardId, params);
  }

  /**
   * Delete a dashboard.
   *
   * @param dashboardId - Dashboard identifier.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.delete_dashboard
   */
  async deleteDashboard(dashboardId: number): Promise<void> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.deleteDashboard(this.client, dashboardId);
  }

  /**
   * Delete multiple dashboards.
   *
   * @param ids - Dashboard IDs to delete.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.bulk_delete_dashboards
   */
  async bulkDeleteDashboards(ids: readonly number[]): Promise<void> {
    return dashboards.bulkDeleteDashboards(this.client, ids);
  }

  /**
   * Favorite a dashboard.
   *
   * @param dashboardId - Dashboard identifier.
   * @returns Nothing.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.favorite_dashboard
   */
  async favoriteDashboard(dashboardId: number): Promise<void> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.favoriteDashboard(this.client, dashboardId);
  }

  /**
   * Unfavorite a dashboard.
   *
   * @param dashboardId - Dashboard identifier.
   * @returns Nothing.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.unfavorite_dashboard
   */
  async unfavoriteDashboard(dashboardId: number): Promise<void> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.unfavoriteDashboard(this.client, dashboardId);
  }

  /**
   * Pin a dashboard.
   *
   * @param dashboardId - Dashboard identifier.
   * @returns Nothing.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.pin_dashboard
   */
  async pinDashboard(dashboardId: number): Promise<void> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.pinDashboard(this.client, dashboardId);
  }

  /**
   * Unpin a dashboard.
   *
   * @param dashboardId - Dashboard identifier.
   * @returns Nothing.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.unpin_dashboard
   */
  async unpinDashboard(dashboardId: number): Promise<void> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.unpinDashboard(this.client, dashboardId);
  }

  /**
   * Remove a report from a dashboard.
   *
   * @param dashboardId - Dashboard identifier.
   * @param bookmarkId - Bookmark/report identifier to remove.
   * @returns The updated `Dashboard`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dashboardId` / `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   * @example
   * ```typescript
   * const dash = await ws.removeReportFromDashboard(12, 987);
   * ```
   * @see mixpanel_headless.workspace.Workspace.remove_report_from_dashboard
   */
  async removeReportFromDashboard(
    dashboardId: number,
    bookmarkId: number,
  ): Promise<Dashboard> {
    requireEntityId("dashboard_id", dashboardId);
    requireEntityId("bookmark_id", bookmarkId);
    return dashboards.removeReportFromDashboard(
      this.client,
      dashboardId,
      bookmarkId,
    );
  }

  /**
   * Add a report to a dashboard — clones the bookmark onto the board.
   *
   * @param dashboardId - Dashboard identifier.
   * @param bookmarkId - Bookmark/report identifier to add.
   * @returns The updated `Dashboard`.
   * @throws {@link MixpanelHeadlessError} - Response is not a dashboard dict
   *   carrying `id` (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dashboardId` / `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   * @example
   * ```typescript
   * const dash = await ws.addReportToDashboard(12, 987);
   * ```
   * @see mixpanel_headless.workspace.Workspace.add_report_to_dashboard
   */
  async addReportToDashboard(
    dashboardId: number,
    bookmarkId: number,
  ): Promise<Dashboard> {
    requireEntityId("dashboard_id", dashboardId);
    requireEntityId("bookmark_id", bookmarkId);
    return dashboards.addReportToDashboard(
      this.client,
      dashboardId,
      bookmarkId,
    );
  }

  /**
   * List the available dashboard blueprint templates.
   *
   * @param options - `include_reports` (default `false`).
   * @returns The `BlueprintTemplate` models.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.list_blueprint_templates
   */
  async listBlueprintTemplates(
    options: WorkspaceListBlueprintTemplatesOptions = {},
  ): Promise<BlueprintTemplate[]> {
    return dashboards.listBlueprintTemplates(this.client, options);
  }

  /**
   * Create a dashboard from a blueprint template.
   *
   * @param templateType - Blueprint template type identifier.
   * @returns The newly created `Dashboard`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.create_blueprint
   */
  async createBlueprint(templateType: string): Promise<Dashboard> {
    return dashboards.createBlueprint(this.client, templateType);
  }

  /**
   * Fetch the blueprint configuration of a dashboard.
   *
   * @param dashboardId - Dashboard identifier.
   * @returns The `BlueprintConfig`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.get_blueprint_config
   */
  async getBlueprintConfig(dashboardId: number): Promise<BlueprintConfig> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.getBlueprintConfig(this.client, dashboardId);
  }

  /**
   * Replace the cohorts of a blueprint configuration.
   *
   * @param cohorts - Cohort configuration dicts.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.update_blueprint_cohorts
   */
  async updateBlueprintCohorts(
    cohorts: ReadonlyArray<Record<string, unknown>>,
  ): Promise<void> {
    return dashboards.updateBlueprintCohorts(this.client, cohorts);
  }

  /**
   * Finalize a blueprint dashboard with cards.
   *
   * @param params - Blueprint finalization parameters.
   * @returns The finalized `Dashboard`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.finalize_blueprint
   */
  async finalizeBlueprint(params: BlueprintFinishParams): Promise<Dashboard> {
    return dashboards.finalizeBlueprint(this.client, params);
  }

  /**
   * Create an RCA (Root Cause Analysis) dashboard.
   *
   * @param params - RCA dashboard parameters.
   * @returns The newly created `Dashboard`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.create_rca_dashboard
   */
  async createRcaDashboard(
    params: CreateRcaDashboardParams,
  ): Promise<Dashboard> {
    return dashboards.createRcaDashboard(this.client, params);
  }

  /**
   * List the ids of the dashboards that contain a bookmark.
   *
   * @param bookmarkId - Bookmark identifier.
   * @returns The dashboard IDs.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.get_bookmark_dashboard_ids
   */
  async getBookmarkDashboardIds(bookmarkId: number): Promise<number[]> {
    requireEntityId("bookmark_id", bookmarkId);
    return dashboards.getBookmarkDashboardIds(this.client, bookmarkId);
  }

  /**
   * Fetch the ERF data of a dashboard.
   *
   * @param dashboardId - Dashboard identifier.
   * @returns The ERF metrics mapping.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.get_dashboard_erf
   */
  async getDashboardErf(dashboardId: number): Promise<Record<string, unknown>> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.getDashboardErf(this.client, dashboardId);
  }

  /**
   * Update a report link on a dashboard.
   *
   * @param dashboardId - Dashboard identifier.
   * @param reportLinkId - Report link identifier.
   * @param params - Update parameters.
   * @returns Nothing.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dashboardId` / `reportLinkId`
   *   is not a positive integer (network-free guard, before any request).
   * @example
   * ```typescript
   * await ws.updateReportLink(12, 456, new UpdateReportLinkParams({ link_type: "embedded" }));
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_report_link
   */
  async updateReportLink(
    dashboardId: number,
    reportLinkId: number,
    params: UpdateReportLinkParams,
  ): Promise<void> {
    requireEntityId("dashboard_id", dashboardId);
    requireEntityId("report_link_id", reportLinkId);
    return dashboards.updateReportLink(
      this.client,
      dashboardId,
      reportLinkId,
      params,
    );
  }

  /**
   * Update a text card on a dashboard.
   *
   * @param dashboardId - Dashboard identifier.
   * @param textCardId - Text card identifier.
   * @param params - Update parameters.
   * @returns Nothing.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dashboardId` / `textCardId`
   *   is not a positive integer (network-free guard, before any request).
   * @example
   * ```typescript
   * await ws.updateTextCard(12, 789, new UpdateTextCardParams({ markdown: "## Notes" }));
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_text_card
   */
  async updateTextCard(
    dashboardId: number,
    textCardId: number,
    params: UpdateTextCardParams,
  ): Promise<void> {
    requireEntityId("dashboard_id", dashboardId);
    requireEntityId("text_card_id", textCardId);
    return dashboards.updateTextCard(
      this.client,
      dashboardId,
      textCardId,
      params,
    );
  }

  // --- Bookmark/report + cohort members ---

  /**
   * List bookmarks/reports via the App API v2 endpoint.
   *
   * @param options - Optional `bookmark_type` / `ids` filters.
   * @returns The `Bookmark` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed API response payload
   *   (`RESPONSE_VALIDATION_ERROR`).
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @example
   * ```typescript
   * for (const r of await ws.listBookmarksV2({ bookmark_type: "funnels" })) {
   *   console.log(`${r.name} (${r.bookmark_type})`);
   * }
   * ```
   * @see mixpanel_headless.workspace.Workspace.list_bookmarks_v2
   */
  async listBookmarksV2(
    options: WorkspaceListBookmarksV2Options = {},
  ): Promise<Bookmark[]> {
    return bookmarksCohorts.listBookmarksV2(this.client, options);
  }

  /**
   * Create a new bookmark (saved report).
   *
   * @remarks
   * `dashboard_id` is required by the Mixpanel v2 API; the create call
   * stores the bookmark and a second request then places it on that
   * dashboard.
   * @param params - Bookmark creation parameters.
   * @returns The newly created `Bookmark`.
   * @throws {@link MixpanelHeadlessError} - `dashboard_id` missing, or an empty
   *   response (`UNKNOWN_ERROR`).
   * @throws {@link BookmarkValidationError} - Client-side schema validation
   *   failed (raised before the API call).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.create_bookmark
   */
  async createBookmark(params: CreateBookmarkParams): Promise<Bookmark> {
    return bookmarksCohorts.createBookmark(
      this.client,
      params,
      (dashboardId, bookmarkId) =>
        this.addReportToDashboard(dashboardId, bookmarkId),
      this.#logger,
    );
  }

  /**
   * Fetch a single bookmark by id.
   *
   * @param bookmarkId - Bookmark identifier.
   * @returns The `Bookmark`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.get_bookmark
   */
  async getBookmark(bookmarkId: number): Promise<Bookmark> {
    requireEntityId("bookmark_id", bookmarkId);
    return bookmarksCohorts.getBookmark(this.client, bookmarkId);
  }

  /**
   * Update an existing bookmark.
   *
   * @param bookmarkId - Bookmark identifier.
   * @param params - Fields to update.
   * @returns The updated `Bookmark`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link BookmarkValidationError} - Partial-mode schema validation
   *   failed (raised before the API call).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   * @example
   * ```typescript
   * await ws.updateBookmark(987, new UpdateBookmarkParams({ name: "Weekly actives" }));
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_bookmark
   */
  async updateBookmark(
    bookmarkId: number,
    params: UpdateBookmarkParams,
  ): Promise<Bookmark> {
    requireEntityId("bookmark_id", bookmarkId);
    return bookmarksCohorts.updateBookmark(
      this.client,
      bookmarkId,
      params,
      this.#logger,
    );
  }

  /**
   * Delete a bookmark.
   *
   * @param bookmarkId - Bookmark identifier.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.delete_bookmark
   */
  async deleteBookmark(bookmarkId: number): Promise<void> {
    requireEntityId("bookmark_id", bookmarkId);
    return bookmarksCohorts.deleteBookmark(this.client, bookmarkId);
  }

  /**
   * Delete multiple bookmarks.
   *
   * @param ids - Bookmark IDs to delete.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.bulk_delete_bookmarks
   */
  async bulkDeleteBookmarks(ids: readonly number[]): Promise<void> {
    return bookmarksCohorts.bulkDeleteBookmarks(this.client, ids);
  }

  /**
   * Update multiple bookmarks.
   *
   * @param entries - Bookmark update entries.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.bulk_update_bookmarks
   */
  async bulkUpdateBookmarks(
    entries: readonly BulkUpdateBookmarkEntry[],
  ): Promise<void> {
    return bookmarksCohorts.bulkUpdateBookmarks(this.client, entries);
  }

  /**
   * List the ids of the dashboards a bookmark is linked to.
   *
   * @param bookmarkId - Bookmark identifier.
   * @returns The dashboard IDs.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.bookmark_linked_dashboard_ids
   */
  async bookmarkLinkedDashboardIds(bookmarkId: number): Promise<number[]> {
    requireEntityId("bookmark_id", bookmarkId);
    return bookmarksCohorts.bookmarkLinkedDashboardIds(this.client, bookmarkId);
  }

  /**
   * Fetch the change history of a bookmark.
   *
   * @param bookmarkId - Bookmark identifier.
   * @param options - `cursor` / `page_size` (keyword-only in Python).
   * @returns The `BookmarkHistoryResponse`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   * @example
   * ```typescript
   * const history = await ws.getBookmarkHistory(987, { page_size: 20 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.get_bookmark_history
   */
  async getBookmarkHistory(
    bookmarkId: number,
    options: WorkspaceGetBookmarkHistoryOptions = {},
  ): Promise<BookmarkHistoryResponse> {
    requireEntityId("bookmark_id", bookmarkId);
    return bookmarksCohorts.getBookmarkHistory(
      this.client,
      bookmarkId,
      options,
    );
  }

  /**
   * List cohorts via the App API, full detail.
   *
   * @param options - Optional `data_group_id` / `ids` filters.
   * @returns The `Cohort` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.list_cohorts_full
   */
  async listCohortsFull(
    options: WorkspaceListCohortsFullOptions = {},
  ): Promise<Cohort[]> {
    return bookmarksCohorts.listCohortsFull(this.client, options);
  }

  /**
   * Fetch a single cohort by id.
   *
   * @param cohortId - Cohort identifier.
   * @returns The `Cohort`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `cohortId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.get_cohort
   */
  async getCohort(cohortId: number): Promise<Cohort> {
    requireEntityId("cohort_id", cohortId);
    return bookmarksCohorts.getCohort(this.client, cohortId);
  }

  /**
   * Create a new cohort.
   *
   * @param params - Cohort creation parameters.
   * @returns The newly created `Cohort`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.create_cohort
   */
  async createCohort(params: CreateCohortParams): Promise<Cohort> {
    return bookmarksCohorts.createCohort(this.client, params);
  }

  /**
   * Update an existing cohort.
   *
   * @param cohortId - Cohort identifier.
   * @param params - Fields to update.
   * @returns The updated `Cohort`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `cohortId`
   *   is not a positive integer (network-free guard, before any request).
   * @example
   * ```typescript
   * await ws.updateCohort(55, new UpdateCohortParams({ name: "Power users" }));
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_cohort
   */
  async updateCohort(
    cohortId: number,
    params: UpdateCohortParams,
  ): Promise<Cohort> {
    requireEntityId("cohort_id", cohortId);
    return bookmarksCohorts.updateCohort(this.client, cohortId, params);
  }

  /**
   * Delete a cohort.
   *
   * @param cohortId - Cohort identifier.
   * @returns Nothing.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `cohortId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.delete_cohort
   */
  async deleteCohort(cohortId: number): Promise<void> {
    requireEntityId("cohort_id", cohortId);
    return bookmarksCohorts.deleteCohort(this.client, cohortId);
  }

  /**
   * Delete multiple cohorts.
   *
   * @param ids - Cohort IDs to delete.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.bulk_delete_cohorts
   */
  async bulkDeleteCohorts(ids: readonly number[]): Promise<void> {
    return bookmarksCohorts.bulkDeleteCohorts(this.client, ids);
  }

  /**
   * Update multiple cohorts.
   *
   * @param entries - Cohort update entries.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.bulk_update_cohorts
   */
  async bulkUpdateCohorts(
    entries: readonly BulkUpdateCohortEntry[],
  ): Promise<void> {
    return bookmarksCohorts.bulkUpdateCohorts(this.client, entries);
  }

  // --- Feature-flag + experiment members ---

  /**
   * List feature flags for the current project/workspace.
   *
   * @param options - `include_archived` (keyword-only in Python).
   * @returns The `FeatureFlag` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed API response payload
   *   (`RESPONSE_VALIDATION_ERROR`).
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @example
   * ```typescript
   * for (const f of await ws.listFeatureFlags()) {
   *   console.log(`${f.name} (${f.key})`);
   * }
   * ```
   * @see mixpanel_headless.workspace.Workspace.list_feature_flags
   */
  async listFeatureFlags(
    options: WorkspaceListFeatureFlagsOptions = {},
  ): Promise<FeatureFlag[]> {
    return flagsExperiments.listFeatureFlags(this.client, options);
  }

  /**
   * Create a new feature flag.
   *
   * @param params - Flag creation parameters.
   * @returns The newly created `FeatureFlag`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * const flag = await ws.createFeatureFlag(
   *   new CreateFeatureFlagParams({ name: "Dark Mode", key: "dark_mode" }),
   * );
   * ```
   * @see mixpanel_headless.workspace.Workspace.create_feature_flag
   */
  async createFeatureFlag(
    params: CreateFeatureFlagParams,
  ): Promise<FeatureFlag> {
    return flagsExperiments.createFeatureFlag(this.client, params);
  }

  /**
   * Fetch a single feature flag by id.
   *
   * @param flagId - Feature flag UUID.
   * @returns The `FeatureFlag`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.get_feature_flag
   */
  async getFeatureFlag(flagId: string): Promise<FeatureFlag> {
    return flagsExperiments.getFeatureFlag(this.client, flagId);
  }

  /**
   * Update a feature flag, full replacement / PUT semantics.
   *
   * @param flagId - Feature flag UUID.
   * @param params - Complete flag configuration.
   * @returns The updated `FeatureFlag`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * await ws.updateFeatureFlag(
   *   "flag-uuid",
   *   new UpdateFeatureFlagParams({ name: "Dark Mode", key: "dark_mode", ruleset }),
   * );
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_feature_flag
   */
  async updateFeatureFlag(
    flagId: string,
    params: UpdateFeatureFlagParams,
  ): Promise<FeatureFlag> {
    return flagsExperiments.updateFeatureFlag(this.client, flagId, params);
  }

  /**
   * Delete a feature flag.
   *
   * @param flagId - Feature flag UUID.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.delete_feature_flag
   */
  async deleteFeatureFlag(flagId: string): Promise<void> {
    return flagsExperiments.deleteFeatureFlag(this.client, flagId);
  }

  /**
   * Archive a feature flag, a soft delete.
   *
   * @param flagId - Feature flag UUID.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.archive_feature_flag
   */
  async archiveFeatureFlag(flagId: string): Promise<void> {
    return flagsExperiments.archiveFeatureFlag(this.client, flagId);
  }

  /**
   * Restore an archived feature flag.
   *
   * @param flagId - Feature flag UUID.
   * @returns The restored `FeatureFlag`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.restore_feature_flag
   */
  async restoreFeatureFlag(flagId: string): Promise<FeatureFlag> {
    return flagsExperiments.restoreFeatureFlag(this.client, flagId);
  }

  /**
   * Duplicate a feature flag.
   *
   * @param flagId - Feature flag UUID.
   * @returns The newly created duplicate `FeatureFlag`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.duplicate_feature_flag
   */
  async duplicateFeatureFlag(flagId: string): Promise<FeatureFlag> {
    return flagsExperiments.duplicateFeatureFlag(this.client, flagId);
  }

  /**
   * Set test-user variant overrides for a feature flag.
   *
   * @param flagId - Feature flag UUID.
   * @param params - Test user mapping.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @example
   * ```typescript
   * await ws.setFlagTestUsers("flag-uuid", new SetTestUsersParams({ users: testUsers }));
   * ```
   * @see mixpanel_headless.workspace.Workspace.set_flag_test_users
   */
  async setFlagTestUsers(
    flagId: string,
    params: SetTestUsersParams,
  ): Promise<void> {
    return flagsExperiments.setFlagTestUsers(this.client, flagId, params);
  }

  /**
   * Get paginated change history for a feature flag.
   *
   * @param flagId - Feature flag UUID.
   * @param options - `page` / `page_size` (keyword-only in Python).
   * @returns The `FlagHistoryResponse` (events + count).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * const history = await ws.getFlagHistory("flag-uuid", { page_size: 50 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.get_flag_history
   */
  async getFlagHistory(
    flagId: string,
    options: WorkspaceGetFlagHistoryOptions = {},
  ): Promise<FlagHistoryResponse> {
    return flagsExperiments.getFlagHistory(this.client, flagId, options);
  }

  /**
   * Get account-level feature flag limits and usage.
   *
   * @returns The `FlagLimitsResponse`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.get_flag_limits
   */
  async getFlagLimits(): Promise<FlagLimitsResponse> {
    return flagsExperiments.getFlagLimits(this.client);
  }

  /**
   * List experiments for the current project.
   *
   * @param options - `include_archived` (keyword-only in Python).
   * @returns The `Experiment` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.list_experiments
   */
  async listExperiments(
    options: WorkspaceListExperimentsOptions = {},
  ): Promise<Experiment[]> {
    return flagsExperiments.listExperiments(this.client, options);
  }

  /**
   * Create a new experiment in Draft status.
   *
   * @param params - Experiment creation parameters.
   * @returns The newly created `Experiment`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.create_experiment
   */
  async createExperiment(params: CreateExperimentParams): Promise<Experiment> {
    return flagsExperiments.createExperiment(this.client, params);
  }

  /**
   * Fetch a single experiment by id.
   *
   * @param experimentId - Experiment UUID.
   * @returns The `Experiment`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.get_experiment
   */
  async getExperiment(experimentId: string): Promise<Experiment> {
    return flagsExperiments.getExperiment(this.client, experimentId);
  }

  /**
   * Update an experiment, PATCH semantics.
   *
   * @param experimentId - Experiment UUID.
   * @param params - Fields to update.
   * @returns The updated `Experiment`.
   * @throws {@link MixpanelHeadlessError} - Empty response (`UNKNOWN_ERROR`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * await ws.updateExperiment(
   *   "exp-uuid",
   *   new UpdateExperimentParams({ description: "Checkout redesign, EU only" }),
   * );
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_experiment
   */
  async updateExperiment(
    experimentId: string,
    params: UpdateExperimentParams,
  ): Promise<Experiment> {
    return flagsExperiments.updateExperiment(this.client, experimentId, params);
  }

  /**
   * Delete an experiment.
   *
   * @param experimentId - Experiment UUID.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.delete_experiment
   */
  async deleteExperiment(experimentId: string): Promise<void> {
    return flagsExperiments.deleteExperiment(this.client, experimentId);
  }

  /**
   * Launch an experiment, Draft → Active.
   *
   * @param experimentId - Experiment UUID.
   * @returns The launched `Experiment` with updated status.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.launch_experiment
   */
  async launchExperiment(experimentId: string): Promise<Experiment> {
    return flagsExperiments.launchExperiment(this.client, experimentId);
  }

  /**
   * Conclude an experiment, Active → Concluded — always sends a
   * JSON body, `{}` when no params are supplied.
   *
   * @param experimentId - Experiment UUID.
   * @param options - `params` (keyword-only in Python).
   * @returns The concluded `Experiment`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * await ws.concludeExperiment("exp-uuid", {
   *   params: new ExperimentConcludeParams({ end_date: "2026-03-31" }),
   * });
   * ```
   * @see mixpanel_headless.workspace.Workspace.conclude_experiment
   */
  async concludeExperiment(
    experimentId: string,
    options: WorkspaceConcludeExperimentOptions = {},
  ): Promise<Experiment> {
    return flagsExperiments.concludeExperiment(
      this.client,
      experimentId,
      options,
    );
  }

  /**
   * Record the experiment decision, Concluded → Success/Fail.
   *
   * @param experimentId - Experiment UUID.
   * @param params - Decision parameters (success, variant, message).
   * @returns The decided `Experiment` with terminal status.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * await ws.decideExperiment(
   *   "exp-uuid",
   *   new ExperimentDecideParams({ success: true, variant: "treatment" }),
   * );
   * ```
   * @see mixpanel_headless.workspace.Workspace.decide_experiment
   */
  async decideExperiment(
    experimentId: string,
    params: ExperimentDecideParams,
  ): Promise<Experiment> {
    return flagsExperiments.decideExperiment(this.client, experimentId, params);
  }

  /**
   * Archive an experiment.
   *
   * @param experimentId - Experiment UUID.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.archive_experiment
   */
  async archiveExperiment(experimentId: string): Promise<void> {
    return flagsExperiments.archiveExperiment(this.client, experimentId);
  }

  /**
   * Restore an archived experiment.
   *
   * @param experimentId - Experiment UUID.
   * @returns The restored `Experiment`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.restore_experiment
   */
  async restoreExperiment(experimentId: string): Promise<Experiment> {
    return flagsExperiments.restoreExperiment(this.client, experimentId);
  }

  /**
   * Duplicate an experiment under a new name. `params` is required
   * because the Mixpanel API returns an empty body when duplicating
   * without a name.
   *
   * @param experimentId - Experiment UUID.
   * @param params - Duplication parameters (`name` is required).
   * @returns The newly created duplicate `Experiment`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * await ws.duplicateExperiment("exp-uuid", new DuplicateExperimentParams({ name: "Checkout v2 (copy)" }));
   * ```
   * @see mixpanel_headless.workspace.Workspace.duplicate_experiment
   */
  async duplicateExperiment(
    experimentId: string,
    params: DuplicateExperimentParams,
  ): Promise<Experiment> {
    return flagsExperiments.duplicateExperiment(
      this.client,
      experimentId,
      params,
    );
  }

  /**
   * List experiments in ERF (Experiment Results Framework) format.
   *
   * @returns The ERF experiment dicts, verbatim.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.list_erf_experiments
   */
  async listErfExperiments(): Promise<Array<Record<string, unknown>>> {
    return flagsExperiments.listErfExperiments(this.client);
  }

  // --- Annotation + webhook + alert members ---

  /**
   * List timeline annotations for the project.
   *
   * @param options - `from_date` / `to_date` / `tags` (keyword-only in
   *   Python). Dates are ISO `YYYY-MM-DD` strings end-to-end.
   * @returns The `Annotation` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed API response payload
   *   (`RESPONSE_VALIDATION_ERROR`).
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @example
   * ```typescript
   * for (const ann of await ws.listAnnotations({ from_date: "2026-01-01" })) {
   *   console.log(`${ann.date}: ${ann.description}`);
   * }
   * ```
   * @see mixpanel_headless.workspace.Workspace.list_annotations
   */
  async listAnnotations(
    options: WorkspaceListAnnotationsOptions = {},
  ): Promise<Annotation[]> {
    return annotationsWebhooksAlerts.listAnnotations(this.client, options);
  }

  /**
   * Create a new timeline annotation.
   *
   * @param params - Annotation creation parameters (date, description
   *   required).
   * @returns The created `Annotation`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * const ann = await ws.createAnnotation(
   *   new CreateAnnotationParams({
   *     date: "2026-03-31",
   *     description: "v2.5 release",
   *   }),
   * );
   * ```
   * @see mixpanel_headless.workspace.Workspace.create_annotation
   */
  async createAnnotation(params: CreateAnnotationParams): Promise<Annotation> {
    return annotationsWebhooksAlerts.createAnnotation(this.client, params);
  }

  /**
   * Fetch a single annotation by id.
   *
   * @param annotationId - Annotation ID.
   * @returns The `Annotation`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `annotationId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.get_annotation
   */
  async getAnnotation(annotationId: number): Promise<Annotation> {
    requireEntityId("annotation_id", annotationId);
    return annotationsWebhooksAlerts.getAnnotation(this.client, annotationId);
  }

  /**
   * Update an annotation, PATCH semantics.
   *
   * @param annotationId - Annotation ID.
   * @param params - Fields to update (description, tags).
   * @returns The updated `Annotation`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `annotationId`
   *   is not a positive integer (network-free guard, before any request).
   * @example
   * ```typescript
   * await ws.updateAnnotation(2078447, new UpdateAnnotationParams({ description: "v2.5.1 hotfix" }));
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_annotation
   */
  async updateAnnotation(
    annotationId: number,
    params: UpdateAnnotationParams,
  ): Promise<Annotation> {
    requireEntityId("annotation_id", annotationId);
    return annotationsWebhooksAlerts.updateAnnotation(
      this.client,
      annotationId,
      params,
    );
  }

  /**
   * Delete an annotation.
   *
   * @param annotationId - Annotation ID.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `annotationId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.delete_annotation
   */
  async deleteAnnotation(annotationId: number): Promise<void> {
    requireEntityId("annotation_id", annotationId);
    return annotationsWebhooksAlerts.deleteAnnotation(
      this.client,
      annotationId,
    );
  }

  /**
   * List annotation tags for the project.
   *
   * @returns The `AnnotationTag` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.list_annotation_tags
   */
  async listAnnotationTags(): Promise<AnnotationTag[]> {
    return annotationsWebhooksAlerts.listAnnotationTags(this.client);
  }

  /**
   * Create a new annotation tag.
   *
   * @param params - Tag creation parameters (name required).
   * @returns The created `AnnotationTag`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.create_annotation_tag
   */
  async createAnnotationTag(
    params: CreateAnnotationTagParams,
  ): Promise<AnnotationTag> {
    return annotationsWebhooksAlerts.createAnnotationTag(this.client, params);
  }

  /**
   * List all webhooks for the current project.
   *
   * @returns The `ProjectWebhook` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * for (const wh of await ws.listWebhooks()) {
   *   console.log(`${wh.name} -> ${wh.url}`);
   * }
   * ```
   * @see mixpanel_headless.workspace.Workspace.list_webhooks
   */
  async listWebhooks(): Promise<ProjectWebhook[]> {
    return annotationsWebhooksAlerts.listWebhooks(this.client);
  }

  /**
   * Create a new webhook.
   *
   * @param params - Webhook creation parameters.
   * @returns The `WebhookMutationResult` (new webhook id + name).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.create_webhook
   */
  async createWebhook(
    params: CreateWebhookParams,
  ): Promise<WebhookMutationResult> {
    return annotationsWebhooksAlerts.createWebhook(this.client, params);
  }

  /**
   * Update an existing webhook, PATCH semantics.
   *
   * @param webhookId - Webhook UUID string.
   * @param params - Fields to update.
   * @returns The `WebhookMutationResult` (updated id + name).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * await ws.updateWebhook("webhook-uuid", new UpdateWebhookParams({ is_enabled: false }));
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_webhook
   */
  async updateWebhook(
    webhookId: string,
    params: UpdateWebhookParams,
  ): Promise<WebhookMutationResult> {
    return annotationsWebhooksAlerts.updateWebhook(
      this.client,
      webhookId,
      params,
    );
  }

  /**
   * Delete a webhook.
   *
   * @param webhookId - Webhook UUID string.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.delete_webhook
   */
  async deleteWebhook(webhookId: string): Promise<void> {
    return annotationsWebhooksAlerts.deleteWebhook(this.client, webhookId);
  }

  /**
   * Test webhook connectivity.
   *
   * @param params - Webhook test parameters (`url` required).
   * @returns The `WebhookTestResult` (success, status_code, message).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.test_webhook
   */
  async testWebhook(params: WebhookTestParams): Promise<WebhookTestResult> {
    return annotationsWebhooksAlerts.testWebhook(this.client, params);
  }

  /**
   * List custom alerts for the current project.
   *
   * @param options - `bookmark_id` / `skip_user_filter` (keyword-only
   *   in Python).
   * @returns The `CustomAlert` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * for (const alert of await ws.listAlerts()) {
   *   console.log(`${alert.name} (paused=${alert.paused})`);
   * }
   * ```
   * @see mixpanel_headless.workspace.Workspace.list_alerts
   */
  async listAlerts(
    options: WorkspaceListAlertsOptions = {},
  ): Promise<CustomAlert[]> {
    return annotationsWebhooksAlerts.listAlerts(this.client, options);
  }

  /**
   * Create a new custom alert.
   *
   * @param params - Alert creation parameters.
   * @returns The created `CustomAlert`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.create_alert
   */
  async createAlert(params: CreateAlertParams): Promise<CustomAlert> {
    return annotationsWebhooksAlerts.createAlert(this.client, params);
  }

  /**
   * Fetch a single custom alert by id.
   *
   * @param alertId - Alert ID (integer).
   * @returns The `CustomAlert`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `alertId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.get_alert
   */
  async getAlert(alertId: number): Promise<CustomAlert> {
    requireEntityId("alert_id", alertId);
    return annotationsWebhooksAlerts.getAlert(this.client, alertId);
  }

  /**
   * Update a custom alert, PATCH semantics.
   *
   * @param alertId - Alert ID (integer).
   * @param params - Fields to update.
   * @returns The updated `CustomAlert`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `alertId`
   *   is not a positive integer (network-free guard, before any request).
   * @example
   * ```typescript
   * await ws.updateAlert(31, new UpdateAlertParams({ paused: true }));
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_alert
   */
  async updateAlert(
    alertId: number,
    params: UpdateAlertParams,
  ): Promise<CustomAlert> {
    requireEntityId("alert_id", alertId);
    return annotationsWebhooksAlerts.updateAlert(this.client, alertId, params);
  }

  /**
   * Delete a custom alert.
   *
   * @param alertId - Alert ID (integer).
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `alertId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.delete_alert
   */
  async deleteAlert(alertId: number): Promise<void> {
    requireEntityId("alert_id", alertId);
    return annotationsWebhooksAlerts.deleteAlert(this.client, alertId);
  }

  /**
   * Bulk-delete custom alerts.
   *
   * @param ids - Alert IDs to delete.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.bulk_delete_alerts
   */
  async bulkDeleteAlerts(ids: readonly number[]): Promise<void> {
    return annotationsWebhooksAlerts.bulkDeleteAlerts(this.client, ids);
  }

  /**
   * Get the project's alert count against its limit.
   *
   * @param options - `alert_type` (keyword-only in Python).
   * @returns The `AlertCount`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.get_alert_count
   */
  async getAlertCount(
    options: WorkspaceGetAlertCountOptions = {},
  ): Promise<AlertCount> {
    return annotationsWebhooksAlerts.getAlertCount(this.client, options);
  }

  /**
   * Get paginated alert trigger history.
   *
   * @param alertId - Alert ID (integer).
   * @param options - `page_size` / `next_cursor` / `previous_cursor`
   *   (keyword-only in Python).
   * @returns The `AlertHistoryResponse`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `alertId`
   *   is not a positive integer (network-free guard, before any request).
   * @example
   * ```typescript
   * const history = await ws.getAlertHistory(31, { page_size: 25 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.get_alert_history
   */
  async getAlertHistory(
    alertId: number,
    options: WorkspaceGetAlertHistoryOptions = {},
  ): Promise<AlertHistoryResponse> {
    requireEntityId("alert_id", alertId);
    return annotationsWebhooksAlerts.getAlertHistory(
      this.client,
      alertId,
      options,
    );
  }

  /**
   * Send a test alert notification — the payload is returned verbatim;
   * Python performs no model validation.
   *
   * @param params - Alert parameters for the test (same shape as
   *   create).
   * @returns The opaque result record.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.test_alert
   */
  async testAlert(params: CreateAlertParams): Promise<Record<string, unknown>> {
    return annotationsWebhooksAlerts.testAlert(this.client, params);
  }

  /**
   * Get a signed URL for an alert screenshot.
   *
   * @param gcsKey - GCS object key from the alert payload.
   * @returns The `AlertScreenshotResponse`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.get_alert_screenshot_url
   */
  async getAlertScreenshotUrl(
    gcsKey: string,
  ): Promise<AlertScreenshotResponse> {
    return annotationsWebhooksAlerts.getAlertScreenshotUrl(this.client, gcsKey);
  }

  /**
   * Validate alerts against a bookmark definition.
   *
   * @param params - Alert IDs plus the bookmark type and params.
   * @returns The `ValidateAlertsForBookmarkResponse`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.validate_alerts_for_bookmark
   */
  async validateAlertsForBookmark(
    params: ValidateAlertsForBookmarkParams,
  ): Promise<ValidateAlertsForBookmarkResponse> {
    return annotationsWebhooksAlerts.validateAlertsForBookmark(
      this.client,
      params,
    );
  }

  // --- Lexicon + tracking/history members ---

  /**
   * Get event definitions from Lexicon by name.
   *
   * @param options - `names` (keyword-only and required in Python).
   * @returns The `EventDefinition` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed API response payload
   *   (`RESPONSE_VALIDATION_ERROR`).
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @example
   * ```typescript
   * const defs = await ws.getEventDefinitions({
   *   names: ["Signup", "Login"],
   * });
   * for (const d of defs) {
   *   console.log(`${d.name}: ${d.description ?? ""}`);
   * }
   * ```
   * @see mixpanel_headless.workspace.Workspace.get_event_definitions
   */
  async getEventDefinitions(
    options: WorkspaceGetEventDefinitionsOptions,
  ): Promise<EventDefinition[]> {
    return lexiconTracking.getEventDefinitions(this.client, options);
  }

  /**
   * Update an event definition in Lexicon.
   *
   * @param eventName - Name of the event to update.
   * @param params - Fields to update (hidden, dropped, merged,
   *   verified, tags, display_name, description).
   * @returns The updated `EventDefinition`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * const definition = await ws.updateEventDefinition(
   *   "Signup",
   *   new UpdateEventDefinitionParams({ description: "User signed up" }),
   * );
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_event_definition
   */
  async updateEventDefinition(
    eventName: string,
    params: UpdateEventDefinitionParams,
  ): Promise<EventDefinition> {
    return lexiconTracking.updateEventDefinition(
      this.client,
      eventName,
      params,
    );
  }

  /**
   * Delete an event definition from Lexicon.
   *
   * @param eventName - Name of the event to delete.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.delete_event_definition
   */
  async deleteEventDefinition(eventName: string): Promise<void> {
    return lexiconTracking.deleteEventDefinition(this.client, eventName);
  }

  /**
   * Bulk-update event definitions in Lexicon.
   *
   * @param params - Bulk update parameters (a list of event updates:
   *   name + fields to change).
   * @returns The updated `EventDefinition` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.bulk_update_event_definitions
   */
  async bulkUpdateEventDefinitions(
    params: BulkUpdateEventsParams,
  ): Promise<EventDefinition[]> {
    return lexiconTracking.bulkUpdateEventDefinitions(this.client, params);
  }

  /**
   * Get property definitions from Lexicon by name.
   *
   * @param options - `names` (required) plus the optional
   *   `resource_type` filter, both keyword-only in Python.
   * @returns The `PropertyDefinition` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * const defs = await ws.getPropertyDefinitions({
   *   names: ["plan_type", "country"],
   *   resource_type: "event",
   * });
   * ```
   * @see mixpanel_headless.workspace.Workspace.get_property_definitions
   */
  async getPropertyDefinitions(
    options: WorkspaceGetPropertyDefinitionsOptions,
  ): Promise<PropertyDefinition[]> {
    return lexiconTracking.getPropertyDefinitions(this.client, options);
  }

  /**
   * Update a property definition in Lexicon.
   *
   * @param propertyName - Name of the property to update.
   * @param params - Fields to update (hidden, dropped, merged,
   *   sensitive, display_name, description, example_value,
   *   resource_type).
   * @returns The updated `PropertyDefinition`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * await ws.updatePropertyDefinition(
   *   "plan",
   *   new UpdatePropertyDefinitionParams({ description: "Billing plan" }),
   * );
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_property_definition
   */
  async updatePropertyDefinition(
    propertyName: string,
    params: UpdatePropertyDefinitionParams,
  ): Promise<PropertyDefinition> {
    return lexiconTracking.updatePropertyDefinition(
      this.client,
      propertyName,
      params,
    );
  }

  /**
   * Bulk-update property definitions in Lexicon.
   *
   * @param params - Bulk update parameters (a list of property
   *   updates: name + fields to change).
   * @returns The updated `PropertyDefinition` models, in response
   *   order.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.bulk_update_property_definitions
   */
  async bulkUpdatePropertyDefinitions(
    params: BulkUpdatePropertiesParams,
  ): Promise<PropertyDefinition[]> {
    return lexiconTracking.bulkUpdatePropertyDefinitions(this.client, params);
  }

  /**
   * List all Lexicon tags.
   *
   * The list endpoint may return plain tag-name strings without IDs;
   * those entries come back with `id` set to the `0` sentinel. Do not
   * pass that sentinel to {@link updateLexiconTag} — use name-based
   * operations (e.g. {@link deleteLexiconTag}) for such tags.
   *
   * @returns The `LexiconTag` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.list_lexicon_tags
   */
  async listLexiconTags(): Promise<LexiconTag[]> {
    return lexiconTracking.listLexiconTags(this.client);
  }

  /**
   * Create a new Lexicon tag.
   *
   * @param params - Tag creation parameters (name required).
   * @returns The created `LexiconTag`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.create_lexicon_tag
   */
  async createLexiconTag(params: CreateTagParams): Promise<LexiconTag> {
    return lexiconTracking.createLexiconTag(this.client, params);
  }

  /**
   * Update a Lexicon tag.
   *
   * @param tagId - Tag ID (integer).
   * @param params - Fields to update (e.g. name).
   * @returns The updated `LexiconTag`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `tagId`
   *   is not a positive integer (network-free guard, before any request).
   * @example
   * ```typescript
   * await ws.updateLexiconTag(7, new UpdateTagParams({ name: "growth" }));
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_lexicon_tag
   */
  async updateLexiconTag(
    tagId: number,
    params: UpdateTagParams,
  ): Promise<LexiconTag> {
    requireEntityId("tag_id", tagId);
    return lexiconTracking.updateLexiconTag(this.client, tagId, params);
  }

  /**
   * Delete a Lexicon tag by name.
   *
   * @param tagName - Name of the tag to delete.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.delete_lexicon_tag
   */
  async deleteLexiconTag(tagName: string): Promise<void> {
    return lexiconTracking.deleteLexiconTag(this.client, tagName);
  }

  /**
   * Get tracking metadata for an event — the raw record, unvalidated.
   *
   * @param eventName - Name of the event.
   * @returns The opaque tracking-metadata record.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.get_tracking_metadata
   */
  async getTrackingMetadata(
    eventName: string,
  ): Promise<Record<string, unknown>> {
    return lexiconTracking.getTrackingMetadata(this.client, eventName);
  }

  /**
   * Get change history for an event definition — raw records,
   * unvalidated.
   *
   * @param eventName - Name of the event.
   * @returns The history entries, in response order.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.get_event_history
   */
  async getEventHistory(
    eventName: string,
  ): Promise<Array<Record<string, unknown>>> {
    return lexiconTracking.getEventHistory(this.client, eventName);
  }

  /**
   * Get change history for a property definition — raw records,
   * unvalidated.
   *
   * @param propertyName - Name of the property.
   * @param entityType - Entity type ("event", "user", "group", ...).
   * @returns The history entries, in response order.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @example
   * ```typescript
   * const history = await ws.getPropertyHistory("plan", "event");
   * ```
   * @see mixpanel_headless.workspace.Workspace.get_property_history
   */
  async getPropertyHistory(
    propertyName: string,
    entityType: string,
  ): Promise<Array<Record<string, unknown>>> {
    return lexiconTracking.getPropertyHistory(
      this.client,
      propertyName,
      entityType,
    );
  }

  /**
   * Export Lexicon data definitions — the raw record, unvalidated.
   *
   * @param options - `export_types` (keyword-only in Python; omit to
   *   let the client apply its default two-entry list).
   * @returns The opaque export record.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @example
   * ```typescript
   * const exported = await ws.exportLexicon({
   *   export_types: ["All Events and Properties"],
   * });
   * ```
   * @see mixpanel_headless.workspace.Workspace.export_lexicon
   */
  async exportLexicon(
    options: WorkspaceExportLexiconOptions = {},
  ): Promise<Record<string, unknown>> {
    return lexiconTracking.exportLexicon(this.client, options);
  }

  // --- Drop filters, custom properties, lookup tables, custom events ---

  /**
   * The seam bag handed to {@link Workspace.uploadLookupTable}: the
   * injected `readFile` and `monotonic` plus the client's own sleep seam,
   * so the facade never builds a second timer and tests drive one clock.
   *
   * @returns The seams.
   */
  get #lookupUploadSeams(): LookupUploadSeams {
    return {
      readFile: this.#readFile,
      monotonic: this.#monotonic,
      sleep: this.client.core.sleep,
    };
  }

  /**
   * List all drop filters.
   *
   * @returns The `DropFilter` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed API response payload
   *   (`RESPONSE_VALIDATION_ERROR`).
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @example
   * ```typescript
   * for (const filter of await ws.listDropFilters()) {
   *   console.log(`${filter.event_name}: active=${String(filter.active)}`);
   * }
   * ```
   * @see mixpanel_headless.workspace.Workspace.list_drop_filters
   */
  async listDropFilters(): Promise<DropFilter[]> {
    return governanceData.listDropFilters(this.client);
  }

  /**
   * Create a new drop filter.
   *
   * @param params - Drop filter creation parameters.
   * @returns The full list of `DropFilter` models after creation.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * const filters = await ws.createDropFilter(
   *   new CreateDropFilterParams({
   *     event_name: "Debug Event",
   *     filters: { property: "env", value: "test" },
   *   }),
   * );
   * ```
   * @see mixpanel_headless.workspace.Workspace.create_drop_filter
   */
  async createDropFilter(
    params: CreateDropFilterParams,
  ): Promise<DropFilter[]> {
    return governanceData.createDropFilter(this.client, params);
  }

  /**
   * Update a drop filter.
   *
   * @param params - Update parameters (must include the filter ID).
   * @returns The full list of `DropFilter` models after the update.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.update_drop_filter
   */
  async updateDropFilter(
    params: UpdateDropFilterParams,
  ): Promise<DropFilter[]> {
    return governanceData.updateDropFilter(this.client, params);
  }

  /**
   * Delete a drop filter.
   *
   * @param dropFilterId - Drop filter ID (integer).
   * @returns The full list of remaining `DropFilter` models.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dropFilterId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.delete_drop_filter
   */
  async deleteDropFilter(dropFilterId: number): Promise<DropFilter[]> {
    requireEntityId("drop_filter_id", dropFilterId);
    return governanceData.deleteDropFilter(this.client, dropFilterId);
  }

  /**
   * Get drop filter usage limits.
   *
   * @returns The `DropFilterLimitsResponse`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.get_drop_filter_limits
   */
  async getDropFilterLimits(): Promise<DropFilterLimitsResponse> {
    return governanceData.getDropFilterLimits(this.client);
  }

  /**
   * List all custom properties.
   *
   * A 400 whose body names `displayFormula` means the project holds a
   * corrupt custom property; that case is re-raised as a `QueryError`
   * with an actionable message pointing at
   * {@link Workspace.getCustomProperty}.
   *
   * @returns The `CustomProperty` models, in response order.
   * @throws {@link QueryError} - Server-side data corruption, or any other
   *   query failure, propagated verbatim.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.list_custom_properties
   */
  async listCustomProperties(): Promise<CustomProperty[]> {
    return governanceData.listCustomProperties(this.client);
  }

  /**
   * Create a new custom property.
   *
   * @param params - Creation parameters (`name`, `resource_type` and
   *   one of `display_formula` / `behavior` are required).
   * @returns The created `CustomProperty`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.create_custom_property
   */
  async createCustomProperty(
    params: CreateCustomPropertyParams,
  ): Promise<CustomProperty> {
    return governanceData.createCustomProperty(this.client, params);
  }

  /**
   * Fetch a custom property by id.
   *
   * @param propertyId - Custom property ID (string).
   * @returns The `CustomProperty`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.get_custom_property
   */
  async getCustomProperty(propertyId: string): Promise<CustomProperty> {
    return governanceData.getCustomProperty(this.client, propertyId);
  }

  /**
   * Update a custom property.
   *
   * @param propertyId - Custom property ID (string).
   * @param params - Fields to update.
   * @returns The updated `CustomProperty`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * await ws.updateCustomProperty(
   *   "property-id",
   *   new UpdateCustomPropertyParams({ description: "Net revenue" }),
   * );
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_custom_property
   */
  async updateCustomProperty(
    propertyId: string,
    params: UpdateCustomPropertyParams,
  ): Promise<CustomProperty> {
    return governanceData.updateCustomProperty(this.client, propertyId, params);
  }

  /**
   * Delete a custom property.
   *
   * @param propertyId - Custom property ID (string).
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.delete_custom_property
   */
  async deleteCustomProperty(propertyId: string): Promise<void> {
    return governanceData.deleteCustomProperty(this.client, propertyId);
  }

  /**
   * Validate a custom property definition without creating it.
   *
   * @param params - Parameters to validate.
   * @returns The raw validation result.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.validate_custom_property
   */
  async validateCustomProperty(
    params: CreateCustomPropertyParams,
  ): Promise<Record<string, unknown>> {
    return governanceData.validateCustomProperty(this.client, params);
  }

  /**
   * List lookup tables.
   *
   * @param options - Optional `data_group_id` filter (keyword-only in
   *   Python).
   * @returns The `LookupTable` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * const tables = await ws.listLookupTables({ data_group_id: 5 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.list_lookup_tables
   */
  async listLookupTables(
    options: WorkspaceListLookupTablesOptions = {},
  ): Promise<LookupTable[]> {
    return governanceData.listLookupTables(this.client, options);
  }

  /**
   * Upload a CSV file as a new lookup table: signed URL, upload,
   * register, then — for payloads the API processes asynchronously —
   * poll until the task completes.
   *
   * @remarks
   * The byte source ({@link WorkspaceOptions.readFile}) and the poll
   * clock ({@link WorkspaceOptions.monotonic}, seconds, with the client's
   * sleep seam) are injected so core stays runtime-agnostic and tests can
   * drive time.
   * @param params - Upload parameters (`name`, `file_path`, optional
   *   `data_group_id`).
   * @param options - `poll_interval` / `max_poll_seconds`, both in
   *   seconds under their Python names (defaults `2.0` / `300.0`).
   * @returns The created `LookupTable`.
   * @throws {@link MixpanelHeadlessError} - `UNPORTED_FILE_READ_SEAM` when no
   *   `readFile` seam is injected; `UPLOAD_FAILED` /
   *   `UPLOAD_NOT_FOUND` / `UPLOAD_TIMEOUT` / `INVALID_RESPONSE` from
   *   the async poll.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * const table = await ws.uploadLookupTable(
   *   new UploadLookupTableParams({
   *     name: "Country Codes",
   *     file_path: "/path/to/countries.csv",
   *   }),
   * );
   * ```
   * @see mixpanel_headless.workspace.Workspace.upload_lookup_table
   */
  async uploadLookupTable(
    params: UploadLookupTableParams,
    options: WorkspaceUploadLookupTableOptions = {},
  ): Promise<LookupTable> {
    return governanceData.uploadLookupTable(
      this.client,
      params,
      options,
      this.#lookupUploadSeams,
      this.#logger,
    );
  }

  /**
   * Mark a lookup table as ready after upload.
   *
   * @param params - Parameters (`name`, `key`, optional
   *   `data_group_id`).
   * @returns The updated `LookupTable`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.mark_lookup_table_ready
   */
  async markLookupTableReady(
    params: MarkLookupTableReadyParams,
  ): Promise<LookupTable> {
    return governanceData.markLookupTableReady(this.client, params);
  }

  /**
   * Get a signed URL for uploading lookup table data.
   *
   * @param contentType - MIME type of the file to upload (positional
   *   in Python; default `"text/csv"`).
   * @returns The `LookupTableUploadUrl` (url / path / key).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.get_lookup_upload_url
   */
  async getLookupUploadUrl(
    contentType = "text/csv",
  ): Promise<LookupTableUploadUrl> {
    return governanceData.getLookupUploadUrl(this.client, contentType);
  }

  /**
   * Get the processing status of a lookup table upload — the raw
   * record, unvalidated.
   *
   * @param uploadId - Upload ID returned from the upload process.
   * @returns The opaque status record.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.get_lookup_upload_status
   */
  async getLookupUploadStatus(
    uploadId: string,
  ): Promise<Record<string, unknown>> {
    return governanceData.getLookupUploadStatus(this.client, uploadId);
  }

  /**
   * Update a lookup table.
   *
   * @param dataGroupId - Data group ID of the lookup table — a signed
   *   int64: a `number` when it is a safe integer, a `bigint` beyond
   *   2^53 (Mixpanel assigns ids such as `-8644926364725811123n`). The
   *   id is sent in the JSON body as an exact integer token.
   * @param params - Fields to update.
   * @returns The updated `LookupTable`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dataGroupId`
   *   is not a non-zero integer, or is a `number` beyond
   *   `Number.MAX_SAFE_INTEGER` (already rounded — pass a `bigint`);
   *   network-free guard, before any request.
   * @example
   * ```typescript
   * await ws.updateLookupTable(-8644926364725811123n, new UpdateLookupTableParams({ name: "Countries v2" }));
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_lookup_table
   */
  async updateLookupTable(
    dataGroupId: number | bigint,
    params: UpdateLookupTableParams,
  ): Promise<LookupTable> {
    requireInt64Id("data_group_id", dataGroupId);
    return governanceData.updateLookupTable(this.client, dataGroupId, params);
  }

  /**
   * Delete one or more lookup tables.
   *
   * @param dataGroupIds - Data group IDs to delete — signed int64s
   *   (`bigint` beyond 2^53), each sent as an exact integer token.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when any element is
   *   not a non-zero integer, or is a `number` beyond
   *   `Number.MAX_SAFE_INTEGER` (already rounded — pass a `bigint`);
   *   network-free guard, before any request.
   * @see mixpanel_headless.workspace.Workspace.delete_lookup_tables
   */
  async deleteLookupTables(
    dataGroupIds: ReadonlyArray<number | bigint>,
  ): Promise<void> {
    for (const dataGroupId of dataGroupIds) {
      requireInt64Id("data_group_ids", dataGroupId);
    }
    return governanceData.deleteLookupTables(this.client, dataGroupIds);
  }

  /**
   * Download lookup table data as raw CSV bytes.
   *
   * @param dataGroupId - Data group ID of the lookup table — a signed
   *   int64: a `number` when it is a safe integer, a `bigint` beyond
   *   2^53 (Mixpanel assigns ids such as `-8644926364725811123n`),
   *   spelled exactly into the `data-group-id` query param.
   * @param options - Optional `file_name` / `limit` (keyword-only in
   *   Python).
   * @returns The raw CSV bytes.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dataGroupId`
   *   is not a non-zero integer, or is a `number` beyond
   *   `Number.MAX_SAFE_INTEGER` (already rounded — pass a `bigint`);
   *   network-free guard, before any request.
   * @example
   * ```typescript
   * const csv = await ws.downloadLookupTable(-8644926364725811123n, { limit: 1000 });
   * ```
   * @see mixpanel_headless.workspace.Workspace.download_lookup_table
   */
  async downloadLookupTable(
    dataGroupId: number | bigint,
    options: WorkspaceDownloadLookupTableOptions = {},
  ): Promise<Uint8Array> {
    requireInt64Id("data_group_id", dataGroupId);
    return governanceData.downloadLookupTable(
      this.client,
      dataGroupId,
      options,
    );
  }

  /**
   * Get a signed download URL for a lookup table.
   *
   * @param dataGroupId - Data group ID of the lookup table — a signed
   *   int64: a `number` when it is a safe integer, a `bigint` beyond
   *   2^53, spelled exactly into the `data-group-id` query param.
   * @returns The signed URL string.
   * @throws {@link MixpanelHeadlessError} - `MISSING_URL` when the response
   *   carries no URL.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `dataGroupId`
   *   is not a non-zero integer, or is a `number` beyond
   *   `Number.MAX_SAFE_INTEGER` (already rounded — pass a `bigint`);
   *   network-free guard, before any request.
   * @see mixpanel_headless.workspace.Workspace.get_lookup_download_url
   */
  async getLookupDownloadUrl(dataGroupId: number | bigint): Promise<string> {
    requireInt64Id("data_group_id", dataGroupId);
    return governanceData.getLookupDownloadUrl(this.client, dataGroupId);
  }

  /**
   * Create a new custom event.
   *
   * A custom event is a composite alias grouping one or more
   * underlying events under a single name; it appears alongside
   * regular events in queries and dashboards.
   *
   * @param params - Creation parameters (non-empty `name` and a
   *   non-empty, duplicate-free `alternatives` list).
   * @returns The created `CustomEvent` (server-assigned `id`).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * const ce = await ws.createCustomEvent(
   *   new CreateCustomEventParams({
   *     name: "Metric Tree Opened",
   *     alternatives: ["Enter room"],
   *   }),
   * );
   * ```
   * @see mixpanel_headless.workspace.Workspace.create_custom_event
   */
  async createCustomEvent(
    params: CreateCustomEventParams,
  ): Promise<CustomEvent> {
    return governanceData.createCustomEvent(this.client, params);
  }

  /**
   * List all custom events.
   *
   * @returns The `EventDefinition` models for custom events.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.list_custom_events
   */
  async listCustomEvents(): Promise<EventDefinition[]> {
    return governanceData.listCustomEvents(this.client);
  }

  /**
   * Update a custom event's Lexicon entry.
   *
   * Identified by `custom_event_id`, never by display name: a
   * name-only PATCH makes the data-definitions endpoint fabricate a
   * new, unlinked lexicon entry. Take the id from
   * {@link Workspace.createCustomEvent}'s return value or the
   * `custom_event_id` field of {@link Workspace.listCustomEvents}.
   *
   * @param customEventId - Server-assigned custom event ID.
   * @param params - Fields to update.
   * @returns The updated `EventDefinition`.
   * @throws {@link MixpanelHeadlessError} - `UPDATE_TARGET_MISMATCH` when the
   *   server echoes a different `customEventId`.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `customEventId`
   *   is not a positive integer (network-free guard, before any request).
   * @example
   * ```typescript
   * await ws.updateCustomEvent(4242, new UpdateEventDefinitionParams({ description: "Any room entry" }));
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_custom_event
   */
  async updateCustomEvent(
    customEventId: number,
    params: UpdateEventDefinitionParams,
  ): Promise<EventDefinition> {
    requireEntityId("custom_event_id", customEventId);
    return governanceData.updateCustomEvent(this.client, customEventId, params);
  }

  /**
   * Delete a custom event.
   *
   * Identified by `custom_event_id` for the same reason
   * {@link Workspace.updateCustomEvent} is: a name-only DELETE is
   * ambiguous when lexicon rows share a display name.
   *
   * @param customEventId - Server-assigned custom event ID.
   * @returns Nothing.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `customEventId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.delete_custom_event
   */
  async deleteCustomEvent(customEventId: number): Promise<void> {
    requireEntityId("custom_event_id", customEventId);
    return governanceData.deleteCustomEvent(this.client, customEventId);
  }

  // --- Schema registry, enforcement, audit, anomalies, deletion requests ---

  /**
   * List schema registry entries.
   *
   * @param options - Optional `entity_type` filter ("event",
   *   "custom_event", "profile"); omit it to return every schema.
   * @returns The `SchemaEntry` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed API response payload
   *   (`RESPONSE_VALIDATION_ERROR`).
   * @throws {@link AuthenticationError} | {@link RateLimitError} | {@link QueryError} |
   *   {@link ServerError} - Wire failures.
   * @example
   * ```typescript
   * for (const entry of await ws.listSchemaRegistry({ entity_type: "event" })) {
   *   console.log(`${entry.name}: ${entry.entity_type}`);
   * }
   * ```
   * @see mixpanel_headless.workspace.Workspace.list_schema_registry
   */
  async listSchemaRegistry(
    options: WorkspaceListSchemaRegistryOptions = {},
  ): Promise<SchemaEntry[]> {
    return schemasAudit.listSchemaRegistry(this.client, options);
  }

  /**
   * Create a single schema definition.
   *
   * @param entityType - Entity type ("event", "custom_event", "profile").
   * @param entityName - Entity name (event name or "$user" for profile).
   * @param schemaJson - JSON Schema Draft 7 definition.
   * @returns The created schema, verbatim.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link RateLimitError} |
   *   {@link ServerError} - Wire failures.
   * @example
   * ```typescript
   * await ws.createSchema("event", "Purchase", {
   *   properties: { amount: { type: "number" } },
   * });
   * ```
   * @see mixpanel_headless.workspace.Workspace.create_schema
   */
  async createSchema(
    entityType: string,
    entityName: string,
    schemaJson: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    return schemasAudit.createSchema(
      this.client,
      entityType,
      entityName,
      schemaJson,
    );
  }

  /**
   * Bulk create schemas.
   *
   * @param params - Bulk creation parameters (entries plus the
   *   optional `truncate` flag).
   * @returns The response with `added` / `deleted` counts.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @see mixpanel_headless.workspace.Workspace.create_schemas_bulk
   */
  async createSchemasBulk(
    params: BulkCreateSchemasParams,
  ): Promise<BulkCreateSchemasResponse> {
    return schemasAudit.createSchemasBulk(this.client, params);
  }

  /**
   * Update a single schema definition, merge semantics.
   *
   * @param entityType - Entity type.
   * @param entityName - Entity name.
   * @param schemaJson - Partial JSON Schema to merge with the existing one.
   * @returns The updated schema, verbatim.
   * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
   *   failures.
   * @example
   * ```typescript
   * await ws.updateSchema("event", "Purchase", {
   *   properties: { currency: { type: "string" } },
   * });
   * ```
   * @see mixpanel_headless.workspace.Workspace.update_schema
   */
  async updateSchema(
    entityType: string,
    entityName: string,
    schemaJson: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    return schemasAudit.updateSchema(
      this.client,
      entityType,
      entityName,
      schemaJson,
    );
  }

  /**
   * Bulk update schemas, merge semantics per entry.
   *
   * @param params - Bulk update parameters.
   * @returns Per-entry results with status "ok" or "error".
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.update_schemas_bulk
   */
  async updateSchemasBulk(
    params: BulkCreateSchemasParams,
  ): Promise<BulkPatchResult[]> {
    return schemasAudit.updateSchemasBulk(this.client, params);
  }

  /**
   * Delete schemas by entity type and/or name.
   *
   * With both filters a single schema is deleted; with `entity_type`
   * alone every schema of that type; with neither, every schema.
   *
   * @param options - Optional `entity_type` / `entity_name` filters.
   * @returns The response with `delete_count`.
   * @throws {@link MixpanelHeadlessError} - `entity_name` given without
   *   `entity_type` (raised before any request).
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * const resp = await ws.deleteSchemas({
   *   entity_type: "event",
   *   entity_name: "Purchase",
   * });
   * console.log(`Deleted: ${String(resp.delete_count)}`);
   * ```
   * @see mixpanel_headless.workspace.Workspace.delete_schemas
   */
  async deleteSchemas(
    options: WorkspaceDeleteSchemasOptions = {},
  ): Promise<DeleteSchemasResponse> {
    return schemasAudit.deleteSchemas(this.client, options);
  }

  /**
   * Get the current schema-enforcement configuration.
   *
   * @param options - Optional comma-separated `fields` selector.
   * @returns The enforcement configuration.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link QueryError} - No enforcement configured (404).
   * @see mixpanel_headless.workspace.Workspace.get_schema_enforcement
   */
  async getSchemaEnforcement(
    options: WorkspaceGetSchemaEnforcementOptions = {},
  ): Promise<SchemaEnforcementConfig> {
    return schemasAudit.getSchemaEnforcement(this.client, options);
  }

  /**
   * Initialize schema enforcement.
   *
   * @param params - Init parameters carrying `rule_event`.
   * @returns The raw API response.
   * @throws {@link QueryError} - Already initialized or invalid `rule_event` (400).
   * @see mixpanel_headless.workspace.Workspace.init_schema_enforcement
   */
  async initSchemaEnforcement(
    params: InitSchemaEnforcementParams,
  ): Promise<Record<string, unknown>> {
    return schemasAudit.initSchemaEnforcement(this.client, params);
  }

  /**
   * Partially update the enforcement configuration.
   *
   * @param params - Partial update parameters.
   * @returns The raw API response.
   * @throws {@link QueryError} - No enforcement configured or validation error (400).
   * @see mixpanel_headless.workspace.Workspace.update_schema_enforcement
   */
  async updateSchemaEnforcement(
    params: UpdateSchemaEnforcementParams,
  ): Promise<Record<string, unknown>> {
    return schemasAudit.updateSchemaEnforcement(this.client, params);
  }

  /**
   * Fully replace the enforcement configuration.
   *
   * @param params - Complete replacement parameters.
   * @returns The raw API response.
   * @throws {@link QueryError} - Validation error (400).
   * @see mixpanel_headless.workspace.Workspace.replace_schema_enforcement
   */
  async replaceSchemaEnforcement(
    params: ReplaceSchemaEnforcementParams,
  ): Promise<Record<string, unknown>> {
    return schemasAudit.replaceSchemaEnforcement(this.client, params);
  }

  /**
   * Delete the enforcement configuration.
   *
   * @returns The raw API response.
   * @throws {@link QueryError} - No enforcement configured (404).
   * @see mixpanel_headless.workspace.Workspace.delete_schema_enforcement
   */
  async deleteSchemaEnforcement(): Promise<Record<string, unknown>> {
    return schemasAudit.deleteSchemaEnforcement(this.client);
  }

  /**
   * Run a full data audit — events plus properties.
   *
   * @returns The audit response with violations and `computed_at`.
   * @throws {@link MixpanelHeadlessError} - Unexpected audit-response shape.
   * @throws {@link ResponseValidationError} - A malformed violation entry,
   *   or `computed_at: null` in the metadata (where Python leaks a bare
   *   pydantic error; see PORTING.md).
   * @throws {@link QueryError} - No schemas defined (400).
   * @example
   * ```typescript
   * const audit = await ws.runAudit();
   * for (const v of audit.violations) {
   *   console.log(`${v.violation}: ${v.name} (${String(v.count)})`);
   * }
   * ```
   * @see mixpanel_headless.workspace.Workspace.run_audit
   */
  async runAudit(): Promise<AuditResponse> {
    return schemasAudit.runAudit(this.client);
  }

  /**
   * Run an events-only data audit — faster.
   *
   * @returns The audit response with event violations only.
   * @throws {@link MixpanelHeadlessError} - Unexpected audit-response shape.
   * @throws {@link ResponseValidationError} - A malformed violation entry,
   *   or `computed_at: null` in the metadata (see {@link runAudit}).
   * @throws {@link QueryError} - No schemas defined (400).
   * @see mixpanel_headless.workspace.Workspace.run_audit_events_only
   */
  async runAuditEventsOnly(): Promise<AuditResponse> {
    return schemasAudit.runAuditEventsOnly(this.client);
  }

  /**
   * List detected data-volume anomalies.
   *
   * @param options - Optional `query_params` filters (status, limit,
   *   event_id, …).
   * @returns The `DataVolumeAnomaly` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @example
   * ```typescript
   * const anomalies = await ws.listDataVolumeAnomalies({
   *   query_params: { status: "open" },
   * });
   * ```
   * @see mixpanel_headless.workspace.Workspace.list_data_volume_anomalies
   */
  async listDataVolumeAnomalies(
    options: WorkspaceListDataVolumeAnomaliesOptions = {},
  ): Promise<DataVolumeAnomaly[]> {
    return schemasAudit.listDataVolumeAnomalies(this.client, options);
  }

  /**
   * Update the status of a single anomaly.
   *
   * @param params - Update parameters (id, status, anomaly_class).
   * @returns The raw API response.
   * @throws {@link QueryError} - Anomaly not found or invalid parameters (400).
   * @see mixpanel_headless.workspace.Workspace.update_anomaly
   */
  async updateAnomaly(
    params: UpdateAnomalyParams,
  ): Promise<Record<string, unknown>> {
    return schemasAudit.updateAnomaly(this.client, params);
  }

  /**
   * Bulk update anomaly statuses.
   *
   * @param params - Bulk update with the anomalies list and target status.
   * @returns The raw API response.
   * @throws {@link QueryError} - Invalid parameters (400).
   * @see mixpanel_headless.workspace.Workspace.bulk_update_anomalies
   */
  async bulkUpdateAnomalies(
    params: BulkUpdateAnomalyParams,
  ): Promise<Record<string, unknown>> {
    return schemasAudit.bulkUpdateAnomalies(this.client, params);
  }

  /**
   * List all event deletion requests.
   *
   * @returns The `EventDeletionRequest` models, in response order.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @see mixpanel_headless.workspace.Workspace.list_deletion_requests
   */
  async listDeletionRequests(): Promise<EventDeletionRequest[]> {
    return schemasAudit.listDeletionRequests(this.client);
  }

  /**
   * Create a new event deletion request.
   *
   * @param params - Deletion parameters (event name, date range,
   *   optional filters).
   * @returns The updated full list of deletion requests.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link QueryError} - Validation error (400).
   * @see mixpanel_headless.workspace.Workspace.create_deletion_request
   */
  async createDeletionRequest(
    params: CreateDeletionRequestParams,
  ): Promise<EventDeletionRequest[]> {
    return schemasAudit.createDeletionRequest(this.client, params);
  }

  /**
   * Cancel a pending deletion request.
   *
   * @param requestId - Deletion request ID to cancel.
   * @returns The updated full list of deletion requests.
   * @throws {@link ResponseValidationError} - Malformed payload.
   * @throws {@link QueryError} - Request not found or not cancelable (400).
   * @throws {@link ParamValidationError} - `RL6_INVALID_ID` when `requestId`
   *   is not a positive integer (network-free guard, before any request).
   * @see mixpanel_headless.workspace.Workspace.cancel_deletion_request
   */
  async cancelDeletionRequest(
    requestId: number,
  ): Promise<EventDeletionRequest[]> {
    requireEntityId("request_id", requestId);
    return schemasAudit.cancelDeletionRequest(this.client, requestId);
  }

  /**
   * Preview what events a deletion filter would match.
   *
   * Read-only: nothing is modified.
   *
   * @param params - Preview parameters (event name, date range,
   *   optional filters).
   * @returns The expanded/normalized filters, verbatim.
   * @throws {@link QueryError} - Invalid filter parameters (400).
   * @see mixpanel_headless.workspace.Workspace.preview_deletion_filters
   */
  async previewDeletionFilters(
    params: PreviewDeletionFiltersParams,
  ): Promise<Array<Record<string, unknown>>> {
    return schemasAudit.previewDeletionFilters(this.client, params);
  }

  // --- Report links ---

  /**
   * The facade slice the report-link members read; session, project id
   * and the live-query service stay lazy (thunks) so they resolve where
   * Python reads them, and the public members are dispatched through the
   * instance.
   *
   * @returns The host view over this facade.
   */
  #reportLinkHost(): reportLinkMethods.ReportLinkHost {
    return {
      client: this.client,
      logger: this.#logger,
      session: () => this.#session,
      projectId: () => this.#projectId(),
      generateSlug: () => this.#generateSlug(),
      liveQueryService: () => this.liveQueryService,
      resolveWorkspaceId: () => this.resolveWorkspaceId(),
      getBookmark: (bookmarkId) => this.getBookmark(bookmarkId),
      resolveReportLink: (link) => this.resolveReportLink(link),
    };
  }

  /**
   * Turn query params (or a typed result) into a shareable report link.
   *
   * Stores an **unsaved report** on the Mixpanel server under a
   * client-minted 12-character slug and returns the web URL that opens
   * it in the report editor. One App API POST, plus workspace
   * auto-resolution (which can call the App API) when no workspace is
   * pinned or passed. The record is created, never overwritten.
   *
   * @param params - Raw bookmark params, or a typed result from
   *   {@link query}, {@link queryFunnel}, {@link queryRetention}, or
   *   {@link queryFlow}.
   * @param options - `report_type`, `name`, `description`,
   *   `workspace_id`, `bookmark_id`, `validate`.
   * @returns A {@link ReportLink} whose `url` opens the query in the
   *   browser.
   * @throws {@link ParamValidationError} - `RL4_REPORT_TYPE_CONFLICT` on a
   *   contradicting `report_type`; `RL1`/`RL3` from the URL builder;
   *   `RL6_INVALID_ID` for a zero or negative `workspace_id`. All of
   *   these fire before the POST, so no record is created for bad input.
   * @throws {@link BookmarkValidationError} - Params failed schema validation
   *   (raised before any network call).
   * @throws {@link AuthenticationError} - Invalid credentials (401).
   * @throws {@link QueryError} - The server rejected the record (400/422).
   * @throws {@link RateLimitError} - Rate limit exceeded (429).
   * @throws {@link ServerError} - Server-side errors (5xx).
   * @example
   * ```typescript
   * const result = await ws.query(Metric.total("Login"), { last: 7 });
   * const link = await ws.createReportLink(result, { name: "Logins, last 7 days" });
   * console.log(link.url);
   * // https://mixpanel.com/project/3/view/75/app/insights#EBrV5bW2u9Mw
   *
   * // From raw params, without running the query first
   * const link2 = await ws.createReportLink(await ws.buildParams("Login", { last: 7 }));
   * ```
   * @see mixpanel_headless.workspace.Workspace.create_report_link
   */
  async createReportLink(
    params: ReportLinkParamsInput,
    options: WorkspaceCreateReportLinkOptions = {},
  ): Promise<ReportLink> {
    return reportLinkMethods.createReportLink(
      this.#reportLinkHost(),
      params,
      options,
    );
  }

  /**
   * Turn a report link, a bare slug, or a shortlink into its query
   * params.
   *
   * Accepts a full Mixpanel URL to an unsaved report (slug) or a saved
   * report (bookmark), a bare 12-character slug, or a
   * `https://mixpanel.com/s/{code}` shortlink. Region, project, and
   * pinned workspace are checked against the active session **before
   * the record fetch**. At most two HTTP calls are made: one optional
   * shortlink expansion and one record fetch. The result holds the raw
   * params; run them with {@link queryReportLink}.
   *
   * @param link - The link string. Surrounding whitespace, a trailing
   *   slash, a query string, a missing scheme, an upper-case host, and a
   *   percent-encoded `#` are all tolerated.
   * @returns A {@link ResolvedReport} with `report_type`, `params`, the
   *   canonical `url`, and the saved `bookmark` when one exists.
   * @throws {@link ReportLinkParseError} - The string is not a recognizable link.
   * @throws {@link UnsupportedReportLinkError} - A dashboard link or a legacy
   *   `~(...)` hash.
   * @throws {@link ReportLinkScopeMismatchError} - The link's region or project
   *   differs from the session, or its workspace differs from the pinned
   *   session workspace. The record was not fetched.
   * @throws {@link ReportLinkNotFoundError} - The slug, saved report, or
   *   shortlink does not exist in scope.
   * @throws {@link ShortLinkResolutionError} - The shortlink target could not be
   *   extracted, or it is another shortlink.
   * @throws {@link AuthenticationError} - Invalid credentials, or the shortlink
   *   redirected to the login page.
   * @throws {@link RateLimitError} - Rate limit exceeded (429).
   * @throws {@link ServerError} - Server-side errors (5xx).
   * @throws {@link QueryError} - Other App API rejections (400/403/422).
   * @throws {@link ResponseValidationError} - The slug or bookmark record the
   *   server returned does not match the expected shape.
   * @throws {@link MixpanelHeadlessError} - A transport failure (`HTTP_ERROR`)
   *   or a response that is not a JSON object.
   * @example
   * ```typescript
   * const r = await ws.resolveReportLink(
   *   "https://mixpanel.com/project/3/view/75/app/insights#EBrV5bW2u9Mw",
   * );
   * r.report_type; // "insights"
   * r.params;      // the raw params dict
   * (await ws.queryReportLink(r)).toRows();
   * ```
   * @see mixpanel_headless.workspace.Workspace.resolve_report_link
   */
  async resolveReportLink(link: string): Promise<ResolvedReport> {
    return reportLinkMethods.resolveReportLink(this.#reportLinkHost(), link);
  }

  /**
   * Run the query behind a report link through the matching engine.
   *
   * The query runs under the scope the report records
   * (`ResolvedReport.workspace_id`: the URL `wid`, else the pin at
   * resolve time, else `null` for project-wide). That scope is sent
   * explicitly and the session pin is never injected, so a pin cleared
   * or set after resolve time cannot change the data view. A pinned
   * session that contradicts a recorded workspace is rejected first.
   *
   * @param link - A link string (resolved first with
   *   {@link resolveReportLink}) or an already resolved
   *   {@link ResolvedReport} (no second fetch).
   * @param options - `mode` (flows chart mode).
   * @returns `QueryResult` for insights, `FunnelQueryResult` for funnels,
   *   `RetentionQueryResult` for retention, or `FlowQueryResult` for
   *   flows.
   * @throws {@link UnsupportedReportLinkError} - `UNSUPPORTED_REPORT_TYPE` for a
   *   type that cannot be run (for example `launch-analysis`).
   * @throws {@link ReportLinkScopeMismatchError} - A {@link ResolvedReport} whose
   *   recorded `region` or `project_id` differs from the active session,
   *   or whose recorded `workspace_id` differs from the pinned session
   *   workspace. Raised before any query.
   * @throws {@link ReportLinkError} - Any resolution failure when `link` is a
   *   string (see {@link resolveReportLink}).
   * @throws {@link QueryError} - The query engine rejected the params.
   * @throws {@link AuthenticationError} - Invalid credentials.
   * @throws {@link RateLimitError} - Rate limit exceeded.
   * @throws {@link ServerError} - Server-side errors.
   * @example
   * ```typescript
   * const rows = (await ws.queryReportLink("EBrV5bW2u9Mw")).toRows();
   *
   * const resolved = await ws.resolveReportLink(url);
   * if (resolved.report_type === "flows") {
   *   const result = await ws.queryReportLink(resolved, { mode: "paths" });
   * }
   * ```
   * @see mixpanel_headless.workspace.Workspace.query_report_link
   */
  async queryReportLink(
    link: string | ResolvedReport,
    options: WorkspaceQueryReportLinkOptions = {},
  ): Promise<ReportLinkQueryResult> {
    return reportLinkMethods.queryReportLink(
      this.#reportLinkHost(),
      link,
      options,
    );
  }

  /**
   * Build the web URL for a saved report (bookmark). Pure; no network.
   *
   * @param bookmarkId - Numeric saved-report id.
   * @param options - `report_type` (default `insights`; the singular
   *   `funnel` normalizes to `funnels`) and `workspace_id` (defaults to
   *   the pinned session workspace; omitted when none is pinned —
   *   `resolveWorkspaceId()` is never called here).
   * @returns `https://{host}/project/{pid}[/view/{wid}]/app/{app}#{hash}`
   *   for the session region.
   * @throws {@link ParamValidationError} - `RL1_UNKNOWN_REPORT_TYPE`,
   *   `RL3_UNKNOWN_REGION`, or `RL6_INVALID_ID` (a `bookmarkId` or
   *   `workspace_id` that is not a positive integer).
   * @example
   * ```typescript
   * ws.savedReportLink(123, { report_type: "funnels" });
   * // "https://mixpanel.com/project/3/app/funnels#view/123"
   * ```
   * @see mixpanel_headless.workspace.Workspace.saved_report_link
   */
  savedReportLink(
    bookmarkId: number,
    options: WorkspaceSavedReportLinkOptions = {},
  ): string {
    return reportLinkMethods.savedReportLink(
      this.#reportLinkHost(),
      bookmarkId,
      options,
    );
  }
}

/**
 * Run a synchronous builder and hand back its result as a Promise — or its
 * throw as a rejection — exactly as the `async` wrapper it replaces did.
 * The `build*Params` members are synchronous in Python; the TS surface
 * keeps the Promise shape for symmetry with `query*`, and callers rely on
 * validation errors arriving as rejections (`.rejects` / `.catch`), never
 * as synchronous throws.
 *
 * @param compute - The synchronous builder.
 * @returns A promise settled from `compute()`.
 */
function asPromise<T>(compute: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(compute());
  });
}
