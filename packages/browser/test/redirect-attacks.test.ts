// Adversarial cases for the browser redirect flow. Parser semantics mirror
// `_parse_pasted_redirect` in mixpanel_headless._internal.auth.flow (codes
// OAUTH_PASTE_ERROR / OAUTH_AUTH_DENIED / OAUTH_STATE_MISMATCH); the
// pending-record branches are browser-only. Assertions key on the code.

import { describe, expect, it } from "vitest";

import { OAuthError } from "@mixpanel-headless/core";

import { InMemoryCredentialStore } from "../src/credential-store.js";
import { beginLogin, completeLogin, CREDENTIAL_KEYS } from "../src/index.js";
import {
  type BodyCapturingTransport,
  bodyCapturingTransport,
  jsonResponse,
  makeTokenResponse,
} from "./flow-helpers.js";

const REDIRECT_URI = "https://app.example.com/oauth/callback";

/**
 * Canned IdP (DCR + token endpoints).
 *
 * @returns The canned transport.
 */
function cannedIdp(): BodyCapturingTransport {
  return bodyCapturingTransport((request) => {
    if (request.url.endsWith("mcp/register/")) {
      return jsonResponse(201, { client_id: "dcr-client-123" });
    }
    if (request.url.endsWith("token/")) {
      return jsonResponse(200, makeTokenResponse());
    }
    throw new Error(`unexpected URL: ${request.url}`);
  });
}

/**
 * Begin a login and return the store + transport + state.
 *
 * @returns The prepared login context.
 */
async function preparedLogin(): Promise<{
  store: InMemoryCredentialStore;
  transport: BodyCapturingTransport;
  state: string;
}> {
  const store = new InMemoryCredentialStore();
  const transport = cannedIdp();
  const { state } = await beginLogin({
    region: "us",
    redirectUri: REDIRECT_URI,
    store,
    fetch: transport.fetch,
  });
  return { store, transport, state };
}

describe("redirect-flow attacks", () => {
  it("rejects a state mismatch with OAUTH_STATE_MISMATCH and never posts the code", async () => {
    const { store, transport } = await preparedLogin();
    const dcrCalls = transport.captures.length;
    await expect(
      completeLogin({
        region: "us",
        returnUrl: `${REDIRECT_URI}?code=ATTACKER-CODE&state=FORGED`,
        store,
        fetch: transport.fetch,
      }),
    ).rejects.toMatchObject({ code: "OAUTH_STATE_MISMATCH" });
    // Code-injection attempt with mismatched state LOSES: no token
    // POST happened.
    expect(transport.captures).toHaveLength(dcrCalls);
  });

  it("keeps the pending record on a parse failure (mismatch is pre-delete — the user may paste the CORRECT url next)", async () => {
    const { store, transport, state } = await preparedLogin();
    await expect(
      completeLogin({
        region: "us",
        returnUrl: `?code=X&state=WRONG`,
        store,
        fetch: transport.fetch,
      }),
    ).rejects.toMatchObject({ code: "OAUTH_STATE_MISMATCH" });
    // Parse failures precede the single-use delete (§3.2 step order:
    // parse at 2, delete at 3) — the correct URL still completes.
    const tokens = await completeLogin({
      region: "us",
      returnUrl: `?code=auth-code&state=${state}`,
      store,
      fetch: transport.fetch,
    });
    expect(tokens.token_type).toBe("Bearer");
  });

  it("rejects a forged return with no pending record via BROWSER_NO_PENDING_LOGIN", async () => {
    const transport = cannedIdp();
    await expect(
      completeLogin({
        region: "us",
        returnUrl: `${REDIRECT_URI}?code=X&state=FORGED`,
        store: new InMemoryCredentialStore(),
        fetch: transport.fetch,
      }),
    ).rejects.toMatchObject({ code: "BROWSER_NO_PENDING_LOGIN" });
  });

  it("treats a corrupted pending record as BROWSER_NO_PENDING_LOGIN (documented twin-less branch)", async () => {
    const { store, transport, state } = await preparedLogin();
    store.set(CREDENTIAL_KEYS.pendingLogin("us"), "{not json");
    await expect(
      completeLogin({
        region: "us",
        returnUrl: `?code=auth-code&state=${state}`,
        store,
        fetch: transport.fetch,
      }),
    ).rejects.toMatchObject({ code: "BROWSER_NO_PENDING_LOGIN" });
  });

  it("surfaces provider error params as OAUTH_AUTH_DENIED with error_description appended", async () => {
    const { store, transport } = await preparedLogin();
    const error = await completeLogin({
      region: "us",
      returnUrl: `${REDIRECT_URI}?error=access_denied&error_description=user+cancelled&state=whatever`,
      store,
      fetch: transport.fetch,
    }).then(
      () => null,
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_AUTH_DENIED");
    expect((error as OAuthError).message).toContain("access_denied");
    expect((error as OAuthError).message).toContain("user cancelled");
  });

  it.each([
    ["empty return", " ".repeat(3)],
    ["garbage", "not a url at all"],
    ["missing code", "state=XYZ"],
    ["missing state", "code=ABC"],
  ])(
    "rejects %s with OAUTH_PASTE_ERROR (code reused VERBATIM — §3.2 code-reuse note)",
    async (_label, returnUrl) => {
      const { store, transport } = await preparedLogin();
      await expect(
        completeLogin({
          region: "us",
          returnUrl,
          store,
          fetch: transport.fetch,
        }),
      ).rejects.toMatchObject({ code: "OAUTH_PASTE_ERROR" });
    },
  );

  it("does not resurrect the state after a failed exchange; a replay needs a fresh beginLogin", async () => {
    const store = new InMemoryCredentialStore();
    const beginTransport = cannedIdp();
    const { state } = await beginLogin({
      region: "us",
      redirectUri: REDIRECT_URI,
      store,
      fetch: beginTransport.fetch,
    });
    const failingTransport = bodyCapturingTransport(() =>
      jsonResponse(500, { error: "server_error" }),
    );
    const returnUrl = `?code=auth-code&state=${state}`;
    await expect(
      completeLogin({
        region: "us",
        returnUrl,
        store,
        fetch: failingTransport.fetch,
      }),
    ).rejects.toMatchObject({ code: "OAUTH_TOKEN_ERROR" });
    // The pending record was consumed BEFORE the exchange (single-use
    // state); the same returnUrl now hits the no-pending branch.
    expect(store.get(CREDENTIAL_KEYS.pendingLogin("us"))).toBeNull();
    await expect(
      completeLogin({
        region: "us",
        returnUrl,
        store,
        fetch: failingTransport.fetch,
      }),
    ).rejects.toMatchObject({ code: "BROWSER_NO_PENDING_LOGIN" });
  });
});
