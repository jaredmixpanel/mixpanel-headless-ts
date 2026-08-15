// B0-2 R10.9 edge-harness launcher (esbuild-bundle pattern from
// scripts/run-conformance.mjs — the repo has no build step).
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, "dist", "edge-harness.mjs");

mkdirSync(dirname(outFile), { recursive: true });
await build({
  entryPoints: [resolve(here, "edge-harness.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  logLevel: "silent",
});

const { main } = await import(pathToFileURL(outFile).href);
process.exitCode = await main();
