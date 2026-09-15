// B8-N1 shared FS-test helpers — the Python-suite real-home guard
// discipline (b8-packets.md §7 caution 3; `b7-packets.md` §6.19
// precedent): every test builds under `fs.mkdtempSync(os.tmpdir())`,
// points modules there via explicit paths / env overrides, and asserts
// no resolved path is under `os.homedir()` before any write. `~/.mp`
// is NEVER touched by tests.

import { mkdtempSync, rmSync, statSync } from "node:fs";
import * as os from "node:os";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import { expect } from "vitest";

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
export function assertNotUnderHome(path: string): void {
  const home = resolve(os.homedir());
  const resolved = resolve(path);
  if (resolved === home || resolved.startsWith(home + sep)) {
    throw new Error(
      `test guard: refusing to touch a path under the real home dir: ${resolved}`,
    );
  }
}

/**
 * Snapshot-and-scrub every `MP_*` env var (the Python conftest scrub
 * twin) so node env wiring reads only what the test sets.
 *
 * @returns A restore thunk (call in afterEach).
 */
export function scrubMpEnv(): () => void {
  const saved = new Map<string, string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("MP_")) {
      continue;
    }
    if (value !== undefined) {
      saved.set(key, value);
    }
    Reflect.deleteProperty(process.env, key);
  }
  return () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("MP_")) {
        Reflect.deleteProperty(process.env, key);
      }
    }
    for (const [key, value] of saved) {
      process.env[key] = value;
    }
  };
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
