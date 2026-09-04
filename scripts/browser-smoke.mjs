// Browser-bundle smoke test (R9.1 / D11; two-entry promotion B9-R1,
// b9-packets.md §2.5).
//
// Part 1 — purity. Bundles @mixpanel-headless/core AND
// @mixpanel-headless/browser for the browser platform with esbuild — one
// build call, two entries; the build fails if EITHER entry pulls a Node
// built-in (node:*, fs, path, os) or undici anywhere in its module graph,
// backstopping the ESLint boundary. packages/browser is a REAL browser
// build target from B9 on.
//
// Part 2 — the shipped bundle (heads spec 04 §3). Runs the real recipe
// (scripts/build-browser-bundle.mjs) in memory and asserts that the IIFE
// installs a `MixpanelHeadless` global carrying the surface the consumer's
// artifact lane depends on. Catching a rename here — rather than in a
// vendored copy three repos downstream — is the point.
//
// Wired into `npm run check`.
import { build } from "esbuild";
import {
  GLOBAL_NAME,
  IIFE_FILE,
  buildBrowserBundles,
  iifeGlobalKeys,
} from "./build-browser-bundle.mjs";

const entryPoints = [
  "packages/core/src/index.ts",
  "packages/browser/src/index.ts",
];

/**
 * The surface heads spec 04 §3.3 requires the vendored bundle to expose.
 *
 * `pythonJsonDumpsCanonical` was optional-and-reported here while spec 02's
 * canonicalizer was still landing; it is on the browser barrel now, and a
 * page cannot compute a QueryRef hash without it, so it is required.
 * `inferBookmarkType` is the other half of that pair (the report type a
 * params object describes) and is listed for the same reason — this smoke
 * runs standalone as `npm run smoke:browser`, so it must go red on its own
 * if either re-export disappears rather than leaning on the vitest suite.
 */
const REQUIRED_EXPORTS = [
  "InMemoryCredentialStore",
  "LocalStorageCredentialStore",
  "MixpanelHeadlessError",
  "beginLogin",
  "completeLogin",
  "createBrowserWorkspace",
  "createBrowserWorkspaceFromStore",
  "inferBookmarkType",
  "pythonJsonDumpsCanonical",
];

const fail = (message, err) => {
  console.error(message);
  if (err !== undefined) console.error(err);
  process.exit(1);
};

// ── Part 1: purity of both entry points ────────────────────────────────
try {
  const result = await build({
    entryPoints,
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    // esbuild requires an outdir for multiple entries even with
    // write:false (nothing is written to disk).
    outdir: "dist-smoke",
    logLevel: "silent",
  });
  const bytes = result.outputFiles.reduce((n, f) => n + f.contents.length, 0);
  console.log(
    `browser-bundle smoke OK: ${entryPoints.join(" + ")} bundled for browser (${bytes} bytes)`,
  );
} catch (err) {
  fail(
    "browser-bundle smoke FAILED: core/browser do not bundle for the browser platform.",
    err,
  );
}

// ── Part 2: the shipped IIFE + ESM recipe ──────────────────────────────
let bundles;
try {
  // `allowDirty` because the gate runs on working trees; provenance is the
  // committed build's problem, not the smoke's. `write: false` keeps the
  // gate from touching dist/.
  bundles = await buildBrowserBundles({ allowDirty: true, write: false });
} catch (err) {
  fail("browser-bundle smoke FAILED: the vendoring recipe did not build.", err);
}

let exported;
try {
  exported = iifeGlobalKeys(bundles.iifeText);
} catch (err) {
  fail(
    `browser-bundle smoke FAILED: ${IIFE_FILE} did not install the \`${GLOBAL_NAME}\` global.`,
    err,
  );
}

const missing = REQUIRED_EXPORTS.filter((name) => !exported.includes(name));
if (missing.length > 0) {
  fail(
    `browser-bundle smoke FAILED: \`${GLOBAL_NAME}\` is missing required ` +
      `export(s): ${missing.join(", ")}. The consumer's artifact lane ` +
      "(heads spec 04 §3.3) depends on these names.",
  );
}

const sizes = bundles.artifacts
  .map((a) => `${a.name} ${(a.size / 1024).toFixed(1)} KB min`)
  .join(", ");
console.log(
  `browser-bundle recipe OK: \`${GLOBAL_NAME}\` exposes ${exported.length} exports ` +
    `(all ${REQUIRED_EXPORTS.length} required present); ${sizes}`,
);
