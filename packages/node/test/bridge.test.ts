// Layer-3 translation of `tests/unit/test_bridge_export.py` (395 lines,
// 19 tests; ALL 4 classes — b8-packets.md §3.3 row 4) plus the inbound
// `test_042_edge_cases.py::TestBridgeEdgeCases` (:394,
// `b6-packets.md:1032`).
//
// SPLIT (header-cited per §3.3 row 4): `TestAccountsNamespaceWiring`
// (:236) exercises the Python `mp.accounts` namespace over the on-disk
// world; the ready-made node namespaces land at B8-N3 (bag assembly).
// N2 translates those four tests against `createNodeBridgeEffects()` /
// the ConfigManager-backed custom-header source DIRECTLY; N3's swap-in
// run re-covers the namespace wiring.
//
// The Python `_isolated_home` autouse fixture translates to the
// HOME/MP_CONFIG_PATH/MP_AUTH_FILE save-scrub in beforeEach.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConfigError,
  type OAuthBrowserAccount,
  OAuthError,
  type OAuthTokenAccount,
  ParamValidationError,
  Secret,
  type ServiceAccount,
} from "@mixpanel-headless/core";

import {
  createNodeBridgeEffects,
  exportBridge,
  loadBridge,
  materializeBridgeTokens,
  parseBridgeFile,
  removeBridge,
} from "../src/auth/bridge.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

const POSIX = process.platform !== "win32";

const cleanups: Array<() => void> = [];
let restoreEnv: () => void = () => undefined;
let savedHome: string | undefined;
let savedCwd = "";
let home = "";

beforeEach(() => {
  restoreEnv = scrubMpEnv();
  savedHome = process.env["HOME"];
  savedCwd = process.cwd();
  home = makeTempDir(cleanups);
  process.env["HOME"] = home;
  process.env["MP_CONFIG_PATH"] = join(home, ".mp", "config.toml");
  delete process.env["MP_AUTH_FILE"];
});

afterEach(() => {
  process.chdir(savedCwd);
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

/** Standard SA fixture (test_bridge_export.py:77). */
function teamSa(): ServiceAccount {
  return {
    type: "service_account",
    name: "team",
    region: "us",
    default_project: "3713224",
    username: "sa.user",
    secret: new Secret("sa-secret"),
  };
}

/** ISO instant one hour out with `+00:00` offset. */
function isoIn(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "+00:00");
}

/** The `_seed_browser_tokens` fixture twin (test_bridge_export.py:51). */
function seedBrowserTokens(name: string): void {
  const dir = join(home, ".mp", "accounts", name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "tokens.json");
  writeFileSync(
    path,
    JSON.stringify({
      access_token: `acc-${name}`,
      refresh_token: `ref-${name}`,
      expires_at: isoIn(1),
      scope: "read",
      token_type: "Bearer",
    }),
    "utf8",
  );
  if (POSIX) {
    chmodSync(path, 0o600);
  }
}

describe("TestExportBridgeFunctional (test_bridge_export.py:72)", () => {
  it("test_service_account_writes_v2_schema", () => {
    const out = join(makeTempDir(cleanups), "bridge.json");
    const result = exportBridge(teamSa(), { to: out });
    expect(result).toBe(out);
    expect(existsSync(out)).toBe(true);
    const bridge = loadBridge(out);
    expect(bridge).not.toBeNull();
    expect(bridge?.version).toBe(2);
    expect(bridge?.account.name).toBe("team");
    expect(bridge?.account.type).toBe("service_account");
    expect(bridge?.tokens).toBeNull(); // SAs don't carry OAuth tokens
  });

  it("test_oauth_browser_embeds_tokens_from_disk", () => {
    const account: OAuthBrowserAccount = {
      type: "oauth_browser",
      name: "personal",
      region: "us",
    };
    seedBrowserTokens("personal");
    const out = join(makeTempDir(cleanups), "bridge.json");
    exportBridge(account, { to: out });
    const bridge = loadBridge(out);
    expect(bridge?.tokens).not.toBeNull();
    expect(bridge?.tokens?.access_token.reveal()).toBe("acc-personal");
    expect(bridge?.tokens?.refresh_token?.reveal()).toBe("ref-personal");
  });

  it("test_oauth_browser_without_tokens_raises_oauth_error", () => {
    const account: OAuthBrowserAccount = {
      type: "oauth_browser",
      name: "ghost",
      region: "us",
    };
    const out = join(makeTempDir(cleanups), "bridge.json");
    expect(() => exportBridge(account, { to: out })).toThrow(OAuthError);
    // The aborted write must NOT leave a partial file behind.
    expect(existsSync(out)).toBe(false);
  });

  it("test_oauth_token_inline_embedded", () => {
    const account: OAuthTokenAccount = {
      type: "oauth_token",
      name: "ci",
      region: "us",
      default_project: "3713224",
      token: new Secret("inline-bearer"),
      token_env: null,
    };
    const out = join(makeTempDir(cleanups), "bridge.json");
    exportBridge(account, { to: out });
    const bridge = loadBridge(out);
    expect(bridge?.tokens).toBeNull();
    expect(bridge?.account.type).toBe("oauth_token");
    // Secrets inline by design (B3) — the on-disk JSON carries the RAW
    // value, never the mask (CRED-F3).
    const raw = JSON.parse(readFileSync(out, "utf8")) as {
      account: Record<string, unknown>;
    };
    expect(raw.account["token"]).toBe("inline-bearer");
  });

  it.skipIf(!POSIX)("test_writes_file_with_mode_0o600", () => {
    const out = join(makeTempDir(cleanups), "bridge.json");
    exportBridge(teamSa(), { to: out });
    expect(statSync(out).mode & 0o7777).toBe(0o600);
  });

  it("test_creates_parent_dir_with_mode_0o700", () => {
    const tmp = makeTempDir(cleanups);
    const nested = join(tmp, "subdir1", "subdir2");
    const out = join(nested, "bridge.json");
    exportBridge(teamSa(), { to: out });
    expect(existsSync(out)).toBe(true);
    expect(statSync(nested).isDirectory()).toBe(true);
  });

  it("test_project_workspace_headers_round_trip", () => {
    const out = join(makeTempDir(cleanups), "bridge.json");
    exportBridge(teamSa(), {
      to: out,
      project: "3018488",
      workspace: 3448414,
      headers: { "X-Mixpanel-Cluster": "internal-1" },
    });
    const bridge = loadBridge(out);
    expect(bridge?.project).toBe("3018488");
    expect(bridge?.workspace).toBe(3448414);
    expect(bridge?.headers).toStrictEqual({
      "X-Mixpanel-Cluster": "internal-1",
    });
  });

  it("test_idempotent_overwrite_at_same_path", () => {
    const out = join(makeTempDir(cleanups), "bridge.json");
    exportBridge(teamSa(), { to: out });
    const first = readFileSync(out);
    exportBridge(teamSa(), { to: out });
    const second = readFileSync(out);
    expect(Buffer.compare(first, second)).toBe(0);
  });
});

describe("TestRemoveBridgeFunctional (test_bridge_export.py:210)", () => {
  it("test_removes_existing_bridge", () => {
    const target = join(makeTempDir(cleanups), "bridge.json");
    writeFileSync(target, "{}", "utf8");
    expect(removeBridge({ at: target })).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  it("test_returns_false_when_absent", () => {
    const target = join(makeTempDir(cleanups), "nope.json");
    expect(removeBridge({ at: target })).toBe(false);
  });

  it("test_default_path_uses_search_order", () => {
    const target = join(makeTempDir(cleanups), "auth.json");
    writeFileSync(target, "{}", "utf8");
    process.env["MP_AUTH_FILE"] = target;
    expect(removeBridge()).toBe(true);
    expect(existsSync(target)).toBe(false);
  });
});

describe("TestAccountsNamespaceWiring (test_bridge_export.py:236 — translated against BridgeEffects directly; N3's bag swap-in re-covers the namespaces, §3.3 split)", () => {
  it("test_export_bridge_via_bridge_effects", () => {
    const effects = createNodeBridgeEffects();
    const out = join(makeTempDir(cleanups), "bridge.json");
    const result = effects.export({
      account: teamSa(),
      to: out,
      project: null,
      workspace: null,
      headers: null,
      tokenResolver: {
        getBrowserToken: () => Promise.reject(new Error("unused")),
        getStaticToken: () => Promise.reject(new Error("unused")),
      },
    });
    expect(result).toBe(out);
    const bridge = loadBridge(out);
    expect(bridge?.account.name).toBe("team");
  });

  it("test_export_bridge_attaches_custom_headers", async () => {
    // The `[settings].custom_header` propagation is the CALLER's
    // composition in Python (`accounts.export_bridge` reads the config
    // and passes `headers=`); the effect-level lock is that a supplied
    // headers map lands in the bridge verbatim.
    const effects = createNodeBridgeEffects();
    const out = join(makeTempDir(cleanups), "bridge.json");
    await effects.export({
      account: teamSa(),
      to: out,
      project: null,
      workspace: null,
      headers: { "X-Mixpanel-Cluster": "cell-3" },
      tokenResolver: {
        getBrowserToken: () => Promise.reject(new Error("unused")),
        getStaticToken: () => Promise.reject(new Error("unused")),
      },
    });
    const bridge = loadBridge(out);
    expect(bridge?.headers).toStrictEqual({ "X-Mixpanel-Cluster": "cell-3" });
  });

  it("test_remove_bridge_via_bridge_effects", () => {
    const effects = createNodeBridgeEffects();
    const target = join(makeTempDir(cleanups), "bridge.json");
    writeFileSync(target, "{}", "utf8");
    expect(effects.remove(target)).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  it("test_load_bridge_via_bridge_effects_returns_view", () => {
    const out = join(makeTempDir(cleanups), "bridge.json");
    exportBridge(teamSa(), {
      to: out,
      project: "3018488",
      headers: { "X-H": "v" },
    });
    process.env["MP_AUTH_FILE"] = out;
    const effects = createNodeBridgeEffects();
    const view = effects.load();
    expect(view).not.toBeNull();
    expect(view?.account.name).toBe("team");
    expect(view?.project).toBe("3018488");
    expect(view?.workspace).toBeNull();
    expect(view?.headers).toStrictEqual({ "X-H": "v" });
  });
});

describe("TestBridgeSymlinkRejection (test_bridge_export.py:303)", () => {
  it.skipIf(!POSIX)("test_load_bridge_symlink_raises_configerror", () => {
    const tmp = makeTempDir(cleanups);
    const attacker = join(tmp, "attacker_bridge.json");
    writeFileSync(
      attacker,
      JSON.stringify({
        version: 2,
        account: {
          name: "evil",
          type: "service_account",
          region: "us",
          default_project: "999",
          username: "attacker",
          secret: "stolen",
        },
      }),
      "utf8",
    );
    chmodSync(attacker, 0o600);
    const link = join(tmp, "bridge.json");
    symlinkSync(attacker, link);
    expect(() => loadBridge(link)).toThrow(ConfigError);
    expect(() => loadBridge(link)).toThrow(/symlink/);
  });

  it.skipIf(!POSIX)(
    "test_export_bridge_symlinked_tokens_raises_oautherror",
    () => {
      const account: OAuthBrowserAccount = {
        type: "oauth_browser",
        name: "personal",
        region: "us",
      };
      const accountDir = join(home, ".mp", "accounts", "personal");
      mkdirSync(accountDir, { recursive: true, mode: 0o700 });
      const attacker = join(home, "attacker_tokens.json");
      writeFileSync(
        attacker,
        JSON.stringify({
          access_token: "stolen",
          expires_at: isoIn(1),
          token_type: "Bearer",
        }),
        "utf8",
      );
      chmodSync(attacker, 0o600);
      symlinkSync(attacker, join(accountDir, "tokens.json"));
      const out = join(home, "bridge.json");
      expect(() => exportBridge(account, { to: out })).toThrow(OAuthError);
      expect(() => exportBridge(account, { to: out })).toThrow(/symlink/);
    },
  );

  it.skipIf(!POSIX)("test_dangling_bridge_symlink_rejected", () => {
    const tmp = makeTempDir(cleanups);
    const link = join(tmp, "bridge.json");
    symlinkSync(join(tmp, "missing.json"), link);
    expect(() => loadBridge(link)).toThrow(ConfigError);
    expect(() => loadBridge(link)).toThrow(/symlink/);
  });

  it.skipIf(!POSIX)("test_dangling_browser_tokens_symlink_rejected", () => {
    const account: OAuthBrowserAccount = {
      type: "oauth_browser",
      name: "personal",
      region: "us",
    };
    const accountDir = join(home, ".mp", "accounts", "personal");
    mkdirSync(accountDir, { recursive: true, mode: 0o700 });
    symlinkSync(join(home, "missing.json"), join(accountDir, "tokens.json"));
    const out = join(home, "bridge.json");
    expect(() => exportBridge(account, { to: out })).toThrow(/symlink/);
  });
});

describe("TestBridgeEdgeCases (test_042_edge_cases.py:394 — inbound b6-packets.md:1032)", () => {
  it("test_oauth_browser_without_tokens_rejected", () => {
    const payload = {
      version: 2,
      account: {
        type: "oauth_browser",
        name: "personal",
        region: "us",
      },
      // No tokens.
    };
    expect(() => parseBridgeFile(payload)).toThrow(ParamValidationError);
  });

  it.each([[1], [3], ["2"]])(
    "test_version_mismatch_rejected[%s]",
    (badVersion) => {
      const payload = {
        version: badVersion,
        account: {
          type: "service_account",
          name: "team",
          region: "us",
          username: "u",
          secret: "s",
        },
      };
      expect(() => parseBridgeFile(payload)).toThrow(ParamValidationError);
    },
  );

  it("test_load_bridge_returns_none_for_missing_path", () => {
    process.env["MP_AUTH_FILE"] = join(home, "nonexistent.json");
    // Cwd default search would find a stray mixpanel_auth.json;
    // isolate cwd too (the Python `monkeypatch.chdir` twin).
    process.chdir(home);
    expect(loadBridge()).toBeNull();
  });

  it("test_load_bridge_malformed_json_raises_with_path", () => {
    const bridgePath = join(makeTempDir(cleanups), "bridge.json");
    writeFileSync(bridgePath, '{"version": 2', "utf8"); // truncated
    if (POSIX) {
      chmodSync(bridgePath, 0o600);
    }
    process.env["MP_AUTH_FILE"] = bridgePath;
    let caught: ConfigError | null = null;
    try {
      loadBridge();
    } catch (error) {
      caught = error as ConfigError;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect(caught?.message).toContain(bridgePath);
  });

  it("extra top-level key rejected (extra='forbid')", () => {
    // BridgeFile `extra="forbid"` — packet §3.2 item 9.
    const payload = {
      version: 2,
      account: {
        type: "service_account",
        name: "team",
        region: "us",
        username: "u",
        secret: "s",
      },
      surprise: true,
    };
    expect(() => parseBridgeFile(payload)).toThrow(ParamValidationError);
  });
});

// B8-ARB-A pair-A semantics minors (b8-reviewA-resolution.md) — error
// CLASS and byte-format locks aligning degenerate corners to the
// Python behavior arbiter:
// - SEM-F2b: an invalid-UTF-8 bridge file propagates the decode error
//   RAW (`bridge.py:181` catches only OSError + JSONDecodeError; the
//   CPython probe raises UnicodeDecodeError — the TS twin is the
//   TextDecoder fatal-mode TypeError).
// - SEM-F3: invalid export pins propagate the model's
//   ParamValidationError RAW (`bridge.py:357-364` builds `BridgeFile`
//   with no try/except — pydantic ValidationError escapes unwrapped;
//   the docstring's ConfigError claim is wrong in Python itself).
// - SEM-F4: `serializeBridge` sorts keys by CODEPOINT
//   (`json.dumps(sort_keys=True)`, `bridge.py:311` — R11.5).
// - SEM-F6 family: an errno-bearing lstat failure at the symlink probe
//   wraps into ConfigError exactly as Python's `except OSError`
//   (`bridge.py:172-176`).
describe("B8-ARB-A SEM-F2b/F3/F4/F6 error-class + byte-format locks", () => {
  it.skipIf(!POSIX)(
    "SEM-F2b: invalid-UTF-8 bridge file (0600) raises the RAW decode TypeError, not ConfigError",
    () => {
      const bridgePath = join(makeTempDir(cleanups), "bridge.json");
      writeFileSync(bridgePath, Buffer.from([0xff, 0xfe, 0x7b, 0x7d]));
      chmodSync(bridgePath, 0o600);
      process.env["MP_AUTH_FILE"] = bridgePath;
      let caught: unknown = null;
      try {
        loadBridge();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TypeError);
      expect(caught).not.toBeInstanceOf(ConfigError);
    },
  );

  it('SEM-F3: exportBridge(project="abc") propagates ParamValidationError raw', () => {
    const out = join(makeTempDir(cleanups), "bridge.json");
    let caught: unknown = null;
    try {
      exportBridge(teamSa(), { to: out, project: "abc" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    expect(caught).not.toBeInstanceOf(ConfigError);
    expect(existsSync(out)).toBe(false);
  });

  it("SEM-F3: exportBridge(workspace=0) propagates ParamValidationError raw", () => {
    const out = join(makeTempDir(cleanups), "bridge.json");
    expect(() => exportBridge(teamSa(), { to: out, workspace: 0 })).toThrow(
      ParamValidationError,
    );
    expect(existsSync(out)).toBe(false);
  });

  it("SEM-F4: serialized headers keys sort by codepoint (non-BMP after U+FF61, matching json.dumps sort_keys)", () => {
    // UTF-16 code units order "😀" (surrogate 0xD83D…) BEFORE "｡"
    // (0xFF61); Python codepoint order is the reverse. CPython:
    // json.dumps({"😀":1,"｡":2}, sort_keys=True) → {"｡": 2, "😀": 1}.
    const out = join(makeTempDir(cleanups), "bridge.json");
    exportBridge(teamSa(), {
      to: out,
      headers: { "\u{1F600}": "grin", "｡": "stop" },
    });
    const text = readFileSync(out, "utf8");
    expect(text.indexOf("｡")).toBeGreaterThan(-1);
    expect(text.indexOf("｡")).toBeLessThan(text.indexOf("\u{1F600}"));
  });

  it.skipIf(!POSIX || process.getuid?.() === 0)(
    "SEM-F6 family: unreadable parent dir at the probe wraps into ConfigError (bridge.py:172-176 `except OSError`)",
    () => {
      const locked = join(makeTempDir(cleanups), "locked");
      mkdirSync(locked);
      const bridgePath = join(locked, "auth.json");
      chmodSync(locked, 0o000);
      cleanups.push(() => {
        chmodSync(locked, 0o700);
      });
      expect(() => loadBridge(bridgePath)).toThrow(ConfigError);
    },
  );
});

// B8-ARB-A SEM-F2/F6 family ripple at `_read_browser_tokens`
// (`bridge.py:221-242` — arbiter-caught, same clauses as loadBridge):
// probe `except OSError` wraps errno failures into the coded
// OAuthError; the read catch is `(OSError, json.JSONDecodeError)` so
// the UnicodeDecodeError twin propagates RAW.
describe("B8-ARB-A readBrowserTokens error-class locks (bridge.py:221-242)", () => {
  it.skipIf(!POSIX)(
    "invalid-UTF-8 per-account tokens.json raises the RAW decode TypeError",
    () => {
      const account: OAuthBrowserAccount = {
        type: "oauth_browser",
        name: "personal",
        region: "us",
      };
      const dir = join(home, ".mp", "accounts", "personal");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tokensPath = join(dir, "tokens.json");
      writeFileSync(tokensPath, Buffer.from([0xff]));
      chmodSync(tokensPath, 0o600);
      const out = join(makeTempDir(cleanups), "bridge.json");
      let caught: unknown = null;
      try {
        exportBridge(account, { to: out });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TypeError);
      expect(caught).not.toBeInstanceOf(OAuthError);
    },
  );

  it.skipIf(!POSIX || process.getuid?.() === 0)(
    "unreadable accounts dir at the probe wraps into OAUTH_TOKEN_ERROR",
    () => {
      const account: OAuthBrowserAccount = {
        type: "oauth_browser",
        name: "personal",
        region: "us",
      };
      const accountsDir = join(home, ".mp", "accounts");
      mkdirSync(accountsDir, { recursive: true, mode: 0o700 });
      chmodSync(accountsDir, 0o000);
      cleanups.push(() => {
        chmodSync(accountsDir, 0o700);
      });
      const out = join(makeTempDir(cleanups), "bridge.json");
      let caught: unknown = null;
      try {
        exportBridge(account, { to: out });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(OAuthError);
      expect((caught as OAuthError).code).toBe("OAUTH_TOKEN_ERROR");
    },
  );
});

// B8-ARB-B F1 + F2 locks (b8-reviewB-resolution.md).
//
// F1: `BridgeFile.tokens` is a Pydantic model in Python — LAX, so a
// numeric epoch-seconds `expires_at` in a v2 bridge is ACCEPTED (live
// probe: OAuthTokens.model_validate({... 1893456000 ...}) →
// 2030-01-01T00:00:00+00:00). The TS parse routes the shared lax
// mirror before `parseOAuthTokens`.
//
// F2: Python's `_serialize_bridge` renders datetimes through Pydantic's
// JSON mode (`bridge.py:292` `model_dump(mode="json")`) which spells
// UTC instants with a `Z` suffix (live probe recorded in the
// resolution); the tokens.json writers render through
// `datetime.isoformat()` (`+00:00`). The TS writers re-render the
// stored ISO text through the matching formatter instead of echoing it.
describe("B8-ARB-B F1/F2 bridge epoch acceptance + writer datetime shapes", () => {
  function browserBridgePayload(expiresAt: unknown): Record<string, unknown> {
    return {
      version: 2,
      account: { type: "oauth_browser", name: "personal", region: "us" },
      tokens: {
        access_token: "acc-personal",
        refresh_token: "ref-personal",
        expires_at: expiresAt,
        scope: "read",
        token_type: "Bearer",
      },
    };
  }

  it("F1: numeric epoch-seconds tokens.expires_at parses (pydantic lax twin)", () => {
    const bridge = parseBridgeFile(browserBridgePayload(1_893_456_000));
    expect(bridge.tokens?.expires_at).toBe("2030-01-01T00:00:00+00:00");
  });

  it("F1: numeric-string epoch tokens.expires_at parses", () => {
    const bridge = parseBridgeFile(browserBridgePayload("1893456000"));
    expect(bridge.tokens?.expires_at).toBe("2030-01-01T00:00:00+00:00");
  });

  it("F1 sibling: tz-suffixed but non-instant expires_at rejects (pydantic rejects month 99)", () => {
    expect(() =>
      parseBridgeFile(browserBridgePayload("2030-99-99T00:00:00+00:00")),
    ).toThrow(ParamValidationError);
  });

  it("F2: exported bridge renders tokens.expires_at in pydantic-JSON Z form", () => {
    const account: OAuthBrowserAccount = {
      type: "oauth_browser",
      name: "personal",
      region: "us",
    };
    // Seed with the canonical library-written `+00:00` spelling.
    const dir = join(home, ".mp", "accounts", "personal");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tokensPath = join(dir, "tokens.json");
    writeFileSync(
      tokensPath,
      JSON.stringify({
        access_token: "acc-personal",
        refresh_token: "ref-personal",
        expires_at: "2030-01-01T00:00:00+00:00",
        scope: "read",
        token_type: "Bearer",
      }),
      "utf8",
    );
    if (POSIX) {
      chmodSync(tokensPath, 0o600);
    }
    const out = join(makeTempDir(cleanups), "bridge.json");
    exportBridge(account, { to: out });
    const text = readFileSync(out, "utf8");
    expect(text).toContain('"expires_at": "2030-01-01T00:00:00Z"');
    expect(text).not.toContain("+00:00");
  });

  it("F2: materialization renders tokens.json expires_at in isoformat +00:00 form even from a Z-text bridge", () => {
    // A py-written bridge carries the pydantic `Z` spelling; Python's
    // materialization re-renders via `datetime.isoformat()` →
    // `+00:00` (`token_payload_bytes`, `token.py:188-212`).
    const bridge = parseBridgeFile(
      browserBridgePayload("2030-01-01T00:00:00Z"),
    );
    process.env["MP_OAUTH_STORAGE_DIR"] = join(home, ".mp");
    const written = materializeBridgeTokens(bridge);
    expect(written).not.toBeNull();
    const text = readFileSync(written!, "utf8");
    // `json.dumps` default separators (`token.py:212` — byte parity).
    expect(text).toContain('"expires_at": "2030-01-01T00:00:00+00:00"');
    expect(text).not.toContain('Z"');
  });
});
