/**
 * `createMixpanelClient` — the client factory: `MixpanelAPIClient`
 * construction, session axes, scoping, workspace resolution and the
 * public `request()` escape hatch, assembled over an injectable transport
 * rather than a class singleton. Every shared internal (retry loop,
 * response handler, `appRequest`, header merge, URL builders, path
 * scoping, backoff) is imported from its own module; the domain methods
 * arrive as `create<Domain>Methods(core)` factories spread into the
 * client. Per-call `AbortSignal`s are curried into signal-aware
 * request/sleep closures at assembly ({@link ClientCore.executeDeps} /
 * {@link ClientCore.appDeps}); every cancellation exits as an
 * `AbortError` `DOMException`.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient
 */

import { accountAuthHeader, type TokenResolver } from "../auth/account.js";
import {
  type Project,
  type Session,
  sessionReplace,
  type WorkspaceRef,
} from "../auth/session.js";
import {
  MixpanelHeadlessError,
  QueryError,
  WorkspaceScopeError,
} from "../errors.js";
import { defined } from "../invariant.js";
import {
  type AlertMethods,
  createAlertMethods,
} from "../services/entities/alerts.js";
import {
  type AnnotationMethods,
  createAnnotationMethods,
} from "../services/entities/annotations.js";
import {
  type AnomalyMethods,
  createAnomalyMethods,
} from "../services/entities/anomalies.js";
import {
  type AuditMethods,
  createAuditMethods,
} from "../services/entities/audit.js";
import {
  type BookmarkUrlMethods,
  createBookmarkUrlMethods,
} from "../services/entities/bookmark-urls.js";
import {
  type BookmarkMethods,
  createBookmarkMethods,
} from "../services/entities/bookmarks.js";
import {
  type BusinessContextMethods,
  createBusinessContextMethods,
} from "../services/entities/business-context.js";
import {
  type CohortMethods,
  createCohortMethods,
} from "../services/entities/cohorts.js";
import {
  createCustomEventMethods,
  type CustomEventMethods,
} from "../services/entities/custom-events.js";
import {
  createCustomPropertyMethods,
  type CustomPropertyMethods,
} from "../services/entities/custom-properties.js";
import {
  createDashboardMethods,
  type DashboardMethods,
} from "../services/entities/dashboards.js";
import {
  createDeletionRequestMethods,
  type DeletionRequestMethods,
} from "../services/entities/deletion-requests.js";
import {
  createDropFilterMethods,
  type DropFilterMethods,
} from "../services/entities/drop-filters.js";
import {
  createExperimentMethods,
  type ExperimentMethods,
} from "../services/entities/experiments.js";
import {
  createFlagMethods,
  type FlagMethods,
} from "../services/entities/flags.js";
import {
  createLexiconMethods,
  type LexiconMethods,
} from "../services/entities/lexicon.js";
import {
  createLookupTableMethods,
  type LookupTableMethods,
} from "../services/entities/lookup-tables.js";
import {
  createReplaysSigningMethods,
  type ReplaysSigningMethods,
} from "../services/entities/replays-signing.js";
import {
  createSchemaEnforcementMethods,
  type SchemaEnforcementMethods,
} from "../services/entities/schema-enforcement.js";
import {
  createSchemaMethods,
  type SchemaMethods,
} from "../services/entities/schemas.js";
import {
  createWebhookMethods,
  type WebhookMethods,
} from "../services/entities/webhooks.js";
import {
  createEngageMethods,
  type EngageMethods,
} from "../services/queries/engage.js";
import {
  createQueryHostMethods,
  type QueryHostMethods,
} from "../services/queries/query-host.js";
import {
  createStreamingMethods,
  type StreamingMethods,
} from "../services/queries/streaming.js";
import { PublicWorkspace } from "../types/entities/common.js";
import { appRequest, type AppRequestDeps } from "./app-request.js";
import type { RandomSource } from "./backoff.js";
import type {
  ClientAppRequestOptions,
  ClientCore,
  ClientRequestOptions,
  ClientUseOptions,
  HttpHandle,
  QueryHostRequestOptions,
} from "./core.js";
import { getUserAgent, requestHeaders } from "./headers.js";
import {
  bindFirst,
  executeWithRetry,
  isPlainRecord,
  type RequestExecutor,
  type RetryExecutorDeps,
  type RetryLogger,
} from "./internals.js";
import { type JsonValue, toNativeJson } from "./json-value.js";
import {
  selectWorkspaceId,
  type WorkspaceResolver,
  type WorkspaceView,
  workspaceViewFromMetadataEntry,
  workspaceViewFromPublic,
} from "./me.js";
import { validateResponseModels } from "./response-validation.js";
import { maybeScopedPath } from "./scope.js";
import {
  createRequestExecutor,
  normalizedAbortError,
  rawFetch,
  type RawFetchResult,
} from "./transport.js";
import {
  apiFamilyFor,
  buildUrl,
  DEFAULT_APP_TIMEOUT_S,
  DEFAULT_QUERY_TIMEOUT_S,
  type EndpointKind,
  endpointOverridesProvider,
  type EndpointOverridesSource,
  endpointsFor,
  type Region,
  WORKSPACE_SCOPED_FAMILIES,
} from "./url.js";

/**
 * HTTP statuses on a workspace-discovery source that mean "this source
 * can't answer for this credential" rather than a transient failure
 * They let auto-resolution fall through to the next source; 5xx / 401 /
 * 429 / network errors still propagate.
 */
const FALLBACK_HTTP_STATUSES: ReadonlySet<number> = new Set([403, 404]);

/**
 * The env-pair provider seam for header layer 2 (`core` never reads
 * `process.env`; the node package wires the real env source).
 */
export type CustomHeaderEnvSource = () => {
  readonly name?: string | undefined;
  readonly value?: string | undefined;
};

// Client-core seam types — defined in `core.ts`, re-exported here so
// the public barrel and existing importers resolve unchanged.
export type {
  ClientAppRequestOptions,
  ClientCore,
  ClientRequestOptions,
  ClientUseOptions,
  HttpHandle,
  QueryHostRequestOptions,
} from "./core.js";

/**
 * Constructor options (Python `MixpanelAPIClient.__init__` kwargs +
 * the TS determinism seams).
 */
export interface MixpanelClientOptions {
  /** Resolved Session (account + project + optional workspace). */
  readonly session: Session;
  /**
   * Request timeout in seconds for regular requests. When `null`, each
   * request gets a route-aware timeout sized to outlast the server's own
   * deadline (135s on App API routes, 503s otherwise), so the server —
   * not this client — resolves a slow request. An explicit value applies
   * to every request.
   *
   * @defaultValue `null`
   */
  readonly timeoutSeconds?: number | null | undefined;
  /**
   * Request timeout in seconds for export operations.
   *
   * @defaultValue `600`
   */
  readonly exportTimeoutSeconds?: number | undefined;
  /**
   * Maximum retry attempts for rate-limited requests.
   *
   * @defaultValue `3`
   */
  readonly maxRetries?: number | undefined;
  /**
   * Token resolver for OAuth accounts. Python defaults to the on-disk
   * resolver; in `core` the default is none (the node package supplies
   * it), and OAuth auth-header resolution without one throws
   * `ParamTypeError`.
   *
   * @defaultValue `null`
   */
  readonly tokenResolver?: TokenResolver | null | undefined;
  /**
   * Injectable transport (the TS analog of `_transport`).
   *
   * @defaultValue the global `fetch`
   */
  readonly fetch?: typeof fetch | undefined;
  /**
   * Sleep seam in milliseconds (fake-timer friendly).
   *
   * @defaultValue a `setTimeout`-backed sleep
   */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  /**
   * Uniform-[0, 1) RNG for backoff jitter.
   *
   * @defaultValue `Math.random`
   */
  readonly random?: RandomSource | undefined;
  /**
   * Clock seam, read through `ClientCore.now` by the query-host date
   * defaults, the streaming exports and the discovery service.
   *
   * @defaultValue `() => new Date()`
   */
  readonly now?: (() => Date) | undefined;
  /** Optional retry-warning logger. */
  readonly logger?: RetryLogger | undefined;
  /**
   * Header layer-2 env pair provider.
   *
   * @defaultValue an empty source (the layer is disabled)
   */
  readonly getCustomHeaderEnv?: CustomHeaderEnvSource | undefined;
  /**
   * Alternate-host routing (Python PR #235: `MP_API_BASE_URL` /
   * `MP_APP_BASE_URL`). `apiBaseUrl` routes every API family at one
   * base (`query` → `/api/query`, `export` → `/api/2.0`, `engage` →
   * `/api/query/engage`, `app` → `/api/app`); `appBaseUrl` re-homes only
   * the App API. Pass a static bag, or a provider that is consulted on
   * every request (the node package wires a `process.env` reader, the
   * twin of Python's per-request `os.environ` read).
   *
   * @defaultValue no overrides — the live per-region hosts
   */
  readonly endpointOverrides?: EndpointOverridesSource | undefined;
}

/**
 * The assembled Mixpanel API client: the core surface below plus every
 * domain-method interface (query host, engage, streaming/export and the
 * entity CRUD families) merged in at assembly.
 */
export interface MixpanelClient
  extends
    QueryHostMethods,
    EngageMethods,
    StreamingMethods,
    DashboardMethods,
    BookmarkMethods,
    BookmarkUrlMethods,
    CohortMethods,
    FlagMethods,
    ExperimentMethods,
    AnnotationMethods,
    WebhookMethods,
    AlertMethods,
    SchemaMethods,
    LexiconMethods,
    DropFilterMethods,
    CustomPropertyMethods,
    LookupTableMethods,
    CustomEventMethods,
    SchemaEnforcementMethods,
    AuditMethods,
    AnomalyMethods,
    DeletionRequestMethods,
    BusinessContextMethods,
    ReplaysSigningMethods {
  /** The resolved Session bound to this client (`session` property). */
  readonly session: Session;
  /** The project ID from the bound Session (`project_id` property). */
  readonly projectId: string;
  /** The configured region from the bound Session (`region` property). */
  readonly region: Region;
  /** The explicit workspace ID, if set (`workspace_id` property). */
  readonly workspaceId: number | null;
  /** Whether a `/me`-backed workspace resolver is installed. */
  readonly hasWorkspaceResolver: boolean;
  /**
   * The shared internals seam the domain-method factories consume.
   *
   * @internal
   */
  readonly core: ClientCore;

  /**
   * Return the current Authorization header value, computed on every
   * access (Python's `current_auth_header` property; a property doing
   * token I/O becomes a method).
   *
   * @returns The header value (`Basic ...` or `Bearer ...`).
   */
  currentAuthHeader: () => Promise<string>;

  /**
   * Install a `/me`-backed workspace resolver for auto-discovery
   * (`set_workspace_resolver`).
   *
   * @param resolver - The resolver, or `null` to clear.
   */
  setWorkspaceResolver: (resolver: WorkspaceResolver | null) => void;

  /**
   * Make an authenticated request to any Mixpanel API endpoint — the
   * escape hatch (`request`). No `project_id`
   * injection (the caller controls the URL); `query_origin` is injected
   * by the retry core.
   *
   * @param method - HTTP method.
   * @param url - Full URL to request.
   * @param options - Optional params/body/headers/timeout/signal.
   * @returns Parsed JSON response.
   * @throws {@link AuthenticationError} - Invalid credentials (401).
   * @throws {@link RateLimitError} - Rate limit exceeded after the
   *   maximum retries.
   * @throws {@link QueryError} - Invalid parameters (400/403/404/other
   *   4xx).
   * @throws {@link ServerError} - Server-side errors (5xx).
   * @throws {@link MixpanelHeadlessError} - Network/connection errors
   *   (`HTTP_ERROR`).
   */
  request: (
    method: string,
    url: string,
    options?: ClientRequestOptions,
  ) => Promise<JsonValue>;

  /**
   * Make an authenticated App API request (`app_request` — the
   * `app-request.ts` implementation reached through this client's
   * per-call deps).
   *
   * @param method - HTTP method.
   * @param path - App API path (e.g. `/projects/12345/dashboards`).
   * @param options - Optional params/body/raw/signal.
   * @returns The `results` field when present (unless `raw`), the full
   *   body otherwise; `{status: "ok"}` for 204.
   * @throws {@link ParamValidationError} - Both body kinds provided
   *   (`AC1_BODY_MUTUALLY_EXCLUSIVE`).
   * @throws {@link MixpanelHeadlessError} - Every class
   *   {@link appRequest} raises (`AuthenticationError`, `RateLimitError`,
   *   `QueryError`, `ServerError`, `HTTP_ERROR`).
   */
  appRequest: (
    method: string,
    path: string,
    options?: ClientAppRequestOptions,
  ) => Promise<JsonValue>;

  /**
   * Issue a query-host request (`_request`). See
   * {@link ClientCore.requestQueryHost}.
   *
   * @param method - HTTP method.
   * @param url - Full URL.
   * @param options - Params/body/injection flags.
   * @returns Parsed lossless JSON response.
   * @internal
   */
  requestQueryHost: (
    method: string,
    url: string,
    options?: QueryHostRequestOptions,
  ) => Promise<JsonValue>;

  /**
   * Swap one or more session axes in place, preserving the HTTP
   * transport (`use`).
   *
   * `use(workspace=W)` is in-memory only;
   * `use(project=P)` / `use(account=A)` clear the resolved-workspace
   * cache; `use(account=A)` rebuilds the auth header atomically (the
   * prior session/header survive when the new account's token probe
   * fails). Any call that does not supply `workspace` (including a
   * zero-axis `use()`) clears both `session.workspace` and the pin.
   *
   * @param options - The axes to swap.
   * @throws {@link OAuthError} - The new account's token probe failed
   *   (state unchanged).
   * @throws {@link ParamTypeError} - An OAuth account was supplied with no
   *   token resolver bound (state unchanged).
   */
  use: (options?: ClientUseOptions) => Promise<void>;

  /**
   * Return the workspace for the current session, lazy-resolving once
   * (`resolve_workspace`).
   *
   * @returns The session's WorkspaceRef (cached per session lifetime).
   * @throws {@link WorkspaceScopeError} - No accessible workspaces.
   */
  resolveWorkspace: () => Promise<WorkspaceRef>;

  /**
   * Set or clear the explicit workspace ID for scoped requests
   * (`set_workspace_id`). Clearing also
   * drops the cached auto-discovered ID.
   *
   * @param workspaceId - Workspace ID to pin, or `null` to clear.
   */
  setWorkspaceId: (workspaceId: number | null) => void;

  /**
   * Resolve the workspace ID for scoped requests
   * (`resolve_workspace_id`): explicit pin →
   * cached id → injected `/me` resolver → `/workspaces/public` → the
   * projects metadata index → `WorkspaceScopeError`.
   *
   * @returns The resolved workspace ID (memoized).
   * @throws {@link WorkspaceScopeError} - Code `NO_WORKSPACES` when every
   *   source is exhausted.
   * @throws {@link MixpanelHeadlessError} - Any non-403/404 discovery
   *   failure (`AuthenticationError`, `RateLimitError`, `ServerError`,
   *   `QueryError`, `HTTP_ERROR`) propagates rather than masking as "no
   *   workspace".
   */
  resolveWorkspaceId: () => Promise<number>;

  /**
   * Fetch the projects metadata index (`projects_metadata_index`).
   *
   * @returns The metadata payload keyed by project ID, or `{}` when the
   *   response is not a mapping.
   */
  projectsMetadataIndex: () => Promise<Record<string, JsonValue>>;

  /**
   * Resolve a workspace ID from the metadata index
   * (`_resolve_workspace_from_metadata`).
   *
   * @returns The chosen id, or `null` when the index can't answer.
   * @internal
   */
  resolveWorkspaceFromMetadata: () => Promise<number | null>;

  /**
   * Build an optionally workspace-scoped API path
   * (`maybe_scoped_path` — `scope.ts` over this client's pin state).
   *
   * @param domainPath - Domain-relative path (e.g. `"dashboards"`).
   * @returns `/workspaces/{wid}/{path}` when pinned, else
   *   `/projects/{pid}/{path}`.
   */
  maybeScopedPath: (domainPath: string) => string;

  /**
   * Build a workspace-scoped API path, auto-discovering if needed
   * (`require_scoped_path`).
   *
   * @param domainPath - Domain-relative path.
   * @returns `/projects/{pid}/workspaces/{wid}/{domainPath}`.
   * @throws {@link WorkspaceScopeError} - No workspaces found for the
   *   project.
   */
  requireScopedPath: (domainPath: string) => Promise<string>;

  /**
   * Create a new client for a different project, sharing the transport
   * seams (`with_project`).
   *
   * @param projectId - The project ID to target.
   * @param workspaceId - Optional workspace ID within the new project.
   * @returns A new client bound to `projectId`.
   */
  withProject: (
    projectId: string,
    workspaceId?: number | null,
  ) => MixpanelClient;

  /**
   * Call `GET /api/app/me` (`me`). Not project-scoped.
   *
   * @returns The raw `/me` payload (a non-mapping result is wrapped as
   *   `{results: ...}`).
   */
  me: () => Promise<Record<string, JsonValue>>;

  /**
   * List public workspaces for the current project (`list_workspaces`).
   *
   * @returns Validated {@link PublicWorkspace} models.
   * @throws {@link ResponseValidationError} - A workspace entry fails
   *   model validation (`RESPONSE_VALIDATION_ERROR`).
   * @throws {@link MixpanelHeadlessError} - Non-list response payload.
   */
  listWorkspaces: () => Promise<PublicWorkspace[]>;

  /**
   * Force pool-token creation (`_ensure_client` / `__enter__`); the
   * lifecycle tests peek via {@link isHttpOpen}/{@link httpHandle}.
   *
   * @internal
   */
  ensureHttpOpen: () => void;

  /**
   * Report whether the pool token exists (`_client is not None`).
   *
   * @returns `true` while the handle is open.
   * @internal
   */
  isHttpOpen: () => boolean;

  /**
   * Return the pool token, lazily created (`_http` property — the
   * identity the transport-preservation tests compare).
   *
   * @returns The handle.
   * @internal
   */
  httpHandle: () => HttpHandle;

  /** Close the HTTP client and release resources (`close`). */
  close: () => Promise<void>;

  /** `async with` ports as `await using` / explicit `close()`. */
  [Symbol.asyncDispose]: () => Promise<void>;
}

/**
 * Sleep on real timers — the default sleep seam.
 *
 * @param ms - Milliseconds to wait.
 * @returns A promise that resolves after the delay.
 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Wrap the injected sleep so a per-call signal can cancel a backoff
 * wait, rejecting with a normalized `AbortError` DOMException.
 *
 * @param sleep - The injected base sleep.
 * @param signal - The per-call signal (absent → base sleep unchanged).
 * @returns The signal-aware sleep closure.
 */
function signalAwareSleep(
  sleep: (ms: number) => Promise<void>,
  signal: AbortSignal | undefined,
): (ms: number) => Promise<void> {
  if (signal === undefined) {
    return sleep;
  }
  return (ms: number): Promise<void> => {
    if (signal.aborted) {
      return Promise.reject(normalizedAbortError(signal.reason));
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        reject(normalizedAbortError(signal.reason));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      sleep(ms).then(
        () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  };
}

/** Options-derived seams, fixed for the client's lifetime. */
interface ClientConfig {
  /**
   * Python `timeout: float | None = None` — `null` means "route-aware
   * defaults"; an explicit value applies to every request.
   */
  readonly timeoutSeconds: number | null;
  readonly exportTimeoutSeconds: number;
  readonly maxRetries: number;
  readonly tokenResolver: TokenResolver | null;
  readonly fetchImpl: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random: RandomSource;
  readonly now: () => Date;
  readonly logger: RetryLogger | undefined;
  readonly getCustomHeaderEnv: CustomHeaderEnvSource;
  /**
   * Python PR #235: the override source is kept (not its value) so a provider is
   * consulted on every request — Python's `_endpoints_for` reads
   * `os.environ` per call, never at construction. `withProject` hands
   * the same source to the derived client.
   */
  readonly endpointOverridesSource: EndpointOverridesSource | undefined;
  readonly getEndpointOverrides: ClientCore["endpointOverrides"];
}

/**
 * The mutable client state (the Python instance attributes). One bag,
 * shared by reference between the core and every method, so a `use()`
 * swap is visible everywhere at once.
 */
interface ClientState {
  session: Session;
  /**
   * Python caches the ServiceAccount Basic header at construction; the
   * TS auth model is async, so the cache fills lazily on first use —
   * observationally identical (SA header derivation is pure and the
   * resolver is never consulted for SA, `_get_auth_header`).
   */
  cachedBasicHeader: string | null;
  workspaceId: number | null;
  cachedWorkspaceId: number | null;
  resolvedWorkspace: WorkspaceRef | null;
  meResolver: WorkspaceResolver | null;
  httpHandle: HttpHandle | null;
}

/** What every client function receives first (see {@link bindFirst}). */
interface ClientContext {
  readonly config: ClientConfig;
  readonly state: ClientState;
}

// ----- ClientCore members -----

/**
 * Resolve the endpoint table for the current session's region under the
 * current overrides — `_endpoints_for(self._session.account.region)`,
 * evaluated per call.
 *
 * @param ctx - The client context.
 * @returns The family → base-URL table.
 */
function currentEndpoints(
  ctx: ClientContext,
): ReadonlyMap<EndpointKind, string> {
  return endpointsFor(
    ctx.state.session.account.region,
    ctx.config.getEndpointOverrides(),
  );
}

function ensureHttp(ctx: ClientContext): HttpHandle {
  ctx.state.httpHandle ??= { fetchImpl: ctx.config.fetchImpl };
  return ctx.state.httpHandle;
}

// `_default_timeout`: explicit constructor
// timeout wins; else route-aware, reading the current session's region
// (an account swap via `use()` re-routes, exactly like Python's
// `self._session.account.region` read).
function defaultTimeoutSeconds(ctx: ClientContext, url: string): number {
  if (ctx.config.timeoutSeconds !== null) {
    return ctx.config.timeoutSeconds;
  }
  // Family classification (longest prefix, Python PR #235) replaces the old
  // `startswith(app)` check so App routes on an override host — even a
  // split `appBaseUrl` nested under the query prefix — keep the App
  // timeout.
  if (apiFamilyFor(url, currentEndpoints(ctx)) === "app") {
    return DEFAULT_APP_TIMEOUT_S;
  }
  return DEFAULT_QUERY_TIMEOUT_S;
}

async function getAuthHeader(ctx: ClientContext): Promise<string> {
  const account = ctx.state.session.account;
  if (account.type === "service_account") {
    ctx.state.cachedBasicHeader ??= await accountAuthHeader(account, {});
    return ctx.state.cachedBasicHeader;
  }
  // OAuth variants re-resolve per call so a refreshed bearer surfaces
  // without rebuilding the client.
  return accountAuthHeader(account, {
    tokenResolver: ctx.config.tokenResolver,
  });
}

function coreRequestHeaders(
  ctx: ClientContext,
  extra: Record<string, string>,
): Record<string, string> {
  const sessionHeaders: Record<string, string> = Object.fromEntries(
    ctx.state.session.headers,
  );
  return requestHeaders(
    {
      getUserAgent,
      getCustomHeaderEnv: ctx.config.getCustomHeaderEnv,
      sessionHeaders,
    },
    extra,
  );
}

function executeDeps(
  ctx: ClientContext,
  signal?: AbortSignal,
): RetryExecutorDeps {
  return {
    request: createRequestExecutor(ensureHttp(ctx).fetchImpl, signal),
    sleep: signalAwareSleep(ctx.config.sleep, signal),
    random: ctx.config.random,
    maxRetries: ctx.config.maxRetries,
    defaultTimeoutSeconds: bindFirst(ctx, defaultTimeoutSeconds),
    requestHeaders: bindFirst(ctx, coreRequestHeaders),
    projectId: ctx.state.session.project.id,
    logger: ctx.config.logger,
  };
}

function appDeps(ctx: ClientContext, signal?: AbortSignal): AppRequestDeps {
  return {
    request: createRequestExecutor(ensureHttp(ctx).fetchImpl, signal),
    sleep: signalAwareSleep(ctx.config.sleep, signal),
    random: ctx.config.random,
    maxRetries: ctx.config.maxRetries,
    defaultTimeoutSeconds: bindFirst(ctx, defaultTimeoutSeconds),
    requestHeaders: bindFirst(ctx, coreRequestHeaders),
    projectId: ctx.state.session.project.id,
    region: ctx.state.session.account.region,
    // Snapshot of the provider's current value — `appDeps()` is built per
    // call, so this is still a per-request read (Python PR #235).
    endpointOverrides: ctx.config.getEndpointOverrides(),
    getAuthHeader: bindFirst(ctx, getAuthHeader),
    logger: ctx.config.logger,
  };
}

async function requestQueryHost(
  ctx: ClientContext,
  method: string,
  url: string,
  callOptions: QueryHostRequestOptions = {},
): Promise<JsonValue> {
  const params = callOptions.params ?? {};
  if (callOptions.injectProjectId !== false) {
    params["project_id"] = ctx.state.session.project.id;
  }
  // `_WORKSPACE_SCOPED_FAMILIES` (Python PR #235): query + engage, classified
  // by longest prefix — identical to the old `startswith(query)` on the
  // live table (engage sits under the query prefix) and correct under
  // split overrides.
  const family = apiFamilyFor(url, currentEndpoints(ctx));
  // Explicit-only pin injection: a caller-supplied workspace_id always
  // wins (setdefault), and no
  // pin means nothing is injected — never an auto-resolution.
  if (
    callOptions.injectWorkspaceId !== false &&
    family !== null &&
    WORKSPACE_SCOPED_FAMILIES.has(family) &&
    ctx.state.workspaceId !== null &&
    !Object.hasOwn(params, "workspace_id")
  ) {
    params["workspace_id"] = ctx.state.workspaceId;
  }
  return executeWithRetry(executeDeps(ctx, callOptions.signal), {
    method,
    url,
    params,
    jsonData: callOptions.data ?? null,
    formData: callOptions.formData ?? null,
    headers: { Authorization: await getAuthHeader(ctx) },
    timeoutSeconds: callOptions.timeoutSeconds ?? null,
  });
}

/**
 * Assemble the {@link ClientCore} seam the domain factories consume.
 *
 * @param ctx - The client context.
 * @returns The core seam, bound to `ctx`.
 */
function buildClientCore(ctx: ClientContext): ClientCore {
  const { config, state } = ctx;
  return {
    timeoutSeconds: config.timeoutSeconds,
    defaultTimeoutSeconds: bindFirst(ctx, defaultTimeoutSeconds),
    exportTimeoutSeconds: config.exportTimeoutSeconds,
    maxRetries: config.maxRetries,
    sleep: config.sleep,
    random: config.random,
    now: config.now,
    tokenResolver: config.tokenResolver,
    logger: config.logger,
    session: (): Session => state.session,
    projectId: (): string => state.session.project.id,
    region: (): Region => state.session.account.region,
    workspaceId: (): number | null => state.workspaceId,
    endpointOverrides: config.getEndpointOverrides,
    endpoints: bindFirst(ctx, currentEndpoints),
    buildUrl: (kind: EndpointKind, path: string): string =>
      buildUrl(
        state.session.account.region,
        kind,
        path,
        config.getEndpointOverrides(),
      ),
    getAuthHeader: bindFirst(ctx, getAuthHeader),
    requestHeaders: bindFirst(ctx, coreRequestHeaders),
    http: bindFirst(ctx, ensureHttp),
    isHttpOpen: (): boolean => state.httpHandle !== null,
    closeHttp: (): void => {
      state.httpHandle = null;
    },
    executeDeps: bindFirst(ctx, executeDeps),
    appDeps: bindFirst(ctx, appDeps),
    rawRequest: (
      transportOptions: Parameters<RequestExecutor>[0],
      signal?: AbortSignal,
    ): Promise<RawFetchResult> =>
      rawFetch(ensureHttp(ctx).fetchImpl, transportOptions, signal),
    requestQueryHost: bindFirst(ctx, requestQueryHost),
  };
}

// ----- MixpanelClient members -----

async function listWorkspaces(ctx: ClientContext): Promise<PublicWorkspace[]> {
  const pid = ctx.state.session.project.id;
  const path = `/projects/${pid}/workspaces/public`;
  const results = await appRequest(appDeps(ctx), "GET", path);
  if (!Array.isArray(results)) {
    throw new MixpanelHeadlessError(
      `Unexpected response format from list_workspaces: ` +
        `expected list, got ${typeof results}`,
    );
  }
  return validateResponseModels(
    PublicWorkspace,
    results.map((item) => toNativeJson(item)),
    { endpoint: "list_workspaces" },
  );
}

async function projectsMetadataIndex(
  ctx: ClientContext,
): Promise<Record<string, JsonValue>> {
  const payload = await appRequest(
    appDeps(ctx),
    "GET",
    "/projects/metadata/index",
  );
  if (!isPlainRecord(payload)) {
    // Python logs a warning and treats the payload as empty.
    return {};
  }
  return payload;
}

async function resolveWorkspaceFromMetadata(
  ctx: ClientContext,
): Promise<number | null> {
  const pid = ctx.state.session.project.id;
  let index: Record<string, JsonValue>;
  try {
    index = await projectsMetadataIndex(ctx);
  } catch (error) {
    // 403/404 = index genuinely unavailable for this credential — a
    // clean "this source can't answer". Auth / rate-limit / server /
    // network errors propagate.
    if (
      error instanceof QueryError &&
      FALLBACK_HTTP_STATUSES.has(error.statusCode)
    ) {
      return null;
    }
    throw error;
  }
  const entry = Object.hasOwn(index, pid) ? index[pid] : undefined;
  if (entry === undefined || !isPlainRecord(entry)) {
    return null;
  }
  const rawWorkspaces = Object.hasOwn(entry, "workspaces")
    ? entry["workspaces"]
    : undefined;
  if (rawWorkspaces === undefined || !isPlainRecord(rawWorkspaces)) {
    return null;
  }
  const views: WorkspaceView[] = [];
  for (const raw of Object.values(rawWorkspaces)) {
    const view = workspaceViewFromMetadataEntry(raw);
    if (view !== null) {
      views.push(view);
    }
  }
  if (views.length === 0) {
    return null;
  }
  return selectWorkspaceId(views);
}

async function resolveWorkspaceId(ctx: ClientContext): Promise<number> {
  const { state } = ctx;
  if (state.workspaceId !== null) {
    return state.workspaceId;
  }
  if (state.cachedWorkspaceId !== null) {
    return state.cachedWorkspaceId;
  }
  const pid = state.session.project.id;
  if (state.meResolver !== null) {
    const resolved = await state.meResolver(pid);
    if (resolved !== null) {
      state.cachedWorkspaceId = resolved;
      return resolved;
    }
  }
  let publicWorkspaces: PublicWorkspace[];
  try {
    publicWorkspaces = await listWorkspaces(ctx);
  } catch (error) {
    // A 403/404 means this credential can't read /workspaces/public —
    // fall through to the metadata index.
    if (
      error instanceof QueryError &&
      FALLBACK_HTTP_STATUSES.has(error.statusCode)
    ) {
      publicWorkspaces = [];
    } else {
      throw error;
    }
  }
  const publicId = selectWorkspaceId(
    publicWorkspaces.map((ws) => workspaceViewFromPublic(ws)),
  );
  if (publicId !== null) {
    state.cachedWorkspaceId = publicId;
    return publicId;
  }
  const metadataId = await resolveWorkspaceFromMetadata(ctx);
  if (metadataId !== null) {
    state.cachedWorkspaceId = metadataId;
    return metadataId;
  }
  throw new WorkspaceScopeError(
    `Could not resolve a workspace for project ` +
      `'${state.session.project.id}'. No workspace is pinned and none was ` +
      `discoverable via /me, /workspaces/public, or the projects metadata ` +
      `index. If the project has workspaces, pass one explicitly ` +
      `(MP_WORKSPACE_ID or Workspace(workspace=...)).`,
    "NO_WORKSPACES",
    { project_id: state.session.project.id },
  );
}

async function resolveWorkspace(ctx: ClientContext): Promise<WorkspaceRef> {
  const { state } = ctx;
  if (state.resolvedWorkspace !== null) {
    return state.resolvedWorkspace;
  }
  const workspaces = await listWorkspaces(ctx);
  const chosenId = selectWorkspaceId(
    workspaces.map((ws) => workspaceViewFromPublic(ws)),
  );
  if (chosenId === null) {
    throw new WorkspaceScopeError(
      `Project ${state.session.project.id} has no accessible workspaces.`,
    );
  }
  // `selectWorkspaceId` picked the id out of this very list.
  const chosen = defined(
    workspaces.find((ws) => ws.id === chosenId),
    "selected workspace",
  );
  const ref: WorkspaceRef = {
    id: chosen.id,
    name: chosen.name,
    is_default: chosen.is_default,
  };
  state.resolvedWorkspace = ref;
  state.cachedWorkspaceId = ref.id;
  return ref;
}

async function use(
  ctx: ClientContext,
  useOptions: ClientUseOptions = {},
): Promise<void> {
  const { config, state } = ctx;
  const account = useOptions.account ?? null;
  const projectInput = useOptions.project ?? null;
  const workspaceInput = useOptions.workspace ?? null;
  const projectObj: Project | null =
    typeof projectInput === "string" ? { id: projectInput } : projectInput;
  const workspaceObj: WorkspaceRef | null =
    typeof workspaceInput === "number"
      ? { id: workspaceInput }
      : workspaceInput;
  // The workspace axis is always passed to replace: a zero-axis use()
  // clears `session.workspace` (`Session.replace` sentinel semantics).
  const newSession = sessionReplace(state.session, {
    account,
    project: projectObj,
    workspace: workspaceObj,
  });
  // Atomic on success: probe the new account's header before swapping
  // anything. A failing probe leaves the prior session/header intact.
  let newCachedBasic: string | null;
  if (newSession.account.type === "service_account") {
    newCachedBasic = await accountAuthHeader(newSession.account, {});
  } else {
    await accountAuthHeader(newSession.account, {
      tokenResolver: config.tokenResolver,
    });
    newCachedBasic = null;
  }
  state.session = newSession;
  state.cachedBasicHeader = newCachedBasic;
  if (account !== null || projectObj !== null) {
    state.resolvedWorkspace = newSession.workspace ?? null;
    state.cachedWorkspaceId = null;
  }
  // Unconditional pin sync: without it,
  // maybeScopedPath keeps emitting /workspaces/<old>/… and the
  // query-host injection keeps sending a stale workspace_id.
  state.workspaceId = newSession.workspace?.id ?? null;
  if (workspaceObj !== null) {
    state.workspaceId = workspaceObj.id;
    state.resolvedWorkspace = workspaceObj;
  }
}

// `require_scoped_path`: shared by the public client member and the
// feature-flag factory (feature flags are the require-scoped domain).
async function requireScopedPath(
  ctx: ClientContext,
  domainPath: string,
): Promise<string> {
  const wsId = await resolveWorkspaceId(ctx);
  return `/projects/${ctx.state.session.project.id}/workspaces/${wsId}/${domainPath}`;
}

async function request(
  ctx: ClientContext,
  method: string,
  url: string,
  requestOptions: ClientRequestOptions = {},
): Promise<JsonValue> {
  // Python builds {Authorization} then update(headers) — caller
  // extras win on collision.
  const headers: Record<string, string> = {
    Authorization: await getAuthHeader(ctx),
    ...requestOptions.headers,
  };
  return executeWithRetry(executeDeps(ctx, requestOptions.signal), {
    method,
    url,
    params: requestOptions.params ?? null,
    jsonData: requestOptions.jsonBody ?? null,
    headers,
    timeoutSeconds: requestOptions.timeoutSeconds ?? null,
  });
}

function clientAppRequest(
  ctx: ClientContext,
  method: string,
  path: string,
  appOptions: ClientAppRequestOptions = {},
): Promise<JsonValue> {
  return appRequest(appDeps(ctx, appOptions.signal), method, path, {
    params: appOptions.params,
    jsonBody: appOptions.jsonBody,
    formBody: appOptions.formBody,
    raw: appOptions.raw,
  });
}

function withProject(
  ctx: ClientContext,
  projectId: string,
  newWorkspaceId: number | null = null,
): MixpanelClient {
  const { config, state } = ctx;
  // Truthy workspace check for the session axis, `is not None` for
  // the pin — exactly Python's two different guards.
  const newSession = sessionReplace(state.session, {
    project: { id: projectId },
    workspace: newWorkspaceId ? { id: newWorkspaceId } : null,
  });
  const newClient = createMixpanelClient({
    session: newSession,
    timeoutSeconds: config.timeoutSeconds,
    exportTimeoutSeconds: config.exportTimeoutSeconds,
    maxRetries: config.maxRetries,
    tokenResolver: config.tokenResolver,
    fetch: config.fetchImpl,
    sleep: config.sleep,
    random: config.random,
    now: config.now,
    logger: config.logger,
    getCustomHeaderEnv: config.getCustomHeaderEnv,
    endpointOverrides: config.endpointOverridesSource,
  });
  if (newWorkspaceId !== null) {
    newClient.setWorkspaceId(newWorkspaceId);
  }
  return newClient;
}

async function me(ctx: ClientContext): Promise<Record<string, JsonValue>> {
  const result = await appRequest(appDeps(ctx), "GET", "/me");
  if (!isPlainRecord(result)) {
    return { results: result };
  }
  return result;
}

/**
 * Assemble a Mixpanel API client.
 *
 * @param options - Session + seams (see {@link MixpanelClientOptions}).
 * @returns The assembled client.
 * @example
 * ```typescript
 * const client = createMixpanelClient({ session, fetch: harness.fetch });
 * const events = await client.request(
 *   "GET",
 *   "https://mixpanel.com/api/app/test",
 * );
 * ```
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.__init__
 */
export function createMixpanelClient(
  options: MixpanelClientOptions,
): MixpanelClient {
  const endpointOverridesSource = options.endpointOverrides;
  const config: ClientConfig = {
    timeoutSeconds: options.timeoutSeconds ?? null,
    exportTimeoutSeconds: options.exportTimeoutSeconds ?? 600.0,
    maxRetries: options.maxRetries ?? 3,
    tokenResolver: options.tokenResolver ?? null,
    fetchImpl: options.fetch ?? fetch,
    sleep: options.sleep ?? defaultSleep,
    random: options.random ?? Math.random,
    now: options.now ?? ((): Date => new Date()),
    logger: options.logger,
    getCustomHeaderEnv:
      options.getCustomHeaderEnv ??
      ((): { name?: string; value?: string } => ({})),
    endpointOverridesSource,
    getEndpointOverrides: endpointOverridesProvider(endpointOverridesSource),
  };
  const state: ClientState = {
    session: options.session,
    cachedBasicHeader: null,
    workspaceId: options.session.workspace?.id ?? null,
    cachedWorkspaceId: null,
    resolvedWorkspace: options.session.workspace ?? null,
    meResolver: null,
    httpHandle: null,
  };
  const ctx: ClientContext = { config, state };
  const core = buildClientCore(ctx);

  const client: MixpanelClient = {
    // --- Domain-method factories ---
    ...createQueryHostMethods(core, {
      resolveWorkspaceId: bindFirst(ctx, resolveWorkspaceId),
    }),
    ...createEngageMethods(core),
    ...createStreamingMethods(core),
    ...createDashboardMethods(core),
    ...createBookmarkMethods(core),
    ...createBookmarkUrlMethods(core),
    ...createCohortMethods(core),
    ...createFlagMethods(core, {
      requireScopedPath: bindFirst(ctx, requireScopedPath),
    }),
    ...createExperimentMethods(core),
    ...createAnnotationMethods(core),
    ...createWebhookMethods(core),
    ...createAlertMethods(core),
    ...createSchemaMethods(core),
    ...createLexiconMethods(core),
    ...createDropFilterMethods(core),
    ...createCustomPropertyMethods(core),
    ...createLookupTableMethods(core),
    ...createCustomEventMethods(core),
    ...createSchemaEnforcementMethods(core),
    ...createAuditMethods(core),
    ...createAnomalyMethods(core),
    ...createDeletionRequestMethods(core),
    ...createBusinessContextMethods(core),
    ...createReplaysSigningMethods(core),
    get session(): Session {
      return state.session;
    },
    get projectId(): string {
      return state.session.project.id;
    },
    get region(): Region {
      return state.session.account.region;
    },
    get workspaceId(): number | null {
      return state.workspaceId;
    },
    get hasWorkspaceResolver(): boolean {
      return state.meResolver !== null;
    },
    core,
    currentAuthHeader: bindFirst(ctx, getAuthHeader),
    setWorkspaceResolver: (resolver: WorkspaceResolver | null): void => {
      state.meResolver = resolver;
    },
    request: bindFirst(ctx, request),
    appRequest: bindFirst(ctx, clientAppRequest),
    requestQueryHost: bindFirst(ctx, requestQueryHost),
    use: bindFirst(ctx, use),
    resolveWorkspace: bindFirst(ctx, resolveWorkspace),
    setWorkspaceId: (value: number | null): void => {
      state.workspaceId = value;
      if (value === null) {
        state.cachedWorkspaceId = null;
      }
    },
    resolveWorkspaceId: bindFirst(ctx, resolveWorkspaceId),
    projectsMetadataIndex: bindFirst(ctx, projectsMetadataIndex),
    resolveWorkspaceFromMetadata: bindFirst(ctx, resolveWorkspaceFromMetadata),
    maybeScopedPath: (domainPath: string): string =>
      maybeScopedPath(domainPath, {
        projectId: state.session.project.id,
        workspaceId: state.workspaceId,
      }),
    requireScopedPath: bindFirst(ctx, requireScopedPath),
    withProject: bindFirst(ctx, withProject),
    me: bindFirst(ctx, me),
    listWorkspaces: bindFirst(ctx, listWorkspaces),
    ensureHttpOpen: (): void => {
      ensureHttp(ctx);
    },
    isHttpOpen: (): boolean => state.httpHandle !== null,
    httpHandle: bindFirst(ctx, ensureHttp),
    close: (): Promise<void> => {
      state.httpHandle = null;
      return Promise.resolve();
    },
    [Symbol.asyncDispose]: (): Promise<void> => {
      state.httpHandle = null;
      return Promise.resolve();
    },
  };

  return client;
}
