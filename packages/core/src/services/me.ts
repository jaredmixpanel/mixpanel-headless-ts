/**
 * `MeService` — TS port of `_internal/me.py:609-915` (Phase-3 packet
 * B6-W1 §3.3, the completion of the three-way `me.py` split).
 *
 * The other two thirds are already live and MUST NOT be re-derived
 * here (R10.8): the models plus `WorkspaceView` / `selectWorkspaceId`
 * landed at B4-C1 in `client/me.ts`, and the ON-DISK `MeCache`
 * (`me.py:413-607`) belongs to B8-N2 in `packages/node`. This module
 * takes the cache as an injected {@link MeCacheStore} and ships an
 * in-memory default so `packages/core` stays filesystem-free.
 *
 * The service is what makes the facade's `/me` trio work AND what the
 * client's workspace auto-resolution reads through
 * `setWorkspaceResolver` (`client.ts:1114`; Python `api_client.py:352`,
 * wired at `workspace.py:787`) — {@link MeService.resolveWorkspace} is
 * the cheap, cache-only arm of that contract.
 */

import type { AccountType } from "../auth/account.js";
import { type JsonValue, toNativeJson } from "../client/json-value.js";
import {
  type MeProjectInfo,
  MeResponse,
  type MeWorkspaceInfo,
  selectWorkspaceId,
  workspaceViewFromMeWorkspace,
} from "../client/me.js";
import { compareCodepoints } from "../compat/codepoint.js";
import { pythonInt } from "../compat/python-int.js";
import { AuthenticationError, ConfigError, QueryError } from "../errors.js";

/**
 * The cache seam behind {@link MeService} — the `MeCache` surface
 * (`me.py:470` `get`, `:546` `put`, `:597` `invalidate`) reduced to the
 * three operations the service calls, plus the account name the 401 /
 * 403 messages embed (`me.py:723`, read there as `cache._account_name`).
 *
 * Every method may return a promise so B8-N2's on-disk twin can do
 * asynchronous I/O without changing this contract.
 */
export interface MeCacheStore {
  /** Account this store is scoped to (`MeCache(account_name=…)`). */
  readonly accountName: string;

  /**
   * Read the cached response.
   *
   * @returns The cached response, or `null` on a miss/expiry.
   */
  get: () => MeResponse | null | Promise<MeResponse | null>;

  /**
   * Store a response.
   *
   * @param response - The response to cache.
   * @returns Nothing (a promise for asynchronous stores).
   */
  put: (response: MeResponse) => void | Promise<void>;

  /**
   * Drop the cached response.
   *
   * @returns Nothing (a promise for asynchronous stores).
   */
  invalidate: () => void | Promise<void>;
}

/**
 * The client slice {@link MeService} consumes (`api_client.me()`).
 */
export interface MeClient {
  /**
   * Fetch the raw `/me` payload.
   *
   * @returns The unwrapped `results` mapping.
   * @throws AuthenticationError - 401.
   * @throws QueryError - Any other non-2xx.
   */
  me: () => Promise<Record<string, JsonValue>>;
}

/** Options bag of the {@link MeService} constructor (Python kw-only). */
export interface MeServiceOptions {
  /**
   * Account-type discriminator picking the 403 → `ConfigError` wording
   * (`me.py:735-757`): `"service_account"` gets the 043 catalog E-10
   * text naming the `user_details` scope; anything else (including
   * `null`) gets the generic 042 line.
   */
  readonly accountType?: AccountType | null | undefined;
}

/** Options bag of {@link MeService.fetch} (Python kw-only). */
export interface MeFetchOptions {
  /** Bypass both caches and call the API. Default `false`. */
  readonly force_refresh?: boolean | undefined;
}

/** Options bag of {@link MeService.listWorkspaces}. */
export interface MeListWorkspacesOptions {
  /** Only return workspaces of this project; absent → all. */
  readonly project_id?: string | null | undefined;
}

/**
 * Build the in-memory {@link MeCacheStore} default (`packages/core`
 * owns no filesystem; B8-N2 supplies the on-disk twin in
 * `packages/node`).
 *
 * @param accountName - Account the cache is scoped to.
 * @returns A process-local store.
 * @example
 * ```typescript
 * const cache = inMemoryMeCache("personal");
 * const svc = new MeService(client, cache, "us");
 * ```
 */
export function inMemoryMeCache(accountName: string): MeCacheStore {
  let stored: MeResponse | null = null;
  return {
    accountName,
    get: (): MeResponse | null => stored,
    put: (response: MeResponse): void => {
      stored = response;
    },
    invalidate: (): void => {
      stored = null;
    },
  };
}

/**
 * Orchestration service for `/me` calls with caching — port of
 * `me.py:609-915`.
 *
 * @example
 * ```typescript
 * const svc = new MeService(client, inMemoryMeCache("personal"), "us");
 * const me = await svc.fetch();
 * const projects = await svc.listProjects();
 * ```
 */
export class MeService {
  /** The client slice used for the uncached call. */
  readonly #client: MeClient;

  /** The injected cache store. */
  readonly #cache: MeCacheStore;

  /** Data residency region (`me.py:656`; carried, not branched on). */
  readonly #region: string;

  /** Account-type discriminator for the 403 wording. */
  readonly #accountType: AccountType | null;

  /** The in-memory arm of the two-level cache (`_cached_response`). */
  #cachedResponse: MeResponse | null = null;

  /**
   * Create the service.
   *
   * @param client - The client exposing `me()`.
   * @param cache - The cache store (in-memory by default; on-disk in
   *   `packages/node` from B8-N2).
   * @param region - Data residency region (`us` / `eu` / `in`).
   * @param options - Optional account-type discriminator.
   */
  constructor(
    client: MeClient,
    cache: MeCacheStore,
    region: string,
    options: MeServiceOptions = {},
  ) {
    this.#client = client;
    this.#cache = cache;
    this.#region = region;
    this.#accountType = options.accountType ?? null;
  }

  /** The region this service was constructed for. */
  get region(): string {
    return this.#region;
  }

  /**
   * The bound cache's account name — the Python tests'
   * `svc._cache._account_name` read (`test_workspace_use.py:325`).
   */
  get cacheAccountName(): string {
    return this.#cache.accountName;
  }

  /**
   * Return the cached `/me` response without any network call
   * (`peek`, `me.py:661-687`).
   *
   * Checks the in-memory arm first, then the store. Returns `null`
   * when both miss — it never calls the API, which is what preserves
   * the single-round-trip property of
   * `Workspace.get_business_context_chain()`.
   *
   * @returns The cached response, or `null`.
   */
  async peek(): Promise<MeResponse | null> {
    if (this.#cachedResponse !== null) {
      return this.#cachedResponse;
    }
    const cached = await this.#cache.get();
    if (cached !== null) {
      this.#cachedResponse = cached;
    }
    return cached;
  }

  /**
   * Fetch the `/me` response, using the caches when available
   * (`fetch`, `me.py:689-765`).
   *
   * @param options - `force_refresh` bypasses both caches.
   * @returns The response (cached or freshly fetched).
   * @throws ConfigError - 401 (credentials invalid) or 403 (no `/me`
   *   permission); the 403 wording depends on the account type.
   * @throws QueryError - Any other API error, unchanged.
   */
  async fetch(options: MeFetchOptions = {}): Promise<MeResponse> {
    const forceRefresh = options.force_refresh ?? false;
    // Check in-memory cache first.
    if (!forceRefresh && this.#cachedResponse !== null) {
      return this.#cachedResponse;
    }
    // Check the store.
    if (!forceRefresh) {
      const cached = await this.#cache.get();
      if (cached !== null) {
        this.#cachedResponse = cached;
        return cached;
      }
    }
    // Call the API. 401 (re-login fix) and 403 (needs /me scope) get
    // actionable wording; everything else propagates.
    const accountName = this.#cache.accountName;
    let raw: Record<string, JsonValue>;
    try {
      raw = await this.#client.me();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw new ConfigError(
          `Credentials for account '${accountName}' are invalid (401). ` +
            `Run \`mp account test ${accountName}\` to confirm; if it's an ` +
            `oauth_browser account, run \`mp account login ${accountName}\`.`,
          { status_code: 401, account_name: accountName },
          { cause: error },
        );
      }
      if (error instanceof QueryError && error.statusCode === 403) {
        const message =
          this.#accountType === "service_account"
            ? // Error catalog E-10 — wording locked by
              // `tests/unit/test_me.py` and the CLI snapshot tests.
              `Service account '${accountName}' is missing the ` +
              `\`user_details\` scope.\n\n` +
              `Re-mint the SA in Mixpanel Settings → Service ` +
              `Accounts with that scope checked,\n` +
              `or pass --project ID explicitly to skip the /me ` +
              `lookup.`
            : `Account '${accountName}' lacks /me permission ` +
              `(403). Specify --project explicitly, or use an ` +
              `account whose credentials have /me scope.`;
        throw new ConfigError(
          message,
          { status_code: 403, account_name: accountName },
          { cause: error },
        );
      }
      throw error;
    }

    // The wire tree carries lossless numbers; Python validates the
    // PLAIN `json.loads` output (`me.py:762`), so normalize first —
    // the same `toNativeJson(...)` step every B4 model site performs
    // (`client.ts:879`).
    const response = MeResponse.fromDict(toNativeJson(raw));
    await this.#cache.put(response);
    this.#cachedResponse = response;
    return response;
  }

  /**
   * List accessible projects from the cached `/me` response
   * (`list_projects`, `me.py:767-786`).
   *
   * @returns `[project_id, MeProjectInfo]` pairs sorted by name.
   * @throws ConfigError - `fetch()` failures.
   */
  async listProjects(): Promise<Array<[string, MeProjectInfo]>> {
    const me = await this.fetch();
    const items: Array<[string, MeProjectInfo]> = [...me.projects];
    items.sort((a, b) =>
      compareCodepoints(a[1].name.toLowerCase(), b[1].name.toLowerCase()),
    );
    return items;
  }

  /**
   * Find one project by ID in the cached `/me` response
   * (`find_project`, `me.py:788-808`).
   *
   * @param projectId - The project ID to look up.
   * @returns The info, or `null` when absent.
   * @throws ConfigError - `fetch()` failures.
   */
  async findProject(projectId: string): Promise<MeProjectInfo | null> {
    const me = await this.fetch();
    return me.projects.get(projectId) ?? null;
  }

  /**
   * List workspaces, optionally filtered by project
   * (`list_workspaces`, `me.py:810-845`).
   *
   * @param options - Optional `project_id` filter.
   * @returns Workspaces sorted by name.
   * @throws ConfigError - `fetch()` failures, or a non-numeric
   *   `project_id`.
   */
  async listWorkspaces(
    options: MeListWorkspacesOptions = {},
  ): Promise<MeWorkspaceInfo[]> {
    const me = await this.fetch();
    let workspaces = [...me.workspaces.values()];

    const projectId = options.project_id ?? null;
    if (projectId !== null) {
      let pidInt: number;
      try {
        pidInt = pythonInt(projectId);
      } catch {
        throw new ConfigError(
          `Project ID must be numeric, got: '${projectId}'`,
          { project_id: projectId },
        );
      }
      workspaces = workspaces.filter((ws) => ws.project_id === pidInt);
    }

    return [...workspaces].sort((a, b) =>
      compareCodepoints(a.name.toLowerCase(), b.name.toLowerCase()),
    );
  }

  /**
   * Find a project's default workspace (`find_default_workspace`,
   * `me.py:847-867`).
   *
   * @param projectId - The project ID.
   * @returns The default workspace, or `null` when none is flagged.
   * @throws ConfigError - `fetch()` failures.
   */
  async findDefaultWorkspace(
    projectId: string,
  ): Promise<MeWorkspaceInfo | null> {
    const workspaces = await this.listWorkspaces({ project_id: projectId });
    for (const ws of workspaces) {
      if (ws.is_default === true) {
        return ws;
      }
    }
    return null;
  }

  /**
   * Resolve a project's best workspace id from the WARM cache only
   * (`resolve_workspace`, `me.py:869-915`) — the
   * `setWorkspaceResolver` contract.
   *
   * Never triggers a network call and never writes the cache: a cold
   * cache answers `null` so the client falls back to
   * `/workspaces/public`.
   *
   * @param projectId - The project ID (numeric string).
   * @returns The chosen workspace id, or `null`.
   */
  async resolveWorkspace(projectId: string): Promise<number | null> {
    const me = await this.peek();
    if (me === null) {
      return null;
    }
    let pidInt: number;
    try {
      pidInt = pythonInt(projectId);
    } catch {
      return null;
    }
    // Insertion-order values (the Python `me.workspaces.values()`
    // iteration): `selectWorkspaceId`'s "first non-hidden" / "first"
    // tie-breaks follow `/me` source order via the ordered Map
    // (B8-MAPFIX, `user-ratifications.md:14-22`).
    const views = [...me.workspaces.values()]
      .filter((ws) => ws.project_id === pidInt)
      .map((ws) => workspaceViewFromMeWorkspace(ws));
    return selectWorkspaceId(views);
  }
}
