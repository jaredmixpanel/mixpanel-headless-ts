/**
 * Atomic on-disk write primitive, credential-read helpers, and bounded
 * stdin reader — TS port of `mixpanel_headless/_internal/io_utils.py`
 * (whole file, `io_utils.py:1-545`; b8-packets.md §2.1 row 1).
 *
 * Every persisted credential / config write goes through
 * {@link atomicWriteBytes} so a crash between open and rename cannot
 * leave a half-written file in place of the prior good copy. Durability
 * (`fsync`) is intentionally NOT performed, exactly like Python — this
 * helper guarantees atomicity-on-success, not power-loss survival.
 *
 * **Sanctioned R9.2 deviation (plan §4.2 "POSIX atomic 0o600 writes"
 * row; b8-packets.md §2.1)**: Python's fd-flag hardening layer —
 * `_open_credential_fd`'s `O_NOFOLLOW` / `O_CLOEXEC` / dirfd-walk
 * machinery plus the fstat-pinned invariant checks
 * (`io_utils.py:236-435`) — is DROPPED. The node port substitutes an
 * `lstat`-based symlink refusal plus `stat`-based regular-file / mode /
 * size checks. Behavior visible to callers (refusals + successful
 * reads) is preserved; the TOCTOU window between the lstat probe and
 * the subsequent `readFileSync` is the sanctioned deviation, recorded
 * in the B8-N1 notes and deferred to the Phase-4 burn-in review
 * (packet §8 outbound row 3).
 *
 * **Tmp-name substitution (packet §2.2)**: Python embeds
 * `<pid>.<tid>` in the tmp sibling name (`io_utils.py:136`). JS has no
 * OS thread id in the main thread (`worker_threads.threadId` is 0), so
 * the port embeds `process.pid` plus a monotonically increasing
 * per-process counter — preserving the collision-avoidance intent for
 * concurrent writers within one process.
 */

import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { constants as osConstants } from "node:os";
import { basename, dirname, join } from "node:path";

import { pythonStrip } from "../../core/src/compat/python-strip.js";
import {
  ConfigError,
  MixpanelHeadlessError,
  ParamValidationError,
} from "../../core/src/errors.js";

/**
 * Hard ceiling on a single secret read from stdin
 * (`io_utils.py:56-63`). Real service-account secrets are < 1 KiB and
 * OAuth bearers are < 8 KiB; a larger payload is almost always the
 * wrong file being piped.
 */
export const SECRET_STDIN_MAX_BYTES = 64 * 1024;

/**
 * Hard ceiling on a credential file's size (`io_utils.py:66-80`).
 * 1 MiB is 100x the largest realistic file; anything larger is a
 * runaway write, a corrupted file, or an attacker-planted blob.
 */
export const MAX_CREDENTIAL_BYTES = 1 << 20;

/**
 * Render a mode like CPython `oct()` — e.g. `0o644` (message parity
 * with `io_utils.py:131-135`; text out of contract, R5.4).
 *
 * @param mode - POSIX mode bits.
 * @returns The `0o…` rendering.
 */
function octal(mode: number): string {
  return `0o${mode.toString(8)}`;
}

/**
 * A credential file failed a structural safety check — TS twin of
 * Python's `CredentialPathError(OSError)` (`io_utils.py:165-181`).
 *
 * Python subclasses `OSError` so existing `except OSError` handlers at
 * the credential call sites keep catching it; the TS lineage is
 * {@link MixpanelHeadlessError} (call sites catch the class or the
 * base), with the OSError fields (`errno`, `filename`) mirrored in
 * `details` (b8-packets.md §2.2 symlink-refusal row). The
 * `CREDENTIAL_PATH_ERROR` code is node-package-local: the Python twin
 * carries no registry code (OSError is outside the exception
 * contract), and every call site translates this class to its domain
 * exception (`ConfigError` / `OAuthError`) before any contract
 * boundary — the code never reaches the wire.
 */
export class CredentialPathError extends MixpanelHeadlessError {
  /**
   * Initialize the refusal.
   *
   * @param errno - POSIX errno describing the refusal class (`ELOOP`
   *   for symlinks, `EINVAL` for non-regular files, `EPERM` for lax
   *   modes, `EFBIG` for oversized files).
   * @param message - Human-readable refusal (out of contract, R5.4).
   * @param filename - The offending path (Python's third OSError arg).
   */
  constructor(errno: number, message: string, filename: string) {
    super(message, "CREDENTIAL_PATH_ERROR", { errno, filename });
  }

  /** POSIX errno for log triage (the `exc.errno` OSError mirror). */
  get errno(): number {
    const value = this.details["errno"];
    return typeof value === "number" ? value : 0;
  }

  /** The offending path (the `exc.filename` OSError mirror). */
  get filename(): string {
    const value = this.details["filename"];
    return typeof value === "string" ? value : "";
  }
}

/**
 * True for node SYSTEM errors (libuv syscall failures) — the `OSError`
 * class-test twin at every ported `except OSError` boundary
 * (`config.py:186-189`, `bridge.py:172-176`, `storage.py:405-419`).
 * Defined ONCE here (R10.8); consumers import it by name — B8-ARB-A
 * hoisted it from `config.ts` when the bridge/storage read paths
 * gained the same clause (`b8-reviewA-resolution.md` SEM-F2/F6).
 *
 * The predicate requires BOTH a string `code` and a numeric `errno`:
 * node also stamps string codes on NON-system errors (the TextDecoder
 * fatal-mode `TypeError` carries `ERR_ENCODING_INVALID_ENCODED_DATA`),
 * and those are the `UnicodeDecodeError` twins that Python's
 * `except OSError` clauses let PROPAGATE — a code-only test would
 * swallow them into the OSError arm.
 *
 * @param exc - Thrown value.
 * @returns Whether `exc` is a libuv errno error (the OSError twin).
 */
export function isErrnoError(exc: unknown): exc is NodeJS.ErrnoException {
  return (
    exc instanceof Error &&
    typeof (exc as NodeJS.ErrnoException).code === "string" &&
    typeof (exc as NodeJS.ErrnoException).errno === "number"
  );
}

/**
 * The injectable FS operation set of {@link atomicWriteBytes} — the
 * `unittest.mock.patch("…io_utils.os.replace")` monkeypatch twin used
 * by the crash-window resilience tests (test_io_utils.py:210-300) and
 * the R10.9 harness fault-injection rows (b8-packets.md §2.5 row 1).
 */
export interface AtomicWriteFsOps {
  /** `os.open` twin (flags include `O_WRONLY|O_CREAT|O_EXCL`). */
  openSync(path: string, flags: number, mode: number): number;
  /** `os.fchmod` twin. */
  fchmodSync(fd: number, mode: number): void;
  /**
   * `os.write` twin — may short-write; the caller loops.
   *
   * @returns Bytes written from `data[offset…offset+length)`.
   */
  writeSync(
    fd: number,
    data: Uint8Array,
    offset: number,
    length: number,
  ): number;
  /** `os.close` twin. */
  closeSync(fd: number): void;
  /** `os.replace` twin (POSIX-atomic same-filesystem rename). */
  renameSync(from: string, to: string): void;
  /** `Path.unlink(missing_ok=True)` twin (caller suppresses ENOENT). */
  unlinkSync(path: string): void;
}

/** The real node:fs implementations. */
const REAL_FS_OPS: AtomicWriteFsOps = {
  openSync,
  fchmodSync,
  writeSync: (fd, data, offset, length) => writeSync(fd, data, offset, length),
  closeSync,
  renameSync,
  unlinkSync,
};

/**
 * Per-process tmp-name counter — the `threading.get_ident()`
 * substitution (module header; packet §2.2).
 */
let tmpCounter = 0;

/** Options bag of {@link atomicWriteBytes} (Python kwonly, R3.8). */
export interface AtomicWriteOptions {
  /**
   * POSIX file mode applied to the FINAL file (default `0o600`). Must
   * not grant any group/world bits (`mode & 0o077` must be 0).
   */
  readonly mode?: number | undefined;
  /** Injected FS operations (tests/harness only; defaults to node:fs). */
  readonly fsOps?: Partial<AtomicWriteFsOps> | undefined;
}

/**
 * Atomically write `data` to `path` with the requested file mode (port
 * of `atomic_write_bytes`, `io_utils.py:83-163`).
 *
 * Protocol (byte-for-byte with Python):
 *
 * 1. `mode & 0o077` → coded error BEFORE any FS touch (caution #11).
 *    Python raises bare `ValueError`; the TS twin is the existing
 *    {@link ParamValidationError} / `VALIDATION_ERROR` (R5
 *    codes-not-messages — no new code minted, packet §2.2).
 * 2. Tmp sibling `<name>.tmp.<pid>.<counter>` created via
 *    `O_WRONLY|O_CREAT|O_EXCL` at literal `0o600` — an open failure
 *    (stale tmp EEXIST, missing parent ENOENT) propagates WITHOUT
 *    touching the target and WITHOUT unlinking the foreign tmp
 *    (caution #10).
 * 3. `fchmod(fd, mode)` BEFORE writing, then a full-write loop
 *    (`writeSync` may short-write).
 * 4. `renameSync` (the `os.replace` POSIX-atomic swap).
 * 5. On ANY failure after the open: close, unlink OUR tmp
 *    (`missing_ok` semantics — ENOENT suppressed), rethrow the
 *    ORIGINAL error.
 *
 * Parent directories are NOT created. The tmp file is always created
 * owner-only regardless of the requested final `mode`.
 *
 * @param path - Destination file path (created or replaced).
 * @param data - Bytes to write.
 * @param options - `mode` (default `0o600`) + test-only `fsOps`.
 * @throws ParamValidationError - `mode` grants group/world access.
 * @throws Error - Node system errors (`EEXIST` stale tmp, `ENOENT`
 *   missing parent, write/rename failures) propagate verbatim — the
 *   `FileExistsError` / `FileNotFoundError` / `OSError` twins.
 */
export function atomicWriteBytes(
  path: string,
  data: Uint8Array,
  options: AtomicWriteOptions = {},
): void {
  const mode = options.mode ?? 0o600;
  const ops: AtomicWriteFsOps = { ...REAL_FS_OPS, ...(options.fsOps ?? {}) };
  if ((mode & 0o077) !== 0) {
    throw new ParamValidationError(
      `atomic_write_bytes mode must not grant group/world access; got ${octal(mode)}`,
    );
  }
  tmpCounter += 1;
  const tmpPath = join(
    dirname(path),
    `${basename(path)}.tmp.${process.pid}.${tmpCounter}`,
  );
  // Open OUTSIDE the cleanup scope: an EEXIST/ENOENT here must not
  // unlink the pre-existing (foreign) tmp — `io_utils.py:142` sits
  // before the try block for the same reason.
  const fd = ops.openSync(
    tmpPath,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
    0o600,
  );
  try {
    try {
      ops.fchmodSync(fd, mode);
      let offset = 0;
      while (offset < data.length) {
        const written = ops.writeSync(fd, data, offset, data.length - offset);
        if (written <= 0) {
          // POSIX guarantees > 0 (`io_utils.py:154` pragma).
          throw new Error("write returned non-positive count");
        }
        offset += written;
      }
    } finally {
      ops.closeSync(fd);
    }
    ops.renameSync(tmpPath, path);
  } catch (exc) {
    try {
      ops.unlinkSync(tmpPath);
    } catch (unlinkExc) {
      // `Path.unlink(missing_ok=True)` — only ENOENT is suppressed.
      if ((unlinkExc as NodeJS.ErrnoException).code !== "ENOENT") {
        throw unlinkExc;
      }
    }
    throw exc;
  }
}

/**
 * Raise {@link CredentialPathError} if `path` itself is a symlink
 * (port of `reject_if_symlink`, `io_utils.py:182-235`).
 *
 * `lstat` the path, throw if it's a symlink (dangling or live), return
 * silently otherwise. Missing paths are intentionally a no-op — the
 * existence check is the caller's concern. This restores the
 * attack-signal that `existsSync` (which follows symlinks and returns
 * `false` for dangling links) would hide.
 *
 * @param path - Credential file path to probe.
 * @throws CredentialPathError - `path` is a symlink.
 */
export function rejectIfSymlink(path: string): void {
  const st = lstatSync(path, { throwIfNoEntry: false });
  if (st === undefined) {
    return;
  }
  if (st.isSymbolicLink()) {
    throw new CredentialPathError(
      osConstants.errno.ELOOP,
      `Refusing to read credential at symlink: ${path}`,
      path,
    );
  }
}

/**
 * Read bytes from `path` while refusing every structural attack the
 * lstat/stat substitution can express (port of `read_credential_bytes`,
 * `io_utils.py:436-496`, under the module-header R9.2 drop).
 *
 * Refusals (each a {@link CredentialPathError}):
 *
 * - symlink at the path — live OR dangling (`ELOOP`);
 * - non-regular file: directory, FIFO, device (`EINVAL`) — checked
 *   BEFORE any open, so a FIFO cannot hang the process;
 * - group/world mode bits (`EPERM`; skipped on Windows exactly as
 *   Python skips its fstat invariants there);
 * - size above {@link MAX_CREDENTIAL_BYTES} (`EFBIG`).
 *
 * A missing non-symlink path throws the node `ENOENT` error verbatim
 * (the `FileNotFoundError` twin) — NOT a {@link CredentialPathError} —
 * preserving the call-site control flow (`io_utils.py:431-434` test
 * contract).
 *
 * @param path - File to read.
 * @returns The file contents.
 * @throws CredentialPathError - Any structural refusal above.
 * @throws Error - `ENOENT` and any other node I/O failure, verbatim.
 */
export function readCredentialBytes(path: string): Uint8Array {
  const st = lstatSync(path); // ENOENT propagates (FileNotFoundError twin).
  if (st.isSymbolicLink()) {
    throw new CredentialPathError(
      osConstants.errno.ELOOP,
      `Refusing to read credential at symlink: ${path}`,
      path,
    );
  }
  if (!st.isFile()) {
    throw new CredentialPathError(
      osConstants.errno.EINVAL,
      `Refusing to read credential: not a regular file: ${path}`,
      path,
    );
  }
  if (process.platform !== "win32") {
    const fileMode = st.mode & 0o7777;
    if ((fileMode & 0o077) !== 0) {
      throw new CredentialPathError(
        osConstants.errno.EPERM,
        `Refusing to read credential with mode ${octal(fileMode)} ` +
          `(group/world bits set): ${path}`,
        path,
      );
    }
  }
  if (st.size > MAX_CREDENTIAL_BYTES) {
    throw new CredentialPathError(
      osConstants.errno.EFBIG,
      `Refusing to read credential: size ${st.size} exceeds ` +
        `cap ${MAX_CREDENTIAL_BYTES}: ${path}`,
      path,
    );
  }
  return readFileSync(path);
}

/** Options bag of {@link readCredentialText}. */
export interface ReadCredentialTextOptions {
  /** Text encoding (default `utf-8`; every credential file is UTF-8). */
  readonly encoding?: string | undefined;
}

/**
 * UTF-8 (by default) wrapper around {@link readCredentialBytes} (port
 * of `read_credential_text`, `io_utils.py:497-516`).
 *
 * @param path - File to read.
 * @param options - Optional encoding override.
 * @returns Decoded file contents.
 * @throws CredentialPathError - `path` fails a structural safety check.
 * @throws TypeError - File bytes are invalid in the encoding — the
 *   `UnicodeDecodeError` twin (`TextDecoder` with `fatal: true`); call
 *   sites that let Python's `UnicodeDecodeError` propagate let this
 *   propagate too.
 * @throws Error - `ENOENT` / other node I/O failures, verbatim.
 */
export function readCredentialText(
  path: string,
  options: ReadCredentialTextOptions = {},
): string {
  const decoder = new TextDecoder(options.encoding ?? "utf-8", {
    fatal: true,
  });
  return decoder.decode(readCredentialBytes(path));
}

/**
 * A synchronous chunk reader over stdin — the injectable seam of
 * {@link readCappedSecretFromStdin} (the `sys.stdin.buffer` BytesIO
 * stub twin; disclosed substitution: a `Readable` cannot be consumed
 * synchronously, so the seam is the `fs.readSync(0, …)` shape).
 *
 * @param buffer - Destination; implementations fill from offset 0.
 * @returns Bytes read (0 at EOF).
 */
export type StdinReadSync = (buffer: Uint8Array) => number;

/**
 * The default stdin reader: `fs.readSync` on fd 0 with EAGAIN retry
 * (raw-mode TTYs report EAGAIN between keystrokes) and EOF-as-zero.
 *
 * @param buffer - Destination buffer.
 * @returns Bytes read (0 at EOF).
 */
function defaultStdinReadSync(buffer: Uint8Array): number {
  for (;;) {
    try {
      return readSync(0, buffer, 0, buffer.length, null);
    } catch (exc) {
      const code = (exc as NodeJS.ErrnoException).code;
      if (code === "EAGAIN") {
        continue;
      }
      if (code === "EOF") {
        return 0;
      }
      throw exc;
    }
  }
}

/** Options bag of {@link readCappedSecretFromStdin}. */
export interface ReadSecretStdinOptions {
  /** Injected chunk reader (default: `fs.readSync` on fd 0). */
  readonly readSync?: StdinReadSync | undefined;
}

/**
 * Read a single secret value from stdin, capped at
 * {@link SECRET_STDIN_MAX_BYTES} (port of
 * `read_capped_secret_from_stdin`, `io_utils.py:517-545`).
 *
 * Reads ALL bytes up to the cap, strips surrounding whitespace with
 * Python `str.strip()` semantics ({@link pythonStrip}, R11.7), and
 * rejects payloads larger than the cap rather than returning a
 * quietly-corrupted prefix.
 *
 * @param options - Optional injected reader (tests).
 * @returns The decoded secret with surrounding whitespace stripped.
 * @throws ConfigError - Empty/whitespace-only stdin, or a payload
 *   exceeding the cap (messages ported verbatim; out of contract).
 * @throws TypeError - Payload is not valid UTF-8 (the strict-decode
 *   `UnicodeDecodeError` twin).
 */
export function readCappedSecretFromStdin(
  options: ReadSecretStdinOptions = {},
): string {
  const reader = options.readSync ?? defaultStdinReadSync;
  // Python reads cap+1 bytes in one call; the loop is the chunked twin.
  const limit = SECRET_STDIN_MAX_BYTES + 1;
  const raw = new Uint8Array(limit);
  let total = 0;
  while (total < limit) {
    const read = reader(raw.subarray(total));
    if (read <= 0) {
      break;
    }
    total += read;
  }
  if (total > SECRET_STDIN_MAX_BYTES) {
    throw new ConfigError(
      `stdin payload exceeds ${SECRET_STDIN_MAX_BYTES} bytes; ` +
        `refusing to truncate. Pipe a single secret, not a key bundle.`,
    );
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    raw.subarray(0, total),
  );
  const value = pythonStrip(text);
  if (value === "") {
    throw new ConfigError("Secret is empty (stdin read returned no content).");
  }
  return value;
}
