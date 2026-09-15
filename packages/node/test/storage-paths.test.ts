// Layer-3 translation of `tests/unit/test_storage.py` (327 lines, 15
// tests; all 5 classes covered — 13/15 members translated, 2
// Python-only members cited below — b8-packets.md §3.3 row 2; header
// wording corrected per B8-ARB-A ASR-F3, `b8-reviewA-resolution.md`).
//
// Python's `monkeypatch.setenv("HOME", ...)` isolation translates to a
// saved/restored `process.env.HOME` (node `os.homedir()` reads `$HOME`
// at call time on POSIX); every path lives under `mkdtempSync` tmp dirs
// (packet §7 caution 3 — the real-home guard in `helpers.ts`).
//
// PYTHON-ONLY members (header-cited per §3.3 / §2.1 drop):
// - `TestOAuthStorageSymlinkRejection::
//   test_check_and_fix_permissions_uses_fchmod_not_chmod` (:275) —
//   fd-flag mechanism probe (fd-flag hardening dropped per plan §4.2 /
//   R9.2); its lstat-expressible siblings are translated below.
// - `test_windows_skip_does_not_crash` (:303) — probes a
//   `monkeypatch.delattr(os, "O_NOFOLLOW")` platform shim with no node
//   analog (the TS no-op branch keys on `process.platform`) — same
//   citation.

import {
  chmodSync,
  mkdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
const itPosix = POSIX ? it : it.skip;

const cleanups: Array<() => void> = [];
let restoreEnv: () => void = () => undefined;
let savedHome: string | undefined;

beforeEach(() => {
  restoreEnv = scrubMpEnv();
  savedHome = process.env["HOME"];
});

afterEach(() => {
  if (savedHome === undefined) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = savedHome;
  }
  restoreEnv();
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

describe("TestAccountDirNameValidation (test_storage.py:26)", () => {
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
    "test_account_dir_rejects_invalid_names[%s]",
    (_label, name) => {
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

  it.each(valid.map((name) => [name]))(
    "test_account_dir_accepts_valid_names[%s]",
    (name) => {
      const tmp = makeTempDir(cleanups);
      process.env["MP_OAUTH_STORAGE_DIR"] = tmp;
      expect(accountDir(name)).toBe(join(tmp, "accounts", name));
    },
  );
});

describe("TestStorageRoot (test_storage.py:76)", () => {
  it("test_env_var_overrides_default", () => {
    const tmp = makeTempDir(cleanups);
    process.env["MP_OAUTH_STORAGE_DIR"] = tmp;
    expect(storageRoot()).toBe(tmp);
  });

  it("test_default_is_home_dot_mp", () => {
    const tmp = makeTempDir(cleanups);
    delete process.env["MP_OAUTH_STORAGE_DIR"];
    process.env["HOME"] = tmp;
    expect(storageRoot()).toBe(join(tmp, ".mp"));
  });

  it("test_resolves_lazily", () => {
    const tmp = makeTempDir(cleanups);
    delete process.env["MP_OAUTH_STORAGE_DIR"];
    process.env["HOME"] = tmp;
    const first = storageRoot();
    process.env["MP_OAUTH_STORAGE_DIR"] = join(tmp, "alt");
    const second = storageRoot();
    expect(first).not.toBe(second);
    expect(second).toBe(join(tmp, "alt"));
  });
});

describe("TestAccountDirHonorsStorageRoot (test_storage.py:107)", () => {
  it("test_account_dir_under_env_var_root", () => {
    const tmp = makeTempDir(cleanups);
    process.env["MP_OAUTH_STORAGE_DIR"] = join(tmp, "root");
    expect(accountDir("foo")).toBe(join(tmp, "root", "accounts", "foo"));
  });

  it("test_account_dir_default_under_home_dot_mp", () => {
    const tmp = makeTempDir(cleanups);
    delete process.env["MP_OAUTH_STORAGE_DIR"];
    process.env["HOME"] = tmp;
    expect(accountDir("foo")).toBe(join(tmp, ".mp", "accounts", "foo"));
  });
});

describe("TestEnsureAccountDir (test_storage.py:126)", () => {
  itPosix("test_creates_with_mode_0o700", () => {
    const tmp = makeTempDir(cleanups);
    process.env["MP_OAUTH_STORAGE_DIR"] = tmp;
    const path = ensureAccountDir("foo");
    const st = statSync(path);
    expect(st.isDirectory()).toBe(true);
    expect(st.mode & 0o7777).toBe(0o700);
  });

  it("test_idempotent", () => {
    const tmp = makeTempDir(cleanups);
    process.env["MP_OAUTH_STORAGE_DIR"] = tmp;
    ensureAccountDir("foo");
    const path = ensureAccountDir("foo");
    expect(statSync(path).isDirectory()).toBe(true);
  });

  it("test_rejects_invalid_name", () => {
    const tmp = makeTempDir(cleanups);
    process.env["MP_OAUTH_STORAGE_DIR"] = tmp;
    expect(() => ensureAccountDir("../etc")).toThrow(ParamValidationError);
  });
});

describe("TestOAuthStorageSymlinkRejection (test_storage.py:158)", () => {
  itPosix("test_read_symlinked_tokens_returns_none_and_warns", () => {
    const tmp = makeTempDir(cleanups);
    process.env["MP_OAUTH_STORAGE_DIR"] = tmp;
    const attacker = join(tmp, "attacker.json");
    mkdirSync(tmp, { recursive: true });
    writeFileSync(attacker, '{"access_token":"stolen"}', { encoding: "utf8" });
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
  });

  itPosix(
    "test_check_and_fix_permissions_does_not_chmod_through_symlink",
    () => {
      const tmp = makeTempDir(cleanups);
      process.env["MP_OAUTH_STORAGE_DIR"] = tmp;
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

  itPosix("test_dangling_symlink_returns_none_and_warns", () => {
    const tmp = makeTempDir(cleanups);
    process.env["MP_OAUTH_STORAGE_DIR"] = tmp;
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
  });

  // PYTHON-ONLY (fd-flag hardening dropped, plan §4.2 / packet §2.1):
  // test_check_and_fix_permissions_uses_fchmod_not_chmod (:275) — the
  // Path.chmod-patch probe asserts the fchmod-on-fd mechanism itself.
  // The lstat-substituted TS repair path IS Path.chmod-shaped by
  // design; the observable repair behavior is locked in
  // auth-storage.test.ts (TestOAuthStorageSecurityHardening).
  //
  // PYTHON-ONLY: test_windows_skip_does_not_crash (:303) — probes a
  // `delattr(os, "O_NOFOLLOW")` shim; the TS twin's Windows no-op keys
  // on `process.platform` and has no removable attribute to probe.
});
