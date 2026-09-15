// OAuthStorage: permissions, round trips, region naming, deletion, corrupted
// files, path-traversal guard and concurrency. Mirrors
// tests/unit/test_auth_storage.py; Python threads become interleaved async
// writers. Additive: lax datetime reads and the writer datetime shapes.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type OAuthClientInfo,
  OAuthTokens,
  ParamValidationError,
  Secret,
} from "@mixpanel-headless/core";

import { OAuthStorage } from "../src/auth/storage.js";
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

/** Future-dated ISO instant (the `_utcnow() + 1h` fixture twin). */
function futureIso(): string {
  return new Date(Date.now() + 3_600_000).toISOString();
}

/** The `_make_tokens` fixture twin. */
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

/** The `_make_client_info` fixture twin. */
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

describe("OAuthStorage security hardening", () => {
  // python: test_auth_storage.py::TestOAuthStorageSecurityHardening
  it.skipIf(!POSIX)("creates the storage directory 0o700", () => {
    // python: test_directory_created_with_0o700
    const tmp = makeTempDir(cleanups);
    const storageDir = join(tmp, "secure_oauth");
    const storage = new OAuthStorage({ storageDir });
    storage.saveTokens(makeTokens(), "us");
    expect(statSync(storageDir).mode & 0o7777).toBe(0o700);
  });

  it.skipIf(!POSIX)("creates token and client files 0o600", () => {
    // python: test_files_created_with_0o600
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveTokens(makeTokens(), "us");
    storage.saveClientInfo(makeClientInfo());
    for (const name of ["tokens_us.json", "client_us.json"]) {
      expect(statSync(join(tmp, name)).mode & 0o7777).toBe(0o600);
    }
  });

  it.skipIf(!POSIX)(
    "tightens a pre-existing 0o755 storage directory to 0o700",
    () => {
      // python: test_check_and_fix_permissions_repairs_directory
      const tmp = makeTempDir(cleanups);
      const storageDir = join(tmp, "fixable_oauth");
      mkdirSync(storageDir, { recursive: true });
      chmodSync(storageDir, 0o755); // Intentionally wrong
      const storage = new OAuthStorage({ storageDir });
      storage.saveTokens(makeTokens(), "us");
      expect(statSync(storageDir).mode & 0o7777).toBe(0o700);
    },
  );

  it.skipIf(!POSIX)("tightens a 0o644 token file to 0o600 on load", () => {
    // python: test_check_and_fix_permissions_repairs_files_on_load
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveTokens(makeTokens(), "us");
    const tokenFile = join(tmp, "tokens_us.json");
    chmodSync(tokenFile, 0o644);
    storage.loadTokens("us");
    expect(statSync(tokenFile).mode & 0o7777).toBe(0o600);
  });

  it("redacts the access token in String()", () => {
    // python: test_repr_redacts_access_token
    const tokens = makeTokens();
    const r = String(tokens.access_token);
    expect(r).not.toContain("access_abc123");
    expect(r).toContain("**********");
  });

  it("redacts the refresh token in String()", () => {
    // python: test_repr_redacts_refresh_token
    const tokens = makeTokens();
    expect(String(tokens.refresh_token)).not.toContain("refresh_xyz789");
  });

  it("redacts both secrets in JSON.stringify()", () => {
    // python: test_str_redacts_secrets
    const tokens = makeTokens();
    const s = JSON.stringify(tokens);
    expect(s).not.toContain("access_abc123");
    expect(s).not.toContain("refresh_xyz789");
  });

  it("keeps token values out of formatted log lines", () => {
    // python: test_token_values_never_in_log_output
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

describe("OAuthStorage token round trip", () => {
  // python: test_auth_storage.py::TestOAuthStorageTokenRoundTrip
  it("saves tokens and loads them back intact", () => {
    // python: test_save_and_load_tokens
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

  it("round-trips tokens with a null refresh token", () => {
    // python: test_save_and_load_tokens_without_refresh_token
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveTokens(makeTokens({ refreshToken: null }), "us");
    const loaded = storage.loadTokens("us");
    expect(loaded).not.toBeNull();
    expect(loaded?.refresh_token).toBeNull();
  });

  it("preserves expires_at through a round trip", () => {
    // python: test_expires_at_preserved_through_round_trip
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

describe("OAuthStorage client-info round trip", () => {
  // python: test_auth_storage.py::TestOAuthStorageClientInfoRoundTrip
  it("saves client info and loads it back intact", () => {
    // python: test_save_and_load_client_info
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

  it("keeps client info separate per region", () => {
    // python: test_save_and_load_client_info_different_regions
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

describe("OAuthStorage file permissions", () => {
  // python: test_auth_storage.py::TestOAuthStorageFilePermissions
  it.skipIf(!POSIX)("storage directory is 0o700", () => {
    // python: test_storage_directory_has_0o700_permissions
    const tmp = makeTempDir(cleanups);
    const storageDir = join(tmp, "oauth_perms");
    const storage = new OAuthStorage({ storageDir });
    storage.saveTokens(makeTokens(), "us");
    expect(statSync(storageDir).mode & 0o7777).toBe(0o700);
  });

  it.skipIf(!POSIX)("token file is 0o600", () => {
    // python: test_token_file_has_0o600_permissions
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveTokens(makeTokens(), "us");
    expect(statSync(join(tmp, "tokens_us.json")).mode & 0o7777).toBe(0o600);
  });

  it.skipIf(!POSIX)("client-info file is 0o600", () => {
    // python: test_client_info_file_has_0o600_permissions
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveClientInfo(makeClientInfo({ region: "eu" }));
    expect(statSync(join(tmp, "client_eu.json")).mode & 0o7777).toBe(0o600);
  });
});

describe("OAuthStorage MP_OAUTH_STORAGE_DIR override", () => {
  // python: test_auth_storage.py::TestOAuthStorageEnvOverride
  it("MP_OAUTH_STORAGE_DIR relocates the storage root", () => {
    // python: test_mp_oauth_storage_dir_override
    const tmp = makeTempDir(cleanups);
    const customRoot = join(tmp, "custom_root");
    mkdirSync(customRoot, { recursive: true });
    vi.stubEnv("MP_OAUTH_STORAGE_DIR", customRoot);
    const storage = new OAuthStorage();
    storage.saveTokens(makeTokens(), "us");
    expect(existsSync(join(customRoot, "oauth", "tokens_us.json"))).toBe(true);
  });

  it("an explicit storageDir wins over MP_OAUTH_STORAGE_DIR", () => {
    // python: test_explicit_storage_dir_takes_precedence_over_env
    const tmp = makeTempDir(cleanups);
    const envDir = join(tmp, "env_dir");
    const explicitDir = join(tmp, "explicit_dir");
    mkdirSync(envDir);
    mkdirSync(explicitDir);
    vi.stubEnv("MP_OAUTH_STORAGE_DIR", envDir);
    const storage = new OAuthStorage({ storageDir: explicitDir });
    storage.saveTokens(makeTokens(), "us");
    expect(existsSync(join(explicitDir, "tokens_us.json"))).toBe(true);
    expect(existsSync(join(envDir, "tokens_us.json"))).toBe(false);
  });
});

describe("OAuthStorage per-region file naming", () => {
  // python: test_auth_storage.py::TestOAuthStorageRegionNaming
  it("names token files tokens_<region>.json", () => {
    // python: test_tokens_file_named_by_region
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    for (const region of ["us", "eu", "in"]) {
      storage.saveTokens(makeTokens(), region);
      expect(existsSync(join(tmp, `tokens_${region}.json`))).toBe(true);
    }
  });

  it("names client files client_<region>.json", () => {
    // python: test_client_file_named_by_region
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    for (const region of ["us", "eu", "in"]) {
      storage.saveClientInfo(makeClientInfo({ region }));
      expect(existsSync(join(tmp, `client_${region}.json`))).toBe(true);
    }
  });

  it("keeps tokens independent per region", () => {
    // python: test_different_regions_are_independent
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveTokens(makeTokens({ accessToken: "us_token" }), "us");
    storage.saveTokens(makeTokens({ accessToken: "eu_token" }), "eu");
    expect(storage.loadTokens("us")?.access_token.reveal()).toBe("us_token");
    expect(storage.loadTokens("eu")?.access_token.reveal()).toBe("eu_token");
  });
});

describe("OAuthStorage with missing files", () => {
  // python: test_auth_storage.py::TestOAuthStorageMissingFile
  it("loadTokens returns null when the file is missing", () => {
    // python: test_load_tokens_returns_none_when_missing
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(storage.loadTokens("us")).toBeNull();
  });

  it("loadClientInfo returns null when the file is missing", () => {
    // python: test_load_client_info_returns_none_when_missing
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(storage.loadClientInfo("us")).toBeNull();
  });

  it("loadTokens returns null for a region with no file", () => {
    // python: test_load_tokens_returns_none_for_different_region
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    storage.saveTokens(makeTokens(), "us");
    expect(storage.loadTokens("eu")).toBeNull();
  });
});

describe("OAuthStorage delete", () => {
  // python: test_auth_storage.py::TestOAuthStorageDelete
  it("deleteTokens removes the token file", () => {
    // python: test_delete_tokens_removes_file
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveTokens(makeTokens(), "us");
    expect(existsSync(join(tmp, "tokens_us.json"))).toBe(true);
    storage.deleteTokens("us");
    expect(existsSync(join(tmp, "tokens_us.json"))).toBe(false);
  });

  it("deleteTokens leaves other regions' files alone", () => {
    // python: test_delete_tokens_only_affects_specified_region
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    storage.saveTokens(makeTokens(), "us");
    storage.saveTokens(makeTokens(), "eu");
    storage.deleteTokens("us");
    expect(existsSync(join(tmp, "tokens_us.json"))).toBe(false);
    expect(existsSync(join(tmp, "tokens_eu.json"))).toBe(true);
  });

  it("deleteTokens is a no-op when the file is missing", () => {
    // python: test_delete_tokens_when_no_file_exists
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => storage.deleteTokens("us")).not.toThrow();
  });

  it("loadTokens returns null after deleteTokens", () => {
    // python: test_load_tokens_returns_none_after_delete
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    storage.saveTokens(makeTokens(), "us");
    storage.deleteTokens("us");
    expect(storage.loadTokens("us")).toBeNull();
  });

  it("deleteAll removes every token and client file", () => {
    // python: test_delete_all_removes_all_files
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

describe("OAuthStorage with corrupted files", () => {
  // python: test_auth_storage.py::TestOAuthStorageCorruptedFiles
  it("loadTokens returns null for invalid JSON", () => {
    // python: test_load_tokens_invalid_json
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    writeFileSync(join(tmp, "tokens_us.json"), '{"truncated', "utf8");
    if (POSIX) {
      chmodSync(join(tmp, "tokens_us.json"), 0o600);
    }
    expect(storage.loadTokens("us")).toBeNull();
  });

  it("loadTokens returns null for an empty file", () => {
    // python: test_load_tokens_empty_file
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    writeFileSync(join(tmp, "tokens_us.json"), "", "utf8");
    if (POSIX) {
      chmodSync(join(tmp, "tokens_us.json"), 0o600);
    }
    expect(storage.loadTokens("us")).toBeNull();
  });

  it("loadTokens returns null for binary garbage", () => {
    // python: test_load_tokens_binary_data
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

  it("loadTokens returns null for JSON with the wrong shape", () => {
    // python: test_load_tokens_wrong_schema
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    writeFileSync(join(tmp, "tokens_us.json"), '{"foo": "bar"}', "utf8");
    if (POSIX) {
      chmodSync(join(tmp, "tokens_us.json"), 0o600);
    }
    expect(storage.loadTokens("us")).toBeNull();
  });

  it("loadTokens returns null for fields of the wrong type", () => {
    // python: test_load_tokens_wrong_types
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

  it("loadClientInfo returns null for invalid JSON", () => {
    // python: test_load_client_info_corrupted
    const tmp = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: tmp });
    writeFileSync(join(tmp, "client_us.json"), "not valid json {{{", "utf8");
    if (POSIX) {
      chmodSync(join(tmp, "client_us.json"), 0o600);
    }
    expect(storage.loadClientInfo("us")).toBeNull();
  });
});

describe("OAuthStorage region path-traversal guard", () => {
  // python: test_auth_storage.py::TestOAuthStoragePathTraversal
  it("saveTokens rejects a path-traversal region", () => {
    // python: test_tokens_path_traversal_rejected
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => storage.saveTokens(makeTokens(), "../../../tmp")).toThrow(
      /Invalid region/,
    );
  });

  it("saveTokens rejects a region containing slashes", () => {
    // python: test_tokens_path_with_slashes
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => storage.saveTokens(makeTokens(), "us/eu")).toThrow(
      /Invalid region/,
    );
  });

  it("saveClientInfo rejects a path-traversal region", () => {
    // python: test_client_path_traversal_rejected
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const malicious = makeClientInfo({
      clientId: "test_client",
      region: "../../../etc",
    });
    expect(() => storage.saveClientInfo(malicious)).toThrow(/Invalid region/);
  });

  it("accepts us, eu and in", () => {
    // python: test_valid_regions_accepted
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    for (const region of ["us", "eu", "in"]) {
      storage.saveTokens(makeTokens(), region);
      expect(storage.loadTokens(region)).not.toBeNull();
    }
  });

  it("loadTokens rejects a path-traversal region", () => {
    // python: test_load_tokens_traversal_rejected
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => storage.loadTokens("../../../tmp")).toThrow(/Invalid region/);
  });

  it("loadClientInfo rejects a path-traversal region", () => {
    // python: test_load_client_info_traversal_rejected
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => storage.loadClientInfo("../../../tmp")).toThrow(
      /Invalid region/,
    );
  });

  it("deleteTokens rejects a path-traversal region", () => {
    // python: test_delete_tokens_traversal_rejected
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => storage.deleteTokens("../../../tmp")).toThrow(
      /Invalid region/,
    );
  });

  it("rejects an upper-case region with ParamValidationError", () => {
    // python: test_uppercase_region_rejected
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => storage.saveTokens(makeTokens(), "US")).toThrow(
      ParamValidationError,
    );
  });

  it("rejects a three-letter region", () => {
    // python: test_three_letter_region_rejected
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    expect(() => storage.saveTokens(makeTokens(), "usa")).toThrow(
      /Invalid region/,
    );
  });
});

describe("OAuthStorage unicode payloads", () => {
  // python: test_auth_storage.py::TestOAuthStorageUnicode
  it("round-trips a unicode scope", () => {
    // python: test_save_load_tokens_unicode_scope
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    storage.saveTokens(makeTokens({ scope: "événements données" }), "us");
    expect(storage.loadTokens("us")?.scope).toBe("événements données");
  });

  it("round-trips a token containing +, / and =", () => {
    // python: test_save_load_tokens_special_chars_in_token
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

describe("OAuthStorage concurrent access", () => {
  // python: test_auth_storage.py::TestOAuthStorageConcurrency
  it("concurrent saves leave one valid token file", async () => {
    // python: test_concurrent_saves_produce_valid_json
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

  it("reads during writes return null or a full token set, never a torn file", async () => {
    // python: test_concurrent_read_during_write
    const storage = new OAuthStorage({ storageDir: makeTempDir(cleanups) });
    const readResults: Array<OAuthTokens | null> = [];
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
describe("OAuthStorage lax datetime reads and writer datetime shapes", () => {
  it("loads a numeric-string epoch expires_at as a UTC instant", () => {
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

  it("reads an epoch beyond 2e10 as milliseconds", () => {
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

  it("loads a numeric epoch created_at from client_<region>.json", () => {
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

  it("saveTokens writes expires_at in +00:00 isoformat", () => {
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

  it("saveClientInfo writes created_at with a Z suffix", () => {
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
