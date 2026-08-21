/**
 * Regional endpoint table + URL builder — TS port of the module constant
 * `ENDPOINTS` and `MixpanelAPIClient._build_url` from
 * `mixpanel_headless/_internal/api_client.py:151-172` / `:417-432`
 * (Phase-3 packet B0-2, R10.8: ported once, by name; B4 domain shards
 * import — they never re-implement URL assembly).
 *
 * R2.3/R2.13: pure functions, string concatenation ONLY — never
 * `new URL(path, base)` (it normalizes `//` and drops path prefixes; the
 * App API is trailing-slash sensitive).
 */

import { invariant } from "../invariant.js";
import type { Region } from "../types/literals.js";

export type { Region };

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
 * A `ReadonlyMap` per R4.8 (Python dict used as a lookup table).
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

/**
 * Server-side read deadlines Mixpanel's edge enforces per route family
 * (nginx `proxy_read_timeout`), and the route-aware client defaults
 * sized to outlast them — TS port of the `api_client.py:186-196`
 * constants. App API routes get ~120s; `/api/query` routes get 488s.
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
 * Python indexes `ENDPOINTS[region][api_type]` directly (a `KeyError` is
 * unreachable — both keys are `Literal`-typed); the TS table lookup is
 * equally unreachable-by-types and guarded with `invariant` (R6.8).
 *
 * @param region - Data-residency region.
 * @param kind - API family.
 * @returns The base URL (no trailing slash).
 * @throws MixpanelError - If the table is missing an entry (impossible by
 *   construction; guards table edits).
 */
export function endpointBase(region: Region, kind: EndpointKind): string {
  const table = ENDPOINTS.get(region);
  invariant(table !== undefined, `ENDPOINTS missing region ${region}`);
  const base = table.get(kind);
  invariant(base !== undefined, `ENDPOINTS[${region}] missing ${kind}`);
  return base;
}

/**
 * Build the full URL for the given API family and path — TS port of
 * `MixpanelAPIClient._build_url` (`api_client.py:417-432`).
 *
 * A missing leading `/` on `path` is added, exactly as in Python.
 *
 * @param region - Data-residency region (Python reads
 *   `session.account.region`; the B4 client threads it here).
 * @param kind - One of `"query"`, `"export"`, `"engage"`, `"app"`.
 * @param path - API endpoint path (e.g. `"/segmentation"`).
 * @returns Full URL for the endpoint.
 *
 * @example
 * ```typescript
 * buildUrl("us", "query", "/segmentation");
 * // "https://mixpanel.com/api/query/segmentation"
 * ```
 */
export function buildUrl(
  region: Region,
  kind: EndpointKind,
  path: string,
): string {
  const base = endpointBase(region, kind);
  // Ensure path starts with / (Python: `if not path.startswith("/")`).
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}
