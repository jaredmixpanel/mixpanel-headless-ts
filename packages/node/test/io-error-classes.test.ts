// OAuthStorage read path: an errno error from the credential read (for
// example EACCES) propagates instead of being read as "no tokens" — only the
// JSON/decode family and CredentialPathError mean "corrupt". No Python twin;
// an unprivileged test cannot build a root-owned fixture, so the error is
// injected at the io-utils module seam with `vi.mock`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OAuthTokens, Secret } from "@mixpanel-headless/core";

import { OAuthStorage } from "../src/auth/storage.js";
import { makeTempDir, scrubMpEnv } from "./helpers.js";

/** Toggle: when set, the mocked `readCredentialText` throws EACCES. */
const trigger = { active: false };

vi.mock("../src/io-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/io-utils.js")>();
  return {
    ...actual,
    readCredentialText: (
      ...args: Parameters<typeof actual.readCredentialText>
    ): string => {
      if (trigger.active) {
        const err = new Error(
          `EACCES: permission denied, open '${args[0]}'`,
        ) as NodeJS.ErrnoException;
        err.code = "EACCES";
        err.errno = -13;
        err.syscall = "open";
        err.path = args[0];
        throw err;
      }
      return actual.readCredentialText(...args);
    },
  };
});

const cleanups: Array<() => void> = [];

beforeEach(() => {
  scrubMpEnv();
  trigger.active = false;
});

afterEach(() => {
  trigger.active = false;
  vi.unstubAllEnvs();
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("storage read-path errno errors propagate", () => {
  it("loadTokens: EACCES from the credential read PROPAGATES (never the corrupt-JSON null)", () => {
    const dir = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: dir });
    // Seed a real, well-formed tokens file first (trigger off).
    storage.saveTokens(
      new OAuthTokens({
        access_token: new Secret("acc"),
        refresh_token: new Secret("ref"),
        expires_at: "2030-01-01T00:00:00+00:00",
        scope: "read",
        token_type: "Bearer",
      }),
      "us",
    );
    trigger.active = true;
    let caught: unknown = null;
    try {
      storage.loadTokens("us");
    } catch (error) {
      caught = error;
    }
    expect((caught as NodeJS.ErrnoException | null)?.code).toBe("EACCES");
  });

  it("loadClientInfo: EACCES from the credential read PROPAGATES", () => {
    const dir = makeTempDir(cleanups);
    const storage = new OAuthStorage({ storageDir: dir });
    storage.saveClientInfo({
      client_id: "client_abc123",
      region: "us",
      redirect_uri: "http://localhost:19284/callback",
      scope: "projects analysis",
      created_at: new Date().toISOString(),
    });
    trigger.active = true;
    let caught: unknown = null;
    try {
      storage.loadClientInfo("us");
    } catch (error) {
      caught = error;
    }
    expect((caught as NodeJS.ErrnoException | null)?.code).toBe("EACCES");
  });
});
