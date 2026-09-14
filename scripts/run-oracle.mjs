// oracle-ts launcher (design D14).
//
// Same pattern as run-conformance.mjs: this wrapper bundles
// differential/oracle/main.ts with esbuild into dist/ (from TypeScript
// source, via the workspace aliases) and runs the session loop. Spawned by
// the Python fuzz harness as e.g.
//   --right "node /abs/path/to/scripts/run-oracle.mjs"
// esbuild diagnostics go to stderr, which the protocol reserves for
// free-form logs, so bundling noise can never corrupt the line framing.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { esbuildAliases } from "./lib/workspace-aliases.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = resolve(repoRoot, "differential");
const outFile = resolve(packageDir, "dist", "oracle.mjs");

mkdirSync(dirname(outFile), { recursive: true });
await build({
  entryPoints: [resolve(packageDir, "oracle", "main.ts")],
  outfile: outFile,
  bundle: true,
  alias: esbuildAliases(),
  platform: "node",
  format: "esm",
  target: "node22.12",
  sourcemap: false,
  logLevel: "silent",
});

const { runOracle } = await import(pathToFileURL(outFile).href);
await runOracle();
