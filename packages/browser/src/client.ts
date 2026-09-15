/**
 * Browser workspace factories — first-class `oauth_token` mode +
 * service-account refusal + Export-API exclusion (b9-packets.md §2.2 /
 * §2.3 / §2.4; contract arbiter R9.3 + plan §4.3 Tier C).
 *
 * Documented narrowing (R9.4 cite): resolver-path construction —
 * account / project / target axes over env, config, or bridge — is NOT
 * exposed in browser v1. None of those sources exist in a browser
 * (env is node-only per R9.4; there is no config file or bridge file),
 * so the only axes are the explicit options below, and the returned
 * facade keeps its resolver seams at the core
 * `UNPORTED_RESOLVER_SEAM`-throwing defaults (`Workspace.use(account=…)`
 * therefore cannot fetch a service account — §2.3 row 4).
 *
 * Never hand-assembled: the account union goes through core
 * `parseAccount`, the session through core `parseSession`, and the
 * `Authorization` header through the core header path
 * (`accountAuthHeader` via the client's TokenResolver seam) — the
 * binding-honesty analogue of P3-5 rule 3.
 */

import {
  type ClientUseOptions,
  createMixpanelClient,
  CREDENTIAL_KEYS,
  type CredentialStore,
  type EndpointKind,
  ENDPOINTS,
  type MixpanelClient,
  type MixpanelClientOptions,
  OAuthError,
  type OAuthTokenAccount,
  type OAuthTokens,
  parseAccount,
  parseOAuthTokens,
  parseSession,
  type Session,
  type TokenResolver,
  Workspace,
} from "@mixpanel-headless/core";

import { InMemoryCredentialStore } from "./credential-store.js";
import {
  BROWSER_EXPORT_UNSUPPORTED,
  BROWSER_SERVICE_ACCOUNT_REFUSED,
  BrowserUnsupportedError,
} from "./errors.js";

/** Options of {@link browserSession} (b9-packets.md §2.2 — pasted contract). */
export interface BrowserSessionOptions {
  /** Bearer token (server-minted or PKCE-obtained). */
  readonly token: string;
  /** Project ID — digit string (core `ProjectId`). */
  readonly projectId: string;
  /** Mixpanel data-residency region. */
  readonly region: "us" | "eu" | "in";
  /** Optional workspace pin for App-API / Query-host scoping. */
  readonly workspaceId?: number;
  /** Account name; default `"browser"`. */
  readonly accountName?: string;
}

/** Extra options of {@link createBrowserWorkspace} (§2.2 pasted contract). */
export interface BrowserWorkspaceOptions {
  /** Pre-built session (must be non-SA — §2.3 path 1). */
  readonly session?: Session;
  /** Credential store; default `new InMemoryCredentialStore()` (R9.3). */
  readonly store?: CredentialStore;
  /** Injectable transport (R2.4 seam); default `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  /** Extra core-client options (sleep/RNG/clock seams, retries, …). */
  readonly clientOptions?: Omit<MixpanelClientOptions, "session">;
}

/** Options of {@link createBrowserWorkspaceFromStore} (§2.2). */
export interface BrowserWorkspaceFromStoreOptions {
  /** Mixpanel data-residency region (selects the per-region keys). */
  readonly region: "us" | "eu" | "in";
  /** Project ID — digit string. */
  readonly projectId: string;
  /** The store holding tokens persisted by the login flow. */
  readonly store: CredentialStore;
  /** Optional workspace pin. */
  readonly workspaceId?: number;
  /** Account name; default `"browser"`. */
  readonly accountName?: string;
  /** Injectable transport (R2.4 seam); default `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  /**
   * Epoch-ms clock seam for the token-expiry gate (tests freeze it —
   * b9-packets.md §7 caution 5). Default `Date.now`.
   */
  readonly now?: () => number;
  /** Extra core-client options. */
  readonly clientOptions?: Omit<MixpanelClientOptions, "session">;
}

/**
 * Build the explanatory service-account refusal (R9.3: the message
 * names what was received, why it is refused, and the supported
 * alternatives; programs key on the CODE — R5).
 *
 * @param path - The §2.3 ingress path that fired (details bag).
 * @returns The coded error (throw at the call site).
 */
function serviceAccountRefusal(path: string): BrowserUnsupportedError {
  return new BrowserUnsupportedError(
    "Received a service_account credential in a browser build. " +
      "Service-account Basic credentials are long-lived secrets that " +
      "must not ship to a browser origin — the policy holds even though " +
      "CORS would technically permit the calls (plan §4.3 Tier C). Use " +
      "an oauth_token account (server-minted bearer handed to the " +
      "browser) or the redirect PKCE login flow instead.",
    BROWSER_SERVICE_ACCOUNT_REFUSED,
    { account_type: "service_account", path },
  );
}

/**
 * Resolve the static bearer of an `oauth_token` account — the browser
 * arm of `OnDiskTokenResolver.get_static_token`
 * (`token_resolver.py:250-282`). `token_env` is node-only (env reading
 * is forbidden in browser, R9.4 — documented narrowing; `browserSession`
 * can only build inline-token accounts, so the refusal arms are
 * reachable only via a hand-built session). Failure arms carry the
 * Python twin's code + details — `OAUTH_TOKEN_ERROR` with
 * `{account_name, env_var}` (env arm, `token_resolver.py:273-282`) /
 * `{account_name}` (model-invariant arm, `:267-272`) — so the "static
 * token unresolvable" condition is uniform across runtimes (B9-ARB-A
 * SEM-F1, `b9-reviewA-resolution.md`); only the MESSAGE is
 * browser-specific (out of contract, R5.4).
 *
 * @param account - The `oauth_token` account.
 * @returns The bearer token.
 */
function staticTokenFromAccount(account: OAuthTokenAccount): Promise<string> {
  const token = account.token;
  if (token !== undefined && token !== null) {
    return Promise.resolve(token.reveal());
  }
  const envName = account.token_env;
  if (envName === undefined || envName === null) {
    // Model invariant (`token XOR token_env`) — explicit raise so it
    // survives without assertions (`token_resolver.py:267-272`).
    return Promise.reject(
      new OAuthError(
        `OAuth account '${account.name}' has neither \`token\` nor ` +
          "`token_env`.",
        "OAUTH_TOKEN_ERROR",
        { account_name: account.name },
      ),
    );
  }
  return Promise.reject(
    new OAuthError(
      `OAuth account '${account.name}' references env var ` +
        `\`${envName}\`, but environment access is node-only (R9.4) — ` +
        "env vars cannot be read in a browser. Pass an inline token " +
        "instead.",
      "OAUTH_TOKEN_ERROR",
      { account_name: account.name, env_var: envName },
    ),
  );
}

/**
 * Read, gate, and parse the persisted tokens for a region — the shared
 * chain of `createBrowserWorkspaceFromStore` and the per-request
 * store-backed resolver (R2.5 per-request resolution re-runs it):
 * absent → `OAUTH_TOKEN_ERROR`; SA-shaped record → §2.3 path-3
 * refusal (immediately after decode, before any header/token use);
 * malformed → strict `parseOAuthTokens` rejection (no lax read path —
 * the store only reads its own writes, §2.1); expired →
 * `OAUTH_TOKEN_ERROR`.
 *
 * @param store - The credential store.
 * @param region - Mixpanel region (selects the key).
 * @param now - Optional epoch-ms clock for the expiry gate.
 * @returns The parsed, unexpired token set.
 */
async function readStoredTokens(
  store: CredentialStore,
  region: string,
  now: (() => number) | undefined,
): Promise<OAuthTokens> {
  const raw = await store.get(CREDENTIAL_KEYS.tokens(region));
  if (raw === null) {
    throw new OAuthError(
      `No persisted tokens for region '${region}' in the credential ` +
        "store — run the login flow (or construct with an inline " +
        "oauth_token) first.",
      "OAUTH_TOKEN_ERROR",
      { region },
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    throw new OAuthError(
      `Persisted tokens for region '${region}' are not valid JSON.`,
      "OAUTH_TOKEN_ERROR",
      { region },
      { cause: error },
    );
  }
  if (
    typeof decoded === "object" &&
    decoded !== null &&
    (decoded as Record<string, unknown>)["type"] === "service_account"
  ) {
    // §2.3 path 3: someone wrote SA credentials into the store
    // out-of-band (e.g. localStorage) — refuse before parse/use.
    throw serviceAccountRefusal("createBrowserWorkspaceFromStore(store)");
  }
  const tokens = parseOAuthTokens(decoded);
  if (tokens.isExpired({ now })) {
    // TODO(port): the refresh-token grant (`flow.py:442-498`) is OUT of
    // browser v1 scope (b9-packets.md §2.2 disposition — an R2
    // follow-on under the D2-ACCEPTED branch, not silently added here).
    const hasRefresh = tokens.refresh_token !== null;
    throw new OAuthError(
      hasRefresh
        ? `Persisted tokens for region '${region}' are expired; token ` +
            "refresh is not supported in browser v1 — re-run the login " +
            "flow (or refresh via the node package)."
        : `Persisted tokens for region '${region}' are expired and ` +
            "carry no refresh token — re-run the login flow.",
      "OAUTH_TOKEN_ERROR",
      { region, has_refresh_token: hasRefresh },
    );
  }
  return tokens;
}

/**
 * Build the browser TokenResolver over a credential store: static
 * tokens resolve inline; browser-account tokens re-read the store on
 * EVERY request (R2.5 per-request resolution — expiry and the path-3
 * gate re-fire each time).
 *
 * @param store - The credential store.
 * @param now - Optional epoch-ms clock for the expiry gate.
 * @returns The resolver for the core client.
 */
function storeTokenResolver(
  store: CredentialStore,
  now: (() => number) | undefined,
): TokenResolver {
  return {
    async getBrowserToken(_name: string, region: string): Promise<string> {
      const tokens = await readStoredTokens(store, region, now);
      return tokens.access_token.reveal();
    },
    getStaticToken: staticTokenFromAccount,
  };
}

/** Memo for {@link liveExportOrigins} (filled on the first request). */
let liveExportOriginSet: ReadonlySet<string> | null = null;

/**
 * The live Export-API origins of EVERY region (`data.mixpanel.com` and
 * its regional twins) — the hosts the D2 spike found serve no CORS
 * headers, and therefore the guard's refusal set. Derived once from the
 * core `ENDPOINTS` table (a module constant; never restated literals):
 * the refusal rationale is these hosts' missing CORS headers, not the
 * export API family, so an export re-homed onto a user-controlled host
 * by `endpointOverrides.apiBaseUrl` (normally a CORS-capable proxy) is
 * deliberately NOT in this set (AIE-926). Computed lazily — the bundle
 * recipe evaluates the IIFE in a bare context with no `URL` global, so
 * nothing may parse a URL at module-evaluation time.
 *
 * @returns The set of live export origins.
 */
function liveExportOrigins(): ReadonlySet<string> {
  if (liveExportOriginSet === null) {
    liveExportOriginSet = new Set<string>(
      [...ENDPOINTS.values()].flatMap((table) => {
        const base = table.get("export");
        return base === undefined ? [] : [new URL(base).origin];
      }),
    );
  }
  return liveExportOriginSet;
}

/**
 * The origin a fetch input targets, or `null` for relative/unparseable
 * inputs (those never target an export host; the inner fetch produces
 * its own error for them).
 *
 * @param input - The fetch input (`Request`, `URL`, or string).
 * @returns The origin, or `null`.
 */
function requestOrigin(input: RequestInfo | URL): string | null {
  let url: string;
  if (input instanceof Request) {
    url = input.url;
  } else if (input instanceof URL) {
    url = input.href;
  } else {
    url = input;
  }
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Build the Export-API refusal for a request that targeted a live
 * export origin (R9.3 explanatory message; programs key on the CODE —
 * R5). The trailing hint is phrased from the EFFECTIVE endpoint table:
 * while export still lives on the live host it points at the
 * `endpointOverrides.apiBaseUrl` re-homing route; once export IS
 * re-homed (the request bypassed the override and addressed a live
 * host directly) it says so instead.
 *
 * @param origin - The refused live export origin (kept in `details`).
 * @param effective - The client's effective family → base-URL table.
 * @returns The coded error (throw at the call site).
 */
function exportRefusal(
  origin: string,
  effective: ReadonlyMap<EndpointKind, string>,
): BrowserUnsupportedError {
  const effectiveExport = effective.get("export");
  const rehomed =
    effectiveExport !== undefined &&
    !liveExportOrigins().has(new URL(effectiveExport).origin);
  const hint = rehomed
    ? `Export is currently re-homed at ${effectiveExport} by ` +
      "endpointOverrides.apiBaseUrl; this request addressed the live " +
      "host directly."
    : "Export can instead be routed through a CORS-capable proxy you " +
      "control by setting endpointOverrides.apiBaseUrl (the guard " +
      "admits the override host and keeps refusing the live hosts).";
  return new BrowserUnsupportedError(
    `The Export API host ${origin} is Node-only (it serves no CORS ` +
      "headers — plan §4.3): raw event/profile export streaming " +
      "cannot run from a browser origin. Use @mixpanel-headless/node " +
      `for export workloads. ${hint}`,
    BROWSER_EXPORT_UNSUPPORTED,
    { origin },
  );
}

/**
 * Wrap a fetch with the Export-API refusal guard (§2.4; plan §4.3:
 * Export is Node-only — the LIVE export hosts serve no CORS headers).
 * A request to a live export origin of ANY region rejects with
 * {@link BROWSER_EXPORT_UNSUPPORTED} BEFORE any network attempt, so
 * export paths fail fast with one coded, documented error instead of
 * an opaque CORS `TypeError`. Wraps WHATEVER fetch the caller injected
 * (the R2.4 seam is preserved).
 *
 * The refusal predicate is membership in the LIVE export-origin set —
 * a property of those hosts (no CORS headers), never of the API
 * family — so the effective endpoint table decides the outcome per
 * request (PR #11 follow-up, AIE-926): under
 * `endpointOverrides.apiBaseUrl` the client re-homes the export family
 * at `{apiBaseUrl}/api/2.0`, an origin outside the live set, so the
 * requests it builds are admitted (the override host is user-controlled
 * and is where browser export can actually work), while the live
 * origins stay refused even under an override (defence in depth). A
 * provider-form override is consulted on every call by the client and,
 * on refusal, by this guard — flipping it between requests changes the
 * verdict without re-wrapping. The effective table itself is only read
 * when a refusal is being built (to phrase the diagnostic), so the
 * admit path allocates nothing beyond the `URL` parse; with no override
 * `core.endpoints()` returns the live table object itself.
 *
 * @param inner - The caller-injected (or global) fetch.
 * @param currentEndpoints - The client's `core.endpoints()` accessor (the
 *   effective family → base-URL table under the current overrides).
 * @returns The guarded fetch.
 */
function guardBrowserFetch(
  inner: typeof fetch,
  currentEndpoints: () => ReadonlyMap<EndpointKind, string>,
): typeof fetch {
  const guarded = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const origin = requestOrigin(input);
    if (origin !== null && liveExportOrigins().has(origin)) {
      throw exportRefusal(origin, currentEndpoints());
    }
    return inner(input, init);
  };
  return guarded as typeof fetch;
}

/**
 * Wrap the core client so its in-memory session-replacement path
 * (`client.use({account})`) refuses service accounts — §2.3 path 4 —
 * and so every client DERIVED from it (`client.withProject(...)`)
 * carries the same guard — §2.3 path 6, added by the pair-B blind
 * review (b9-reviewB-threat.md F1 / b9-reviewB-e2e.md F1: core
 * `withProject` builds a fresh, unguarded client, which bypassed the
 * refusal until the guard recursed). Installed WITHOUT a core edit
 * through the `WorkspaceOptions.client` injection point (the seam the
 * packet row names); a Proxy preserves the closure-backed getters
 * (`session`, `projectId`, …) of the core client object.
 *
 * @param client - The assembled core client.
 * @returns The guarded client, injected into the core `Workspace`.
 */
function guardClientUse(client: MixpanelClient): MixpanelClient {
  return new Proxy(client, {
    get(target, property): unknown {
      if (property === "use") {
        return (useOptions: ClientUseOptions = {}): Promise<void> => {
          const account = useOptions.account ?? null;
          if (account !== null && account.type === "service_account") {
            // Atomic-on-failure like the core `use` probe: the prior
            // session stays installed.
            return Promise.reject(serviceAccountRefusal("client.use"));
          }
          return target.use(useOptions);
        };
      }
      if (property === "withProject") {
        // §2.3 path 6: re-guard the derived client (recursively — a
        // chain of withProject calls stays gated at every link). The
        // derived client already inherits the export-guarded fetch and
        // the browser token resolver from the core options threading.
        return (
          projectId: string,
          newWorkspaceId: number | null = null,
        ): MixpanelClient =>
          guardClientUse(target.withProject(projectId, newWorkspaceId));
      }
      return Reflect.get(target, property, target);
    },
  });
}

/**
 * Assemble the core `Workspace` over the guarded transport and client
 * (shared tail of both factories).
 *
 * @param session - The (already SA-gated) session.
 * @param options - Store/fetch/client options.
 * @param nowMs - Optional epoch-ms clock for the resolver expiry gate.
 * @returns The real core Workspace facade (not a wrapper class).
 */
function assembleWorkspace(
  session: Session,
  options: Pick<BrowserWorkspaceOptions, "store" | "fetch" | "clientOptions">,
  nowMs: (() => number) | undefined,
): Workspace {
  const store = options.store ?? new InMemoryCredentialStore();
  const clientOptions = options.clientOptions ?? {};
  const baseFetch = options.fetch ?? clientOptions.fetch ?? globalThis.fetch;
  const coreNow = clientOptions.now;
  const resolverNow =
    nowMs ??
    (coreNow === undefined ? undefined : (): number => coreNow().getTime());
  const tokenResolver =
    clientOptions.tokenResolver ?? storeTokenResolver(store, resolverNow);
  // The guard reads the client's OWN effective endpoint table per
  // request (`core.endpoints()` = `endpointsFor(region, overrides())`), so
  // the refusal verdict and the URLs the client builds always agree.
  // `client` is only dereferenced at request time, after assignment.
  const client: MixpanelClient = createMixpanelClient({
    ...clientOptions,
    session,
    tokenResolver,
    fetch: guardBrowserFetch(baseFetch, () => client.core.endpoints()),
  });
  return new Workspace({ session, client: guardClientUse(client) });
}

/**
 * Build a browser `Session` around a bearer token — the shortest path
 * in the package (R9.3 "oauth_token mode first-class"; plan §4.3 Tier
 * C ships this mode enabled in all regions). The account union and
 * session go through core `parseAccount` / `parseSession` at the
 * `param` boundary — never hand-assembled.
 *
 * @param options - Token, project, region, optional workspace/name.
 * @returns The resolved session.
 * @throws ParamValidationError - Invalid region / projectId / name.
 * @example
 * ```typescript
 * const session = browserSession({
 *   token: "eyJ...",
 *   projectId: "12345",
 *   region: "us",
 * });
 * ```
 */
export function browserSession(options: BrowserSessionOptions): Session {
  const account = parseAccount(
    {
      type: "oauth_token",
      name: options.accountName ?? "browser",
      region: options.region,
      token: options.token,
    },
    { boundary: "param" },
  );
  return parseSession(
    {
      account,
      project: { id: options.projectId },
      ...(options.workspaceId === undefined
        ? {}
        : { workspace: { id: options.workspaceId } }),
    },
    { boundary: "param" },
  );
}

/**
 * Create a core `Workspace` for the browser (b9-packets.md §2.2):
 * §2.3 SA gate → §2.4 export-refusing fetch wrap → core `Workspace`
 * over a browser-assembled client (the §2.3 path-4 `use` guard rides
 * in through `WorkspaceOptions.client` — no core edit).
 *
 * @param options - Session inputs plus store/fetch/client options.
 * @returns The real core Workspace facade.
 * @throws BrowserUnsupportedError - `BROWSER_SERVICE_ACCOUNT_REFUSED`
 *   when a pre-built `session` carries a service account (§2.3 path 1).
 * @throws ParamValidationError - Invalid region / projectId.
 * @example
 * ```typescript
 * const ws = createBrowserWorkspace({
 *   token: "eyJ...",
 *   projectId: "12345",
 *   region: "us",
 * });
 * const events = await ws.client.getEvents();
 * ```
 */
export function createBrowserWorkspace(
  options: BrowserSessionOptions & BrowserWorkspaceOptions,
): Workspace {
  // §2.3 path 1 — the FIRST statement, before any client construction.
  if (options.session?.account.type === "service_account") {
    throw serviceAccountRefusal("createBrowserWorkspace(session)");
  }
  const session = options.session ?? browserSession(options);
  return assembleWorkspace(session, options, undefined);
}

/**
 * Create a core `Workspace` from tokens the login flow persisted into
 * a `CredentialStore` (§2.2): reads `CREDENTIAL_KEYS.tokens(region)`,
 * parses STRICTLY via core `parseOAuthTokens`, refuses SA-shaped
 * records (§2.3 path 3) and expired tokens, then constructs exactly
 * like {@link createBrowserWorkspace} with a store-backed resolver
 * (per-request re-resolution, R2.5).
 *
 * @param options - Region/project/store plus optional seams.
 * @returns The workspace over the persisted credentials.
 * @throws OAuthError - `OAUTH_TOKEN_ERROR` for absent / non-JSON /
 *   expired tokens (refresh is browser-v1 unsupported — §2.2
 *   disposition).
 * @throws BrowserUnsupportedError - `BROWSER_SERVICE_ACCOUNT_REFUSED`
 *   for an SA-shaped persisted record (§2.3 path 3).
 * @throws ResponseValidationError - Malformed persisted token payloads
 *   (strict read — §2.1).
 */
export async function createBrowserWorkspaceFromStore(
  options: BrowserWorkspaceFromStoreOptions,
): Promise<Workspace> {
  // Construction-time gate run (absent / SA / malformed / expired all
  // fire HERE, not on the first request).
  await readStoredTokens(options.store, options.region, options.now);
  const account = parseAccount(
    {
      type: "oauth_browser",
      name: options.accountName ?? "browser",
      region: options.region,
    },
    { boundary: "param" },
  );
  const session = parseSession(
    {
      account,
      project: { id: options.projectId },
      ...(options.workspaceId === undefined
        ? {}
        : { workspace: { id: options.workspaceId } }),
    },
    { boundary: "param" },
  );
  return assembleWorkspace(
    session,
    {
      store: options.store,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.clientOptions === undefined
        ? {}
        : { clientOptions: options.clientOptions }),
    },
    options.now,
  );
}
