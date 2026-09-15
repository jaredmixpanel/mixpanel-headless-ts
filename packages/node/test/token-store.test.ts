// The real node TokenStore (auth-effects.ts). No single Python twin: it
// abstracts `_persist_browser_tokens`, `logout`, `_safe_rmtree_warn`,
// `_client_info_path` and the `account_dir(name).exists()` orphan probe from
// mixpanel_headless.accounts. Additive: lax `expires_at` on read.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OAuthTokens, Secret } from "@mixpanel-headless/core";

import { accountDir } from "../src/auth/storage.js";
import { createNodeTokenStore } from "../src/auth/token-store.js";
import { expectPosixMode, makeTempDir, scrubMpEnv } from "./helpers.js";

const POSIX = process.platform !== "win32";

const cleanups: Array<() => void> = [];
let root = "";

beforeEach(() => {
  scrubMpEnv();
  root = makeTempDir(cleanups);
  vi.stubEnv("MP_OAUTH_STORAGE_DIR", root);
});

afterEach(() => {
  vi.unstubAllEnvs();
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/** A fresh token set with a `+00:00` expiry. */
function makeTokens(access = "acc-1"): OAuthTokens {
  return new OAuthTokens({
    access_token: new Secret(access),
    refresh_token: new Secret("ref-1"),
    expires_at: new Date(Date.now() + 3_600_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "+00:00"),
    scope: "read",
    token_type: "Bearer",
  });
}

describe("TokenStore (node implementation)", () => {
  it("writeTokens persists atomically at the per-account path and returns it", () => {
    const store = createNodeTokenStore();
    const path = store.writeTokens("me", makeTokens());
    expect(path).toBe(join(root, "accounts", "me", "tokens.json"));
    const payload = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    // token_payload_bytes shape (token.py): refresh omitted
    // only when null; secrets REVEALED on disk (CRED-F3 write site).
    expect(payload["access_token"]).toBe("acc-1");
    expect(payload["refresh_token"]).toBe("ref-1");
    expect(String(payload["access_token"])).not.toContain("*");
    expectPosixMode(path, 0o600);
    expectPosixMode(join(root, "accounts", "me"), 0o700);
  });

  it("readTokens returns the persisted set, null when none exist", () => {
    const store = createNodeTokenStore();
    expect(store.readTokens("me")).toBeNull();
    store.writeTokens("me", makeTokens("acc-2"));
    const read = store.readTokens("me");
    expect(read).not.toBeNull();
    expect(read?.access_token.reveal()).toBe("acc-2");
  });

  it("removeTokens deletes the file; a missing file is a no-op", () => {
    const store = createNodeTokenStore();
    const path = store.writeTokens("me", makeTokens());
    expect(existsSync(path)).toBe(true);
    store.removeTokens("me");
    expect(existsSync(path)).toBe(false);
    expect(() => store.removeTokens("me")).not.toThrow();
  });

  it("removeAccountDir removes the whole dir; failures warn, never raise", () => {
    const store = createNodeTokenStore();
    store.writeTokens("me", makeTokens());
    const dir = accountDir("me");
    expect(existsSync(dir)).toBe(true);
    store.removeAccountDir("me");
    expect(existsSync(dir)).toBe(false);
    // Missing dir: no-op, no raise (`if not path.exists(): return`).
    expect(() => store.removeAccountDir("me")).not.toThrow();
  });

  it("clientInfoPath honors the storage root override", () => {
    const store = createNodeTokenStore();
    expect(store.clientInfoPath("eu")).toBe(
      join(root, "oauth", "client_eu.json"),
    );
  });

  it("accountDirExists is the orphan-directory probe", () => {
    const store = createNodeTokenStore();
    expect(store.accountDirExists("ghost")).toBe(false);
    mkdirSync(join(root, "accounts", "ghost"), {
      recursive: true,
      mode: 0o700,
    });
    // A pre-seeded EMPTY directory trips the probe — the guard fires on
    // `account_dir(name).exists()`, not on tokens.json presence.
    expect(store.accountDirExists("ghost")).toBe(true);
  });

  it("readTokens tolerates a corrupt file by returning null (storage-read discipline)", () => {
    const store = createNodeTokenStore();
    const dir = join(root, "accounts", "me");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, "tokens.json");
    writeFileSync(path, "{corrupt", "utf8");
    if (POSIX) {
      chmodSync(path, 0o600);
    }
    expect(store.readTokens("me")).toBeNull();
  });
});

// B8-ARB-B F1 consistency lock (b8-reviewB-resolution.md):
// `readTokens` has no direct Python twin (B8-N2 disclosure 4) but reads
// the SAME per-account tokens.json the OnDiskTokenResolver serves — it
// takes the same pydantic-lax expires_at mirror so the two readers of
// one file can never disagree.
describe("readTokens lax expires_at", () => {
  it("numeric epoch-seconds expires_at parses instead of degrading to null", () => {
    const store = createNodeTokenStore();
    const dir = accountDir("me");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, "tokens.json");
    writeFileSync(
      path,
      JSON.stringify({
        access_token: "a",
        refresh_token: "r",
        expires_at: 1_893_456_000,
        scope: "read",
        token_type: "Bearer",
      }),
      "utf8",
    );
    if (POSIX) {
      chmodSync(path, 0o600);
    }
    const read = store.readTokens("me");
    expect(read?.expires_at).toBe("2030-01-01T00:00:00+00:00");
  });
});
