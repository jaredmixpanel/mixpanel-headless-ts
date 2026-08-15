/**
 * Per-request header composition + client-identification metadata — TS
 * port of `MixpanelAPIClient._request_headers`
 * (`mixpanel_headless/_internal/api_client.py:452-481`) and
 * `_internal/client_metadata.py` (Phase-3 packet B0-2; the
 * `client_metadata` half ports alongside per the packet's
 * `_execute_with_retry` bullet).
 *
 * R10.8 ownership (playbook FF5/R8): `_request_headers` is consumed by
 * BOTH B0 wire functions (`executeWithRetry`, `appRequest`) and by the
 * B4 streaming/replay call sites — single implementation HERE; B4-C1
 * imports it by name and must not re-implement any header merging.
 *
 * Env boundary (R9.1/R9.4): Python reads `MP_CUSTOM_HEADER_NAME` /
 * `MP_CUSTOM_HEADER_VALUE` from `os.environ` on every call; `core` may
 * not touch env, so the pair arrives through the injected
 * {@link RequestHeadersDeps.getCustomHeaderEnv} provider, invoked
 * per-call to mirror Python's per-request read. The `node` package (B8)
 * supplies the real `process.env` reader.
 */

/** Value sent as the `query_origin` parameter on Query API calls.
 *
 * Lets downstream consumers attribute analytics traffic to this library.
 * Byte-identical to Python (`client_metadata.py:13`) — the value is
 * wire-locked by every Query-host vector's recorded request params.
 */
export const QUERY_ORIGIN = "mixpanel-headless";

/**
 * Library version stamped into the User-Agent.
 *
 * Mirrors `packages/core/package.json` `version` (Python reads
 * `mixpanel_headless.__version__`); `core` cannot read files at runtime,
 * so the constant is pinned here and bumped with the package version.
 */
const LIBRARY_VERSION = "0.0.0";

/** How this process entered the library (Python `_EntryPoint`). */
export type EntryPoint = "lib" | "cli";

/** Module-level entry-point state (Python `_entry_point`, default "lib"). */
let entryPoint: EntryPoint = "lib";

/**
 * Record how this process was launched (call once at startup) — TS port
 * of `client_metadata.set_entry_point`.
 *
 * The CLI calls this with `"cli"` on import so the User-Agent tag
 * reflects interactive vs programmatic use; library callers leave the
 * default `"lib"`.
 *
 * @param value - One of `"lib"` or `"cli"`.
 */
export function setEntryPoint(value: EntryPoint): void {
  entryPoint = value;
}

/**
 * Return the currently recorded entry point — TS port of
 * `client_metadata.get_entry_point`.
 *
 * @returns `"lib"` (default) or `"cli"` once flipped.
 */
export function getEntryPoint(): EntryPoint {
  return entryPoint;
}

/**
 * Build the User-Agent string for outbound requests — TS port of
 * `client_metadata.get_user_agent`.
 *
 * Python format: `mixpanel-headless/<version> (entry=<lib|cli>;
 * python/<x.y>)`. The runtime tag becomes `ts` here (the User-Agent is
 * telemetry identification, never vector-byte-locked — vectors assert
 * headers via `headers_contain` subsets; B0-notes decision 8). Re-read
 * on every call so an entry-point change after import is reflected
 * immediately, exactly as in Python.
 *
 * @returns The User-Agent header value.
 *
 * @example
 * ```typescript
 * getUserAgent();
 * // "mixpanel-headless/0.0.0 (entry=lib; ts)"
 * ```
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
  /** Layer-1 User-Agent source (defaults to {@link getUserAgent} in B4). */
  getUserAgent(): string;
  /**
   * Layer-2 env pair provider — the `MP_CUSTOM_HEADER_NAME` /
   * `MP_CUSTOM_HEADER_VALUE` values, re-read per call. Absent/empty
   * members disable the layer (Python: `if custom_name and custom_value`).
   */
  getCustomHeaderEnv(): {
    readonly name?: string | undefined;
    readonly value?: string | undefined;
  };
  /** Layer-3 session headers (`Session.headers`, FR-014). */
  readonly sessionHeaders: Readonly<Record<string, string>>;
}

/**
 * Compose the per-request header set: defaults → env → session → caller —
 * TS port of `MixpanelAPIClient._request_headers` (`api_client.py:452-481`).
 *
 * Each later layer overrides the prior on header-name collision:
 *
 * 1. Library defaults — currently `User-Agent` so backend telemetry can
 *    attribute traffic to this library.
 * 2. `MP_CUSTOM_HEADER_NAME` / `MP_CUSTOM_HEADER_VALUE` env pair (via the
 *    injected provider).
 * 3. `session.headers` (populated from `[settings].custom_header` and
 *    bridge `headers` per FR-014); the resolver merged env into the
 *    session earlier — the final session state is authoritative.
 * 4. `extra` — typically `{Authorization: authHeader}` plus any per-call
 *    `Accept-Encoding` etc. supplied by the caller.
 *
 * Merging is name-case-sensitive exactly like Python `dict.update`; HTTP
 * case-insensitivity is the transport's concern.
 *
 * @param deps - Injected environment (see {@link RequestHeadersDeps}).
 * @param extra - Per-call headers (e.g. Authorization). May be empty.
 * @returns New object with all layers merged in precedence order.
 */
export function requestHeaders(
  deps: RequestHeadersDeps,
  extra: Readonly<Record<string, string>>,
): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": deps.getUserAgent(),
  };
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
