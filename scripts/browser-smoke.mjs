// Browser-bundle smoke test (R9.1 / D11; two-entry promotion B9-R1,
// b9-packets.md §2.5).
//
// Bundles @mixpanel-headless/core AND @mixpanel-headless/browser for the
// browser platform with esbuild — one build call, two entries; the build
// fails if EITHER entry pulls a Node built-in (node:*, fs, path, os) or
// undici anywhere in its module graph, backstopping the ESLint boundary.
// packages/browser is a REAL browser build target from B9 on.
// Wired into `npm run check`.
import { build } from "esbuild";

const entryPoints = [
  "packages/core/src/index.ts",
  "packages/browser/src/index.ts",
];

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
  console.error(
    "browser-bundle smoke FAILED: core/browser do not bundle for the browser platform.",
  );
  console.error(err);
  process.exit(1);
}
