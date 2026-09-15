// storageRoot / accountDir / ensureAccountDir and OAuthStorage symlink
// rejection. Mirrors tests/unit/test_storage.py; the two fd-flag members
// (`test_check_and_fix_permissions_uses_fchmod_not_chmod`,
// `test_windows_skip_does_not_crash`) probe mechanisms node has no analogue
// for and are not ported.

import {
  chmodSync,
  mkdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ParamValidationError } from "@mixpanel-headless/core";

import {
  accountDir,
  ensureAccountDir,
  OAuthStorage,
  type StorageLogger,
  storageRoot,
} from "../src/auth/storage.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

const POSIX = process.platform !== "win32";

const cleanups: Array<() => void> = [];

beforeEach(() => {
  scrubMpEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/** A recording warning sink (the `caplog` twin). */
function recordingLogger(): { logger: StorageLogger; lines: string[] } {
  const lines: string[] = [];
  return {
    logger: {
      warning: (msg: string): void => {
        lines.push(msg);
      },
      debug: (): void => undefined,
    },
    lines,
  };
}

describe("accountDir name validation", () => {
  // python: test_storage.py::TestAccountDirNameValidation
  const malicious = [
    "../etc",
    "a/b",
    "a\x00b",
    "..",
    ".",
    "name with space",
    "",
    "/absolute",
    "../../escape",
    "name/with/slashes",
    "tab\there",
    "newline\nhere",
    "name?",
    "name*glob",
    "x".repeat(65),
  ];

  it.each(malicious.map((name) => [JSON.stringify(name), name]))(
    "rejects %s",
    (_label, name) => {
      // python: test_account_dir_rejects_invalid_names
      expect(() => accountDir(name)).toThrow(ParamValidationError);
    },
  );

  const valid = [
    "team",
    "personal",
    "user-name",
    "user_name",
    "abc123",
    "a",
    "X".repeat(64),
    "MIXED_Case-123",
  ];

  it.each(valid.map((name) => [name]))("accepts %s", (name) => {
    // python: test_account_dir_accepts_valid_names
    const tmp = makeTempDir(cleanups);
    vi.stubEnv("MP_OAUTH_STORAGE_DIR", tmp);
    expect(accountDir(name)).toBe(join(tmp, "accounts", name));
  });
});

describe("storageRoot", () => {
  // python: test_storage.py::TestStorageRoot
  it("MP_OAUTH_STORAGE_DIR overrides the default", () => {
    // python: test_env_var_overrides_default
    const tmp = makeTempDir(cleanups);
    vi.stubEnv("MP_OAUTH_STORAGE_DIR", tmp);
    expect(storageRoot()).toBe(tmp);
  });

  it("defaults to ~/.mp", () => {
    // python: test_default_is_home_dot_mp
    const tmp = makeTempDir(cleanups);
    vi.stubEnv("MP_OAUTH_STORAGE_DIR", undefined);
    vi.stubEnv("HOME", tmp);
    expect(storageRoot()).toBe(join(tmp, ".mp"));
  });

  it("resolves on every call", () => {
    // python: test_resolves_lazily
    const tmp = makeTempDir(cleanups);
    vi.stubEnv("MP_OAUTH_STORAGE_DIR", undefined);
    vi.stubEnv("HOME", tmp);
    const first = storageRoot();
    vi.stubEnv("MP_OAUTH_STORAGE_DIR", join(tmp, "alt"));
    const second = storageRoot();
    expect(first).not.toBe(second);
    expect(second).toBe(join(tmp, "alt"));
  });
});

describe("accountDir under the storage root", () => {
  // python: test_storage.py::TestAccountDirHonorsStorageRoot
  it("lives under the MP_OAUTH_STORAGE_DIR root", () => {
    // python: test_account_dir_under_env_var_root
    const tmp = makeTempDir(cleanups);
    vi.stubEnv("MP_OAUTH_STORAGE_DIR", join(tmp, "root"));
    expect(accountDir("foo")).toBe(join(tmp, "root", "accounts", "foo"));
  });

  it("defaults to ~/.mp/accounts/<name>", () => {
    // python: test_account_dir_default_under_home_dot_mp
    const tmp = makeTempDir(cleanups);
    vi.stubEnv("MP_OAUTH_STORAGE_DIR", undefined);
    vi.stubEnv("HOME", tmp);
    expect(accountDir("foo")).toBe(join(tmp, ".mp", "accounts", "foo"));
  });
});

describe("ensureAccountDir", () => {
  // python: test_storage.py::TestEnsureAccountDir
  it.skipIf(!POSIX)("creates the directory 0o700", () => {
    // python: test_creates_with_mode_0o700
    const tmp = makeTempDir(cleanups);
    vi.stubEnv("MP_OAUTH_STORAGE_DIR", tmp);
    const path = ensureAccountDir("foo");
    const st = statSync(path);
    expect(st.isDirectory()).toBe(true);
    expect(st.mode & 0o7777).toBe(0o700);
  });

  it("is idempotent", () => {
    // python: test_idempotent
    const tmp = makeTempDir(cleanups);
    vi.stubEnv("MP_OAUTH_STORAGE_DIR", tmp);
    ensureAccountDir("foo");
    const path = ensureAccountDir("foo");
    expect(statSync(path).isDirectory()).toBe(true);
  });

  it("rejects an invalid account name", () => {
    // python: test_rejects_invalid_name
    const tmp = makeTempDir(cleanups);
    vi.stubEnv("MP_OAUTH_STORAGE_DIR", tmp);
    expect(() => ensureAccountDir("../etc")).toThrow(ParamValidationError);
  });
});

describe("OAuthStorage symlink rejection", () => {
  // python: test_storage.py::TestOAuthStorageSymlinkRejection
  it.skipIf(!POSIX)(
    "loadTokens returns null and warns for a symlinked tokens file",
    () => {
      // python: test_read_symlinked_tokens_returns_none_and_warns
      const tmp = makeTempDir(cleanups);
      vi.stubEnv("MP_OAUTH_STORAGE_DIR", tmp);
      const attacker = join(tmp, "attacker.json");
      mkdirSync(tmp, { recursive: true });
      writeFileSync(attacker, '{"access_token":"stolen"}', {
        encoding: "utf8",
      });
      chmodSync(attacker, 0o600);
      const { logger, lines } = recordingLogger();
      const storage = new OAuthStorage({ logger });
      storage.ensureDir();
      const target = storage.tokensPath("us");
      symlinkSync(attacker, target);

      expect(storage.loadTokens("us")).toBeNull();
      expect(
        lines.some(
          (line) =>
            line.toLowerCase().includes("symlink") ||
            line.toLowerCase().includes("refusing"),
        ),
      ).toBe(true);
    },
  );

  it.skipIf(!POSIX)(
    "does not chmod through a symlink when fixing permissions",
    () => {
      // python: test_check_and_fix_permissions_does_not_chmod_through_symlink
      const tmp = makeTempDir(cleanups);
      vi.stubEnv("MP_OAUTH_STORAGE_DIR", tmp);
      const attacker = join(tmp, "attacker.json");
      writeFileSync(attacker, "x", { encoding: "utf8" });
      chmodSync(attacker, 0o644);
      expect(statSync(attacker).mode & 0o7777).toBe(0o644);

      const storage = new OAuthStorage();
      storage.ensureDir();
      const target = storage.tokensPath("us");
      symlinkSync(attacker, target);

      storage.checkAndFixPermissions(target);
      // Target file mode unchanged — no chmod side effect via the symlink.
      expect(statSync(attacker).mode & 0o7777).toBe(0o644);
    },
  );

  it.skipIf(!POSIX)(
    "loadTokens returns null and warns for a dangling symlink",
    () => {
      // python: test_dangling_symlink_returns_none_and_warns
      const tmp = makeTempDir(cleanups);
      vi.stubEnv("MP_OAUTH_STORAGE_DIR", tmp);
      const { logger, lines } = recordingLogger();
      const storage = new OAuthStorage({ logger });
      storage.ensureDir();
      const target = storage.tokensPath("us");
      symlinkSync(join(tmp, "missing.json"), target);

      expect(storage.loadTokens("us")).toBeNull();
      expect(
        lines.some(
          (line) =>
            line.toLowerCase().includes("symlink") ||
            line.toLowerCase().includes("refusing"),
        ),
      ).toBe(true);
    },
  );

  // Python-only (fd-flag hardening is not ported):
  // test_check_and_fix_permissions_uses_fchmod_not_chmod — the
  // Path.chmod-patch probe asserts the fchmod-on-fd mechanism itself.
  // The lstat-substituted TS repair path IS Path.chmod-shaped by
  // design; the observable repair behavior is locked in
  // auth-storage.test.ts (TestOAuthStorageSecurityHardening).
  //
  // Python-only: test_windows_skip_does_not_crash — probes a
  // `delattr(os, "O_NOFOLLOW")` shim; the TS twin's Windows no-op keys
  // on `process.platform` and has no removable attribute to probe.
});
