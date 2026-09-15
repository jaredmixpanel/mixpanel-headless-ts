#!/usr/bin/env node
// Generate scripts/lib/python-reference-anchors.gen.json — the heading
// anchors of the Python library's API reference, per page.
//
// The TypeDoc plugin `scripts/lib/typedoc-python-see-links.mjs` links every
// `@see mixpanel_headless.…` provenance tag to the Python site. mkdocstrings
// only emits a heading (and thus an anchor) for the members its `::: `
// directives select, so which links exist is a property of the Python docs
// build, not something a table in this repo can infer. This script builds
// that site from the Python checkout at the corpus pin, in a detached
// worktree so a dirty checkout cannot leak in, and records every
// `id="mixpanel_headless.…"` the `api/*` pages carry.
//
// Usage:
//   node scripts/generate-python-reference-anchors.mjs [--check]
//   MP_PYTHON_REPO=/path/to/mixpanel-headless  (default ../mixpanel-headless)
//
// `--check` regenerates in memory and exits 1 when the committed file
// differs. The build runs `uv run --offline`: nothing is fetched; `uv sync
// --extra docs` in the checkout primes the cache once. Re-run, and commit,
// when the corpus pin moves.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = "scripts/generate-python-reference-anchors.mjs";
const OUT = join(REPO_ROOT, "scripts/lib/python-reference-anchors.gen.json");
const CONFIG = join(REPO_ROOT, "conformance-runner/corpus.config.json");
const SITE = "https://mixpanel.github.io/mixpanel-headless/api";
const ANCHOR = /id="(mixpanel_headless(?:\.[A-Za-z_]\w*)+)"/g;

const check = process.argv.includes("--check");
const pythonRepo = resolve(
  REPO_ROOT,
  process.env["MP_PYTHON_REPO"] ?? "../mixpanel-headless",
);

/**
 * Run a command, exiting with its stderr tail on failure.
 *
 * @param {string} command - The executable.
 * @param {string[]} args - Its arguments.
 * @param {string} cwd - Working directory.
 * @param {string} hint - What to try when it fails.
 * @returns {string} Trimmed stdout.
 */
function run(command, args, cwd, hint) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    const tail = `${result.stdout}\n${result.stderr}`
      .trim()
      .split("\n")
      .slice(-15)
      .join("\n");
    console.error(
      `${SELF}: \`${command} ${args.join(" ")}\` failed in ${cwd}\n${tail}\n${hint}`,
    );
    process.exit(1);
  }
  return result.stdout.trim();
}

if (!existsSync(join(pythonRepo, "mkdocs.yml"))) {
  console.error(
    `${SELF}: no Python checkout at ${pythonRepo} (set MP_PYTHON_REPO)`,
  );
  process.exit(1);
}
const pin = JSON.parse(readFileSync(CONFIG, "utf8")).sourceCommit;
if (typeof pin !== "string" || !/^[0-9a-f]{40}$/.test(pin)) {
  console.error(`${SELF}: corpus.config.json carries no 40-hex sourceCommit`);
  process.exit(1);
}
const kind = run(
  "git",
  ["-C", pythonRepo, "cat-file", "-t", pin],
  REPO_ROOT,
  `Fetch the Python repo: the corpus pin ${pin} is not in ${pythonRepo}.`,
);
if (kind !== "commit") {
  console.error(`${SELF}: ${pin} is a ${kind}, not a commit`);
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), "mp-python-anchors-"));
const worktree = join(scratch, "src");
const site = join(scratch, "site");
try {
  run(
    "git",
    ["-C", pythonRepo, "worktree", "add", "--detach", "--quiet", worktree, pin],
    REPO_ROOT,
    "Could not create a detached worktree of the pin.",
  );
  run(
    "uv",
    [
      "run",
      "--offline",
      "--extra",
      "docs",
      "mkdocs",
      "build",
      "--strict",
      "-d",
      site,
    ],
    worktree,
    "Prime uv's cache once with `uv sync --extra docs` in the Python checkout; the build itself needs no network.",
  );
  const handler = run(
    "uv",
    [
      "run",
      "--offline",
      "--extra",
      "docs",
      "python",
      "-c",
      "import importlib.metadata as m; print(m.version('mkdocstrings-python'))",
    ],
    worktree,
    "mkdocstrings-python is missing from the docs extra.",
  );

  const pages = {};
  const apiDir = join(site, "api");
  for (const entry of readdirSync(apiDir, { withFileTypes: true }).sort(
    (a, b) => (a.name < b.name ? -1 : 1),
  )) {
    if (!entry.isDirectory()) continue;
    const html = readFileSync(join(apiDir, entry.name, "index.html"), "utf8");
    const ids = new Set();
    for (const match of html.matchAll(ANCHOR)) ids.add(match[1]);
    if (ids.size > 0) pages[entry.name] = [...ids].sort();
  }
  const total = Object.values(pages).reduce((sum, ids) => sum + ids.length, 0);
  const generatorSha = createHash("sha256")
    .update(readFileSync(join(REPO_ROOT, SELF)))
    .digest("hex");
  const document = {
    $comment: [
      `Generated by ${SELF}; do not edit. Heading anchors of the Python API reference (${SITE}), one list per page, as mkdocstrings emits them.`,
      `Provenance: mixpanel-headless ${pin} (the corpus pin), mkdocs build of a detached worktree with mkdocstrings-python ${handler}, ${total} anchors on ${Object.keys(pages).length} pages.`,
      `Generator sha256: ${generatorSha} (${SELF}).`,
    ],
    site: SITE,
    pages,
  };
  const text = `${JSON.stringify(document, null, 2)}\n`;
  if (check) {
    const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (current !== text) {
      console.error(
        `${SELF}: ${OUT} is stale; run without --check to regenerate.`,
      );
      process.exit(1);
    }
    console.error(`${SELF}: up to date (${total} anchors).`);
  } else {
    writeFileSync(OUT, text);
    console.error(
      `${SELF}: wrote ${total} anchors on ${Object.keys(pages).length} pages to ${OUT}`,
    );
  }
} finally {
  execFileSync(
    "git",
    ["-C", pythonRepo, "worktree", "remove", "--force", worktree],
    { stdio: "ignore" },
  );
  rmSync(scratch, { recursive: true, force: true });
}
