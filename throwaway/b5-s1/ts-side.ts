/**
 * B5-S1 R10.9 differential harness — the TS side.
 *
 * Reads `cases.json` (written by `py-side.py`), computes the TS outputs
 * for the same 11 families, writes `ts-out.json`.
 *
 *     npx vite-node throwaway/b5-s1/ts-side.ts
 *
 * Throwaway (packet §7.5 removes `throwaway/b5-s1/` at the batch gate).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { MixpanelClient } from "../../packages/core/src/client/client.js";
import {
  DiscoveryService,
  inferScalarType,
  inferSubproperties,
  isValidIso,
  iterDictRows,
  parseBookmarkInfo,
  parseLexiconDefinition,
  parseLexiconMetadata,
  parseLexiconProperty,
  parseLexiconSchema,
} from "../../packages/core/src/services/discovery.js";
import { SchemaGraphResult } from "../../packages/core/src/types/results/discovery.js";
import { sortedByCodepoint } from "../../packages/core/src/compat/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The same ISO pre-filter the module uses (Python `_DATE_PATTERN`). */
const DATE_SHAPE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Run `fn`, recording the thrown class name the way the Python side does.
 *
 * @param fn - The thunk.
 * @returns The result or `{error}`.
 */
function guarded(fn: () => unknown): unknown {
  try {
    return fn();
  } catch (error) {
    return { error: (error as Error).name };
  }
}

const cases = JSON.parse(
  readFileSync(join(HERE, "cases.json"), "utf8"),
) as Record<string, unknown[]>;

const out: Record<string, unknown[]> = {};

out["infer_subproperties"] = (cases["infer_subproperties"] as string[][]).map(
  (case_) =>
    guarded(() => {
      const warnings: string[] = [];
      const subs = inferSubproperties(case_, (message) => {
        warnings.push(message);
      });
      return {
        subs: subs.map((s) => ({
          name: s.name,
          type: s.type,
          sample_values: [...s.sample_values],
        })),
        warnings: sortedByCodepoint(warnings),
      };
    }),
);

out["infer_scalar_type"] = (
  cases["infer_scalar_type"] as Array<Array<string | number | boolean>>
).map((case_) => guarded(() => inferScalarType(case_)));

out["is_valid_iso"] = (cases["is_valid_iso"] as string[]).map(
  (case_) => DATE_SHAPE.test(case_) && isValidIso(case_),
);

out["iter_dict_rows"] = (cases["iter_dict_rows"] as string[][]).map((case_) =>
  iterDictRows(case_),
);

out["parse_lexicon_metadata"] = (
  cases["parse_lexicon_metadata"] as Array<Record<string, unknown> | null>
).map((case_) => parseLexiconMetadata(case_)?.toJSON() ?? null);

out["parse_lexicon_property"] = (
  cases["parse_lexicon_property"] as Array<Record<string, unknown>>
).map((case_) => parseLexiconProperty(case_).toJSON());

out["parse_lexicon_definition"] = (
  cases["parse_lexicon_definition"] as Array<Record<string, unknown>>
).map((case_) => parseLexiconDefinition(case_).toJSON());

out["parse_lexicon_schema"] = (
  cases["parse_lexicon_schema"] as Array<Record<string, unknown>>
).map((case_) => guarded(() => parseLexiconSchema(case_).toJSON()));

out["parse_bookmark_info"] = (
  cases["parse_bookmark_info"] as Array<Record<string, unknown>>
).map((case_) => guarded(() => parseBookmarkInfo(case_).toJSON()));

const svc = new DiscoveryService(null as unknown as MixpanelClient);
out["find_similar_events"] = (
  cases["find_similar_events"] as Array<{ query: string; events: string[] }>
).map((case_) => svc.findSimilarEvents(case_.query, case_.events));

out["schema_graph"] = (
  cases["schema_graph"] as Array<Record<string, never>>
).map((case_) => {
  const result = new SchemaGraphResult({ computed_at: "t", ...case_ });
  const graph = result.toGraph();
  return {
    nodes: graph.nodes.map((n) => ({ name: n.name, kind: n.kind })),
    edges: graph.edges.map((e) => ({
      source: e.source,
      target: e.target,
      density_local: e.density_local,
    })),
    event_to_properties: result.event_to_properties,
    property_to_events: result.property_to_events,
    meta: result.meta,
    orphans: result.orphanProperties(),
  };
});

/**
 * `JSON.stringify` that preserves NEGATIVE ZERO (`JSON.stringify(-0)`
 * is `"0"`, which would fake a divergence against CPython's `-0.0`).
 *
 * @param value - The value to encode.
 * @returns The JSON text.
 */
function stringify(value: unknown): string {
  if (typeof value === "number" && Object.is(value, -0)) {
    return "-0.0";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stringify(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

writeFileSync(join(HERE, "ts-out.json"), stringify(out), "utf8");
console.log(
  "wrote",
  Object.values(out).reduce((sum, list) => sum + list.length, 0),
  "results across",
  Object.keys(out).length,
  "families",
);
