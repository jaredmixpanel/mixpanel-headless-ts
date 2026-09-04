// generate-bridge-allowlist.mjs — write conformance-runner/bridge-allowlist.gen.json,
// the route/classification table the Mixpanel Desktop bridge handler matches
// every page-originated request against (heads platform spec of record,
// docs/specs/heads/01-lease-and-bridge.md §5.3, task H2).
//
// Inputs (all committed, all pinned):
//   1. conformance-runner/corpus/**/*.jsonl — the extracted wire vectors. Every
//      vector with kind "wire" and origin "extracted" contributes its recorded
//      HTTP interactions; nothing else does.
//   2. conformance-runner/corpus/api-index.json — python api -> capability/kind.
//   3. conformance-runner/src/api-map.gen.ts — python api -> TS method name.
//      Read, never edited (it has its own generator and freshness test).
//   4. scripts/bridge-allowlist-rules.json — host/family/exclusion/classifier/
//      write-class tables, transcribed from spec §5.2-§5.3. Data, not code.
//   5. scripts/consent-verbs.json — tsMethod -> consent verb phrase (§7.2).
//
// The generator FAILS HARD rather than guessing:
//   - an interaction on a host the rules do not name (admitted or export);
//   - a path outside the /api/query/ and /api/app/ families;
//   - a python method name no read/write rule reaches, or one that both a
//     read and a write rule reach;
//   - a write route no write-class rule reaches;
//   - a write row whose tsMethod has no consent verb;
//   - two vectors that disagree about the access or write class of one route.
//
// Usage:
//   node scripts/generate-bridge-allowlist.mjs
//   node scripts/generate-bridge-allowlist.mjs --stdout \
//        --generated-at=<iso> --headless-commit=<sha>
// The two overrides exist for the freshness test: `generatedAt` and
// `headlessCommit` legitimately move on every run, so the test feeds the
// committed values back in and byte-compares everything that is derived.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER_DIR = resolve(REPO_ROOT, "conformance-runner");
const CORPUS_DIR = resolve(RUNNER_DIR, "corpus");
const CORPUS_CONFIG_PATH = resolve(RUNNER_DIR, "corpus.config.json");
const API_INDEX_PATH = resolve(CORPUS_DIR, "api-index.json");
const API_MAP_PATH = resolve(RUNNER_DIR, "src", "api-map.gen.ts");
const RULES_PATH = resolve(REPO_ROOT, "scripts", "bridge-allowlist-rules.json");
const VERBS_PATH = resolve(REPO_ROOT, "scripts", "consent-verbs.json");
const OUTPUT_PATH = resolve(RUNNER_DIR, "bridge-allowlist.gen.json");

/** Parse `--flag=value` arguments; bare `--stdout` is a boolean. */
function parseArgs(argv) {
  const args = {
    stdout: false,
    generatedAt: undefined,
    headlessCommit: undefined,
  };
  for (const arg of argv) {
    if (arg === "--stdout") {
      args.stdout = true;
    } else if (arg.startsWith("--generated-at=")) {
      args.generatedAt = arg.slice("--generated-at=".length);
    } else if (arg.startsWith("--headless-commit=")) {
      args.headlessCommit = arg.slice("--headless-commit=".length);
    } else {
      fail([`unknown argument: ${arg}`]);
    }
  }
  return args;
}

/** Print the reasons and exit non-zero. Never returns. */
function fail(reasons) {
  console.error(`generate-bridge-allowlist: ${reasons.length} problem(s):`);
  for (const reason of reasons) {
    console.error(`  - ${reason}`);
  }
  process.exit(1);
}

/** Read a file and return { text, json, sha256 }. */
function loadJson(path) {
  const text = readFileSync(path, "utf8");
  return {
    json: JSON.parse(text),
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

/** Every *.jsonl under the corpus, sorted so the walk is deterministic. */
function corpusFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...corpusFiles(path));
    } else if (entry.name.endsWith(".jsonl")) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Parse the generated api-map for python api -> TS method name. The file is
 * machine-written with one `"<pythonApi>": {` block per entry and a
 * `tsName: "<name>",` line inside it, so a line scan is exact; anything
 * unexpected in the shape surfaces as a missing name later.
 */
function loadTsMethods(path) {
  const methods = new Map();
  let current;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const open = /^ {2}"([^"]+)": \{$/.exec(line);
    if (open !== null) {
      current = open[1];
      continue;
    }
    const tsName = /^ {4}tsName: "([^"]+)",$/.exec(line);
    if (tsName !== null && current !== undefined) {
      methods.set(current, tsName[1]);
      current = undefined;
    }
  }
  if (methods.size === 0) {
    fail([`no tsName entries parsed out of ${path}`]);
  }
  return methods;
}

/**
 * Every string/number leaf in `call.input`, stringified — the candidate
 * `{param}` path segments (spec §5.3 step 2). Booleans and nulls cannot be
 * path segments and empty strings would match the empty segments a leading
 * or trailing slash produces, so both are dropped.
 */
function inputValues(value, into) {
  if (Array.isArray(value)) {
    for (const item of value) {
      inputValues(item, into);
    }
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      inputValues(item, into);
    }
  } else if (typeof value === "string") {
    if (value !== "") {
      into.add(value);
    }
  } else if (typeof value === "number") {
    into.add(String(value));
  }
  return into;
}

/** Split on "/" FIRST, then percent-decode each segment (spec §5.2). */
function decodeSegments(path) {
  return path.split("/").map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
}

const args = parseArgs(process.argv.slice(2));
const rulesInput = loadJson(RULES_PATH);
const verbsInput = loadJson(VERBS_PATH);
const rules = rulesInput.json;
const verbs = verbsInput.json.verbs;
const apiIndex = loadJson(API_INDEX_PATH).json;
const corpusConfig = loadJson(CORPUS_CONFIG_PATH).json;
const tsMethods = loadTsMethods(API_MAP_PATH);

const problems = [];

/** Access classification by python method name (spec §5.3 step 4). */
const readPrefixes = rules.access.readPrefixes;
const writePrefixes = rules.access.writePrefixes;
const readMethods = new Set(Object.keys(rules.access.readMethods));
const writeMethods = new Set(Object.keys(rules.access.writeMethods));
function classifyAccess(pythonApi) {
  const method = pythonApi.slice(pythonApi.lastIndexOf(".") + 1);
  const isRead =
    readMethods.has(method) || readPrefixes.some((p) => method.startsWith(p));
  const isWrite =
    writeMethods.has(method) || writePrefixes.some((p) => method.startsWith(p));
  if (isRead && isWrite) {
    return { error: `matches both a read and a write rule: ${pythonApi}` };
  }
  if (!isRead && !isWrite) {
    return { error: `no read or write rule covers: ${pythonApi}` };
  }
  return { access: isRead ? "read" : "write" };
}

/** Write class from the route template (spec §5.3 step 5); first match wins. */
function classifyWrite(template) {
  for (const rule of rules.writeClasses.rules) {
    if (template.includes(rule.contains)) {
      return rule.class;
    }
  }
  return undefined;
}

/** family from scheme_host + path prefix (spec §5.3 step 2). */
function familyFor(path) {
  for (const rule of rules.families) {
    if (path.startsWith(rule.pathPrefix)) {
      return rule.family;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Walk the corpus.
// ---------------------------------------------------------------------------
/** key `${method}\n${family}\n${template}` -> accumulating row state. */
const routes = new Map();

for (const file of corpusFiles(CORPUS_DIR)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const vector = JSON.parse(line);
    if (vector.$bundle !== undefined) {
      continue;
    }
    if (vector.kind !== "wire" || vector.origin !== "extracted") {
      continue;
    }
    const pythonApi = vector.call.api;
    if (Object.hasOwn(rules.excludedApis, pythonApi)) {
      continue;
    }
    if (pythonApi.startsWith("wirestub.")) {
      continue;
    }

    const indexEntry = apiIndex[pythonApi];
    if (indexEntry === undefined) {
      problems.push(`api-index.json has no entry for ${pythonApi}`);
      continue;
    }
    const tsMethod = tsMethods.get(pythonApi);
    if (tsMethod === undefined) {
      problems.push(`api-map.gen.ts has no tsName for ${pythonApi}`);
      continue;
    }
    const classified = classifyAccess(pythonApi);
    if (classified.error !== undefined) {
      problems.push(classified.error);
      continue;
    }

    const projectId = String(vector.call.session?.project_id ?? "");
    const values = inputValues(vector.call.input ?? {}, new Set());

    for (const interaction of vector.expect?.interactions ?? []) {
      const request = interaction.request;
      const host = request.scheme_host;
      if (Object.hasOwn(rules.exportHosts, host)) {
        // Spec §5.2: the export family is never admitted.
        continue;
      }
      if (!Object.hasOwn(rules.admittedHosts, host)) {
        problems.push(
          `unknown host ${host} (from ${pythonApi}) — add it to admittedHosts/exportHosts, or exclude the api`,
        );
        continue;
      }
      const segments = decodeSegments(request.path);
      const path = segments.join("/");
      const family = familyFor(path);
      if (family === undefined) {
        problems.push(
          `path outside the admitted families: ${request.path} (from ${pythonApi})`,
        );
        continue;
      }

      const template = segments
        .map((segment) => {
          if (segment === "") return segment;
          if (projectId !== "" && segment === projectId) return "{project_id}";
          if (values.has(segment)) return "{param}";
          if (/^[0-9]+$/.test(segment)) return "{int}";
          return segment;
        })
        .join("/");

      const key = `${request.method}\n${family}\n${template}`;
      let route = routes.get(key);
      if (route === undefined) {
        route = {
          method: request.method,
          family,
          template,
          paramNames: new Set(),
          access: new Map(),
          apis: new Map(),
        };
        routes.set(key, route);
      }
      for (const name of Object.keys(request.params ?? {})) {
        route.paramNames.add(name);
      }
      if (!route.access.has(classified.access)) {
        route.access.set(classified.access, pythonApi);
      }
      let api = route.apis.get(pythonApi);
      if (api === undefined) {
        api = {
          pyApi: pythonApi,
          tsMethod,
          capability: indexEntry.capability,
          vectors: new Set(),
        };
        route.apis.set(pythonApi, api);
      }
      api.vectors.add(vector.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Shape the rows.
// ---------------------------------------------------------------------------
const rows = [];
for (const route of routes.values()) {
  if (route.access.size > 1) {
    const witnesses = [...route.access.entries()]
      .map(([access, pythonApi]) => `${access} via ${pythonApi}`)
      .join(", ");
    problems.push(
      `ambiguous classification for ${route.method} ${route.family} ${route.template}: ${witnesses}`,
    );
    continue;
  }
  const access = [...route.access.keys()][0];
  const apis = [...route.apis.values()].sort(
    (a, b) =>
      b.vectors.size - a.vectors.size ||
      (a.pyApi < b.pyApi ? -1 : a.pyApi > b.pyApi ? 1 : 0),
  );
  const primary = apis[0];
  const vectorCount = new Set(apis.flatMap((a) => [...a.vectors])).size;

  const row = {
    method: route.method,
    family: route.family,
    template: route.template,
    paramNames: [...route.paramNames].sort(),
    access,
  };
  if (access === "write") {
    const writeClass = classifyWrite(route.template);
    if (writeClass === undefined) {
      problems.push(
        `no write class covers write route ${route.method} ${route.template} (from ${primary.pyApi})`,
      );
      continue;
    }
    const consentVerb = verbs[primary.tsMethod];
    if (consentVerb === undefined) {
      problems.push(
        `consent-verbs.json has no verb for write method ${primary.tsMethod} (${primary.pyApi})`,
      );
      continue;
    }
    for (const api of apis) {
      if (verbs[api.tsMethod] === undefined) {
        problems.push(
          `consent-verbs.json has no verb for write method ${api.tsMethod} (${api.pyApi}, alias on ${route.method} ${route.template})`,
        );
      }
    }
    row.writeClass = writeClass;
    row.consentVerb = consentVerb;
  }
  row.tsMethod = primary.tsMethod;
  row.pyApi = primary.pyApi;
  row.capability = primary.capability;
  row.vectorCount = vectorCount;
  const aliases = apis.slice(1).map((api) => ({
    pyApi: api.pyApi,
    tsMethod: api.tsMethod,
    capability: api.capability,
    vectorCount: api.vectors.size,
  }));
  if (aliases.length > 0) {
    row.aliases = aliases;
  }
  rows.push(row);
}

if (problems.length > 0) {
  fail(problems);
}

rows.sort(
  (a, b) =>
    (a.family < b.family ? -1 : a.family > b.family ? 1 : 0) ||
    (a.template < b.template ? -1 : a.template > b.template ? 1 : 0) ||
    (a.method < b.method ? -1 : a.method > b.method ? 1 : 0),
);

const headlessCommit =
  args.headlessCommit ??
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();

const output = {
  schema: 1,
  corpusCommit: corpusConfig.sourceCommit,
  generatedAt: args.generatedAt ?? new Date().toISOString(),
  headlessCommit,
  rulesSha256: rulesInput.sha256,
  verbsSha256: verbsInput.sha256,
  rows,
};

const text = `${JSON.stringify(output, null, 2)}\n`;
if (args.stdout) {
  process.stdout.write(text);
} else {
  writeFileSync(OUTPUT_PATH, text);
  const writeRows = rows.filter((row) => row.access === "write").length;
  console.log(
    `generate-bridge-allowlist: wrote ${rows.length} rows (${rows.length - writeRows} read, ${writeRows} write) -> ${OUTPUT_PATH}`,
  );
}
