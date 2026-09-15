// Layer-3 translation of `tests/unit/test_io_utils.py` (803 lines, 48
// tests) — b8-packets.md §2.3 row 1.
//
// Per-class dispositions (packet §2.3; PYTHON-ONLY exclusions cite plan
// §2.2 non-portable remainder + the R9.2 fd-flag-hardening drop,
// b8-packets.md §2.1 io_utils row):
//
// - TestAtomicWriteBytes :89           → translated below.
// - TestAtomicWriteResilience :210     → translated below (fault injection
//   via the `fsOps` seam — the `unittest.mock.patch("...os.replace")` twin;
//   the concurrent-writers case is re-expressed over the pid+counter tmp
//   scheme because JS has no OS threads in the main thread, packet §2.2).
// - TestCredentialPathError :324       → re-expressed against the coded
//   `MixpanelHeadlessError` twin (packet §2.2: OSError lineage carried in
//   `details`; call sites catch the class instead of `except OSError`).
// - TestReadCredentialBytes :346       → translated below. The two fd-leak
//   probes (:441, :463) are re-expressed as 200-rejection loops (the
//   lstat/readFileSync substitution never hand-manages fds; a leak would
//   surface as EMFILE inside the loop).
// - TestReadCredentialText :477        → translated below (invalid UTF-8
//   raises the TextDecoder `TypeError` — the `UnicodeDecodeError` twin).
// - TestRejectIfSymlink :504           → translated below.
// - TestOpenCredentialFdFlags :546     → PYTHON-ONLY (O_CLOEXEC/O_NOFOLLOW
//   fd flags; plan §2.2 + R9.2 drop, b8-packets.md §2.3).
// - TestNonRegularFileRejection :587   → SPLIT (packet §2.3): the
//   stat-based refusal is covered via a directory-as-path case; the
//   FIFO / character-device cases are PYTHON-ONLY (no `mkfifo` /
//   `mknod` in node:fs; the lstat-based port rejects before open).
// - TestSizeCap :647                   → translated below.
// - TestDirfdWalk :674                 → PYTHON-ONLY (dirfd-walk
//   hardening — the dropped `_open_credential_fd` layer, plan §2.2).
// - TestReadCappedSecretFromStdin :769 → translated below (injectable
//   read seam — the `sys.stdin.buffer` BytesIO stub twin).

import {
  chmodSync,
  mkdirSync,
  // Delegating open used by the counter-learning spies below.
  openSync as statSyncOpen,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ConfigError,
  MixpanelHeadlessError,
  ParamValidationError,
} from "@mixpanel-headless/core";

import {
  atomicWriteBytes,
  type AtomicWriteFsOps,
  CredentialPathError,
  MAX_CREDENTIAL_BYTES,
  readCappedSecretFromStdin,
  readCredentialBytes,
  readCredentialText,
  rejectIfSymlink,
  SECRET_STDIN_MAX_BYTES,
} from "../src/io-utils.js";
import { expectPosixMode, makeTempDir } from "./helpers.js";

const POSIX = process.platform !== "win32";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/** Return leftover `<name>.tmp.*` siblings of `target` (test_io_utils.py:77). */
function tmpGlob(dir: string, name: string): string[] {
  return readdirSync(dir)
    .filter((entry) => entry.startsWith(`${name}.tmp.`))
    .sort();
}

/** Write `data` at `path` and chmod 0o600 (`_write_owner_only`, :309). */
function writeOwnerOnly(path: string, data: Uint8Array | string): string {
  writeFileSync(path, data);
  if (POSIX) {
    chmodSync(path, 0o600);
  }
  return path;
}

/** File mode bits (POSIX). */
function fileMode(path: string): number {
  return statSync(path).mode & 0o7777;
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("TestAtomicWriteBytes", () => {
  it("test_writes_bytes_with_default_mode", () => {
    const dir = makeTempDir(cleanups);
    const target = join(dir, "config.toml");
    atomicWriteBytes(target, utf8("hello world"));
    expect(readFileSync(target, "utf8")).toBe("hello world");
    expectPosixMode(target, 0o600);
  });

  it.skipIf(!POSIX)("test_writes_bytes_with_owner_only_mode", () => {
    const dir = makeTempDir(cleanups);
    const target = join(dir, "config.toml");
    atomicWriteBytes(target, utf8("x"), { mode: 0o400 });
    expect(fileMode(target)).toBe(0o400);
  });

  it.each([0o644, 0o660, 0o604, 0o666, 0o777])(
    "test_rejects_group_or_world_bits (mode %s)",
    (badMode) => {
      const dir = makeTempDir(cleanups);
      const target = join(dir, "config.toml");
      // Python raises bare ValueError; the TS twin is the existing
      // ParamValidationError / VALIDATION_ERROR (R5 codes-not-messages,
      // packet §2.2 — no new code minted).
      expect(() =>
        atomicWriteBytes(target, utf8("x"), { mode: badMode }),
      ).toThrow(ParamValidationError);
      expect(() =>
        atomicWriteBytes(target, utf8("x"), { mode: badMode }),
      ).toThrow(/group\/world access/);
      // The guard fires BEFORE any FS touch (caution #11).
      expect(readdirSync(dir)).toStrictEqual([]);
    },
  );

  it("test_replaces_existing_file_atomically", () => {
    const dir = makeTempDir(cleanups);
    const target = join(dir, "config.toml");
    writeFileSync(target, "old");
    atomicWriteBytes(target, utf8("new"));
    expect(readFileSync(target, "utf8")).toBe("new");
  });

  it("test_no_tmp_file_left_after_success", () => {
    const dir = makeTempDir(cleanups);
    const target = join(dir, "config.toml");
    atomicWriteBytes(target, utf8("x"));
    expect(tmpGlob(dir, "config.toml")).toStrictEqual([]);
  });

  it("test_no_tmp_file_left_after_replace_failure", () => {
    const dir = makeTempDir(cleanups);
    const target = join(dir, "config.toml");
    const fsOps: Partial<AtomicWriteFsOps> = {
      renameSync: () => {
        throw new Error("simulated");
      },
    };
    expect(() => atomicWriteBytes(target, utf8("x"), { fsOps })).toThrow(
      "simulated",
    );
    expect(tmpGlob(dir, "config.toml")).toStrictEqual([]);
    expect(readdirSync(dir)).toStrictEqual([]);
  });

  it("test_failure_preserves_existing_file", () => {
    const dir = makeTempDir(cleanups);
    const target = join(dir, "config.toml");
    writeFileSync(target, "original");
    const fsOps: Partial<AtomicWriteFsOps> = {
      renameSync: () => {
        throw new Error("simulated");
      },
    };
    expect(() => atomicWriteBytes(target, utf8("new"), { fsOps })).toThrow(
      "simulated",
    );
    expect(readFileSync(target, "utf8")).toBe("original");
    expect(tmpGlob(dir, "config.toml")).toStrictEqual([]);
  });

  it.skipIf(!POSIX)("test_replacing_existing_resets_mode", () => {
    const dir = makeTempDir(cleanups);
    const target = join(dir, "config.toml");
    writeFileSync(target, "old");
    chmodSync(target, 0o644);
    atomicWriteBytes(target, utf8("new"));
    expect(fileMode(target)).toBe(0o600);
  });

  it("test_excl_collision_does_not_touch_target", () => {
    // Python pre-places `<name>.tmp.<pid>.<tid>`. The TS tmp name embeds
    // pid + a monotonically increasing per-process counter (packet §2.2
    // substitution: JS has no OS thread id in the main thread), so the
    // test learns the counter from a delegating spy, then pre-places the
    // NEXT tmp path. On EEXIST the pre-existing (foreign) tmp survives —
    // only our own cleanup path unlinks (caution #10).
    const dir = makeTempDir(cleanups);
    const target = join(dir, "config.toml");
    writeFileSync(target, "original");

    const seen: string[] = [];
    atomicWriteBytes(join(dir, "probe"), utf8("p"), {
      fsOps: {
        openSync: (path, flags, mode) => {
          seen.push(path);
          return statSyncOpen(path, flags, mode);
        },
      },
    });
    const probeTmp = seen[0]!;
    const counter = Number(probeTmp.split(".").pop());
    const staleTmp = join(dir, `config.toml.tmp.${process.pid}.${counter + 1}`);
    writeFileSync(staleTmp, "stale");

    let error: unknown;
    try {
      atomicWriteBytes(target, utf8("new"));
    } catch (error_) {
      error = error_;
    }
    expect((error as NodeJS.ErrnoException).code).toBe("EEXIST");
    expect(readFileSync(target, "utf8")).toBe("original");
    // The FOREIGN stale tmp is left in place (Python leaves it too).
    expect(readFileSync(staleTmp, "utf8")).toBe("stale");
  });

  it("test_writes_empty_bytes", () => {
    const dir = makeTempDir(cleanups);
    const target = join(dir, "empty.toml");
    atomicWriteBytes(target, new Uint8Array(0));
    expect(readFileSync(target)).toHaveLength(0);
  });

  it("test_missing_parent_directory_raises", () => {
    const dir = makeTempDir(cleanups);
    const target = join(dir, "nonexistent", "config.toml");
    let error: unknown;
    try {
      atomicWriteBytes(target, utf8("x"));
    } catch (error_) {
      error = error_;
    }
    expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
    expect(readdirSync(dir)).toStrictEqual([]);
  });
});

describe("TestAtomicWriteResilience", () => {
  it("test_simulated_kill_between_write_and_replace_preserves_old", () => {
    const dir = makeTempDir(cleanups);
    const target = join(dir, "config.toml");
    writeFileSync(target, "OLD_CONTENT");
    // Python patches os.replace to raise KeyboardInterrupt; the seam
    // twin throws from renameSync. The `except BaseException` cleanup
    // must still unlink the tmp and preserve the prior content.
    const fsOps: Partial<AtomicWriteFsOps> = {
      renameSync: () => {
        throw new Error("simulated SIGKILL");
      },
    };
    expect(() =>
      atomicWriteBytes(target, utf8("NEW_CONTENT"), { fsOps }),
    ).toThrow("simulated SIGKILL");
    expect(readFileSync(target, "utf8")).toBe("OLD_CONTENT");
    expect(tmpGlob(dir, "config.toml")).toStrictEqual([]);
  });

  it("test_simulated_kill_during_write_preserves_old", () => {
    const dir = makeTempDir(cleanups);
    const target = join(dir, "config.toml");
    writeFileSync(target, "OLD_CONTENT");
    const fsOps: Partial<AtomicWriteFsOps> = {
      writeSync: () => {
        throw new Error("disk full");
      },
    };
    expect(() =>
      atomicWriteBytes(target, utf8("NEW_CONTENT"), { fsOps }),
    ).toThrow("disk full");
    expect(readFileSync(target, "utf8")).toBe("OLD_CONTENT");
    expect(tmpGlob(dir, "config.toml")).toStrictEqual([]);
  });

  it("test_concurrent_writes_use_distinct_tmp_paths", () => {
    // Python runs two OS threads; JS is single-threaded in the main
    // thread, so the port asserts the collision-avoidance MECHANISM:
    // consecutive writes to the same target pick distinct tmp paths
    // (pid+counter), both succeed, and no tmp leaks (packet §2.2).
    const dir = makeTempDir(cleanups);
    const target = join(dir, "config.toml");
    const seen: string[] = [];
    const spy: Partial<AtomicWriteFsOps> = {
      openSync: (path, flags, mode) => {
        seen.push(path);
        return statSyncOpen(path, flags, mode);
      },
    };
    atomicWriteBytes(target, utf8("A".repeat(1024)), { fsOps: spy });
    atomicWriteBytes(target, utf8("B".repeat(1024)), { fsOps: spy });
    expect(new Set(seen).size).toBe(2);
    const final = readFileSync(target, "utf8");
    expect(final === "A".repeat(1024) || final === "B".repeat(1024)).toBe(true);
    expect(tmpGlob(dir, "config.toml")).toStrictEqual([]);
  });
});

describe("TestCredentialPathError", () => {
  it("test_is_mixpanel_headless_error_subclass", () => {
    // Re-expression of test_is_oserror_subclass (:327), header-cited:
    // Python call sites catch `OSError`; the TS call sites catch the
    // coded MixpanelHeadlessError lineage instead (packet §2.2 —
    // symlink-attack rejections must never escape the domain wrappers).
    expect(
      new CredentialPathError(40, "symlink rejected", "/tmp/foo"),
    ).toBeInstanceOf(MixpanelHeadlessError);
  });

  it("test_carries_errno_and_path", () => {
    const exc = new CredentialPathError(40, "symlink rejected", "/tmp/foo");
    expect(exc.errno).toBe(40);
    expect(exc.filename).toBe("/tmp/foo");
    expect(String(exc)).toContain("symlink rejected");
    // The OSError lineage rides in `details` (packet §2.2).
    expect(exc.details["errno"]).toBe(40);
    expect(exc.details["filename"]).toBe("/tmp/foo");
  });
});

describe("TestReadCredentialBytes", () => {
  it("test_reads_plain_owner_only_file", () => {
    const dir = makeTempDir(cleanups);
    const target = writeOwnerOnly(join(dir, "creds.json"), '{"k":"v"}');
    expect(new TextDecoder().decode(readCredentialBytes(target))).toBe(
      '{"k":"v"}',
    );
  });

  it("test_reads_empty_file", () => {
    const dir = makeTempDir(cleanups);
    const target = writeOwnerOnly(join(dir, "empty"), "");
    expect(readCredentialBytes(target)).toHaveLength(0);
  });

  it.skipIf(!POSIX)("test_rejects_symlink_to_attacker_file", () => {
    const dir = makeTempDir(cleanups);
    const attacker = writeOwnerOnly(
      join(dir, "attacker.json"),
      '{"stolen":"data"}',
    );
    const link = join(dir, "creds.json");
    symlinkSync(attacker, link);
    expect(() => readCredentialBytes(link)).toThrow(CredentialPathError);
    expect(() => readCredentialBytes(link)).toThrow(/symlink/);
  });

  it.skipIf(!POSIX)("test_rejects_symlink_to_legitimate_owned_file", () => {
    const dir = makeTempDir(cleanups);
    const legit = writeOwnerOnly(join(dir, "legit.json"), '{"k":"v"}');
    expect(fileMode(legit)).toBe(0o600);
    const link = join(dir, "creds.json");
    symlinkSync(legit, link);
    expect(() => readCredentialBytes(link)).toThrow(/symlink/);
  });

  it.skipIf(!POSIX)("test_rejects_dangling_symlink", () => {
    const dir = makeTempDir(cleanups);
    const link = join(dir, "creds.json");
    symlinkSync(join(dir, "nonexistent.json"), link);
    // CredentialPathError, NOT the ENOENT twin — the symlink check
    // fires before any target-existence lookup.
    expect(() => readCredentialBytes(link)).toThrow(CredentialPathError);
    expect(() => readCredentialBytes(link)).toThrow(/symlink/);
  });

  it.skipIf(!POSIX)("test_rejects_lax_mode", () => {
    for (const badMode of [0o640, 0o660, 0o604, 0o644, 0o666, 0o777]) {
      const dir = makeTempDir(cleanups);
      const target = join(dir, "creds.json");
      writeFileSync(target, "x");
      chmodSync(target, badMode);
      expect(() => readCredentialBytes(target)).toThrow(CredentialPathError);
      expect(() => readCredentialBytes(target)).toThrow(/mode/);
    }
  });

  it.skipIf(!POSIX)("test_accepts_owner_only_modes", () => {
    for (const goodMode of [0o400, 0o600]) {
      const dir = makeTempDir(cleanups);
      const target = join(dir, "creds.json");
      writeFileSync(target, "ok");
      chmodSync(target, goodMode);
      expect(new TextDecoder().decode(readCredentialBytes(target))).toBe("ok");
    }
  });

  it("test_propagates_filenotfound", () => {
    const dir = makeTempDir(cleanups);
    let error: unknown;
    try {
      readCredentialBytes(join(dir, "does-not-exist.json"));
    } catch (error_) {
      error = error_;
    }
    // ENOENT (the FileNotFoundError twin), NOT CredentialPathError.
    expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
    expect(error).not.toBeInstanceOf(CredentialPathError);
  });

  it.skipIf(!POSIX)("test_no_fd_leak_on_symlink_rejection", () => {
    // Re-expression (header note): the lstat-based port opens no fd
    // before rejection; 200 rejections must keep raising
    // CredentialPathError — a leak would surface as EMFILE here.
    const dir = makeTempDir(cleanups);
    const link = join(dir, "creds.json");
    symlinkSync(join(dir, "nonexistent.json"), link);
    for (let i = 0; i < 200; i += 1) {
      expect(() => readCredentialBytes(link)).toThrow(CredentialPathError);
    }
  });

  it.skipIf(!POSIX)("test_no_fd_leak_on_mode_rejection", () => {
    const dir = makeTempDir(cleanups);
    const target = join(dir, "creds.json");
    writeFileSync(target, "x");
    chmodSync(target, 0o644);
    for (let i = 0; i < 200; i += 1) {
      expect(() => readCredentialBytes(target)).toThrow(CredentialPathError);
    }
  });
});

describe("TestNonRegularFileRejection", () => {
  // SPLIT disposition (packet §2.3): FIFO / character-device cases are
  // PYTHON-ONLY (node:fs has no mkfifo/mknod; the lstat-based port
  // rejects non-regular files BEFORE any open, so the hang threat the
  // Python O_NONBLOCK machinery addresses cannot occur). The stat-based
  // refusal branch is locked via a directory at the credential path.
  it.skipIf(!POSIX)("test_rejects_directory_via_stat_check", () => {
    const dir = makeTempDir(cleanups);
    const target = join(dir, "creds.json");
    mkdirSync(target, { mode: 0o700 });
    expect(() => readCredentialBytes(target)).toThrow(CredentialPathError);
    expect(() => readCredentialBytes(target)).toThrow(/regular file/);
  });
});

describe("TestReadCredentialText", () => {
  it("test_reads_utf8", () => {
    const dir = makeTempDir(cleanups);
    const target = writeOwnerOnly(join(dir, "creds.toml"), utf8("café"));
    expect(readCredentialText(target)).toBe("café");
  });

  it("test_rejects_invalid_utf8", () => {
    const dir = makeTempDir(cleanups);
    const target = writeOwnerOnly(
      join(dir, "creds.toml"),
      new Uint8Array([0xff, 0xfe, 0xfd]),
    );
    // TextDecoder(fatal) TypeError — the UnicodeDecodeError twin
    // (header note; Python call sites catch it separately from OSError).
    expect(() => readCredentialText(target)).toThrow(TypeError);
  });

  it.skipIf(!POSIX)("test_rejects_symlink_same_as_bytes_variant", () => {
    const dir = makeTempDir(cleanups);
    const target = writeOwnerOnly(join(dir, "real.toml"), "x = 1");
    const link = join(dir, "creds.toml");
    symlinkSync(target, link);
    expect(() => readCredentialText(link)).toThrow(/symlink/);
  });
});

describe("TestRejectIfSymlink", () => {
  it.skipIf(!POSIX)("test_live_symlink_raises", () => {
    const dir = makeTempDir(cleanups);
    const target = writeOwnerOnly(join(dir, "real.json"), "x");
    const link = join(dir, "creds.json");
    symlinkSync(target, link);
    expect(() => rejectIfSymlink(link)).toThrow(CredentialPathError);
    expect(() => rejectIfSymlink(link)).toThrow(/symlink/);
  });

  it.skipIf(!POSIX)("test_dangling_symlink_raises", () => {
    const dir = makeTempDir(cleanups);
    const link = join(dir, "creds.json");
    symlinkSync(join(dir, "missing.json"), link);
    expect(() => rejectIfSymlink(link)).toThrow(CredentialPathError);
  });

  it("test_regular_file_is_noop", () => {
    const dir = makeTempDir(cleanups);
    const target = writeOwnerOnly(join(dir, "creds.json"), "x");
    expect(() => rejectIfSymlink(target)).not.toThrow();
  });

  it("test_missing_path_is_noop", () => {
    const dir = makeTempDir(cleanups);
    expect(() => rejectIfSymlink(join(dir, "nothing-here.json"))).not.toThrow();
  });
});

describe("TestSizeCap", () => {
  it.skipIf(!POSIX)("test_accepts_at_cap", () => {
    const dir = makeTempDir(cleanups);
    const target = writeOwnerOnly(
      join(dir, "creds"),
      new Uint8Array(MAX_CREDENTIAL_BYTES).fill(0x41),
    );
    expect(readCredentialBytes(target)).toHaveLength(MAX_CREDENTIAL_BYTES);
  });

  it.skipIf(!POSIX)("test_rejects_over_cap", () => {
    const dir = makeTempDir(cleanups);
    const target = writeOwnerOnly(
      join(dir, "creds"),
      new Uint8Array(MAX_CREDENTIAL_BYTES + 1).fill(0x41),
    );
    expect(() => readCredentialBytes(target)).toThrow(CredentialPathError);
    expect(() => readCredentialBytes(target)).toThrow(
      /size|too large|EFBIG|cap/,
    );
  });

  it("test_cap_is_sane_value", () => {
    expect(MAX_CREDENTIAL_BYTES).toBe(1 << 20);
  });
});

/**
 * Build a read seam over an in-memory payload (the `_stub_stdin`
 * BytesIO twin, test_io_utils.py:757).
 *
 * @param payload - The bytes "piped" to stdin.
 * @returns A readSync-shaped chunk reader.
 */
function stubStdin(payload: Uint8Array): (buffer: Uint8Array) => number {
  let offset = 0;
  return (buffer: Uint8Array): number => {
    const n = Math.min(buffer.length, payload.length - offset);
    buffer.set(payload.subarray(offset, offset + n));
    offset += n;
    return n;
  };
}

describe("TestReadCappedSecretFromStdin", () => {
  it("test_returns_stripped_value", () => {
    const readSync = stubStdin(utf8("  s3cret-value\n"));
    expect(readCappedSecretFromStdin({ readSync })).toBe("s3cret-value");
  });

  it("test_accepts_payload_at_cap", () => {
    const readSync = stubStdin(
      new Uint8Array(SECRET_STDIN_MAX_BYTES).fill(0x41),
    );
    expect(readCappedSecretFromStdin({ readSync })).toHaveLength(
      SECRET_STDIN_MAX_BYTES,
    );
  });

  it("test_rejects_payload_over_cap", () => {
    const readSync = stubStdin(
      new Uint8Array(SECRET_STDIN_MAX_BYTES + 1).fill(0x41),
    );
    let error: unknown;
    try {
      readCappedSecretFromStdin({ readSync });
    } catch (error_) {
      error = error_;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).message).toContain(
      String(SECRET_STDIN_MAX_BYTES),
    );
    expect((error as ConfigError).message).toContain("key bundle");
  });

  it("test_rejects_empty_stdin", () => {
    const readSync = stubStdin(new Uint8Array(0));
    let error: unknown;
    try {
      readCappedSecretFromStdin({ readSync });
    } catch (error_) {
      error = error_;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).message.toLowerCase()).toContain("empty");
  });

  it("test_rejects_whitespace_only", () => {
    const readSync = stubStdin(utf8("   \n\t\n"));
    expect(() => readCappedSecretFromStdin({ readSync })).toThrow(ConfigError);
  });
});
