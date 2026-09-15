/**
 * oracle-ts stdin/stdout loop — the transport around {@link OracleServer}.
 *
 * One request line in, one response line out, strictly in order; blank
 * lines are ignored; `stderr` is free-form logs (never parsed). The
 * process exits 0 after serving `oracle.shutdown` and on stdin EOF (a
 * harness crash must not leave zombie oracles). Launched via
 * `scripts/run-oracle.mjs` as an esbuild bundle.
 *
 * @packageDocumentation
 */

import { createInterface } from "node:readline";

import { OracleServer, resolveIdentity } from "./server.js";

/**
 * Run the oracle session over this process's stdin/stdout.
 *
 * @returns A promise resolving when stdin ends or shutdown is served
 *   (the exit code is always 0; protocol failures are per-request
 *   `error` responses, never process failures).
 */
export async function runOracle(): Promise<void> {
  const server = new OracleServer(resolveIdentity());
  const lines = createInterface({ input: process.stdin, terminal: false });
  for await (const line of lines) {
    const response = await server.handleLine(line);
    if (response !== null) {
      await writeLine(response);
    }
    if (server.shutdownRequested) {
      break;
    }
  }
  lines.close();
}

/**
 * Write one response line to stdout, awaiting the flush.
 *
 * Awaiting matters at shutdown: returning from {@link runOracle} before
 * the final `{ok: true}` line is flushed would race the harness's
 * response read against process exit.
 *
 * @param response - The single-line JSON response (no newline).
 * @returns A promise resolving once the write is accepted/flushed.
 */
function writeLine(response: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    process.stdout.write(`${response}\n`, (error) => {
      if (error) {
        rejectPromise(error);
      } else {
        resolvePromise();
      }
    });
  });
}
