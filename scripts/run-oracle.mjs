#!/usr/bin/env node
// oracle-ts launcher.
//
// Bundles differential/oracle/main.ts from TypeScript source (same recipe as
// run-conformance.mjs) and runs the stdin/stdout session loop. Spawned by the
// Python fuzz harness as e.g.
//   --right "node /abs/path/to/scripts/run-oracle.mjs"
// esbuild diagnostics go to stderr, which the protocol reserves for free-form
// logs, so bundling noise can never corrupt the line framing.
import { bundleAndImport } from "./lib/bundle-and-run.mjs";

const { runOracle } = await bundleAndImport({
  entry: "differential/oracle/main.ts",
  outFile: "differential/dist/oracle.mjs",
});
await runOracle();
