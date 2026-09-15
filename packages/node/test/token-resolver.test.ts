// Layer-3 translation of `tests/unit/test_token_resolver.py` (560
// lines, 18 tests; ALL 6 classes — b8-packets.md §3.3 row 3), plus the
// inbound `test_042_edge_cases.py::TestTokenResolverMalformed` (:240,
// `b6-packets.md:1032`) and the B7-ARB-A ASR-F4c NAMED RE-TAKE of
// `test_042_edge_cases.py::
// test_session_to_credentials_oauth_browser_missing_tokens_raises`
// (:655) — the B7 translation ran over an injected fake resolver; this
// one runs the REAL `OnDiskTokenResolver`.
//
// The Python `isolated_home` fixture (monkeypatch HOME) translates to a
// saved/restored `process.env.HOME` pointing at a tmp dir (node
// `os.homedir()` reads `$HOME` per call on POSIX; packet §7 caution 3).
//
// Python-only exclusions: none — the `_REQUIRES_O_NOFOLLOW` gates in
// the source guard symlink CREATION (POSIX), not fd flags; they
// translate to the POSIX platform gate below (plan §2.2).

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type OAuthClientInfo,
  OAuthError,
  type OAuthTokenAccount,
  OAuthTokens,
  Secret,
} from "@mixpanel-headless/core";

import { OAuthStorage } from "../src/auth/storage.js";
import {
  accountTokensPath,
  OnDiskTokenResolver,
} from "../src/auth/token-resolver.js";
import { expectPosixMode, makeTempDir, scrubMpEnv } from "./helpers.js";

const POSIX = process.platform !== "win32";

const cleanups: Array<() => void> = [];
let restoreEnv: () => void = () => undefined;
let savedHome: string | undefined;
let home = "";

beforeEach(() => {
  restoreEnv = scrubMpEnv();
  savedHome = process.env["HOME"];
  home = makeTempDir(cleanups);
  process.env["HOME"] = home;
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

/** ISO instant `hours` from now (tz-aware, `+00:00`-suffixed). */
function isoIn(hours: number): string {
  const iso = new Date(Date.now() + hours * 3_600_000).toISOString();
  return iso.replace(/\.\d{3}Z$/, "+00:00");
}

/** The `_write_tokens_file` fixture twin (test_token_resolver.py:43). */
function writeTokensFile(options: {
  name: string;
  accessToken: string;
  expiresAt: string;
  refreshToken?: string | null;
}): string {
  const dir = join(home, ".mp", "accounts", options.name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "tokens.json");
  const payload: Record<string, unknown> = {
    access_token: options.accessToken,
    expires_at: options.expiresAt,
    scope: "read:project",
    token_type: "Bearer",
  };
  if (options.refreshToken !== undefined && options.refreshToken !== null) {
    payload["refresh_token"] = options.refreshToken;
  }
  writeFileSync(path, JSON.stringify(payload), "utf8");
  if (POSIX) {
    chmodSync(path, 0o600);
  }
  return path;
}

/** Canned DCR client info (the `_fake_load_client_info` twin). */
function cannedClientInfo(clientId: string, region: string): OAuthClientInfo {
  return {
    client_id: clientId,
    region,
    redirect_uri: "http://localhost:19284/callback",
    scope: "read:project",
    created_at: new Date().toISOString(),
  };
}

describe("TestStaticToken (test_token_resolver.py:79)", () => {
  it("test_inline_token_returned", async () => {
    const account: OAuthTokenAccount = {
      type: "oauth_token",
      name: "ci",
      region: "us",
      default_project: null,
      token: new Secret("inline-tok-123"),
      token_env: null,
    };
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getStaticToken(account)).resolves.toBe(
      "inline-tok-123",
    );
  });

  it("test_env_var_returned", async () => {
    process.env["MY_OAUTH_TOK"] = "env-tok-456";
    cleanups.push(() => {
      delete process.env["MY_OAUTH_TOK"];
    });
    const account: OAuthTokenAccount = {
      type: "oauth_token",
      name: "ci",
      region: "us",
      default_project: null,
      token: null,
      token_env: "MY_OAUTH_TOK",
    };
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getStaticToken(account)).resolves.toBe("env-tok-456");
  });

  it("test_env_var_missing_raises", async () => {
    delete process.env["MY_OAUTH_TOK"];
    const account: OAuthTokenAccount = {
      type: "oauth_token",
      name: "ci",
      region: "us",
      default_project: null,
      token: null,
      token_env: "MY_OAUTH_TOK",
    };
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getStaticToken(account)).rejects.toThrow(OAuthError);
  });

  it("test_env_var_empty_raises", async () => {
    process.env["MY_OAUTH_TOK"] = "";
    cleanups.push(() => {
      delete process.env["MY_OAUTH_TOK"];
    });
    const account: OAuthTokenAccount = {
      type: "oauth_token",
      name: "ci",
      region: "us",
      default_project: null,
      token: null,
      token_env: "MY_OAUTH_TOK",
    };
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getStaticToken(account)).rejects.toThrow(OAuthError);
  });
});

describe("TestBrowserToken (test_token_resolver.py:123)", () => {
  it("test_unexpired_token_returned", async () => {
    writeTokensFile({
      name: "me",
      accessToken: "brw-tok-fresh",
      expiresAt: isoIn(1),
      refreshToken: "ref-1",
    });
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("me", "us")).resolves.toBe(
      "brw-tok-fresh",
    );
  });

  it("test_missing_tokens_file_raises", async () => {
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("nobody", "us")).rejects.toThrow(
      OAuthError,
    );
  });

  it("test_expired_without_refresh_raises", async () => {
    writeTokensFile({
      name: "me",
      accessToken: "brw-tok-old",
      expiresAt: isoIn(-1),
    });
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("me", "us")).rejects.toThrow(
      OAuthError,
    );
  });

  it("test_account_dir_is_isolated_per_name", async () => {
    writeTokensFile({ name: "alice", accessToken: "A", expiresAt: isoIn(1) });
    writeTokensFile({ name: "bob", accessToken: "B", expiresAt: isoIn(1) });
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("alice", "us")).resolves.toBe("A");
    await expect(resolver.getBrowserToken("bob", "us")).resolves.toBe("B");
  });

  it("test_token_within_30s_buffer_treated_as_expired", async () => {
    writeTokensFile({
      name: "me",
      accessToken: "brw-tok-soon-to-expire",
      expiresAt: new Date(Date.now() + 20_000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "+00:00"),
    });
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("me", "us")).rejects.toThrow(
      OAuthError,
    );
  });

  it("test_token_well_outside_buffer_is_accepted", async () => {
    writeTokensFile({
      name: "me",
      accessToken: "brw-tok-comfortable",
      expiresAt: new Date(Date.now() + 5 * 60_000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "+00:00"),
    });
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("me", "us")).resolves.toBe(
      "brw-tok-comfortable",
    );
  });
});

describe("TestBrowserTokenRefresh (test_token_resolver.py:214)", () => {
  it("test_expired_with_refresh_token_calls_oauth_flow", async () => {
    const path = writeTokensFile({
      name: "me",
      accessToken: "brw-tok-old",
      expiresAt: isoIn(-1),
      refreshToken: "brw-refresh-1",
    });
    const captured: Record<string, unknown> = {};
    const newExpires = isoIn(1);
    const resolver = new OnDiskTokenResolver({
      loadClientInfo: (region) => cannedClientInfo("dcr-client-1", region),
      refresh: ({ tokens, clientId, accountName }) => {
        captured["client_id"] = clientId;
        captured["account_name"] = accountName;
        captured["refresh_token_in"] = tokens.refresh_token?.reveal() ?? null;
        return Promise.resolve(
          new OAuthTokens({
            access_token: new Secret("brw-tok-new"),
            refresh_token: new Secret("brw-refresh-2"),
            expires_at: newExpires,
            scope: "read:project",
            token_type: "Bearer",
          }),
        );
      },
    });

    await expect(resolver.getBrowserToken("me", "us")).resolves.toBe(
      "brw-tok-new",
    );
    expect(captured["client_id"]).toBe("dcr-client-1");
    expect(captured["refresh_token_in"]).toBe("brw-refresh-1");
    const newPayload = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    expect(newPayload["access_token"]).toBe("brw-tok-new");
    expect(newPayload["refresh_token"]).toBe("brw-refresh-2");
    expect(newPayload["expires_at"]).toBe(newExpires);
    expectPosixMode(path, 0o600);
  });

  it("test_refresh_response_without_new_refresh_keeps_existing", async () => {
    const path = writeTokensFile({
      name: "me",
      accessToken: "brw-tok-old",
      expiresAt: isoIn(-1),
      refreshToken: "long-lived-refresh",
    });
    const resolver = new OnDiskTokenResolver({
      loadClientInfo: (region) => cannedClientInfo("c1", region),
      refresh: () =>
        Promise.resolve(
          new OAuthTokens({
            access_token: new Secret("brw-tok-new"),
            refresh_token: null, // IdP didn't rotate
            expires_at: isoIn(1),
            scope: "read:project",
            token_type: "Bearer",
          }),
        ),
    });
    await expect(resolver.getBrowserToken("me", "us")).resolves.toBe(
      "brw-tok-new",
    );
    const newPayload = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    expect(newPayload["refresh_token"]).toBe("long-lived-refresh");
  });

  it("test_refresh_without_client_info_raises_oauth_refresh_error", async () => {
    writeTokensFile({
      name: "me",
      accessToken: "brw-tok-old",
      expiresAt: isoIn(-1),
      refreshToken: "r1",
    });
    const resolver = new OnDiskTokenResolver({
      loadClientInfo: () => null,
    });
    await expect(resolver.getBrowserToken("me", "us")).rejects.toMatchObject({
      code: "OAUTH_REFRESH_ERROR",
    });
  });
});

describe("TestPathLayout (test_token_resolver.py:368)", () => {
  it("test_account_dir_path", () => {
    const path = writeTokensFile({
      name: "me",
      accessToken: "x",
      expiresAt: isoIn(1),
    });
    expect(path).toBe(join(home, ".mp", "accounts", "me", "tokens.json"));
    expect(accountTokensPath("me")).toBe(path);
  });

  it.skipIf(!POSIX)("test_account_dir_permissions", () => {
    writeTokensFile({ name: "me", accessToken: "x", expiresAt: isoIn(1) });
    const dir = join(home, ".mp", "accounts", "me");
    expect(statSync(dir).mode & 0o7777).toBe(0o700);
  });
});

describe("TestConcurrentRefresh (test_token_resolver.py:390)", () => {
  it("test_two_racing_refreshers_both_get_tokens_and_disk_is_valid", async () => {
    // Python's two-thread barrier race translates to two concurrent
    // async callers whose injected refresh functions resolve together
    // (§3.3 disposition: concurrent async writers over the pid+counter
    // tmp scheme). The locked contract is identical: both callers get
    // tokens, the on-disk file parses cleanly, and the IdP was called
    // once PER CALLER (no single-flight guard at this layer).
    const path = writeTokensFile({
      name: "me",
      accessToken: "expired-tok",
      expiresAt: isoIn(-1),
      refreshToken: "brw-refresh-1",
    });
    let callCount = 0;
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const newExpires = isoIn(1);
    const resolver = new OnDiskTokenResolver({
      loadClientInfo: (region) => cannedClientInfo("dcr-client-1", region),
      refresh: async () => {
        callCount += 1;
        const myN = callCount;
        await gate;
        return new OAuthTokens({
          access_token: new Secret(`brw-tok-new-${myN}`),
          refresh_token: new Secret(`brw-refresh-${myN + 1}`),
          expires_at: newExpires,
          scope: "read:project",
          token_type: "Bearer",
        });
      },
    });
    const first = resolver.getBrowserToken("me", "us");
    const second = resolver.getBrowserToken("me", "us");
    releaseGate();
    const results = await Promise.all([first, second]);
    for (const r of results) {
      expect(r.startsWith("brw-tok-new-")).toBe(true);
    }
    const payload = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    expect(String(payload["access_token"]).startsWith("brw-tok-new-")).toBe(
      true,
    );
    expect(String(payload["refresh_token"]).startsWith("brw-refresh-")).toBe(
      true,
    );
    expect(callCount).toBe(2);
  });
});

describe("TestSymlinkRejection (test_token_resolver.py:509)", () => {
  it.skipIf(!POSIX)("test_symlinked_tokens_raises_oautherror", async () => {
    const accountDir = join(home, ".mp", "accounts", "personal");
    mkdirSync(accountDir, { recursive: true, mode: 0o700 });
    const attacker = join(home, "attacker_tokens.json");
    writeFileSync(
      attacker,
      JSON.stringify({
        access_token: "stolen-acc",
        expires_at: isoIn(1),
        token_type: "Bearer",
        scope: "read:project",
      }),
      "utf8",
    );
    chmodSync(attacker, 0o600);
    symlinkSync(attacker, join(accountDir, "tokens.json"));
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("personal", "us")).rejects.toThrow(
      /symlink/,
    );
  });

  it.skipIf(!POSIX)(
    "test_dangling_symlink_tokens_raises_oautherror",
    async () => {
      const accountDir = join(home, ".mp", "accounts", "personal");
      mkdirSync(accountDir, { recursive: true, mode: 0o700 });
      symlinkSync(join(home, "missing.json"), join(accountDir, "tokens.json"));
      const resolver = new OnDiskTokenResolver();
      await expect(resolver.getBrowserToken("personal", "us")).rejects.toThrow(
        /symlink/,
      );
    },
  );
});

describe("TestTokenResolverMalformed (test_042_edge_cases.py:240 — inbound b6-packets.md:1032)", () => {
  it("test_malformed_expires_at_raises", async () => {
    writeTokensFile({
      name: "x",
      accessToken: "tok",
      expiresAt: "not-a-date",
    });
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("x", "us")).rejects.toThrow(
      OAuthError,
    );
  });

  it("test_truncated_json_raises", async () => {
    const dir = join(home, ".mp", "accounts", "x");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const p = join(dir, "tokens.json");
    writeFileSync(p, '{"access_token": "tok"', "utf8"); // truncated
    if (POSIX) {
      chmodSync(p, 0o600);
    }
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("x", "us")).rejects.toThrow(
      new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)),
    );
  });

  it("test_expired_no_refresh_uses_token_error_code", async () => {
    writeTokensFile({ name: "x", accessToken: "tok", expiresAt: isoIn(-1) });
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("x", "us")).rejects.toMatchObject({
      code: "OAUTH_TOKEN_ERROR",
    });
  });

  it("test_expired_with_refresh_uses_refresh_error_code", async () => {
    writeTokensFile({
      name: "x",
      accessToken: "tok",
      expiresAt: isoIn(-1),
      refreshToken: "ref",
    });
    // No DCR client info on disk → the refresh path fails with the
    // refresh-specific code (the Python test relies on the same
    // missing-client-info state).
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("x", "us")).rejects.toMatchObject({
      code: "OAUTH_REFRESH_ERROR",
    });
  });
});

describe("ASR-F4c re-take (test_042_edge_cases.py:655 — b7-reviewA-resolution.md)", () => {
  it("test_session_to_credentials_oauth_browser_missing_tokens_raises", async () => {
    // The B7 translation drove this through an injected fake resolver;
    // this re-take materializes the bearer through the REAL
    // OnDiskTokenResolver over an isolated HOME with no tokens on disk
    // (the Python client's `current_auth_header` eager-probe twin is
    // the resolver call itself — the session auth header is built
    // per-request from `getBrowserToken`, R2.9).
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("me", "us")).rejects.toMatchObject({
      code: "OAUTH_TOKEN_ERROR",
    });
  });

  it("re-take: storage sanity — a seeded file resolves through the same chain", async () => {
    // Anti-vacuity guard for the re-take: the same resolver + HOME
    // layout succeeds once tokens exist, proving the failure above
    // came from the missing file, not from path wiring.
    writeTokensFile({ name: "me", accessToken: "ok", expiresAt: isoIn(1) });
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("me", "us")).resolves.toBe("ok");
    // The DCR-store seam reads the same storage root override world
    // (`token_resolver.py:211-227` — region-shared client info).
    expect(new OAuthStorage().storageDir).toBe(join(home, ".mp", "oauth"));
  });
});

// B8-ARB-A SEM-F6 family ripple (b8-reviewA-resolution.md): Python's
// symlink-probe catch is `except OSError` (`token_resolver.py:104-111`)
// — errno-bearing lstat failures wrap into the coded OAuthError exactly
// like the symlink refusal; pre-fix TS rethrew them uncoded.
describe("B8-ARB-A SEM-F6 probe errno-wrap lock (token_resolver.py:104-111)", () => {
  it.skipIf(!POSIX || process.getuid?.() === 0)(
    "unreadable accounts dir at the probe wraps into OAUTH_TOKEN_ERROR",
    async () => {
      const accountsDir = join(home, ".mp", "accounts");
      mkdirSync(accountsDir, { recursive: true, mode: 0o700 });
      chmodSync(accountsDir, 0o000);
      cleanups.push(() => {
        chmodSync(accountsDir, 0o700);
      });
      const resolver = new OnDiskTokenResolver();
      let caught: unknown = null;
      try {
        await resolver.getBrowserToken("me", "us");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(OAuthError);
      expect((caught as OAuthError).code).toBe("OAUTH_TOKEN_ERROR");
    },
  );
});

// B8-ARB-B F1 (b8-reviewB-resolution.md): the per-account read path is
// `OAuthTokens.model_validate_json` in Python (`token_resolver.py:134-148`)
// — Pydantic-LAX, so numeric epoch-seconds `expires_at` (and its
// numeric-string spelling) is ACCEPTED and converted to an aware UTC
// datetime (live probe: 1893456000 → 2030-01-01T00:00:00+00:00). The
// TS twin routes the same lax mirror (`coerceLaxExpiresAt`) before
// `parseOAuthTokens`.
describe("B8-ARB-B F1 pydantic-lax expires_at at the resolver read (token_resolver.py:134-148)", () => {
  /** Write a tokens.json with an ARBITRARY (non-string) expires_at. */
  function writeRawTokensFile(name: string, expiresAt: unknown): string {
    const dir = join(home, ".mp", "accounts", name);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, "tokens.json");
    writeFileSync(
      path,
      JSON.stringify({
        access_token: "at-epoch",
        refresh_token: "rt",
        expires_at: expiresAt,
        scope: "read",
        token_type: "Bearer",
      }),
      "utf8",
    );
    if (POSIX) {
      chmodSync(path, 0o600);
    }
    return path;
  }

  it("numeric epoch-seconds expires_at serves the token (py: pydantic lax)", async () => {
    writeRawTokensFile("acme", 1_893_456_000); // 2030-01-01T00:00:00Z
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("acme", "us")).resolves.toBe(
      "at-epoch",
    );
  });

  it("numeric-STRING epoch expires_at serves the token (speedate parses digit strings as epochs)", async () => {
    writeRawTokensFile("acme", "1893456000");
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("acme", "us")).resolves.toBe(
      "at-epoch",
    );
  });

  it("epoch beyond year 9999 still rejects (speedate range: dates after 9999 are invalid)", async () => {
    writeRawTokensFile("acme", 253_402_300_800_000); // 10000-01-01 in ms
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("acme", "us")).rejects.toMatchObject({
      code: "OAUTH_TOKEN_ERROR",
    });
  });
});
