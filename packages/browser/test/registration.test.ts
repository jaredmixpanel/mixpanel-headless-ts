// The browser DCR wrapper: CredentialStore-cached registration over the core
// `registerClient` POST. Cache-hit rule as in Python (the cached client is
// returned only when its `redirect_uri` matches); the error branches are
// canned here and locked exhaustively in node's client-registration.test.ts.

import { describe, expect, it } from "vitest";

import { DEFAULT_SCOPE, OAuthError } from "@mixpanel-headless/core";

import { InMemoryCredentialStore } from "../src/credential-store.js";
import { CREDENTIAL_KEYS } from "../src/index.js";
import { ensureBrowserClientRegistered } from "../src/registration.js";
import {
  type BodyCapturingTransport,
  bodyCapturingTransport,
  jsonResponse,
} from "./flow-helpers.js";

const REDIRECT_URI = "https://app.example.com/oauth/callback";
const FROZEN_NOW_MS = Date.UTC(2026, 0, 15, 10, 30, 0);

/**
 * A transport whose register endpoint returns a fresh client_id.
 *
 * @returns The canned transport.
 */
function registrationTransport(): BodyCapturingTransport {
  return bodyCapturingTransport(() =>
    jsonResponse(201, { client_id: "dcr-client-123" }),
  );
}

describe("ensureBrowserClientRegistered", () => {
  it("POSTs the Python DCR body to {base}mcp/register/ and persists the result", async () => {
    const transport = registrationTransport();
    const store = new InMemoryCredentialStore();
    const info = await ensureBrowserClientRegistered({
      fetch: transport.fetch,
      region: "us",
      redirectUri: REDIRECT_URI,
      store,
      now: () => FROZEN_NOW_MS,
    });

    expect(transport.captures).toHaveLength(1);
    const request = transport.captures[0];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://mixpanel.com/oauth/mcp/register/");
    // Body keys in Python dict insertion order
    // (`client_registration.py`) — byte-compare.
    expect(request?.body).toBe(
      JSON.stringify({
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: DEFAULT_SCOPE,
      }),
    );

    expect(info.client_id).toBe("dcr-client-123");
    expect(info.region).toBe("us");
    expect(info.redirect_uri).toBe(REDIRECT_URI);
    expect(info.scope).toBe(DEFAULT_SCOPE);

    // Persisted under the region key in the R11.9 pydantic-JSON shape
    // (`Z` suffix — client_{region}.json twin, §2.1).
    const raw = store.get(CREDENTIAL_KEYS.clientInfo("us"));
    expect(raw).not.toBeNull();
    const payload = JSON.parse(raw!) as Record<string, unknown>;
    expect(payload["client_id"]).toBe("dcr-client-123");
    expect(payload["created_at"]).toBe("2026-01-15T10:30:00Z");
  });

  it("returns the cached client with ZERO fetches when redirect_uri matches", async () => {
    const transport = registrationTransport();
    const store = new InMemoryCredentialStore();
    const first = await ensureBrowserClientRegistered({
      fetch: transport.fetch,
      region: "us",
      redirectUri: REDIRECT_URI,
      store,
      now: () => FROZEN_NOW_MS,
    });
    const second = await ensureBrowserClientRegistered({
      fetch: transport.fetch,
      region: "us",
      redirectUri: REDIRECT_URI,
      store,
      now: () => FROZEN_NOW_MS,
    });
    expect(transport.captures).toHaveLength(1);
    expect(second.client_id).toBe(first.client_id);
  });

  it("re-registers when the cached redirect_uri differs", async () => {
    const transport = registrationTransport();
    const store = new InMemoryCredentialStore();
    await ensureBrowserClientRegistered({
      fetch: transport.fetch,
      region: "us",
      redirectUri: REDIRECT_URI,
      store,
      now: () => FROZEN_NOW_MS,
    });
    const other = await ensureBrowserClientRegistered({
      fetch: transport.fetch,
      region: "us",
      redirectUri: "https://other.example.com/cb",
      store,
      now: () => FROZEN_NOW_MS,
    });
    expect(transport.captures).toHaveLength(2);
    expect(other.redirect_uri).toBe("https://other.example.com/cb");
  });

  it("keys the cache per region (cross-region isolation)", async () => {
    const transport = registrationTransport();
    const store = new InMemoryCredentialStore();
    await ensureBrowserClientRegistered({
      fetch: transport.fetch,
      region: "us",
      redirectUri: REDIRECT_URI,
      store,
      now: () => FROZEN_NOW_MS,
    });
    await ensureBrowserClientRegistered({
      fetch: transport.fetch,
      region: "eu",
      redirectUri: REDIRECT_URI,
      store,
      now: () => FROZEN_NOW_MS,
    });
    expect(transport.captures).toHaveLength(2);
    expect(transport.captures[1]?.url).toBe(
      "https://eu.mixpanel.com/oauth/mcp/register/",
    );
    expect(store.get(CREDENTIAL_KEYS.clientInfo("us"))).not.toBeNull();
    expect(store.get(CREDENTIAL_KEYS.clientInfo("eu"))).not.toBeNull();
  });

  it.each([
    ["unknown region", "uk"],
    ["uppercase region", "US"],
    ["empty region", ""],
  ])(
    "raises OAUTH_REGISTRATION_ERROR for %s (`client_registration.py:97-103`)",
    async (_label, region) => {
      const transport = registrationTransport();
      await expect(
        ensureBrowserClientRegistered({
          fetch: transport.fetch,
          region,
          redirectUri: REDIRECT_URI,
          store: new InMemoryCredentialStore(),
        }),
      ).rejects.toMatchObject({ code: "OAUTH_REGISTRATION_ERROR" });
      expect(transport.captures).toHaveLength(0);
    },
  );

  it("maps 429 to OAUTH_REGISTRATION_ERROR with the retry_after detail", async () => {
    const transport = bodyCapturingTransport(
      () =>
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": "42" },
        }),
    );
    const error = await ensureBrowserClientRegistered({
      fetch: transport.fetch,
      region: "us",
      redirectUri: REDIRECT_URI,
      store: new InMemoryCredentialStore(),
    }).then(
      () => null,
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_REGISTRATION_ERROR");
    expect((error as OAuthError).details).toMatchObject({
      status_code: 429,
      retry_after: "42",
    });
  });

  it("maps a non-2xx status to OAUTH_REGISTRATION_ERROR", async () => {
    const transport = bodyCapturingTransport(() =>
      jsonResponse(500, { error: "boom" }),
    );
    await expect(
      ensureBrowserClientRegistered({
        fetch: transport.fetch,
        region: "us",
        redirectUri: REDIRECT_URI,
        store: new InMemoryCredentialStore(),
      }),
    ).rejects.toMatchObject({ code: "OAUTH_REGISTRATION_ERROR" });
  });

  it("maps a 2xx body with no client_id to OAUTH_REGISTRATION_ERROR", async () => {
    const transport = bodyCapturingTransport(() =>
      jsonResponse(201, { message: "created" }),
    );
    await expect(
      ensureBrowserClientRegistered({
        fetch: transport.fetch,
        region: "us",
        redirectUri: REDIRECT_URI,
        store: new InMemoryCredentialStore(),
      }),
    ).rejects.toMatchObject({ code: "OAUTH_REGISTRATION_ERROR" });
  });

  it("maps a non-JSON 2xx body to OAUTH_REGISTRATION_ERROR", async () => {
    const transport = bodyCapturingTransport(
      () =>
        new Response("<html>created</html>", {
          status: 201,
          headers: { "content-type": "text/html" },
        }),
    );
    await expect(
      ensureBrowserClientRegistered({
        fetch: transport.fetch,
        region: "us",
        redirectUri: REDIRECT_URI,
        store: new InMemoryCredentialStore(),
      }),
    ).rejects.toMatchObject({ code: "OAUTH_REGISTRATION_ERROR" });
  });

  it("maps a network rejection to OAUTH_REGISTRATION_ERROR", async () => {
    const transport = bodyCapturingTransport(() => {
      throw new TypeError("fetch failed");
    });
    await expect(
      ensureBrowserClientRegistered({
        fetch: transport.fetch,
        region: "us",
        redirectUri: REDIRECT_URI,
        store: new InMemoryCredentialStore(),
      }),
    ).rejects.toMatchObject({ code: "OAUTH_REGISTRATION_ERROR" });
  });
});
