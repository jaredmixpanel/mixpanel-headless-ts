// The browser redirect PKCE flow (beginLogin / completeLogin). Where a
// Python twin exists, mixpanel_headless._internal.auth.flow rules (region
// gate, exchange form fields, network-error and region-URL rows of
// tests/unit/test_auth_flow.py); the pending-record and always-persist
// branches are browser-only contract. Login/paste/refresh classes are node-only.

import { describe, expect, it } from "vitest";

import { OAuthError } from "@mixpanel-headless/core";

import { InMemoryCredentialStore } from "../src/credential-store.js";
import {
  beginLogin,
  completeLogin,
  createBrowserWorkspaceFromStore,
  CREDENTIAL_KEYS,
} from "../src/index.js";
import {
  type BodyCapturingTransport,
  bodyCapturingTransport,
  jsonResponse,
  makeTokenResponse,
} from "./flow-helpers.js";

const REDIRECT_URI = "https://app.example.com/oauth/callback";
const FROZEN_NOW_MS = Date.UTC(2026, 0, 15, 10, 30, 0);

/**
 * A canned IdP: DCR returns a client_id; the token endpoint returns a
 * well-formed token payload.
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
 * Run beginLogin over a canned IdP with a frozen clock.
 *
 * @param store - The credential store.
 * @param transport - The canned transport.
 * @param region - Region (default us).
 * @returns The begin result.
 */
async function begin(
  store: InMemoryCredentialStore,
  transport: BodyCapturingTransport,
  region: "us" | "eu" | "in" = "us",
): Promise<{ authorizeUrl: string; state: string }> {
  return beginLogin({
    region,
    redirectUri: REDIRECT_URI,
    store,
    fetch: transport.fetch,
    now: () => FROZEN_NOW_MS,
  });
}

describe("beginLogin", () => {
  it("returns the authorize URL over the region host and never navigates", async () => {
    const store = new InMemoryCredentialStore();
    const transport = cannedIdp();
    const result = await begin(store, transport);
    expect(
      result.authorizeUrl.startsWith(
        "https://mixpanel.com/oauth/authorize/?response_type=code&client_id=dcr-client-123&",
      ),
    ).toBe(true);
    const url = new URL(result.authorizeUrl);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("state")).toBe(result.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    // Scope intentionally omitted (`flow.py:625-627` — contract, §3.3).
    expect(url.searchParams.has("scope")).toBe(false);
    // Only the DCR POST hit the network — the library NEVER navigates.
    expect(transport.captures).toHaveLength(1);
    expect(transport.captures[0]?.url).toBe(
      "https://mixpanel.com/oauth/mcp/register/",
    );
  });

  it.each([
    ["eu", "https://eu.mixpanel.com/oauth/authorize/"],
    ["in", "https://in.mixpanel.com/oauth/authorize/"],
  ] as const)(
    "uses the %s region authorize host (test_auth_flow.py:759 twin)",
    async (region, prefix) => {
      const store = new InMemoryCredentialStore();
      const result = await begin(store, cannedIdp(), region);
      expect(result.authorizeUrl.startsWith(prefix)).toBe(true);
    },
  );

  it.each([["uk"], ["US"], [""]])(
    "rejects region %j with OAUTH_CONFIG_ERROR (test_auth_flow.py:984 twins)",
    async (region) => {
      const transport = cannedIdp();
      const error = await beginLogin({
        region: region as "us",
        redirectUri: REDIRECT_URI,
        store: new InMemoryCredentialStore(),
        fetch: transport.fetch,
      }).then(
        () => null,
        (error_: unknown) => error_,
      );
      expect(error).toBeInstanceOf(OAuthError);
      expect((error as OAuthError).code).toBe("OAUTH_CONFIG_ERROR");
      expect(transport.captures).toHaveLength(0);
    },
  );

  it("persists the pending record with the tokens.json created_at shape", async () => {
    const store = new InMemoryCredentialStore();
    const result = await begin(store, cannedIdp());
    const raw = store.get(CREDENTIAL_KEYS.pendingLogin("us"));
    expect(raw).not.toBeNull();
    const pending = JSON.parse(raw!) as Record<string, unknown>;
    // Fixed, non-numeric key set in insertion order (§7 caution 7).
    expect(Object.keys(pending)).toStrictEqual([
      "state",
      "verifier",
      "client_id",
      "redirect_uri",
      "created_at",
    ]);
    expect(pending["state"]).toBe(result.state);
    expect(pending["verifier"]).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(pending["client_id"]).toBe("dcr-client-123");
    expect(pending["redirect_uri"]).toBe(REDIRECT_URI);
    // tokens-twin formatter: `+00:00`, never `Z` (§3.2 pending-record
    // spec; R11.9).
    expect(pending["created_at"]).toBe("2026-01-15T10:30:00+00:00");
  });

  it.each([
    ["not a url"],
    ["/relative/callback"],
    ["javascript:alert(1)"],
    ["http://app.example.com/oauth/callback"],
  ])(
    "FB-4 (pair-B): rejects untrusted redirectUri %j with OAUTH_CONFIG_ERROR before any network",
    async (redirectUri) => {
      // b9-reviewB-threat.md F4: the redirect URI must be an absolute
      // https URL (http only for loopback, RFC 8252 §7.3 — the
      // `flow.py:54-58` localhost posture); it must never be derived
      // from user input (the D2 spike proved DCR registers arbitrary
      // third-party https origins).
      const transport = cannedIdp();
      await expect(
        beginLogin({
          region: "us",
          redirectUri,
          store: new InMemoryCredentialStore(),
          fetch: transport.fetch,
        }),
      ).rejects.toMatchObject({ code: "OAUTH_CONFIG_ERROR" });
      expect(transport.captures).toHaveLength(0);
    },
  );

  it.each([
    ["http://localhost:3000/oauth/callback"],
    ["http://127.0.0.1:19284/callback"],
  ])(
    "FB-4 (pair-B): loopback http redirect URIs stay allowed (%s)",
    async (redirectUri) => {
      const transport = cannedIdp();
      const result = await beginLogin({
        region: "us",
        redirectUri,
        store: new InMemoryCredentialStore(),
        fetch: transport.fetch,
        now: () => FROZEN_NOW_MS,
      });
      expect(
        new URL(result.authorizeUrl).searchParams.get("redirect_uri"),
      ).toBe(redirectUri);
    },
  );

  it("generates a 43-char base64url state, fresh per call (`token_urlsafe(32)` shape)", async () => {
    const store = new InMemoryCredentialStore();
    const transport = cannedIdp();
    const first = await begin(store, transport);
    const second = await begin(store, transport);
    for (const result of [first, second]) {
      expect(result.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(first.state).not.toBe(second.state);
  });
});

describe("completeLogin", () => {
  it("exchanges the code with the five verbatim form fields", async () => {
    const store = new InMemoryCredentialStore();
    const transport = cannedIdp();
    const { state } = await begin(store, transport);
    const pendingRaw = store.get(CREDENTIAL_KEYS.pendingLogin("us"));
    const pending = JSON.parse(pendingRaw!) as Record<string, string>;

    const tokens = await completeLogin({
      region: "us",
      returnUrl: `${REDIRECT_URI}?code=auth-code&state=${state}`,
      store,
      fetch: transport.fetch,
      now: () => FROZEN_NOW_MS,
    });

    const tokenRequest = transport.captures.find((request) =>
      request.url.endsWith("token/"),
    );
    expect(tokenRequest?.url).toBe("https://mixpanel.com/oauth/token/");
    expect(tokenRequest?.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    // Byte-compare the urlencoded body — field-for-field, insertion
    // order (`flow.py`).
    expect(tokenRequest?.body).toBe(
      "grant_type=authorization_code&code=auth-code&" +
        // quote_plus(REDIRECT_URI) — no space/`+`/`~` chars in the
        // fixture, so encodeURIComponent agrees byte-for-byte here.
        `redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&client_id=dcr-client-123&code_verifier=${pending["verifier"]!}`,
    );
    expect(tokens.access_token.reveal()).toBe("new-access-token");
    // Frozen clock: expires_at = now + 3600s, isoformat `+00:00` shape.
    expect(tokens.expires_at).toBe("2026-01-15T11:30:00+00:00");
  });

  it("always persists tokens under the region key in the tokens.json writer shape", async () => {
    const store = new InMemoryCredentialStore();
    const transport = cannedIdp();
    const { state } = await begin(store, transport);
    await completeLogin({
      region: "us",
      returnUrl: `?code=auth-code&state=${state}`,
      store,
      fetch: transport.fetch,
      now: () => FROZEN_NOW_MS,
    });
    const raw = store.get(CREDENTIAL_KEYS.tokens("us"));
    expect(raw).not.toBeNull();
    const payload = JSON.parse(raw!) as Record<string, unknown>;
    expect(payload["access_token"]).toBe("new-access-token");
    expect(payload["refresh_token"]).toBe("new-refresh-token");
    expect(payload["expires_at"]).toBe("2026-01-15T11:30:00+00:00");
  });

  it("round-trips into createBrowserWorkspaceFromStore", async () => {
    const store = new InMemoryCredentialStore();
    const transport = cannedIdp();
    const { state } = await begin(store, transport);
    await completeLogin({
      region: "us",
      returnUrl: `?code=auth-code&state=${state}`,
      store,
      fetch: transport.fetch,
      now: () => FROZEN_NOW_MS,
    });
    const workspace = await createBrowserWorkspaceFromStore({
      region: "us",
      projectId: "12345",
      store,
      fetch: transport.fetch,
      now: () => FROZEN_NOW_MS,
    });
    expect(workspace.session.project.id).toBe("12345");
  });

  it("accepts the parsePastedRedirect grammar (full URL, `?`-prefixed, bare query)", async () => {
    for (const shape of [
      (state: string): string => `${REDIRECT_URI}?code=ABC&state=${state}`,
      (state: string): string => `?code=ABC&state=${state}`,
      (state: string): string => `code=ABC&state=${state}`,
    ]) {
      const store = new InMemoryCredentialStore();
      const transport = cannedIdp();
      const { state } = await begin(store, transport);
      const tokens = await completeLogin({
        region: "us",
        returnUrl: shape(state),
        store,
        fetch: transport.fetch,
        now: () => FROZEN_NOW_MS,
      });
      expect(tokens.token_type).toBe("Bearer");
    }
  });

  it("throws BROWSER_NO_PENDING_LOGIN when no login was begun (replay/expired-tab branch)", async () => {
    const transport = cannedIdp();
    await expect(
      completeLogin({
        region: "us",
        returnUrl: "?code=ABC&state=XYZ",
        store: new InMemoryCredentialStore(),
        fetch: transport.fetch,
      }),
    ).rejects.toMatchObject({ code: "BROWSER_NO_PENDING_LOGIN" });
    expect(transport.captures).toHaveLength(0);
  });

  it("deletes the pending record BEFORE the exchange — a replay of the same returnUrl hits BROWSER_NO_PENDING_LOGIN", async () => {
    const store = new InMemoryCredentialStore();
    const transport = cannedIdp();
    const { state } = await begin(store, transport);
    const returnUrl = `?code=auth-code&state=${state}`;
    await completeLogin({
      region: "us",
      returnUrl,
      store,
      fetch: transport.fetch,
      now: () => FROZEN_NOW_MS,
    });
    await expect(
      completeLogin({
        region: "us",
        returnUrl,
        store,
        fetch: transport.fetch,
        now: () => FROZEN_NOW_MS,
      }),
    ).rejects.toMatchObject({ code: "BROWSER_NO_PENDING_LOGIN" });
  });

  it("isolates pending records per region (cross-region key isolation)", async () => {
    const store = new InMemoryCredentialStore();
    const transport = cannedIdp();
    const usResult = await begin(store, transport, "us");
    const euResult = await begin(store, transport, "eu");
    expect(usResult.state).not.toBe(euResult.state);
    // Completing EU consumes only the EU record; US stays pending.
    await completeLogin({
      region: "eu",
      returnUrl: `?code=auth-code&state=${euResult.state}`,
      store,
      fetch: transport.fetch,
      now: () => FROZEN_NOW_MS,
    });
    expect(store.get(CREDENTIAL_KEYS.pendingLogin("eu"))).toBeNull();
    expect(store.get(CREDENTIAL_KEYS.pendingLogin("us"))).not.toBeNull();
    expect(store.get(CREDENTIAL_KEYS.tokens("eu"))).not.toBeNull();
    expect(store.get(CREDENTIAL_KEYS.tokens("us"))).toBeNull();
  });

  it.each([["uk"], ["US"], [""]])(
    "rejects region %j with OAUTH_CONFIG_ERROR before touching the store",
    async (region) => {
      await expect(
        completeLogin({
          region: region as "us",
          returnUrl: "?code=ABC&state=XYZ",
          store: new InMemoryCredentialStore(),
          fetch: cannedIdp().fetch,
        }),
      ).rejects.toMatchObject({ code: "OAUTH_CONFIG_ERROR" });
    },
  );

  describe("review hardening: fragments, pending-record lifetime, concurrent completion", () => {
    it("accepts location.href with a hash-router fragment (code-first ordering)", async () => {
      // b9-reviewB-threat.md F8 / b9-reviewB-e2e.md F4: the shared core
      // parser folds the fragment into the last query value (CPython
      // parse_qs parity); the browser adapter must strip the fragment
      // BEFORE delegating, because its documented input is location.href.
      const store = new InMemoryCredentialStore();
      const transport = cannedIdp();
      const { state } = await begin(store, transport);
      const tokens = await completeLogin({
        region: "us",
        returnUrl: `${REDIRECT_URI}?code=auth-code&state=${state}#/dashboard`,
        store,
        fetch: transport.fetch,
        now: () => FROZEN_NOW_MS,
      });
      expect(tokens.token_type).toBe("Bearer");
    });

    it("never transmits fragment content to the token endpoint (state-first ordering)", async () => {
      const store = new InMemoryCredentialStore();
      const transport = cannedIdp();
      const { state } = await begin(store, transport);
      await completeLogin({
        region: "us",
        returnUrl: `${REDIRECT_URI}?state=${state}&code=auth-code#session=abc`,
        store,
        fetch: transport.fetch,
        now: () => FROZEN_NOW_MS,
      });
      const tokenRequest = transport.captures.find((request) =>
        request.url.endsWith("token/"),
      );
      expect(tokenRequest?.body).toContain("code=auth-code&redirect_uri=");
      expect(tokenRequest?.body).not.toContain("%23session");
    });

    it("refuses and consumes a pending record older than the default 30-minute lifetime", async () => {
      // b9-reviewB-threat.md F5 / b9-reviewB-e2e.md F6: created_at was
      // written but never read — no TTL.
      const store = new InMemoryCredentialStore();
      const transport = cannedIdp();
      const { state } = await begin(store, transport);
      const thirtyOneMinutes = 31 * 60 * 1000;
      await expect(
        completeLogin({
          region: "us",
          returnUrl: `?code=auth-code&state=${state}`,
          store,
          fetch: transport.fetch,
          now: () => FROZEN_NOW_MS + thirtyOneMinutes,
        }),
      ).rejects.toMatchObject({ code: "BROWSER_NO_PENDING_LOGIN" });
      // Expiry consumes the record (the stale verifier does not stay
      // redeemable at rest).
      expect(store.get(CREDENTIAL_KEYS.pendingLogin("us"))).toBeNull();
      // Nothing reached the token endpoint.
      expect(
        transport.captures.filter((request) => request.url.endsWith("token/")),
      ).toHaveLength(0);
    });

    it("completes a record within the default lifetime", async () => {
      const store = new InMemoryCredentialStore();
      const transport = cannedIdp();
      const { state } = await begin(store, transport);
      const tokens = await completeLogin({
        region: "us",
        returnUrl: `?code=auth-code&state=${state}`,
        store,
        fetch: transport.fetch,
        now: () => FROZEN_NOW_MS + 29 * 60 * 1000,
      });
      expect(tokens.token_type).toBe("Bearer");
    });

    it("maxPendingAgeMs is an overridable seam", async () => {
      const store = new InMemoryCredentialStore();
      const transport = cannedIdp();
      const { state } = await begin(store, transport);
      await expect(
        completeLogin({
          region: "us",
          returnUrl: `?code=auth-code&state=${state}`,
          store,
          fetch: transport.fetch,
          now: () => FROZEN_NOW_MS + 2_000,
          maxPendingAgeMs: 1_000,
        }),
      ).rejects.toMatchObject({ code: "BROWSER_NO_PENDING_LOGIN" });
    });

    it("two concurrent completeLogin calls with the same returnUrl share one exchange (React StrictMode)", async () => {
      // b9-reviewB-e2e.md F2: load→parse→delete spans awaits, so both
      // concurrent calls redeemed the code (2 token POSTs; one rejects
      // against a single-use-code IdP).
      const store = new InMemoryCredentialStore();
      const transport = cannedIdp();
      const { state } = await begin(store, transport);
      const returnUrl = `?code=auth-code&state=${state}`;
      const options = {
        region: "us",
        returnUrl,
        store,
        fetch: transport.fetch,
        now: () => FROZEN_NOW_MS,
      } as const;
      const [first, second] = await Promise.allSettled([
        completeLogin(options),
        completeLogin(options),
      ]);
      expect(first.status).toBe("fulfilled");
      expect(second.status).toBe("fulfilled");
      expect(
        transport.captures.filter((request) => request.url.endsWith("token/")),
      ).toHaveLength(1);
    });

    it("a concurrent call with a different returnUrl waits, then fails clean without a second exchange", async () => {
      const store = new InMemoryCredentialStore();
      const transport = cannedIdp();
      const { state } = await begin(store, transport);
      const [first, second] = await Promise.allSettled([
        completeLogin({
          region: "us",
          returnUrl: `?code=auth-code&state=${state}`,
          store,
          fetch: transport.fetch,
          now: () => FROZEN_NOW_MS,
        }),
        completeLogin({
          region: "us",
          returnUrl: `?code=other-code&state=${state}`,
          store,
          fetch: transport.fetch,
          now: () => FROZEN_NOW_MS,
        }),
      ]);
      expect(first.status).toBe("fulfilled");
      expect(second.status).toBe("rejected");
      expect(
        (second as PromiseRejectedResult).reason as { code?: string },
      ).toMatchObject({ code: "BROWSER_NO_PENDING_LOGIN" });
      expect(
        transport.captures.filter((request) => request.url.endsWith("token/")),
      ).toHaveLength(1);
    });
  });

  describe("network errors", () => {
    // python: test_auth_flow.py::TestOAuthFlowNetworkErrors
    /**
     * Begin a login and complete it against the given token-endpoint
     * behavior.
     *
     * @param tokenHandler - Canned token-endpoint outcome.
     * @returns The completeLogin rejection value.
     */
    async function completeAgainst(
      tokenHandler: () => Response,
    ): Promise<unknown> {
      const store = new InMemoryCredentialStore();
      const beginTransport = cannedIdp();
      const { state } = await begin(store, beginTransport);
      const transport = bodyCapturingTransport((request) => {
        if (request.url.endsWith("token/")) {
          return tokenHandler();
        }
        throw new Error(`unexpected URL: ${request.url}`);
      });
      return completeLogin({
        region: "us",
        returnUrl: `?code=auth-code&state=${state}`,
        store,
        fetch: transport.fetch,
        now: () => FROZEN_NOW_MS,
      }).then(
        () => null,
        (error: unknown) => error,
      );
    }

    it("wraps a transport rejection in OAUTH_TOKEN_ERROR (timeout/connect twins)", async () => {
      const error = await completeAgainst(() => {
        throw new TypeError("fetch failed");
      });
      expect(error).toBeInstanceOf(OAuthError);
      expect((error as OAuthError).code).toBe("OAUTH_TOKEN_ERROR");
    });

    it("wraps a non-JSON 200 in OAUTH_TOKEN_ERROR", async () => {
      const error = await completeAgainst(
        () =>
          new Response("<html>error</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      );
      expect((error as OAuthError).code).toBe("OAUTH_TOKEN_ERROR");
    });

    it("wraps a 200 body missing access_token in OAUTH_TOKEN_ERROR", async () => {
      const error = await completeAgainst(() =>
        jsonResponse(200, { token_type: "Bearer", expires_in: 3600 }),
      );
      expect((error as OAuthError).code).toBe("OAUTH_TOKEN_ERROR");
    });

    it("wraps a 400 invalid_grant in OAUTH_TOKEN_ERROR (exchange stays generic — caution 6)", async () => {
      const error = await completeAgainst(() =>
        jsonResponse(400, {
          error: "invalid_grant",
          error_description: "Bad code",
        }),
      );
      expect((error as OAuthError).code).toBe("OAUTH_TOKEN_ERROR");
    });
  });
});
