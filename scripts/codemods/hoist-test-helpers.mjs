#!/usr/bin/env node
// Codemod: replace per-file copies of the core test helpers with imports
// from `packages/core/test-support/` (docs/history/cleanup-plan-2026-09.md §11, 7.3).
//
// Table-driven (`HOISTS` below): each entry names a local top-level
// definition, the test-support module and export that replaces it, and the
// canonical body (whitespace-normalized) the local copy must match — a copy
// whose body differs is left alone and reported as KEPT, so a file that
// genuinely needs its own variant is never rewritten. Removal takes the
// definition plus its attached doc comment (the comment run directly above
// it, up to the previous blank line or section divider); call sites are
// renamed where the shared helper carries a different name; imports that
// the removal orphaned are pruned; the shared name is added to an existing
// import from that module or a new import is inserted after the last one.
//
// Usage: node scripts/codemods/hoist-test-helpers.mjs [--check] [file ...]
//   --check  report only (exit 1 if anything would change)
//   file     restrict to the given files (default: packages/core/test/**)
// Run `eslint --fix` (import sort) and Prettier over the touched files.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { pruneImports } from "./lib/imports.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SUPPORT_DIR = join(REPO_ROOT, "packages/core/test-support");
const TEST_DIR = join(REPO_ROOT, "packages/core/test");
const CHECK = process.argv.includes("--check");

/**
 * @typedef {object} Hoist
 * @property {string} local - The top-level name defined in the test file.
 * @property {string} module - Test-support module basename (no extension).
 * @property {string} shared - The exported name that replaces it.
 * @property {boolean} [type] - Whether the export is a type (`import type`).
 * @property {string[]} bodies - Accepted canonical bodies (normalized).
 */

/**
 * Collapse whitespace so two formattings of one body compare equal.
 *
 * @param {string} text - Source text.
 * @returns {string} The normalized text.
 */
function norm(text) {
  return text
    .replaceAll(/\s+/g, " ")
    .replaceAll(/\s*([{}(),;:=])\s*/g, "$1")
    .trim();
}

/** @type {Hoist[]} */
const HOISTS = [
  {
    local: "CLIENT_SESSION",
    module: "client-test-helpers",
    shared: "CLIENT_SESSION",
    bodies: [
      `const CLIENT_SESSION = makeSession({ projectId: "12345", region: "us", oauthToken: "test-token", });`,
    ],
  },
  {
    local: "FACADE_SESSION",
    module: "client-test-helpers",
    shared: "FACADE_SESSION",
    bodies: [
      `const FACADE_SESSION = makeSession({ projectId: "12345", region: "us", username: "test_user", secret: "test_secret", });`,
    ],
  },
  {
    local: "ok",
    module: "client-test-helpers",
    shared: "ok",
    bodies: [
      `function ok(results: unknown): CannedResponse { return { status: 200, json: { status: "ok", results } }; }`,
    ],
  },
  {
    local: "parseBody",
    module: "client-test-helpers",
    shared: "parseBody",
    bodies: [
      `function parseBody(bodyText: string): unknown { return JSON.parse(bodyText) as unknown; }`,
    ],
  },
  {
    local: "drain",
    module: "client-test-helpers",
    shared: "drain",
    bodies: [
      `async function drain<T>(source: AsyncIterable<T>): Promise<T[]> { const out: T[] = []; for await (const item of source) { out.push(item); } return out; }`,
    ],
  },
  {
    local: "makeWorkspace",
    module: "workspace-test-helpers",
    shared: "makeFacadeWorkspace",
    bodies: [
      `function makeWorkspace(handler: Handler): { ws: Workspace; transport: FakeTransport; } { const { client, transport } = createMockClient(CLIENT_SESSION, handler); return { ws: new Workspace({ session: FACADE_SESSION, client }), transport }; }`,
      `function makeWorkspace(handler: (request: CapturedFetchRequest) => CannedResponse,): { ws: Workspace; transport: FakeTransport } { const { client, transport } = createMockClient(CLIENT_SESSION, handler); return { ws: new Workspace({ session: FACADE_SESSION, client }), transport }; }`,
      `function makeWorkspace(handler: Handler, logger?: LogCollector,): { ws: Workspace; transport: FakeTransport } { const { client, transport } = createMockClient(CLIENT_SESSION, handler); return { ws: new Workspace({ session: FACADE_SESSION, client, ...(logger === undefined ? {} : { logger }), }), transport, }; }`,
    ],
  },
  {
    local: "workspaceFactory",
    module: "workspace-test-helpers",
    shared: "makeStubWorkspace",
    bodies: [
      `function workspaceFactory(mock: MockWorkspaceClient): Workspace { return new Workspace({ session: TEST_SESSION, client: mock.client }); }`,
      `function workspaceFactory(mock: MockWorkspaceClient, logger?: LogCollector,): Workspace { return new Workspace({ session: TEST_SESSION, client: mock.client, ...(logger === undefined ? {} : { logger }), }); }`,
    ],
  },
  {
    local: "makeWs",
    module: "workspace-test-helpers",
    shared: "makeStubWorkspace",
    bodies: [
      `function makeWs(): Workspace { return new Workspace({ session: TEST_SESSION, client: mockWorkspaceClient().client, }); }`,
      `function makeWs(mock: MockWorkspaceClient = mockWorkspaceClient()): Workspace { return new Workspace({ session: TEST_SESSION, client: mock.client }); }`,
    ],
  },
  {
    local: "stubClient",
    module: "workspace-test-helpers",
    shared: "stubClient",
    bodies: [
      `function stubClient(method: string, value: unknown, calls: unknown[][] = [],): MixpanelClient { return { [method]: (...args: unknown[]): Promise<unknown> => { calls.push(args); return Promise.resolve(value); }, } as unknown as MixpanelClient; }`,
    ],
  },
  {
    local: "expectGuard",
    module: "raises",
    shared: "expectGuard",
    bodies: [
      `function expectGuard(thunk: () => unknown, code: string): void { let thrown: unknown; try { thunk(); } catch (error) { thrown = error; } expect(thrown, \`expected \${code}\`).toBeInstanceOf(ParamValidationError); expect((thrown as MixpanelHeadlessError).code).toBe(code); }`,
    ],
  },
  {
    local: "codes",
    module: "error-codes",
    shared: "codes",
    bodies: [
      `function codes(errors: readonly ValidationError[]): string[] { return errors.map((e) => e.code); }`,
    ],
  },
  {
    local: "codesOf",
    module: "error-codes",
    shared: "codesOf",
    bodies: [
      `function codesOf(exc: unknown): string[] { return (exc as BookmarkValidationError).errors.map((e) => e.code); }`,
    ],
  },
  {
    local: "Handler",
    module: "client-test-helpers",
    shared: "CannedHandler",
    type: true,
    bodies: [
      `type Handler = (request: CapturedFetchRequest) => CannedResponse;`,
    ],
  },
];

/**
 * Walk a directory for `.ts` files.
 *
 * @param {string} dir - Directory to walk.
 * @returns {string[]} Absolute file paths.
 */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The declared name of a top-level statement, when it declares exactly one.
 *
 * @param {ts.Statement} statement - A source-file statement.
 * @returns {string | null} The name, or null.
 */
function declaredName(statement) {
  if (ts.isFunctionDeclaration(statement) && statement.name) {
    return statement.name.text;
  }
  if (ts.isTypeAliasDeclaration(statement)) {
    return statement.name.text;
  }
  if (
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.length === 1
  ) {
    const [decl] = statement.declarationList.declarations;
    if (ts.isIdentifier(decl.name)) {
      return decl.name.text;
    }
  }
  return null;
}

/**
 * Start offset of the removal range for `statement`: the beginning of the
 * comment run attached directly above it. Blank lines and section dividers
 * (`// ---`, `// ===`) end the run, so a divider stays with what follows.
 *
 * @param {string} text - Full source text.
 * @param {ts.Statement} statement - The statement to remove.
 * @returns {number} Offset of the first character to remove.
 */
function attachedStart(text, statement) {
  const trivia = text.slice(statement.getFullStart(), statement.getStart());
  const lines = trivia.split("\n");
  let cut = lines.length - 1; // index of the first line to remove
  for (let i = lines.length - 2; i >= 0; i--) {
    const line = lines[i];
    if (line.trim() === "" || /^\s*\/\/\s*[-=]{3,}/.test(line)) {
      break;
    }
    cut = i;
  }
  const kept = lines.slice(0, cut).join("\n");
  return statement.getFullStart() + kept.length + (cut > 0 ? 1 : 0);
}

/**
 * Add `names` to the import from `module` (creating the statement when the
 * file has none). Type exports go in as inline `type` specifiers.
 *
 * @param {string} text - Source text.
 * @param {string} fileName - Absolute path (for the relative specifier).
 * @param {string} module - Test-support module basename.
 * @param {Array<{ name: string; type: boolean }>} names - Names to add.
 * @returns {string} The updated text.
 */
function addImports(text, fileName, module, names) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const suffix = `test-support/${module}.js`;
  const existing = source.statements.find(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.endsWith(suffix) &&
      !statement.importClause?.isTypeOnly,
  );
  const specifiers = names.map(({ name, type }) =>
    type ? `type ${name}` : name,
  );
  if (
    existing &&
    ts.isImportDeclaration(existing) &&
    existing.importClause?.namedBindings &&
    ts.isNamedImports(existing.importClause.namedBindings)
  ) {
    const bindings = existing.importClause.namedBindings;
    const present = new Set(bindings.elements.map((e) => e.name.text));
    const additions = specifiers.filter(
      (spec) => !present.has(spec.replace(/^type /, "")),
    );
    if (additions.length === 0) return text;
    const all = [...bindings.elements.map((e) => e.getText()), ...additions];
    return `${text.slice(
      0,
      bindings.getStart(),
    )}{ ${all.join(", ")} }${text.slice(bindings.getEnd())}`;
  }
  let rel = relative(dirname(fileName), join(SUPPORT_DIR, `${module}.js`));
  if (!rel.startsWith(".")) rel = `./${rel}`;
  const statement = `import { ${specifiers.join(", ")} } from "${rel}";\n`;
  const imports = source.statements.filter((s) => ts.isImportDeclaration(s));
  const last = imports.at(-1);
  if (last) {
    return `${text.slice(0, last.getEnd())}\n${statement}${text.slice(last.getEnd())}`;
  }
  return statement + text;
}

/**
 * Apply every matching hoist to one file.
 *
 * @param {string} fileName - Absolute path.
 * @returns {{ hoisted: string[]; kept: string[]; changed: boolean }} Report.
 */
function processFile(fileName) {
  const original = readFileSync(fileName, "utf8");
  const source = ts.createSourceFile(
    fileName,
    original,
    ts.ScriptTarget.Latest,
    true,
  );
  /** @type {string[]} */
  const hoisted = [];
  /** @type {string[]} */
  const kept = [];
  /** @type {Array<{ start: number; end: number }>} */
  const removals = [];
  /** @type {Map<string, Array<{ name: string; type: boolean }>>} */
  const wanted = new Map();
  /** @type {Array<[string, string]>} */
  const renames = [];
  for (const statement of source.statements) {
    const name = declaredName(statement);
    if (name === null) continue;
    const hoist = HOISTS.find((h) => h.local === name);
    if (!hoist) continue;
    const body = norm(statement.getText());
    if (hoist.bodies.every((accepted) => norm(accepted) !== body)) {
      kept.push(name);
      continue;
    }
    hoisted.push(name);
    removals.push({
      start: attachedStart(original, statement),
      end: statement.getEnd(),
    });
    const list = wanted.get(hoist.module) ?? [];
    list.push({ name: hoist.shared, type: hoist.type === true });
    wanted.set(hoist.module, list);
    if (hoist.shared !== hoist.local) renames.push([hoist.local, hoist.shared]);
  }
  if (removals.length === 0) return { hoisted, kept, changed: false };

  let text = original;
  for (const { start, end } of removals.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, start) + text.slice(end);
  }
  for (const [from, to] of renames) {
    text = text.replaceAll(new RegExp(String.raw`\b${from}\b`, "g"), () => to);
  }
  for (const [module, names] of wanted) {
    text = addImports(text, fileName, module, names);
  }
  text = pruneImports(text, fileName);
  // A shared name that the file ends up not using (e.g. `CannedHandler`
  // when the only `Handler` use was the removed definition) is pruned too.
  text = pruneImports(text, fileName);
  text = text.replaceAll(/\n{3,}/g, "\n\n");
  if (text !== original && !CHECK) writeFileSync(fileName, text);
  return { hoisted, kept, changed: text !== original };
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const files = args.length > 0 ? args.map((a) => resolve(a)) : walk(TEST_DIR);
let changed = 0;
for (const file of files) {
  const report = processFile(file);
  const label = relative(REPO_ROOT, file);
  if (report.hoisted.length > 0) {
    console.log(
      `${CHECK ? "WOULD HOIST" : "HOISTED"} ${label}: ${report.hoisted.join(", ")}`,
    );
  }
  if (report.kept.length > 0) {
    console.log(`KEPT ${label}: ${report.kept.join(", ")}`);
  }
  if (report.changed) changed += 1;
}
console.log(`${changed} file(s) ${CHECK ? "would change" : "changed"}`);
if (CHECK && changed > 0) process.exit(1);
