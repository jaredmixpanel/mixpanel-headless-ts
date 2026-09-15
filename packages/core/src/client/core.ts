/**
 * The client-core seam — the `ClientCore` internals interface, the
 * `HttpHandle` pool token and the per-call request-option bags that the
 * domain-method factories (`services/**`, B4-C2..C5) and the paginator
 * (`pagination.ts`, B4-C6) build on.
 *
 * Split out of `client.ts` (CLEANUP-PLAN §10.4) so that a service module
 * can name the seam it receives without importing the module that
 * assembles the client from those very services — `client.ts` imports
 * every `create<Domain>Methods` factory as a value, so the previous
 * `import type { ClientCore } from "./client.js"` edge closed 24
 * type-only import cycles. This module has no dependency on
 * `client.ts`; `client.ts` re-exports everything here so the public
 * barrel and every existing importer resolve unchanged.
 */

import type { Account, TokenResolver } from "../auth/account.js";
import type { Project, Session, WorkspaceRef } from "../auth/session.js";
import type { AppRequestDeps } from "./app-request.js";
import type { RandomSource } from "./backoff.js";
import type {
  RequestExecutor,
  RetryExecutorDeps,
  RetryLogger,
} from "./internals.js";
import type { JsonValue } from "./json-value.js";
import type { RawFetchResult } from "./transport.js";
import type { EndpointKind, EndpointOverrides, Region } from "./url.js";

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
