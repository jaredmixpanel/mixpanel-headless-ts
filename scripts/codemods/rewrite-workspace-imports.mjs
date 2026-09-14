// Codemod: replace cross-workspace RELATIVE imports with the packages' bare
// specifiers (CLEANUP-PLAN §7.3).
//
//   ../../core/src/errors.js            → @mixpanel-headless/core
//   ../../packages/core/src/query/…     → @mixpanel-headless/core/internal
//   ../../packages/node/src/auth/flow.js → @mixpanel-headless/node
//   ../../conformance-runner/src/x.js   → @mixpanel-headless/conformance-runner
//
// Public vs internal is decided per SYMBOL, by identity: each imported
// binding's aliased symbol is looked up in the target barrel's export set
// (`index.ts`, then `internal.ts`). A statement whose bindings split across
// both barrels becomes two statements. Bindings on neither barrel are
// reported as UNRESOLVED and nothing in that file is written — add the name
// to `internal.ts` (or promote it) and rerun. Namespace imports and
// `export *` cannot be rewritten mechanically and are reported as MANUAL.
//
// Usage: node scripts/codemods/rewrite-workspace-imports.mjs [--check]
//   --check  report only (exit 1 if anything would change / is unresolved)
// Run `npx prettier --write` over the touched files afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CHECK = process.argv.includes("--check");

/** Trees whose files are candidates for rewriting. */
const SCAN_DIRS = [
  "packages/core/test-support",
  "packages/node/src",
  "packages/node/test",
  "packages/browser/src",
  "packages/browser/test",
  "conformance-runner/src",
  "conformance-runner/test",
  "differential/src",
  "differential/oracle",
  "differential/referees",
  "differential/test",
  "tests",
];

/**
 * Target workspace roots → barrels. A relative import that lands inside
 * `dir` from a file OUTSIDE that workspace is rewritten to `specifier`
 * (or the internal one when the symbol is only on `internal`).
 */
const TARGETS = [
  {
    workspace: "packages/core",
    dir: "packages/core/src",
    specifier: "@mixpanel-headless/core",
    barrel: "packages/core/src/index.ts",
    internalSpecifier: "@mixpanel-headless/core/internal",
    internalBarrel: "packages/core/src/internal.ts",
  },
  {
    workspace: "packages/node",
    dir: "packages/node/src",
    specifier: "@mixpanel-headless/node",
    barrel: "packages/node/src/index.ts",
  },
  {
    workspace: "conformance-runner",
    dir: "conformance-runner/src",
    specifier: "@mixpanel-headless/conformance-runner",
    barrel: "conformance-runner/src/index.ts",
  },
];

/** Workspace a repo-relative path belongs to (for "is this foreign?"). */
function workspaceOf(relPath) {
  const parts = relPath.split("/");
  if (parts[0] === "packages") return `packages/${parts[1]}`;
  return parts[0];
}

function listTs(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of ts.sys.readDirectory(d, [".ts"], undefined, ["**/*"]))
      out.push(entry);
  };
  walk(dir);
  return out.filter((f) => !f.includes(`${sep}node_modules${sep}`));
}

// ── program ────────────────────────────────────────────────────────────
const base = ts.readConfigFile(
  resolve(REPO_ROOT, "tsconfig.base.json"),
  ts.sys.readFile,
).config;
const parsed = ts.parseJsonConfigFileContent(
  { ...base, include: [] },
  ts.sys,
  REPO_ROOT,
);
const scanFiles = SCAN_DIRS.flatMap((d) => listTs(resolve(REPO_ROOT, d)));
const barrelFiles = TARGETS.flatMap((t) =>
  [t.barrel, t.internalBarrel]
    .filter(Boolean)
    .map((b) => resolve(REPO_ROOT, b)),
);
const program = ts.createProgram({
  rootNames: [...scanFiles, ...barrelFiles],
  options: {
    ...parsed.options,
    noEmit: true,
    lib: [
      "lib.es2023.d.ts",
      "lib.dom.d.ts",
      "lib.dom.iterable.d.ts",
      "lib.dom.asynciterable.d.ts",
      "lib.esnext.disposable.d.ts",
    ],
    types: ["node"],
  },
});
const checker = program.getTypeChecker();

/** @returns {Map<ts.Symbol, string>} aliased symbol → exported name */
function barrelExports(relBarrel) {
  const sf = program.getSourceFile(resolve(REPO_ROOT, relBarrel));
  if (!sf) throw new Error(`barrel not in program: ${relBarrel}`);
  const modSym = checker.getSymbolAtLocation(sf);
  const map = new Map();
  for (const exp of checker.getExportsOfModule(modSym)) {
    const aliased =
      exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
    if (!map.has(aliased)) map.set(aliased, exp.name);
  }
  return map;
}
for (const t of TARGETS) {
  t.publicMap = barrelExports(t.barrel);
  t.internalMap = t.internalBarrel
    ? barrelExports(t.internalBarrel)
    : new Map();
}

// ── per-file rewrite ───────────────────────────────────────────────────
const unresolved = [];
const manual = [];
let changedFiles = 0;
let rewrittenStatements = 0;

for (const file of scanFiles) {
  const sf = program.getSourceFile(file);
  if (!sf) continue;
  const relFile = relative(REPO_ROOT, file).split(sep).join("/");
  const fromWorkspace = workspaceOf(relFile);
  const edits = [];
  let fileBlocked = false;

  for (const stmt of sf.statements) {
    const isImport = ts.isImportDeclaration(stmt);
    const isExport = ts.isExportDeclaration(stmt);
    if (!isImport && !isExport) continue;
    const specNode = stmt.moduleSpecifier;
    if (!specNode || !ts.isStringLiteral(specNode)) continue;
    const spec = specNode.text;
    if (!spec.startsWith(".")) continue;
    const targetAbs = resolve(dirname(file), spec).replace(/\.js$/, ".ts");
    const targetRel = relative(REPO_ROOT, targetAbs).split(sep).join("/");
    const target = TARGETS.find(
      (t) =>
        targetRel.startsWith(`${t.dir}/`) &&
        workspaceOf(targetRel) !== fromWorkspace,
    );
    if (!target) continue;

    // Bindings.
    let elements;
    let statementTypeOnly = false;
    if (isImport) {
      const clause = stmt.importClause;
      if (
        !clause ||
        clause.name ||
        !clause.namedBindings ||
        ts.isNamespaceImport(clause.namedBindings)
      ) {
        manual.push(
          `${relFile}:${sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1} ${stmt.getText().split("\n")[0]}`,
        );
        fileBlocked = true;
        continue;
      }
      statementTypeOnly = clause.isTypeOnly;
      elements = clause.namedBindings.elements;
    } else {
      if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) {
        manual.push(
          `${relFile}:${sf.getLineAndCharacterOfPosition(stmt.getStart()).line + 1} ${stmt.getText().split("\n")[0]}`,
        );
        fileBlocked = true;
        continue;
      }
      statementTypeOnly = stmt.isTypeOnly;
      elements = stmt.exportClause.elements;
    }

    const groups = { public: [], internal: [] };
    for (const el of elements) {
      const nameNode = el.propertyName ?? el.name;
      const sym = checker.getSymbolAtLocation(nameNode);
      const aliased =
        sym && sym.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(sym)
          : sym;
      const originalName = nameNode.text;
      let which = null;
      let barrelName = null;
      if (aliased && target.publicMap.has(aliased)) {
        which = "public";
        barrelName = target.publicMap.get(aliased);
      } else if (aliased && target.internalMap.has(aliased)) {
        which = "internal";
        barrelName = target.internalMap.get(aliased);
      }
      if (!which) {
        unresolved.push(`${targetRel} :: ${originalName}  (from ${relFile})`);
        fileBlocked = true;
        continue;
      }
      const local = el.name.text;
      const piece =
        (el.isTypeOnly ? "type " : "") +
        (barrelName === local ? local : `${barrelName} as ${local}`);
      groups[which].push(piece);
    }
    if (fileBlocked) continue;

    const keyword = isImport ? "import" : "export";
    const typeKw = statementTypeOnly ? " type" : "";
    const lines = [];
    if (groups.public.length)
      lines.push(
        `${keyword}${typeKw} { ${groups.public.join(", ")} } from "${target.specifier}";`,
      );
    if (groups.internal.length)
      lines.push(
        `${keyword}${typeKw} { ${groups.internal.join(", ")} } from "${target.internalSpecifier}";`,
      );
    edits.push({
      start: stmt.getStart(),
      end: stmt.getEnd(),
      text: lines.join("\n"),
    });
    rewrittenStatements += 1;
  }

  if (fileBlocked || edits.length === 0) continue;
  changedFiles += 1;
  if (CHECK) continue;
  let text = readFileSync(file, "utf8");
  for (const e of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, e.start) + e.text + text.slice(e.end);
  writeFileSync(file, mergeDuplicateImports(file, text));
}

/**
 * Second pass: a file that imported one core module per statement now has
 * several `import … from "@mixpanel-headless/core"` lines. Merge imports
 * of the same bare specifier (and the same statement-level `type`-ness)
 * into the first one. Exports are left alone — barrels group their
 * `export … from` lines by section on purpose.
 *
 * @param {string} fileName
 * @param {string} text
 * @returns {string}
 */
function mergeDuplicateImports(fileName, text) {
  const specifiers = new Set(
    TARGETS.flatMap((t) => [t.specifier, t.internalSpecifier]).filter(Boolean),
  );
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  /** @type {Map<string, ts.ImportDeclaration[]>} */
  const groups = new Map();
  for (const stmt of sf.statements) {
    if (
      !ts.isImportDeclaration(stmt) ||
      !ts.isStringLiteral(stmt.moduleSpecifier)
    )
      continue;
    const clause = stmt.importClause;
    if (
      !clause ||
      clause.name ||
      !clause.namedBindings ||
      !ts.isNamedImports(clause.namedBindings)
    )
      continue;
    if (!specifiers.has(stmt.moduleSpecifier.text)) continue;
    const key = `${clause.isTypeOnly ? "type:" : ""}${stmt.moduleSpecifier.text}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(stmt);
  }
  const edits = [];
  for (const [, stmts] of groups) {
    if (stmts.length < 2) continue;
    const pieces = stmts.flatMap((s) =>
      s.importClause.namedBindings.elements.map((el) => el.getText(sf)),
    );
    const first = stmts[0];
    const typeKw = first.importClause.isTypeOnly ? " type" : "";
    edits.push({
      start: first.getStart(sf),
      end: first.getEnd(),
      text: `import${typeKw} { ${[...new Set(pieces)].join(", ")} } from ${first.moduleSpecifier.getText(sf)};`,
    });
    for (const s of stmts.slice(1)) {
      // Remove the statement and the line break that followed it.
      const end = text[s.getEnd()] === "\n" ? s.getEnd() + 1 : s.getEnd();
      edits.push({ start: s.getStart(sf), end, text: "" });
    }
  }
  for (const e of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, e.start) + e.text + text.slice(e.end);
  return text;
}

// ── report ─────────────────────────────────────────────────────────────
const uniq = (xs) => [...new Set(xs)].sort();
if (unresolved.length) {
  console.error(
    `UNRESOLVED (${uniq(unresolved).length}) — not on the public or internal barrel:`,
  );
  for (const u of uniq(unresolved)) console.error(`  ${u}`);
}
if (manual.length) {
  console.error(`MANUAL (${manual.length}) — namespace import / export *:`);
  for (const m of manual) console.error(`  ${m}`);
}
console.log(
  `${CHECK ? "would rewrite" : "rewrote"} ${rewrittenStatements} statement(s) in ${changedFiles} file(s)`,
);
if (unresolved.length || manual.length || (CHECK && rewrittenStatements > 0))
  process.exitCode = 1;
