// Layer-3 translation of `tests/unit/test_settings_headers.py` — the
// B8-N1 classes only (b8-packets.md §2.3 row 3):
//
// - TestSettingsHeaderAttachment :52 → translated below (a
//   `[settings].custom_header` written by the real node ConfigManager
//   reaches `Session.headers` through `resolveSession`).
// - TestNoEnvMutation :71            → translated below (resolution over
//   the real `createNodeEnv` bag never mutates `process.env`).
// - TestBridgeHeaderAttachment :97   → B8-N2 (bridge; packet §3.3).
// - TestSessionHeadersOnOutboundRequests :156 → translated at B0, NOT
//   re-translated (playbook `:244-246`).

import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveSession } from "../../core/src/auth/resolver.js";
import { Secret } from "../../core/src/secret.js";
import { ConfigManager } from "../src/config.js";
import { createNodeConfigSource } from "../src/config-writes.js";
import { createNodeEnv } from "../src/env.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

const cleanups: (() => void)[] = [];
let restoreEnv: () => void = () => {};

beforeEach(() => {
  // The Python suite's autouse `_isolated_home` + conftest MP_* scrub:
  // node env wiring reads the REAL process.env, so tests scrub MP_*
  // first and restore after (helpers.ts).
  restoreEnv = scrubMpEnv();
});

afterEach(() => {
  restoreEnv();
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
    expect([...session.headers.entries()]).toEqual([["X-Foo", "bar"]]);
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
    expect(after).toEqual(before);
  });
});
