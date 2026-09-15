// Pinned, reproducible browser-bundle build (heads spec 04 §3 —
// "Vendoring the headless bundle").
//
// Emits two artifacts from the one browser barrel plus a provenance
// manifest:
//
//   dist/browser/mixpanel-headless.js    IIFE, global `MixpanelHeadless`
//   dist/browser/mixpanel-headless.mjs   ESM, for <script type="module">
//   dist/browser/manifest.json           schema 1 (see MANIFEST_SCHEMA)
//
// Both flavours exist because the consumer serves classic scripts
// (Publisher-style pages) as well as modules; spec 04 §12 item 1.
//
// Reproducibility is the whole point — the desktop app commits these bytes
// and re-verifies them against the manifest, so a rebuild at the same
// `sourceCommit` must be byte-identical. That rules out timestamps, dates,
// absolute paths and source maps in the output. `git rev-parse HEAD` pins
// the source; a dirty tree is refused outright unless `--allow-dirty` is
// passed, and a dirty build is stamped `"dirty": true` so the manifest can
// never claim provenance it does not have.
//
// Usage:
//   node scripts/build-browser-bundle.mjs [--out <dir>] [--allow-dirty]
//
// Also imported by scripts/browser-smoke.mjs (the `npm run smoke:browser`
// gate), which builds in memory and asserts purity + the exported globals.

import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";

import { build, version as esbuildVersion } from "esbuild";

import { esbuildAliases } from "./lib/workspace-aliases.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const MANIFEST_SCHEMA = 1;
export const PACKAGE_NAME = "@mixpanel-headless/browser";
export const SOURCE_REPO = "github.com/jaredmixpanel/mixpanel-headless-ts";
export const ENTRY = "packages/browser/src/index.ts";
export const GLOBAL_NAME = "MixpanelHeadless";
export const DEFAULT_OUT_DIR = join(REPO_ROOT, "dist", "browser");

export const IIFE_FILE = "mixpanel-headless.js";
export const ESM_FILE = "mixpanel-headless.mjs";
export const MANIFEST_FILE = "manifest.json";

// A fixed header — no build date, nothing that changes between runs (the
// copyright years are the fixed span in LICENSE, not the build year).
// `legalComments: "inline"` keeps any dependency licence comments in the
// bytes rather than in a side file nobody vendors.
const LICENSE_BANNER =
  `/*! ${PACKAGE_NAME} — bundled from ${SOURCE_REPO}. ` +
  `Copyright (c) 2025-2026 Jared McFarland. MIT License. */`;

// Recorded verbatim in the manifest so the consumer can reproduce the
// build without reading this file.
const BUILD_ARGS = [
  "--bundle",
  "--platform=browser",
  "--target=chrome148",
  "--minify",
  "--legal-comments=inline",
  // The workspace aliases (source, not dist) as the equivalent CLI flags,
  // so the recorded recipe reproduces the same bytes.
  ...Object.entries(esbuildAliases()).map(
    ([specifier, path]) =>
      `--alias:${specifier}=./${relative(REPO_ROOT, path).split(sep).join("/")}`,
  ),
];

/**
 * Needles that would betray a Node dependency surviving into the bundle.
 *
 * A bare `node:` is unusable as a needle: the minified output legitimately
 * contains `_selector_node:` (a report-selector property) and
 * `packages/node:` (an error-message hint). Anchoring on the opening quote
 * of an import specifier keeps the check honest.
 */
export const IMPURITY_NEEDLES = [
  "process.",
  "require(",
  '"node:',
  "'node:",
  "`node:",
];

/** @param {string} text - @returns {string[]} needles actually found */
export function scanNodeReferences(text) {
  return IMPURITY_NEEDLES.filter((needle) => text.includes(needle));
}

/**
 * Evaluate the IIFE the way a browser would and read the keys off the
 * global it installs.
 *
 * `new Function` is banned by lint (and is the weaker check anyway); a
 * fresh `vm` context starts from a bare `globalThis` with no Node globals
 * at all, so a bundle that secretly needed `process` would throw here.
 *
 * @param {string} iifeText
 * @returns {string[]} sorted export names
 */
export function iifeGlobalKeys(iifeText) {
  /** @type {Record<string, unknown>} */
  const context = {};
  runInNewContext(iifeText, context);
  const installed = context[GLOBAL_NAME];
  if (typeof installed !== "object" || installed === null) {
    throw new Error(
      `bundle did not install a \`${GLOBAL_NAME}\` global (got ${typeof installed})`,
    );
  }
  // Code-unit order, not locale order — the manifest must not depend on
  // the host's collation.
  return Object.keys(installed).sort();
}

function gitSourceState() {
  const run = (args) =>
    execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  return {
    commit: run(["rev-parse", "HEAD"]),
    dirty: run(["status", "--porcelain"]).length > 0,
  };
}

async function bundleOne(format, globalName) {
  const result = await build({
    entryPoints: [join(REPO_ROOT, ENTRY)],
    bundle: true,
    // `@mixpanel-headless/core` inside the browser sources resolves to core's
    // TypeScript, so the vendored bytes are built from source at
    // `sourceCommit` rather than from whatever `dist/` happens to hold.
    alias: esbuildAliases(),
    format,
    platform: "browser",
    target: "chrome148",
    minify: true,
    sourcemap: false,
    legalComments: "inline",
    banner: { js: LICENSE_BANNER },
    // Absolute paths would leak the build machine into the bytes.
    absWorkingDir: REPO_ROOT,
    write: false,
    outfile: format === "iife" ? IIFE_FILE : ESM_FILE,
    logLevel: "silent",
    ...(globalName === undefined ? {} : { globalName }),
  });
  const [file] = result.outputFiles;
  if (file === undefined)
    throw new Error(`esbuild produced no ${format} output`);
  return Buffer.from(file.contents);
}

/**
 * Build both artifacts and the manifest.
 *
 * @param {{ outDir?: string, allowDirty?: boolean, write?: boolean }} [options]
 */
export async function buildBrowserBundles(options = {}) {
  const {
    outDir = DEFAULT_OUT_DIR,
    allowDirty = false,
    write = true,
  } = options;

  const { commit, dirty } = gitSourceState();
  if (dirty && !allowDirty) {
    throw new Error(
      "refusing to build from a dirty tree: the manifest's `sourceCommit` " +
        `(${commit}) would not describe these bytes. Commit or stash, or ` +
        "pass --allow-dirty for a local build.",
    );
  }

  const [iifeBytes, esmBytes] = await Promise.all([
    bundleOne("iife", GLOBAL_NAME),
    bundleOne("esm", undefined),
  ]);

  const iifeText = iifeBytes.toString("utf8");
  for (const [name, bytes] of [
    [IIFE_FILE, iifeBytes],
    [ESM_FILE, esmBytes],
  ]) {
    const found = scanNodeReferences(bytes.toString("utf8"));
    if (found.length > 0) {
      throw new Error(
        `${name} is not browser-pure: found ${found.map((n) => JSON.stringify(n)).join(", ")}`,
      );
    }
  }

  const exports = iifeGlobalKeys(iifeText);

  // Fixed key order + fixed indentation: the manifest is compared
  // byte-for-byte by the reproducibility gate.
  const manifest = {
    schema: MANIFEST_SCHEMA,
    package: PACKAGE_NAME,
    sourceRepo: SOURCE_REPO,
    sourceCommit: commit,
    ...(dirty ? { dirty: true } : {}),
    entry: ENTRY,
    build: { tool: "esbuild", version: esbuildVersion, args: BUILD_ARGS },
    files: {
      [IIFE_FILE]: { sha256: sha256Hex(iifeBytes), bytes: iifeBytes.length },
      [ESM_FILE]: { sha256: sha256Hex(esmBytes), bytes: esmBytes.length },
    },
    exports,
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

  const artifacts = [
    { name: IIFE_FILE, bytes: iifeBytes },
    { name: ESM_FILE, bytes: esmBytes },
  ].map(({ name, bytes }) => ({
    name,
    bytes,
    size: bytes.length,
    gzipSize: gzipSync(bytes, { level: 9 }).length,
    sha256: sha256Hex(bytes),
  }));

  if (write) {
    mkdirSync(outDir, { recursive: true });
    for (const artifact of artifacts) {
      writeFileSync(join(outDir, artifact.name), artifact.bytes);
    }
    writeFileSync(join(outDir, MANIFEST_FILE), manifestJson);
  }

  return { outDir, manifest, manifestJson, artifacts, iifeText, exports };
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgv(argv) {
  let outDir = DEFAULT_OUT_DIR;
  let allowDirty = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--allow-dirty") {
      allowDirty = true;
    } else if (arg === "--out") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--out requires a directory");
      outDir = resolve(value);
      i += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { outDir, allowDirty };
}

const isCli =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  try {
    const { outDir, manifest, artifacts } = await buildBrowserBundles(
      parseArgv(process.argv.slice(2)),
    );
    const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
    console.log(`browser bundle → ${outDir}`);
    console.log(
      `  source ${manifest.sourceCommit.slice(0, 12)}${manifest.dirty ? " (DIRTY)" : ""} · esbuild ${manifest.build.version} · ${manifest.exports.length} exports`,
    );
    for (const a of artifacts) {
      console.log(
        `  ${a.name.padEnd(22)} ${kb(a.size).padStart(9)} min · ${kb(a.gzipSize).padStart(9)} gzip · ${a.sha256.slice(0, 16)}`,
      );
    }
  } catch (error) {
    console.error(
      `build-browser-bundle FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
