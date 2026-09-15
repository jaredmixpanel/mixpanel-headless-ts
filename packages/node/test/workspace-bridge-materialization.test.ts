// Bridge token materialization on node startup. Mirrors
// tests/unit/test_workspace_init.py::TestBridgeTokenMaterialization over the
// real bridge/env/config wiring (it needs node:fs, so it lives here rather
// than in core); additive: the default `createNodeWorkspaceSources()`
// composition materializes end-to-end through the real resolver chain.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Workspace } from "@mixpanel-headless/core";

import {
  bridgeViewFromFile,
  loadBridgeForStartup,
} from "../src/auth/bridge.js";
import { OnDiskTokenResolver } from "../src/auth/token-resolver.js";
import {
  createNodeResolverSources,
  createNodeWorkspaceSources,
} from "../src/auth-effects.js";
import { createNodeConfigSource } from "../src/config-writes.js";
import { createNodeEnv } from "../src/env.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

const POSIX = process.platform !== "win32";

const cleanups: Array<() => void> = [];
let home = "";

beforeEach(() => {
  scrubMpEnv();
  home = makeTempDir(cleanups);
  vi.stubEnv("HOME", home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/** ISO instant `hours` out, `+00:00`-suffixed (Python isoformat). */
function isoIn(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "+00:00");
}

describe("bridge token materialization", () => {
  // python: test_workspace_init.py::TestBridgeTokenMaterialization
  it("overwrites stale on-disk tokens with the bridge's", () => {
    // python: test_bridge_overwrites_stale_on_disk_tokens
    const accountName = "personal";
    const accountsDir = join(home, ".mp", "accounts", accountName);
    mkdirSync(accountsDir, { recursive: true, mode: 0o700 });
    const stalePath = join(accountsDir, "tokens.json");
    writeFileSync(
      stalePath,
      JSON.stringify({
        access_token: "STALE",
        expires_at: isoIn(-1),
        scope: "read",
        token_type: "Bearer",
      }),
      "utf8",
    );
    if (POSIX) {
      chmodSync(stalePath, 0o600);
    }

    const freshExpires = isoIn(1);
    const bridgePath = join(home, "bridge.json");
    writeFileSync(
      bridgePath,
      JSON.stringify({
        version: 2,
        account: {
          type: "oauth_browser",
          name: accountName,
          region: "us",
        },
        tokens: {
          access_token: "FRESH",
          refresh_token: "FRESH-REFRESH",
          expires_at: freshExpires,
          scope: "read",
          token_type: "Bearer",
        },
        project: "12345",
      }),
      "utf8",
    );
    if (POSIX) {
      chmodSync(bridgePath, 0o600);
    }
    vi.stubEnv("MP_AUTH_FILE", bridgePath);

    // The `Workspace()` twin: startup bridge load (with the
    // materialization side effect) feeding the resolver sources —
    // exactly the `workspace.py` sequence.
    const bridge = loadBridgeForStartup();
    expect(bridge).not.toBeNull();
    const config = createNodeConfigSource({
      configPath: join(home, ".mp", "config.toml"),
    });
    const ws = new Workspace({
      sources: {
        env: createNodeEnv(),
        config,
        bridge: bridge === null ? null : bridgeViewFromFile(bridge),
      },
    });
    expect(ws.account.name).toBe(accountName);

    const onDisk = JSON.parse(readFileSync(stalePath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(onDisk["access_token"]).toBe("FRESH");
    expect(onDisk["refresh_token"]).toBe("FRESH-REFRESH");
    expect(onDisk["expires_at"]).toBe(freshExpires);
  });

  it("the materialized payload flows through the real resolver chain", async () => {
    // The bearer downstream of materialization comes from
    // OnDiskTokenResolver over the freshly-written per-account file —
    // the Cowork courier contract end-to-end.
    const accountName = "personal";
    const bridgePath = join(home, "bridge.json");
    writeFileSync(
      bridgePath,
      JSON.stringify({
        version: 2,
        account: { type: "oauth_browser", name: accountName, region: "us" },
        tokens: {
          access_token: "FRESH",
          refresh_token: "FRESH-REFRESH",
          expires_at: isoIn(1),
          scope: "", // empty scope gets the "read" default on materialization
          token_type: "Bearer",
        },
      }),
      "utf8",
    );
    if (POSIX) {
      chmodSync(bridgePath, 0o600);
    }
    vi.stubEnv("MP_AUTH_FILE", bridgePath);

    loadBridgeForStartup();
    const written = JSON.parse(
      readFileSync(
        join(home, ".mp", "accounts", accountName, "tokens.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    // Empty bridge scope → "read" default (workspace.py).
    expect(written["scope"]).toBe("read");

    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken(accountName, "us")).resolves.toBe(
      "FRESH",
    );
  });
});

// B8-ARB-A SEM-F1 (b8-reviewA-resolution.md): the `workspace.py:476-513`
// startup sequence must be reachable from a SHIPPED node composition —
// not only by hand-calling `loadBridgeForStartup()` as the class above
// does. `createNodeWorkspaceSources()` is that composition (facade
// construction); `createNodeResolverSources()` stays PURE (in-session
// `use()` re-resolution must never clobber tokens refreshed mid-session
// with a stale bridge payload — B8-N2-notes.md disclosure #1).
describe("default node workspace composition materializes bridge tokens", () => {
  /** Write a fresh oauth_browser bridge and point MP_AUTH_FILE at it. */
  function seedBridge(accountName: string): string {
    const bridgePath = join(home, "bridge.json");
    writeFileSync(
      bridgePath,
      JSON.stringify({
        version: 2,
        account: { type: "oauth_browser", name: accountName, region: "us" },
        tokens: {
          access_token: "FRESH",
          refresh_token: "FRESH-REFRESH",
          expires_at: isoIn(1),
          scope: "read",
          token_type: "Bearer",
        },
        project: "12345",
      }),
      "utf8",
    );
    if (POSIX) {
      chmodSync(bridgePath, 0o600);
    }
    vi.stubEnv("MP_AUTH_FILE", bridgePath);
    return join(home, ".mp", "accounts", accountName, "tokens.json");
  }

  it("fresh HOME + bridge, no per-account tokens: Workspace over createNodeWorkspaceSources() succeeds end-to-end (the Cowork courier contract)", async () => {
    const tokensPath = seedBridge("personal");

    const ws = new Workspace({
      sources: createNodeWorkspaceSources({
        configPath: join(home, ".mp", "config.toml"),
      }),
    });
    expect(ws.account.name).toBe("personal");

    // The side effect ran: the per-account file exists...
    const written = JSON.parse(readFileSync(tokensPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(written["access_token"]).toBe("FRESH");
    // ...and the first token materialization through the REAL resolver
    // serves the bridge bearer (Python-green; pre-fix this threw
    // OAUTH_TOKEN_ERROR "No OAuth tokens found").
    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken("personal", "us")).resolves.toBe(
      "FRESH",
    );
  });

  it("createNodeResolverSources() stays pure with no materialization side effect", () => {
    const tokensPath = seedBridge("personal");

    const sources = createNodeResolverSources({
      configPath: join(home, ".mp", "config.toml"),
    });
    expect(sources.bridge?.account.name).toBe("personal");
    // Pure loader: the resolver rung sees the bridge, but nothing was
    // written to the per-account path (Python `load_bridge()` twin —
    // materialization is the Workspace() constructor's alone).
    expect(existsSync(tokensPath)).toBe(false);
  });
});
