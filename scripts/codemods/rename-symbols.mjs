#!/usr/bin/env node
// Codemod: rename declared identifiers repo-wide through the TypeScript
// language service, e.g. to apply the repo naming convention (README
// "Naming").
//
// Given a plan of `{ file, name, newName, members? }` rows, every declaration
// named `name` in `file` (variables, parameters, functions, type aliases,
// array-binding elements; class fields/methods only with `members: true`) is
// renamed with `findRenameLocations`, so every usage site across all
// workspaces — imports, tests, the conformance rig, shorthand properties
// (`{ x }` becomes `{ x: y }`) — moves together.
// The language service sees one program over every project referenced from
// the root tsconfig, with the bare workspace specifiers resolved to `src/`
// through scripts/lib/workspace-aliases.mjs (the packages' `exports` point at
// `dist/`, which would otherwise hide cross-package references).
//
// Usage: node scripts/codemods/rename-symbols.mjs <plan.json> [--check]
//   plan.json  [{ "file": "packages/core/src/x.ts", "name": "old", "newName": "new" }, …]
//   --check    report the edits (and possible collisions) without writing
//
// Rows whose `newName` already occurs as an identifier in the same file are
// reported as COLLISION? and still applied — review them by hand. Run
// `npx prettier --write` over the touched files afterwards (done here unless
// --check).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { WORKSPACE_ALIASES } from "../lib/workspace-aliases.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CHECK = process.argv.includes("--check");
const planPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!planPath) {
  console.error("usage: rename-symbols.mjs <plan.json> [--check]");
  process.exit(2);
}

/** @type {Array<{ file: string, name: string, newName: string }>} */
const plan = JSON.parse(readFileSync(resolve(REPO_ROOT, planPath), "utf8"));

// ---------------------------------------------------------------------------
// One program over every referenced project
// ---------------------------------------------------------------------------

/**
 * Collect root file names of every project reachable from a solution file.
 *
 * @param {string} configPath - Absolute path of the tsconfig to start from.
 * @param {Set<string>} [seen] - Config paths already visited (recursion guard).
 * @param {Set<string>} [out] - Accumulator the file names are added to.
 * @returns {Set<string>} `out`, holding every absolute root file name.
 */
function projectFiles(configPath, seen = new Set(), out = new Set()) {
  if (seen.has(configPath)) return out;
  seen.add(configPath);
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
      },
    },
  );
  for (const f of parsed.fileNames) out.add(resolve(f));
  for (const ref of parsed.projectReferences ?? []) {
    projectFiles(ts.resolveProjectReferencePath(ref), seen, out);
  }
  return out;
}

const rootFiles = [...projectFiles(resolve(REPO_ROOT, "tsconfig.json"))];
const baseConfig = ts.parseJsonConfigFileContent(
  ts.readConfigFile(resolve(REPO_ROOT, "tsconfig.base.json"), ts.sys.readFile)
    .config,
  ts.sys,
  REPO_ROOT,
);
/** @type {ts.CompilerOptions} */
const compilerOptions = {
  ...baseConfig.options,
  noEmit: true,
  composite: false,
  declaration: false,
  declarationMap: false,
  isolatedDeclarations: false,
  allowJs: true,
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  types: ["node"],
};

const ALIASES = new Map(WORKSPACE_ALIASES);
const versions = new Map();
const contents = new Map();
/**
 * Read a file once and serve it from the cache afterwards.
 *
 * @param {string} file - Absolute path.
 * @returns {string} The file text; empty when the file cannot be read.
 */
function text(file) {
  if (!contents.has(file)) contents.set(file, ts.sys.readFile(file) ?? "");
  return contents.get(file);
}

/** @type {ts.LanguageServiceHost} */
const host = {
  getScriptFileNames: () => rootFiles,
  getScriptVersion: (f) => String(versions.get(f) ?? 0),
  getScriptSnapshot: (f) =>
    ts.sys.fileExists(f) ? ts.ScriptSnapshot.fromString(text(f)) : undefined,
  getCurrentDirectory: () => REPO_ROOT,
  getCompilationSettings: () => compilerOptions,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
  resolveModuleNameLiterals: (literals, containingFile, _redirected, options) =>
    literals.map((lit) => {
      const aliased = ALIASES.get(lit.text);
      if (aliased) {
        return {
          resolvedModule: {
            resolvedFileName: aliased,
            extension: ts.Extension.Ts,
            isExternalLibraryImport: false,
          },
        };
      }
      return ts.resolveModuleName(lit.text, containingFile, options, ts.sys);
    }),
};
const service = ts.createLanguageService(host, ts.createDocumentRegistry());
const program = service.getProgram();
if (!program) throw new Error("language service produced no program");

// ---------------------------------------------------------------------------
// Locate declarations and collect rename edits
// ---------------------------------------------------------------------------

/**
 * Identifier nodes that are the *name* of a declaration. Class members are
 * matched only when the row opts in (`members: true`): a local variable and a
 * contract field often share a snake_case name (`target_node_id`), and the
 * field must never move with the local.
 *
 * @param {ts.SourceFile} sourceFile - File to search.
 * @param {string} name - Identifier text to match.
 * @param {boolean} members - Whether class fields and methods count.
 * @returns {ts.Identifier[]} The matching declaration-name nodes.
 */
function declarationNames(sourceFile, name, members) {
  const hits = [];
  (function walk(node) {
    if (ts.isIdentifier(node) && node.text === name) {
      const p = node.parent;
      const isLocal =
        ts.isVariableDeclaration(p) ||
        ts.isParameter(p) ||
        ts.isFunctionDeclaration(p) ||
        ts.isTypeAliasDeclaration(p) ||
        ts.isInterfaceDeclaration(p) ||
        ts.isClassDeclaration(p) ||
        ts.isBindingElement(p);
      const isMember =
        members && (ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p));
      if ((isLocal || isMember) && p.name === node) hits.push(node);
    }
    ts.forEachChild(node, walk);
  })(sourceFile);
  return hits;
}

/** file → Map<start, { end, text }> (deduped across overlapping plans). */
const editsByFile = new Map();
const summary = [];
let missing = 0;

for (const row of plan) {
  const file = resolve(REPO_ROOT, row.file);
  const sourceFile = program.getSourceFile(file);
  if (!sourceFile) {
    console.error(`NOT IN PROGRAM ${row.file}`);
    missing += 1;
    continue;
  }
  const names = declarationNames(sourceFile, row.name, row.members === true);
  if (names.length === 0) {
    console.error(`NOT FOUND ${row.file} :: ${row.name}`);
    missing += 1;
    continue;
  }
  const collision = new RegExp(String.raw`\b${row.newName}\b`).test(
    sourceFile.text,
  );
  let count = 0;
  for (const id of names) {
    const locations = service.findRenameLocations(
      file,
      id.getStart(sourceFile),
      false,
      false,
      { providePrefixAndSuffixTextForRename: true },
    );
    for (const loc of locations ?? []) {
      const bucket =
        editsByFile.get(loc.fileName) ??
        editsByFile.set(loc.fileName, new Map()).get(loc.fileName);
      bucket.set(loc.textSpan.start, {
        end: loc.textSpan.start + loc.textSpan.length,
        text: `${loc.prefixText ?? ""}${row.newName}${loc.suffixText ?? ""}`,
      });
      count += 1;
    }
  }
  summary.push(
    `${collision ? "COLLISION? " : ""}${row.file} :: ${row.name} → ${row.newName} (${names.length} decl, ${count} sites)`,
  );
}

for (const line of summary) console.log(line);

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

const touched = [];
for (const [file, edits] of editsByFile) {
  let source = text(file);
  for (const [start, { end, text: replacement }] of [...edits].sort(
    (a, b) => b[0] - a[0],
  )) {
    source = source.slice(0, start) + replacement + source.slice(end);
  }
  touched.push(relative(REPO_ROOT, file));
  if (!CHECK) writeFileSync(file, source);
}

console.log(
  `${CHECK ? "would touch" : "touched"} ${touched.length} files, ${plan.length - missing}/${plan.length} plan rows resolved`,
);
if (!CHECK && touched.length > 0) {
  execFileSync("npx", ["prettier", "--write", ...touched], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}
if (missing > 0) process.exit(1);
