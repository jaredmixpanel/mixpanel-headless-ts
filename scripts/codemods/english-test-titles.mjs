#!/usr/bin/env node
// Codemod: turn Python-identifier test titles into English behaviour
// statements, keeping the Python name as a trailing `// python:` comment
// (docs/history/cleanup-plan-2026-09.md §9.4, decision D7).
//
//   it("test_rejects_empty_name", () => {        →  it("rejects empty name", () => { // python: test_rejects_empty_name
//   describe("TestPkceChallenge (test_auth_pkce.py:25)", …)
//                                                →  describe("Pkce challenge", …) // python: TestPkceChallenge
//   describe("UserEvent (TestUserEvent)", …)     →  describe("UserEvent", …) // python: TestUserEvent
//   it("slugify is idempotent (:45)", …)         →  it("slugify is idempotent", …)
//
// The rename is deterministic and purely lexical: snake_case words become
// space-separated words, CamelCase class names are split into words with the
// first capitalised, a short acronym table restores URL/ID/JSON/…, and rule
// codes such as `f1` / `up4` / `r5c` keep their upper-case letters. Where the
// mechanical text misleads, the reviewer edits the title afterwards — the
// `// python:` comment is the stable link back to the Python suite either
// way. Titles that merely cite a Python line (`(file.py:NN)`, `(:NN)`) lose
// the citation. Template-literal titles and titles that already read as
// English are left alone; a `test_x()` mention of a method named `test_x`
// (a leading identifier followed by `(`) is not a Python test name and is
// left alone too.
//
// Usage: node scripts/codemods/english-test-titles.mjs [--check] [file|dir ...]
//   --check  report only (exit 1 if anything would change)
//   default scope: packages/core/test
// Run Prettier over the touched files afterwards.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CHECK = process.argv.includes("--check");

/** Lower-case words whose conventional spelling is upper-case. */
const ACRONYMS = new Map(
  Object.entries({
    url: "URL",
    urls: "URLs",
    id: "ID",
    ids: "IDs",
    json: "JSON",
    jsonl: "JSONL",
    api: "API",
    http: "HTTP",
    https: "HTTPS",
    csv: "CSV",
    uuid: "UUID",
    crud: "CRUD",
    pkce: "PKCE",
    sql: "SQL",
    jwt: "JWT",
    utc: "UTC",
    iso: "ISO",
    cli: "CLI",
    ui: "UI",
    eu: "EU",
    oauth: "OAuth",
    e2e: "E2E",
    tz: "TZ",
    html: "HTML",
    uri: "URI",
    tls: "TLS",
    jql: "JQL",
    sdk: "SDK",
    cdn: "CDN",
    pbt: "PBT",
    posix: "POSIX",
    nan: "NaN",
    cpython: "CPython",
  }),
);

/** Python spellings whose TS twin reads differently. */
const WORDS = new Map([["none", "null"]]);

/** `f1`, `up4`, `r5c`, `v7`: rule codes keep their letters upper-case. */
const RULE_CODE = /^[a-z]{1,3}\d+[a-z]?$/;

/**
 * Case one snake_case word for an English title.
 *
 * @param {string} word - Lower-case word.
 * @returns {string} The cased word.
 */
function caseWord(word) {
  const mapped = WORDS.get(word);
  if (mapped !== undefined) return mapped;
  const acronym = ACRONYMS.get(word);
  if (acronym !== undefined) return acronym;
  if (RULE_CODE.test(word)) {
    return word.replace(/^[a-z]+/, (letters) => letters.toUpperCase());
  }
  return word;
}

/**
 * `test_rejects_empty_name` → `rejects empty name`.
 *
 * @param {string} id - The Python test function name.
 * @returns {string} The English title.
 */
function humanizeTestId(id) {
  return id
    .replace(/^test_/, "")
    .split("_")
    .filter((w) => w.length > 0)
    .map((w) => caseWord(w.toLowerCase()))
    .join(" ");
}

/** CamelCase tokenizer: acronym runs, capitalised words, rule codes, digits. */
const CAMEL_TOKEN =
  /[A-Z]+\d+[a-z]?|[A-Z]{2,}(?=[A-Z][a-z]|$)|[A-Z]?[a-z]+|[A-Z]|\d+/g;

/**
 * `TestValidateFunnelArgsF1Max` → `Validate funnel args F1 max`.
 *
 * @param {string} cls - The Python test class name.
 * @returns {string} The English describe title.
 */
function humanizeClassName(cls) {
  const body = cls
    .replace(/^Test/, "")
    .replaceAll("OAuth", "Oauth")
    .replaceAll("E2E", "E2e");
  const tokens = body.match(CAMEL_TOKEN) ?? [body];
  const words = tokens.map((token, index) => {
    const lower = token.toLowerCase();
    const acronym = ACRONYMS.get(lower);
    if (acronym !== undefined) return acronym;
    if (/^[A-Z]{2,}$/.test(token) || /\d/.test(token)) return token;
    if (index === 0) return token.charAt(0).toUpperCase() + token.slice(1);
    return lower;
  });
  return words.join(" ");
}

/** A `(file.py:NN)` / `(:NN)` citation, optionally with more text after it. */
const LINE_CITATION =
  /\s*\((?:(?:[\w./-]+\.py)?:\d+(?:-\d+)?|[\w./-]+\.py(?:::\w+)?)\)/g;

/**
 * Strip Python line citations from a title.
 *
 * @param {string} title - The title.
 * @returns {string} Title without `(file.py:NN)` / `(:NN)` parentheticals.
 */
function stripCitations(title) {
  return title
    .replaceAll(LINE_CITATION, "")
    .replaceAll(/\s{2,}/g, " ")
    .trim();
}

/**
 * Rename an `it` title.
 *
 * @param {string} title - Current title.
 * @returns {{ title: string; python: string | null } | null} The new title
 *   and Python name, or null when nothing changes.
 */
function renameIt(title) {
  const match = /^test_\w+/.exec(title);
  if (match && !title.slice(match[0].length).startsWith("(")) {
    const id = match[0];
    let suffix = stripCitations(title.slice(id.length));
    if (suffix.length > 0 && !suffix.startsWith("[")) suffix = ` ${suffix}`;
    return { title: `${humanizeTestId(id)}${suffix}`.trim(), python: id };
  }
  const stripped = stripCitations(title);
  return stripped === title ? null : { title: stripped, python: null };
}

/** `TestFoo` at the start of a title (optionally `TestFoo::test_bar`). */
const LEADING_CLASS = /^Test[A-Z][\dA-Za-z]*/;
const LEADING_METHOD = /^::test_\w+/;
/** A parenthetical, whose inside is searched for `TestFoo` separately. */
const PARENTHETICAL = /\s*\(([^()]*)\)/g;
const INNER_CLASS = /(?:[\w./-]+\.py::)?\bTest[A-Z][\dA-Za-z]*\b/;

/**
 * Rename a `describe` title.
 *
 * @param {string} title - Current title.
 * @returns {{ title: string; python: string | null } | null} The new title
 *   and Python name, or null when nothing changes.
 */
function renameDescribe(title) {
  const leading = LEADING_CLASS.exec(title);
  if (leading) {
    const cls = leading[0];
    let rest = title.slice(cls.length);
    const methodMatch = LEADING_METHOD.exec(rest);
    const method = methodMatch ? methodMatch[0].slice(2) : null;
    if (method) rest = rest.slice(methodMatch[0].length);
    let english = humanizeClassName(cls);
    if (method) english += `: ${humanizeTestId(method)}`;
    const suffix = stripCitations(rest);
    const glue = suffix.length > 0 ? " " : "";
    return {
      title: `${english}${glue}${suffix}`.trim(),
      python: method ? `${cls}::${method}` : cls,
    };
  }
  for (const paren of title.matchAll(PARENTHETICAL)) {
    const inner = paren[1];
    const found = INNER_CLASS.exec(inner);
    if (!found) continue;
    const cls = found[0].replace(/^.*::/, "");
    const remainder = (
      inner.slice(0, found.index) + inner.slice(found.index + found[0].length)
    ).replaceAll(/^[\s,;]+|[\s,;]+$/g, "");
    const replacement = remainder.length > 0 ? ` (${remainder})` : "";
    const next = stripCitations(
      title.slice(0, paren.index) +
        replacement +
        title.slice(paren.index + paren[0].length),
    );
    return { title: next, python: cls };
  }
  const stripped = stripCitations(title);
  return stripped === title ? null : { title: stripped, python: null };
}

/**
 * The root callee name of `it(...)`, `it.each(...)(...)`, `describe.skipIf(...)(...)`.
 *
 * @param {ts.CallExpression} call - The call.
 * @returns {string | null} `it`, `test`, `describe`, or null.
 */
function rootName(call) {
  /** @type {ts.Expression} */
  let node = call.expression;
  for (;;) {
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node)) {
      node = node.expression;
      continue;
    }
    return null;
  }
}

/**
 * Rewrite one file.
 *
 * @param {string} fileName - Absolute path.
 * @returns {{ its: number; describes: number; changed: boolean }} Counts.
 */
function processFile(fileName) {
  const original = readFileSync(fileName, "utf8");
  const source = ts.createSourceFile(
    fileName,
    original,
    ts.ScriptTarget.Latest,
    true,
  );
  /** @type {Array<{ start: number; end: number; text: string }>} */
  const edits = [];
  /** @type {Map<number, string[]>} line-end offset → comments to append */
  const comments = new Map();
  let its = 0;
  let describes = 0;

  /** @param {ts.Node} node - Visited node. */
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const root = rootName(node);
      const [first] = node.arguments;
      if (
        (root === "it" || root === "test" || root === "describe") &&
        ts.isStringLiteral(first)
      ) {
        const result =
          root === "describe"
            ? renameDescribe(first.text)
            : renameIt(first.text);
        if (result && (result.title !== first.text || result.python)) {
          if (root === "describe") describes += 1;
          else its += 1;
          edits.push({
            start: first.getStart(),
            end: first.getEnd(),
            text: JSON.stringify(result.title),
          });
          if (result.python) {
            const lineEnd = original.indexOf("\n", first.getEnd());
            const at = lineEnd === -1 ? original.length : lineEnd;
            const list = comments.get(at) ?? [];
            list.push(`// python: ${result.python}`);
            comments.set(at, list);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (edits.length === 0) return { its, describes, changed: false };
  for (const [at, list] of comments) {
    edits.push({ start: at, end: at, text: ` ${list.join(" ")}` });
  }
  let text = original;
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }
  if (!CHECK) writeFileSync(fileName, text);
  return { its, describes, changed: text !== original };
}

/**
 * Walk a directory for `.ts` test files.
 *
 * @param {string} path - File or directory.
 * @returns {string[]} Absolute file paths.
 */
function collect(path) {
  if (statSync(path).isFile()) return [path];
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (/\.test(?:-d)?\.ts$/.test(full)) out.push(full);
  }
  return out;
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const roots = args.length > 0 ? args : ["packages/core/test"];
const files = roots.flatMap((root) => collect(resolve(REPO_ROOT, root)));
let its = 0;
let describes = 0;
let changed = 0;
for (const file of files) {
  const report = processFile(file);
  its += report.its;
  describes += report.describes;
  if (report.changed) {
    changed += 1;
    if (CHECK) console.log(`would change ${relative(REPO_ROOT, file)}`);
  }
}
console.log(
  `${CHECK ? "would rename" : "renamed"} ${its} it title(s) and ${describes} describe title(s) in ${changed} file(s)`,
);
if (CHECK && changed > 0) process.exit(1);
