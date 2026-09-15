/**
 * The `Workspace` facade — TS port of `mixpanel_headless/workspace.py`.
 *
 * Phase-3 batch B5 splits this file three ways
 * (`docs/history/phase3/design/b5-packets.md` §2): the class skeleton plus
 * the 22 query members (S2), the 12 discovery/lexicon members (S1) and
 * the 10 session-replay members (S3). Each shard owns ONE marked,
 * append-only section; B6 appends its own below them.
 *
 * SEQUENCING NOTE (B5-S1, recorded in `B5-S1-notes.md` §0): the packet
 * assigns the skeleton below to S2, but the orchestrator dispatched S1
 * first against the Phase-1 placeholder. S1 therefore built the §2
 * skeleton to the packet's contract, verbatim, and filled only its own
 * section. S2 EXTENDS this file — its marker is already in place — and
 * owns the `_live_query_service` accessor plus the `query`-bound
 * `_replays_service` accessor (`workspace.py:1012-1033`) that S3 needs.
 */

import type { Account } from "./auth/account.js";
import { resolveSession } from "./auth/resolver.js";
import type { Project, Session, WorkspaceRef } from "./auth/session.js";
import { createMixpanelClient, type MixpanelClient } from "./client/client.js";
import { jsonValuePythonStr } from "./client/internals.js";
import { toNativeJson } from "./client/json-value.js";
import type { MeResponse } from "./client/me.js";
import { validateResponseModel } from "./client/response-validation.js";
import { pythonInt } from "./compat/python-int.js";
import { pythonRepr } from "./compat/python-str.js";
import {
  BookmarkValidationError,
  MixpanelHeadlessError,
  ParamValidationError,
  QueryError,
  ReportLinkNotFoundError,
  ReportLinkScopeMismatchError,
  ShortLinkResolutionError,
  UnsupportedReportLinkError,
  WorkspaceScopeError,
} from "./errors.js";
import {
  BOOKMARK_HASH_FOR_TYPE,
  buildBookmarkUrl,
  buildSlugUrl,
  generateSlug,
  type ParsedReportLink,
  parsedReportLink,
  parseReportLink,
  SLUG_APP_FOR_TYPE,
} from "./report-links.js";
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
import {
  type Bookmark,
  type BookmarkHistoryResponse,
  BookmarkUrl,
  type BulkUpdateBookmarkEntry,
  type CreateBookmarkParams,
  type UpdateBookmarkParams,
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
import type {
  BookmarkType,
  EntityType,
  ReportLinkType,
} from "./types/literals.js";
import type { FlowStep } from "./types/query-params/flow.js";
import type { FunnelStep } from "./types/query-params/funnel.js";
import type { RetentionEvent } from "./types/query-params/retention.js";
import {
  ReportLink,
  type ReportLinkQueryResult,
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
import {
  FlowQueryResult,
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
  type UserQueryResult,
} from "./types/results/query-engine.js";
import type {
  Replay,
  ReplayBundle,
  ReplayEvent,
  ReplaySummary,
  SignedReplay,
} from "./types/results/replays.js";
import type {
  WorkspaceGetAlertCountOptions,
  WorkspaceGetAlertHistoryOptions,
  WorkspaceListAlertsOptions,
  WorkspaceListAnnotationsOptions,
} from "./workspace-members/annotations-webhooks-alerts.js";
import * as annotationsWebhooksAlerts from "./workspace-members/annotations-webhooks-alerts.js";
import * as bookmarksCohorts from "./workspace-members/bookmarks-cohorts.js";
import {
  validateBookmarkParamsSchema,
  type WorkspaceGetBookmarkHistoryOptions,
  type WorkspaceListBookmarksV2Options,
  type WorkspaceListCohortsFullOptions,
} from "./workspace-members/bookmarks-cohorts.js";
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

export { validateBookmarkParamsSchema } from "./workspace-members/bookmarks-cohorts.js";
export { NOOP_LOGGER } from "./workspace-members/options.js";
// TODO(Ω): shim — checkEventPropertiesCount lives in replay-methods.ts.
export { checkEventPropertiesCount } from "./workspace-members/replay-methods.js";
// TODO(Ω): shim — the option types live in ./workspace-members/options.ts;
// repoint the barrel and delete this re-export.
export type { MeCacheStore, MeService } from "./services/me.js";
export type {
  ReportLinkParamsInput,
  WorkspaceCreateReportLinkOptions,
  WorkspaceEventCountsOptions,
  WorkspaceEventsForReplayOptions,
  WorkspaceEventsOptions,
  WorkspaceFetchReplayOptions,
  WorkspaceFetchReplaysOptions,
  WorkspaceFlowQueryOptions,
  WorkspaceFrequencyOptions,
  WorkspaceFunnelOptions,
  WorkspaceFunnelQueryOptions,
  WorkspaceLexiconSchemasOptions,
  WorkspaceListReplaysOptions,
  WorkspaceLogger,
  WorkspaceMeOptions,
  WorkspaceNumericOptions,
  WorkspaceOptions,
  WorkspaceProjectsOptions,
  WorkspacePropertyCountsOptions,
  WorkspacePropertyValuesOptions,
  WorkspaceQueryOptions,
  WorkspaceQueryReportLinkOptions,
  WorkspaceReplaysForUserOptions,
  WorkspaceRetentionOptions,
  WorkspaceRetentionQueryOptions,
  WorkspaceRunFlowParamsOptions,
  WorkspaceRunParamsOptions,
  WorkspaceRunUserParamsOptions,
  WorkspaceSavedReportLinkOptions,
  WorkspaceSchemaGraphOptions,
  WorkspaceSegmentationNumericOptions,
  WorkspaceSegmentationOptions,
  WorkspaceSignReplayOptions,
  WorkspaceStreamReplayOptions,
  WorkspaceSubpropertiesOptions,
  WorkspaceTopEventsOptions,
  WorkspaceUseOptions,
  WorkspaceUserQueryOptions,
  WorkspaceWorkspacesOptions,
} from "./workspace-members/options.js";

/** `last` default of the four query builders (`Workspace.query(last=30)`). */
const DEFAULT_QUERY_LAST_DAYS = 30;

/**
 * Main facade for Mixpanel operations — TS port of
 * `workspace.Workspace` (`workspace.py:274+`).
 *
 * The B5 constructor takes a RESOLVED {@link Session} only. Python's
 * `account` / `project` / `workspace` / `target` kwargs
 * (`workspace.py:427-430`) are the resolver axes, which are batch B7;
 * `use()` is B6-W1.
 *
 * @example
 * ```typescript
 * const ws = new Workspace({ session });
 * const events = await ws.events();
 * ```
 */
export class Workspace {
  /** The resolved session bound to this facade (`self._session`). */
  #session: Session;

  /** The bound wire client (Python `self._api_client`). @internal */
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

  // NOTE (W1-D2): Python also carries `self._initial_workspace_id`
  // (`workspace.py:522`), whose ONLY reader is the client-recreation
  // arm of `_get_api_client()` (`:757-766`) — the arm this port does
  // not have, because `close()` releases the pool IN PLACE and the
  // `readonly client` keeps its own pin (R6.2 identity). The field is
  // therefore deliberately absent rather than dead
  // (`B6-W1-notes.md` §W1-D2).

  /** The W1-D1 resolution seams (B7 replaces the defaults). */
  readonly #seams: ResolverSeams;

  /** Factory for the `/me` cache store handed to each MeService. */
  readonly #meCacheFactory: (accountName: string) => MeCacheStore;

  /**
   * Per-account memo of cache STORES (B7-A1): Python's
   * `MeCache(account_name=…)` re-reads the same per-account disk file
   * however many times the lazy `MeService` is rebuilt, so a
   * `use(project=…)` swap keeps the warm cache
   * (`TestFacadeResolverWiring::test_resolver_follows_project_swap`).
   * The in-memory default must share state the same way — the factory
   * runs once per account name per facade.
   */
  readonly #meCacheStores = new Map<string, MeCacheStore>();

  /** `warnings.warn` sink handed to the discovery service. */
  readonly #warn: WarningSink | undefined;

  /** The log seam; {@link NOOP_LOGGER} unless the host injected one. */
  readonly #logger: ResolvedWorkspaceLogger;
  /** The `generate_slug` seam (045-report-links). */
  readonly #generateSlug: () => string;

  // --- B6-W7 seams (W7 owns; see `WorkspaceOptions.readFile`/`monotonic`) ---

  /** `Path(...).read_bytes()` seam of `uploadLookupTable` (W7-D1). */
  readonly #readFile: (path: string) => Promise<Uint8Array>;

  /** `time.monotonic()` seam (seconds) of the upload poll (W7-D2). */
  readonly #monotonic: () => number;

  /**
   * Create a workspace facade.
   *
   * @param options - The resolved session plus the optional injected
   *   client / seams.
   */
  constructor(options: WorkspaceOptions) {
    // The WS1 constructor guard fires BEFORE the session/resolver
    // branch (`workspace.py:455-465` — packet §14 Caution 4 order).
    guardTargetExclusivity(options);
    let session: Session;
    if (options.session === undefined) {
      // B7-A1: the resolver constructor kwargs (`workspace.py:427-430`)
      // resolve through `resolveSession(...)` over injected sources
      // (R9.4). The bridge-token materialization side effect
      // (`workspace.py:479-513`) is B8's (`TestBridgeTokenMaterialization`
      // stays deferred, `b7-packets.md` §3.4).
      const sources = options.sources;
      if (sources === undefined) {
        // Core-alone posture (b8-packets.md §4.4): the on-disk default
        // wiring ships in `packages/node` — Python's `Workspace()` twin
        // is `new Workspace({ sources: createNodeWorkspaceSources() })`
        // (the STARTUP sources incl. the `workspace.py:476-513`
        // bridge-token materialization side effect; B8-ARB-A SEM-F1,
        // `b8-reviewA-resolution.md`). Core stays runtime-agnostic, so
        // sessionless construction here requires injected sources.
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
    // B6-W7 seams (W7 owns these two lines).
    this.#readFile = options.readFile ?? unportedReadFile;
    this.#monotonic = options.monotonic ?? defaultMonotonic;
    this.#installWorkspaceResolver();
  }

  /**
   * The resolved session bound to this facade (`session` property,
   * `workspace.py:546-548`). Read-only: `use()` swaps it in place.
   */
  get session(): Session {
    return this.#session;
  }

  /**
   * Wire the facade's `/me` cache into the client's workspace
   * auto-resolver (`_install_workspace_resolver`,
   * `workspace.py:775-793`).
   *
   * The closure reads {@link meService} on every call, so it keeps
   * pointing at the CURRENT service across `use()` cache clears. A
   * resolver already installed on an INJECTED client is left in place
   * (`workspace.py:789-791`).
   *
   * @internal
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
   * Get or create the discovery service (lazy initialization —
   * `workspace.py:1005-1010`).
   *
   * @returns The memoized service.
   * @internal
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
   * Swap one or more session axes in place; returns `this` for
   * chaining (`use`, `workspace.py:552-694`).
   *
   * `target=` is mutually exclusive with
   * `account=`/`project=`/`workspace=`. The wire client — and with it
   * the connection pool — is PRESERVED across every switch (R6.2): the
   * swap is delegated to {@link MixpanelClient.use}, which rebuilds the
   * auth header in place. Every lazy service is then discarded so
   * subsequent reads observe the new session.
   *
   * `use(workspace: N)` pins App-API and Query-host scoping; raw export
   * streaming stays project-scoped by design (W1-D3).
   *
   * @param options - The axes to swap plus `persist`.
   * @returns `this`.
   * @throws ParamValidationError - `WS1_TARGET_MUTUALLY_EXCLUSIVE`.
   * @throws MixpanelHeadlessError - `UNPORTED_RESOLVER_SEAM` while the
   *   B7 seams are unimplemented (the `target=` / `account=` /
   *   `persist=true` branches).
   * @throws ConfigError - `account=` swap resolves no project axis.
   * @example
   * ```typescript
   * for (const project of await ws.projects()) {
   *   await ws.use({ project: project.id });
   * }
   * ```
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
      // env > param > target > bridge > config applies (FR-017).
      const resolved = await this.#seams.resolveSession({ target });
      newAccount = resolved.account;
      newProject = resolved.project;
      newWorkspace = resolved.workspace ?? null;
    } else if (account === null) {
      newProject = project === null ? null : { id: project };
      newWorkspace = workspace === null ? null : { id: workspace };
    } else {
      // Explicit account swap (FR-033): the project re-resolves against
      // the NEW account; the workspace axis is cleared unless supplied
      // explicitly or by MP_WORKSPACE_ID.
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
    // session rather than the prior one (`workspace.py:679-693`).
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
   * Close all resources (`close`, `workspace.py:744-753`).
   *
   * Idempotent and safe to call repeatedly.
   *
   * W1-D2 (arbiter-visible): Python nulls `self._api_client` and lets
   * `_get_api_client()` build a REPLACEMENT on the next call; TS keeps
   * the `readonly client` the R6.2 identity assertions track and closes
   * the pool IN PLACE — the client's own `close()` drops the pool
   * token and `ensureHttp()` recreates it on the next request, so a
   * post-close call behaves as Python's recreated client does. The one
   * divergence (recorded in `B6-W1-notes.md`): Python's replacement
   * client forgets a runtime `set_workspace_id()` pin and re-applies
   * `_initial_workspace_id`, while the TS client keeps its current pin.
   *
   * @returns Nothing.
   */
  async close(): Promise<void> {
    await this.client.close();
  }

  /**
   * `await using` support (R6.2) — delegates to {@link close}, the
   * `__exit__` twin (`workspace.py:730-742`).
   *
   * @returns Nothing.
   */
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  // === B5-S2 query members (S2 owns; append-only) ===

  /**
   * Get or create the live query service (lazy initialization —
   * `workspace.py:1012-1017`).
   *
   * @returns The memoized service.
   * @internal
   */
  get liveQueryService(): LiveQueryService {
    if (this.#liveQuery === null) {
      this.#liveQuery = new LiveQueryService(this.client, {
        ...(this.#warn === undefined ? {} : { warn: this.#warn }),
      });
    }
    return this.#liveQuery;
  }

  // Placement note (B5-ARB, resolving the stale S2 TODO): the
  // `_replays_service` accessor (`workspace.py:1019-1033`) was assigned
  // to this section by packet §2, but S3 landed it in the S3 section
  // below (`replaysService` get/set, memoized in `#replays`) with the
  // packet-specified `query_fn` DI. Behavior is per spec; only the
  // placement differs. See `b5-review-resolution.md` ASR-F5.

  /**
   * Run a segmentation query against the Mixpanel API
   * (`segmentation`, `workspace.py:1583-1616`).
   *
   * @param event - Event name to query.
   * @param options - Required date window plus `on` / `unit` / `where`.
   * @returns Time-series data with the calculated total.
   * @throws ConfigError - Credentials not available.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   */
  async segmentation(
    event: string,
    options: WorkspaceSegmentationOptions,
  ): Promise<SegmentationResult> {
    const { from_date, to_date, ...rest } = options;
    return this.liveQueryService.segmentation(event, from_date, to_date, rest);
  }

  /**
   * Run a funnel analysis query (`funnel`,
   * `workspace.py:1618-1648`).
   *
   * @param funnelId - ID of the saved funnel.
   * @param options - Required date window plus `unit` / `on`.
   * @returns Step conversion rates.
   * @throws ConfigError - Credentials not available.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `funnelId`
   *   is not a positive integer (network-free guard, before any request).
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
   * Run a retention analysis query (`retention`,
   * `workspace.py:1650-1692`).
   *
   * @param options - Born/return events, the date window and the
   *   interval knobs (all keyword-only in Python).
   * @returns Cohort retention data.
   * @throws ConfigError - Credentials not available.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
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
   * Get counts for multiple events (`event_counts`,
   * `workspace.py:1694-1724`).
   *
   * @param events - Event names.
   * @param options - Required date window plus `type` / `unit`.
   * @returns Time series per event.
   * @throws ConfigError - Credentials not available.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   */
  async eventCounts(
    events: readonly string[],
    options: WorkspaceEventCountsOptions,
  ): Promise<EventCountsResult> {
    const { from_date, to_date, ...rest } = options;
    return this.liveQueryService.eventCounts(events, from_date, to_date, rest);
  }

  /**
   * Get event counts broken down by property value
   * (`property_counts`, `workspace.py:1726-1765`).
   *
   * @param event - Event name.
   * @param propertyName - Property to break down by.
   * @param options - Required date window plus `type` / `unit` /
   *   `values` / `limit`.
   * @returns Time series per property value.
   * @throws ConfigError - Credentials not available.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
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
   * Get the activity feed for specific users (`activity_feed`,
   * `workspace.py:1767-1844`).
   *
   * Events come back oldest-first within a page; when `limit` is set
   * the most recent events lead and `sentinel_event` pages backward.
   *
   * @param distinctIds - User identifiers.
   * @param options - Dates / limit / include / exclude / search /
   *   pagination.
   * @returns The events plus the `sentinel_event` cursor.
   * @throws ConfigError - Credentials not available.
   * @throws QueryError - Both `include_events` and `exclude_events`
   *   given (and the other wire rejections).
   */
  async activityFeed(
    distinctIds: readonly string[],
    options: LiveActivityFeedOptions = {},
  ): Promise<ActivityFeedResult> {
    return this.liveQueryService.activityFeed(distinctIds, options);
  }

  /**
   * Query a saved report by bookmark type (`query_saved_report`,
   * `workspace.py:1846-1880`).
   *
   * @param bookmarkId - ID of the saved report.
   * @param options - `bookmark_type` plus the funnel date window.
   * @returns The normalized report data.
   * @throws ConfigError - Credentials not available.
   * @throws QueryError - Invalid `bookmark_id` or report not found.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async querySavedReport(
    bookmarkId: number,
    options: LiveQuerySavedReportOptions = {},
  ): Promise<SavedReportResult> {
    requireEntityId("bookmark_id", bookmarkId);
    return this.liveQueryService.querySavedReport(bookmarkId, options);
  }

  /**
   * Query a saved Flows report (`query_saved_flows`,
   * `workspace.py:1882-1898`).
   *
   * @param bookmarkId - ID of the saved flows report.
   * @returns Steps, breakdowns and the conversion rate.
   * @throws ConfigError - Credentials not available.
   * @throws QueryError - Invalid `bookmark_id` or report not found.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async querySavedFlows(bookmarkId: number): Promise<FlowsResult> {
    requireEntityId("bookmark_id", bookmarkId);
    return this.liveQueryService.querySavedFlows(bookmarkId);
  }

  /**
   * Analyze the event frequency distribution (`frequency`,
   * `workspace.py:1900-1933`).
   *
   * @param options - Required date window plus `unit` /
   *   `addiction_unit` / `event` / `where`.
   * @returns The frequency distribution.
   * @throws ConfigError - Credentials not available.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   */
  async frequency(
    options: WorkspaceFrequencyOptions,
  ): Promise<FrequencyResult> {
    const { from_date, to_date, ...rest } = options;
    return this.liveQueryService.frequency(from_date, to_date, rest);
  }

  /**
   * Bucket events by numeric property ranges
   * (`segmentation_numeric`, `workspace.py:1935-1971`).
   *
   * @param event - Event name.
   * @param options - Required date window and `on`, plus `unit` /
   *   `where` / `type`.
   * @returns The bucketed data.
   * @throws ConfigError - Credentials not available.
   * @throws QueryError - Invalid parameters or a non-numeric property.
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
   * Calculate the sum of a numeric property over time
   * (`segmentation_sum`, `workspace.py:1973-2006`).
   *
   * @param event - Event name.
   * @param options - Required date window and `on`, plus `unit` /
   *   `where`.
   * @returns Sum values per period.
   * @throws ConfigError - Credentials not available.
   * @throws QueryError - Invalid parameters or a non-numeric property.
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
   * Calculate the average of a numeric property over time
   * (`segmentation_average`, `workspace.py:2008-2041`).
   *
   * @param event - Event name.
   * @param options - Required date window and `on`, plus `unit` /
   *   `where`.
   * @returns Average values per period.
   * @throws ConfigError - Credentials not available.
   * @throws QueryError - Invalid parameters or a non-numeric property.
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

  // -------------------------------------------------------------------
  // INSIGHTS QUERY API (Phase 029) — `workspace.py:2043-2743`
  // -------------------------------------------------------------------

  /**
   * Run a typed insights query (`query`, `workspace.py:2285-2429`).
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
   * @throws ValueError - `limit` is not an integer from 1 to 50000.
   * @throws BookmarkValidationError - Argument or bookmark validation.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   * @example
   * ```typescript
   * const result = await ws.query("Login", { math: "unique", last: 7 });
   * ```
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
   * Run pre-built insights bookmark params against the Mixpanel API
   * (`run_params`, `workspace.py:2518-2560`).
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
   * @throws ValueError - `limit` is not an integer from 1 to 50000.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   * @example
   * ```typescript
   * const params = await ws.buildParams("Login", { group_by: "$city", last: 7 });
   * params["sections"]["filter"] = myCustomFilter;
   * const result = await ws.runParams(params, { limit: 50_000 });
   * ```
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
   * Build validated insights bookmark params WITHOUT calling the API
   * (`build_params`, `workspace.py:2431-2544`).
   *
   * @param events - Same input union as {@link query}.
   * @param options - The same 17 keyword-only knobs.
   * @returns Bookmark params with `sections` and `displayOptions`.
   * @throws BookmarkValidationError - Argument or bookmark validation.
   */
  buildParams(
    events: EventsInput,
    options: WorkspaceQueryOptions = {},
  ): Promise<ParamsDict> {
    return asPromise(() => this.#resolveQueryParams(events, options));
  }

  /**
   * Shared body of {@link query} and {@link buildParams} — the option
   * unpacking Python spells out twice (`:2402-2421`, `:2523-2542`).
   *
   * @param events - The events input.
   * @param options - The keyword-only knobs.
   * @returns The validated bookmark params.
   * @throws BookmarkValidationError - Any validation layer.
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

  // -------------------------------------------------------------------
  // FUNNEL QUERY (Phase 032) — `workspace.py:2744-3320`
  // -------------------------------------------------------------------

  /**
   * Run a typed funnel query (`query_funnel`,
   * `workspace.py:3064-3200`).
   *
   * @param steps - Funnel steps (strings or `FunnelStep` objects).
   * @param options - The 17 keyword-only knobs plus `limit` (segments
   *   to return, 1 to 50000; default 3000).
   * @returns Step data, conversion rates and metadata.
   * @throws ValueError - `limit` is not an integer from 1 to 50000.
   * @throws BookmarkValidationError - Argument or bookmark validation.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
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
   * Run pre-built funnel bookmark params against the Mixpanel API
   * (`run_funnel_params`, `workspace.py:3340-3380`).
   *
   * The execution half of {@link buildFunnelParams}.
   *
   * @param params - Funnel bookmark params dict, normally from
   *   {@link buildFunnelParams}. Sent as the request `bookmark`.
   * @param options - `limit` (segments to return, 1 to 50000; default
   *   3000) and `workspace_id` (data view override).
   * @returns Step data, conversion rates and metadata.
   * @throws ValueError - `limit` is not an integer from 1 to 50000.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   * @example
   * ```typescript
   * const params = await ws.buildFunnelParams(["Signup", "Purchase"]);
   * const result = await ws.runFunnelParams(params, { limit: 50_000 });
   * ```
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
   * Build validated funnel bookmark params WITHOUT calling the API
   * (`build_funnel_params`, `workspace.py:3202-3319`).
   *
   * @param steps - Funnel steps (strings or `FunnelStep` objects).
   * @param options - The same 17 keyword-only knobs.
   * @returns Bookmark params with `sections` and `displayOptions`.
   * @throws BookmarkValidationError - Argument or bookmark validation.
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
   * @throws BookmarkValidationError - Any validation layer.
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

  // -------------------------------------------------------------------
  // FLOW QUERY (inline ad-hoc) — `workspace.py:3489-4096`
  // -------------------------------------------------------------------

  /**
   * Run a typed flow query (`query_flow`,
   * `workspace.py:3852-3986`).
   *
   * @param event - Anchor event(s): a string, a `FlowStep`, or a list.
   * @param options - The 16 keyword-only knobs.
   * @returns Steps, flows, breakdowns and metadata.
   * @throws BookmarkValidationError - Argument or bookmark validation.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
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
   * Run pre-built flow bookmark params against the Mixpanel API
   * (`run_flow_params`, `workspace.py:4170-4216`).
   *
   * The execution half of {@link buildFlowParams}. The chart mode is
   * read from the params via {@link flowModeFromParams} unless
   * `options.mode` overrides it.
   *
   * @param params - Flow bookmark params dict, normally from
   *   {@link buildFlowParams}. Sent as the request `bookmark`.
   * @param options - `mode` (override; default derived from the params)
   *   and `workspace_id` (data view override).
   * @returns Steps, flows, breakdowns and metadata.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   * @example
   * ```typescript
   * const params = await ws.buildFlowParams("Login", { mode: "tree", last: 7 });
   * const result = await ws.runFlowParams(params); // runs as tree
   * ```
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
   * Build validated flow bookmark params WITHOUT calling the API
   * (`build_flow_params`, `workspace.py:3988-4095`).
   *
   * @param event - Anchor event(s).
   * @param options - The same 16 keyword-only knobs.
   * @returns The FLAT flow bookmark params dict.
   * @throws BookmarkValidationError - Argument or bookmark validation.
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
   * @throws BookmarkValidationError - Any validation layer.
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

  // -------------------------------------------------------------------
  // RETENTION QUERY (inline ad-hoc) — `workspace.py:4097-4463`
  // -------------------------------------------------------------------

  /**
   * Run a typed retention query (`query_retention`,
   * `workspace.py:4225-4347`).
   *
   * @param bornEvent - Event defining cohort membership.
   * @param returnEvent - Event defining return.
   * @param options - The 15 keyword-only knobs plus `limit` (segments
   *   to return, 1 to 50000; default 3000).
   * @returns Cohort data, averages and metadata.
   * @throws ValueError - `limit` is not an integer from 1 to 50000.
   * @throws BookmarkValidationError - Argument or bookmark validation.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
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
   * Run pre-built retention bookmark params against the Mixpanel API
   * (`run_retention_params`, `workspace.py:4584-4625`).
   *
   * The execution half of {@link buildRetentionParams}.
   *
   * @param params - Retention bookmark params dict, normally from
   *   {@link buildRetentionParams}. Sent as the request `bookmark`.
   * @param options - `limit` (segments to return, 1 to 50000; default
   *   3000) and `workspace_id` (data view override).
   * @returns Cohort data, averages and metadata.
   * @throws ValueError - `limit` is not an integer from 1 to 50000.
   * @throws AuthenticationError | QueryError | RateLimitError - Wire
   *   failures.
   * @example
   * ```typescript
   * const params = await ws.buildRetentionParams("Signup", "Login");
   * const result = await ws.runRetentionParams(params, { limit: 50_000 });
   * ```
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
   * Build validated retention bookmark params WITHOUT calling the API
   * (`build_retention_params`, `workspace.py:4349-4463`).
   *
   * @param bornEvent - Event defining cohort membership.
   * @param returnEvent - Event defining return.
   * @param options - The same 15 keyword-only knobs.
   * @returns Bookmark params with `sections`, `displayOptions`,
   *   `sorting` and `columnWidths`.
   * @throws BookmarkValidationError - Argument or bookmark validation.
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
   * @throws BookmarkValidationError - Any validation layer.
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

  // -------------------------------------------------------------------
  // USER QUERY ENGINE (Phase 039) — `workspace.py:9336-10256`
  // -------------------------------------------------------------------

  /**
   * Query user profiles from Mixpanel's Engage API (`query_user`,
   * `workspace.py:9722-9881`).
   *
   * Builds the engage params and hands them to {@link runUserParams},
   * which routes on the params: an aggregate `action` key goes to the
   * engage stats endpoint; anything else fetches profile pages
   * sequentially, or concurrently when `parallel` is set and
   * `limit !== 1`.
   *
   * @param options - The 19 keyword-only knobs.
   * @returns Profiles/aggregate payload with metadata.
   * @throws BookmarkValidationError - Argument or param validation.
   * @throws AuthenticationError | QueryError | RateLimitError |
   *   ServerError - Wire failures.
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
   * Run pre-built Engage API params against the Mixpanel API
   * (`run_user_params`, `workspace.py:10141-10230`).
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
   * @throws AuthenticationError | QueryError | RateLimitError |
   *   ServerError - Wire failures.
   * @example
   * ```typescript
   * const params = await ws.buildUserParams({
   *   mode: "profiles",
   *   where: Filter.equals("plan", "premium"),
   * });
   * params["output_properties"] = JSON.stringify(["$email", "ltv"]);
   * const result = await ws.runUserParams(params, { limit: 500, parallel: true });
   * ```
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
   * Build validated engage params WITHOUT calling the API
   * (`build_user_params`, `workspace.py:9883-9997`).
   *
   * @param options - The same 19 keyword-only knobs.
   * @returns The engage params dict.
   * @throws BookmarkValidationError - Argument or param validation.
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
   * @throws BookmarkValidationError - Any validation layer.
   */
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
   * `int(self._session.project.id)` (`workspace.py:2428`) — the
   * project id every inline query body carries.
   *
   * @returns The numeric project id.
   * @throws PythonIntError - When the stored id is not an integer
   *   literal (CPython's `int(str)` twin, R11.7).
   */
  #projectId(): number {
    return pythonInt(this.session.project.id);
  }

  // === B5-S1 discovery/lexicon members (append-only; S1 owns) ===

  /**
   * List event names in the Mixpanel project (`events`,
   * `workspace.py:1039-1088`).
   *
   * Defaults to the widest window `/events/names` accepts
   * (`limit=5000`, `from_date=2000-01-01`, `to_date=today`); the wire
   * layer retries a date-range-gated 403 with the project's
   * `max_data_history_days` ceiling. The result reflects events seen in
   * the window — it is NOT the Lexicon registry.
   *
   * Cached per `(limit, from_date, to_date)` for the facade's lifetime.
   *
   * @param options - Optional limit / date bounds.
   * @returns Alphabetically sorted event names.
   * @throws AuthenticationError - Credentials rejected.
   * @throws QueryError - Non-gate 403s and other 4xx errors.
   */
  async events(options: WorkspaceEventsOptions = {}): Promise<string[]> {
    return this.discoveryService.listEvents(options);
  }

  /**
   * List all property names for an event (`properties`,
   * `workspace.py:1090-1104`). Cached per event.
   *
   * @param event - Event name.
   * @returns Alphabetically sorted property names.
   * @throws EventNotFoundError - Unknown event (with suggestions).
   */
  async properties(event: string): Promise<string[]> {
    return this.discoveryService.listProperties(event);
  }

  /**
   * Get sample values for a property (`property_values`,
   * `workspace.py:1106-1130`). Cached per
   * `(property, event, limit)`.
   *
   * @param propertyName - Property to get values for.
   * @param options - Optional event filter and limit.
   * @returns Sample property values as strings (unsorted).
   * @throws AuthenticationError - Credentials rejected.
   */
  async propertyValues(
    propertyName: string,
    options: WorkspacePropertyValuesOptions = {},
  ): Promise<string[]> {
    return this.discoveryService.listPropertyValues(propertyName, options);
  }

  /**
   * List inferred subproperties of a list-of-object property
   * (`subproperties`, `workspace.py:1132-1191`).
   *
   * Only SCALAR sub-values (string / number / boolean / ISO datetime
   * string) are reported; nested dicts and lists are skipped because
   * `GroupBy.list_item` / `Filter.list_contains` cannot use them.
   *
   * @param propertyName - Top-level property name (e.g. `"cart"`).
   * @param options - Optional event scope and sample size.
   * @returns Alphabetically sorted subproperty infos.
   * @throws AuthenticationError - Credentials rejected.
   *
   * Emits the injected {@link WarningSink} (Python `UserWarning`) for
   * mixed scalar types, mixed scalar/nested shapes, and all-null keys.
   * @example
   * ```typescript
   * for (const sp of await ws.subproperties("cart", { event: "Cart Viewed" })) {
   *   console.log(sp.name, sp.type, sp.sample_values);
   * }
   * ```
   */
  async subproperties(
    propertyName: string,
    options: WorkspaceSubpropertiesOptions = {},
  ): Promise<SubPropertyInfo[]> {
    return this.discoveryService.listSubproperties(propertyName, options);
  }

  /**
   * List saved funnels (`funnels`, `workspace.py:1193-1204`). Cached.
   *
   * @returns Funnel infos sorted by name.
   * @throws AuthenticationError - Credentials rejected.
   */
  async funnels(): Promise<FunnelInfo[]> {
    return this.discoveryService.listFunnels();
  }

  /**
   * List saved cohorts (`cohorts`, `workspace.py:1206-1217`). Cached.
   *
   * @returns Saved cohorts sorted by name.
   * @throws AuthenticationError - Credentials rejected.
   */
  async cohorts(): Promise<SavedCohort[]> {
    return this.discoveryService.listCohorts();
  }

  /**
   * List saved reports (bookmarks) (`list_bookmarks`,
   * `workspace.py:1219-1241`). NOT cached.
   *
   * @param bookmarkType - Optional report-type filter.
   * @returns Bookmark metadata rows (empty when none exist).
   * @throws QueryError - Permission denied or invalid type parameter.
   */
  async listBookmarks(
    bookmarkType: BookmarkType | null = null,
  ): Promise<BookmarkInfo[]> {
    return this.discoveryService.listBookmarks(bookmarkType);
  }

  /**
   * Today's most active events (`top_events`,
   * `workspace.py:1243-1271`). NOT cached — real-time data.
   *
   * @param options - Counting method and limit.
   * @returns Top events with `event`, `count` and `percent_change`.
   * @throws AuthenticationError - Credentials rejected.
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
   * Clear cached discovery results (`clear_discovery_cache`,
   * `workspace.py:1273-1279`).
   *
   * Mirrors Python's guard exactly: when the discovery service has
   * never been created there is nothing to clear and NO service is
   * constructed as a side effect.
   */
  clearDiscoveryCache(): Promise<void> {
    if (this.#discovery !== null) {
      this.#discovery.clearCache();
    }
    return Promise.resolve();
  }

  /**
   * List Lexicon schemas (`lexicon_schemas`,
   * `workspace.py:1285-1313`). Cached for the facade's lifetime — the
   * Lexicon API allows only 5 requests/minute.
   *
   * @param options - Optional entity-type filter.
   * @returns Schemas sorted by `(entity_type, name)`.
   * @throws AuthenticationError - Credentials rejected.
   */
  async lexiconSchemas(
    options: WorkspaceLexiconSchemasOptions = {},
  ): Promise<LexiconSchema[]> {
    return this.discoveryService.listSchemas(options);
  }

  /**
   * Get one Lexicon schema (`lexicon_schema`,
   * `workspace.py:1315-1344`). Cached.
   *
   * @param entityType - Entity type (`"event"` / `"profile"`).
   * @param name - Entity name.
   * @returns The schema.
   * @throws QueryError - Schema not found.
   */
  async lexiconSchema(
    entityType: EntityType,
    name: string,
  ): Promise<LexiconSchema> {
    return this.discoveryService.getSchema(entityType, name);
  }

  /**
   * Gather the full Lexicon schema and the event↔property
   * relationships (`schema_graph`, `workspace.py:1346-1397`). Cached
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
   * @throws AuthenticationError - Credentials rejected.
   * @example
   * ```typescript
   * const schema = await ws.schemaGraph();
   * schema.propertiesForEvent("Purchase");
   * schema.toGraph();
   * ```
   */
  async schemaGraph(
    options: WorkspaceSchemaGraphOptions = {},
  ): Promise<SchemaGraphResult> {
    return this.discoveryService.getSchemaGraph(options);
  }

  // === B5-S3 session-replay members (append-only; S3 owns) ===

  /**
   * Get or create the session-replay service (044, lazy
   * initialization — `_replays_service`, `workspace.py:1019-1033`).
   *
   * Constructed on first access with the BOUND {@link query} so
   * `ReplaysService.discover` / `eventsFor` can issue Insights queries
   * without taking a hard dependency on `Workspace`
   * (circular-import-free DI, `replays.py:150-176`). S2 left this
   * accessor for S3 because `ReplaysService` did not exist in the tree
   * when S2 landed (`B5-S2-notes.md` §2).
   *
   * Settable, mirroring Python's `self._replays_svc = ...` attribute
   * assignment — the seam the Layer-3 suites and the conformance
   * bindings substitute a stub through.
   *
   * @returns The memoized service.
   * @internal
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
   * List replays for a user, or hydrate summaries for explicit IDs
   * (`list_replays`, `workspace.py:10679-10755`).
   *
   * Exactly one of `distinct_id` or `replay_ids` MUST be provided.
   * When `distinct_id` is set, `from_date` and `to_date` are required.
   *
   * @param options - The selector, the optional window, and the limit.
   * @returns `ReplaySummary` rows, possibly empty.
   * @throws ParamValidationError - Neither or both selectors
   *   (`WR4_REPLAY_SELECTOR_REQUIRED`), or `distinct_id` without a date
   *   window (`WR5_DATE_RANGE_REQUIRED`).
   * @throws QueryError - Underlying Insights API failure.
   */
  async listReplays(
    options: WorkspaceListReplaysOptions = {},
  ): Promise<ReplaySummary[]> {
    return replayMethods.listReplays(this.#replayHost(), options);
  }

  /**
   * Mixpanel events that occurred during a single replay's time window
   * (`events_for_replay`, `workspace.py:10757-10793`).
   *
   * @param replayId - The replay to fetch events for.
   * @param options - Extra group keys and the optional window.
   * @returns Ordered `ReplayEvent`s; empty when the window has none.
   * @throws ParamValidationError - More than 5 `event_properties`
   *   (`WR1_TOO_MANY_EVENT_PROPERTIES`).
   * @throws QueryError - Underlying Insights API failure.
   */
  async eventsForReplay(
    replayId: string,
    options: WorkspaceEventsForReplayOptions = {},
  ): Promise<ReplayEvent[]> {
    return replayMethods.eventsForReplay(this.#replayHost(), replayId, options);
  }

  /**
   * Batched version of {@link eventsForReplay} — single round-trip
   * (`events_for_replays`, `workspace.py:10795-10830`).
   *
   * @param replayIds - Replays to fetch events for.
   * @param options - Extra group keys and the optional window.
   * @returns `replay_id` → ordered `ReplayEvent` list (R4.8 Map);
   *   replays with no events are omitted.
   * @throws ParamValidationError - More than 5 `event_properties`
   *   (`WR1_TOO_MANY_EVENT_PROPERTIES`).
   * @throws QueryError - Underlying Insights API failure.
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
   * Sign a single replay ID; sugar over {@link signReplays}
   * (`sign_replay`, `workspace.py:10832-10852`).
   *
   * @param replayId - Replay to sign.
   * @param options - `env` (`"prod"` default).
   * @returns One `SignedReplay`. `query_string` is a 5-minute bearer
   *   credential — treat it like a session token.
   * @throws SessionReplayAccessError - Sensitive-data flag set.
   * @throws QueryError | ServerError - Other 4xx / 5xx.
   */
  async signReplay(
    replayId: string,
    options: WorkspaceSignReplayOptions = {},
  ): Promise<SignedReplay> {
    return replayMethods.signReplay(this.#replayHost(), replayId, options);
  }

  /**
   * Sign multiple replays via the bulk endpoint (`sign_replays`,
   * `workspace.py:10854-10873`).
   *
   * @param replayIds - Replays to sign.
   * @param options - `env` (`"prod"` default).
   * @returns `SignedReplay`s in input order.
   * @throws SessionReplayAccessError - Sensitive-data flag set.
   * @throws QueryError | ServerError - Other 4xx / 5xx.
   */
  async signReplays(
    replayIds: readonly string[],
    options: WorkspaceSignReplayOptions = {},
  ): Promise<SignedReplay[]> {
    return replayMethods.signReplays(this.#replayHost(), replayIds, options);
  }

  /**
   * Sign, fetch, and assemble a single `Replay` (`fetch_replay`,
   * `workspace.py:10875-10981`).
   *
   * Runs the vendored rrweb analyzer to populate `Replay.actions`; the
   * raw `rrweb_events` list is also populated for downstream tools.
   *
   * Python's event-loop caveat (`asyncio.run` cannot run inside a
   * running loop) has NO TS twin — this member is `async` and composes
   * naturally (R6.1). The Python docstring's guidance to drive
   * `walk_cdn_async` directly maps to
   * {@link ReplaysService.walkCdnAsync}, which is public here too.
   *
   * @param replayId - The replay to fetch.
   * @param options - Retention / bounds / concurrency / join knobs.
   * @returns A `Replay` with `rrweb_events` and `actions` populated.
   * @throws ReplayNotFoundError - First CDN file 404'd, or the walk
   *   yielded zero events.
   * @throws SessionReplayAccessError - Sensitive-data flag set.
   * @throws SignedURLExpiredError - Signed URL expired during fetch.
   * @throws ParamValidationError - More than 5 `event_properties`.
   */
  async fetchReplay(
    replayId: string,
    options: WorkspaceFetchReplayOptions = {},
  ): Promise<Replay> {
    return replayMethods.fetchReplay(this.#replayHost(), replayId, options);
  }

  /**
   * Yield raw rrweb events one at a time, batched-parallel under the
   * hood (`stream_replay`, `workspace.py:10983-11043`).
   *
   * R6.6 — item-level `yield*` over the service generator; nothing
   * buffers. Python's private-event-loop plumbing
   * (`asyncio.new_event_loop` + `run_until_complete(gen.__anext__())`)
   * has no TS twin: the async generator composes directly, and the
   * `finally: gen.aclose()` contract is what `for await` +
   * `AsyncGenerator.return()` already guarantee.
   *
   * @param replayId - The replay to stream.
   * @param options - Retention / bounds / concurrency / re-sign policy.
   * @yields Raw rrweb event dicts in timestamp order.
   * @throws ReplayNotFoundError - First CDN file 404'd.
   * @throws SignedURLExpiredError - Re-sign retry exhausted or
   *   disabled.
   * @throws SessionReplayAccessError - Sensitive-data flag set.
   */
  async *streamReplay(
    replayId: string,
    options: WorkspaceStreamReplayOptions = {},
  ): AsyncGenerator<Readonly<Record<string, unknown>>, void, undefined> {
    yield* replayMethods.streamReplay(this.#replayHost(), replayId, options);
  }

  /**
   * Fetch N replays in parallel; return a `ReplayBundle`
   * (`fetch_replays`, `workspace.py:11045-11184`).
   *
   * Materializes each replay via {@link fetchReplay} and bundles them.
   * Outer `concurrency` parallelizes across replays; inner
   * `cdn_concurrency` parallelizes each replay's CDN file walk. Python
   * uses a `ThreadPoolExecutor` purely so each replay's `asyncio.run`
   * gets its own event loop — the TS port needs no such isolation, so
   * the outer level is BOUNDED-CONCURRENCY promise scheduling with the
   * same worker cap, the same input-order output, and the same
   * per-replay failure isolation.
   *
   * Per-replay failures are isolated: a replay that 404s, stalls, or
   * fails to parse is logged and skipped; only an all-fail batch
   * throws (the FIRST underlying error, preserving its type).
   *
   * @param replayIds - Replays to fetch.
   * @param options - Env / bounds / concurrency / join / retention and
   *   distinct-id maps.
   * @returns A `ReplayBundle` with `replays` in INPUT order (failed
   *   replays omitted).
   * @throws MixpanelHeadlessError - Only when every requested replay
   *   failed; the first underlying error propagates with its type.
   * @throws ParamValidationError - More than 5 `event_properties`.
   */
  async fetchReplays(
    replayIds: readonly string[],
    options: WorkspaceFetchReplaysOptions = {},
  ): Promise<ReplayBundle> {
    return replayMethods.fetchReplays(this.#replayHost(), replayIds, options);
  }

  /**
   * Discovery + fetch in one call (`replays_for_user`,
   * `workspace.py:11186-11249`).
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
   * @throws ParamValidationError - More than 5 `event_properties`.
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
   * timeline (`analyze_replay`, `workspace.py:11251-11273`).
   *
   * @param replayId - The replay to analyze.
   * @returns The markdown timeline (`Replay.summaryMarkdown()`).
   * @throws ReplayNotFoundError - First CDN file 404'd.
   * @throws SessionReplayAccessError - Sensitive-data flag set.
   */
  async analyzeReplay(replayId: string): Promise<string> {
    return replayMethods.analyzeReplay(this.#replayHost(), replayId);
  }
  // === B6 members land below in W1–W7 sections (append-only) ===

  // === B6-W1 lifecycle / workspace-management / me / business-context
  // members (W1 owns; append-only) ===

  /**
   * The resolved account of the current session (`account` property,
   * `workspace.py:530-533`).
   */
  get account(): Account {
    return this.#session.account;
  }

  /**
   * The resolved project of the current session (`project` property,
   * `workspace.py:535-538`).
   */
  get project(): Project {
    return this.#session.project;
  }

  /**
   * The resolved workspace, or `null` when scoping stays lazy
   * (`workspace` property, `workspace.py:540-543`).
   */
  get workspace(): WorkspaceRef | null {
    return this.#session.workspace ?? null;
  }

  /**
   * Direct access to the wire client — the escape hatch for endpoints
   * the facade does not cover (`api` property,
   * `workspace.py:4464-4501`).
   */
  get api(): MixpanelClient {
    return this.client;
  }

  /**
   * Get or create the `/me` service (`_me_svc`,
   * `workspace.py:865-885`).
   *
   * @returns The memoized service, scoped to the CURRENT account.
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
   * The `/me` service ONLY IF it has already been created — the
   * `self._me_service is None` peek `_cached_organization_id` performs
   * (`workspace.py:10355-10357`). Never constructs one.
   *
   * @internal
   */
  get meServiceIfCreated(): MeService | null {
    return this.#meService;
  }

  /**
   * List every public workspace of the current project
   * (`list_workspaces`, `workspace.py:801-824`).
   *
   * @returns The project's `PublicWorkspace` models.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   */
  async listWorkspaces(): Promise<PublicWorkspace[]> {
    return this.client.listWorkspaces();
  }

  /**
   * Resolve the workspace ID used for scoped requests
   * (`resolve_workspace_id`, `workspace.py:827-860`).
   *
   * @returns The resolved workspace ID.
   * @throws WorkspaceScopeError - No workspace resolvable.
   */
  async resolveWorkspaceId(): Promise<number> {
    return this.client.resolveWorkspaceId();
  }

  /**
   * Get the `/me` response for the current credentials (cached 24h by
   * the injected store) — `me`, `workspace.py:886-911`.
   *
   * @param options - `force_refresh` bypasses the caches.
   * @returns The `/me` response.
   * @throws ConfigError - Credentials lack `/me` access (401/403).
   * @throws QueryError - Any other API error.
   */
  async me(options: WorkspaceMeOptions = {}): Promise<MeResponse> {
    return this.meService.fetch({
      force_refresh: options.force_refresh ?? false,
    });
  }

  /**
   * List accessible projects via the `/me` API (FR-035; `projects`,
   * `workspace.py:913-956`).
   *
   * @param options - `refresh` bypasses the `/me` caches first.
   * @returns Projects sorted by name.
   * @throws ConfigError - Credentials lack `/me` access.
   * @example
   * ```typescript
   * for (const project of await ws.projects()) {
   *   await ws.use({ project: project.id });
   * }
   * ```
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
   * List a project's workspaces via the `/me` API (FR-036;
   * `workspaces`, `workspace.py:958-1003`).
   *
   * @param options - `project_id` (defaults to the current project)
   *   and `refresh`.
   * @returns Workspace references sorted by name.
   * @throws ConfigError - Credentials lack `/me` access, or a
   *   non-numeric `project_id`.
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
   * Stream events straight from the Export API (`stream_events`,
   * `workspace.py:1400-1467`) — the W1-D3 R6.6 veneer over the B4-C2
   * helper. PROJECT-scoped by design even when a workspace is pinned.
   *
   * @param options - Date window plus filters / `raw`.
   * @returns An async generator of event dicts.
   * @throws ParamValidationError - `WR2_LIMIT_TOO_SMALL` /
   *   `WR3_LIMIT_TOO_LARGE` (on the first pull).
   */
  async *streamEvents(
    options: StreamEventsOptions,
  ): AsyncGenerator<unknown, void, undefined> {
    yield* streamEventsVeneer(this.client, options);
  }

  /**
   * Stream user profiles straight from the Engage API
   * (`stream_profiles`, `workspace.py:1469-1578`) — the W1-D3 R6.6
   * veneer over the B4-C2 helper.
   *
   * @param options - Filters plus `raw`.
   * @returns An async generator of profile dicts.
   * @throws ParamValidationError - The mutually-exclusive-filter
   *   guards (on the first pull).
   */
  async *streamProfiles(
    options: StreamProfilesOptions = {},
  ): AsyncGenerator<unknown, void, undefined> {
    yield* streamProfilesVeneer(this.client, options);
  }

  /**
   * Read business context at the given scope
   * (`get_business_context`, `workspace.py:10405-10479`).
   *
   * @param options - `level` (default `"project"`) and an optional
   *   explicit `organization_id`.
   * @returns The populated context (`content: ""` when unset).
   * @throws ParamValidationError - `WS2_INVALID_LEVEL`.
   * @throws WorkspaceScopeError - `ORGANIZATION_AMBIGUOUS`.
   * @throws MixpanelHeadlessError - Response missing `content`.
   */
  async getBusinessContext(
    options: BusinessContextScopeOptions = {},
  ): Promise<BusinessContext> {
    return lifecycle.getBusinessContext(this.#businessContextHost(), options);
  }

  /**
   * Replace business context at the given scope
   * (`set_business_context`, `workspace.py:10481-10566`).
   *
   * @param content - New markdown content (empty string clears).
   * @param options - `level` / `organization_id`.
   * @returns The context echoed by the server.
   * @throws BusinessContextValidationError - Content over 50,000
   *   characters (no HTTP call is made).
   * @throws ParamValidationError - `WS2_INVALID_LEVEL`.
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
   * Clear business context at the given scope
   * (`clear_business_context`, `workspace.py:10568-10610`) — the
   * documented alias for `set_business_context("")`.
   *
   * @param options - `level` / `organization_id`.
   * @returns The cleared context.
   * @throws ParamValidationError - `WS2_INVALID_LEVEL`.
   */
  async clearBusinessContext(
    options: BusinessContextScopeOptions = {},
  ): Promise<BusinessContext> {
    return this.setBusinessContext("", options);
  }

  /**
   * Read organization and project business context together in ONE
   * request (`get_business_context_chain`,
   * `workspace.py:10612-10674`).
   *
   * @returns Both scopes; `organization.organization_id` stays `null`
   *   when the `/me` cache is cold (single-round-trip guarantee).
   * @throws MixpanelHeadlessError - Response missing `org_context` or
   *   `project_context`.
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

  // === B6-W2 dashboard members (W2 owns; append-only) ===

  /**
   * List dashboards for the current project/workspace
   * (`list_dashboards`, `workspace.py:4506-4536`).
   *
   * @param options - Optional `ids` filter.
   * @returns The `Dashboard` models, in response order.
   * @throws ResponseValidationError - Malformed API response payload
   *   (`RESPONSE_VALIDATION_ERROR`).
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   * @example
   * ```typescript
   * for (const d of await ws.listDashboards()) {
   *   console.log(`${d.title} (id=${String(d.id)})`);
   * }
   * ```
   */
  async listDashboards(
    options: WorkspaceListDashboardsOptions = {},
  ): Promise<Dashboard[]> {
    return dashboards.listDashboards(this.client, options);
  }

  /**
   * Create a new dashboard (`create_dashboard`,
   * `workspace.py:4538-4569`).
   *
   * @param params - Dashboard creation parameters.
   * @returns The newly created `Dashboard`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   */
  async createDashboard(params: CreateDashboardParams): Promise<Dashboard> {
    return dashboards.createDashboard(this.client, params);
  }

  /**
   * Get a single dashboard by ID (`get_dashboard`,
   * `workspace.py:4571-4600`).
   *
   * @param dashboardId - Dashboard identifier.
   * @returns The `Dashboard`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async getDashboard(dashboardId: number): Promise<Dashboard> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.getDashboard(this.client, dashboardId);
  }

  /**
   * Update an existing dashboard (`update_dashboard`,
   * `workspace.py:4602-4638`).
   *
   * @param dashboardId - Dashboard identifier.
   * @param params - Fields to update.
   * @returns The updated `Dashboard`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async updateDashboard(
    dashboardId: number,
    params: UpdateDashboardParams,
  ): Promise<Dashboard> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.updateDashboard(this.client, dashboardId, params);
  }

  /**
   * Delete a dashboard (`delete_dashboard`,
   * `workspace.py:4640-4659`).
   *
   * @param dashboardId - Dashboard identifier.
   * @returns Nothing.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async deleteDashboard(dashboardId: number): Promise<void> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.deleteDashboard(this.client, dashboardId);
  }

  /**
   * Delete multiple dashboards (`bulk_delete_dashboards`,
   * `workspace.py:4661-4680`).
   *
   * @param ids - Dashboard IDs to delete.
   * @returns Nothing.
   */
  async bulkDeleteDashboards(ids: readonly number[]): Promise<void> {
    return dashboards.bulkDeleteDashboards(this.client, ids);
  }

  /**
   * Favorite a dashboard (`favorite_dashboard`,
   * `workspace.py:4686-4705`).
   *
   * @param dashboardId - Dashboard identifier.
   * @returns Nothing.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async favoriteDashboard(dashboardId: number): Promise<void> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.favoriteDashboard(this.client, dashboardId);
  }

  /**
   * Unfavorite a dashboard (`unfavorite_dashboard`,
   * `workspace.py:4707-4726`).
   *
   * @param dashboardId - Dashboard identifier.
   * @returns Nothing.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async unfavoriteDashboard(dashboardId: number): Promise<void> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.unfavoriteDashboard(this.client, dashboardId);
  }

  /**
   * Pin a dashboard (`pin_dashboard`, `workspace.py:4728-4747`).
   *
   * @param dashboardId - Dashboard identifier.
   * @returns Nothing.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async pinDashboard(dashboardId: number): Promise<void> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.pinDashboard(this.client, dashboardId);
  }

  /**
   * Unpin a dashboard (`unpin_dashboard`,
   * `workspace.py:4749-4768`).
   *
   * @param dashboardId - Dashboard identifier.
   * @returns Nothing.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async unpinDashboard(dashboardId: number): Promise<void> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.unpinDashboard(this.client, dashboardId);
  }

  /**
   * Remove a report from a dashboard
   * (`remove_report_from_dashboard`, `workspace.py:4770-4800`).
   *
   * @param dashboardId - Dashboard identifier.
   * @param bookmarkId - Bookmark/report identifier to remove.
   * @returns The updated `Dashboard`.
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dashboardId` / `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
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
   * Add a report to a dashboard (`add_report_to_dashboard`,
   * `workspace.py:4802-4841`) — clones the bookmark onto the board.
   *
   * @param dashboardId - Dashboard identifier.
   * @param bookmarkId - Bookmark/report identifier to add.
   * @returns The updated `Dashboard`.
   * @throws MixpanelHeadlessError - Response is not a dashboard dict
   *   carrying `id` (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dashboardId` / `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
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
   * List available dashboard blueprint templates
   * (`list_blueprint_templates`, `workspace.py:4841-4869`).
   *
   * @param options - `include_reports` (default `false`).
   * @returns The `BlueprintTemplate` models.
   * @throws ResponseValidationError - Malformed payload.
   */
  async listBlueprintTemplates(
    options: WorkspaceListBlueprintTemplatesOptions = {},
  ): Promise<BlueprintTemplate[]> {
    return dashboards.listBlueprintTemplates(this.client, options);
  }

  /**
   * Create a dashboard from a blueprint template
   * (`create_blueprint`, `workspace.py:4871-4900`).
   *
   * @param templateType - Blueprint template type identifier.
   * @returns The newly created `Dashboard`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   */
  async createBlueprint(templateType: string): Promise<Dashboard> {
    return dashboards.createBlueprint(this.client, templateType);
  }

  /**
   * Get the blueprint configuration for a dashboard
   * (`get_blueprint_config`, `workspace.py:4902-4933`).
   *
   * @param dashboardId - Dashboard identifier.
   * @returns The `BlueprintConfig`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async getBlueprintConfig(dashboardId: number): Promise<BlueprintConfig> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.getBlueprintConfig(this.client, dashboardId);
  }

  /**
   * Update cohorts for blueprint configuration
   * (`update_blueprint_cohorts`, `workspace.py:4935-4954`).
   *
   * @param cohorts - Cohort configuration dicts.
   * @returns Nothing.
   */
  async updateBlueprintCohorts(
    cohorts: ReadonlyArray<Record<string, unknown>>,
  ): Promise<void> {
    return dashboards.updateBlueprintCohorts(this.client, cohorts);
  }

  /**
   * Finalize a blueprint dashboard with cards
   * (`finalize_blueprint`, `workspace.py:4956-4991`).
   *
   * @param params - Blueprint finalization parameters.
   * @returns The finalized `Dashboard`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   */
  async finalizeBlueprint(params: BlueprintFinishParams): Promise<Dashboard> {
    return dashboards.finalizeBlueprint(this.client, params);
  }

  /**
   * Create an RCA (Root Cause Analysis) dashboard
   * (`create_rca_dashboard`, `workspace.py:4993-5028`).
   *
   * @param params - RCA dashboard parameters.
   * @returns The newly created `Dashboard`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   */
  async createRcaDashboard(
    params: CreateRcaDashboardParams,
  ): Promise<Dashboard> {
    return dashboards.createRcaDashboard(this.client, params);
  }

  /**
   * Dashboard IDs containing a bookmark/report
   * (`get_bookmark_dashboard_ids`, `workspace.py:5030-5052`).
   *
   * @param bookmarkId - Bookmark identifier.
   * @returns The dashboard IDs.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async getBookmarkDashboardIds(bookmarkId: number): Promise<number[]> {
    requireEntityId("bookmark_id", bookmarkId);
    return dashboards.getBookmarkDashboardIds(this.client, bookmarkId);
  }

  /**
   * ERF data for a dashboard (`get_dashboard_erf`,
   * `workspace.py:5054-5076`).
   *
   * @param dashboardId - Dashboard identifier.
   * @returns The ERF metrics mapping.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dashboardId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async getDashboardErf(dashboardId: number): Promise<Record<string, unknown>> {
    requireEntityId("dashboard_id", dashboardId);
    return dashboards.getDashboardErf(this.client, dashboardId);
  }

  /**
   * Update a report link on a dashboard (`update_report_link`,
   * `workspace.py:5078-5110`).
   *
   * @param dashboardId - Dashboard identifier.
   * @param reportLinkId - Report link identifier.
   * @param params - Update parameters.
   * @returns Nothing.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dashboardId` / `reportLinkId`
   *   is not a positive integer (network-free guard, before any request).
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
   * Update a text card on a dashboard (`update_text_card`,
   * `workspace.py:5112-5145`).
   *
   * @param dashboardId - Dashboard identifier.
   * @param textCardId - Text card identifier.
   * @param params - Update parameters.
   * @returns Nothing.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dashboardId` / `textCardId`
   *   is not a positive integer (network-free guard, before any request).
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

  // === B6-W3 bookmark/report + cohort members (W3 owns; append-only) ===

  /**
   * List bookmarks/reports via the App API v2 endpoint
   * (`list_bookmarks_v2`, `workspace.py:5150-5183`).
   *
   * @param options - Optional `bookmark_type` / `ids` filters.
   * @returns The `Bookmark` models, in response order.
   * @throws ResponseValidationError - Malformed API response payload
   *   (`RESPONSE_VALIDATION_ERROR`).
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   * @example
   * ```typescript
   * for (const r of await ws.listBookmarksV2({ bookmark_type: "funnels" })) {
   *   console.log(`${r.name} (${r.bookmark_type})`);
   * }
   * ```
   */
  async listBookmarksV2(
    options: WorkspaceListBookmarksV2Options = {},
  ): Promise<Bookmark[]> {
    return bookmarksCohorts.listBookmarksV2(this.client, options);
  }

  /**
   * Create a new bookmark (saved report) (`create_bookmark`,
   * `workspace.py:5247-5324`).
   *
   * @param params - Bookmark creation parameters; `dashboard_id` is
   *   required by the Mixpanel v2 API.
   * @returns The newly created `Bookmark`.
   * @throws MixpanelHeadlessError - `dashboard_id` missing, or an empty
   *   response (`UNKNOWN_ERROR`).
   * @throws BookmarkValidationError - Client-side schema validation
   *   failed (raised before the API call).
   * @throws ResponseValidationError - Malformed payload.
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
   * Get a single bookmark by ID (`get_bookmark`,
   * `workspace.py:5326-5355`).
   *
   * @param bookmarkId - Bookmark identifier.
   * @returns The `Bookmark`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async getBookmark(bookmarkId: number): Promise<Bookmark> {
    requireEntityId("bookmark_id", bookmarkId);
    return bookmarksCohorts.getBookmark(this.client, bookmarkId);
  }

  /**
   * Update an existing bookmark (`update_bookmark`,
   * `workspace.py:5357-5414`).
   *
   * @param bookmarkId - Bookmark identifier.
   * @param params - Fields to update.
   * @returns The updated `Bookmark`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws BookmarkValidationError - Partial-mode schema validation
   *   failed (raised before the API call).
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
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
   * Delete a bookmark (`delete_bookmark`, `workspace.py:5416-5435`).
   *
   * @param bookmarkId - Bookmark identifier.
   * @returns Nothing.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async deleteBookmark(bookmarkId: number): Promise<void> {
    requireEntityId("bookmark_id", bookmarkId);
    return bookmarksCohorts.deleteBookmark(this.client, bookmarkId);
  }

  /**
   * Delete multiple bookmarks (`bulk_delete_bookmarks`,
   * `workspace.py:5437-5456`).
   *
   * @param ids - Bookmark IDs to delete.
   * @returns Nothing.
   */
  async bulkDeleteBookmarks(ids: readonly number[]): Promise<void> {
    return bookmarksCohorts.bulkDeleteBookmarks(this.client, ids);
  }

  /**
   * Update multiple bookmarks (`bulk_update_bookmarks`,
   * `workspace.py:5458-5479`).
   *
   * @param entries - Bookmark update entries.
   * @returns Nothing.
   */
  async bulkUpdateBookmarks(
    entries: readonly BulkUpdateBookmarkEntry[],
  ): Promise<void> {
    return bookmarksCohorts.bulkUpdateBookmarks(this.client, entries);
  }

  /**
   * Dashboard IDs linked to a bookmark
   * (`bookmark_linked_dashboard_ids`, `workspace.py:5481-5503`).
   *
   * @param bookmarkId - Bookmark identifier.
   * @returns The dashboard IDs.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async bookmarkLinkedDashboardIds(bookmarkId: number): Promise<number[]> {
    requireEntityId("bookmark_id", bookmarkId);
    return bookmarksCohorts.bookmarkLinkedDashboardIds(this.client, bookmarkId);
  }

  /**
   * Change history for a bookmark (`get_bookmark_history`,
   * `workspace.py:5505-5542`).
   *
   * @param bookmarkId - Bookmark identifier.
   * @param options - `cursor` / `page_size` (keyword-only in Python).
   * @returns The `BookmarkHistoryResponse`.
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
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
   * List cohorts via the App API, full detail (`list_cohorts_full`,
   * `workspace.py:5548-5584`).
   *
   * @param options - Optional `data_group_id` / `ids` filters.
   * @returns The `Cohort` models, in response order.
   * @throws ResponseValidationError - Malformed payload.
   */
  async listCohortsFull(
    options: WorkspaceListCohortsFullOptions = {},
  ): Promise<Cohort[]> {
    return bookmarksCohorts.listCohortsFull(this.client, options);
  }

  /**
   * Get a single cohort by ID (`get_cohort`,
   * `workspace.py:5586-5615`).
   *
   * @param cohortId - Cohort identifier.
   * @returns The `Cohort`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `cohortId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async getCohort(cohortId: number): Promise<Cohort> {
    requireEntityId("cohort_id", cohortId);
    return bookmarksCohorts.getCohort(this.client, cohortId);
  }

  /**
   * Create a new cohort (`create_cohort`, `workspace.py:5617-5648`).
   *
   * @param params - Cohort creation parameters.
   * @returns The newly created `Cohort`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   */
  async createCohort(params: CreateCohortParams): Promise<Cohort> {
    return bookmarksCohorts.createCohort(this.client, params);
  }

  /**
   * Update an existing cohort (`update_cohort`,
   * `workspace.py:5650-5682`).
   *
   * @param cohortId - Cohort identifier.
   * @param params - Fields to update.
   * @returns The updated `Cohort`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `cohortId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async updateCohort(
    cohortId: number,
    params: UpdateCohortParams,
  ): Promise<Cohort> {
    requireEntityId("cohort_id", cohortId);
    return bookmarksCohorts.updateCohort(this.client, cohortId, params);
  }

  /**
   * Delete a cohort (`delete_cohort`, `workspace.py:5684-5703`).
   *
   * @param cohortId - Cohort identifier.
   * @returns Nothing.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `cohortId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async deleteCohort(cohortId: number): Promise<void> {
    requireEntityId("cohort_id", cohortId);
    return bookmarksCohorts.deleteCohort(this.client, cohortId);
  }

  /**
   * Delete multiple cohorts (`bulk_delete_cohorts`,
   * `workspace.py:5705-5724`).
   *
   * @param ids - Cohort IDs to delete.
   * @returns Nothing.
   */
  async bulkDeleteCohorts(ids: readonly number[]): Promise<void> {
    return bookmarksCohorts.bulkDeleteCohorts(this.client, ids);
  }

  /**
   * Update multiple cohorts (`bulk_update_cohorts`,
   * `workspace.py:5726-5747`).
   *
   * @param entries - Cohort update entries.
   * @returns Nothing.
   */
  async bulkUpdateCohorts(
    entries: readonly BulkUpdateCohortEntry[],
  ): Promise<void> {
    return bookmarksCohorts.bulkUpdateCohorts(this.client, entries);
  }

  // === B6-W4 feature-flag + experiment members (W4 owns; append-only) ===

  /**
   * List feature flags for the current project/workspace
   * (`list_feature_flags`, `workspace.py:5753-5782`).
   *
   * @param options - `include_archived` (keyword-only in Python).
   * @returns The `FeatureFlag` models, in response order.
   * @throws ResponseValidationError - Malformed API response payload
   *   (`RESPONSE_VALIDATION_ERROR`).
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   * @example
   * ```typescript
   * for (const f of await ws.listFeatureFlags()) {
   *   console.log(`${f.name} (${f.key})`);
   * }
   * ```
   */
  async listFeatureFlags(
    options: WorkspaceListFeatureFlagsOptions = {},
  ): Promise<FeatureFlag[]> {
    return flagsExperiments.listFeatureFlags(this.client, options);
  }

  /**
   * Create a new feature flag (`create_feature_flag`,
   * `workspace.py:5784-5815`).
   *
   * @param params - Flag creation parameters.
   * @returns The newly created `FeatureFlag`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   * @example
   * ```typescript
   * const flag = await ws.createFeatureFlag(
   *   new CreateFeatureFlagParams({ name: "Dark Mode", key: "dark_mode" }),
   * );
   * ```
   */
  async createFeatureFlag(
    params: CreateFeatureFlagParams,
  ): Promise<FeatureFlag> {
    return flagsExperiments.createFeatureFlag(this.client, params);
  }

  /**
   * Get a single feature flag by ID (`get_feature_flag`,
   * `workspace.py:5817-5846`).
   *
   * @param flagId - Feature flag UUID.
   * @returns The `FeatureFlag`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   */
  async getFeatureFlag(flagId: string): Promise<FeatureFlag> {
    return flagsExperiments.getFeatureFlag(this.client, flagId);
  }

  /**
   * Update a feature flag, full replacement / PUT semantics
   * (`update_feature_flag`, `workspace.py:5848-5886`).
   *
   * @param flagId - Feature flag UUID.
   * @param params - Complete flag configuration.
   * @returns The updated `FeatureFlag`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   */
  async updateFeatureFlag(
    flagId: string,
    params: UpdateFeatureFlagParams,
  ): Promise<FeatureFlag> {
    return flagsExperiments.updateFeatureFlag(this.client, flagId, params);
  }

  /**
   * Delete a feature flag (`delete_feature_flag`,
   * `workspace.py:5888-5907`).
   *
   * @param flagId - Feature flag UUID.
   * @returns Nothing.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   */
  async deleteFeatureFlag(flagId: string): Promise<void> {
    return flagsExperiments.deleteFeatureFlag(this.client, flagId);
  }

  /**
   * Archive a feature flag, a soft delete (`archive_feature_flag`,
   * `workspace.py:5913-5932`).
   *
   * @param flagId - Feature flag UUID.
   * @returns Nothing.
   */
  async archiveFeatureFlag(flagId: string): Promise<void> {
    return flagsExperiments.archiveFeatureFlag(this.client, flagId);
  }

  /**
   * Restore an archived feature flag (`restore_feature_flag`,
   * `workspace.py:5934-5961`).
   *
   * @param flagId - Feature flag UUID.
   * @returns The restored `FeatureFlag`.
   * @throws ResponseValidationError - Malformed payload.
   */
  async restoreFeatureFlag(flagId: string): Promise<FeatureFlag> {
    return flagsExperiments.restoreFeatureFlag(this.client, flagId);
  }

  /**
   * Duplicate a feature flag (`duplicate_feature_flag`,
   * `workspace.py:5963-5991`).
   *
   * @param flagId - Feature flag UUID.
   * @returns The newly created duplicate `FeatureFlag`.
   * @throws ResponseValidationError - Malformed payload.
   */
  async duplicateFeatureFlag(flagId: string): Promise<FeatureFlag> {
    return flagsExperiments.duplicateFeatureFlag(this.client, flagId);
  }

  /**
   * Set test-user variant overrides for a feature flag
   * (`set_flag_test_users`, `workspace.py:5996-6019`).
   *
   * @param flagId - Feature flag UUID.
   * @param params - Test user mapping.
   * @returns Nothing.
   */
  async setFlagTestUsers(
    flagId: string,
    params: SetTestUsersParams,
  ): Promise<void> {
    return flagsExperiments.setFlagTestUsers(this.client, flagId, params);
  }

  /**
   * Get paginated change history for a feature flag
   * (`get_flag_history`, `workspace.py:6021-6063`).
   *
   * @param flagId - Feature flag UUID.
   * @param options - `page` / `page_size` (keyword-only in Python).
   * @returns The `FlagHistoryResponse` (events + count).
   * @throws ResponseValidationError - Malformed payload.
   */
  async getFlagHistory(
    flagId: string,
    options: WorkspaceGetFlagHistoryOptions = {},
  ): Promise<FlagHistoryResponse> {
    return flagsExperiments.getFlagHistory(this.client, flagId, options);
  }

  /**
   * Get account-level feature flag limits and usage
   * (`get_flag_limits`, `workspace.py:6065-6091`).
   *
   * @returns The `FlagLimitsResponse`.
   * @throws ResponseValidationError - Malformed payload.
   */
  async getFlagLimits(): Promise<FlagLimitsResponse> {
    return flagsExperiments.getFlagLimits(this.client);
  }

  /**
   * List experiments for the current project (`list_experiments`,
   * `workspace.py:6096-6123`).
   *
   * @param options - `include_archived` (keyword-only in Python).
   * @returns The `Experiment` models, in response order.
   * @throws ResponseValidationError - Malformed payload.
   */
  async listExperiments(
    options: WorkspaceListExperimentsOptions = {},
  ): Promise<Experiment[]> {
    return flagsExperiments.listExperiments(this.client, options);
  }

  /**
   * Create a new experiment in Draft status (`create_experiment`,
   * `workspace.py:6125-6156`).
   *
   * @param params - Experiment creation parameters.
   * @returns The newly created `Experiment`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   */
  async createExperiment(params: CreateExperimentParams): Promise<Experiment> {
    return flagsExperiments.createExperiment(this.client, params);
  }

  /**
   * Get a single experiment by ID (`get_experiment`,
   * `workspace.py:6158-6187`).
   *
   * @param experimentId - Experiment UUID.
   * @returns The `Experiment`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   */
  async getExperiment(experimentId: string): Promise<Experiment> {
    return flagsExperiments.getExperiment(this.client, experimentId);
  }

  /**
   * Update an experiment, PATCH semantics (`update_experiment`,
   * `workspace.py:6189-6225`).
   *
   * @param experimentId - Experiment UUID.
   * @param params - Fields to update.
   * @returns The updated `Experiment`.
   * @throws MixpanelHeadlessError - Empty response (`UNKNOWN_ERROR`).
   * @throws ResponseValidationError - Malformed payload.
   */
  async updateExperiment(
    experimentId: string,
    params: UpdateExperimentParams,
  ): Promise<Experiment> {
    return flagsExperiments.updateExperiment(this.client, experimentId, params);
  }

  /**
   * Delete an experiment (`delete_experiment`,
   * `workspace.py:6227-6246`).
   *
   * @param experimentId - Experiment UUID.
   * @returns Nothing.
   */
  async deleteExperiment(experimentId: string): Promise<void> {
    return flagsExperiments.deleteExperiment(this.client, experimentId);
  }

  /**
   * Launch an experiment, Draft → Active (`launch_experiment`,
   * `workspace.py:6252-6277`).
   *
   * @param experimentId - Experiment UUID.
   * @returns The launched `Experiment` with updated status.
   * @throws ResponseValidationError - Malformed payload.
   */
  async launchExperiment(experimentId: string): Promise<Experiment> {
    return flagsExperiments.launchExperiment(this.client, experimentId);
  }

  /**
   * Conclude an experiment, Active → Concluded
   * (`conclude_experiment`, `workspace.py:6279-6302`) — always sends a
   * JSON body, `{}` when no params are supplied.
   *
   * @param experimentId - Experiment UUID.
   * @param options - `params` (keyword-only in Python).
   * @returns The concluded `Experiment`.
   * @throws ResponseValidationError - Malformed payload.
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
   * Record the experiment decision, Concluded → Success/Fail
   * (`decide_experiment`, `workspace.py:6304-6337`).
   *
   * @param experimentId - Experiment UUID.
   * @param params - Decision parameters (success, variant, message).
   * @returns The decided `Experiment` with terminal status.
   * @throws ResponseValidationError - Malformed payload.
   */
  async decideExperiment(
    experimentId: string,
    params: ExperimentDecideParams,
  ): Promise<Experiment> {
    return flagsExperiments.decideExperiment(this.client, experimentId, params);
  }

  /**
   * Archive an experiment (`archive_experiment`,
   * `workspace.py:6354-6373`).
   *
   * @param experimentId - Experiment UUID.
   * @returns Nothing.
   */
  async archiveExperiment(experimentId: string): Promise<void> {
    return flagsExperiments.archiveExperiment(this.client, experimentId);
  }

  /**
   * Restore an archived experiment (`restore_experiment`,
   * `workspace.py:6375-6400`).
   *
   * @param experimentId - Experiment UUID.
   * @returns The restored `Experiment`.
   * @throws ResponseValidationError - Malformed payload.
   */
  async restoreExperiment(experimentId: string): Promise<Experiment> {
    return flagsExperiments.restoreExperiment(this.client, experimentId);
  }

  /**
   * Duplicate an experiment (`duplicate_experiment`,
   * `workspace.py:6402-6439`) — `params` is required because the
   * Mixpanel API returns an empty body when duplicating without a name.
   *
   * @param experimentId - Experiment UUID.
   * @param params - Duplication parameters (`name` is required).
   * @returns The newly created duplicate `Experiment`.
   * @throws ResponseValidationError - Malformed payload.
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
   * List experiments in ERF (Experiment Results Framework) format
   * (`list_erf_experiments`, `workspace.py:6441-6461`).
   *
   * @returns The ERF experiment dicts, verbatim.
   */
  async listErfExperiments(): Promise<Array<Record<string, unknown>>> {
    return flagsExperiments.listErfExperiments(this.client);
  }

  // === B6-W5 annotation + webhook + alert members (W5 owns; append-only) ===

  /**
   * List timeline annotations for the project (`list_annotations`,
   * `workspace.py:6466-6505`).
   *
   * @param options - `from_date` / `to_date` / `tags` (keyword-only in
   *   Python). Dates are ISO `YYYY-MM-DD` STRINGS end-to-end.
   * @returns The `Annotation` models, in response order.
   * @throws ResponseValidationError - Malformed API response payload
   *   (`RESPONSE_VALIDATION_ERROR`).
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   * @example
   * ```typescript
   * for (const ann of await ws.listAnnotations({ from_date: "2026-01-01" })) {
   *   console.log(`${ann.date}: ${ann.description}`);
   * }
   * ```
   */
  async listAnnotations(
    options: WorkspaceListAnnotationsOptions = {},
  ): Promise<Annotation[]> {
    return annotationsWebhooksAlerts.listAnnotations(this.client, options);
  }

  /**
   * Create a new timeline annotation (`create_annotation`,
   * `workspace.py:6507-6537`).
   *
   * @param params - Annotation creation parameters (date, description
   *   required).
   * @returns The created `Annotation`.
   * @throws ResponseValidationError - Malformed payload.
   * @example
   * ```typescript
   * const ann = await ws.createAnnotation(
   *   new CreateAnnotationParams({
   *     date: "2026-03-31",
   *     description: "v2.5 release",
   *   }),
   * );
   * ```
   */
  async createAnnotation(params: CreateAnnotationParams): Promise<Annotation> {
    return annotationsWebhooksAlerts.createAnnotation(this.client, params);
  }

  /**
   * Get a single annotation by ID (`get_annotation`,
   * `workspace.py:6539-6565`).
   *
   * @param annotationId - Annotation ID.
   * @returns The `Annotation`.
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `annotationId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async getAnnotation(annotationId: number): Promise<Annotation> {
    requireEntityId("annotation_id", annotationId);
    return annotationsWebhooksAlerts.getAnnotation(this.client, annotationId);
  }

  /**
   * Update an annotation, PATCH semantics (`update_annotation`,
   * `workspace.py:6567-6598`).
   *
   * @param annotationId - Annotation ID.
   * @param params - Fields to update (description, tags).
   * @returns The updated `Annotation`.
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `annotationId`
   *   is not a positive integer (network-free guard, before any request).
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
   * Delete an annotation (`delete_annotation`,
   * `workspace.py:6600-6619`).
   *
   * @param annotationId - Annotation ID.
   * @returns Nothing.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `annotationId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async deleteAnnotation(annotationId: number): Promise<void> {
    requireEntityId("annotation_id", annotationId);
    return annotationsWebhooksAlerts.deleteAnnotation(
      this.client,
      annotationId,
    );
  }

  /**
   * List annotation tags for the project (`list_annotation_tags`,
   * `workspace.py:6621-6647`).
   *
   * @returns The `AnnotationTag` models, in response order.
   * @throws ResponseValidationError - Malformed payload.
   */
  async listAnnotationTags(): Promise<AnnotationTag[]> {
    return annotationsWebhooksAlerts.listAnnotationTags(this.client);
  }

  /**
   * Create a new annotation tag (`create_annotation_tag`,
   * `workspace.py:6649-6679`).
   *
   * @param params - Tag creation parameters (name required).
   * @returns The created `AnnotationTag`.
   * @throws ResponseValidationError - Malformed payload.
   */
  async createAnnotationTag(
    params: CreateAnnotationTagParams,
  ): Promise<AnnotationTag> {
    return annotationsWebhooksAlerts.createAnnotationTag(this.client, params);
  }

  /**
   * List all webhooks for the current project (`list_webhooks`,
   * `workspace.py:6685-6711`).
   *
   * @returns The `ProjectWebhook` models, in response order.
   * @throws ResponseValidationError - Malformed payload.
   * @example
   * ```typescript
   * for (const wh of await ws.listWebhooks()) {
   *   console.log(`${wh.name} -> ${wh.url}`);
   * }
   * ```
   */
  async listWebhooks(): Promise<ProjectWebhook[]> {
    return annotationsWebhooksAlerts.listWebhooks(this.client);
  }

  /**
   * Create a new webhook (`create_webhook`,
   * `workspace.py:6713-6744`).
   *
   * @param params - Webhook creation parameters.
   * @returns The `WebhookMutationResult` (new webhook id + name).
   * @throws ResponseValidationError - Malformed payload.
   */
  async createWebhook(
    params: CreateWebhookParams,
  ): Promise<WebhookMutationResult> {
    return annotationsWebhooksAlerts.createWebhook(this.client, params);
  }

  /**
   * Update an existing webhook, PATCH semantics (`update_webhook`,
   * `workspace.py:6746-6780`).
   *
   * @param webhookId - Webhook UUID string.
   * @param params - Fields to update.
   * @returns The `WebhookMutationResult` (updated id + name).
   * @throws ResponseValidationError - Malformed payload.
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
   * Delete a webhook (`delete_webhook`, `workspace.py:6782-6801`).
   *
   * @param webhookId - Webhook UUID string.
   * @returns Nothing.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   */
  async deleteWebhook(webhookId: string): Promise<void> {
    return annotationsWebhooksAlerts.deleteWebhook(this.client, webhookId);
  }

  /**
   * Test webhook connectivity (`test_webhook`,
   * `workspace.py:6803-6833`).
   *
   * @param params - Webhook test parameters (`url` required).
   * @returns The `WebhookTestResult` (success, status_code, message).
   * @throws ResponseValidationError - Malformed payload.
   */
  async testWebhook(params: WebhookTestParams): Promise<WebhookTestResult> {
    return annotationsWebhooksAlerts.testWebhook(this.client, params);
  }

  /**
   * List custom alerts for the current project (`list_alerts`,
   * `workspace.py:6839-6874`).
   *
   * @param options - `bookmark_id` / `skip_user_filter` (keyword-only
   *   in Python).
   * @returns The `CustomAlert` models, in response order.
   * @throws ResponseValidationError - Malformed payload.
   * @example
   * ```typescript
   * for (const alert of await ws.listAlerts()) {
   *   console.log(`${alert.name} (paused=${alert.paused})`);
   * }
   * ```
   */
  async listAlerts(
    options: WorkspaceListAlertsOptions = {},
  ): Promise<CustomAlert[]> {
    return annotationsWebhooksAlerts.listAlerts(this.client, options);
  }

  /**
   * Create a new custom alert (`create_alert`,
   * `workspace.py:6876-6912`).
   *
   * @param params - Alert creation parameters.
   * @returns The created `CustomAlert`.
   * @throws ResponseValidationError - Malformed payload.
   */
  async createAlert(params: CreateAlertParams): Promise<CustomAlert> {
    return annotationsWebhooksAlerts.createAlert(this.client, params);
  }

  /**
   * Get a single custom alert by ID (`get_alert`,
   * `workspace.py:6914-6940`).
   *
   * @param alertId - Alert ID (integer).
   * @returns The `CustomAlert`.
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `alertId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async getAlert(alertId: number): Promise<CustomAlert> {
    requireEntityId("alert_id", alertId);
    return annotationsWebhooksAlerts.getAlert(this.client, alertId);
  }

  /**
   * Update a custom alert, PATCH semantics (`update_alert`,
   * `workspace.py:6942-6971`).
   *
   * @param alertId - Alert ID (integer).
   * @param params - Fields to update.
   * @returns The updated `CustomAlert`.
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `alertId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async updateAlert(
    alertId: number,
    params: UpdateAlertParams,
  ): Promise<CustomAlert> {
    requireEntityId("alert_id", alertId);
    return annotationsWebhooksAlerts.updateAlert(this.client, alertId, params);
  }

  /**
   * Delete a custom alert (`delete_alert`,
   * `workspace.py:6973-6992`).
   *
   * @param alertId - Alert ID (integer).
   * @returns Nothing.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `alertId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async deleteAlert(alertId: number): Promise<void> {
    requireEntityId("alert_id", alertId);
    return annotationsWebhooksAlerts.deleteAlert(this.client, alertId);
  }

  /**
   * Bulk-delete custom alerts (`bulk_delete_alerts`,
   * `workspace.py:6994-7013`).
   *
   * @param ids - Alert IDs to delete.
   * @returns Nothing.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   */
  async bulkDeleteAlerts(ids: readonly number[]): Promise<void> {
    return annotationsWebhooksAlerts.bulkDeleteAlerts(this.client, ids);
  }

  /**
   * Get the project's alert count against its limit
   * (`get_alert_count`, `workspace.py:7015-7042`).
   *
   * @param options - `alert_type` (keyword-only in Python).
   * @returns The `AlertCount`.
   * @throws ResponseValidationError - Malformed payload.
   */
  async getAlertCount(
    options: WorkspaceGetAlertCountOptions = {},
  ): Promise<AlertCount> {
    return annotationsWebhooksAlerts.getAlertCount(this.client, options);
  }

  /**
   * Get paginated alert trigger history (`get_alert_history`,
   * `workspace.py:7044-7088`).
   *
   * @param alertId - Alert ID (integer).
   * @param options - `page_size` / `next_cursor` / `previous_cursor`
   *   (keyword-only in Python).
   * @returns The `AlertHistoryResponse`.
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `alertId`
   *   is not a positive integer (network-free guard, before any request).
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
   * Send a test alert notification (`test_alert`,
   * `workspace.py:7090-7119`) — the payload is returned VERBATIM;
   * Python performs no model validation.
   *
   * @param params - Alert parameters for the test (same shape as
   *   create).
   * @returns The opaque result record.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   */
  async testAlert(params: CreateAlertParams): Promise<Record<string, unknown>> {
    return annotationsWebhooksAlerts.testAlert(this.client, params);
  }

  /**
   * Get a signed URL for an alert screenshot
   * (`get_alert_screenshot_url`, `workspace.py:7121-7149`).
   *
   * @param gcsKey - GCS object key from the alert payload.
   * @returns The `AlertScreenshotResponse`.
   * @throws ResponseValidationError - Malformed payload.
   */
  async getAlertScreenshotUrl(
    gcsKey: string,
  ): Promise<AlertScreenshotResponse> {
    return annotationsWebhooksAlerts.getAlertScreenshotUrl(this.client, gcsKey);
  }

  /**
   * Validate alerts against a bookmark definition
   * (`validate_alerts_for_bookmark`, `workspace.py:7151-7196`).
   *
   * @param params - Alert IDs plus the bookmark type and params.
   * @returns The `ValidateAlertsForBookmarkResponse`.
   * @throws ResponseValidationError - Malformed payload.
   */
  async validateAlertsForBookmark(
    params: ValidateAlertsForBookmarkParams,
  ): Promise<ValidateAlertsForBookmarkResponse> {
    return annotationsWebhooksAlerts.validateAlertsForBookmark(
      this.client,
      params,
    );
  }

  // === B6-W6 lexicon + tracking/history members (W6 owns; append-only) ===

  /**
   * Get event definitions from Lexicon by name
   * (`get_event_definitions`, `workspace.py:7201-7233`).
   *
   * @param options - `names` (keyword-only and REQUIRED in Python).
   * @returns The `EventDefinition` models, in response order.
   * @throws ResponseValidationError - Malformed API response payload
   *   (`RESPONSE_VALIDATION_ERROR`).
   * @throws AuthenticationError | QueryError | ServerError - Wire
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
   */
  async getEventDefinitions(
    options: WorkspaceGetEventDefinitionsOptions,
  ): Promise<EventDefinition[]> {
    return lexiconTracking.getEventDefinitions(this.client, options);
  }

  /**
   * Update an event definition in Lexicon
   * (`update_event_definition`, `workspace.py:7235-7270`).
   *
   * @param eventName - Name of the event to update.
   * @param params - Fields to update (hidden, dropped, merged,
   *   verified, tags, display_name, description).
   * @returns The updated `EventDefinition`.
   * @throws ResponseValidationError - Malformed payload.
   * @example
   * ```typescript
   * const definition = await ws.updateEventDefinition(
   *   "Signup",
   *   new UpdateEventDefinitionParams({ description: "User signed up" }),
   * );
   * ```
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
   * Delete an event definition from Lexicon
   * (`delete_event_definition`, `workspace.py:7272-7291`).
   *
   * @param eventName - Name of the event to delete.
   * @returns Nothing.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   */
  async deleteEventDefinition(eventName: string): Promise<void> {
    return lexiconTracking.deleteEventDefinition(this.client, eventName);
  }

  /**
   * Bulk-update event definitions in Lexicon
   * (`bulk_update_event_definitions`, `workspace.py:7293-7329`).
   *
   * @param params - Bulk update parameters (a list of event updates:
   *   name + fields to change).
   * @returns The updated `EventDefinition` models, in response order.
   * @throws ResponseValidationError - Malformed payload.
   */
  async bulkUpdateEventDefinitions(
    params: BulkUpdateEventsParams,
  ): Promise<EventDefinition[]> {
    return lexiconTracking.bulkUpdateEventDefinitions(this.client, params);
  }

  /**
   * Get property definitions from Lexicon by name
   * (`get_property_definitions`, `workspace.py:7331-7373`).
   *
   * @param options - `names` (REQUIRED) plus the optional
   *   `resource_type` filter, both keyword-only in Python.
   * @returns The `PropertyDefinition` models, in response order.
   * @throws ResponseValidationError - Malformed payload.
   * @example
   * ```typescript
   * const defs = await ws.getPropertyDefinitions({
   *   names: ["plan_type", "country"],
   *   resource_type: "event",
   * });
   * ```
   */
  async getPropertyDefinitions(
    options: WorkspaceGetPropertyDefinitionsOptions,
  ): Promise<PropertyDefinition[]> {
    return lexiconTracking.getPropertyDefinitions(this.client, options);
  }

  /**
   * Update a property definition in Lexicon
   * (`update_property_definition`, `workspace.py:7375-7410`).
   *
   * @param propertyName - Name of the property to update.
   * @param params - Fields to update (hidden, dropped, merged,
   *   sensitive, display_name, description, example_value,
   *   resource_type).
   * @returns The updated `PropertyDefinition`.
   * @throws ResponseValidationError - Malformed payload.
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
   * Bulk-update property definitions in Lexicon
   * (`bulk_update_property_definitions`,
   * `workspace.py:7412-7456`).
   *
   * @param params - Bulk update parameters (a list of property
   *   updates: name + fields to change).
   * @returns The updated `PropertyDefinition` models, in response
   *   order.
   * @throws ResponseValidationError - Malformed payload.
   */
  async bulkUpdatePropertyDefinitions(
    params: BulkUpdatePropertiesParams,
  ): Promise<PropertyDefinition[]> {
    return lexiconTracking.bulkUpdatePropertyDefinitions(this.client, params);
  }

  /**
   * List all Lexicon tags (`list_lexicon_tags`,
   * `workspace.py:7460-7500`).
   *
   * The list endpoint may return plain tag-name strings without IDs;
   * those entries come back with `id` set to the `0` sentinel. Do NOT
   * pass that sentinel to {@link updateLexiconTag} — use name-based
   * operations (e.g. {@link deleteLexiconTag}) for such tags.
   *
   * @returns The `LexiconTag` models, in response order.
   * @throws ResponseValidationError - Malformed payload.
   */
  async listLexiconTags(): Promise<LexiconTag[]> {
    return lexiconTracking.listLexiconTags(this.client);
  }

  /**
   * Create a new Lexicon tag (`create_lexicon_tag`,
   * `workspace.py:7502-7528`).
   *
   * @param params - Tag creation parameters (name required).
   * @returns The created `LexiconTag`.
   * @throws ResponseValidationError - Malformed payload.
   */
  async createLexiconTag(params: CreateTagParams): Promise<LexiconTag> {
    return lexiconTracking.createLexiconTag(this.client, params);
  }

  /**
   * Update a Lexicon tag (`update_lexicon_tag`,
   * `workspace.py:7530-7559`).
   *
   * @param tagId - Tag ID (integer).
   * @param params - Fields to update (e.g. name).
   * @returns The updated `LexiconTag`.
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `tagId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async updateLexiconTag(
    tagId: number,
    params: UpdateTagParams,
  ): Promise<LexiconTag> {
    requireEntityId("tag_id", tagId);
    return lexiconTracking.updateLexiconTag(this.client, tagId, params);
  }

  /**
   * Delete a Lexicon tag BY NAME (`delete_lexicon_tag`,
   * `workspace.py:7561-7580`).
   *
   * @param tagName - Name of the tag to delete.
   * @returns Nothing.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   */
  async deleteLexiconTag(tagName: string): Promise<void> {
    return lexiconTracking.deleteLexiconTag(this.client, tagName);
  }

  /**
   * Get tracking metadata for an event (`get_tracking_metadata`,
   * `workspace.py:8530-8556`) — the raw record, unvalidated.
   *
   * @param eventName - Name of the event.
   * @returns The opaque tracking-metadata record.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   */
  async getTrackingMetadata(
    eventName: string,
  ): Promise<Record<string, unknown>> {
    return lexiconTracking.getTrackingMetadata(this.client, eventName);
  }

  /**
   * Get change history for an event definition
   * (`get_event_history`, `workspace.py:8558-8583`) — raw records,
   * unvalidated.
   *
   * @param eventName - Name of the event.
   * @returns The history entries, in response order.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   */
  async getEventHistory(
    eventName: string,
  ): Promise<Array<Record<string, unknown>>> {
    return lexiconTracking.getEventHistory(this.client, eventName);
  }

  /**
   * Get change history for a property definition
   * (`get_property_history`, `workspace.py:8585-8614`) — raw records,
   * unvalidated.
   *
   * @param propertyName - Name of the property.
   * @param entityType - Entity type ("event", "user", "group", ...).
   * @returns The history entries, in response order.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
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
   * Export Lexicon data definitions (`export_lexicon`,
   * `workspace.py:8618-8648`) — the raw record, unvalidated.
   *
   * @param options - `export_types` (keyword-only in Python; omit to
   *   let the client apply its default two-entry list).
   * @returns The opaque export record.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   * @example
   * ```typescript
   * const exported = await ws.exportLexicon({
   *   export_types: ["All Events and Properties"],
   * });
   * ```
   */
  async exportLexicon(
    options: WorkspaceExportLexiconOptions = {},
  ): Promise<Record<string, unknown>> {
    return lexiconTracking.exportLexicon(this.client, options);
  }

  // === B6-W7 drop-filter / custom-property / lookup-table /
  // custom-event members (W7 owns; append-only) ===

  /**
   * The W7-D1/W7-D2 seam bag handed to
   * {@link Workspace.uploadLookupTable} — the injected `readFile` and
   * `monotonic` plus the client's OWN sleep seam (R6.3/R10.8: the
   * facade never builds a second timer).
   *
   * @returns The seams.
   * @internal
   */
  get #lookupUploadSeams(): LookupUploadSeams {
    return {
      readFile: this.#readFile,
      monotonic: this.#monotonic,
      sleep: this.client.core.sleep,
    };
  }

  /**
   * List all drop filters (`list_drop_filters`,
   * `workspace.py:7586-7611`).
   *
   * @returns The `DropFilter` models, in response order.
   * @throws ResponseValidationError - Malformed API response payload
   *   (`RESPONSE_VALIDATION_ERROR`).
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   * @example
   * ```typescript
   * for (const filter of await ws.listDropFilters()) {
   *   console.log(`${filter.event_name}: active=${String(filter.active)}`);
   * }
   * ```
   */
  async listDropFilters(): Promise<DropFilter[]> {
    return governanceData.listDropFilters(this.client);
  }

  /**
   * Create a new drop filter (`create_drop_filter`,
   * `workspace.py:7613-7646`).
   *
   * @param params - Drop filter creation parameters.
   * @returns The FULL list of `DropFilter` models after creation.
   * @throws ResponseValidationError - Malformed payload.
   * @example
   * ```typescript
   * const filters = await ws.createDropFilter(
   *   new CreateDropFilterParams({
   *     event_name: "Debug Event",
   *     filters: { property: "env", value: "test" },
   *   }),
   * );
   * ```
   */
  async createDropFilter(
    params: CreateDropFilterParams,
  ): Promise<DropFilter[]> {
    return governanceData.createDropFilter(this.client, params);
  }

  /**
   * Update a drop filter (`update_drop_filter`,
   * `workspace.py:7648-7680`).
   *
   * @param params - Update parameters (must include the filter ID).
   * @returns The FULL list of `DropFilter` models after the update.
   * @throws ResponseValidationError - Malformed payload.
   */
  async updateDropFilter(
    params: UpdateDropFilterParams,
  ): Promise<DropFilter[]> {
    return governanceData.updateDropFilter(this.client, params);
  }

  /**
   * Delete a drop filter (`delete_drop_filter`,
   * `workspace.py:7682-7709`).
   *
   * @param dropFilterId - Drop filter ID (integer).
   * @returns The FULL list of remaining `DropFilter` models.
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dropFilterId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async deleteDropFilter(dropFilterId: number): Promise<DropFilter[]> {
    requireEntityId("drop_filter_id", dropFilterId);
    return governanceData.deleteDropFilter(this.client, dropFilterId);
  }

  /**
   * Get drop filter usage limits (`get_drop_filter_limits`,
   * `workspace.py:7711-7736`).
   *
   * @returns The `DropFilterLimitsResponse`.
   * @throws ResponseValidationError - Malformed payload.
   */
  async getDropFilterLimits(): Promise<DropFilterLimitsResponse> {
    return governanceData.getDropFilterLimits(this.client);
  }

  /**
   * List all custom properties (`list_custom_properties`,
   * `workspace.py:7742-7789`).
   *
   * A 400 whose body names `displayFormula` means the project holds a
   * corrupt custom property; that case is re-raised as a `QueryError`
   * with an actionable message pointing at
   * {@link Workspace.getCustomProperty}.
   *
   * @returns The `CustomProperty` models, in response order.
   * @throws QueryError - Server-side data corruption, or any other
   *   query failure, propagated verbatim.
   * @throws ResponseValidationError - Malformed payload.
   */
  async listCustomProperties(): Promise<CustomProperty[]> {
    return governanceData.listCustomProperties(this.client);
  }

  /**
   * Create a new custom property (`create_custom_property`,
   * `workspace.py:7791-7829`).
   *
   * @param params - Creation parameters (`name`, `resource_type` and
   *   one of `display_formula` / `behavior` are required).
   * @returns The created `CustomProperty`.
   * @throws ResponseValidationError - Malformed payload.
   */
  async createCustomProperty(
    params: CreateCustomPropertyParams,
  ): Promise<CustomProperty> {
    return governanceData.createCustomProperty(this.client, params);
  }

  /**
   * Get a custom property by ID (`get_custom_property`,
   * `workspace.py:7831-7859`).
   *
   * @param propertyId - Custom property ID (string).
   * @returns The `CustomProperty`.
   * @throws ResponseValidationError - Malformed payload.
   */
  async getCustomProperty(propertyId: string): Promise<CustomProperty> {
    return governanceData.getCustomProperty(this.client, propertyId);
  }

  /**
   * Update a custom property (`update_custom_property`,
   * `workspace.py:7861-7895`).
   *
   * @param propertyId - Custom property ID (string).
   * @param params - Fields to update.
   * @returns The updated `CustomProperty`.
   * @throws ResponseValidationError - Malformed payload.
   */
  async updateCustomProperty(
    propertyId: string,
    params: UpdateCustomPropertyParams,
  ): Promise<CustomProperty> {
    return governanceData.updateCustomProperty(this.client, propertyId, params);
  }

  /**
   * Delete a custom property (`delete_custom_property`,
   * `workspace.py:7897-7916`).
   *
   * @param propertyId - Custom property ID (string).
   * @returns Nothing.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   */
  async deleteCustomProperty(propertyId: string): Promise<void> {
    return governanceData.deleteCustomProperty(this.client, propertyId);
  }

  /**
   * Validate a custom property definition without creating it
   * (`validate_custom_property`, `workspace.py:7918-7951`).
   *
   * @param params - Parameters to validate.
   * @returns The raw validation result.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   */
  async validateCustomProperty(
    params: CreateCustomPropertyParams,
  ): Promise<Record<string, unknown>> {
    return governanceData.validateCustomProperty(this.client, params);
  }

  /**
   * List lookup tables (`list_lookup_tables`,
   * `workspace.py:7957-7987`).
   *
   * @param options - Optional `data_group_id` filter (keyword-only in
   *   Python).
   * @returns The `LookupTable` models, in response order.
   * @throws ResponseValidationError - Malformed payload.
   * @example
   * ```typescript
   * const tables = await ws.listLookupTables({ data_group_id: 5 });
   * ```
   */
  async listLookupTables(
    options: WorkspaceListLookupTablesOptions = {},
  ): Promise<LookupTable[]> {
    return governanceData.listLookupTables(this.client, options);
  }

  /**
   * Upload a CSV file as a new lookup table (`upload_lookup_table`,
   * `workspace.py:7989-8075`) — signed URL → upload → register, then
   * (for payloads the API processes asynchronously) poll until the
   * task completes.
   *
   * The CSV bytes come from the injected
   * {@link WorkspaceOptions.readFile} seam (W7-D1) since
   * `packages/core` never touches a filesystem; the poll deadline uses
   * {@link WorkspaceOptions.monotonic} and the client's sleep seam
   * (W7-D2).
   *
   * @param params - Upload parameters (`name`, `file_path`, optional
   *   `data_group_id`).
   * @param options - `poll_interval` / `max_poll_seconds`, both in
   *   SECONDS under their Python names (defaults `2.0` / `300.0`).
   * @returns The created `LookupTable`.
   * @throws MixpanelHeadlessError - `UNPORTED_FILE_READ_SEAM` when no
   *   `readFile` seam is injected; `UPLOAD_FAILED` /
   *   `UPLOAD_NOT_FOUND` / `UPLOAD_TIMEOUT` / `INVALID_RESPONSE` from
   *   the async poll.
   * @throws ResponseValidationError - Malformed payload.
   * @example
   * ```typescript
   * const table = await ws.uploadLookupTable(
   *   new UploadLookupTableParams({
   *     name: "Country Codes",
   *     file_path: "/path/to/countries.csv",
   *   }),
   * );
   * ```
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
   * Mark a lookup table as ready after upload
   * (`mark_lookup_table_ready`, `workspace.py:8146-8188`).
   *
   * @param params - Parameters (`name`, `key`, optional
   *   `data_group_id`).
   * @returns The updated `LookupTable`.
   * @throws ResponseValidationError - Malformed payload.
   */
  async markLookupTableReady(
    params: MarkLookupTableReadyParams,
  ): Promise<LookupTable> {
    return governanceData.markLookupTableReady(this.client, params);
  }

  /**
   * Get a signed URL for uploading lookup table data
   * (`get_lookup_upload_url`, `workspace.py:8190-8220`).
   *
   * @param contentType - MIME type of the file to upload (positional
   *   in Python; default `"text/csv"`).
   * @returns The `LookupTableUploadUrl` (url / path / key).
   * @throws ResponseValidationError - Malformed payload.
   */
  async getLookupUploadUrl(
    contentType = "text/csv",
  ): Promise<LookupTableUploadUrl> {
    return governanceData.getLookupUploadUrl(this.client, contentType);
  }

  /**
   * Get the processing status of a lookup table upload
   * (`get_lookup_upload_status`, `workspace.py:8222-8245`) — the raw
   * record, unvalidated.
   *
   * @param uploadId - Upload ID returned from the upload process.
   * @returns The opaque status record.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   */
  async getLookupUploadStatus(
    uploadId: string,
  ): Promise<Record<string, unknown>> {
    return governanceData.getLookupUploadStatus(this.client, uploadId);
  }

  /**
   * Update a lookup table (`update_lookup_table`,
   * `workspace.py:8247-8279`).
   *
   * @param dataGroupId - Data group ID of the lookup table — a signed
   *   int64: a `number` when it is a safe integer, a `bigint` beyond
   *   2^53 (Mixpanel assigns ids such as `-8644926364725811123n`). The
   *   id is sent in the JSON body as an exact integer token.
   * @param params - Fields to update.
   * @returns The updated `LookupTable`.
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dataGroupId`
   *   is not a non-zero integer, or is a `number` beyond
   *   `Number.MAX_SAFE_INTEGER` (already rounded — pass a `bigint`);
   *   network-free guard, before any request.
   */
  async updateLookupTable(
    dataGroupId: number | bigint,
    params: UpdateLookupTableParams,
  ): Promise<LookupTable> {
    requireInt64Id("data_group_id", dataGroupId);
    return governanceData.updateLookupTable(this.client, dataGroupId, params);
  }

  /**
   * Delete one or more lookup tables (`delete_lookup_tables`,
   * `workspace.py:8281-8300`).
   *
   * @param dataGroupIds - Data group IDs to delete — signed int64s
   *   (`bigint` beyond 2^53), each sent as an exact integer token.
   * @returns Nothing.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   * @throws ParamValidationError - `RL6_INVALID_ID` when any element is
   *   not a non-zero integer, or is a `number` beyond
   *   `Number.MAX_SAFE_INTEGER` (already rounded — pass a `bigint`);
   *   network-free guard, before any request.
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
   * Download lookup table data as raw CSV bytes
   * (`download_lookup_table`, `workspace.py:8302-8335`).
   *
   * @param dataGroupId - Data group ID of the lookup table — a signed
   *   int64: a `number` when it is a safe integer, a `bigint` beyond
   *   2^53 (Mixpanel assigns ids such as `-8644926364725811123n`),
   *   spelled exactly into the `data-group-id` query param.
   * @param options - Optional `file_name` / `limit` (keyword-only in
   *   Python).
   * @returns The raw CSV bytes.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dataGroupId`
   *   is not a non-zero integer, or is a `number` beyond
   *   `Number.MAX_SAFE_INTEGER` (already rounded — pass a `bigint`);
   *   network-free guard, before any request.
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
   * Get a signed download URL for a lookup table
   * (`get_lookup_download_url`, `workspace.py:8337-8360`).
   *
   * @param dataGroupId - Data group ID of the lookup table — a signed
   *   int64: a `number` when it is a safe integer, a `bigint` beyond
   *   2^53, spelled exactly into the `data-group-id` query param.
   * @returns The signed URL string.
   * @throws MixpanelHeadlessError - `MISSING_URL` when the response
   *   carries no URL.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `dataGroupId`
   *   is not a non-zero integer, or is a `number` beyond
   *   `Number.MAX_SAFE_INTEGER` (already rounded — pass a `bigint`);
   *   network-free guard, before any request.
   */
  async getLookupDownloadUrl(dataGroupId: number | bigint): Promise<string> {
    requireInt64Id("data_group_id", dataGroupId);
    return governanceData.getLookupDownloadUrl(this.client, dataGroupId);
  }

  /**
   * Create a new custom event (`create_custom_event`,
   * `workspace.py:8366-8407`).
   *
   * A custom event is a composite alias grouping one or more
   * underlying events under a single name; it appears alongside
   * regular events in queries and dashboards.
   *
   * @param params - Creation parameters (non-empty `name` and a
   *   non-empty, duplicate-free `alternatives` list).
   * @returns The created `CustomEvent` (server-assigned `id`).
   * @throws ResponseValidationError - Malformed payload.
   * @example
   * ```typescript
   * const ce = await ws.createCustomEvent(
   *   new CreateCustomEventParams({
   *     name: "Metric Tree Opened",
   *     alternatives: ["Enter room"],
   *   }),
   * );
   * ```
   */
  async createCustomEvent(
    params: CreateCustomEventParams,
  ): Promise<CustomEvent> {
    return governanceData.createCustomEvent(this.client, params);
  }

  /**
   * List all custom events (`list_custom_events`,
   * `workspace.py:8409-8434`).
   *
   * @returns The `EventDefinition` models for custom events.
   * @throws ResponseValidationError - Malformed payload.
   */
  async listCustomEvents(): Promise<EventDefinition[]> {
    return governanceData.listCustomEvents(this.client);
  }

  /**
   * Update a custom event's Lexicon entry
   * (`update_custom_event`, `workspace.py:8436-8492`).
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
   * @throws MixpanelHeadlessError - `UPDATE_TARGET_MISMATCH` when the
   *   server echoes a different `customEventId`.
   * @throws ResponseValidationError - Malformed payload.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `customEventId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async updateCustomEvent(
    customEventId: number,
    params: UpdateEventDefinitionParams,
  ): Promise<EventDefinition> {
    requireEntityId("custom_event_id", customEventId);
    return governanceData.updateCustomEvent(this.client, customEventId, params);
  }

  /**
   * Delete a custom event (`delete_custom_event`,
   * `workspace.py:8494-8524`).
   *
   * Identified by `custom_event_id` for the same reason
   * {@link Workspace.updateCustomEvent} is: a name-only DELETE is
   * ambiguous when lexicon rows share a display name.
   *
   * @param customEventId - Server-assigned custom event ID.
   * @returns Nothing.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   * @throws ParamValidationError - `RL6_INVALID_ID` when `customEventId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async deleteCustomEvent(customEventId: number): Promise<void> {
    requireEntityId("custom_event_id", customEventId);
    return governanceData.deleteCustomEvent(this.client, customEventId);
  }

  // === B6-W8 schema-registry / schema-enforcement / audit / anomaly /
  // deletion-request members (W8 owns; append-only) ===

  /**
   * List schema registry entries (`list_schema_registry`,
   * `workspace.py:8654-8687`).
   *
   * @param options - Optional `entity_type` filter ("event",
   *   "custom_event", "profile"); omit it to return every schema.
   * @returns The `SchemaEntry` models, in response order.
   * @throws ResponseValidationError - Malformed API response payload
   *   (`RESPONSE_VALIDATION_ERROR`).
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError - Wire failures.
   * @example
   * ```typescript
   * for (const entry of await ws.listSchemaRegistry({ entity_type: "event" })) {
   *   console.log(`${entry.name}: ${entry.entity_type}`);
   * }
   * ```
   */
  async listSchemaRegistry(
    options: WorkspaceListSchemaRegistryOptions = {},
  ): Promise<SchemaEntry[]> {
    return schemasAudit.listSchemaRegistry(this.client, options);
  }

  /**
   * Create a single schema definition (`create_schema`,
   * `workspace.py:8689-8720`).
   *
   * @param entityType - Entity type ("event", "custom_event", "profile").
   * @param entityName - Entity name (event name or "$user" for profile).
   * @param schemaJson - JSON Schema Draft 7 definition.
   * @returns The created schema, verbatim.
   * @throws AuthenticationError | QueryError | RateLimitError |
   *   ServerError - Wire failures.
   * @example
   * ```typescript
   * await ws.createSchema("event", "Purchase", {
   *   properties: { amount: { type: "number" } },
   * });
   * ```
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
   * Bulk create schemas (`create_schemas_bulk`,
   * `workspace.py:8722-8758`).
   *
   * @param params - Bulk creation parameters (entries plus the
   *   optional `truncate` flag).
   * @returns The response with `added` / `deleted` counts.
   * @throws ResponseValidationError - Malformed payload.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
   */
  async createSchemasBulk(
    params: BulkCreateSchemasParams,
  ): Promise<BulkCreateSchemasResponse> {
    return schemasAudit.createSchemasBulk(this.client, params);
  }

  /**
   * Update a single schema definition, merge semantics
   * (`update_schema`, `workspace.py:8760-8791`).
   *
   * @param entityType - Entity type.
   * @param entityName - Entity name.
   * @param schemaJson - Partial JSON Schema to merge with the existing one.
   * @returns The updated schema, verbatim.
   * @throws AuthenticationError | QueryError | ServerError - Wire
   *   failures.
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
   * Bulk update schemas, merge semantics per entry
   * (`update_schemas_bulk`, `workspace.py:8793-8828`).
   *
   * @param params - Bulk update parameters.
   * @returns Per-entry results with status "ok" or "error".
   * @throws ResponseValidationError - Malformed payload.
   */
  async updateSchemasBulk(
    params: BulkCreateSchemasParams,
  ): Promise<BulkPatchResult[]> {
    return schemasAudit.updateSchemasBulk(this.client, params);
  }

  /**
   * Delete schemas by entity type and/or name (`delete_schemas`,
   * `workspace.py:8830-8874`).
   *
   * With both filters a single schema is deleted; with `entity_type`
   * alone every schema of that type; with neither, ALL schemas.
   *
   * @param options - Optional `entity_type` / `entity_name` filters.
   * @returns The response with `delete_count`.
   * @throws MixpanelHeadlessError - `entity_name` given without
   *   `entity_type` (raised before any request).
   * @throws ResponseValidationError - Malformed payload.
   * @example
   * ```typescript
   * const resp = await ws.deleteSchemas({
   *   entity_type: "event",
   *   entity_name: "Purchase",
   * });
   * console.log(`Deleted: ${String(resp.delete_count)}`);
   * ```
   */
  async deleteSchemas(
    options: WorkspaceDeleteSchemasOptions = {},
  ): Promise<DeleteSchemasResponse> {
    return schemasAudit.deleteSchemas(this.client, options);
  }

  /**
   * Get the current schema-enforcement configuration
   * (`get_schema_enforcement`, `workspace.py:8879-8911`).
   *
   * @param options - Optional comma-separated `fields` selector.
   * @returns The enforcement configuration.
   * @throws ResponseValidationError - Malformed payload.
   * @throws QueryError - No enforcement configured (404).
   */
  async getSchemaEnforcement(
    options: WorkspaceGetSchemaEnforcementOptions = {},
  ): Promise<SchemaEnforcementConfig> {
    return schemasAudit.getSchemaEnforcement(this.client, options);
  }

  /**
   * Initialize schema enforcement (`init_schema_enforcement`,
   * `workspace.py:8913-8941`).
   *
   * @param params - Init parameters carrying `rule_event`.
   * @returns The raw API response.
   * @throws QueryError - Already initialized or invalid `rule_event` (400).
   */
  async initSchemaEnforcement(
    params: InitSchemaEnforcementParams,
  ): Promise<Record<string, unknown>> {
    return schemasAudit.initSchemaEnforcement(this.client, params);
  }

  /**
   * Partially update the enforcement configuration
   * (`update_schema_enforcement`, `workspace.py:8943-8971`).
   *
   * @param params - Partial update parameters.
   * @returns The raw API response.
   * @throws QueryError - No enforcement configured or validation error (400).
   */
  async updateSchemaEnforcement(
    params: UpdateSchemaEnforcementParams,
  ): Promise<Record<string, unknown>> {
    return schemasAudit.updateSchemaEnforcement(this.client, params);
  }

  /**
   * Fully replace the enforcement configuration
   * (`replace_schema_enforcement`, `workspace.py:8973-9003`).
   *
   * @param params - Complete replacement parameters.
   * @returns The raw API response.
   * @throws QueryError - Validation error (400).
   */
  async replaceSchemaEnforcement(
    params: ReplaceSchemaEnforcementParams,
  ): Promise<Record<string, unknown>> {
    return schemasAudit.replaceSchemaEnforcement(this.client, params);
  }

  /**
   * Delete the enforcement configuration
   * (`delete_schema_enforcement`, `workspace.py:9005-9021`).
   *
   * @returns The raw API response.
   * @throws QueryError - No enforcement configured (404).
   */
  async deleteSchemaEnforcement(): Promise<Record<string, unknown>> {
    return schemasAudit.deleteSchemaEnforcement(this.client);
  }

  /**
   * Run a full data audit — events plus properties (`run_audit`,
   * `workspace.py:9029-9067`).
   *
   * @returns The audit response with violations and `computed_at`.
   * @throws MixpanelHeadlessError - Unexpected audit-response shape.
   * @throws ResponseValidationError - A malformed violation entry.
   * @throws QueryError - No schemas defined (400).
   * @example
   * ```typescript
   * const audit = await ws.runAudit();
   * for (const v of audit.violations) {
   *   console.log(`${v.violation}: ${v.name} (${String(v.count)})`);
   * }
   * ```
   */
  async runAudit(): Promise<AuditResponse> {
    return schemasAudit.runAudit(this.client);
  }

  /**
   * Run an events-only data audit — faster
   * (`run_audit_events_only`, `workspace.py:9069-9103`).
   *
   * @returns The audit response with event violations only.
   * @throws MixpanelHeadlessError - Unexpected audit-response shape.
   * @throws ResponseValidationError - A malformed violation entry.
   * @throws QueryError - No schemas defined (400).
   */
  async runAuditEventsOnly(): Promise<AuditResponse> {
    return schemasAudit.runAuditEventsOnly(this.client);
  }

  /**
   * List detected data-volume anomalies
   * (`list_data_volume_anomalies`, `workspace.py:9110-9141`).
   *
   * @param options - Optional `query_params` filters (status, limit,
   *   event_id, …).
   * @returns The `DataVolumeAnomaly` models, in response order.
   * @throws ResponseValidationError - Malformed payload.
   * @example
   * ```typescript
   * const anomalies = await ws.listDataVolumeAnomalies({
   *   query_params: { status: "open" },
   * });
   * ```
   */
  async listDataVolumeAnomalies(
    options: WorkspaceListDataVolumeAnomaliesOptions = {},
  ): Promise<DataVolumeAnomaly[]> {
    return schemasAudit.listDataVolumeAnomalies(this.client, options);
  }

  /**
   * Update the status of a single anomaly (`update_anomaly`,
   * `workspace.py:9143-9169`).
   *
   * @param params - Update parameters (id, status, anomaly_class).
   * @returns The raw API response.
   * @throws QueryError - Anomaly not found or invalid parameters (400).
   */
  async updateAnomaly(
    params: UpdateAnomalyParams,
  ): Promise<Record<string, unknown>> {
    return schemasAudit.updateAnomaly(this.client, params);
  }

  /**
   * Bulk update anomaly statuses (`bulk_update_anomalies`,
   * `workspace.py:9171-9198`).
   *
   * @param params - Bulk update with the anomalies list and target status.
   * @returns The raw API response.
   * @throws QueryError - Invalid parameters (400).
   */
  async bulkUpdateAnomalies(
    params: BulkUpdateAnomalyParams,
  ): Promise<Record<string, unknown>> {
    return schemasAudit.bulkUpdateAnomalies(this.client, params);
  }

  /**
   * List all event deletion requests (`list_deletion_requests`,
   * `workspace.py:9204-9227`).
   *
   * @returns The `EventDeletionRequest` models, in response order.
   * @throws ResponseValidationError - Malformed payload.
   */
  async listDeletionRequests(): Promise<EventDeletionRequest[]> {
    return schemasAudit.listDeletionRequests(this.client);
  }

  /**
   * Create a new event deletion request
   * (`create_deletion_request`, `workspace.py:9229-9266`).
   *
   * @param params - Deletion parameters (event name, date range,
   *   optional filters).
   * @returns The updated FULL list of deletion requests.
   * @throws ResponseValidationError - Malformed payload.
   * @throws QueryError - Validation error (400).
   */
  async createDeletionRequest(
    params: CreateDeletionRequestParams,
  ): Promise<EventDeletionRequest[]> {
    return schemasAudit.createDeletionRequest(this.client, params);
  }

  /**
   * Cancel a pending deletion request
   * (`cancel_deletion_request`, `workspace.py:9268-9294`).
   *
   * @param requestId - Deletion request ID to cancel.
   * @returns The updated FULL list of deletion requests.
   * @throws ResponseValidationError - Malformed payload.
   * @throws QueryError - Request not found or not cancellable (400).
   * @throws ParamValidationError - `RL6_INVALID_ID` when `requestId`
   *   is not a positive integer (network-free guard, before any request).
   */
  async cancelDeletionRequest(
    requestId: number,
  ): Promise<EventDeletionRequest[]> {
    requireEntityId("request_id", requestId);
    return schemasAudit.cancelDeletionRequest(this.client, requestId);
  }

  /**
   * Preview what events a deletion filter would match
   * (`preview_deletion_filters`, `workspace.py:9296-9331`).
   *
   * Read-only: nothing is modified.
   *
   * @param params - Preview parameters (event name, date range,
   *   optional filters).
   * @returns The expanded/normalized filters, verbatim.
   * @throws QueryError - Invalid filter parameters (400).
   */
  async previewDeletionFilters(
    params: PreviewDeletionFiltersParams,
  ): Promise<Array<Record<string, unknown>>> {
    return schemasAudit.previewDeletionFilters(this.client, params);
  }

  // === 045 report links (Python PR #223 twin; `workspace.py` REPORT
  // LINKS section, AIE-561/562) ===

  /**
   * Choose the workspace id a created report link embeds
   * (`_report_link_workspace_id`): explicit, else the pinned session
   * workspace, else `resolveWorkspaceId()`, else `null` (project-only).
   *
   * @param explicit - Caller-supplied workspace id, or `null`.
   * @returns The workspace id to embed, or `null`.
   */
  async #reportLinkWorkspaceId(
    explicit: number | null,
  ): Promise<number | null> {
    if (explicit !== null) {
      return explicit;
    }
    const pinned = this.#session.workspace ?? null;
    if (pinned !== null) {
      return pinned.id;
    }
    try {
      return await this.resolveWorkspaceId();
    } catch (error) {
      if (!(error instanceof WorkspaceScopeError)) {
        throw error;
      }
      this.#logger.debug(
        `report link: no workspace resolved for project ` +
          `${this.#session.project.id}; emitting project-only URL`,
      );
      return null;
    }
  }

  /**
   * Turn query params (or a typed result) into a shareable report link
   * (`create_report_link`).
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
   * @throws ParamValidationError - `RL4_REPORT_TYPE_CONFLICT` on a
   *   contradicting `report_type`; `RL1`/`RL3` from the URL builder;
   *   `RL6_INVALID_ID` for a zero or negative `workspace_id`. All of
   *   these fire before the POST, so no record is created for bad input.
   * @throws BookmarkValidationError - Params failed schema validation
   *   (raised before any network call).
   * @throws AuthenticationError - Invalid credentials (401).
   * @throws QueryError - The server rejected the record (400/422).
   * @throws RateLimitError - Rate limit exceeded (429).
   * @throws ServerError - Server-side errors (5xx).
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
   */
  async createReportLink(
    params: ReportLinkParamsInput,
    options: WorkspaceCreateReportLinkOptions = {},
  ): Promise<ReportLink> {
    const { rawParams, reportType: resolvedType } = reportLinkInputs(
      params,
      options.report_type ?? null,
    );
    const name = options.name ?? "";
    const description = options.description ?? "";
    const bookmarkId = options.bookmark_id ?? null;

    if (options.validate ?? true) {
      const schemaErrors = validateBookmarkParamsSchema(
        rawParams,
        resolvedType,
      );
      if (schemaErrors.some((e) => e.severity === "error")) {
        throw new BookmarkValidationError(schemaErrors);
      }
      for (const w of schemaErrors) {
        if (w.severity === "warning") {
          this.#logger.warning(
            `create_report_link validation warning: ${w.message} [${w.code}]`,
          );
        }
      }
    }

    const slug = this.#generateSlug();
    const wid = await this.#reportLinkWorkspaceId(options.workspace_id ?? null);
    const projectId = this.#projectId();
    // Build the URL before the POST so every local input guard (RL1,
    // RL3, RL6) fires before a record exists on the server.
    const url = buildSlugUrl({
      region: this.#session.account.region,
      project_id: projectId,
      slug,
      report_type: resolvedType,
      workspace_id: wid,
    });

    const body: Record<string, unknown> = {
      slug,
      type: resolvedType,
      params: rawParams,
    };
    // Python `if name:` / `if description:` — empty strings stay absent.
    if (name !== "") {
      body["name"] = name;
    }
    if (description !== "") {
      body["description"] = description;
    }
    if (bookmarkId !== null) {
      body["bookmark_id"] = bookmarkId;
    }

    const response = await this.client.createBookmarkUrl(body);
    const created = Object.hasOwn(response, "created_at")
      ? response["created_at"]
      : undefined;

    let createdAt: string | null = null;
    if (created !== undefined && created !== null) {
      createdAt =
        typeof created === "string" ? created : jsonValuePythonStr(created);
    }
    return new ReportLink({
      url,
      slug,
      report_type: resolvedType,
      project_id: projectId,
      workspace_id: wid,
      name,
      description,
      bookmark_id: bookmarkId,
      created_at: createdAt,
    });
  }

  /**
   * Reject a link whose region, project, or workspace differs from the
   * session (`_check_report_link_scope`). Runs before the record fetch.
   * For a shortlink the region check runs before the redirect GET and
   * the project and workspace checks run on the expanded target, after
   * it. A bare slug carries none of the three values and so skips every
   * check. The workspace check applies only when the session has a
   * pinned workspace **and** the link names one.
   *
   * @param parsed - The parsed link (or a {@link ResolvedReport}
   *   projected onto one by {@link queryReportLink}).
   * @throws ReportLinkScopeMismatchError - `REPORT_LINK_REGION_MISMATCH`,
   *   `REPORT_LINK_PROJECT_MISMATCH`, or `REPORT_LINK_WORKSPACE_MISMATCH`.
   */
  #checkReportLinkScope(parsed: ParsedReportLink): void {
    const sessionRegion = this.#session.account.region;
    if (parsed.region !== null && parsed.region !== sessionRegion) {
      throw new ReportLinkScopeMismatchError(
        `Report link is on the ${parsed.region} region but the active ` +
          `account is on ${sessionRegion}.`,
        {
          code: "REPORT_LINK_REGION_MISMATCH",
          details: {
            ...reportLinkDetails(parsed),
            link_region: parsed.region,
            session_region: sessionRegion,
            hint:
              `Switch to an account on the ${parsed.region} region with ` +
              `ws.use(account="<name>") (CLI: mp --account <name> ...) ` +
              `and retry.`,
          },
        },
      );
    }
    const sessionProject = this.#projectId();
    if (parsed.project_id !== null && parsed.project_id !== sessionProject) {
      throw new ReportLinkScopeMismatchError(
        `Report link belongs to project ${String(parsed.project_id)} but the ` +
          `active session is project ${String(sessionProject)}.`,
        {
          code: "REPORT_LINK_PROJECT_MISMATCH",
          details: {
            ...reportLinkDetails(parsed),
            link_project_id: parsed.project_id,
            session_project_id: sessionProject,
            hint:
              `Switch with ws.use(project="${String(parsed.project_id)}") ` +
              `(CLI: mp --project ${String(parsed.project_id)} ...) and retry.`,
          },
        },
      );
    }
    const pinned = this.#session.workspace ?? null;
    if (
      pinned !== null &&
      parsed.workspace_id !== null &&
      parsed.workspace_id !== pinned.id
    ) {
      throw new ReportLinkScopeMismatchError(
        `Report link belongs to workspace ${String(parsed.workspace_id)} but the ` +
          `active session is pinned to workspace ${String(pinned.id)}.`,
        {
          code: "REPORT_LINK_WORKSPACE_MISMATCH",
          details: {
            ...reportLinkDetails(parsed),
            link_workspace_id: parsed.workspace_id,
            session_workspace_id: pinned.id,
            hint:
              `Switch with ws.use(workspace=${String(parsed.workspace_id)}) ` +
              `(CLI: mp --workspace ${String(parsed.workspace_id)} ...) and retry.`,
          },
        },
      );
    }
  }

  /**
   * Follow a shortlink once and parse its target (`_expand_short_link`).
   *
   * @param parsed - A parsed link with `kind === "short_link"`.
   * @returns `[parsedTarget, expandedUrl]`.
   * @throws ReportLinkScopeMismatchError - `REPORT_LINK_REGION_MISMATCH`
   *   when the shortlink host is on another region (before the GET).
   * @throws ShortLinkResolutionError - `SHORT_LINK_CHAIN` when the target
   *   is another shortlink, plus the transport codes from
   *   {@link MixpanelClient.resolveShortLink}.
   * @throws ReportLinkParseError - The expanded target is not a
   *   recognizable Mixpanel report link.
   * @throws AuthenticationError - The server redirected to the login page.
   */
  async #expandShortLink(
    parsed: ParsedReportLink,
  ): Promise<[ParsedReportLink, string]> {
    const shortCode = parsed.short_code as string;
    // The shortlink host names a region; a mismatch is knowable before
    // the redirect GET, so check it first (FR-020: no HTTP call on
    // mismatch).
    this.#checkReportLinkScope(parsed);
    const target = await this.client.resolveShortLink(shortCode);
    const parsedTarget = parseReportLink(target);
    if (parsedTarget.kind === "short_link") {
      throw new ShortLinkResolutionError(
        `Shortlink /s/${shortCode} redirects to another shortlink ` +
          `(${target}). mixpanel-headless follows one redirect only.`,
        {
          code: "SHORT_LINK_CHAIN",
          details: {
            ...reportLinkDetails(parsed),
            target,
            hint: "Resolve the target shortlink directly.",
          },
        },
      );
    }
    return [parsedTarget, target];
  }

  /**
   * Turn a report link, a bare slug, or a shortlink into its query
   * params (`resolve_report_link`).
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
   * @throws ReportLinkParseError - The string is not a recognizable link.
   * @throws UnsupportedReportLinkError - A dashboard link or a legacy
   *   `~(...)` hash.
   * @throws ReportLinkScopeMismatchError - The link's region or project
   *   differs from the session, or its workspace differs from the pinned
   *   session workspace. The record was not fetched.
   * @throws ReportLinkNotFoundError - The slug, saved report, or
   *   shortlink does not exist in scope.
   * @throws ShortLinkResolutionError - The shortlink target could not be
   *   extracted, or it is another shortlink.
   * @throws AuthenticationError - Invalid credentials, or the shortlink
   *   redirected to the login page.
   * @throws RateLimitError - Rate limit exceeded (429).
   * @throws ServerError - Server-side errors (5xx).
   * @throws QueryError - Other App API rejections (400/403/422).
   * @throws ResponseValidationError - The slug or bookmark record the
   *   server returned does not match the expected shape.
   * @throws MixpanelHeadlessError - A transport failure (`HTTP_ERROR`)
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
   */
  async resolveReportLink(link: string): Promise<ResolvedReport> {
    let parsed = parseReportLink(link);
    let expandedUrl: string | null = null;
    if (parsed.kind === "short_link") {
      [parsed, expandedUrl] = await this.#expandShortLink(parsed);
    }

    rejectUnsupportedReportLink(parsed);
    this.#checkReportLinkScope(parsed);

    const region = this.#session.account.region;
    const projectId = this.#projectId();
    const pinned = this.#session.workspace ?? null;
    const workspaceId = parsed.workspace_id ?? pinned?.id ?? null;

    if (parsed.kind === "slug") {
      const raw = await this.client.getBookmarkUrl(parsed.slug as string);
      const record = validateResponseModel(BookmarkUrl, toNativeJson(raw), {
        endpoint: "get_bookmark_url",
      });
      const embedded = record.bookmark;
      // The server accepts four slug types today. If it ever returns
      // another, keep the record resolvable and fall back to the app
      // the URL was opened under (or insights for a bare slug) rather
      // than raising RL1 from the builder.
      let slugUrlType = record.bookmark_type;
      if (!SLUG_APP_FOR_TYPE.has(slugUrlType)) {
        const hintType = parsed.report_type_hint;
        slugUrlType =
          hintType !== null && SLUG_APP_FOR_TYPE.has(hintType)
            ? hintType
            : "insights";
        this.#logger.warning(
          `slug ${record.slug} has unknown report type ` +
            `${pythonRepr(record.bookmark_type)}; the canonical URL uses ` +
            `the ${SLUG_APP_FOR_TYPE.get(slugUrlType) as string} app and may ` +
            `not open it correctly`,
        );
      }
      return new ResolvedReport({
        source: "slug",
        report_type: record.bookmark_type,
        params: { ...record.params },
        project_id: projectId,
        workspace_id: workspaceId,
        region,
        url: buildSlugUrl({
          region,
          project_id: projectId,
          slug: record.slug,
          report_type: slugUrlType,
          workspace_id: workspaceId,
        }),
        input: link,
        expanded_url: expandedUrl,
        slug: record.slug,
        bookmark_id: embedded === null ? record.bookmark_id : embedded.id,
        bookmark: embedded,
        name: record.name,
        description: record.description,
        overrides: record.overrides,
      });
    }

    // `parsed.kind === "bookmark"` (every other kind was rejected above).
    const bookmarkId = parsed.bookmark_id as number;
    let bookmark: Bookmark;
    try {
      bookmark = await this.getBookmark(bookmarkId);
    } catch (error) {
      if (error instanceof QueryError && error.statusCode === 404) {
        // get_bookmark is workspace-scoped when a workspace is pinned,
        // so a report in a sibling workspace of the same project also
        // 404s. Say so, instead of "not in this project".
        if (pinned !== null) {
          throw new ReportLinkNotFoundError(
            `No saved report found with id ${String(bookmarkId)} in ` +
              `project ${String(projectId)} (${region}) under the pinned ` +
              `workspace ${String(pinned.id)}.`,
            {
              code: "REPORT_LINK_BOOKMARK_NOT_FOUND",
              details: {
                ...reportLinkDetails(parsed),
                session_workspace_id: pinned.id,
                hint:
                  "The saved report may live in another workspace " +
                  "of this project. Switch with " +
                  "ws.use(workspace=<id>) (CLI: mp --workspace " +
                  "<id> ...) or unpin the workspace and retry.",
              },
              cause: error,
            },
          );
        }
        throw new ReportLinkNotFoundError(
          `No saved report found with id ${String(bookmarkId)} in ` +
            `project ${String(projectId)} (${region}).`,
          {
            code: "REPORT_LINK_BOOKMARK_NOT_FOUND",
            details: {
              ...reportLinkDetails(parsed),
              hint:
                "Check the saved report id, or switch to the project " +
                "and region that own it (ws.use(project=...); CLI: " +
                "mp --project ...) and retry.",
            },
            cause: error,
          },
        );
      }
      throw error;
    }
    if (parsed.overrides_jsurl !== null) {
      this.#logger.warning(
        `ignoring URL overrides ${pythonRepr(parsed.overrides_jsurl)}; ` +
          `running the saved report's base params`,
      );
    }
    const reportType = bookmark.bookmark_type;
    let urlType = reportType;
    if (!BOOKMARK_HASH_FOR_TYPE.has(urlType)) {
      // Python `parsed.report_type_hint or "insights"` (truthiness).
      urlType =
        parsed.report_type_hint !== null && parsed.report_type_hint !== ""
          ? parsed.report_type_hint
          : "insights";
      this.#logger.warning(
        `saved report ${String(bookmark.id)} has unknown report type ` +
          `${pythonRepr(reportType)}; the canonical URL uses the ` +
          `${String(parsed.app)} app and may not open it correctly`,
      );
    }
    return new ResolvedReport({
      source: "bookmark",
      report_type: reportType,
      params: { ...bookmark.params },
      project_id: projectId,
      workspace_id: workspaceId,
      region,
      url: buildBookmarkUrl({
        region,
        project_id: projectId,
        bookmark_id: bookmark.id,
        report_type: urlType,
        workspace_id: workspaceId,
      }),
      input: link,
      expanded_url: expandedUrl,
      slug: null,
      bookmark_id: bookmark.id,
      bookmark,
      name: bookmark.name,
      description: bookmark.description,
      overrides: null,
    });
  }

  /**
   * Run the query behind a report link through the matching engine
   * (`query_report_link`).
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
   * @throws UnsupportedReportLinkError - `UNSUPPORTED_REPORT_TYPE` for a
   *   type that cannot be run (for example `launch-analysis`).
   * @throws ReportLinkScopeMismatchError - A {@link ResolvedReport} whose
   *   recorded `region` or `project_id` differs from the active session,
   *   or whose recorded `workspace_id` differs from the pinned session
   *   workspace. Raised before any query.
   * @throws ReportLinkError - Any resolution failure when `link` is a
   *   string (see {@link resolveReportLink}).
   * @throws QueryError - The query engine rejected the params.
   * @throws AuthenticationError - Invalid credentials.
   * @throws RateLimitError - Rate limit exceeded.
   * @throws ServerError - Server-side errors.
   * @example
   * ```typescript
   * const rows = (await ws.queryReportLink("EBrV5bW2u9Mw")).toRows();
   *
   * const resolved = await ws.resolveReportLink(url);
   * if (resolved.report_type === "flows") {
   *   const result = await ws.queryReportLink(resolved, { mode: "paths" });
   * }
   * ```
   */
  async queryReportLink(
    link: string | ResolvedReport,
    options: WorkspaceQueryReportLinkOptions = {},
  ): Promise<ReportLinkQueryResult> {
    let resolved: ResolvedReport;
    if (typeof link === "string") {
      resolved = await this.resolveReportLink(link);
    } else {
      resolved = link;
      // A ResolvedReport records the scope it was resolved in. If the
      // caller kept it across `use({project})` or handed it to another
      // Workspace, refuse rather than run its params against an
      // unrelated project (same rule as resolveReportLink).
      this.#checkReportLinkScope(
        parsedReportLink({
          kind: resolved.source,
          raw: resolved.input,
          region: resolved.region,
          project_id: resolved.project_id,
          workspace_id: resolved.workspace_id,
          slug: resolved.slug,
          bookmark_id: resolved.bookmark_id,
        }),
      );
    }
    const projectId = this.#projectId();
    const service = this.liveQueryService;
    const reportType = resolved.report_type;
    // The report records the scope it was resolved in; run under
    // exactly that scope. The pin is never injected here, so a pin that
    // was cleared or set since resolve time cannot change the data view.
    const scope = {
      workspace_id: resolved.workspace_id,
      inject_workspace_id: false,
    };
    if (reportType === "insights") {
      return service.query(resolved.params, projectId, scope);
    }
    if (reportType === "funnels") {
      return service.queryFunnel(resolved.params, projectId, scope);
    }
    if (reportType === "retention") {
      return service.queryRetention(resolved.params, projectId, scope);
    }
    if (reportType === "flows") {
      const mode = options.mode ?? null;
      let derived: string = mode ?? "sankey";
      if (mode === null) {
        const chartType = Object.hasOwn(resolved.params, "chartType")
          ? resolved.params["chartType"]
          : undefined;
        if (
          chartType === "sankey" ||
          chartType === "paths" ||
          chartType === "tree"
        ) {
          derived = chartType;
        }
      }
      return service.queryFlow(resolved.params, projectId, derived, scope);
    }
    throw new UnsupportedReportLinkError(
      `Report type ${pythonRepr(reportType)} cannot be run through mixpanel-headless.`,
      {
        code: "UNSUPPORTED_REPORT_TYPE",
        details: {
          report_type: reportType,
          hint: "Supported types are insights, funnels, retention, and flows.",
        },
      },
    );
  }

  /**
   * Build the web URL for a saved report (bookmark). Pure; no network
   * (`saved_report_link`).
   *
   * @param bookmarkId - Numeric saved-report id.
   * @param options - `report_type` (default `insights`; the singular
   *   `funnel` normalizes to `funnels`) and `workspace_id` (defaults to
   *   the pinned session workspace; omitted when none is pinned —
   *   `resolveWorkspaceId()` is never called here).
   * @returns `https://{host}/project/{pid}[/view/{wid}]/app/{app}#{hash}`
   *   for the session region.
   * @throws ParamValidationError - `RL1_UNKNOWN_REPORT_TYPE`,
   *   `RL3_UNKNOWN_REGION`, or `RL6_INVALID_ID` (a zero or negative
   *   `bookmark_id` or `workspace_id`).
   * @example
   * ```typescript
   * ws.savedReportLink(123, { report_type: "funnels" });
   * // "https://mixpanel.com/project/3/app/funnels#view/123"
   * ```
   * @throws ParamValidationError - `RL6_INVALID_ID` when `bookmarkId`
   *   is not a positive integer (network-free guard, before any request).
   */
  savedReportLink(
    bookmarkId: number,
    options: WorkspaceSavedReportLinkOptions = {},
  ): string {
    requireEntityId("bookmark_id", bookmarkId);
    const reportType = options.report_type ?? "insights";
    const normalized = reportType === "funnel" ? "funnels" : reportType;
    const pinned = this.#session.workspace ?? null;
    const explicit = options.workspace_id ?? null;
    const wid = explicit ?? pinned?.id ?? null;
    return buildBookmarkUrl({
      region: this.#session.account.region,
      project_id: this.#projectId(),
      bookmark_id: bookmarkId,
      report_type: normalized,
      workspace_id: wid,
    });
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

// ---------------------------------------------------------------------------
// 045 report-link helpers (Python `Workspace` staticmethods, PR #223).
// ---------------------------------------------------------------------------

/**
 * Split a `createReportLink` input into raw params and a type
 * (`_report_link_inputs`). A dict with no type is `insights`.
 *
 * @param params - A raw params dict or a typed query result.
 * @param reportType - Caller-supplied type, or `null` to infer.
 * @returns The raw params and the resolved type.
 * @throws ParamValidationError - `RL4_REPORT_TYPE_CONFLICT` when an
 *   explicit type contradicts the type inferred from a typed result.
 */
function reportLinkInputs(
  params: ReportLinkParamsInput,
  reportType: ReportLinkType | null,
): { rawParams: Record<string, unknown>; reportType: ReportLinkType } {
  let inferred: ReportLinkType;
  let resultClass: string;
  if (params instanceof QueryResult) {
    inferred = "insights";
    resultClass = "QueryResult";
  } else if (params instanceof FunnelQueryResult) {
    inferred = "funnels";
    resultClass = "FunnelQueryResult";
  } else if (params instanceof RetentionQueryResult) {
    inferred = "retention";
    resultClass = "RetentionQueryResult";
  } else if (params instanceof FlowQueryResult) {
    inferred = "flows";
    resultClass = "FlowQueryResult";
  } else {
    return {
      rawParams: params,
      reportType: reportType ?? "insights",
    };
  }
  if (reportType !== null && reportType !== inferred) {
    throw new ParamValidationError(
      `report_type=${pythonRepr(reportType)} contradicts the ` +
        `${resultClass} result, which is ${pythonRepr(inferred)}. ` +
        `Omit report_type or pass a plain params dict.`,
      "RL4_REPORT_TYPE_CONFLICT",
      { given: reportType, inferred, result_class: resultClass },
    );
  }
  return { rawParams: { ...params.params }, reportType: inferred };
}

/**
 * Collect the parsed link fields that are set, for error `details`
 * (`_report_link_details`).
 *
 * @param parsed - The parsed link.
 * @returns `kind` plus every non-`null` id field.
 */
function reportLinkDetails(parsed: ParsedReportLink): Record<string, unknown> {
  const details: Record<string, unknown> = { kind: parsed.kind };
  const fields = [
    "region",
    "project_id",
    "workspace_id",
    "slug",
    "bookmark_id",
    "dashboard_id",
    "short_code",
  ] as const;
  for (const name of fields) {
    const value = parsed[name];
    if (value !== null) {
      details[name] = value;
    }
  }
  return details;
}

/**
 * Throw for link kinds that headless recognizes but cannot resolve
 * (`_reject_unsupported_report_link`).
 *
 * @param parsed - The parsed link.
 * @throws UnsupportedReportLinkError - `UNSUPPORTED_DASHBOARD_LINK` or
 *   `UNSUPPORTED_LEGACY_HASH`.
 */
function rejectUnsupportedReportLink(parsed: ParsedReportLink): void {
  if (parsed.kind === "dashboard") {
    const did = String(parsed.dashboard_id);
    throw new UnsupportedReportLinkError(
      `This link points at dashboard ${did}, not at a single report.`,
      {
        code: "UNSUPPORTED_DASHBOARD_LINK",
        details: {
          ...reportLinkDetails(parsed),
          hint:
            `Use ws.get_dashboard(${did}) (CLI: mp dashboards get ${did}) ` +
            `to list its reports, then resolve one report link.`,
        },
      },
    );
  }
  if (parsed.kind === "legacy_jsurl") {
    throw new UnsupportedReportLinkError(
      "This link uses the legacy JSURL hash format, which " +
        "mixpanel-headless cannot decode.",
      {
        code: "UNSUPPORTED_LEGACY_HASH",
        details: {
          ...reportLinkDetails(parsed),
          hint:
            "Open it in a browser (the app re-mints a shareable link " +
            "on load) and copy the new URL.",
        },
      },
    );
  }
}
