/**
 * `createMixpanelClient` — the client-core factory (Phase-3 packet
 * B4-C1): TS port of `MixpanelAPIClient` construction, session axes,
 * scoping, workspace resolution, and the public `request()` escape
 * hatch (`mixpanel_headless/_internal/api_client.py` C1 ranges).
 *
 * R2.9: a factory over an injectable transport, never a class
 * singleton. R10.8: every shared internal is IMPORTED from its B0
 * module by name (`internals.ts` retry/handler, `app-request.ts`,
 * `headers.ts` 4-layer merge, `url.ts` builders, `scope.ts`,
 * `backoff.ts`) — this file re-implements none of them.
 *
 * Domain wire methods land as `create<Domain>Methods(core)` factories
 * (B4-C2..C5) spread into the assembled client at the marked append-only
 * merge point below; `pagination.ts` consumes the same
 * {@link ClientCore} seam.
 *
 * R6.7 (B0-ARB carried item 6a): per-call `AbortSignal`s thread through
 * signal-aware `request`/`sleep` closures built HERE at client assembly
 * ({@link ClientCore.executeDeps} / {@link ClientCore.appDeps}) — the B0
 * module signatures are untouched; every cancellation exit normalizes
 * to `DOMException(..., 'AbortError')`.
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
 * (`api_client.py`). They let auto-resolution fall through to the
 * next source; 5xx / 401 / 429 / network errors still propagate.
 */
const FALLBACK_HTTP_STATUSES: ReadonlySet<number> = new Set([403, 404]);

/**
 * The env-pair provider seam for header layer 2 (R9.4: `core` never
 * reads `process.env`; the node package wires the real env source).
 */
export type CustomHeaderEnvSource = () => {
  readonly name?: string | undefined;
  readonly value?: string | undefined;
};

// Client-core seam types — defined in `core.ts` (§10.4), re-exported
// here so the public barrel and existing importers resolve unchanged.
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
   * Request timeout in seconds for regular requests. When `null`/absent
   * (the default, Python `timeout: float | None = None`), each request
   * gets a route-aware timeout sized to outlast the server's own
   * deadline (135s on App API routes, 503s otherwise), so the server —
   * not this client — resolves a slow request. An explicit value
   * applies to every request.
   */
  readonly timeoutSeconds?: number | null | undefined;
  /** Request timeout for export operations (Python default 600). */
  readonly exportTimeoutSeconds?: number | undefined;
  /**
   * Maximum retry attempts for rate-limited requests (Python default 3,
   * `api_client.py`).
   */
  readonly maxRetries?: number | undefined;
  /**
   * Token resolver for OAuth accounts. Python defaults to the on-disk
   * resolver; in `core` the default is NONE (the node package supplies
   * it — R9.1/R9.4), and OAuth auth-header resolution without one
   * throws the Phase-2 `ParamTypeError`.
   */
  readonly tokenResolver?: TokenResolver | null | undefined;
  /** Injectable transport (R2.4; the TS analog of `_transport`). */
  readonly fetch?: typeof fetch | undefined;
  /** Sleep seam in MILLISECONDS (R2.12/R6.3; fake-timer friendly). */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  /** Uniform-[0,1) RNG for backoff jitter (playbook Discrepancy #1). */
  readonly random?: RandomSource | undefined;
  /** Clock seam (unused by C1 paths; threaded for later shards). */
  readonly now?: (() => Date) | undefined;
  /** Optional retry-warning logger. */
  readonly logger?: RetryLogger | undefined;
  /** Header layer-2 env pair provider (defaults to an empty source). */
  readonly getCustomHeaderEnv?: CustomHeaderEnvSource | undefined;
  /**
   * Alternate-host routing (Python PR #235: `MP_API_BASE_URL` /
   * `MP_APP_BASE_URL`). `apiBaseUrl` routes EVERY API family at one
   * base (`query` → `/api/query`, `export` → `/api/2.0`, `engage` →
   * `/api/query/engage`, `app` → `/api/app`); `appBaseUrl` re-homes only
   * the App API. Pass a static bag, or a provider that is consulted on
   * EVERY request (the node package wires a `process.env` reader, the
   * twin of Python's per-request `os.environ` read). Absent → the live
   * per-region hosts, byte-identical to before.
   */
  readonly endpointOverrides?: EndpointOverridesSource | undefined;
}

/**
 * The assembled Mixpanel API client (C1 core surface; B4-C2..C5 extend
 * this interface with their domain methods at the marked merge point —
 * C2 landed: query-host + engage + streaming/export; C3 landed:
 * dashboards + bookmarks-v2 + cohorts-app entity CRUD; C4 landed:
 * flags + experiments + annotations + webhooks + alerts; C5 landed:
 * schemas + lexicon + drop filters + custom properties + lookup
 * tables + custom events + schema enforcement + audit + anomalies +
 * deletion requests + business context + replays signing).
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
  /** @internal The shared internals seam (B4-C2..C6 factories). */
  readonly core: ClientCore;

  /**
   * The current Authorization header value, computed on every access
   * (Python `current_auth_header` property; a property doing token I/O
   * becomes a method per R3.1).
   *
   * @returns The header value (`Basic ...` or `Bearer ...`).
   */
  currentAuthHeader: () => Promise<string>;

  /**
   * Install a `/me`-backed workspace resolver for auto-discovery
   * (`set_workspace_resolver`, `api_client.py`).
   *
   * @param resolver - The resolver, or `null` to clear.
   */
  setWorkspaceResolver: (resolver: WorkspaceResolver | null) => void;

  /**
   * Make an authenticated request to any Mixpanel API endpoint — the
   * escape hatch (`request`, `api_client.py`). No `project_id`
   * injection (the caller controls the URL); `query_origin` is injected
   * by the retry core.
   *
   * @param method - HTTP method.
   * @param url - Full URL to request.
   * @param options - Optional params/body/headers/timeout/signal.
   * @returns Parsed JSON response.
   * @throws AuthenticationError - Invalid credentials (401).
   * @throws RateLimitError - Rate limit exceeded after max retries.
   * @throws QueryError - Invalid parameters (400/403/404/other 4xx).
   * @throws ServerError - Server-side errors (5xx).
   * @throws MixpanelHeadlessError - Network/connection errors
   *   (`HTTP_ERROR`).
   */
  request: (
    method: string,
    url: string,
    options?: ClientRequestOptions,
  ) => Promise<JsonValue>;

  /**
   * Make an authenticated App API request (`app_request` — the B0
   * `app-request.ts` implementation reached through this client's
   * per-call deps).
   *
   * @param method - HTTP method.
   * @param path - App API path (e.g. `/projects/12345/dashboards`).
   * @param options - Optional params/body/raw/signal.
   * @returns The `results` field when present (unless `raw`), the full
   *   body otherwise; `{status: "ok"}` for 204.
   * @throws ParamValidationError - Both body kinds provided (AC1).
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError | MixpanelHeadlessError - Per the B0 contract.
   */
  appRequest: (
    method: string,
    path: string,
    options?: ClientAppRequestOptions,
  ) => Promise<JsonValue>;

  /**
   * @internal The query-host request path (`_request`). See
   * {@link ClientCore.requestQueryHost}.
   * @param method - HTTP method.
   * @param url - Full URL.
   * @param options - Params/body/injection flags.
   * @returns Parsed lossless JSON response.
   */
  requestQueryHost: (
    method: string,
    url: string,
    options?: QueryHostRequestOptions,
  ) => Promise<JsonValue>;

  /**
   * Swap one or more session axes in place, preserving the HTTP
   * transport (`use`, `api_client.py`; R6.2).
   *
   * Per Research R5: `use(workspace=W)` is in-memory only;
   * `use(project=P)` / `use(account=A)` clear the resolved-workspace
   * cache; `use(account=A)` rebuilds the auth header ATOMICALLY (the
   * prior session/header survive when the new account's token probe
   * fails). Any call that does not supply `workspace` (including a
   * zero-axis `use()`) clears both `session.workspace` and the pin.
   *
   * @param options - The axes to swap.
   * @throws OAuthError | ParamTypeError - New-account auth probe
   *   failures (state unchanged).
   */
  use: (options?: ClientUseOptions) => Promise<void>;

  /**
   * Return the workspace for the current session, lazy-resolving once
   * (`resolve_workspace`, `api_client.py`).
   *
   * @returns The session's WorkspaceRef (cached per session lifetime).
   * @throws WorkspaceScopeError - No accessible workspaces.
   */
  resolveWorkspace: () => Promise<WorkspaceRef>;

  /**
   * Set or clear the explicit workspace ID for scoped requests
   * (`set_workspace_id`, `api_client.py`). Clearing also
   * drops the cached auto-discovered ID.
   *
   * @param workspaceId - Workspace ID to pin, or `null` to clear.
   */
  setWorkspaceId: (workspaceId: number | null) => void;

  /**
   * Resolve the workspace ID for scoped requests
   * (`resolve_workspace_id`, `api_client.py`): explicit pin →
   * cached id → injected `/me` resolver → `/workspaces/public` → the
   * projects metadata index → `WorkspaceScopeError`.
   *
   * @returns The resolved workspace ID (memoized).
   * @throws WorkspaceScopeError - Code `NO_WORKSPACES` when every
   *   source is exhausted.
   * @throws AuthenticationError | RateLimitError | ServerError |
   *   QueryError | MixpanelHeadlessError - Non-403/404 discovery
   *   failures propagate rather than masking as "no workspace".
   */
  resolveWorkspaceId: () => Promise<number>;

  /**
   * Fetch the projects metadata index (`projects_metadata_index`,
   * `api_client.py`).
   *
   * @returns The metadata payload keyed by project ID, or `{}` when the
   *   response is not a mapping.
   */
  projectsMetadataIndex: () => Promise<Record<string, JsonValue>>;

  /**
   * @internal Resolve a workspace ID from the metadata index
   * (`_resolve_workspace_from_metadata`, `api_client.py`).
   * @returns The chosen id, or `null` when the index can't answer.
   */
  resolveWorkspaceFromMetadata: () => Promise<number | null>;

  /**
   * Build an optionally workspace-scoped API path
   * (`maybe_scoped_path` — B0 `scope.ts` over this client's pin state).
   *
   * @param domainPath - Domain-relative path (e.g. `"dashboards"`).
   * @returns `/workspaces/{wid}/{path}` when pinned, else
   *   `/projects/{pid}/{path}`.
   */
  maybeScopedPath: (domainPath: string) => string;

  /**
   * Build a workspace-scoped API path, auto-discovering if needed
   * (`require_scoped_path`, `api_client.py`).
   *
   * @param domainPath - Domain-relative path.
   * @returns `/projects/{pid}/workspaces/{wid}/{domainPath}`.
   * @throws WorkspaceScopeError - No workspaces found for the project.
   */
  requireScopedPath: (domainPath: string) => Promise<string>;

  /**
   * Create a new client for a different project, sharing the transport
   * seams (`with_project`, `api_client.py`).
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
   * Call `GET /api/app/me` (`me`, `api_client.py`). Not
   * project-scoped.
   *
   * @returns The raw `/me` payload (a non-mapping result is wrapped as
   *   `{results: ...}`).
   */
  me: () => Promise<Record<string, JsonValue>>;

  /**
   * List public workspaces for the current project (`list_workspaces`,
   * `api_client.py`).
   *
   * @returns Validated {@link PublicWorkspace} models.
   * @throws ResponseValidationError - A workspace entry fails model
   *   validation (`RESPONSE_VALIDATION_ERROR`).
   * @throws MixpanelHeadlessError - Non-list response payload.
   */
  listWorkspaces: () => Promise<PublicWorkspace[]>;

  /**
   * @internal Force pool-token creation (`_ensure_client` /
   * `__enter__`); Layer-3 lifecycle tests peek via
   * {@link isHttpOpen}/{@link httpHandle}.
   */
  ensureHttpOpen: () => void;

  /** @internal @returns Whether the pool token exists (`_client is not None`). */
  isHttpOpen: () => boolean;

  /**
   * @internal The pool token, lazily created (`_http` property — the
   * R6.2 identity the transport-preservation tests compare).
   * @returns The handle.
   */
  httpHandle: () => HttpHandle;

  /** Close the HTTP client and release resources (`close`). */
  close: () => Promise<void>;

  /** R6.2: `async with` ports as `await using` / explicit `close()`. */
  [Symbol.asyncDispose]: () => Promise<void>;
}

/** Default sleep seam: real timers, milliseconds. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Wrap the injected sleep so a per-call signal can cancel a backoff
 * wait (R6.7 point 3: "into the backoff sleep"), rejecting with a
 * normalized `AbortError` DOMException.
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
   * PR #235: the override SOURCE is kept (not its value) so a provider is
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

/** `_endpoints_for(self._session.account.region)` — per call. */
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
// timeout wins; else route-aware, reading the CURRENT session's region
// (an account swap via `use()` re-routes, exactly like Python's
// `self._session.account.region` read).
function defaultTimeoutSeconds(ctx: ClientContext, url: string): number {
  if (ctx.config.timeoutSeconds !== null) {
    return ctx.config.timeoutSeconds;
  }
  // Family classification (longest prefix, PR #235) replaces the old
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
  // without rebuilding the client (`api_client.py`).
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
    // Snapshot of the provider's CURRENT value — `appDeps()` is built per
    // call, so this is still a per-request read (PR #235).
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
  // `_WORKSPACE_SCOPED_FAMILIES` (PR #235): query + engage, classified
  // by longest prefix — identical to the old `startswith(query)` on the
  // live table (engage sits under the query prefix) and correct under
  // split overrides.
  const family = apiFamilyFor(url, currentEndpoints(ctx));
  // Explicit-only pin injection (`api_client.py`): a
  // caller-supplied workspace_id always wins (setdefault), and no
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

/** Assemble the {@link ClientCore} seam the domain factories consume. */
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
    // network errors propagate (`api_client.py`).
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
    // fall through to the metadata index (`api_client.py`).
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
  // The workspace axis is ALWAYS passed to replace: a zero-axis use()
  // clears `session.workspace` (`api_client.py` +
  // `Session.replace` sentinel semantics).
  const newSession = sessionReplace(state.session, {
    account,
    project: projectObj,
    workspace: workspaceObj,
  });
  // Atomic-on-success (`api_client.py`): probe the new
  // account's header BEFORE swapping anything. A failing probe leaves
  // the prior session/header intact.
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
  // Unconditional pin sync (`api_client.py`): without it,
  // maybeScopedPath keeps emitting /workspaces/<old>/… and the
  // query-host injection keeps sending a stale workspace_id.
  state.workspaceId = newSession.workspace?.id ?? null;
  if (workspaceObj !== null) {
    state.workspaceId = workspaceObj.id;
    state.resolvedWorkspace = workspaceObj;
  }
}

// `require_scoped_path`: shared by the public
// client member AND the C4 flag factory (feature flags are the
// require-scoped domain).
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
  // extras win on collision (`api_client.py`).
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
  // TRUTHY workspace check for the session axis, `is not None` for
  // the pin — exactly Python's two different guards
  // (`api_client.py`; watchlist §8 item 6).
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
 * Assemble a Mixpanel API client (the R2.9 factory).
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
    // === B4 domain-method merge point (append-only; one spread line
    // per shard — C2..C5; shards touch disjoint lines here). ===
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
