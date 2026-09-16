/**
 * Per-request header composition and the User-Agent metadata every
 * outbound call carries. Owns the four-layer merge (library defaults →
 * `MP_CUSTOM_HEADER_*` env pair → session headers → per-call extras) that
 * `executeWithRetry`, `appRequest` and the streaming/replay paths all
 * import; nothing else in the package merges headers. `core` cannot read
 * the environment, so the env pair arrives through an injected provider
 * invoked on every call, mirroring Python's per-request `os.environ` read.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient._request_headers
 * @see mixpanel_headless._internal.client_metadata
 */

/**
 * Value sent as the `query_origin` parameter on Query API calls.
 *
 * Lets downstream consumers attribute analytics traffic to this library.
 * Byte-identical to Python: the value is wire-locked by every Query-host
 * vector's recorded request params.
 */
export const QUERY_ORIGIN = "mixpanel-headless";

/**
 * Library version stamped into the User-Agent.
 *
 * Mirrors `packages/core/package.json` `version` (Python reads
 * `mixpanel_headless.__version__`); `core` cannot read files at runtime,
 * so the constant is pinned here. Changesets bumps the manifest only, so
 * `npm run version` rewrites this line afterwards
 * (`scripts/sync-library-version.mjs`); `tests/library-version.test.ts`
 * fails when the two drift.
 */
const LIBRARY_VERSION = "0.2.0";

/** How this process entered the library (Python `_EntryPoint`). */
export type EntryPoint = "lib" | "cli";

/**
 * Module-level entry-point state (Python `_entry_point`, default "lib").
 *
 * Deliberately process-global, not a client option: it answers "how was
 * this process launched", one fact per realm that every client's
 * User-Agent shares, exactly like Python's module attribute. A per-client
 * setting would let two clients in one CLI process disagree about it.
 */
let entryPoint: EntryPoint = "lib";

/**
 * Record how this process was launched; call once at startup.
 *
 * @remarks
 * The CLI calls this with `"cli"` on import so the User-Agent tag
 * reflects interactive vs programmatic use; library callers leave the
 * default `"lib"`.
 * @param value - One of `"lib"` or `"cli"`.
 * @example
 * ```typescript
 * setEntryPoint("cli");
 * getUserAgent(); // "mixpanel-headless/0.0.0 (entry=cli; ts)"
 * ```
 * @see mixpanel_headless._internal.client_metadata.set_entry_point
 */
export function setEntryPoint(value: EntryPoint): void {
  entryPoint = value;
}

/**
 * Return the currently recorded entry point.
 *
 * @returns `"lib"` (default) or `"cli"` once flipped.
 * @example
 * ```typescript
 * getEntryPoint(); // "lib"
 * ```
 * @see mixpanel_headless._internal.client_metadata.get_entry_point
 */
export function getEntryPoint(): EntryPoint {
  return entryPoint;
}

/**
 * Build the User-Agent string for outbound requests.
 *
 * @remarks
 * Python's format is
 * `mixpanel-headless/<version> (entry=<lib|cli>; python/<x.y>)`; the
 * runtime tag becomes `ts` here (the User-Agent is telemetry
 * identification, never byte-locked by a vector — vectors assert headers
 * via `headers_contain` subsets). Re-read on every call so an entry-point
 * change after import is reflected immediately.
 * @returns The User-Agent header value.
 * @example
 * ```typescript
 * getUserAgent();
 * // "mixpanel-headless/0.0.0 (entry=lib; ts)"
 * ```
 * @see mixpanel_headless._internal.client_metadata.get_user_agent
 */
export function getUserAgent(): string {
  return `mixpanel-headless/${LIBRARY_VERSION} (entry=${entryPoint}; ts)`;
}

/**
 * Dependencies for {@link requestHeaders} — the injected halves of the
 * Python method's environment (`get_user_agent()`, `os.environ`,
 * `self._session.headers`).
 */
export interface RequestHeadersDeps {
  /**
   * Layer-1 User-Agent source (the client defaults it to
   * {@link getUserAgent}). `null` omits the header entirely — an empty
   * string would still be sent and still trip a browser's CORS
   * preflight, which is what the omission exists to avoid.
   */
  getUserAgent: () => string | null;
  /**
   * Layer-2 env pair provider — the `MP_CUSTOM_HEADER_NAME` /
   * `MP_CUSTOM_HEADER_VALUE` values, re-read per call. Absent/empty
   * members disable the layer (Python: `if custom_name and custom_value`).
   */
  getCustomHeaderEnv: () => {
    readonly name?: string | undefined;
    readonly value?: string | undefined;
  };
  /** Layer-3 session headers (`Session.headers`). */
  readonly sessionHeaders: Readonly<Record<string, string>>;
}

/**
 * Compose the per-request header set from the four precedence layers.
 *
 * @remarks
 * Each later layer overrides the prior on header-name collision:
 *
 * 1. Library defaults — currently `User-Agent` so backend telemetry can
 *    attribute traffic to this library. The layer is skipped when
 *    `deps.getUserAgent` returns `null`: the Fetch specification lists
 *    `User-Agent` among the forbidden request headers, and a browser that
 *    forwards it into the CORS preflight (Safari) has every call rejected
 *    by Mixpanel's `Access-Control-Allow-Headers`, so the browser package
 *    disables the layer while Node keeps it.
 * 2. `MP_CUSTOM_HEADER_NAME` / `MP_CUSTOM_HEADER_VALUE` env pair (via the
 *    injected provider).
 * 3. `session.headers` (populated from `[settings].custom_header` and
 *    bridge `headers`); the resolver merged env into the session
 *    earlier — the final session state is authoritative.
 * 4. `extra` — typically `{Authorization: authHeader}` plus any per-call
 *    `Accept-Encoding` etc. supplied by the caller.
 *
 * Merging is name-case-sensitive exactly like Python `dict.update`; HTTP
 * case-insensitivity is the transport's concern.
 * @param deps - Injected environment (User-Agent source, env-pair
 *   provider, session headers).
 * @param extra - Per-call headers such as `Authorization`; may be empty.
 * @returns A new object with all layers merged in precedence order.
 * @example
 * ```typescript
 * const headers = requestHeaders(
 *   { getUserAgent, getCustomHeaderEnv: () => ({}), sessionHeaders: {} },
 *   { Authorization: "Bearer …" },
 * );
 * // { "User-Agent": "mixpanel-headless/0.0.0 (entry=lib; ts)", Authorization: "Bearer …" }
 * ```
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient._request_headers
 */
export function requestHeaders(
  deps: RequestHeadersDeps,
  extra: Readonly<Record<string, string>>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const userAgent = deps.getUserAgent();
  if (userAgent !== null) {
    headers["User-Agent"] = userAgent;
  }
  const { name: customName, value: customValue } = deps.getCustomHeaderEnv();
  // Python truthiness on strings: empty/absent disables the layer.
  if (
    customName !== undefined &&
    customName !== "" &&
    customValue !== undefined &&
    customValue !== ""
  ) {
    headers[customName] = customValue;
  }
  Object.assign(headers, deps.sessionHeaders);
  Object.assign(headers, extra);
  return headers;
}
