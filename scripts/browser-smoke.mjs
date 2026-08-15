// Browser-bundle smoke test (R9.1 / D11).
//
// Bundles @mixpanel-headless/core for the browser platform with esbuild.
// Any import of a Node built-in (node:*, fs, path, os) or undici anywhere in
// core's module graph fails the build, backstopping the ESLint boundary.
// Wired into `npm run check`.
import { build } from "esbuild";

try {
  const result = await build({
    entryPoints: ["packages/core/src/index.ts"],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  const bytes = result.outputFiles.reduce((n, f) => n + f.contents.length, 0);
  console.log(
    `browser-bundle smoke OK: core bundled for browser (${bytes} bytes)`,
  );
} catch (err) {
  console.error(
    "browser-bundle smoke FAILED: core does not bundle for the browser platform.",
  );
  console.error(err);
  process.exit(1);
}
