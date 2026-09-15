#!/usr/bin/env node
// generate-api-map.mjs — write conformance-runner/src/api-map.gen.ts, the
// table that maps every Python dotted call.api in the corpus to its TS home.
//
// Four inputs:
//   1. conformance-runner/corpus/typescript-port-api-map.json — authority
//      for Workspace member names/params/kwonly. Its ts_signature strings
//      are non-normative sketches and are never consumed.
//   2. conformance-runner/corpus/api-index.json — authority for every
//      non-Workspace entry point and the "module known" UNPORTED universe.
//   3. conformance-runner/src/naming-exceptions.json — the naming table:
//      exact rows first, then `<prefix>.*` module wildcards, then the
//      mechanical snake->camel transform with the leading underscore
//      dropped.
//   4. conformance-runner/src/authored-apis.json — api-index-shaped entries
//      for the hand-authored gate apis (compat.*, wirestub.*), which the
//      recorded-vector api-index can never carry, plus extra known_modules
//      for authored adapters deliberately left UNPORTED.
//
// Output is deterministic (sorted keys, sha256 stamps of all four inputs)
// so re-running on unchanged inputs is byte-identical; the freshness/parity
// test (test/api-map.test.ts) recomputes every entry through src/naming.ts
// and fails on drift between this script and the runtime naming module.
//
// The generator fails hard when any api-index name resolves through no
// exception row (silent fuzzy matching is forbidden) and when a workspace.*
// signature in api-index disagrees with the api-map.json member (two
// authorities must agree or the corpus is stale).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER_DIR = resolve(REPO_ROOT, "conformance-runner");
const API_INDEX_PATH = resolve(RUNNER_DIR, "corpus", "api-index.json");
const API_MAP_JSON_PATH = resolve(
  RUNNER_DIR,
  "corpus",
  "typescript-port-api-map.json",
);
const EXCEPTIONS_PATH = resolve(RUNNER_DIR, "src", "naming-exceptions.json");
const AUTHORED_APIS_PATH = resolve(RUNNER_DIR, "src", "authored-apis.json");
const OUTPUT_PATH = resolve(RUNNER_DIR, "src", "api-map.gen.ts");

/**
 * Read and parse one JSON input, stamping it with the sha256 of its bytes.
 *
 * @param {string} path - Absolute path of the JSON file.
 * @returns {{ json: unknown, sha256: string }} The parsed document and the hex digest of the raw text.
 */
function loadInput(path) {
  const text = readFileSync(path, "utf8");
  return {
    json: JSON.parse(text),
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

/**
 * Convert a snake_case Python identifier to camelCase, dropping one leading
 * underscore (mirror of conformance-runner/src/naming.ts).
 *
 * @param {string} name - Python identifier; must be non-empty after the underscore strip and contain no empty segments.
 * @returns {string} The camelCase identifier.
 */
function snakeToCamel(name) {
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
      `unexpected empty segment in identifier: ${JSON.stringify(name)}`,
    );
  }
  const [head, ...rest] = segments;
  return head + rest.map((s) => s[0].toUpperCase() + s.slice(1)).join("");
}

/**
 * Resolve one dotted Python api to its TS home through the naming-exceptions
 * rows: an exact row wins, else the module wildcard plus the mechanical
 * transform.
 *
 * @param {string} pythonApi - Dotted Python api name, e.g. `workspace.list_dashboards`.
 * @param {Array<{ python: string, ts: string }>} apiRows - The `scope === "api"` rows of naming-exceptions.json.
 * @returns {{ tsModule: string, tsName: string } | undefined} The TS module and member name, or `undefined` when no row covers the name.
 */
function resolveTsApiName(pythonApi, apiRows) {
  const exact = apiRows.find((row) => row.python === pythonApi);
  if (exact !== undefined) {
    // First-dot split (mirror of src/naming.ts): TS module paths use '/'
    // and never contain dots, so class-qualified members stay intact
    // (core/types.CohortDefinition.toDict -> member CohortDefinition.toDict).
    const firstDot = exact.ts.indexOf(".");
    return {
      tsModule: exact.ts.slice(0, firstDot),
      tsName: exact.ts.slice(firstDot + 1),
    };
  }
  const lastDot = pythonApi.lastIndexOf(".");
  const moduleKey = pythonApi.slice(0, lastDot);
  const finalSegment = pythonApi.slice(lastDot + 1);
  const wildcard = apiRows.find((row) => row.python === `${moduleKey}.*`);
  if (wildcard === undefined) {
    return;
  }
  if (!wildcard.ts.endsWith(".*")) {
    throw new Error(`wildcard row for ${moduleKey} must end in '.*'`);
  }
  return {
    tsModule: wildcard.ts.slice(0, -2),
    tsName: snakeToCamel(finalSegment),
  };
}

const apiIndex = loadInput(API_INDEX_PATH);
const apiMapJson = loadInput(API_MAP_JSON_PATH);
const exceptions = loadInput(EXCEPTIONS_PATH);
const authoredApis = loadInput(AUTHORED_APIS_PATH);

const apiRows = exceptions.json.rows.filter((row) => row.scope === "api");
const workspaceMembers = new Map(
  apiMapJson.json.workspace_members.map((member) => [member.name, member]),
);

// Merge the authored supplement into the api-index universe.
// A name in both sources means the supplement went stale after a corpus
// re-extraction started recording it — fail hard rather than pick one.
const universe = { ...apiIndex.json };
for (const [pythonApi, entry] of Object.entries(authoredApis.json.entries)) {
  if (Object.hasOwn(universe, pythonApi)) {
    console.error(
      `generate-api-map: authored-apis.json entry ${pythonApi} collides with api-index.json — remove the stale supplement row`,
    );
    process.exit(1);
  }
  universe[pythonApi] = entry;
}

const errors = [];
const entries = [];
for (const pythonApi of Object.keys(universe).sort()) {
  const indexEntry = universe[pythonApi];
  let params = indexEntry.params;
  let kwonly = indexEntry.kwonly;
  if (pythonApi.startsWith("workspace.")) {
    // api-map.json is the Workspace-member authority (input 1).
    const memberName = pythonApi.slice("workspace.".length);
    const member = workspaceMembers.get(memberName);
    if (member === undefined) {
      errors.push(`workspace member missing from api-map.json: ${pythonApi}`);
      continue;
    }
    if (
      JSON.stringify(member.params) !== JSON.stringify(indexEntry.params) ||
      JSON.stringify(member.kwonly) !== JSON.stringify(indexEntry.kwonly)
    ) {
      errors.push(
        `signature disagreement for ${pythonApi}: api-map.json ${JSON.stringify(
          [member.params, member.kwonly],
        )} vs api-index.json ${JSON.stringify([indexEntry.params, indexEntry.kwonly])}`,
      );
      continue;
    }
    params = member.params;
    kwonly = member.kwonly;
  }
  const tsHome = resolveTsApiName(pythonApi, apiRows);
  if (tsHome === undefined) {
    errors.push(`no naming-exceptions rule covers: ${pythonApi}`);
    continue;
  }
  entries.push({
    pythonApi,
    pythonModule: indexEntry.module,
    tsModule: tsHome.tsModule,
    tsName: tsHome.tsName,
    kind: indexEntry.kind,
    capability: indexEntry.capability,
    params,
    kwonly,
  });
}

if (errors.length > 0) {
  console.error(`generate-api-map: ${errors.length} unresolved entries:`);
  for (const message of errors) {
    console.error(`  - ${message}`);
  }
  process.exit(1);
}

const knownModules = [
  ...new Set([
    ...entries.map((e) => e.pythonApi.split(".", 1)[0]),
    ...authoredApis.json.known_modules,
  ]),
].sort();

const lines = [
  "// GENERATED FILE — DO NOT EDIT.",
  "// Regenerate with: npm run generate:api-map",
  "//",
  "// Maps every Python dotted call.api in the corpus api-index (plus the",
  "// authored D13 gate supplement) to its TS home (design D12/D13,",
  "// naming-map §5). Inputs + sha256 provenance stamps:",
  `//   corpus/typescript-port-api-map.json  ${apiMapJson.sha256}`,
  `//   corpus/api-index.json                ${apiIndex.sha256}`,
  `//   src/naming-exceptions.json           ${exceptions.sha256}`,
  `//   src/authored-apis.json               ${authoredApis.sha256}`,
  'import type { ApiMapEntry, ApiMapSourceHashes } from "./api-map-types.js";',
  "",
  "/** sha256 stamps of the four generation inputs (D12 provenance). */",
  "export const API_MAP_SOURCE_HASHES: ApiMapSourceHashes = {",
  `  apiMapJson: "${apiMapJson.sha256}",`,
  `  apiIndexJson: "${apiIndex.sha256}",`,
  `  namingExceptionsJson: "${exceptions.sha256}",`,
  `  authoredApisJson: "${authoredApis.sha256}",`,
  "};",
  "",
  "/** Python module prefixes known to the corpus api-index or the",
  ' * authored supplement — the "module known" universe for the',
  " * UNPORTED verdict (D12/TS-6). */",
  "export const KNOWN_PYTHON_MODULES: readonly string[] = [",
];
for (const moduleName of knownModules) {
  lines.push(`  "${moduleName}",`);
}
lines.push(
  "];",
  "",
  "/** Every corpus call.api -> TS home + signature shape. */",
  "export const API_MAP: Readonly<Record<string, ApiMapEntry>> = {",
);
for (const entry of entries) {
  lines.push(
    `  "${entry.pythonApi}": {`,
    `    pythonApi: "${entry.pythonApi}",`,
    `    pythonModule: "${entry.pythonModule}",`,
    `    tsModule: "${entry.tsModule}",`,
    `    tsName: "${entry.tsName}",`,
    `    kind: "${entry.kind}",`,
    `    capability: "${entry.capability}",`,
    `    params: ${JSON.stringify(entry.params)},`,
    `    kwonly: ${JSON.stringify(entry.kwonly)},`,
    "  },",
  );
}
lines.push("};", "");

writeFileSync(OUTPUT_PATH, lines.join("\n"));
console.log(
  `generate-api-map: wrote ${entries.length} entries, ${knownModules.length} known modules -> ${OUTPUT_PATH}`,
);
