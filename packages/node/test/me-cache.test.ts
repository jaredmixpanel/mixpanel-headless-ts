// Layer-3 translation of the MeCache classes of `tests/unit/test_me.py`
// (b8-packets.md §3.3 row 6): `TestMeCache` (:228),
// `TestMeCacheConcurrency` (:331), `TestMeCacheSymlinkRejection` (:685).
// Models (:38-227) landed at B4-C1 (`core/test/client/me.test.ts`) and
// `TestMeService` (:458) at B6 (`core/test/services/me-service.test.ts`)
// — NOT re-translated (packet row).
//
// Python's `time.sleep(1.1)` TTL probe translates to the injected `now`
// seam (no wall-clock sleeps — D1.4 discipline); the `os.chmod`
// monkeypatch translates to the injected `chmodSync` fault seam.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError } from "../../core/src/errors.js";
import { MeResponse } from "../../core/src/client/me.js";
import { MeCache, type MeCacheLogger } from "../src/me-cache.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

const POSIX = process.platform !== "win32";
const itPosix = POSIX ? it : it.skip;

const cleanups: (() => void)[] = [];
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

/** The `sample_response` fixture twin (test_me.py:244). */
function sampleResponse(): MeResponse {
  return new MeResponse({
    user_id: 42,
    user_email: "test@example.com",
    projects: {
      "3713224": { name: "AI Demo", organization_id: 100 },
    },
  });
}

/** A recording warning sink (the `caplog` twin). */
function recordingLogger(): { logger: MeCacheLogger; lines: string[] } {
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

describe("TestMeCache (test_me.py:228)", () => {
  it("test_put_and_get", () => {
    const dir = join(makeTempDir(cleanups), "accounts", "personal");
    mkdirSync(dir, { recursive: true });
    const cache = new MeCache({ accountName: "personal", storageDir: dir });
    cache.put(sampleResponse());
    const result = cache.get();
    expect(result).not.toBeNull();
    expect(result?.user_id).toBe(42);
    expect(result?.projects.get("3713224")?.name).toBe("AI Demo");
  });

  it("test_get_miss", () => {
    const dir = join(makeTempDir(cleanups), "accounts", "personal");
    mkdirSync(dir, { recursive: true });
    const cache = new MeCache({ accountName: "personal", storageDir: dir });
    expect(cache.get()).toBeNull();
  });

  it("test_ttl_expiry", () => {
    const dir = join(makeTempDir(cleanups), "accounts", "personal");
    mkdirSync(dir, { recursive: true });
    let nowSeconds = 1_000_000;
    const cache = new MeCache({
      accountName: "personal",
      storageDir: dir,
      ttlSeconds: 1,
      now: () => nowSeconds,
    });
    cache.put(sampleResponse());
    expect(cache.get()).not.toBeNull();
    nowSeconds += 1.1; // the Python `time.sleep(1.1)` twin
    expect(cache.get()).toBeNull();
  });

  it("test_invalidate", () => {
    const dir = join(makeTempDir(cleanups), "accounts", "personal");
    mkdirSync(dir, { recursive: true });
    const cache = new MeCache({ accountName: "personal", storageDir: dir });
    cache.put(sampleResponse());
    expect(cache.get()).not.toBeNull();
    cache.invalidate();
    expect(cache.get()).toBeNull();
  });

  it("test_account_name_isolates_cache", () => {
    const tmp = makeTempDir(cleanups);
    const cacheA = new MeCache({
      accountName: "alice",
      storageDir: join(tmp, "alice"),
    });
    const cacheB = new MeCache({
      accountName: "bob",
      storageDir: join(tmp, "bob"),
    });
    const responseB = new MeResponse({
      user_id: 99,
      user_email: "other@example.com",
    });
    cacheA.put(sampleResponse());
    cacheB.put(responseB);
    expect(cacheA.get()?.user_id).toBe(42);
    expect(cacheB.get()?.user_id).toBe(99);
  });

  itPosix("test_file_permissions", () => {
    const dir = join(makeTempDir(cleanups), "accounts", "personal");
    mkdirSync(dir, { recursive: true });
    const cache = new MeCache({ accountName: "personal", storageDir: dir });
    cache.put(sampleResponse());
    const cacheFile = join(dir, "me.json");
    expect(existsSync(cacheFile)).toBe(true);
    expect(statSync(cacheFile).mode & 0o7777).toBe(0o600);
  });

  it("test_corrupted_cache_returns_none", () => {
    const dir = join(makeTempDir(cleanups), "accounts", "personal");
    mkdirSync(dir, { recursive: true });
    const cacheFile = join(dir, "me.json");
    writeFileSync(cacheFile, "not valid json{{{", "utf8");
    if (POSIX) {
      chmodSync(cacheFile, 0o600);
    }
    const cache = new MeCache({ accountName: "personal", storageDir: dir });
    expect(cache.get()).toBeNull();
  });

  it("test_default_storage_dir_resolves_to_per_account_path", () => {
    const tmp = makeTempDir(cleanups);
    process.env["HOME"] = tmp;
    const cache = new MeCache({ accountName: "demo-sa" });
    expect(cache.cachePath()).toBe(
      join(tmp, ".mp", "accounts", "demo-sa", "me.json"),
    );
  });
});

describe("TestMeCacheConcurrency (test_me.py:331)", () => {
  it("test_two_writers_racing_same_cache_produce_valid_file", async () => {
    // Python's two-thread barrier race translates to two concurrent
    // async writers over the pid+counter tmp scheme (§3.3
    // disposition): each `put` derives a distinct tmp filename, so one
    // payload wins atomically and neither can land a torn file.
    const dir = join(makeTempDir(cleanups), "accounts", "personal");
    mkdirSync(dir, { recursive: true });
    const cache = new MeCache({ accountName: "personal", storageDir: dir });
    const respA = new MeResponse({ user_id: 1, user_email: "a@example.com" });
    const respB = new MeResponse({ user_id: 2, user_email: "b@example.com" });
    await Promise.all([
      Promise.resolve().then(() => {
        cache.put(respA);
      }),
      Promise.resolve().then(() => {
        cache.put(respB);
      }),
    ]);
    const result = cache.get();
    expect(result).not.toBeNull();
    expect([1, 2]).toContain(result?.user_id);
  });

  itPosix("test_chmod_failure_on_dir_raises_config_error", () => {
    const dir = join(makeTempDir(cleanups), "accounts", "personal");
    mkdirSync(dir, { recursive: true });
    const cache = new MeCache({
      accountName: "personal",
      storageDir: dir,
      chmodSync: (path: string): void => {
        if (path === dir) {
          throw Object.assign(new Error("Permission denied"), {
            code: "EACCES",
          });
        }
        chmodSync(path, 0o700);
      },
    });
    const resp = new MeResponse({ user_id: 1, user_email: "a@example.com" });
    let caught: ConfigError | null = null;
    try {
      cache.put(resp);
    } catch (exc) {
      caught = exc as ConfigError;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    // The PII rationale raise names the 0o700 requirement
    // (me.py:563-575 — packet §7 caution 12).
    expect(caught?.message).toContain("0o700");
  });
});

describe("TestMeCacheSymlinkRejection (test_me.py:685)", () => {
  itPosix("test_symlinked_cache_returns_none_and_warns", () => {
    const home = makeTempDir(cleanups);
    process.env["HOME"] = home;
    const accountDir = join(home, ".mp", "accounts", "personal");
    mkdirSync(accountDir, { recursive: true, mode: 0o700 });
    const attacker = join(home, "attacker_me.json");
    writeFileSync(attacker, JSON.stringify({ cached_at: 0 }), "utf8");
    chmodSync(attacker, 0o600);
    symlinkSync(attacker, join(accountDir, "me.json"));

    const { logger, lines } = recordingLogger();
    const cache = new MeCache({ accountName: "personal", logger });
    expect(cache.get()).toBeNull();
    expect(
      lines.some(
        (line) =>
          line.toLowerCase().includes("symlink") ||
          line.toLowerCase().includes("refusing"),
      ),
    ).toBe(true);
  });

  itPosix("test_dangling_symlink_cache_returns_none_and_warns", () => {
    const home = makeTempDir(cleanups);
    process.env["HOME"] = home;
    const accountDir = join(home, ".mp", "accounts", "personal");
    mkdirSync(accountDir, { recursive: true, mode: 0o700 });
    symlinkSync(join(home, "missing.json"), join(accountDir, "me.json"));

    const { logger, lines } = recordingLogger();
    const cache = new MeCache({ accountName: "personal", logger });
    expect(cache.get()).toBeNull();
    expect(
      lines.some(
        (line) =>
          line.toLowerCase().includes("symlink") ||
          line.toLowerCase().includes("refusing"),
      ),
    ).toBe(true);
  });
});

describe("Ordered-organizations re-hydration (packet §3.2 item 10 / §2.2 last bullet — N2 consumes N1's mechanism)", () => {
  it("out-of-ascending org keys survive the on-disk round-trip", () => {
    // The write must encode map insertion order and the read must
    // recover it through N1's lossless ordered-entries path — the
    // user-ratified org-ordering fix (user-ratifications.md:14-22).
    const dir = join(makeTempDir(cleanups), "accounts", "personal");
    mkdirSync(dir, { recursive: true });
    const orgs = new Map<string, Record<string, unknown>>([
      ["900", { id: 900, name: "Last-Id First-Org" }],
      ["100", { id: 100, name: "First-Id Second-Org" }],
    ]);
    const response = new MeResponse({
      user_id: 7,
      user_email: "o@example.com",
      organizations: orgs,
    });
    expect([...response.organizations.keys()]).toEqual(["900", "100"]);
    const cache = new MeCache({ accountName: "personal", storageDir: dir });
    cache.put(response);
    const loaded = cache.get();
    expect(loaded).not.toBeNull();
    expect([...(loaded?.organizations.keys() ?? [])]).toEqual(["900", "100"]);
  });
});

// B8-ARB-A SEM-F2c (b8-reviewA-resolution.md): Python `MeCache.get`
// catches `(json.JSONDecodeError, OSError)` + CredentialPathError only
// (`me.py:505-515`) — an invalid-UTF-8 cache file raises
// UnicodeDecodeError RAW (live CPython probe in the resolution). The
// TS twin is the TextDecoder fatal-mode TypeError, which must
// propagate rather than degrade to the corrupt-file `null`.
describe("B8-ARB-A SEM-F2c decode error-class lock", () => {
  itPosix(
    "invalid-UTF-8 me.json (0600) raises the RAW decode TypeError, not null",
    () => {
      const dir = join(makeTempDir(cleanups), "accounts", "personal");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const cache = new MeCache({ accountName: "personal", storageDir: dir });
      const path = join(dir, "me.json");
      writeFileSync(path, Buffer.from([0xff]));
      chmodSync(path, 0o600);
      expect(() => cache.get()).toThrow(TypeError);
    },
  );
});
