// Shared node test helpers: every test builds under a fresh tmp dir, points
// modules there through explicit paths or stubbed env, and refuses any path
// under the real home directory. `~/.mp` is never touched by tests.

import { mkdtempSync, rmSync, statSync } from "node:fs";
import * as os from "node:os";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import { expect, vi } from "vitest";

/**
 * Create a temp directory for one test and register cleanup.
 *
 * @param cleanups - Array collecting cleanup thunks (run in afterEach).
 * @returns Absolute path of the fresh temp directory.
 */
export function makeTempDir(cleanups: Array<() => void>): string {
  const dir = mkdtempSync(join(tmpdir(), "mp-b8n1-"));
  assertNotUnderHome(dir);
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/**
 * Real-home guard: refuse any path under `os.homedir()`.
 *
 * @param path - Candidate path about to be used by a test.
 * @throws Error - When the resolved path is inside the real home dir.
 */
function assertNotUnderHome(path: string): void {
  const home = resolve(os.homedir());
  const resolved = resolve(path);
  if (resolved === home || resolved.startsWith(home + sep)) {
    throw new Error(
      `test guard: refusing to touch a path under the real home dir: ${resolved}`,
    );
  }
}

/**
 * Remove every `MP_*` variable from the environment through `vi.stubEnv`,
 * so the node env wiring reads only what the test sets. The Python
 * suite's conftest scrub twin; `vi.unstubAllEnvs()` in `afterEach`
 * restores the originals.
 */
export function scrubMpEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("MP_")) {
      vi.stubEnv(key, undefined);
    }
  }
}

/**
 * Assert POSIX permission bits (`mode & 0o7777`). A no-op on Windows,
 * where the bits are not meaningful — so callers stay unconditional
 * (`vitest/no-conditional-expect`).
 *
 * @param path - The file or directory to stat.
 * @param mode - The expected permission bits.
 */
export function expectPosixMode(path: string, mode: number): void {
  if (process.platform === "win32") {
    return;
  }
  expect(statSync(path).mode & 0o7777).toBe(mode);
}
