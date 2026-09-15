/**
 * Regional endpoint table, alternate-host overrides and the URL builder
 * every request goes through. Pure functions over string concatenation —
 * never `new URL(path, base)`, which normalizes `//` and drops path
 * prefixes on an App API that is trailing-slash sensitive.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient._build_url
 */

import { invariant } from "../invariant.js";
import type { Region } from "../types/literals.js";

/**
 * The API families the region table routes (Python `ENDPOINTS[region]`
 * keys): the Query host, the export/data host, the Engage profile host,
 * and the App API host.
 */
export type EndpointKind = "query" | "export" | "engage" | "app";

/**
 * Regional endpoint configuration (Python `ENDPOINTS`).
 *
 * Each region has separate URLs for query APIs and export/data APIs.
 * A `ReadonlyMap`, as for every Python dict used as a lookup table.
 */
export const ENDPOINTS: ReadonlyMap<
  Region,
  ReadonlyMap<EndpointKind, string>
> = new Map<Region, ReadonlyMap<EndpointKind, string>>([
  [
    "us",
    new Map<EndpointKind, string>([
      ["query", "https://mixpanel.com/api/query"],
      ["export", "https://data.mixpanel.com/api/2.0"],
      ["engage", "https://mixpanel.com/api/query/engage"],
      ["app", "https://mixpanel.com/api/app"],
    ]),
  ],
  [
    "eu",
    new Map<EndpointKind, string>([
      ["query", "https://eu.mixpanel.com/api/query"],
      ["export", "https://data-eu.mixpanel.com/api/2.0"],
      ["engage", "https://eu.mixpanel.com/api/query/engage"],
      ["app", "https://eu.mixpanel.com/api/app"],
    ]),
  ],
  [
    "in",
    new Map<EndpointKind, string>([
      ["query", "https://in.mixpanel.com/api/query"],
      ["export", "https://data-in.mixpanel.com/api/2.0"],
      ["engage", "https://in.mixpanel.com/api/query/engage"],
      ["app", "https://in.mixpanel.com/api/app"],
    ]),
  ],
]);

// --- Alternate-host override (Python PR #235) ---
//
// Python reads `MP_API_BASE_URL` / `MP_APP_BASE_URL` from `os.environ` on
// every request (`_endpoints_for`). `packages/core` never
// touches `process.env`, so the same two values arrive as an
// injected {@link EndpointOverrides} bag — either a static object or a
// per-call provider ({@link EndpointOverridesSource}). `packages/node`
// wires the provider over `process.env` (call-time reads), which keeps
// Python's per-request semantics byte-for-byte.

/** Env variable names the node package resolves (Python `API_BASE_URL_ENV`). */
export const API_BASE_URL_ENV = "MP_API_BASE_URL";
/** Env variable names the node package resolves (Python `APP_BASE_URL_ENV`). */
export const APP_BASE_URL_ENV = "MP_APP_BASE_URL";

/**
 * The alternate-host overrides (TS twin of `MP_API_BASE_URL` /
 * `MP_APP_BASE_URL`). Both members are optional; `null`, `undefined`,
 * the empty string and slash-only strings all mean "unset". Trailing
 * slashes are tolerated (stripped before concatenation).
 */
export interface EndpointOverrides {
  /**
   * Route every API family at one alternate host: `query` →
   * `{base}/api/query`, `export` → `{base}/api/2.0`, `engage` →
   * `{base}/api/query/engage`, `app` → `{base}/api/app`. Plain `http://`
   * bases are accepted (local / headless deployments only).
   */
  readonly apiBaseUrl?: string | null | undefined;
  /**
   * Re-home only the App API family at `{appBase}/api/app` — alone (the
   * other three families stay on the live regional hosts) or on top of
   * {@link apiBaseUrl} (App API moves to the second host).
   */
  readonly appBaseUrl?: string | null | undefined;
}

/**
 * How overrides are injected: a static bag, or a provider consulted on
 * every request (the node package's `process.env` reader; the twin of
 * Python's per-request `os.environ.get`).
 */
export type EndpointOverridesSource =
  EndpointOverrides | (() => EndpointOverrides);

/**
 * The fixed per-family path prefixes an override base is combined with
 * (Python `_OVERRIDE_PATH_PREFIXES`) — the prefixes a headless Mixpanel
 * pod's nginx routes on. Insertion order matches the live tables.
 */
const OVERRIDE_PATH_PREFIXES: ReadonlyMap<EndpointKind, string> = new Map<
  EndpointKind,
  string
>([
  ["query", "/api/query"],
  ["export", "/api/2.0"],
  ["engage", "/api/query/engage"],
  ["app", "/api/app"],
]);

/**
 * Families whose requests are scoped by the pinned `workspace_id`
 * (Python `_WORKSPACE_SCOPED_FAMILIES`). Engage is included because its
 * live URL sits under the Query prefix (`/api/query/engage`), which is
 * how the old `startswith(query)` check classified it.
 */
export const WORKSPACE_SCOPED_FAMILIES: ReadonlySet<EndpointKind> =
  new Set<EndpointKind>(["query", "engage"]);

/** The frozen "nothing overridden" bag every default provider returns. */
const NO_OVERRIDES: EndpointOverrides = Object.freeze({});

/**
 * Normalise one override value for concatenation (Python
 * `_base_url_override`): trailing slashes stripped; `null` / `undefined`
 * / empty / slash-only all collapse to `""` (= unset).
 *
 * @param value - The raw override value.
 * @returns The normalised base, or `""` when unset.
 * @example
 * ```typescript
 * normalizeBaseUrlOverride("http://127.0.0.1:8080/"); // "http://127.0.0.1:8080"
 * normalizeBaseUrlOverride("//"); // ""
 * ```
 */
export function normalizeBaseUrlOverride(
  value: string | null | undefined,
): string {
  return (value ?? "").replace(/\/+$/, "");
}

/**
 * Turn an {@link EndpointOverridesSource} into a per-call provider
 * (absent → a provider returning the frozen empty bag).
 *
 * @param source - Static bag, provider, or `undefined`.
 * @returns A zero-arg provider.
 * @example
 * ```typescript
 * endpointOverridesProvider({ apiBaseUrl: "http://devbox:8080" })();
 * // { apiBaseUrl: "http://devbox:8080" }
 * endpointOverridesProvider(undefined)(); // {}
 * ```
 */
export function endpointOverridesProvider(
  source: EndpointOverridesSource | undefined,
): () => EndpointOverrides {
  if (source === undefined) {
    return (): EndpointOverrides => NO_OVERRIDES;
  }
  if (typeof source === "function") {
    return source;
  }
  return (): EndpointOverrides => source;
}

/**
 * Build a per-call provider over an injected env reader — the exact
 * twin of Python's per-request `os.environ.get(...)` reads, without
 * `core` touching `process` itself (the node package passes
 * `(name) => process.env[name]`; the auth flows pass `effects.env.get`).
 *
 * @param getEnv - Reads one variable by name (`undefined` when unset).
 * @returns A provider that reads {@link API_BASE_URL_ENV} and
 *   {@link APP_BASE_URL_ENV} on every call.
 * @example
 * ```typescript
 * const overrides = endpointOverridesFromEnv((name) => process.env[name]);
 * overrides(); // { apiBaseUrl: undefined, appBaseUrl: "http://devbox:8080" }
 * ```
 */
export function endpointOverridesFromEnv(
  getEnv: (name: string) => string | undefined,
): () => EndpointOverrides {
  return (): EndpointOverrides => ({
    apiBaseUrl: getEnv(API_BASE_URL_ENV),
    appBaseUrl: getEnv(APP_BASE_URL_ENV),
  });
}

/**
 * Report whether the bag routes every family at one host (`apiBaseUrl`
 * set after normalisation) — the condition that collapses the region
 * probe.
 *
 * @param overrides - The override bag.
 * @returns `true` when `apiBaseUrl` is effectively set.
 * @example
 * ```typescript
 * hasApiBaseUrlOverride({ apiBaseUrl: "/" }); // false
 * hasApiBaseUrlOverride({ apiBaseUrl: "http://devbox:8080" }); // true
 * ```
 */
export function hasApiBaseUrlOverride(overrides: EndpointOverrides): boolean {
  return normalizeBaseUrlOverride(overrides.apiBaseUrl) !== "";
}

/**
 * The live per-region table (Python `ENDPOINTS[region]`; a `KeyError`
 * there is unreachable — both keys are `Literal`-typed). Guarded with
 * `invariant`.
 *
 * @param region - Data-residency region.
 * @returns The live table object itself (never a copy).
 */
function liveEndpoints(region: Region): ReadonlyMap<EndpointKind, string> {
  const table = ENDPOINTS.get(region);
  invariant(table !== undefined, `ENDPOINTS missing region ${region}`);
  return table;
}

/**
 * Resolve the API-family → base-URL table for `region`, honouring the
 * overrides (Python PR #235).
 *
 * @remarks
 * Every read of {@link ENDPOINTS} inside the client goes through this
 * function so the family checks that pick the App-vs-Query timeout and
 * inject `workspace_id` stay correct under an override.
 * @param region - Mixpanel region key.
 * @param overrides - The injected override bag (default: none).
 * @returns With neither member set: the live `ENDPOINTS[region]` object
 *   itself (byte-identical behaviour). With `apiBaseUrl` set: a fresh
 *   table of `{base}{prefix}` for every family. With `appBaseUrl` set:
 *   the `app` entry becomes `{appBase}/api/app` on top of whichever
 *   table applies. The live table is never mutated.
 * @throws {@link MixpanelHeadlessError} - `region` is not a table key
 *   (raised by `invariant`); unreachable by types, matching Python's
 *   `KeyError`.
 * @example
 * ```typescript
 * endpointsFor("eu", { apiBaseUrl: "http://devbox:8080" }).get("export");
 * // "http://devbox:8080/api/2.0"
 * ```
 * @see mixpanel_headless._internal.api_client._endpoints_for
 */
export function endpointsFor(
  region: Region,
  overrides: EndpointOverrides = NO_OVERRIDES,
): ReadonlyMap<EndpointKind, string> {
  const apiBase = normalizeBaseUrlOverride(overrides.apiBaseUrl);
  const appBase = normalizeBaseUrlOverride(overrides.appBaseUrl);
  if (apiBase === "" && appBase === "") {
    return liveEndpoints(region);
  }
  let table: Map<EndpointKind, string>;
  if (apiBase === "") {
    table = new Map<EndpointKind, string>(liveEndpoints(region));
  } else {
    table = new Map<EndpointKind, string>();
    for (const [family, prefix] of OVERRIDE_PATH_PREFIXES) {
      table.set(family, `${apiBase}${prefix}`);
    }
  }
  if (appBase !== "") {
    table.set("app", `${appBase}${appPathPrefix()}`);
  }
  return table;
}

/**
 * Return the App family's fixed path prefix
 * (`_OVERRIDE_PATH_PREFIXES["app"]`).
 *
 * @returns `"/api/app"`.
 * @example
 * ```typescript
 * appPathPrefix(); // "/api/app"
 * ```
 */
export function appPathPrefix(): string {
  const prefix = OVERRIDE_PATH_PREFIXES.get("app");
  invariant(prefix !== undefined, "OVERRIDE_PATH_PREFIXES missing app");
  return prefix;
}

/**
 * Classify `url` by the API family whose base is its longest prefix
 * (Python PR #235).
 *
 * @remarks
 * Longest-prefix (rather than first-match) matters in two places: live
 * Engage URLs also start with the Query base, and split overrides can
 * nest one family's base under another's (`apiBaseUrl: "https://proxy"`
 * with `appBaseUrl: "https://proxy/api/query"` puts the App base under
 * the Query prefix). Ties keep the first family in table order, exactly
 * like Python's strict `>` comparison.
 * @param url - The full request URL.
 * @param endpoints - A family → base-URL table, normally from
 *   {@link endpointsFor}.
 * @returns The matching family, or `null` when no base is a prefix of
 *   `url` (for example a foreign host passed to `request`).
 * @example
 * ```typescript
 * apiFamilyFor("https://mixpanel.com/api/query/engage/", endpointsFor("us"));
 * // "engage"
 * apiFamilyFor("https://example.com/x", endpointsFor("us"));
 * // null
 * ```
 * @see mixpanel_headless._internal.api_client._api_family_for
 */
export function apiFamilyFor(
  url: string,
  endpoints: ReadonlyMap<EndpointKind, string>,
): EndpointKind | null {
  let best: EndpointKind | null = null;
  let bestLen = -1;
  for (const [family, base] of endpoints) {
    if (!(base.length > bestLen && url.startsWith(base))) {
      continue;
    }

    best = family;
    bestLen = base.length;
  }
  return best;
}

/**
 * Server-side read deadlines Mixpanel's edge enforces per route family
 * (nginx `proxy_read_timeout`), and the route-aware client defaults
 * sized to outlast them (twins of the Python module constants). App API
 * routes get ~120s; `/api/query` routes get 488s.
 * The defaults add a margin so a slow request is always resolved by the
 * server's own answer (success or 5xx with diagnostics) and never
 * pre-empted by a client read timeout. An explicit timeout (constructor
 * or per-call) overrides them.
 */
export const APP_API_SERVER_DEADLINE_S: number = 120.0;

/** The `/api/query` route family's server-side read deadline. */
export const QUERY_API_SERVER_DEADLINE_S: number = 488.0;

/** Margin added over each server deadline (`_SERVER_DEADLINE_MARGIN_S`). */
const SERVER_DEADLINE_MARGIN_S: number = 15.0;

/** Route-aware default timeout for App API requests (135s). */
export const DEFAULT_APP_TIMEOUT_S: number =
  APP_API_SERVER_DEADLINE_S + SERVER_DEADLINE_MARGIN_S;

/** Route-aware default timeout for query-host requests (503s). */
export const DEFAULT_QUERY_TIMEOUT_S: number =
  QUERY_API_SERVER_DEADLINE_S + SERVER_DEADLINE_MARGIN_S;

/**
 * Look up the base URL for a region/API-family pair.
 *
 * @remarks
 * Python indexes `ENDPOINTS[region][api_type]` directly (a `KeyError` is
 * unreachable — both keys are `Literal`-typed); the TS table lookup is
 * equally unreachable-by-types and guarded with `invariant`.
 * @param region - Data-residency region.
 * @param kind - API family.
 * @param overrides - Alternate-host overrides (Python PR #235); default none,
 *   which returns the live per-region entry unchanged.
 * @returns The base URL (no trailing slash).
 * @throws {@link MixpanelHeadlessError} - The table is missing an entry
 *   (raised by `invariant`; impossible by construction, guards table
 *   edits).
 * @example
 * ```typescript
 * endpointBase("eu", "app"); // "https://eu.mixpanel.com/api/app"
 * ```
 */
export function endpointBase(
  region: Region,
  kind: EndpointKind,
  overrides: EndpointOverrides = NO_OVERRIDES,
): string {
  const base = endpointsFor(region, overrides).get(kind);
  invariant(base !== undefined, `ENDPOINTS[${region}] missing ${kind}`);
  return base;
}

/**
 * Build the full URL for the given API family and path.
 *
 * @remarks
 * A missing leading `/` on `path` is added, exactly as in Python.
 * @param region - Data-residency region (Python reads
 *   `session.account.region`; the client threads it here).
 * @param kind - One of `"query"`, `"export"`, `"engage"`, `"app"`.
 * @param path - API endpoint path (e.g. `"/segmentation"`).
 * @param overrides - Alternate-host overrides (Python PR #235); the client
 *   threads its per-request provider's value here.
 * @returns Full URL for the endpoint.
 * @example
 * ```typescript
 * buildUrl("us", "query", "/segmentation");
 * // "https://mixpanel.com/api/query/segmentation"
 * buildUrl("us", "query", "/segmentation", { apiBaseUrl: "http://devbox:8080" });
 * // "http://devbox:8080/api/query/segmentation"
 * ```
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient._build_url
 */
export function buildUrl(
  region: Region,
  kind: EndpointKind,
  path: string,
  overrides: EndpointOverrides = NO_OVERRIDES,
): string {
  const base = endpointBase(region, kind, overrides);
  // Ensure path starts with / (Python: `if not path.startswith("/")`).
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

export { type Region } from "../types/literals.js";
