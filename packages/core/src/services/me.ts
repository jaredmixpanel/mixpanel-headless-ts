/**
 * `/me` orchestration: a two-level cache (in-memory arm plus an injected
 * {@link MeCacheStore}) in front of the client's raw `/me` call, the
 * project and workspace lookups over the cached response, and the
 * cache-only {@link MeService.resolveWorkspace} arm the client's workspace
 * auto-resolution reads through `setWorkspaceResolver`. The response
 * models live in `client/me.ts`; the on-disk cache store belongs to
 * `@mixpanel-headless/node`, so this package stays filesystem-free.
 *
 * @see mixpanel_headless._internal.me.MeService
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
 * Cache seam behind `MeService`: Python's `MeCache` reduced to the
 * three operations the service calls (`get`, `put`, `invalidate`) plus
 * the account name the 401 / 403 messages embed.
 *
 * @remarks
 * Every method may return a promise so the on-disk store can do
 * asynchronous I/O without changing this contract.
 * @see mixpanel_headless._internal.me.MeCache
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
 * The client slice `MeService` consumes (`api_client.me()`).
 */
export interface MeClient {
  /**
   * Fetch the raw `/me` payload.
   *
   * @returns The unwrapped `results` mapping.
   * @throws {@link AuthenticationError} - A 401 response.
   * @throws {@link QueryError} - Any other non-2xx response.
   */
  me: () => Promise<Record<string, JsonValue>>;
}

/** Options bag of the `MeService` constructor (Python kw-only). */
export interface MeServiceOptions {
  /**
   * Account-type discriminator picking the 403 → `ConfigError` wording:
   * `"service_account"` gets the message naming the missing
   * `user_details` scope; anything else (including `null`) gets the
   * generic "lacks /me permission" line.
   *
   * @defaultValue `null`
   */
  readonly accountType?: AccountType | null | undefined;
}

/** Options bag of {@link MeService.fetch} (Python kw-only). */
export interface MeFetchOptions {
  /**
   * Bypass both caches and call the API.
   *
   * @defaultValue `false`
   */
  readonly force_refresh?: boolean | undefined;
}

/** Options bag of {@link MeService.listWorkspaces}. */
export interface MeListWorkspacesOptions {
  /**
   * Only return workspaces of this project; absent → all.
   *
   * @defaultValue `null`
   */
  readonly project_id?: string | null | undefined;
}

/**
 * Build the in-memory {@link MeCacheStore} default (`core` owns no
 * filesystem; `@mixpanel-headless/node` supplies the on-disk twin).
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
 * Serve `/me` lookups through a two-level cache: the in-memory arm
 * first, then the injected {@link MeCacheStore}, then the network.
 *
 * @remarks
 * A fetched response is written to both cache levels; {@link peek} and
 * {@link resolveWorkspace} read the caches only and never call the API.
 * @example
 * ```typescript
 * const svc = new MeService(client, inMemoryMeCache("personal"), "us");
 * const me = await svc.fetch();
 * const projects = await svc.listProjects();
 * ```
 * @see mixpanel_headless._internal.me.MeService
 */
export class MeService {
  /** The client slice used for the uncached call. */
  readonly #client: MeClient;

  /** The injected cache store. */
  readonly #cache: MeCacheStore;

  /** Data residency region (carried, not branched on). */
  readonly #region: string;

  /** Account-type discriminator for the 403 wording. */
  readonly #accountType: AccountType | null;

  /** The in-memory arm of the two-level cache (`_cached_response`). */
  #cachedResponse: MeResponse | null = null;

  /**
   * Create the service.
   *
   * @param client - The client exposing `me()`.
   * @param cache - The cache store ({@link inMemoryMeCache}, or the
   *   on-disk store `@mixpanel-headless/node` supplies).
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

  /**
   * Return the data-residency region this service was constructed for.
   *
   * @returns The region code (`us` / `eu` / `in`).
   */
  get region(): string {
    return this.#region;
  }

  /**
   * Return the account name the bound cache store is scoped to.
   *
   * @returns The store's `accountName`.
   */
  get cacheAccountName(): string {
    return this.#cache.accountName;
  }

  /**
   * Return the cached `/me` response without any network call.
   *
   * Checks the in-memory arm first, then the store. Returns `null`
   * when both miss — it never calls the API, which is what preserves
   * the single-round-trip property of
   * `Workspace.get_business_context_chain()`.
   *
   * @returns The cached response, or `null`.
   * @see mixpanel_headless._internal.me.MeService.peek
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
   * Fetch the `/me` response, using the caches when available.
   *
   * @param options - `force_refresh` bypasses both caches.
   * @returns The response (cached or freshly fetched).
   * @throws {@link ConfigError} - A 401 (credentials invalid) or 403 (no
   *   `/me` permission); the 403 wording depends on the account type.
   * @throws {@link QueryError} - Any other API error, unchanged.
   * @see mixpanel_headless._internal.me.MeService.fetch
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
            ? // Wording mirrors Python's message verbatim.
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

    // The wire tree carries lossless numbers; Python validates the plain
    // `json.loads` output, so normalize first — the same `toNativeJson`
    // step every model-construction site performs.
    const response = MeResponse.fromDict(toNativeJson(raw));
    await this.#cache.put(response);
    this.#cachedResponse = response;
    return response;
  }

  /**
   * List accessible projects from the cached `/me` response.
   *
   * @returns `[project_id, MeProjectInfo]` pairs sorted by name.
   * @throws {@link ConfigError} - Propagated from `fetch()` (the 401 / 403
   *   mapping).
   * @see mixpanel_headless._internal.me.MeService.list_projects
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
   * Find one project by ID in the cached `/me` response.
   *
   * @param projectId - The project ID to look up.
   * @returns The info, or `null` when absent.
   * @throws {@link ConfigError} - Propagated from `fetch()` (the 401 / 403
   *   mapping).
   * @see mixpanel_headless._internal.me.MeService.find_project
   */
  async findProject(projectId: string): Promise<MeProjectInfo | null> {
    const me = await this.fetch();
    return me.projects.get(projectId) ?? null;
  }

  /**
   * List workspaces, optionally filtered by project.
   *
   * @param options - Optional `project_id` filter.
   * @returns Workspaces sorted by name.
   * @throws {@link ConfigError} - Propagated from `fetch()` (the 401 / 403
   *   mapping), or a non-numeric `project_id`.
   * @see mixpanel_headless._internal.me.MeService.list_workspaces
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
   * Find a project's default workspace.
   *
   * @param projectId - The project ID.
   * @returns The default workspace, or `null` when none is flagged.
   * @throws {@link ConfigError} - Propagated from `fetch()` (the 401 / 403
   *   mapping).
   * @see mixpanel_headless._internal.me.MeService.find_default_workspace
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
   * Resolve a project's best workspace id from the warm cache only — the
   * `setWorkspaceResolver` contract.
   *
   * Never triggers a network call and never writes the cache: a cold
   * cache answers `null` so the client falls back to
   * `/workspaces/public`.
   *
   * @param projectId - The project ID (numeric string).
   * @returns The chosen workspace id, or `null`.
   * @see mixpanel_headless._internal.me.MeService.resolve_workspace
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
    // tie-breaks follow `/me` source order because `workspaces` is an
    // insertion-ordered Map, not a plain object.
    const views = [...me.workspaces.values()]
      .filter((ws) => ws.project_id === pidInt)
      .map((ws) => workspaceViewFromMeWorkspace(ws));
    return selectWorkspaceId(views);
  }
}
