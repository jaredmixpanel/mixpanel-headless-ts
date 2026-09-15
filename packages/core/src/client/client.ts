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
 * merge point below; `pagination.ts` (B4-C6) consumes the same
 * {@link ClientCore} seam.
 *
 * R6.7 (B0-ARB carried item 6a): per-call `AbortSignal`s thread through
 * signal-aware `request`/`sleep` closures built HERE at client assembly
 * ({@link ClientCore.executeDeps} / {@link ClientCore.appDeps}) — the B0
 * module signatures are untouched; every cancellation exit normalizes
 * to `DOMException(..., 'AbortError')`.
 */

import {
  type Account,
  accountAuthHeader,
  type TokenResolver,
} from "../auth/account.js";
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
import { getUserAgent, requestHeaders } from "./headers.js";
import {
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
  type EndpointOverrides,
  endpointOverridesProvider,
  type EndpointOverridesSource,
  endpointsFor,
  type Region,
  WORKSPACE_SCOPED_FAMILIES,
} from "./url.js";

/**
 * HTTP statuses on a workspace-discovery source that mean "this source
 * can't answer for this credential" rather than a transient failure
 * (`api_client.py:72`). They let auto-resolution fall through to the
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
   * `api_client.py:312`).
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
  /** Optional retry-warning logger (R9.5). */
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

/** Per-call options of {@link MixpanelClient.request}. */
export interface ClientRequestOptions {
  /** Optional query parameters. */
  readonly params?: Record<string, unknown> | null | undefined;
  /** Optional JSON request body. */
  readonly jsonBody?: Record<string, unknown> | null | undefined;
  /** Optional additional headers (Authorization is added automatically). */
  readonly headers?: Readonly<Record<string, string>> | null | undefined;
  /** Optional request timeout in seconds. */
  readonly timeoutSeconds?: number | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Per-call options of the client's `appRequest` (Python kw-only args). */
export interface ClientAppRequestOptions {
  /** Optional query parameters. */
  readonly params?: Record<string, string> | null | undefined;
  /** Optional JSON request body (mutually exclusive with `formBody`). */
  readonly jsonBody?: Record<string, unknown> | null | undefined;
  /** Optional form-encoded body (mutually exclusive with `jsonBody`). */
  readonly formBody?: Record<string, string> | null | undefined;
  /** Return the full response without unwrapping `results` (Python `_raw`). */
  readonly raw?: boolean | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Options of the internal query-host request path (Python `_request`
 * kwargs; R2.8 — public but `@internal`).
 */
export interface QueryHostRequestOptions {
  /** Query parameters (MUTATED with injections, like Python). */
  readonly params?: Record<string, unknown> | null | undefined;
  /** JSON request body (Python `data=`). */
  readonly data?: Record<string, unknown> | null | undefined;
  /** Form-encoded request body. */
  readonly formData?: Record<string, string> | null | undefined;
  /** Override the default timeout (seconds). */
  readonly timeoutSeconds?: number | null | undefined;
  /** Auto-add `project_id` to query params (Python default True). */
  readonly injectProjectId?: boolean | undefined;
  /**
   * Inject the pinned `workspace_id` on Query-host requests (Python
   * default True; explicit opt-out forces a project-scoped query).
   */
  readonly injectWorkspaceId?: boolean | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** Axis-swap options of {@link MixpanelClient.use} (Python kw-only). */
export interface ClientUseOptions {
  /** Replacement account. */
  readonly account?: Account | null | undefined;
  /** Replacement project (`Project` or numeric-string project ID). */
  readonly project?: Project | string | null | undefined;
  /** Replacement workspace (`WorkspaceRef` or positive int). */
  readonly workspace?: WorkspaceRef | number | null | undefined;
}

/**
 * The lazily-created connection-pool token — the TS analog of the
 * `httpx.Client` instance whose IDENTITY the R6.2 connection-reuse
 * invariant tracks (`use()` preserves it; `close()` drops it; the next
 * request recreates it).
 */
export interface HttpHandle {
  /** The injected fetch this handle serves requests through. */
  readonly fetchImpl: typeof fetch;
}

/**
 * The shared internals seam the domain-method factories (B4-C2..C5) and
 * the paginator (B4-C6) build on. Everything here is `@internal`
 * surface (R2.8): public for cross-module access, excluded from the
 * published API docs.
 */
export interface ClientCore {
  /**
   * The explicit constructor timeout, or `null` for the route-aware
   * defaults (Python `self._timeout: float | None`).
   */
  readonly timeoutSeconds: number | null;
  /**
   * Resolve the read timeout for a request to `url` — TS port of
   * `_default_timeout` (`api_client.py:489-509`). An explicit
   * constructor timeout wins; otherwise the default is route-aware and
   * sized to outlast the server's own read deadline (~120s on App API
   * routes, 488s on query routes), so the server — never this client —
   * is the side that resolves a slow request.
   *
   * @param url - The full request URL.
   * @returns The timeout in seconds for the request.
   */
  defaultTimeoutSeconds: (url: string) => number;
  /** Export-operation timeout in seconds (`self._export_timeout`). */
  readonly exportTimeoutSeconds: number;
  /** Maximum 429 retries (`self._max_retries`). */
  readonly maxRetries: number;
  /** The injected sleep seam (ms). */
  readonly sleep: (ms: number) => Promise<void>;
  /** The injected RNG seam. */
  readonly random: RandomSource;
  /** The injected clock seam. */
  readonly now: () => Date;
  /** The bound token resolver, or `null`. */
  readonly tokenResolver: TokenResolver | null;
  /** Optional retry logger. */
  readonly logger: RetryLogger | undefined;

  /** @returns The current Session. */
  session: () => Session;
  /** @returns The bound project id (`session.project.id`). */
  projectId: () => string;
  /** @returns The bound region (`session.account.region`). */
  region: () => Region;
  /** @returns The explicit workspace pin, or `null`. */
  workspaceId: () => number | null;
  /**
   * The CURRENT override bag (the per-request provider's value —
   * `endpointOverrides` option, PR #235).
   *
   * @returns The override bag (frozen empty bag when none).
   */
  endpointOverrides: () => EndpointOverrides;
  /**
   * The family → base-URL table for the current session's region under
   * the current overrides (`_endpoints_for(region)`, PR #235).
   *
   * @returns The resolved table (the live object when nothing is overridden).
   */
  endpoints: () => ReadonlyMap<EndpointKind, string>;
  /**
   * Build the full URL for an API family + path (B0 `url.ts` by name).
   *
   * @param kind - The API family.
   * @param path - The endpoint path.
   * @returns The full URL.
   */
  buildUrl: (kind: EndpointKind, path: string) => string;
  /**
   * Resolve the Authorization header PER REQUEST (`_get_auth_header`,
   * `api_client.py:388-416`): service accounts return the cached Basic
   * header; OAuth variants delegate to the bound resolver every call.
   *
   * @returns The header value.
   */
  getAuthHeader: () => Promise<string>;
  /**
   * The B0 4-layer header merge, pre-bound to the CURRENT session
   * (`headers.ts` `requestHeaders` by name — never re-merged).
   *
   * @param extra - Per-call headers.
   * @returns The merged header set.
   */
  requestHeaders: (extra: Record<string, string>) => Record<string, string>;
  /**
   * The lazily-initialized pool token (`_ensure_client`).
   *
   * @returns The handle (created on first use).
   */
  http: () => HttpHandle;
  /** @returns Whether the handle currently exists (close-state peek). */
  isHttpOpen: () => boolean;
  /** Drop the pool token (`close()` body). */
  closeHttp: () => void;
  /**
   * Build per-call `executeWithRetry` deps with the signal curried into
   * the transport and sleep closures (R6.7 points 2 and 3).
   *
   * @param signal - Optional cancellation signal.
   * @returns The deps.
   */
  executeDeps: (signal?: AbortSignal) => RetryExecutorDeps;
  /**
   * Build per-call `appRequest` deps (same signal currying).
   *
   * @param signal - Optional cancellation signal.
   * @returns The deps.
   */
  appDeps: (signal?: AbortSignal) => AppRequestDeps;
  /**
   * Issue one raw (non-buffered) request through the adapter — the
   * streaming/export seam for B4-C2 and the paginator's raw-transport
   * path for B4-C6 (per-request auth is the CALLER's job, R2.8).
   *
   * @param options - The outbound request (B0 transport shape).
   * @param signal - Optional cancellation signal.
   * @returns The raw response wrapper.
   */
  rawRequest: (
    options: Parameters<RequestExecutor>[0],
    signal?: AbortSignal,
  ) => Promise<RawFetchResult>;
  /**
   * The query-host request path (`_request`, `api_client.py:822-920`):
   * project-id injection + explicit-only workspace-pin injection, then
   * `executeWithRetry` with a per-request auth header.
   *
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
   * (`set_workspace_resolver`, `api_client.py:352-374`).
   *
   * @param resolver - The resolver, or `null` to clear.
   */
  setWorkspaceResolver: (resolver: WorkspaceResolver | null) => void;

  /**
   * Make an authenticated request to any Mixpanel API endpoint — the
   * escape hatch (`request`, `api_client.py:921-976`). No `project_id`
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
   * transport (`use`, `api_client.py:1036-1113`; R6.2).
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
   * (`resolve_workspace`, `api_client.py:1114-1157`).
   *
   * @returns The session's WorkspaceRef (cached per session lifetime).
   * @throws WorkspaceScopeError - No accessible workspaces.
   */
  resolveWorkspace: () => Promise<WorkspaceRef>;

  /**
   * Set or clear the explicit workspace ID for scoped requests
   * (`set_workspace_id`, `api_client.py:1398-1425`). Clearing also
   * drops the cached auto-discovered ID.
   *
   * @param workspaceId - Workspace ID to pin, or `null` to clear.
   */
  setWorkspaceId: (workspaceId: number | null) => void;

  /**
   * Resolve the workspace ID for scoped requests
   * (`resolve_workspace_id`, `api_client.py:1427-1526`): explicit pin →
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
   * `api_client.py:1528-1562`).
   *
   * @returns The metadata payload keyed by project ID, or `{}` when the
   *   response is not a mapping.
   */
  projectsMetadataIndex: () => Promise<Record<string, JsonValue>>;

  /**
   * @internal Resolve a workspace ID from the metadata index
   * (`_resolve_workspace_from_metadata`, `api_client.py:1564-1635`).
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
   * (`require_scoped_path`, `api_client.py:1666-1694`).
   *
   * @param domainPath - Domain-relative path.
   * @returns `/projects/{pid}/workspaces/{wid}/{domainPath}`.
   * @throws WorkspaceScopeError - No workspaces found for the project.
   */
  requireScopedPath: (domainPath: string) => Promise<string>;

  /**
   * Create a new client for a different project, sharing the transport
   * seams (`with_project`, `api_client.py:1696-1741`).
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
   * Call `GET /api/app/me` (`me`, `api_client.py:1743-1769`). Not
   * project-scoped.
   *
   * @returns The raw `/me` payload (a non-mapping result is wrapped as
   *   `{results: ...}`).
   */
  me: () => Promise<Record<string, JsonValue>>;

  /**
   * List public workspaces for the current project (`list_workspaces`,
   * `api_client.py:1771-1807`).
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

/** Default sleep seam: real timers, milliseconds (R2.12/R6.3). */
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
  // Python `timeout: float | None = None` — `null` means "route-aware
  // defaults"; an explicit value applies to every request.
  const timeoutSeconds: number | null = options.timeoutSeconds ?? null;
  const exportTimeoutSeconds = options.exportTimeoutSeconds ?? 600.0;
  const maxRetries = options.maxRetries ?? 3;
  const tokenResolver = options.tokenResolver ?? null;
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? ((): Date => new Date());
  const logger = options.logger;
  const getCustomHeaderEnv: CustomHeaderEnvSource =
    options.getCustomHeaderEnv ??
    ((): { name?: string; value?: string } => ({}));
  // PR #235: the override SOURCE is kept (not its value) so a provider is
  // consulted on every request — Python's `_endpoints_for` reads
  // `os.environ` per call, never at construction.
  const endpointOverridesSource = options.endpointOverrides;
  const getEndpointOverrides = endpointOverridesProvider(
    endpointOverridesSource,
  );
  /** `_endpoints_for(self._session.account.region)` — per call. */
  const currentEndpoints = (): ReadonlyMap<EndpointKind, string> =>
    endpointsFor(session.account.region, getEndpointOverrides());

  // ----- mutable client state (the Python instance attributes) -----
  let session = options.session;
  // Python caches the ServiceAccount Basic header at construction; the
  // TS auth model is async, so the cache fills lazily on first use —
  // observationally identical (SA header derivation is pure and the
  // resolver is never consulted for SA, `_get_auth_header`).
  let cachedBasicHeader: string | null = null;
  let workspaceId: number | null = session.workspace?.id ?? null;
  let cachedWorkspaceId: number | null = null;
  let resolvedWorkspace: WorkspaceRef | null = session.workspace ?? null;
  let meResolver: WorkspaceResolver | null = null;
  let httpHandle: HttpHandle | null = null;

  const ensureHttp = (): HttpHandle => {
    if (httpHandle === null) {
      httpHandle = { fetchImpl };
    }
    return httpHandle;
  };

  // `_default_timeout` (`api_client.py:489-509`): explicit constructor
  // timeout wins; else route-aware, reading the CURRENT session's region
  // (an account swap via `use()` re-routes, exactly like Python's
  // `self._session.account.region` read).
  const defaultTimeoutSeconds = (url: string): number => {
    if (timeoutSeconds !== null) {
      return timeoutSeconds;
    }
    // Family classification (longest prefix, PR #235) replaces the old
    // `startswith(app)` check so App routes on an override host — even a
    // split `appBaseUrl` nested under the query prefix — keep the App
    // timeout.
    if (apiFamilyFor(url, currentEndpoints()) === "app") {
      return DEFAULT_APP_TIMEOUT_S;
    }
    return DEFAULT_QUERY_TIMEOUT_S;
  };

  const getAuthHeader = async (): Promise<string> => {
    const account = session.account;
    if (account.type === "service_account") {
      if (cachedBasicHeader === null) {
        cachedBasicHeader = await accountAuthHeader(account, {});
      }
      return cachedBasicHeader;
    }
    // OAuth variants re-resolve per call so a refreshed bearer surfaces
    // without rebuilding the client (`api_client.py:406-412`).
    return accountAuthHeader(account, { tokenResolver });
  };

  const coreRequestHeaders = (
    extra: Record<string, string>,
  ): Record<string, string> => {
    const sessionHeaders: Record<string, string> = Object.fromEntries(
      session.headers,
    );
    return requestHeaders(
      { getUserAgent, getCustomHeaderEnv, sessionHeaders },
      extra,
    );
  };

  const executeDeps = (signal?: AbortSignal): RetryExecutorDeps => ({
    request: createRequestExecutor(ensureHttp().fetchImpl, signal),
    sleep: signalAwareSleep(sleep, signal),
    random,
    maxRetries,
    defaultTimeoutSeconds,
    requestHeaders: coreRequestHeaders,
    projectId: session.project.id,
    logger,
  });

  const appDeps = (signal?: AbortSignal): AppRequestDeps => ({
    request: createRequestExecutor(ensureHttp().fetchImpl, signal),
    sleep: signalAwareSleep(sleep, signal),
    random,
    maxRetries,
    defaultTimeoutSeconds,
    requestHeaders: coreRequestHeaders,
    projectId: session.project.id,
    region: session.account.region,
    // Snapshot of the provider's CURRENT value — `appDeps()` is built per
    // call, so this is still a per-request read (PR #235).
    endpointOverrides: getEndpointOverrides(),
    getAuthHeader,
    logger,
  });

  const requestQueryHost = async (
    method: string,
    url: string,
    callOptions: QueryHostRequestOptions = {},
  ): Promise<JsonValue> => {
    const params = callOptions.params ?? {};
    if (callOptions.injectProjectId !== false) {
      params["project_id"] = session.project.id;
    }
    // `_WORKSPACE_SCOPED_FAMILIES` (PR #235): query + engage, classified
    // by longest prefix — identical to the old `startswith(query)` on the
    // live table (engage sits under the query prefix) and correct under
    // split overrides.
    const family = apiFamilyFor(url, currentEndpoints());
    // Explicit-only pin injection (`api_client.py:893-902`): a
    // caller-supplied workspace_id always wins (setdefault), and no
    // pin means nothing is injected — never an auto-resolution.
    if (
      callOptions.injectWorkspaceId !== false &&
      family !== null &&
      WORKSPACE_SCOPED_FAMILIES.has(family) &&
      workspaceId !== null &&
      !Object.hasOwn(params, "workspace_id")
    ) {
      params["workspace_id"] = workspaceId;
    }
    return executeWithRetry(executeDeps(callOptions.signal), {
      method,
      url,
      params,
      jsonData: callOptions.data ?? null,
      formData: callOptions.formData ?? null,
      headers: { Authorization: await getAuthHeader() },
      timeoutSeconds: callOptions.timeoutSeconds ?? null,
    });
  };

  const core: ClientCore = {
    timeoutSeconds,
    defaultTimeoutSeconds,
    exportTimeoutSeconds,
    maxRetries,
    sleep,
    random,
    now,
    tokenResolver,
    logger,
    session: (): Session => session,
    projectId: (): string => session.project.id,
    region: (): Region => session.account.region,
    workspaceId: (): number | null => workspaceId,
    endpointOverrides: getEndpointOverrides,
    endpoints: currentEndpoints,
    buildUrl: (kind: EndpointKind, path: string): string =>
      buildUrl(session.account.region, kind, path, getEndpointOverrides()),
    getAuthHeader,
    requestHeaders: coreRequestHeaders,
    http: ensureHttp,
    isHttpOpen: (): boolean => httpHandle !== null,
    closeHttp: (): void => {
      httpHandle = null;
    },
    executeDeps,
    appDeps,
    rawRequest: (
      transportOptions: Parameters<RequestExecutor>[0],
      signal?: AbortSignal,
    ): Promise<RawFetchResult> =>
      rawFetch(ensureHttp().fetchImpl, transportOptions, signal),
    requestQueryHost,
  };

  const listWorkspaces = async (): Promise<PublicWorkspace[]> => {
    const pid = session.project.id;
    const path = `/projects/${pid}/workspaces/public`;
    const results = await appRequest(appDeps(), "GET", path);
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
  };

  const projectsMetadataIndex = async (): Promise<
    Record<string, JsonValue>
  > => {
    const payload = await appRequest(
      appDeps(),
      "GET",
      "/projects/metadata/index",
    );
    if (!isPlainRecord(payload)) {
      // Python logs a warning and treats the payload as empty.
      return {};
    }
    return payload;
  };

  const resolveWorkspaceFromMetadata = async (): Promise<number | null> => {
    const pid = session.project.id;
    let index: Record<string, JsonValue>;
    try {
      index = await projectsMetadataIndex();
    } catch (error) {
      // 403/404 = index genuinely unavailable for this credential — a
      // clean "this source can't answer". Auth / rate-limit / server /
      // network errors propagate (`api_client.py:1590-1604`).
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
  };

  const resolveWorkspaceId = async (): Promise<number> => {
    if (workspaceId !== null) {
      return workspaceId;
    }
    if (cachedWorkspaceId !== null) {
      return cachedWorkspaceId;
    }
    const pid = session.project.id;
    if (meResolver !== null) {
      const resolved = await meResolver(pid);
      if (resolved !== null) {
        cachedWorkspaceId = resolved;
        return resolved;
      }
    }
    let publicWorkspaces: PublicWorkspace[];
    try {
      publicWorkspaces = await listWorkspaces();
    } catch (error) {
      // A 403/404 means this credential can't read /workspaces/public —
      // fall through to the metadata index (`api_client.py:1483-1498`).
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
      cachedWorkspaceId = publicId;
      return publicId;
    }
    const metadataId = await resolveWorkspaceFromMetadata();
    if (metadataId !== null) {
      cachedWorkspaceId = metadataId;
      return metadataId;
    }
    throw new WorkspaceScopeError(
      `Could not resolve a workspace for project ` +
        `'${session.project.id}'. No workspace is pinned and none was ` +
        `discoverable via /me, /workspaces/public, or the projects metadata ` +
        `index. If the project has workspaces, pass one explicitly ` +
        `(MP_WORKSPACE_ID or Workspace(workspace=...)).`,
      "NO_WORKSPACES",
      { project_id: session.project.id },
    );
  };

  const resolveWorkspace = async (): Promise<WorkspaceRef> => {
    if (resolvedWorkspace !== null) {
      return resolvedWorkspace;
    }
    const workspaces = await listWorkspaces();
    const chosenId = selectWorkspaceId(
      workspaces.map((ws) => workspaceViewFromPublic(ws)),
    );
    if (chosenId === null) {
      throw new WorkspaceScopeError(
        `Project ${session.project.id} has no accessible workspaces.`,
      );
    }
    const chosen = workspaces.find(
      (ws) => ws.id === chosenId,
    ) as PublicWorkspace;
    const ref: WorkspaceRef = {
      id: chosen.id,
      name: chosen.name,
      is_default: chosen.is_default,
    };
    resolvedWorkspace = ref;
    cachedWorkspaceId = ref.id;
    return ref;
  };

  const use = async (useOptions: ClientUseOptions = {}): Promise<void> => {
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
    // clears `session.workspace` (`api_client.py:1079-1081` +
    // `Session.replace` sentinel semantics).
    const newSession = sessionReplace(session, {
      account,
      project: projectObj,
      workspace: workspaceObj,
    });
    // Atomic-on-success (`api_client.py:1082-1095`): probe the new
    // account's header BEFORE swapping anything. A failing probe leaves
    // the prior session/header intact.
    let newCachedBasic: string | null;
    if (newSession.account.type === "service_account") {
      newCachedBasic = await accountAuthHeader(newSession.account, {});
    } else {
      await accountAuthHeader(newSession.account, { tokenResolver });
      newCachedBasic = null;
    }
    session = newSession;
    cachedBasicHeader = newCachedBasic;
    if (account !== null || projectObj !== null) {
      resolvedWorkspace = newSession.workspace ?? null;
      cachedWorkspaceId = null;
    }
    // Unconditional pin sync (`api_client.py:1101-1112`): without it,
    // maybeScopedPath keeps emitting /workspaces/<old>/… and the
    // query-host injection keeps sending a stale workspace_id.
    workspaceId = newSession.workspace?.id ?? null;
    if (workspaceObj !== null) {
      workspaceId = workspaceObj.id;
      resolvedWorkspace = workspaceObj;
    }
  };

  // `require_scoped_path` (`api_client.py:1666-1694`) as a named
  // closure: shared by the public client member below AND the C4 flag
  // factory (feature flags are the require-scoped domain).
  const requireScopedPath = async (domainPath: string): Promise<string> => {
    const wsId = await resolveWorkspaceId();
    return `/projects/${session.project.id}/workspaces/${wsId}/${domainPath}`;
  };

  const client: MixpanelClient = {
    // === B4 domain-method merge point (append-only; one spread line
    // per shard — C2..C5; shards touch disjoint lines here). ===
    ...createQueryHostMethods(core, { resolveWorkspaceId }),
    ...createEngageMethods(core),
    ...createStreamingMethods(core),
    ...createDashboardMethods(core),
    ...createBookmarkMethods(core),
    ...createBookmarkUrlMethods(core),
    ...createCohortMethods(core),
    ...createFlagMethods(core, { requireScopedPath }),
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
      return session;
    },
    get projectId(): string {
      return session.project.id;
    },
    get region(): Region {
      return session.account.region;
    },
    get workspaceId(): number | null {
      return workspaceId;
    },
    get hasWorkspaceResolver(): boolean {
      return meResolver !== null;
    },
    core,
    currentAuthHeader: getAuthHeader,
    setWorkspaceResolver: (resolver: WorkspaceResolver | null): void => {
      meResolver = resolver;
    },
    request: async (
      method: string,
      url: string,
      requestOptions: ClientRequestOptions = {},
    ): Promise<JsonValue> => {
      // Python builds {Authorization} then update(headers) — caller
      // extras win on collision (`api_client.py:963-965`).
      const headers: Record<string, string> = {
        Authorization: await getAuthHeader(),
        ...requestOptions.headers,
      };
      return executeWithRetry(executeDeps(requestOptions.signal), {
        method,
        url,
        params: requestOptions.params ?? null,
        jsonData: requestOptions.jsonBody ?? null,
        headers,
        timeoutSeconds: requestOptions.timeoutSeconds ?? null,
      });
    },
    appRequest: (
      method: string,
      path: string,
      appOptions: ClientAppRequestOptions = {},
    ): Promise<JsonValue> =>
      appRequest(appDeps(appOptions.signal), method, path, {
        params: appOptions.params,
        jsonBody: appOptions.jsonBody,
        formBody: appOptions.formBody,
        raw: appOptions.raw,
      }),
    requestQueryHost,
    use,
    resolveWorkspace,
    setWorkspaceId: (value: number | null): void => {
      workspaceId = value;
      if (value === null) {
        cachedWorkspaceId = null;
      }
    },
    resolveWorkspaceId,
    projectsMetadataIndex,
    resolveWorkspaceFromMetadata,
    maybeScopedPath: (domainPath: string): string =>
      maybeScopedPath(domainPath, {
        projectId: session.project.id,
        workspaceId,
      }),
    requireScopedPath,
    withProject: (
      projectId: string,
      newWorkspaceId: number | null = null,
    ): MixpanelClient => {
      // TRUTHY workspace check for the session axis, `is not None` for
      // the pin — exactly Python's two different guards
      // (`api_client.py:1725-1740`; watchlist §8 item 6).
      const newSession = sessionReplace(session, {
        project: { id: projectId },
        workspace: newWorkspaceId ? { id: newWorkspaceId } : null,
      });
      const newClient = createMixpanelClient({
        session: newSession,
        timeoutSeconds,
        exportTimeoutSeconds,
        maxRetries,
        tokenResolver,
        fetch: fetchImpl,
        sleep,
        random,
        now,
        logger,
        getCustomHeaderEnv,
        endpointOverrides: endpointOverridesSource,
      });
      if (newWorkspaceId !== null && newWorkspaceId !== undefined) {
        newClient.setWorkspaceId(newWorkspaceId);
      }
      return newClient;
    },
    me: async (): Promise<Record<string, JsonValue>> => {
      const result = await appRequest(appDeps(), "GET", "/me");
      if (!isPlainRecord(result)) {
        return { results: result };
      }
      return result;
    },
    listWorkspaces,
    ensureHttpOpen: (): void => {
      ensureHttp();
    },
    isHttpOpen: (): boolean => httpHandle !== null,
    httpHandle: ensureHttp,
    close: (): Promise<void> => {
      httpHandle = null;
      return Promise.resolve();
    },
    [Symbol.asyncDispose]: (): Promise<void> => {
      httpHandle = null;
      return Promise.resolve();
    },
  };

  return client;
}
