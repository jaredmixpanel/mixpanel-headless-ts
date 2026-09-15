#!/usr/bin/env node
// Rename vitest `describe` / `it` titles from a JSON mapping and keep the
// Python identifier as the first line of the block body (`// python: …`).
//
// Usage: node scripts/codemods/rename-test-titles-platform.mjs <mapping.json> [--check]
//
// Mapping shape: { "<repo-relative file>": { "<old title>": <new> } } where
// <new> is either the new title string or `{ "title": string, "python":
// string | null }` to override (or suppress) the provenance comment. When
// `python` is omitted the comment is derived from the old title: a
// `test_…` prefix or a `TestFoo (test_bar.py:NN)` describe becomes
// `// python: test_…` / `// python: test_bar.py::TestFoo`; any other title
// gets no comment. Run Prettier on the touched files afterwards.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const check = args.includes("--check");
const mappingPath = args.find((a) => !a.startsWith("--"));
if (!mappingPath) {
  console.error(
    "usage: rename-test-titles-platform.mjs <mapping.json> [--check]",
  );
  process.exit(2);
}
const mapping = JSON.parse(readFileSync(mappingPath, "utf8"));

/** Escape a literal for use inside a RegExp. */
const escapeRe = (s) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** Derive the `// python:` payload from an old title, or null. */
function pythonIdentifier(oldTitle) {
  const test = /^(test_[A-Za-z0-9_]+)/.exec(oldTitle);
  if (test) return test[1];
  const cls = /^(Test[A-Za-z0-9]+)(?:\s*\((test_[a-z0-9_]+\.py)[^)]*\))?/.exec(
    oldTitle,
  );
  if (cls) return cls[2] ? `${cls[2]}::${cls[1]}` : cls[1];
  return null;
}

let total = 0;
let missing = 0;
for (const [file, renames] of Object.entries(mapping)) {
  const path = resolve(file);
  let source = readFileSync(path, "utf8");
  for (const [oldTitle, spec] of Object.entries(renames)) {
    const newTitle = typeof spec === "string" ? spec : spec.title;
    const python =
      typeof spec === "object" && "python" in spec
        ? spec.python
        : pythonIdentifier(oldTitle);
    const quote = oldTitle.includes('"') ? "'" : '"';
    // The title literal must be the first argument of a describe/it call.
    const re = new RegExp(
      String.raw`(\b(?:describe|it|test)(?:\.[A-Za-z]+(?:\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))?)*\(\s*)${escapeRe(quote + oldTitle + quote)}`,
      "g",
    );
    const matches = [...source.matchAll(re)];
    if (matches.length !== 1) {
      console.error(
        `${file}: expected 1 match for ${JSON.stringify(oldTitle)}, found ${matches.length}`,
      );
      missing += 1;
      continue;
    }
    const m = matches[0];
    const start = m.index + m[1].length;
    const end = start + quote.length * 2 + oldTitle.length;
    const newQuote = newTitle.includes('"') ? "'" : '"';
    const replacement = newQuote + newTitle + newQuote;
    let tail = source.slice(end);
    if (python) {
      // Insert the provenance comment as the first body line: find `=>`
      // then the block-opening `{` that immediately follows it.
      const arrow = /=>\s*\{/.exec(tail);
      if (arrow) {
        const lineStart = source.lastIndexOf("\n", start) + 1;
        const indent = /^\s*/.exec(source.slice(lineStart, start))[0];
        const insertAt = arrow.index + arrow[0].length;
        tail = `${tail.slice(0, insertAt)}\n${indent}  // python: ${python}${tail.slice(insertAt)}`;
      } else {
        console.error(
          `${file}: no block body after ${JSON.stringify(oldTitle)}; comment skipped`,
        );
      }
    }
    source = source.slice(0, start) + replacement + tail;
    total += 1;
  }
  if (!check) writeFileSync(path, source);
}
console.log(
  `${check ? "would rename" : "renamed"} ${total} title(s); ${missing} unmatched`,
);
process.exit(missing > 0 ? 1 : 0);
