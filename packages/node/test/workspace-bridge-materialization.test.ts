// Layer-3 translation of
// `tests/unit/test_workspace_init.py::TestBridgeTokenMaterialization`
// (:167) — the inbound B7 deferral (`b7-packets.md` §7; b8-packets.md
// §3.3 row 8).
//
// HOME DEVIATION FROM THE PACKET ROW (disclosed, shard notes): the
// packet places this in `packages/core/test/workspace/
// workspace-init.test.ts`, but the repo's eslint core-purity boundary
// (`eslint.config.js:47-75`) covers ALL of `packages/core/**/*.ts`
// including tests — the on-disk fixture setup (node:fs, process.env)
// cannot live there. The class is translated HERE over the REAL node
// bridge/env/config wiring; the core file's deferral-header row is
// dropped and now cites this home (header rule: zero open deferrals).
//
// Python's `Workspace()` constructor performs the bridge-token
// materialization side effect (`workspace.py:476-513`); the node twin
// is `loadBridgeForStartup()` (bridge.ts), which the N3 default-source
// wiring composes into `new Workspace({})`. The test drives it exactly
// as that wiring will, then proves the payload flows through the REAL
// resolver chain (`OnDiskTokenResolver`).

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Workspace } from "../../core/src/workspace.js";
import {
  loadBridgeForStartup,
  bridgeViewFromFile,
} from "../src/auth/bridge.js";
import { createNodeConfigSource } from "../src/config-writes.js";
import { createNodeEnv } from "../src/env.js";
import { OnDiskTokenResolver } from "../src/auth/token-resolver.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

const POSIX = process.platform !== "win32";

const cleanups: (() => void)[] = [];
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

/** ISO instant `hours` out, `+00:00`-suffixed (Python isoformat). */
function isoIn(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "+00:00");
}

describe("TestBridgeTokenMaterialization (test_workspace_init.py:167)", () => {
  it("test_bridge_overwrites_stale_on_disk_tokens", () => {
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
    process.env["MP_AUTH_FILE"] = bridgePath;

    // The `Workspace()` twin: startup bridge load (with the
    // materialization side effect) feeding the resolver sources —
    // exactly the `workspace.py:476-513` sequence.
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

  it("materialized payload flows through the REAL resolver chain (packet §3.3 row 8)", async () => {
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
    process.env["MP_AUTH_FILE"] = bridgePath;

    loadBridgeForStartup();
    const written = JSON.parse(
      readFileSync(
        join(home, ".mp", "accounts", accountName, "tokens.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    // Empty bridge scope → "read" default (workspace.py:499-505).
    expect(written["scope"]).toBe("read");

    const resolver = new OnDiskTokenResolver();
    await expect(resolver.getBrowserToken(accountName, "us")).resolves.toBe(
      "FRESH",
    );
  });
});
