// Layer-3 translation of `tests/unit/test_auth_storage.py` (855 lines,
// 48 tests; ALL 12 classes — b8-packets.md §3.3 row 1). The Python
// `temp_dir` fixture translates to `makeTempDir` (packet §7 caution 3).
//
// Class-level notes:
// - `TestOAuthStorageSecurityHardening` (:87): the lstat/stat-
//   expressible subset translates; no `O_*`-flag-specific assert exists
//   in this class, so all 8 members are translated (the fd-flag members
//   live in test_storage.py and are excluded THERE — packet §2.1 drop).
// - `TestOAuthStorageConcurrency` (:748): Python threads translate to
//   interleaved sequential writers over the pid+counter tmp scheme plus
//   a concurrent async race (§3.3 disposition) — JS has no in-process
//   preemption for sync FS calls, so the "no torn write" contract is
//   exercised by racing async tasks over the same storage instance.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ParamValidationError,
  Secret,
  OAuthTokens,
  type OAuthClientInfo,
} from "@mixpanel-headless/core";
import { OAuthStorage } from "../src/auth/storage.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

const POSIX = process.platform !== "win32";
const itPosix = POSIX ? it : it.skip;

const cleanups: (() => void)[] = [];
let restoreEnv: () => void = () => undefined;

beforeEach(() => {
  restoreEnv = scrubMpEnv();
});

afterEach(() => {
  restoreEnv();
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/** Future-dated ISO instant (the `_utcnow() + 1h` fixture twin). */
function futureIso(): string {
  return new Date(Date.now() + 3_600_000).toISOString();
}

/** The `_make_tokens` fixture twin (test_auth_storage.py:39). */
function makeTokens(options?: {
  accessToken?: string;
  refreshToken?: string | null;
  scope?: string;
}): OAuthTokens {
  const refresh = options?.refreshToken;
  return new OAuthTokens({
    access_token: new Secret(options?.accessToken ?? "access_abc123"),
    refresh_token:
      refresh === null ? null : new Secret(refresh ?? "refresh_xyz789"),
    expires_at: futureIso(),
    scope: options?.scope ?? "projects analysis",
    token_type: "Bearer",
  });
}

/** The `_make_client_info` fixture twin (test_auth_storage.py:64). */
function makeClientInfo(options?: {
  clientId?: string;
  region?: string;
}): OAuthClientInfo {
  return {
    client_id: options?.clientId ?? "client_abc123",
    region: options?.region ?? "us",
    redirect_uri: "http://localhost:19284/callback",
    scope: "projects analysis",
    created_at: new Date().toISOString(),
  };
}

describe("TestOAuthStorageSecurityHardening (test_auth_storage.py:87)", () => {
  itPosix("test_directory_created_with_0o700", () => {
    const tmp = makeTempDir(cleanups);
    const storageDir = join(tmp, "secure_oauth");
    const storage = new OAuthStorage({ storageDir });
    storage.saveTokens(makeTokens(), "us");
    expect(statSync(storageDir).mode & 0o7777).toBe(0o700);
  });

  itPosix("test_files_created_with_0o600", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveTokens(makeTokens(), "us");
    storage.saveClientInfo(makeClientInfo());
    for (const name of ["tokens_us.json", "client_us.json"]) {
      expect(statSync(join(tmp, name)).mode & 0o7777).toBe(0o600);
    }
  });

  itPosix("test_check_and_fix_permissions_repairs_directory", () => {
    const tmp = makeTempDir(cleanups);
    const storageDir = join(tmp, "fixable_oauth");
    mkdirSync(storageDir, { recursive: true });
    chmodSync(storageDir, 0o755); // Intentionally wrong
    const storage = new OAuthStorage({ storageDir });
    storage.saveTokens(makeTokens(), "us");
    expect(statSync(storageDir).mode & 0o7777).toBe(0o700);
  });

  itPosix("test_check_and_fix_permissions_repairs_files_on_load", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveTokens(makeTokens(), "us");
    const tokenFile = join(tmp, "tokens_us.json");
    chmodSync(tokenFile, 0o644);
    storage.loadTokens("us");
    expect(statSync(tokenFile).mode & 0o7777).toBe(0o600);
  });

  it("test_repr_redacts_access_token", () => {
    const tokens = makeTokens();
    const r = String(tokens.access_token);
    expect(r).not.toContain("access_abc123");
    expect(r).toContain("**********");
  });

  it("test_repr_redacts_refresh_token", () => {
    const tokens = makeTokens();
    expect(String(tokens.refresh_token)).not.toContain("refresh_xyz789");
  });

  it("test_str_redacts_secrets", () => {
    const tokens = makeTokens();
    const s = JSON.stringify(tokens);
    expect(s).not.toContain("access_abc123");
    expect(s).not.toContain("refresh_xyz789");
  });

  it("test_token_values_never_in_log_output", () => {
    const tokens = makeTokens();
    const formatted = `Loaded tokens: ${JSON.stringify(tokens)}`;
    expect(formatted).not.toContain("access_abc123");
    expect(formatted).not.toContain("refresh_xyz789");
    const formattedRepr = `Token info: ${String(tokens.access_token)} ${String(
      tokens.refresh_token,
    )}`;
    expect(formattedRepr).not.toContain("access_abc123");
    expect(formattedRepr).not.toContain("refresh_xyz789");
  });
});

describe("TestOAuthStorageTokenRoundTrip (test_auth_storage.py:196)", () => {
  it("test_save_and_load_tokens", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveTokens(makeTokens(), "us");
    const loaded = storage.loadTokens("us");
    expect(loaded).not.toBeNull();
    expect(loaded?.access_token.reveal()).toBe("access_abc123");
    expect(loaded?.refresh_token).not.toBeNull();
    expect(loaded?.refresh_token?.reveal()).toBe("refresh_xyz789");
    expect(loaded?.scope).toBe("projects analysis");
    expect(loaded?.token_type).toBe("Bearer");
  });

  it("test_save_and_load_tokens_without_refresh_token", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveTokens(makeTokens({ refreshToken: null }), "us");
    const loaded = storage.loadTokens("us");
    expect(loaded).not.toBeNull();
    expect(loaded?.refresh_token).toBeNull();
  });

  it("test_expires_at_preserved_through_round_trip", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    const original = makeTokens();
    storage.saveTokens(original, "us");
    const loaded = storage.loadTokens("us");
    expect(loaded).not.toBeNull();
    const delta = Math.abs(
      Date.parse(loaded?.expires_at ?? "") - Date.parse(original.expires_at),
    );
    expect(delta).toBeLessThan(1000);
  });
});

describe("TestOAuthStorageClientInfoRoundTrip (test_auth_storage.py:249)", () => {
  it("test_save_and_load_client_info", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveClientInfo(makeClientInfo());
    const loaded = storage.loadClientInfo("us");
    expect(loaded).not.toBeNull();
    expect(loaded?.client_id).toBe("client_abc123");
    expect(loaded?.region).toBe("us");
    expect(loaded?.redirect_uri).toBe("http://localhost:19284/callback");
    expect(loaded?.scope).toBe("projects analysis");
  });

  it("test_save_and_load_client_info_different_regions", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveClientInfo(makeClientInfo({ clientId: "us_client" }));
    storage.saveClientInfo(
      makeClientInfo({ clientId: "eu_client", region: "eu" }),
    );
    expect(storage.loadClientInfo("us")?.client_id).toBe("us_client");
    expect(storage.loadClientInfo("eu")?.client_id).toBe("eu_client");
  });
});

describe("TestOAuthStorageFilePermissions (test_auth_storage.py:285)", () => {
  itPosix("test_storage_directory_has_0o700_permissions", () => {
    const tmp = makeTempDir(cleanups);
    const storageDir = join(tmp, "oauth_perms");
    const storage = new OAuthStorage({ storageDir });
    storage.saveTokens(makeTokens(), "us");
    expect(statSync(storageDir).mode & 0o7777).toBe(0o700);
  });

  itPosix("test_token_file_has_0o600_permissions", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveTokens(makeTokens(), "us");
    expect(statSync(join(tmp, "tokens_us.json")).mode & 0o7777).toBe(0o600);
  });

  itPosix("test_client_info_file_has_0o600_permissions", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveClientInfo(makeClientInfo({ region: "eu" }));
    expect(statSync(join(tmp, "client_eu.json")).mode & 0o7777).toBe(0o600);
  });
});

describe("TestOAuthStorageEnvOverride (test_auth_storage.py:335)", () => {
  it("test_mp_oauth_storage_dir_override", () => {
    const tmp = makeTempDir(cleanups);
    const customRoot = join(tmp, "custom_root");
    mkdirSync(customRoot, { recursive: true });
    process.env["MP_OAUTH_STORAGE_DIR"] = customRoot;
    const storage = new OAuthStorage();
    storage.saveTokens(makeTokens(), "us");
    expect(existsSync(join(customRoot, "oauth", "tokens_us.json"))).toBe(true);
  });

  it("test_explicit_storage_dir_takes_precedence_over_env", () => {
    const tmp = makeTempDir(cleanups);
    const envDir = join(tmp, "env_dir");
    const explicitDir = join(tmp, "explicit_dir");
    mkdirSync(envDir);
    mkdirSync(explicitDir);
    process.env["MP_OAUTH_STORAGE_DIR"] = envDir;
    const storage = new OAuthStorage({ storageDir: explicitDir });
    storage.saveTokens(makeTokens(), "us");
    expect(existsSync(join(explicitDir, "tokens_us.json"))).toBe(true);
    expect(existsSync(join(envDir, "tokens_us.json"))).toBe(false);
  });
});

describe("TestOAuthStorageRegionNaming (test_auth_storage.py:377)", () => {
  it("test_tokens_file_named_by_region", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    for (const region of ["us", "eu", "in"]) {
      storage.saveTokens(makeTokens(), region);
      expect(existsSync(join(tmp, `tokens_${region}.json`))).toBe(true);
    }
  });

  it("test_client_file_named_by_region", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    for (const region of ["us", "eu", "in"]) {
      storage.saveClientInfo(makeClientInfo({ region }));
      expect(existsSync(join(tmp, `client_${region}.json`))).toBe(true);
    }
  });

  it("test_different_regions_are_independent", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveTokens(makeTokens({ accessToken: "us_token" }), "us");
    storage.saveTokens(makeTokens({ accessToken: "eu_token" }), "eu");
    expect(storage.loadTokens("us")?.access_token.reveal()).toBe("us_token");
    expect(storage.loadTokens("eu")?.access_token.reveal()).toBe("eu_token");
  });
});

describe("TestOAuthStorageMissingFile (test_auth_storage.py:424)", () => {
  it("test_load_tokens_returns_none_when_missing", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(storage.loadTokens("us")).toBeNull();
  });

  it("test_load_client_info_returns_none_when_missing", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(storage.loadClientInfo("us")).toBeNull();
  });

  it("test_load_tokens_returns_none_for_different_region", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    storage.saveTokens(makeTokens(), "us");
    expect(storage.loadTokens("eu")).toBeNull();
  });
});

describe("TestOAuthStorageDelete (test_auth_storage.py:453)", () => {
  it("test_delete_tokens_removes_file", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveTokens(makeTokens(), "us");
    expect(existsSync(join(tmp, "tokens_us.json"))).toBe(true);
    storage.deleteTokens("us");
    expect(existsSync(join(tmp, "tokens_us.json"))).toBe(false);
  });

  it("test_delete_tokens_only_affects_specified_region", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveTokens(makeTokens(), "us");
    storage.saveTokens(makeTokens(), "eu");
    storage.deleteTokens("us");
    expect(existsSync(join(tmp, "tokens_us.json"))).toBe(false);
    expect(existsSync(join(tmp, "tokens_eu.json"))).toBe(true);
  });

  it("test_delete_tokens_when_no_file_exists", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => storage.deleteTokens("us")).not.toThrow();
  });

  it("test_load_tokens_returns_none_after_delete", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    storage.saveTokens(makeTokens(), "us");
    storage.deleteTokens("us");
    expect(storage.loadTokens("us")).toBeNull();
  });

  it("test_delete_all_removes_all_files", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    for (const region of ["us", "eu", "in"]) {
      storage.saveTokens(makeTokens(), region);
      storage.saveClientInfo(makeClientInfo({ region }));
    }
    storage.deleteAll();
    for (const region of ["us", "eu", "in"]) {
      expect(storage.loadTokens(region)).toBeNull();
      expect(storage.loadClientInfo(region)).toBeNull();
    }
  });
});

describe("TestOAuthStorageCorruptedFiles (test_auth_storage.py:513)", () => {
  it("test_load_tokens_invalid_json", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    writeFileSync(join(tmp, "tokens_us.json"), '{"truncated', "utf8");
    if (POSIX) {
      chmodSync(join(tmp, "tokens_us.json"), 0o600);
    }
    expect(storage.loadTokens("us")).toBeNull();
  });

  it("test_load_tokens_empty_file", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    writeFileSync(join(tmp, "tokens_us.json"), "", "utf8");
    if (POSIX) {
      chmodSync(join(tmp, "tokens_us.json"), 0o600);
    }
    expect(storage.loadTokens("us")).toBeNull();
  });

  it("test_load_tokens_binary_data", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    writeFileSync(
      join(tmp, "tokens_us.json"),
      Buffer.from([0x80, 0x81, 0x82, 0xff, 0xfe, 0x00, 0x01]),
    );
    if (POSIX) {
      chmodSync(join(tmp, "tokens_us.json"), 0o600);
    }
    expect(storage.loadTokens("us")).toBeNull();
  });

  it("test_load_tokens_wrong_schema", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    writeFileSync(join(tmp, "tokens_us.json"), '{"foo": "bar"}', "utf8");
    if (POSIX) {
      chmodSync(join(tmp, "tokens_us.json"), 0o600);
    }
    expect(storage.loadTokens("us")).toBeNull();
  });

  it("test_load_tokens_wrong_types", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    const bad = {
      access_token: 42,
      expires_at: "not-a-date",
      scope: 123,
      token_type: null,
    };
    writeFileSync(join(tmp, "tokens_us.json"), JSON.stringify(bad), "utf8");
    if (POSIX) {
      chmodSync(join(tmp, "tokens_us.json"), 0o600);
    }
    expect(storage.loadTokens("us")).toBeNull();
  });

  it("test_load_client_info_corrupted", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    writeFileSync(join(tmp, "client_us.json"), "not valid json {{{", "utf8");
    if (POSIX) {
      chmodSync(join(tmp, "client_us.json"), 0o600);
    }
    expect(storage.loadClientInfo("us")).toBeNull();
  });
});

describe("TestOAuthStoragePathTraversal (test_auth_storage.py:609)", () => {
  it("test_tokens_path_traversal_rejected", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => storage.saveTokens(makeTokens(), "../../../tmp")).toThrow(
      /Invalid region/,
    );
  });

  it("test_tokens_path_with_slashes", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => storage.saveTokens(makeTokens(), "us/eu")).toThrow(
      /Invalid region/,
    );
  });

  it("test_client_path_traversal_rejected", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const malicious = makeClientInfo({
      clientId: "test_client",
      region: "../../../etc",
    });
    expect(() => storage.saveClientInfo(malicious)).toThrow(/Invalid region/);
  });

  it("test_valid_regions_accepted", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    for (const region of ["us", "eu", "in"]) {
      storage.saveTokens(makeTokens(), region);
      expect(storage.loadTokens(region)).not.toBeNull();
    }
  });

  it("test_load_tokens_traversal_rejected", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => storage.loadTokens("../../../tmp")).toThrow(/Invalid region/);
  });

  it("test_load_client_info_traversal_rejected", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => storage.loadClientInfo("../../../tmp")).toThrow(
      /Invalid region/,
    );
  });

  it("test_delete_tokens_traversal_rejected", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => storage.deleteTokens("../../../tmp")).toThrow(
      /Invalid region/,
    );
  });

  it("test_uppercase_region_rejected", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => storage.saveTokens(makeTokens(), "US")).toThrow(
      ParamValidationError,
    );
  });

  it("test_three_letter_region_rejected", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => storage.saveTokens(makeTokens(), "usa")).toThrow(
      /Invalid region/,
    );
  });
});

describe("TestOAuthStorageUnicode (test_auth_storage.py:700)", () => {
  it("test_save_load_tokens_unicode_scope", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    storage.saveTokens(makeTokens({ scope: "événements données" }), "us");
    expect(storage.loadTokens("us")?.scope).toBe("événements données");
  });

  it("test_save_load_tokens_special_chars_in_token", () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    storage.saveTokens(
      makeTokens({ accessToken: "tok+en/with=special" }),
      "us",
    );
    expect(storage.loadTokens("us")?.access_token.reveal()).toBe(
      "tok+en/with=special",
    );
  });
});

describe("TestOAuthStorageConcurrency (test_auth_storage.py:748)", () => {
  it("test_concurrent_saves_produce_valid_json", async () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    // 10 concurrent async writers over the pid+counter tmp scheme
    // (§3.3 disposition — Python's ThreadPoolExecutor twin).
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        Promise.resolve().then(() => {
          storage.saveTokens(makeTokens({ accessToken: `token_${i}` }), "us");
        }),
      ),
    );
    const loaded = storage.loadTokens("us");
    expect(loaded).not.toBeNull();
    const valid = new Set(Array.from({ length: 10 }, (_, i) => `token_${i}`));
    expect(valid.has(loaded?.access_token.reveal() ?? "")).toBe(true);
  });

  it("test_concurrent_read_during_write", async () => {
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const readResults: (OAuthTokens | null)[] = [];
    const writer = (async (): Promise<void> => {
      for (let i = 0; i < 20; i += 1) {
        storage.saveTokens(makeTokens({ accessToken: `write_${i}` }), "us");
        await Promise.resolve();
      }
    })();
    const reader = (async (): Promise<void> => {
      for (let i = 0; i < 20; i += 1) {
        readResults.push(storage.loadTokens("us"));
        await Promise.resolve();
      }
    })();
    await Promise.all([writer, reader]);
    for (const result of readResults) {
      expect(result === null || result instanceof OAuthTokens).toBe(true);
    }
  });
});

// B8-ARB-B F1 + F2 locks (b8-reviewB-resolution.md): the legacy-world
// read path already carried the pydantic-lax epoch mirror (B8-N2
// decision 3), but not the numeric-STRING spelling nor speedate's
// seconds/milliseconds watershed (|v| > 2e10 → ms) — all live-probed
// against CPython/pydantic in the resolution. Writers: Python
// `save_tokens` renders `datetime.isoformat()` (`+00:00`);
// `save_client_info` renders pydantic JSON mode (`Z`).
describe("B8-ARB-B F1/F2 storage lax-datetime + writer-shape locks", () => {
  it("F1: numeric-STRING epoch expires_at loads (speedate digit-string epoch)", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    const path = join(tmp, "tokens_us.json");
    writeFileSync(
      path,
      JSON.stringify({
        access_token: "a",
        refresh_token: "r",
        expires_at: "1893456000",
        scope: "read",
        token_type: "Bearer",
      }),
      "utf8",
    );
    if (POSIX) {
      chmodSync(path, 0o600);
    }
    const loaded = storage.loadTokens("us");
    expect(loaded?.expires_at).toBe("2030-01-01T00:00:00+00:00");
  });

  it("F1: epoch beyond the 2e10 watershed reads as MILLISECONDS (speedate)", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    const path = join(tmp, "tokens_us.json");
    writeFileSync(
      path,
      JSON.stringify({
        access_token: "a",
        expires_at: 1_893_456_000_000, // ms — pydantic: 2030-01-01
        scope: "read",
        token_type: "Bearer",
      }),
      "utf8",
    );
    if (POSIX) {
      chmodSync(path, 0o600);
    }
    const loaded = storage.loadTokens("us");
    expect(loaded?.expires_at).toBe("2030-01-01T00:00:00+00:00");
  });

  it("F1: epoch created_at in client_{region}.json loads (pydantic lax on OAuthClientInfo)", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    const path = join(tmp, "client_us.json");
    writeFileSync(
      path,
      JSON.stringify({
        client_id: "cid",
        region: "us",
        redirect_uri: "http://localhost:19284/callback",
        scope: "read",
        created_at: 1_893_456_000,
      }),
      "utf8",
    );
    if (POSIX) {
      chmodSync(path, 0o600);
    }
    const loaded = storage.loadClientInfo("us");
    expect(loaded?.created_at).toBe("2030-01-01T00:00:00+00:00");
  });

  it("F2: saveTokens renders a Z-text model in isoformat +00:00 form (storage.py:471)", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveTokens(
      new OAuthTokens({
        access_token: new Secret("a"),
        refresh_token: null,
        expires_at: "2030-01-01T00:00:00Z",
        scope: "read",
        token_type: "Bearer",
      }),
      "us",
    );
    const text = readFileSync(join(tmp, "tokens_us.json"), "utf8");
    expect(text).toContain('"expires_at": "2030-01-01T00:00:00+00:00"');
  });

  it("F2: saveClientInfo renders created_at in pydantic-JSON Z form (storage.py:541)", () => {
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveClientInfo({
      client_id: "cid",
      region: "us",
      redirect_uri: "http://localhost:19284/callback",
      scope: "read",
      created_at: "2030-01-01T00:00:00+00:00",
    });
    const text = readFileSync(join(tmp, "client_us.json"), "utf8");
    expect(text).toContain('"created_at": "2030-01-01T00:00:00Z"');
  });
});
