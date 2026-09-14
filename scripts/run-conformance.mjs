// Standalone conformance CLI launcher (design D12).
//
// This wrapper bundles conformance-runner/src/cli.ts with esbuild into
// dist/ and imports the bundle, forwarding argv and the exit code — the rig
// runs from TypeScript source (workspace aliases map `@mixpanel-headless/*`
// to `src/`, never to a possibly stale `dist/`). Invoked via
// `npm run conformance -- --report json`.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { esbuildAliases } from "./lib/workspace-aliases.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = resolve(repoRoot, "conformance-runner");
const outFile = resolve(packageDir, "dist", "cli.mjs");

mkdirSync(dirname(outFile), { recursive: true });
await build({
  entryPoints: [resolve(packageDir, "src", "cli.ts")],
  outfile: outFile,
  bundle: true,
  alias: esbuildAliases(),
  platform: "node",
  format: "esm",
  target: "node22.12",
  sourcemap: false,
  logLevel: "silent",
});

const { main } = await import(pathToFileURL(outFile).href);
process.exitCode = await main(process.argv.slice(2));
