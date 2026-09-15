#!/usr/bin/env node
// Standalone conformance CLI launcher.
//
// Bundles conformance-runner/src/cli.ts from TypeScript source (workspace
// aliases map `@mixpanel-headless/*` to `src/`) and runs it, forwarding argv
// and the exit code. Invoked via `npm run conformance -- --report json`.
import { bundleAndImport } from "./lib/bundle-and-run.mjs";

const { main } = await bundleAndImport({
  entry: "conformance-runner/src/cli.ts",
  outFile: "conformance-runner/dist/cli.mjs",
});
process.exitCode = await main(process.argv.slice(2));
