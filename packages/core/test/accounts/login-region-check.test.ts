// Region-mismatch guard on `accounts.login` for oauth_browser accounts,
// mirroring `tests/unit/test_login_region_check.py`. The PKCE-flow and
// `/me` monkeypatches become the injected `effects.oauthFlow.login` stub
// and `meFetch(payload)`; the "no tokens.json on disk" assertion reads the
// injected token store (`tokenStore.written`) instead.

import { describe, expect, it } from "vitest";

import { createAccountsNamespace } from "../../src/accounts/namespace.js";
import { OAuthTokens } from "../../src/auth/token.js";
import { ConfigError } from "../../src/errors.js";
import { Secret } from "../../src/secret.js";
import {
  makeEffects,
  type MakeEffectsOptions,
  meFetch,
} from "./fake-auth-effects.js";

/** The `_stub_pkce_flow` twin. */
function stubbedFlow(): MakeEffectsOptions["oauthFlow"] {
  return {
    login: (): Promise<OAuthTokens> =>
      Promise.resolve(
        new OAuthTokens({
          access_token: new Secret("brw-tok"),
          refresh_token: new Secret("brw-refresh"),
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          scope: "read:project",
          token_type: "Bearer",
        }),
      ),
  };
}

/** The `_stub_me_with_eu_project` payload. */
const EU_PROJECT_ME = {
  user_id: 7,
  user_email: "alice@example.com",
  projects: {
    "12345": {
      name: "Demo",
      organization_id: 1,
      domain: "eu.mixpanel.com",
    },
  },
};

describe("Login region mismatch", () => {
  // python: TestLoginRegionMismatch
  it("us auth picking an eu project raises the E-2 ConfigError", async () => {
    const bundle = makeEffects({
      oauthFlow: stubbedFlow(),
      fetchImpl: meFetch(EU_PROJECT_ME),
    });
    const accounts = createAccountsNamespace(bundle.effects);
    await accounts.add("personal", { type: "oauth_browser", region: "us" });

    let caught: unknown = null;
    try {
      await accounts.login("personal");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const message = (caught as ConfigError).message;
    // E-2 catalog wording — placeholders rendered with the test data.
    expect(message).toContain("Region mismatch");
    expect(message).toContain("us"); // auth_region
    expect(message).toContain("eu"); // project_region
    expect(message).toContain("12345"); // project_id
    expect(message).toContain("Demo"); // project_name
    expect(message).toContain("eu.mixpanel.com"); // project_domain
    expect(message).toContain("mp login --region eu");
  });

  it("the E-2 failure leaves NO tokens persisted (atomic publish)", async () => {
    const bundle = makeEffects({
      oauthFlow: stubbedFlow(),
      fetchImpl: meFetch(EU_PROJECT_ME),
    });
    const accounts = createAccountsNamespace(bundle.effects);
    await accounts.add("personal", { type: "oauth_browser", region: "us" });

    await expect(accounts.login("personal")).rejects.toBeInstanceOf(
      ConfigError,
    );

    expect(bundle.tokenStore.written.has("personal")).toBe(false);
  });

  it("matching region does not raise", async () => {
    const bundle = makeEffects({
      oauthFlow: stubbedFlow(),
      fetchImpl: meFetch(EU_PROJECT_ME),
    });
    const accounts = createAccountsNamespace(bundle.effects);
    await accounts.add("personal", { type: "oauth_browser", region: "eu" });

    const result = await accounts.login("personal");

    expect(result.account_name).toBe("personal");
  });

  it("a project without domain skips the check (back-compat)", async () => {
    const bundle = makeEffects({
      oauthFlow: stubbedFlow(),
      fetchImpl: meFetch({
        user_id: 7,
        user_email: "alice@example.com",
        projects: { "12345": { name: "Demo", organization_id: 1 } },
      }),
    });
    const accounts = createAccountsNamespace(bundle.effects);
    await accounts.add("personal", { type: "oauth_browser", region: "us" });

    const result = await accounts.login("personal");

    expect(result.account_name).toBe("personal");
  });
});
