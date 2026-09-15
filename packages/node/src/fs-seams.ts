/**
 * Plain filesystem seams for `packages/core` injection points that are
 * NOT credential surfaces (b8-packets.md §2.1 row 4 — the W7-D1
 * outbound deferral from `b6-packets.md`).
 */

import { readFile } from "node:fs/promises";

/**
 * Read a user-supplied file as bytes — the `Path(...).read_bytes()`
 * twin behind `WorkspaceOptions.readFile`
 * (`workspace.ts:560`, default throws `UNPORTED_FILE_READ_SEAM`).
 *
 * Deliberately a PLAIN read with NO credential hardening (no symlink
 * refusal, no mode/size caps): the seam feeds `uploadLookupTable` a
 * user-chosen CSV, not a credential file — exactly like Python's bare
 * `read_bytes()` (packet §2.1: "plain read, NO credential hardening").
 *
 * @param path - Absolute or CWD-relative file path.
 * @returns The file contents.
 * @throws Error - Node system errors verbatim (`ENOENT` is the
 *   `FileNotFoundError` twin the workspace call site expects).
 */
export async function nodeReadFile(path: string): Promise<Uint8Array> {
  return await readFile(path);
}
