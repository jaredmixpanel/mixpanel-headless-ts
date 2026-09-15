// Secret redaction across account and session shapes, mirroring the
// `TestSecretLeakage` class of `tests/unit/test_042_edge_cases.py`.
// Python `repr`/`str` asserts become `JSON.stringify` + `String(...)`
// (Secret redacts in `toString`/`toJSON`); the missing-tokens case runs
// through the injected `tokenResolver` and surfaces on first header use.

import { describe, expect, it } from "vitest";

import type { Account } from "../../src/auth/account.js";
import { type Session, sessionAuthHeader } from "../../src/auth/session.js";
import { OAuthError } from "../../src/errors.js";
import { Secret } from "../../src/secret.js";

const SENTINEL = "QASecretValue-MustNotLeak-987654321";

describe("Secret leakage", () => {
  // python: TestSecretLeakage
  it("a ServiceAccount's serialized forms redact the secret", () => {
    const sa: Account = {
      type: "service_account",
      name: "team",
      region: "us",
      username: "u",
      secret: new Secret(SENTINEL),
    };
    expect(JSON.stringify(sa)).not.toContain(SENTINEL);
    expect(String(sa.secret)).not.toContain(SENTINEL);
  });

  it("an OAuthTokenAccount's serialized forms redact the inline token", () => {
    const account: Account = {
      type: "oauth_token",
      name: "ci",
      region: "us",
      token: new Secret(SENTINEL),
    };
    expect(JSON.stringify(account)).not.toContain(SENTINEL);
    expect(String(account.token)).not.toContain(SENTINEL);
  });

  it("a Session containing an SA account redacts the secret", () => {
    const session: Session = {
      account: {
        type: "service_account",
        name: "team",
        region: "us",
        username: "u",
        secret: new Secret(SENTINEL),
      },
      project: { id: "3713224" },
      workspace: null,
      headers: new Map<string, string>(),
    };
    expect(JSON.stringify(session)).not.toContain(SENTINEL);
    expect(JSON.stringify(session.account)).not.toContain(SENTINEL);
  });

  it("an OAuthBrowserAccount with no tokens fails fast on header resolution", async () => {
    // Python: MixpanelAPIClient construction succeeds; the eager
    // `.current_auth_header` probe raises OAuthError. TS twin: the
    // per-request `sessionAuthHeader` with a resolver that has
    // no tokens rejects with the same class.
    const session: Session = {
      account: { type: "oauth_browser", name: "me", region: "us" },
      project: { id: "3713224" },
      workspace: null,
      headers: new Map<string, string>(),
    };
    const resolver = {
      getBrowserToken: (): Promise<string> =>
        Promise.reject(
          new OAuthError("No tokens on disk. Run `mp account login me`."),
        ),
      getStaticToken: (): Promise<string> =>
        Promise.reject(new OAuthError("unused")),
    };

    await expect(
      sessionAuthHeader(session, { tokenResolver: resolver }),
    ).rejects.toBeInstanceOf(OAuthError);
  });
});
