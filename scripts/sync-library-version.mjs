#!/usr/bin/env node
// Rewrites the User-Agent version literal in
// packages/core/src/client/headers.ts from packages/core/package.json.
// `core` cannot read files at runtime, so the version is a pinned constant;
// Changesets bumps the manifest but not TypeScript, so `npm run version`
// runs this after `changeset version` and the constant lands in the same
// "Version Packages" pull request. `tests/library-version.test.ts` fails
// when the two drift anyway.
//
// Usage:
//   npm run sync:library-version              # rewrite the constant
//   npm run sync:library-version -- --check   # exit 1 if it is stale
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root (this script lives in scripts/). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The manifest whose `version` is the source of truth. */
const MANIFEST_PATH = resolve(REPO_ROOT, "packages/core/package.json");

/** The module holding the constant. */
const HEADERS_PATH = resolve(REPO_ROOT, "packages/core/src/client/headers.ts");

/** The one line the script owns; the test in tests/ uses the same shape. */
const LITERAL = /^const LIBRARY_VERSION = "([^"]+)";$/m;

const checkOnly = process.argv.includes("--check");

/** @type {{ version: string }} */
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const source = readFileSync(HEADERS_PATH, "utf8");
const match = LITERAL.exec(source);
if (!match) {
  console.error(
    `sync-library-version: no LIBRARY_VERSION line in ${HEADERS_PATH}`,
  );
  process.exit(2);
}

if (match[1] === manifest.version) {
  console.log(`LIBRARY_VERSION already ${manifest.version}`);
  process.exit(0);
}
if (checkOnly) {
  console.error(
    `LIBRARY_VERSION is ${match[1]} but packages/core/package.json says ${manifest.version}; run npm run sync:library-version`,
  );
  process.exit(1);
}
writeFileSync(
  HEADERS_PATH,
  source.replace(
    LITERAL,
    () => `const LIBRARY_VERSION = "${manifest.version}";`,
  ),
);
console.log(`LIBRARY_VERSION ${match[1]} -> ${manifest.version}`);
