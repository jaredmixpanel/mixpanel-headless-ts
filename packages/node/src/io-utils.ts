/**
 * Atomic on-disk write primitive, credential-read helpers and the
 * bounded stdin reader behind every persisted credential and config
 * file in the node package.
 *
 * Every such write goes through {@link atomicWriteBytes} so a crash
 * between open and rename cannot leave a half-written file in place of
 * the prior good copy. Durability (`fsync`) is intentionally not
 * performed, exactly like Python: the helper guarantees atomicity on
 * success, not power-loss survival.
 *
 * Python hardens credential reads at the fd level (`O_NOFOLLOW`,
 * `O_CLOEXEC`, a dirfd walk and fstat-pinned invariant checks). The node
 * port replaces that with an `lstat` symlink refusal plus `stat`
 * regular-file, mode and size checks; caller-visible behaviour (refusals
 * and successful reads) is preserved, and the TOCTOU window between the
 * `lstat` probe and the subsequent read is the accepted deviation (the
 * `// Divergence:` line at {@link readCredentialBytes}).
 *
 * @see mixpanel_headless._internal.io_utils
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

import {
  ConfigError,
  MixpanelHeadlessError,
  ParamValidationError,
  pythonStrip,
} from "@mixpanel-headless/core";

/**
 * Hard ceiling on a single secret read from stdin. Real service-account
 * secrets are under 1 KiB and OAuth bearers under 8 KiB; a larger
 * payload is almost always the wrong file being piped.
 */
export const SECRET_STDIN_MAX_BYTES: number = 64 * 1024;

/**
 * Hard ceiling on a credential file's size. 1 MiB is 100x the largest
 * realistic file; anything larger is a runaway write, a corrupted file,
 * or an attacker-planted blob.
 */
export const MAX_CREDENTIAL_BYTES: number = 1 << 20;

/**
 * Render a mode like CPython `oct()`, e.g. `0o644` (message parity;
 * text out of contract).
 *
 * @param mode - POSIX mode bits.
 * @returns The `0o…` rendering.
 */
function octal(mode: number): string {
  return `0o${mode.toString(8)}`;
}

/**
 * A credential file failed a structural safety check.
 *
 * @remarks
 * Python's `CredentialPathError` subclasses `OSError` so existing
 * `except OSError` handlers at the credential call sites keep catching
 * it; the TS lineage is {@link MixpanelHeadlessError} (call sites catch
 * the class or the base), with the OSError fields (`errno`, `filename`)
 * mirrored in `details`. The `CREDENTIAL_PATH_ERROR` code is
 * node-package-local: the Python twin carries no registry code (OSError
 * is outside the exception contract), and every call site translates
 * this class to its domain exception (`ConfigError` / `OAuthError`)
 * before any contract boundary, so the code never reaches the wire.
 * @example
 * ```ts
 * try {
 *   readCredentialText(path);
 * } catch (error) {
 *   if (error instanceof CredentialPathError) {
 *     logger.warning(`Refusing to read ${error.filename}: ${error.message}`);
 *   }
 * }
 * ```
 * @see mixpanel_headless._internal.io_utils.CredentialPathError
 */
export class CredentialPathError extends MixpanelHeadlessError {
  /**
   * Initialize the refusal.
   *
   * @param errno - POSIX errno describing the refusal class (`ELOOP`
   *   for symlinks, `EINVAL` for non-regular files, `EPERM` for lax
   *   modes, `EFBIG` for oversized files).
   * @param message - Human-readable refusal (out of contract).
   * @param filename - The offending path (Python's third OSError arg).
   */
  constructor(errno: number, message: string, filename: string) {
    super(message, "CREDENTIAL_PATH_ERROR", { errno, filename });
  }

  /**
   * Read the POSIX errno for log triage (the `exc.errno` OSError mirror).
   *
   * @returns The errno, or 0 when absent.
   */
  get errno(): number {
    const value = this.details["errno"];
    return typeof value === "number" ? value : 0;
  }

  /**
   * Read the offending path (the `exc.filename` OSError mirror).
   *
   * @returns The path, or the empty string when absent.
   */
  get filename(): string {
    const value = this.details["filename"];
    return typeof value === "string" ? value : "";
  }
}

/**
 * Return whether `exc` is a node system error (a libuv syscall failure)
 * — the `OSError` class test at every ported `except OSError` boundary.
 *
 * @remarks
 * The predicate requires both a string `code` and a numeric `errno`:
 * node also stamps string codes on non-system errors (the TextDecoder
 * fatal-mode `TypeError` carries `ERR_ENCODING_INVALID_ENCODED_DATA`),
 * and those are the `UnicodeDecodeError` twins that Python's
 * `except OSError` clauses let propagate; a code-only test would swallow
 * them into the OSError arm.
 * @param exc - Thrown value.
 * @returns Whether `exc` is a libuv errno error (the OSError twin).
 * @example
 * ```ts
 * try {
 *   lstatSync(path);
 * } catch (error) {
 *   if (!isErrnoError(error)) throw error;
 *   // handle as Python's `except OSError` would
 * }
 * ```
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
 * by the crash-window resilience tests and harness fault injection.
 */
export interface AtomicWriteFsOps {
  /** `os.open` twin (flags include `O_WRONLY|O_CREAT|O_EXCL`). */
  openSync: (path: string, flags: number, mode: number) => number;
  /** `os.fchmod` twin. */
  fchmodSync: (fd: number, mode: number) => void;
  /**
   * `os.write` twin — may short-write; the caller loops.
   *
   * @returns Bytes written from `data[offset…offset+length)`.
   */
  writeSync: (
    fd: number,
    data: Uint8Array,
    offset: number,
    length: number,
  ) => number;
  /** `os.close` twin. */
  closeSync: (fd: number) => void;
  /** `os.replace` twin (POSIX-atomic same-filesystem rename). */
  renameSync: (from: string, to: string) => void;
  /** `Path.unlink(missing_ok=True)` twin (caller suppresses ENOENT). */
  unlinkSync: (path: string) => void;
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

/** Per-process tmp-name counter (the `threading.get_ident()` substitute). */
let tmpCounter = 0;

/** Options bag of {@link atomicWriteBytes} (Python's keyword-only args). */
export interface AtomicWriteOptions {
  /**
   * POSIX file mode applied to the final file. Must not grant any
   * group/world bits (`mode & 0o077` must be 0).
   *
   * @defaultValue `0o600`
   */
  readonly mode?: number | undefined;
  /**
   * Injected FS operations (tests and the harness only).
   *
   * @defaultValue `node:fs`
   */
  readonly fsOps?: Partial<AtomicWriteFsOps> | undefined;
}

/**
 * Atomically write `data` to `path` with the requested file mode.
 *
 * @remarks
 * Protocol, byte-for-byte with Python: (1) a `mode` with group/world
 * bits is a coded error before any FS touch (Python raises a bare
 * `ValueError`; the TS twin is {@link ParamValidationError}, no new code
 * minted); (2) the tmp sibling `name.tmp.pid.counter` is created via
 * `O_WRONLY|O_CREAT|O_EXCL` at literal `0o600`, and an open failure
 * (stale tmp `EEXIST`, missing parent `ENOENT`) propagates without
 * touching the target and without unlinking the foreign tmp; (3)
 * `fchmod(fd, mode)` before writing, then a full-write loop (`writeSync`
 * may short-write); (4) `renameSync`, the `os.replace` POSIX-atomic
 * swap; (5) on any failure after the open: close, unlink our tmp
 * (`missing_ok` semantics, `ENOENT` suppressed), rethrow the original
 * error. Parent directories are not created. The tmp file is always
 * created owner-only regardless of the requested final `mode`.
 * @param path - Destination file path (created or replaced).
 * @param data - Bytes to write.
 * @param options - Final `mode` (default `0o600`) and test-only `fsOps`.
 * @throws {@link ParamValidationError} - `mode` grants group/world access.
 * @throws Error - Node system errors (`EEXIST` stale tmp, `ENOENT`
 *   missing parent, write/rename failures) propagate verbatim — the
 *   `FileExistsError` / `FileNotFoundError` / `OSError` twins.
 * @example
 * ```ts
 * atomicWriteBytes(
 *   join(dir, "tokens.json"),
 *   new TextEncoder().encode(JSON.stringify(payload)),
 *   { mode: 0o600 },
 * );
 * ```
 * @see mixpanel_headless._internal.io_utils.atomic_write_bytes
 */
export function atomicWriteBytes(
  path: string,
  data: Uint8Array,
  options: AtomicWriteOptions = {},
): void {
  const mode = options.mode ?? 0o600;
  const ops: AtomicWriteFsOps = { ...REAL_FS_OPS, ...options.fsOps };
  if ((mode & 0o077) !== 0) {
    throw new ParamValidationError(
      `atomic_write_bytes mode must not grant group/world access; got ${octal(mode)}`,
    );
  }
  tmpCounter += 1;
  // Divergence: Python names the tmp sibling `name.tmp.pid.tid`; JS has no OS thread id on the main thread (`worker_threads.threadId` is 0), so the port uses `process.pid` plus a per-process counter, which keeps concurrent writers in one process from colliding.
  const tmpPath = join(
    dirname(path),
    `${basename(path)}.tmp.${process.pid}.${tmpCounter}`,
  );
  // Open outside the cleanup scope: an EEXIST/ENOENT here must not
  // unlink the pre-existing (foreign) tmp; Python's open sits before its
  // try block for the same reason.
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
          // POSIX guarantees a positive count; this guard cannot fire.
          throw new Error("write returned non-positive count");
        }
        offset += written;
      }
    } finally {
      ops.closeSync(fd);
    }
    ops.renameSync(tmpPath, path);
  } catch (error) {
    try {
      ops.unlinkSync(tmpPath);
    } catch (error_) {
      // `Path.unlink(missing_ok=True)` — only ENOENT is suppressed.
      if ((error_ as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error_;
      }
    }
    throw error;
  }
}

/**
 * Throw {@link CredentialPathError} if `path` itself is a symlink,
 * dangling or live; return silently otherwise.
 *
 * @remarks
 * Missing paths are intentionally a no-op: the existence check is the
 * caller's concern. Probing with `lstat` restores the attack signal that
 * `existsSync` (which follows symlinks and returns `false` for dangling
 * links) would hide.
 * @param path - Credential file path to probe.
 * @throws {@link CredentialPathError} - `path` is a symlink.
 * @example
 * ```ts
 * rejectIfSymlink(path); // throws on a symlink, silent otherwise
 * if (!existsSync(path)) return null;
 * ```
 * @see mixpanel_headless._internal.io_utils.reject_if_symlink
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
 * Read bytes from `path`, refusing every structural attack the
 * lstat/stat checks can express.
 *
 * @remarks
 * Refusals, each a {@link CredentialPathError}: a symlink at the path,
 * live or dangling (`ELOOP`); a non-regular file such as a directory,
 * FIFO or device (`EINVAL`), checked before any open so a FIFO cannot
 * hang the process; group/world mode bits (`EPERM`, skipped on Windows
 * exactly as Python skips its fstat invariants there); a size above
 * {@link MAX_CREDENTIAL_BYTES} (`EFBIG`). A missing non-symlink path
 * throws the node `ENOENT` error verbatim (the `FileNotFoundError`
 * twin), not a {@link CredentialPathError}, preserving the call-site
 * control flow.
 * @param path - File to read.
 * @returns The file contents.
 * @throws {@link CredentialPathError} - Any structural refusal above.
 * @throws Error - `ENOENT` and any other node I/O failure, verbatim.
 * @example
 * ```ts
 * const bytes = readCredentialBytes(join(accountDir(name), "tokens.json"));
 * const tokens = JSON.parse(new TextDecoder().decode(bytes));
 * ```
 * @see mixpanel_headless._internal.io_utils.read_credential_bytes
 */
export function readCredentialBytes(path: string): Uint8Array {
  // Divergence: Python opens with `O_NOFOLLOW|O_CLOEXEC` through a dirfd walk and checks the invariants on the open fd; the port checks `lstat`/`stat` first and then reads by path, so a swap between the probe and `readFileSync` is a TOCTOU window Python does not have.
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
  /**
   * Text encoding; every credential file is UTF-8.
   *
   * @defaultValue `"utf-8"`
   */
  readonly encoding?: string | undefined;
}

/**
 * Read a credential file as text (UTF-8 by default) through
 * {@link readCredentialBytes}.
 *
 * @param path - File to read.
 * @param options - Optional encoding override.
 * @returns Decoded file contents.
 * @throws {@link CredentialPathError} - `path` fails a structural safety
 *   check.
 * @throws TypeError - File bytes are invalid in the encoding — the
 *   `UnicodeDecodeError` twin (`TextDecoder` with `fatal: true`); call
 *   sites that let Python's `UnicodeDecodeError` propagate let this
 *   propagate too.
 * @throws Error - `ENOENT` and other node I/O failures, verbatim.
 * @example
 * ```ts
 * const raw = JSON.parse(readCredentialText(configPath));
 * ```
 * @see mixpanel_headless._internal.io_utils.read_credential_text
 */
export function readCredentialText(
  path: string,
  options: ReadCredentialTextOptions = {},
): string {
  const decoder = new TextDecoder(options.encoding ?? "utf8", {
    fatal: true,
  });
  return decoder.decode(readCredentialBytes(path));
}

/**
 * A synchronous chunk reader over stdin — the injectable seam of
 * {@link readCappedSecretFromStdin} (the `sys.stdin.buffer` BytesIO stub
 * twin). A `Readable` cannot be consumed synchronously, so the seam has
 * the `fs.readSync(0, …)` shape.
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
 * @throws Error - Any `readSync` failure other than `EAGAIN` / `EOF`,
 *   verbatim.
 */
function defaultStdinReadSync(buffer: Uint8Array): number {
  for (;;) {
    try {
      return readSync(0, buffer, 0, buffer.length, null);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EAGAIN") {
        continue;
      }
      if (code === "EOF") {
        return 0;
      }
      throw error;
    }
  }
}

/** Options bag of {@link readCappedSecretFromStdin}. */
export interface ReadSecretStdinOptions {
  /**
   * Injected chunk reader.
   *
   * @defaultValue `fs.readSync` on fd 0
   */
  readonly readSync?: StdinReadSync | undefined;
}

/**
 * Read a single secret value from stdin, capped at
 * {@link SECRET_STDIN_MAX_BYTES}.
 *
 * @remarks
 * Reads all bytes up to the cap, strips surrounding whitespace with
 * Python `str.strip()` semantics ({@link pythonStrip}), and rejects
 * payloads larger than the cap rather than returning a quietly
 * corrupted prefix.
 * @param options - Optional injected reader (tests).
 * @returns The decoded secret with surrounding whitespace stripped.
 * @throws {@link ConfigError} - Empty or whitespace-only stdin, or a
 *   payload exceeding the cap (messages ported verbatim; out of
 *   contract).
 * @throws TypeError - Payload is not valid UTF-8 (the strict-decode
 *   `UnicodeDecodeError` twin).
 * @example
 * ```ts
 * // `echo "$SECRET" | mp account add --secret-stdin`
 * const secret = readCappedSecretFromStdin();
 * ```
 * @see mixpanel_headless._internal.io_utils.read_capped_secret_from_stdin
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
