/**
 * snake_case to camelCase naming policy for Python api names.
 *
 * Vectors are Python-shaped; all mapping happens at the TS runner boundary.
 * This module implements the mechanical transform and the
 * `naming-exceptions.json` resolution used both by the api-map generator's
 * parity/freshness test and by the runtime kwarg mapping. The reverse
 * transform is never needed: comparison always happens in Python-shaped
 * space. The user-facing rule is PORTING.md "Naming".
 */

/**
 * One row of `naming-exceptions.json`.
 *
 * `scope: "api"` rows map dotted entry-point names; a trailing `.*` in
 * `python` makes the row a module-relocation wildcard whose `ts` value must
 * also end in `.*`. `kwarg:*` / `type:*` rows document kwarg- and
 * type-field-level casing policy consumed by the codec layer.
 */
export interface NamingExceptionRow {
  /** Python-side name (dotted api, kwarg, or field pattern). */
  readonly python: string;
  /** TS-side name, `<module path>.<name>` for api-scoped rows. */
  readonly ts: string;
  /** Rule scope: `api`, `kwarg:<api or *>`, or `type:<TypeName or *>`. */
  readonly scope: string;
  /** Whether the row renames or keeps the Python spelling. */
  readonly rule: "rename" | "keep";
}

/** A resolved TS home for a Python dotted api name. */
export interface TsApiName {
  /** TS module path, e.g. `core/query/segfilter`. */
  readonly tsModule: string;
  /** TS member name, e.g. `buildSegfilterEntry`. */
  readonly tsName: string;
}

/**
 * Mechanically convert one snake_case identifier to camelCase.
 *
 * Digits stay attached to their segment (`r2_score` to `r2Score`); acronyms
 * are never uppercased (`url_normalizer` to `urlNormalizer`). A single
 * leading underscore is dropped first (Python module-privates like
 * `_sanitize_raw_cohort` become `sanitizeRawCohort`); any other empty segment
 * (`__x`, `a__b`, trailing `_`) is rejected rather than guessed at.
 *
 * @param name - The snake_case identifier.
 * @returns The camelCase spelling.
 * @throws Error - If the name is empty or contains an empty segment.
 * @example
 * ```typescript
 * snakeToCamel("build_funnel_params");
 * // "buildFunnelParams"
 * ```
 */
export function snakeToCamel(name: string): string {
  let source = name;
  if (source.startsWith("_")) {
    source = source.slice(1);
  }
  if (source === "") {
    throw new Error(
      `cannot camelize empty identifier: ${JSON.stringify(name)}`,
    );
  }
  const segments = source.split("_");
  if (segments.includes("")) {
    throw new Error(
      `unexpected empty segment in identifier: ${JSON.stringify(name)} (naming-map §3)`,
    );
  }
  const [head, ...rest] = segments;
  return (
    (head as string) +
    rest
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join("")
  );
}

/**
 * Split a `<module path>.<member>` string on its first dot.
 *
 * TS module paths use `/` separators and never contain dots, so the first
 * dot always starts the member part. First-dot (not last-dot) semantics
 * keep class-qualified members intact: `core/types.CohortDefinition.toDict`
 * splits into module `core/types` and member `CohortDefinition.toDict`.
 *
 * @param dotted - e.g. `core/query/segfilter.buildSegfilterEntry`.
 * @returns The module path and member name.
 * @throws Error - If there is no dot to split on.
 */
function splitTsDotted(dotted: string): TsApiName {
  const firstDot = dotted.indexOf(".");
  if (firstDot <= 0 || firstDot === dotted.length - 1) {
    throw new Error(`malformed ts api target: ${JSON.stringify(dotted)}`);
  }
  return {
    tsModule: dotted.slice(0, firstDot),
    tsName: dotted.slice(firstDot + 1),
  };
}

/**
 * Resolve a Python dotted `call.api` name to its TS module and member name.
 *
 * Order: (1) exact `scope: "api"` row match; (2) wildcard module row
 * (`<prefix>.*`) with the mechanical transform on the final segment;
 * (3) no match yields `undefined` (callers decide between generator
 * hard-fail and the runner's `UNPORTED`/`UNMAPPED_API` classification —
 * silent fuzzy matching is forbidden).
 *
 * @param pythonApi - Dotted Python name, e.g. `segfilter.build_segfilter_entry`.
 * @param exceptions - Rows loaded from `naming-exceptions.json`.
 * @returns The TS home, or `undefined` when no rule covers the name.
 * @throws Error - On malformed rows or identifiers.
 * @example
 * ```ts
 * resolveTsApiName("segfilter.build_segfilter_entry", rows);
 * // { tsModule: "core/query/segfilter", tsName: "buildSegfilterEntry" }
 * resolveTsApiName("mystery.call", rows); // undefined
 * ```
 */
export function resolveTsApiName(
  pythonApi: string,
  exceptions: readonly NamingExceptionRow[],
): TsApiName | undefined {
  const apiRows = exceptions.filter((row) => row.scope === "api");
  const exact = apiRows.find((row) => row.python === pythonApi);
  if (exact !== undefined) {
    return splitTsDotted(exact.ts);
  }
  const lastDot = pythonApi.lastIndexOf(".");
  if (lastDot <= 0) {
    return undefined;
  }
  const moduleKey = pythonApi.slice(0, lastDot);
  const finalSegment = pythonApi.slice(lastDot + 1);
  const wildcard = apiRows.find((row) => row.python === `${moduleKey}.*`);
  if (wildcard === undefined) {
    return undefined;
  }
  if (!wildcard.ts.endsWith(".*")) {
    throw new Error(
      `wildcard row for ${moduleKey} must map to '<module>.*', got ${JSON.stringify(wildcard.ts)}`,
    );
  }
  return {
    tsModule: wildcard.ts.slice(0, -2),
    tsName: snakeToCamel(finalSegment),
  };
}
