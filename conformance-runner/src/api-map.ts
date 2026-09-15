/**
 * Runtime resolution of Python `call.api` names to their TS homes
 * (design D12 verdict taxonomy, naming-map §5).
 *
 * Resolution never throws: every corpus name lands in exactly one of three
 * buckets — `mapped` (an `api-map.gen.ts` entry exists), `unported` (the
 * name's module prefix is in the api-index universe but the exact name has
 * no entry — counted, never failing, until the module's port batch is
 * declared done per R10.5), or `unmapped` (name in NO mapping source —
 * always failing, `UNMAPPED_API`; silent fuzzy matching is forbidden,
 * naming-map §4).
 */

import { API_MAP, KNOWN_PYTHON_MODULES } from "./api-map.gen.js";
import type { ApiMapEntry } from "./api-map-types.js";

/** Successful resolution: the generated map carries the name. */
export interface MappedApi {
  /** Discriminant. */
  readonly status: "mapped";
  /** The generated entry (TS module/name + Python signature shape). */
  readonly entry: ApiMapEntry;
}

/** Module known to the api-index but the exact name is unmapped. */
export interface UnportedApi {
  /** Discriminant. */
  readonly status: "unported";
  /** The known Python module prefix, e.g. `api_client`. */
  readonly module: string;
}

/** Name in no mapping source — the `UNMAPPED_API` verdict (naming-map §4). */
export interface UnmappedApi {
  /** Discriminant. */
  readonly status: "unmapped";
}

/** The three-way resolution outcome for one `call.api` name. */
export type ApiResolution = MappedApi | UnportedApi | UnmappedApi;

/** O(1) prefix membership for the UNPORTED universe. */
const KNOWN_MODULE_SET: ReadonlySet<string> = new Set(KNOWN_PYTHON_MODULES);

/**
 * Resolve one Python dotted `call.api` name.
 *
 * @param pythonApi - The name exactly as the vector carries it, e.g.
 *   `workspace.build_funnel_params`.
 * @returns The three-way {@link ApiResolution}; never throws.
 * @example
 * ```typescript
 * resolveApi("segfilter.build_segfilter_entry");
 * // { status: "mapped", entry: { tsModule: "core/query/segfilter", ... } }
 * resolveApi("api_client.some_future_method");
 * // { status: "unported", module: "api_client" }
 * resolveApi("mystery.call");
 * // { status: "unmapped" }
 * ```
 */
export function resolveApi(pythonApi: string): ApiResolution {
  const entry = API_MAP[pythonApi];
  if (entry !== undefined) {
    return { status: "mapped", entry };
  }
  const firstDot = pythonApi.indexOf(".");
  const modulePrefix = firstDot > 0 ? pythonApi.slice(0, firstDot) : pythonApi;
  if (KNOWN_MODULE_SET.has(modulePrefix)) {
    return { status: "unported", module: modulePrefix };
  }
  return { status: "unmapped" };
}
