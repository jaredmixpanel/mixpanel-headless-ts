// NEW Layer-3 lock — CRED-F3 serialization round-trip (b8-packets.md
// §2.3 last row; B7-ARB-B ruling, `b7-reviewB-resolution.md:245-252`).
//
// `Secret.toJSON()` returns the redaction mask, so any on-disk writer
// routed through a generic serializer would persist literal asterisks —
// silent credential corruption discovered only at next auth. The TOML
// account writer (`_account_to_block` twin, config.ts) must call
// `reveal()` at exactly its designated site. This suite locks:
//
//   1. write→read reveal equality for a Secret-bearing SA account AND a
//      Secret-bearing oauth_token account;
//   2. the on-disk TOML contains the REAL values;
//   3. the on-disk TOML does NOT contain the `**********` mask.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type {
  OAuthTokenAccount,
  ServiceAccount,
} from "@mixpanel-headless/core";
import { Secret } from "@mixpanel-headless/core";
import { createNodeConfigSource } from "../src/config-writes.js";
import { makeTempDir } from "./helpers.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("CRED-F3 secret round-trip lock", () => {
  it("SA secret and OT token round-trip revealed, unmasked on disk", () => {
    const dir = makeTempDir(cleanups);
    const configPath = join(dir, "config.toml");
    const config = createNodeConfigSource({ configPath });

    config.addAccount("team", {
      type: "service_account",
      region: "us",
      default_project: "3713224",
      username: "sa.user",
      secret: new Secret("sa-secret-sentinel"),
    });
    config.addAccount("ci", {
      type: "oauth_token",
      region: "eu",
      token: new Secret("ot-token-sentinel"),
    });

    // 1) Re-read via getAccount → revealed values equal the originals.
    const sa = config.getAccount("team") as ServiceAccount;
    expect(sa.secret.reveal()).toBe("sa-secret-sentinel");
    const ot = config.getAccount("ci") as OAuthTokenAccount;
    expect(ot.token?.reveal()).toBe("ot-token-sentinel");

    // 2) The on-disk TOML carries the REAL values...
    const text = readFileSync(configPath, "utf-8");
    expect(text).toContain("sa-secret-sentinel");
    expect(text).toContain("ot-token-sentinel");

    // 3) ...and never the Pydantic redaction mask.
    expect(text).not.toContain("**********");
  });

  it("updateAccount secret rewrite also lands revealed", () => {
    const dir = makeTempDir(cleanups);
    const configPath = join(dir, "config.toml");
    const config = createNodeConfigSource({ configPath });
    config.addAccount("team", {
      type: "service_account",
      region: "us",
      username: "sa.user",
      secret: new Secret("first-secret"),
    });
    config.updateAccount("team", { secret: new Secret("rotated-secret") });
    const sa = config.getAccount("team") as ServiceAccount;
    expect(sa.secret.reveal()).toBe("rotated-secret");
    const text = readFileSync(configPath, "utf-8");
    expect(text).toContain("rotated-secret");
    expect(text).not.toContain("**********");
  });
});
