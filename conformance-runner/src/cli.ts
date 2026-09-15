/**
 * Standalone conformance CLI (design D12 reporting).
 *
 * Invoked as `npm run conformance -- --report json`; loads the committed
 * corpus snapshot, replays every vector through the runner, and prints the
 * D12 JSON report `{total, passed, failed, skipped_unported, failures}` to
 * stdout (a human-readable summary goes to stderr). Exit code 0 when
 * `failed === 0`, 1 otherwise — `UNPORTED` vectors are counted, never
 * failing (R10.5).
 *
 * Flags:
 * - `--report json` — report format (json is the only format; the flag is
 *   accepted for command-line stability with the design's invocation).
 * - `--filter <substring>` — replay only vectors whose id includes the
 *   substring (mirror of the Python runner CLI's `--filter`).
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createRunnerDeps } from "./bindings.js";
import { loadCorpus, loadCorpusConfig } from "./loader.js";
import { runCorpus } from "./runner.js";
import { summarizeResults } from "./verdicts.js";

/** Parsed CLI arguments. */
interface CliArgs {
  /** Report format (only `json` is supported). */
  readonly report: string;
  /** Optional vector-id substring filter. */
  readonly filter?: string;
}

/**
 * Parse the CLI argument list.
 *
 * @param argv - Arguments after the executable (e.g.
 *   `process.argv.slice(2)`).
 * @returns The parsed arguments.
 * @throws Error - On unknown flags or missing flag values.
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  let report = "json";
  let filter: string | undefined;
  // The flag whose value the next argument supplies.
  let pending: "--report" | "--filter" | null = null;
  for (const arg of argv) {
    if (pending === "--report") {
      report = arg;
      pending = null;
    } else if (pending === "--filter") {
      filter = arg;
      pending = null;
    } else if (arg === "--report" || arg === "--filter") {
      pending = arg;
    } else {
      throw new Error(`unknown argument ${JSON.stringify(arg)}`);
    }
  }
  if (pending !== null) {
    throw new Error(`${pending} requires a value`);
  }
  if (report !== "json") {
    throw new Error(
      `unsupported --report format ${JSON.stringify(report)} (only "json")`,
    );
  }
  return { report, ...(filter === undefined ? {} : { filter }) };
}

/**
 * Run the conformance CLI.
 *
 * @param argv - Arguments after the executable.
 * @returns The process exit code (0 = no failing verdicts).
 * @example
 * ```typescript
 * const code = await main(["--report", "json"]);
 * ```
 */
export async function main(argv: readonly string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`conformance: ${String(error)}\n`);
    return 2;
  }
  // The bundled CLI lives at <package>/dist/cli.mjs and the source at
  // <package>/src/cli.ts — the package root is one directory up either way.
  const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const config = loadCorpusConfig(packageDir);
  const corpus = loadCorpus(
    resolve(packageDir, config.vectorsPath),
    config.sourceCommit,
    config.recordEpoch,
  );
  const deps = createRunnerDeps(config.recordEpoch);
  const results = await runCorpus(corpus, deps, args.filter);
  const report = summarizeResults(results);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stderr.write(
    `conformance: ${String(report.total)} vectors — ` +
      `${String(report.passed)} passed, ${String(report.failed)} failed, ` +
      `${String(report.skipped_unported)} unported (corpus @ ${corpus.manifest.sourceCommit.slice(0, 12)})\n`,
  );
  return report.failed === 0 ? 0 : 1;
}
