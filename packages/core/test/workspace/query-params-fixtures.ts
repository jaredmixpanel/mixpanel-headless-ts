// Shared helpers for the `buildQueryParams` suites split from
// `tests/unit/test_query_params.py`: the `BASE` keyword bag every Python
// `_build_query_params` call spells (same default values), `build()` to
// override part of it, and the `sections` / `measurement` / `behavior` /
// `displayOptions` accessors.

import {
  buildQueryParams,
  type BuildQueryParamsOptions,
  type ParamsDict,
} from "../../src/workspace-query-params.js";

/** The keyword-only bag every Python `_build_query_params` call spells. */
const BASE = {
  events: ["Login"],
  math: "total",
  math_property: null,
  per_user: null,
  from_date: null,
  to_date: null,
  last: 30,
  unit: "day",
  group_by: null,
  where: null,
  formulas: [],
  rolling: null,
  cumulative: false,
  mode: "timeseries",
} as const satisfies BuildQueryParamsOptions;

/**
 * `ws._build_query_params(**BASE, **overrides)`.
 *
 * @param overrides - The kwargs the Python call overrides.
 * @returns The bookmark params.
 */
export function build(
  overrides: Partial<BuildQueryParamsOptions> = {},
): ParamsDict {
  return buildQueryParams({ ...BASE, ...overrides });
}

/** `params["sections"][name]` as an array of records. */
export function section(
  params: Record<string, unknown>,
  name: string,
): Array<Record<string, unknown>> {
  const sections = params["sections"] as Record<string, unknown>;
  return sections[name] as Array<Record<string, unknown>>;
}

/** `params["sections"]["show"][i]["measurement"]`. */
export function measurementOf(
  params: Record<string, unknown>,
  index = 0,
): Record<string, unknown> {
  return section(params, "show")[index]!["measurement"] as Record<
    string,
    unknown
  >;
}

/** `params["sections"]["show"][i]["behavior"]`. */
export function behaviorOf(
  params: Record<string, unknown>,
  index = 0,
): Record<string, unknown> {
  return section(params, "show")[index]!["behavior"] as Record<string, unknown>;
}

/** `params["displayOptions"]`. */
export function displayOf(
  params: Record<string, unknown>,
): Record<string, unknown> {
  return params["displayOptions"] as Record<string, unknown>;
}
