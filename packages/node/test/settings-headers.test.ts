// Layer-3 translation of `tests/unit/test_settings_headers.py` — the
// B8-N1 classes only (b8-packets.md §2.3 row 3):
//
// - TestSettingsHeaderAttachment :52 → translated below (a
//   `[settings].custom_header` written by the real node ConfigManager
//   reaches `Session.headers` through `resolveSession`).
// - TestNoEnvMutation :71            → translated below (resolution over
//   the real `createNodeEnv` bag never mutates `process.env`).
// - TestBridgeHeaderAttachment :97   → translated below at B8-N2
//   (bridge headers reach `Session.headers` through `BridgeView`;
//   packet §3.3 row 7).
// - TestSessionHeadersOnOutboundRequests :156 → translated at B0, NOT
//   re-translated (playbook `:244-246`).

import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveSession, Secret } from "@mixpanel-headless/core";

import { createNodeBridgeEffects } from "../src/auth/bridge.js";
import { ConfigManager } from "../src/config.js";
import { createNodeConfigSource } from "../src/config-writes.js";
import { createNodeEnv } from "../src/env.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

const cleanups: Array<() => void> = [];

beforeEach(() => {
  // The Python suite's autouse `_isolated_home` + conftest MP_* scrub:
  // node env wiring reads the REAL process.env, so tests scrub MP_*
  // first and restore after (helpers.ts).
  scrubMpEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

/** Build the `cm_with_account_active` fixture over a tmp config path. */
function cmWithAccountActive(): {
  config: ReturnType<typeof createNodeConfigSource>;
  cm: ConfigManager;
} {
  const dir = makeTempDir(cleanups);
  const configPath = join(dir, "config.toml");
  const config = createNodeConfigSource({ configPath });
  config.addAccount("team", {
    type: "service_account",
    region: "us",
    default_project: "3713224",
    username: "team.sa",
    secret: new Secret("team-secret"),
  });
  config.setActive({ account: "team" });
  return { config, cm: new ConfigManager({ configPath }) };
}

describe("TestSettingsHeaderAttachment", () => {
  it("test_session_carries_setting_header", () => {
    const { config, cm } = cmWithAccountActive();
    cm.setCustomHeader({ name: "X-Foo", value: "bar" });
    const session = resolveSession(
      {},
      { env: createNodeEnv(), config, bridge: null },
    );
    expect([...session.headers]).toStrictEqual([["X-Foo", "bar"]]);
  });

  it("test_no_setting_header_means_empty_dict", () => {
    const { config } = cmWithAccountActive();
    const session = resolveSession(
      {},
      { env: createNodeEnv(), config, bridge: null },
    );
    expect(session.headers.size).toBe(0);
  });
});

describe("TestNoEnvMutation", () => {
  it("test_settings_header_does_not_set_env_vars", () => {
    // FR-023: snapshot process.env before/after resolution — identical.
    // The legacy v2 code mutated MP_CUSTOM_HEADER_NAME/_VALUE during
    // resolution; the node env bag is read-only at call time.
    const { config, cm } = cmWithAccountActive();
    cm.setCustomHeader({ name: "X-Hdr", value: "v" });
    const before = { ...process.env };
    resolveSession({}, { env: createNodeEnv(), config, bridge: null });
    const after = { ...process.env };
    expect(after).toStrictEqual(before);
  });
});

describe("TestBridgeHeaderAttachment (test_settings_headers.py:97 — B8-N2)", () => {
  /** Write the SA bridge fixture and point MP_AUTH_FILE at it. */
  function writeBridgeFixture(headers: Record<string, string>): string {
    const dir = makeTempDir(cleanups);
    const bridgePath = join(dir, "bridge.json");
    writeFileSync(
      bridgePath,
      JSON.stringify({
        version: 2,
        account: {
          type: "service_account",
          name: "bridged",
          region: "us",
          username: "bridge.user",
          secret: "bridge-secret",
        },
        project: "3018488",
        headers,
      }),
      "utf8",
    );
    if (process.platform !== "win32") {
      chmodSync(bridgePath, 0o600);
    }
    vi.stubEnv("MP_AUTH_FILE", bridgePath);
    return bridgePath;
  }

  it("test_bridge_headers_populate_session", () => {
    const { config } = cmWithAccountActive();
    writeBridgeFixture({ "X-Mixpanel-Cluster": "internal-1" });
    const session = resolveSession(
      {},
      {
        env: createNodeEnv(),
        config,
        bridge: createNodeBridgeEffects().load(),
      },
    );
    expect(session.headers.get("X-Mixpanel-Cluster")).toBe("internal-1");
    expect(session.account.name).toBe("bridged");
  });

  it("test_bridge_does_not_mutate_environ", () => {
    const { config } = cmWithAccountActive();
    writeBridgeFixture({ "X-Hdr": "v" });
    const before = { ...process.env };
    resolveSession(
      {},
      {
        env: createNodeEnv(),
        config,
        bridge: createNodeBridgeEffects().load(),
      },
    );
    const after = { ...process.env };
    expect(after).toStrictEqual(before);
  });
});
