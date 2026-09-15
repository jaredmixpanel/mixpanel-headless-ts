// exportBridge / removeBridge / loadBridge / parseBridgeFile and the node
// BridgeEffects. Mirrors tests/unit/test_bridge_export.py plus
// test_042_edge_cases.py::TestBridgeEdgeCases over an isolated HOME.
// Additive: error-class and byte-format corners (raw decode errors,
// codepoint key order, errno wrapping) and lax epoch acceptance.

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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
let savedCwd = "";
let home = "";

beforeEach(() => {
  scrubMpEnv();
  savedCwd = process.cwd();
  home = makeTempDir(cleanups);
  vi.stubEnv("HOME", home);
  vi.stubEnv("MP_CONFIG_PATH", join(home, ".mp", "config.toml"));
  vi.stubEnv("MP_AUTH_FILE", undefined);
});

afterEach(() => {
  process.chdir(savedCwd);
  vi.unstubAllEnvs();
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/** Standard SA fixture (test_bridge_export.py). */
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

/** The `_seed_browser_tokens` fixture twin. */
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

describe("exportBridge", () => {
  // python: test_bridge_export.py::TestExportBridgeFunctional
  it("writes a v2 bridge for a service account with no tokens", () => {
    // python: test_service_account_writes_v2_schema
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

  it("embeds the on-disk tokens for an oauth_browser account", () => {
    // python: test_oauth_browser_embeds_tokens_from_disk
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

  it("raises OAuthError and writes nothing when an oauth_browser account has no tokens", () => {
    // python: test_oauth_browser_without_tokens_raises_oauth_error
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

  it("embeds an inline oauth_token secret raw", () => {
    // python: test_oauth_token_inline_embedded
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
    // Secrets inline by design — the on-disk JSON carries the RAW
    // value, never the mask.
    const raw = JSON.parse(readFileSync(out, "utf8")) as {
      account: Record<string, unknown>;
    };
    expect(raw.account["token"]).toBe("inline-bearer");
  });

  it.skipIf(!POSIX)("writes the bridge file 0o600", () => {
    // python: test_writes_file_with_mode_0o600
    const out = join(makeTempDir(cleanups), "bridge.json");
    exportBridge(teamSa(), { to: out });
    expect(statSync(out).mode & 0o7777).toBe(0o600);
  });

  it("creates missing parent directories", () => {
    // python: test_creates_parent_dir_with_mode_0o700
    const tmp = makeTempDir(cleanups);
    const nested = join(tmp, "subdir1", "subdir2");
    const out = join(nested, "bridge.json");
    exportBridge(teamSa(), { to: out });
    expect(existsSync(out)).toBe(true);
    expect(statSync(nested).isDirectory()).toBe(true);
  });

  it("round-trips project, workspace and headers", () => {
    // python: test_project_workspace_headers_round_trip
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

  it("writes identical bytes when re-exported to the same path", () => {
    // python: test_idempotent_overwrite_at_same_path
    const out = join(makeTempDir(cleanups), "bridge.json");
    exportBridge(teamSa(), { to: out });
    const first = readFileSync(out);
    exportBridge(teamSa(), { to: out });
    const second = readFileSync(out);
    expect(Buffer.compare(first, second)).toBe(0);
  });
});

describe("removeBridge", () => {
  // python: test_bridge_export.py::TestRemoveBridgeFunctional
  it("removes an existing bridge and returns true", () => {
    // python: test_removes_existing_bridge
    const target = join(makeTempDir(cleanups), "bridge.json");
    writeFileSync(target, "{}", "utf8");
    expect(removeBridge({ at: target })).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  it("returns false when the bridge is absent", () => {
    // python: test_returns_false_when_absent
    const target = join(makeTempDir(cleanups), "nope.json");
    expect(removeBridge({ at: target })).toBe(false);
  });

  it("resolves the default path through MP_AUTH_FILE", () => {
    // python: test_default_path_uses_search_order
    const target = join(makeTempDir(cleanups), "auth.json");
    writeFileSync(target, "{}", "utf8");
    vi.stubEnv("MP_AUTH_FILE", target);
    expect(removeBridge()).toBe(true);
    expect(existsSync(target)).toBe(false);
  });
});

describe("BridgeEffects wiring", () => {
  // python: test_bridge_export.py::TestAccountsNamespaceWiring
  it("export writes a bridge through the effects bag", () => {
    // python: test_export_bridge_via_bridge_effects
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

  it("export lands a supplied headers map in the bridge verbatim", async () => {
    // python: test_export_bridge_attaches_custom_headers
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

  it("remove deletes the bridge through the effects bag", () => {
    // python: test_remove_bridge_via_bridge_effects
    const effects = createNodeBridgeEffects();
    const target = join(makeTempDir(cleanups), "bridge.json");
    writeFileSync(target, "{}", "utf8");
    expect(effects.remove(target)).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  it("load returns a BridgeView from MP_AUTH_FILE", () => {
    // python: test_load_bridge_via_bridge_effects_returns_view
    const out = join(makeTempDir(cleanups), "bridge.json");
    exportBridge(teamSa(), {
      to: out,
      project: "3018488",
      headers: { "X-H": "v" },
    });
    vi.stubEnv("MP_AUTH_FILE", out);
    const effects = createNodeBridgeEffects();
    const view = effects.load();
    expect(view).not.toBeNull();
    expect(view?.account.name).toBe("team");
    expect(view?.project).toBe("3018488");
    expect(view?.workspace).toBeNull();
    expect(view?.headers).toStrictEqual({ "X-H": "v" });
  });
});

describe("bridge symlink rejection", () => {
  // python: test_bridge_export.py::TestBridgeSymlinkRejection
  it.skipIf(!POSIX)("loadBridge rejects a symlinked bridge file", () => {
    // python: test_load_bridge_symlink_raises_configerror
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

  it.skipIf(!POSIX)("exportBridge rejects a symlinked tokens.json", () => {
    // python: test_export_bridge_symlinked_tokens_raises_oautherror
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
  });

  it.skipIf(!POSIX)("loadBridge rejects a dangling bridge symlink", () => {
    // python: test_dangling_bridge_symlink_rejected
    const tmp = makeTempDir(cleanups);
    const link = join(tmp, "bridge.json");
    symlinkSync(join(tmp, "missing.json"), link);
    expect(() => loadBridge(link)).toThrow(ConfigError);
    expect(() => loadBridge(link)).toThrow(/symlink/);
  });

  it.skipIf(!POSIX)(
    "exportBridge rejects a dangling tokens.json symlink",
    () => {
      // python: test_dangling_browser_tokens_symlink_rejected
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
    },
  );
});

describe("bridge file edge cases", () => {
  // python: test_042_edge_cases.py::TestBridgeEdgeCases
  it("parseBridgeFile rejects an oauth_browser bridge without tokens", () => {
    // python: test_oauth_browser_without_tokens_rejected
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
    "parseBridgeFile rejects version %s",
    (badVersion) => {
      // python: test_version_mismatch_rejected
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

  it("loadBridge returns null when MP_AUTH_FILE points at a missing file", () => {
    // python: test_load_bridge_returns_none_for_missing_path
    vi.stubEnv("MP_AUTH_FILE", join(home, "nonexistent.json"));
    // Cwd default search would find a stray mixpanel_auth.json;
    // isolate cwd too (the Python `monkeypatch.chdir` twin).
    process.chdir(home);
    expect(loadBridge()).toBeNull();
  });

  it("loadBridge raises ConfigError naming the path for malformed JSON", () => {
    // python: test_load_bridge_malformed_json_raises_with_path
    const bridgePath = join(makeTempDir(cleanups), "bridge.json");
    writeFileSync(bridgePath, '{"version": 2', "utf8"); // truncated
    if (POSIX) {
      chmodSync(bridgePath, 0o600);
    }
    vi.stubEnv("MP_AUTH_FILE", bridgePath);
    let caught: ConfigError | null = null;
    try {
      loadBridge();
    } catch (error) {
      caught = error as ConfigError;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect(caught?.message).toContain(bridgePath);
  });

  it("parseBridgeFile rejects an extra top-level key", () => {
    // BridgeFile is `extra="forbid"` in Python.
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

// Error-class and byte-format corners, each aligned to the observed
// Python behaviour:
// - an invalid-UTF-8 bridge file propagates the decode error raw
//   (`bridge.py` catches only OSError + JSONDecodeError; CPython raises
//   UnicodeDecodeError — the TS twin is the TextDecoder fatal-mode
//   TypeError);
// - invalid export pins propagate the model's ParamValidationError raw
//   (`bridge.py` builds `BridgeFile` with no try/except — pydantic
//   ValidationError escapes unwrapped; the docstring's ConfigError claim
//   is wrong in Python itself);
// - `serializeBridge` sorts keys by codepoint (`json.dumps(sort_keys=True)`);
// - an errno-bearing lstat failure at the symlink probe wraps into
//   ConfigError exactly as Python's `except OSError`.
describe("bridge error classes and byte format", () => {
  it.skipIf(!POSIX)(
    "an invalid-UTF-8 bridge file raises the raw decode TypeError, not ConfigError",
    () => {
      const bridgePath = join(makeTempDir(cleanups), "bridge.json");
      writeFileSync(bridgePath, Buffer.from([0xff, 0xfe, 0x7b, 0x7d]));
      chmodSync(bridgePath, 0o600);
      vi.stubEnv("MP_AUTH_FILE", bridgePath);
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

  it('exportBridge with project "abc" propagates ParamValidationError and writes nothing', () => {
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

  it("exportBridge with workspace 0 propagates ParamValidationError and writes nothing", () => {
    const out = join(makeTempDir(cleanups), "bridge.json");
    expect(() => exportBridge(teamSa(), { to: out, workspace: 0 })).toThrow(
      ParamValidationError,
    );
    expect(existsSync(out)).toBe(false);
  });

  it("serialises header keys in codepoint order like json.dumps sort_keys", () => {
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
    "an unreadable parent directory at the symlink probe wraps into ConfigError",
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

// `_read_browser_tokens` has the same clauses as loadBridge: the probe's
// `except OSError` wraps errno failures into the coded OAuthError; the
// read catch is `(OSError, json.JSONDecodeError)` so the
// UnicodeDecodeError twin propagates raw.
describe("readBrowserTokens error classes", () => {
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

// `BridgeFile.tokens` is a Pydantic model in Python — lax, so a numeric
// epoch-seconds `expires_at` in a v2 bridge is accepted (probe:
// OAuthTokens.model_validate({... 1893456000 ...}) →
// 2030-01-01T00:00:00+00:00). The TS parse routes the shared lax mirror
// before `parseOAuthTokens`.
//
// Python's `_serialize_bridge` renders datetimes through Pydantic's JSON
// mode (`model_dump(mode="json")`), which spells UTC instants with a `Z`
// suffix; the tokens.json writers render through `datetime.isoformat()`
// (`+00:00`). The TS writers re-render the stored ISO text through the
// matching formatter instead of echoing it.
describe("bridge epoch acceptance and writer datetime shapes", () => {
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

  it("parses a numeric epoch-seconds tokens.expires_at", () => {
    const bridge = parseBridgeFile(browserBridgePayload(1_893_456_000));
    expect(bridge.tokens?.expires_at).toBe("2030-01-01T00:00:00+00:00");
  });

  it("parses a numeric-string epoch tokens.expires_at", () => {
    const bridge = parseBridgeFile(browserBridgePayload("1893456000"));
    expect(bridge.tokens?.expires_at).toBe("2030-01-01T00:00:00+00:00");
  });

  it("rejects a tz-suffixed expires_at that is not a real instant", () => {
    expect(() =>
      parseBridgeFile(browserBridgePayload("2030-99-99T00:00:00+00:00")),
    ).toThrow(ParamValidationError);
  });

  it("renders tokens.expires_at with a Z suffix in the exported bridge", () => {
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
    // `+00:00` (`token_payload_bytes`, `token.py`).
    const bridge = parseBridgeFile(
      browserBridgePayload("2030-01-01T00:00:00Z"),
    );
    vi.stubEnv("MP_OAUTH_STORAGE_DIR", join(home, ".mp"));
    const written = materializeBridgeTokens(bridge);
    expect(written).not.toBeNull();
    const text = readFileSync(written!, "utf8");
    // `json.dumps` default separators (`token.py` — byte parity).
    expect(text).toContain('"expires_at": "2030-01-01T00:00:00+00:00"');
    expect(text).not.toContain('Z"');
  });
});
