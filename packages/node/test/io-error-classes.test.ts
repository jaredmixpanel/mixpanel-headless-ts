// B8-ARB-A SEM-F2a (b8-reviewA-resolution.md): Python
// `OAuthStorage._read_file` catches only the ValueError family
// (`json.JSONDecodeError, ValueError, UnicodeDecodeError`) plus
// `CredentialPathError` — an OSError from the
// credential read (e.g. EACCES on a root-owned 0600 file) PROPAGATES
// (live CPython probe in the resolution: `load_tokens` on an
// unreadable file raises PermissionError). The pre-fix TS `#readFile`
// swallowed every non-CredentialPathError as the corrupt-JSON path,
// silently reading a permission problem as "no tokens".
//
// Mechanism substitution (header-cited): the reachable EACCES fixture
// (a root-owned file) cannot be built by an unprivileged test, and the
// permission fixer repairs any non-0600 mode we could set ourselves —
// so the errno error is injected at the module seam via `vi.mock`
// (partial: everything else is the real io-utils). This mirrors what a
// Python `monkeypatch.setattr(io_utils, "read_credential_text", …)`
// would do.

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

describe("B8-ARB-A SEM-F2a: storage read-path errno errors propagate", () => {
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
