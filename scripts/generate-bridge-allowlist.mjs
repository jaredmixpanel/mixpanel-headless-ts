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
//   6. scripts/route-verbs.json — "<METHOD> <family> <template>" -> the
//      phrase for a route whose methods disagree, or that needs its own
//      wording. Consent is authorised per ROUTE, not per method.
//
// The generator FAILS HARD rather than guessing:
//   - an interaction on a host the rules do not name (admitted or export);
//   - a path outside the /api/query/ and /api/app/ families;
//   - a template with a placeholder directly under a family root, which
//     would wildcard that whole family;
//   - a literal template segment still holding a "/" after percent-decoding,
//     which the matcher could not segment unambiguously;
//   - a python method name no read/write rule reaches, or one that both a
//     read and a write rule reach;
//   - a write route no write-class rule reaches;
//   - a write row whose tsMethod has no consent verb, or whose methods give
//     different verbs and which route-verbs.json does not disambiguate;
//   - a `{n}` count placeholder on anything but a bulk method;
//   - a matchable {workspace_id} route left pin-less;
//   - two vectors that disagree about the access or write class of one route;
//   - a deny rule, or a route-verb entry, that matches no route (stale).
//
// Usage:
//   node scripts/generate-bridge-allowlist.mjs
//   node scripts/generate-bridge-allowlist.mjs --stdout \
//        --generated-at=<iso> --headless-commit=<sha>
//   node scripts/generate-bridge-allowlist.mjs --stdout \
//        --rules=<path> --verbs=<path> --route-verbs=<path>
// The first pair of overrides exists for the freshness test: `generatedAt`
// and `headlessCommit` legitimately move on every run, so the test feeds the
// committed values back in and byte-compares everything that is derived. The
// second lets the tests point the generator at deliberately broken rule data
// and assert it refuses, without touching the committed files.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compareStrings } from "./lib/compare-strings.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER_DIR = resolve(REPO_ROOT, "conformance-runner");
const CORPUS_DIR = resolve(RUNNER_DIR, "corpus");
const CORPUS_CONFIG_PATH = resolve(RUNNER_DIR, "corpus.config.json");
const API_INDEX_PATH = resolve(CORPUS_DIR, "api-index.json");
const API_MAP_PATH = resolve(RUNNER_DIR, "src", "api-map.gen.ts");
const DEFAULT_RULES_PATH = resolve(
  REPO_ROOT,
  "scripts",
  "bridge-allowlist-rules.json",
);
const DEFAULT_VERBS_PATH = resolve(REPO_ROOT, "scripts", "consent-verbs.json");
const DEFAULT_ROUTE_VERBS_PATH = resolve(
  REPO_ROOT,
  "scripts",
  "route-verbs.json",
);
const OUTPUT_PATH = resolve(RUNNER_DIR, "bridge-allowlist.gen.json");
/** Route-template placeholder for the workspace segment. */
const WORKSPACE_PLACEHOLDER = "{workspace_id}";

/** Parse `--flag=value` arguments; bare `--stdout` is a boolean. */
function parseArgs(argv) {
  const args = {
    stdout: false,
    generatedAt: undefined,
    headlessCommit: undefined,
    rulesPath: DEFAULT_RULES_PATH,
    verbsPath: DEFAULT_VERBS_PATH,
    routeVerbsPath: DEFAULT_ROUTE_VERBS_PATH,
  };
  for (const arg of argv) {
    if (arg === "--stdout") {
      args.stdout = true;
    } else if (arg.startsWith("--generated-at=")) {
      args.generatedAt = arg.slice("--generated-at=".length);
    } else if (arg.startsWith("--headless-commit=")) {
      args.headlessCommit = arg.slice("--headless-commit=".length);
    } else if (arg.startsWith("--rules=")) {
      args.rulesPath = resolve(arg.slice("--rules=".length));
    } else if (arg.startsWith("--verbs=")) {
      args.verbsPath = resolve(arg.slice("--verbs=".length));
    } else if (arg.startsWith("--route-verbs=")) {
      args.routeVerbsPath = resolve(arg.slice("--route-verbs=".length));
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
    compareStrings(a.name, b.name),
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

/**
 * Every scalar carried under one of `keys`, anywhere in `value`, stringified.
 * This is how a segment earns a NAMED placeholder ({workspace_id}) or stays
 * literal (a closed-enum route name): the key it arrived under is the
 * evidence, not the shape of the value.
 */
function keyedValues(value, keys, into) {
  if (Array.isArray(value)) {
    for (const item of value) {
      keyedValues(item, keys, into);
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (
        keys.has(key) &&
        (typeof item === "string" || typeof item === "number") &&
        String(item) !== ""
      ) {
        into.add(String(item));
      }
      keyedValues(item, keys, into);
    }
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
const rulesInput = loadJson(args.rulesPath);
const verbsInput = loadJson(args.verbsPath);
const routeVerbsInput = loadJson(args.routeVerbsPath);
const rules = rulesInput.json;
const verbs = verbsInput.json.verbs;
const routeVerbs = routeVerbsInput.json.verbs;
/** Route-verb keys that actually matched a route, for the stale check. */
const usedRouteVerbs = new Set();
const apiIndex = loadJson(API_INDEX_PATH).json;
const corpusConfig = loadJson(CORPUS_CONFIG_PATH).json;
const tsMethods = loadTsMethods(API_MAP_PATH);

const problems = [];

/** Input keys whose values name a route rather than identify a record. */
const closedEnumKeys = new Set(rules.pathPlaceholders.closedEnumKeys);

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

/** Is this tsMethod one of the bulk operations `{n}` is meant for? */
function isBulkMethod(tsMethod) {
  return (
    tsMethod.startsWith(rules.consent.bulkMethodPrefix) ||
    tsMethod.endsWith(rules.consent.bulkMethodSuffix)
  );
}

/**
 * The consent phrase for a write ROUTE (spec §7.2). Consent is authorised per
 * route, not per method: several headless methods can share one route and the
 * server cannot tell them apart, so a phrase drawn from just the primary api
 * could misdescribe what the page is about to do. An explicit route-level
 * phrase always wins; otherwise every api on the route must agree.
 */
function consentVerbFor(route, apis) {
  const key = `${route.method} ${route.family} ${route.template}`;
  const routeVerb = routeVerbs[key];
  if (routeVerb !== undefined) {
    usedRouteVerbs.add(key);
    return { verb: routeVerb };
  }
  const missing = apis.filter((api) => verbs[api.tsMethod] === undefined);
  if (missing.length > 0) {
    return {
      error: `consent-verbs.json has no verb for write method(s) ${missing
        .map((api) => `${api.tsMethod} (${api.pyApi})`)
        .join(", ")} on ${key}`,
    };
  }
  const distinct = [...new Set(apis.map((api) => verbs[api.tsMethod]))];
  if (distinct.length > 1) {
    const detail = [
      ...new Set(
        apis.map(
          (api) => `${api.tsMethod} -> ${JSON.stringify(verbs[api.tsMethod])}`,
        ),
      ),
    ]
      .sort()
      .join("; ");
    return {
      error: `write route ${key} is reached by methods with different consent verbs (${detail}) — give the route its own phrase in route-verbs.json`,
    };
  }
  return { verb: distinct[0] };
}

/** Write class from the route template (spec §5.3 step 5); first match wins. */
function classifyWrite(template) {
  for (const rule of rules.writeClasses.rules) {
    if (template.includes(rule.contains)) {
      return rule.class;
    }
  }
  return;
}

/** family from scheme_host + path prefix (spec §5.3 step 2). */
function familyFor(path) {
  for (const rule of rules.families) {
    if (path.startsWith(rule.pathPrefix)) {
      return rule.family;
    }
  }
  return;
}

/**
 * Segment index of the first path element BELOW a family root, e.g. 3 for
 * `/api/app/<here>` and 4 for `/api/query/engage/<here>`. A placeholder at
 * that index wildcards the whole family, so the generator refuses it.
 */
const familyRootDepth = new Map(
  rules.families.map((rule) => [
    rule.family,
    rule.pathPrefix.replace(/\/$/, "").split("/").length,
  ]),
);

/** Every field name any pin kind is carried under. */
const pinFieldNames = new Set(
  rules.pinRules.kinds.flatMap((kind) => kind.fields),
);

/**
 * Which identifier §5.5 can hold this route to, and where that identifier
 * actually appears. §5.5 pins EVERY occurrence, and the query family carries
 * its project id as a query param or a top-level body field rather than as a
 * path segment — so a template-only rule would report "none" for the whole
 * query family and quietly drop the check there.
 */
function pinFor(template, paramNames, bodyFields) {
  for (const kind of rules.pinRules.kinds) {
    const sources = [];
    if (template.includes(kind.placeholder)) {
      sources.push("path");
    }
    if (kind.fields.some((field) => paramNames.has(field))) {
      sources.push("query");
    }
    if (kind.fields.some((field) => bodyFields.has(field))) {
      sources.push("body");
    }
    if (sources.length > 0) {
      return { pin: kind.pin, pinSources: sources };
    }
  }
  return { pin: rules.pinRules.default, pinSources: [] };
}

/** The deny rule covering this route, if the rules refuse it (§5.3). */
const denyRules = rules.deniedRoutes.map((rule) => ({ ...rule, hits: 0 }));
function denyRuleFor(method, family, template) {
  for (const rule of denyRules) {
    if (
      rule.method === method &&
      rule.family === family &&
      rule.template === template
    ) {
      rule.hits += 1;
      return rule;
    }
  }
  return;
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

    // Keyed lookups also read the setup calls: the client learns its
    // workspace from api_client.set_workspace_id, not from the measured
    // call's own arguments (spec §5.3 step 2, pathPlaceholders rule).
    const keyedScopes = [
      vector.call.input ?? {},
      ...(vector.call.setup ?? []).map((step) => step.input ?? {}),
    ];
    const closedEnumValues = new Set();
    for (const scope of keyedScopes) {
      keyedValues(scope, closedEnumKeys, closedEnumValues);
    }
    /** placeholder -> the values that earn it, for this vector. */
    const namedValues = rules.pathPlaceholders.keyedPlaceholders.map(
      (placeholder) => {
        const found = new Set();
        const keys = new Set(placeholder.inputKeys);
        for (const scope of keyedScopes) {
          keyedValues(scope, keys, found);
        }
        const sessionValue =
          placeholder.sessionField === undefined
            ? undefined
            : vector.call.session?.[placeholder.sessionField];
        if (sessionValue !== undefined && sessionValue !== null) {
          found.add(String(sessionValue));
        }
        return { placeholder: placeholder.placeholder, values: found };
      },
    );

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

      const templateSegments = segments.map((segment) => {
        if (segment === "") return segment;
        if (projectId !== "" && segment === projectId) return "{project_id}";
        // A closed-enum route name stays literal: the api's parameter is a
        // fixed set of routes, and {param} there would wildcard the family.
        if (closedEnumValues.has(segment)) return segment;
        for (const named of namedValues) {
          if (named.values.has(segment)) return named.placeholder;
        }
        if (values.has(segment)) return "{param}";
        if (/^[0-9]+$/.test(segment)) return "{int}";
        return segment;
      });
      const template = templateSegments.join("/");

      const rootDepth = familyRootDepth.get(family);
      const head = templateSegments[rootDepth];
      if (head !== undefined && head.startsWith("{")) {
        problems.push(
          `placeholder directly under the ${family} family root: ${template} (from ${pythonApi}, path ${request.path}) — a wildcard over the whole family`,
        );
        continue;
      }
      const sliced = templateSegments.find(
        (segment) => !segment.startsWith("{") && segment.includes("/"),
      );
      if (sliced !== undefined) {
        problems.push(
          `literal segment still holds a "/" after decoding: ${JSON.stringify(sliced)} in ${request.path} (from ${pythonApi})`,
        );
        continue;
      }

      const key = `${request.method}\n${family}\n${template}`;
      let route = routes.get(key);
      if (route === undefined) {
        route = {
          method: request.method,
          family,
          template,
          paramNames: new Set(),
          bodyFields: new Set(),
          access: new Map(),
          apis: new Map(),
        };
        routes.set(key, route);
      }
      for (const name of Object.keys(request.params ?? {})) {
        route.paramNames.add(name);
      }
      // Only the pin-bearing top-level body keys are kept: the rest of the
      // body is the page's business, and §5.5 only pins identifiers.
      const body = request.json_body;
      if (body !== null && typeof body === "object" && !Array.isArray(body)) {
        for (const name of Object.keys(body)) {
          if (pinFieldNames.has(name)) {
            route.bodyFields.add(name);
          }
        }
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
const deniedRoutes = [];
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
      b.vectors.size - a.vectors.size || compareStrings(a.pyApi, b.pyApi),
  );
  const primary = apis[0];
  const vectorCount = new Set(apis.flatMap((a) => [...a.vectors])).size;

  const pinned = pinFor(route.template, route.paramNames, route.bodyFields);
  const row = {
    method: route.method,
    family: route.family,
    template: route.template,
    paramNames: [...route.paramNames].sort(),
    access,
    pin: pinned.pin,
    pinSources: pinned.pinSources,
  };
  if (access === "write") {
    const writeClass = classifyWrite(route.template);
    if (writeClass === undefined) {
      problems.push(
        `no write class covers write route ${route.method} ${route.template} (from ${primary.pyApi})`,
      );
      continue;
    }
    const consent = consentVerbFor(route, apis);
    if (consent.error !== undefined) {
      problems.push(consent.error);
      continue;
    }
    if (
      consent.verb.includes(rules.consent.countPlaceholder) &&
      apis.some((api) => !isBulkMethod(api.tsMethod))
    ) {
      problems.push(
        `consent verb for ${route.method} ${route.family} ${route.template} uses ${rules.consent.countPlaceholder} but the route is reachable by non-bulk method(s) ${apis
          .filter((api) => !isBulkMethod(api.tsMethod))
          .map((api) => api.tsMethod)
          .join(", ")}`,
      );
      continue;
    }
    row.writeClass = writeClass;
    row.consentVerb = consent.verb;
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
  const denied = denyRuleFor(route.method, route.family, route.template);
  if (denied === undefined) {
    rows.push(row);
  } else {
    // Out of `rows` — the matcher must never admit it — but still emitted,
    // so the handler can name what it refused and the coverage test can see
    // that the api is accounted for rather than missing.
    row.denyReason = denied.reason;
    deniedRoutes.push(row);
  }
}

for (const rule of denyRules) {
  if (rule.hits === 0) {
    problems.push(
      `deny rule matches no route: ${rule.method} ${rule.family} ${rule.template} — the corpus moved, so the refusal is stale`,
    );
  }
}

for (const key of Object.keys(routeVerbs)) {
  if (!usedRouteVerbs.has(key)) {
    problems.push(
      `route-verbs.json entry matches no write route: ${key} — the corpus moved, so the phrase is stale`,
    );
  }
}

// A `{n}` on a non-bulk method would render "delete {n} alerts" for a
// single-record call, so the placeholder is confined to bulk methods.
for (const [tsMethod, verb] of Object.entries(verbs)) {
  if (
    verb.includes(rules.consent.countPlaceholder) &&
    !isBulkMethod(tsMethod)
  ) {
    problems.push(
      `consent-verbs.json uses ${rules.consent.countPlaceholder} for non-bulk method ${tsMethod}`,
    );
  }
}

// Spec §5.5: a workspace-scoped route binds to its project when the route
// carries project evidence, and to the workspace otherwise — but it is never
// pin-less, because then the lease would have nothing to hold it to and a
// page could reach another project's workspace.
for (const row of rows) {
  if (row.template.includes(WORKSPACE_PLACEHOLDER) && row.pin === "none") {
    problems.push(
      `matchable route ${row.method} ${row.family} ${row.template} carries ${WORKSPACE_PLACEHOLDER} but is pin-less — it must pin to its project, or to the workspace when there is no project evidence`,
    );
  }
}

if (problems.length > 0) {
  fail(problems);
}

/** Sorted by (family, template, method) — spec §5.3 step 6. */
const byRoute = (a, b) =>
  compareStrings(a.family, b.family) ||
  compareStrings(a.template, b.template) ||
  compareStrings(a.method, b.method);
rows.sort(byRoute);
deniedRoutes.sort(byRoute);

const headlessCommit =
  args.headlessCommit ??
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();

const output = {
  note:
    "GENERATED FILE — DO NOT EDIT. Regenerate with `npm run generate:bridge-allowlist`. " +
    "`generatedAt` and `headlessCommit` are informational provenance only: they move on every " +
    "run, are excluded from the freshness comparison, and nothing may make a policy decision " +
    "from them. The load-bearing stamps are `corpusCommit`, `rulesSha256`, `verbsSha256` and " +
    "`routeVerbsSha256`. `rows` is the matchable table; `deniedRoutes` are routes the corpus " +
    "records that the rules refuse to admit — they are never matchable, and exist so a refusal " +
    "can be named. A `{n}` in a `consentVerb` is filled by the consent composer from the request " +
    "body's `ids` array length; it only ever appears on bulk routes.",
  schema: 1,
  corpusCommit: corpusConfig.sourceCommit,
  generatedAt: args.generatedAt ?? new Date().toISOString(),
  headlessCommit,
  rulesSha256: rulesInput.sha256,
  verbsSha256: verbsInput.sha256,
  routeVerbsSha256: routeVerbsInput.sha256,
  rows,
  deniedRoutes,
};

const text = `${JSON.stringify(output, null, 2)}\n`;
if (args.stdout) {
  process.stdout.write(text);
} else {
  writeFileSync(OUTPUT_PATH, text);
  const writeRows = rows.filter((row) => row.access === "write").length;
  console.log(
    `generate-bridge-allowlist: wrote ${rows.length} rows (${rows.length - writeRows} read, ${writeRows} write) + ${deniedRoutes.length} denied -> ${OUTPUT_PATH}`,
  );
}
