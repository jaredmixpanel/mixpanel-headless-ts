#!/usr/bin/env node
// Codemod: split a test file along its top-level `describe` blocks
// (docs/history/cleanup-plan-2026-09.md §11, 7.6).
//
// Driven by a JSON plan (see split-plan-core-tests.json):
//
//   [{ "source": "packages/core/test/x.test.ts",
//      "fixtures": "packages/core/test/x-fixtures.ts",   // optional
//      "inlineThreshold": 12,                              // optional, lines
//      "targets": { "packages/core/test/x-a.test.ts": ["describe title", …],
//                   "packages/core/test/x-b.test.ts": ["…"] } }]
//
// Every top-level `describe(...)` must be claimed by exactly one target
// (titles are matched on the first argument's text). Each target receives
// the source's header comment, its imports (relative specifiers re-pointed
// when the target lives in another directory, then pruned to what the file
// uses), and its describes with their attached comments. The remaining
// top-level statements — the fixture preamble — are placed by use: an item
// referenced (directly or through other preamble items) by one target is
// inlined there; an item shared by several targets moves to `fixtures`
// (exported when a target references it) unless it is at most
// `inlineThreshold` lines long and nothing in the fixtures module depends
// on it, in which case it is duplicated. A source that is also a target is
// rewritten in place; otherwise it is deleted.
//
// Usage: node scripts/codemods/split-test-file.mjs <plan.json> [--check]
// Run `eslint --fix` (import sort) and Prettier over the written files.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { pruneImports } from "./lib/imports.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CHECK = process.argv.includes("--check");
const planPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!planPath) {
  console.error("usage: split-test-file.mjs <plan.json> [--check]");
  process.exit(2);
}

/**
 * @typedef {object} Plan
 * @property {string} source - Repo-relative path of the file to split.
 * @property {string} [fixtures] - Repo-relative path of the shared-fixture module.
 * @property {number} [inlineThreshold] - Max lines for a duplicated shared item.
 * @property {Record<string, string[]>} targets - Target path → describe titles.
 */

/**
 * Names a top-level statement declares.
 *
 * @param {ts.Statement} statement - The statement.
 * @returns {string[]} Declared names (empty for non-declarations).
 */
function declaredNames(statement) {
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isClassDeclaration(statement)) &&
    statement.name
  ) {
    return [statement.name.text];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations
      .map((d) => (ts.isIdentifier(d.name) ? d.name.text : null))
      .filter((n) => n !== null);
  }
  return [];
}

/**
 * Whether `text` mentions `name` as a whole word.
 *
 * @param {string} text - Haystack.
 * @param {string} name - Identifier.
 * @returns {boolean} True when referenced.
 */
function mentions(text, name) {
  return new RegExp(String.raw`\b${name}\b`).test(text);
}

/**
 * The title a top-level `describe(...)` statement carries, or null.
 *
 * @param {ts.Statement} statement - The statement.
 * @returns {string | null} The first argument's text, quotes stripped.
 */
function describeTitle(statement) {
  if (!ts.isExpressionStatement(statement)) return null;
  const call = statement.expression;
  if (!ts.isCallExpression(call)) return null;
  const callee = call.expression.getText();
  if (!/^describe(?:\.|$)/.test(callee)) return null;
  const [arg] = call.arguments;
  if (!arg) return null;
  return ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)
    ? arg.text
    : arg.getText();
}

/**
 * Re-point relative import specifiers from one directory to another.
 *
 * @param {string} importText - The import statements' text.
 * @param {string} fromDir - Directory the specifiers are relative to.
 * @param {string} toDir - Directory the rewritten file will live in.
 * @returns {string} The rewritten import text.
 */
function repointImports(importText, fromDir, toDir) {
  if (fromDir === toDir) return importText;
  return importText.replaceAll(
    /from "(?<spec>\.{1,2}\/[^"]+)"/g,
    (_match, spec) => {
      let rel = relative(toDir, resolve(fromDir, spec)).replaceAll("\\", "/");
      if (!rel.startsWith(".")) rel = `./${rel}`;
      return `from "${rel}"`;
    },
  );
}

/**
 * Prefix a declaration statement's text with `export `.
 *
 * @param {string} text - The statement text (with leading comments).
 * @param {ts.Statement} statement - The statement.
 * @param {number} fullStart - Offset `text` begins at in the source.
 * @returns {string} The exported form.
 */
function exportify(text, statement, fullStart) {
  const at = statement.getStart() - fullStart;
  return `${text.slice(0, at)}export ${text.slice(at)}`;
}

/**
 * Execute one plan entry.
 *
 * @param {Plan} plan - The entry.
 * @returns {string[]} Files written (or that would be written).
 */
function split(plan) {
  const sourcePath = join(REPO_ROOT, plan.source);
  const sourceText = readFileSync(sourcePath, "utf8");
  const source = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const sourceDir = dirname(sourcePath);
  const threshold = plan.inlineThreshold ?? 12;

  /** @type {ts.ImportDeclaration[]} */
  const imports = [];
  /** @type {Array<{ statement: ts.Statement; text: string; names: string[]; lines: number }>} */
  const preamble = [];
  /** @type {Array<{ title: string; text: string }>} */
  const describes = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      imports.push(statement);
      continue;
    }
    const text = sourceText.slice(statement.getFullStart(), statement.getEnd());
    const title = describeTitle(statement);
    if (title !== null) {
      describes.push({ title, text });
      continue;
    }
    const names = declaredNames(statement);
    if (names.length === 0) {
      throw new Error(
        `${plan.source}: top-level statement is neither import, declaration nor describe: ${statement.getText().slice(0, 60)}`,
      );
    }
    preamble.push({
      statement,
      text,
      names,
      lines: statement.getText().split("\n").length,
    });
  }
  const firstImport = imports[0];
  const header = firstImport ? sourceText.slice(0, firstImport.getStart()) : "";
  // The first import's leading trivia is the file header, emitted separately.
  const importText = imports
    .map((i, index) =>
      sourceText.slice(
        index === 0 ? i.getStart() : i.getFullStart(),
        i.getEnd(),
      ),
    )
    .join("")
    .trimStart();

  // Claim every describe exactly once.
  /** @type {Map<string, string[]>} target → describe texts */
  const claimed = new Map();
  const seen = new Set();
  for (const [target, titles] of Object.entries(plan.targets)) {
    const texts = [];
    for (const title of titles) {
      const matches = describes.filter((d) => d.title === title);
      if (matches.length !== 1) {
        throw new Error(
          `${plan.source}: describe "${title}" matched ${matches.length} blocks`,
        );
      }
      if (seen.has(title)) {
        throw new Error(`${plan.source}: describe "${title}" claimed twice`);
      }
      seen.add(title);
      texts.push(matches[0].text);
    }
    claimed.set(target, texts);
  }
  const unclaimed = describes.filter((d) => !seen.has(d.title));
  if (unclaimed.length > 0) {
    throw new Error(
      `${plan.source}: unclaimed describes: ${unclaimed.map((d) => JSON.stringify(d.title)).join(", ")}`,
    );
  }

  // Place the preamble: direct users, then closure over preamble references.
  /** @type {Map<number, Set<string>>} preamble index → target paths */
  const users = new Map();
  for (const [index, item] of preamble.entries()) {
    const set = new Set();
    for (const [target, texts] of claimed) {
      if (item.names.some((n) => texts.some((t) => mentions(t, n)))) {
        set.add(target);
      }
    }
    users.set(index, set);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [index, item] of preamble.entries()) {
      for (const [otherIndex, other] of preamble.entries()) {
        if (otherIndex === index) continue;
        if (other.names.every((n) => !mentions(item.text, n))) continue;
        // `item` references `other`: wherever `item` goes, `other` must be
        // reachable, so `other` inherits `item`'s users.
        const from = users.get(index);
        const into = users.get(otherIndex);
        for (const target of from) {
          if (into.has(target)) {
            continue;
          }

          into.add(target);
          changed = true;
        }
      }
    }
  }
  /** @type {Set<number>} */
  const toFixtures = new Set();
  /** @type {Set<number>} */
  const duplicated = new Set();
  /** @type {string[]} */
  const dropped = [];
  for (const [index, item] of preamble.entries()) {
    const set = users.get(index);
    if (set.size === 0) dropped.push(item.names.join(","));
    else if (set.size >= 2) {
      if (item.lines <= threshold) duplicated.add(index);
      else toFixtures.add(index);
    }
  }
  // A duplicated item that a fixtures item depends on must itself be in
  // fixtures (fixtures cannot import from a target).
  changed = true;
  while (changed) {
    changed = false;
    const snapshot = [...toFixtures];
    for (const index of snapshot) {
      for (const [otherIndex, other] of preamble.entries()) {
        if (!(
          duplicated.has(otherIndex) &&
          other.names.some((n) => mentions(preamble[index].text, n))
        )) {
          continue;
        }

        duplicated.delete(otherIndex);
        toFixtures.add(otherIndex);
        changed = true;
      }
    }
  }
  if (toFixtures.size > 0 && !plan.fixtures) {
    throw new Error(
      `${plan.source}: shared preamble items need a "fixtures" path: ${[...toFixtures].map((i) => preamble[i].names.join(",")).join(", ")}`,
    );
  }

  /** @type {Array<{ path: string; text: string }>} */
  const outputs = [];
  const fixturesPath = plan.fixtures ? join(REPO_ROOT, plan.fixtures) : null;
  const fixturesNames = new Set(
    [...toFixtures].flatMap((i) => preamble[i].names),
  );
  // `verbatimModuleSyntax`: types must be imported as types.
  const fixturesTypeNames = new Set(
    [...toFixtures]
      .filter(
        (i) =>
          ts.isInterfaceDeclaration(preamble[i].statement) ||
          ts.isTypeAliasDeclaration(preamble[i].statement),
      )
      .flatMap((i) => preamble[i].names),
  );

  for (const [target, texts] of claimed) {
    const targetPath = join(REPO_ROOT, target);
    const targetDir = dirname(targetPath);
    const inlined = preamble
      .map((item, index) => ({ item, index }))
      .filter(({ index }) => {
        const set = users.get(index);
        if (!set.has(target)) return false;
        if (toFixtures.has(index)) return false;
        return set.size === 1 || duplicated.has(index);
      })
      .map(({ item }) => item.text);
    const body = [...inlined, ...texts].join("");
    let importsOut = repointImports(importText, sourceDir, targetDir);
    if (fixturesPath) {
      const wanted = [...fixturesNames]
        .filter((n) => mentions(body, n))
        .map((n) => (fixturesTypeNames.has(n) ? `type ${n}` : n));
      if (wanted.length > 0) {
        let rel = relative(targetDir, fixturesPath)
          .replace(/\.ts$/, ".js")
          .replaceAll("\\", "/");
        if (!rel.startsWith(".")) rel = `./${rel}`;
        importsOut += `import { ${wanted.join(", ")} } from "${rel}";\n`;
      }
    }
    const text = pruneImports(
      `${header}${importsOut}${body}\n`.replaceAll(/\n{3,}/g, "\n\n"),
      targetPath,
    );
    outputs.push({ path: targetPath, text });
  }

  if (fixturesPath && toFixtures.size > 0) {
    const fixturesDir = dirname(fixturesPath);
    const targetsText = outputs.map((o) => o.text).join("\n");
    const body = [...toFixtures]
      .sort((a, b) => a - b)
      .map((index) => {
        const { statement, text, names } = preamble[index];
        const exported = names.some((n) => mentions(targetsText, n));
        return exported
          ? exportify(text, statement, statement.getFullStart())
          : text;
      })
      .join("");
    const text = pruneImports(
      `${header}${repointImports(importText, sourceDir, fixturesDir)}${body}\n`.replaceAll(
        /\n{3,}/g,
        "\n\n",
      ),
      fixturesPath,
    );
    outputs.push({ path: fixturesPath, text });
  }

  const written = [];
  for (const { path } of outputs) {
    if (existsSync(path) && path !== sourcePath) {
      throw new Error(`${relative(REPO_ROOT, path)} already exists`);
    }
  }
  for (const { path, text } of outputs) {
    if (!CHECK) writeFileSync(path, text);
    written.push(relative(REPO_ROOT, path));
  }
  if (outputs.every((o) => o.path !== sourcePath) && !CHECK) {
    unlinkSync(sourcePath);
  }
  const summary = [
    `${plan.source} → ${outputs.length} file(s)`,
    `  fixtures: ${[...toFixtures].map((i) => preamble[i].names.join(",")).join(", ") || "—"}`,
    `  duplicated: ${[...duplicated].map((i) => preamble[i].names.join(",")).join(", ") || "—"}`,
    `  dropped (unused): ${dropped.join(", ") || "—"}`,
  ];
  console.log(summary.join("\n"));
  return written;
}

/** @type {Plan[]} */
const plans = JSON.parse(readFileSync(resolve(planPath), "utf8"));
const all = plans.flatMap((plan) => split(plan));
console.log(`${CHECK ? "would write" : "wrote"} ${all.length} file(s)`);
if (!CHECK) console.log(all.join("\n"));
