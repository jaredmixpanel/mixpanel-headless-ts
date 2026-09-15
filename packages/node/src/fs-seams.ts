/**
 * Plain filesystem seams for the core injection points that are not
 * credential surfaces. Credential reads live in `io-utils.ts`.
 */

import { readFile } from "node:fs/promises";

/**
 * Read a user-supplied file as bytes — the `Path(...).read_bytes()`
 * twin behind `WorkspaceOptions.readFile` (whose core default throws
 * `UNPORTED_FILE_READ_SEAM`).
 *
 * @remarks
 * Deliberately a plain read with no credential hardening (no symlink
 * refusal, no mode or size caps): the seam feeds `uploadLookupTable` a
 * user-chosen CSV, not a credential file, exactly like Python's bare
 * `read_bytes()`.
 * @param path - Absolute or CWD-relative file path.
 * @returns The file contents.
 * @throws Error - Node system errors verbatim (`ENOENT` is the
 *   `FileNotFoundError` twin the workspace call site expects).
 * @example
 * ```ts
 * const ws = new Workspace({ sources, readFile: nodeReadFile });
 * await ws.uploadLookupTable("./lookup.csv");
 * ```
 */
export async function nodeReadFile(path: string): Promise<Uint8Array> {
  return await readFile(path);
}
