// Secret round trip through the TOML account writer: `Secret.toJSON()`
// returns the redaction mask, so the writer must `reveal()` at exactly its
// designated site. Locks write→read equality for Secret-bearing accounts,
// real values on disk, and no `**********` mask on disk. No Python twin.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type OAuthTokenAccount,
  Secret,
  type ServiceAccount,
} from "@mixpanel-headless/core";

import { createNodeConfigSource } from "../src/config-writes.js";
import { makeTempDir } from "./helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("secret round trip", () => {
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
    const text = readFileSync(configPath, "utf8");
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
    const text = readFileSync(configPath, "utf8");
    expect(text).toContain("rotated-secret");
    expect(text).not.toContain("**********");
  });
});
