// The playground's live-mode model (docs/.vitepress/theme/demo/model/):
// the token hand-off from the hop store to memory, sign-out, the error
// copy table keyed on the real error classes, the project picker's
// grouping, and one simulated redirect login over injected fetches — the
// same library calls the page makes, under Node.

import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  beginLogin,
  BROWSER_NO_PENDING_LOGIN,
  BrowserUnsupportedError,
  completeLogin,
  ConfigError,
  createBrowserWorkspace,
  createBrowserWorkspaceFromStore,
  CREDENTIAL_KEYS,
  type CredentialStore,
  EventNotFoundError,
  InMemoryCredentialStore,
  LocalStorageCredentialStore,
  OAuthError,
  QueryError,
  RateLimitError,
  ServerError,
  type StorageLike,
} from "@mixpanel-headless/browser";

import { DEMO_FIXTURES } from "../docs/.vitepress/theme/demo/fixtures/demo-project.gen.js";
import {
  clockTime,
  describeError,
  noPendingLoginError,
} from "../docs/.vitepress/theme/demo/model/errors.js";
import { fixtureFetch } from "../docs/.vitepress/theme/demo/model/fixture-fetch.js";
import {
  asRegion,
  defaultWorkspace,
  finishLogin,
  groupProjects,
  type Me,
  type Region,
  REGION_STORAGE_KEY,
  REGIONS,
  signOut,
} from "../docs/.vitepress/theme/demo/model/session-state.js";
import {
  LIVE_SETUP,
  liveSetup,
} from "../docs/.vitepress/theme/demo/model/setup-snippets.js";

const REDIRECT_URI = "http://localhost:5173/demo/callback";
const EXPIRES_AT = "2026-09-15T12:00:00+00:00";
const TOKENS_PAYLOAD = JSON.stringify({
  access_token: "test-access-token",
  refresh_token: null,
  expires_at: EXPIRES_AT,
  scope: "openid",
  token_type: "Bearer",
});

/**
 * A `Storage`-shaped map, what `sessionStorage` is to the page.
 *
 * @returns The storage and its backing map.
 */
function mapStorage(): { storage: StorageLike; map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      },
      removeItem: (key) => {
        map.delete(key);
      },
    },
  };
}

/**
 * Fill a store with all three key families of a region.
 *
 * @param store - The store.
 * @param region - The region.
 */
async function fillRegion(
  store: CredentialStore,
  region: Region,
): Promise<void> {
  await store.set(CREDENTIAL_KEYS.tokens(region), TOKENS_PAYLOAD);
  await store.set(CREDENTIAL_KEYS.clientInfo(region), "{}");
  await store.set(CREDENTIAL_KEYS.pendingLogin(region), "{}");
}

/**
 * Every key family of every region as the store reports it.
 *
 * @param store - The store.
 * @returns Key → value (or `null`).
 */
async function dump(
  store: CredentialStore,
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const region of REGIONS) {
    for (const key of CREDENTIAL_KEYS.all(region)) {
      out[key] = await store.get(key);
    }
  }
  return out;
}

/**
 * A fetch answering `/api/app/me` with the payload, so a `Me` can be
 * built through the facade (the class is not on the browser barrel).
 *
 * @param payload - The `results` body.
 * @returns The `/me` response.
 */
async function meFrom(payload: Record<string, unknown>): Promise<Me> {
  const ws = createBrowserWorkspace({
    token: "t",
    projectId: "1",
    region: "us",
    fetch: (input) => {
      expect(new URL(new Request(input).url).pathname).toBe("/api/app/me");
      return Promise.resolve(Response.json({ results: payload }));
    },
  });
  return ws.me();
}

describe("finishLogin", () => {
  it("moves the tokens into memory and empties the hop store", async () => {
    const hop = new InMemoryCredentialStore();
    const memory = new InMemoryCredentialStore();
    await fillRegion(hop, "us");
    const { expiresAt } = await finishLogin(hop, memory, "us");
    expect(expiresAt).toBe(EXPIRES_AT);
    expect(memory.get(CREDENTIAL_KEYS.tokens("us"))).toBe(TOKENS_PAYLOAD);
    for (const key of CREDENTIAL_KEYS.all("us")) {
      expect(hop.get(key)).toBeNull();
    }
    // Only the tokens crossed over.
    expect(memory.get(CREDENTIAL_KEYS.clientInfo("us"))).toBeNull();
    expect(memory.get(CREDENTIAL_KEYS.pendingLogin("us"))).toBeNull();
  });

  it("works over the storage adapter the page uses for the hop", async () => {
    const { storage, map } = mapStorage();
    const hop = new LocalStorageCredentialStore(storage);
    const memory = new InMemoryCredentialStore();
    await fillRegion(hop, "eu");
    storage.setItem(REGION_STORAGE_KEY, "eu");
    await finishLogin(hop, memory, "eu");
    expect(memory.get(CREDENTIAL_KEYS.tokens("eu"))).toBe(TOKENS_PAYLOAD);
    // Everything of the library's leaves storage; the page's own region
    // key is the callback page's to remove.
    expect([...map.keys()]).toStrictEqual([REGION_STORAGE_KEY]);
  });

  it("wipes the hop store even when there is nothing to move", async () => {
    const hop = new InMemoryCredentialStore();
    const memory = new InMemoryCredentialStore();
    hop.set(CREDENTIAL_KEYS.clientInfo("us"), "{}");
    await expect(finishLogin(hop, memory, "us")).rejects.toThrow(/no tokens/u);
    expect(hop.get(CREDENTIAL_KEYS.clientInfo("us"))).toBeNull();
    expect(memory.get(CREDENTIAL_KEYS.tokens("us"))).toBeNull();
  });
});

describe("signOut", () => {
  it("empties both stores for every region", async () => {
    const memory = new InMemoryCredentialStore();
    const hop = new InMemoryCredentialStore();
    await fillRegion(memory, "us");
    await fillRegion(memory, "in");
    await fillRegion(hop, "eu");
    await signOut(memory, hop, "us");
    const empty = Object.fromEntries(
      REGIONS.flatMap((r) => CREDENTIAL_KEYS.all(r)).map((k) => [k, null]),
    );
    await expect(dump(memory)).resolves.toStrictEqual(empty);
    await expect(dump(hop)).resolves.toStrictEqual(empty);
  });
});

describe("asRegion", () => {
  it.each([
    ["us", "us"],
    ["eu", "eu"],
    ["in", "in"],
    ["US", null],
    ["", null],
    [null, null],
    [42, null],
  ])("narrows %j to %j", (value, expected) => {
    expect(asRegion(value)).toBe(expected);
  });
});

describe("describeError", () => {
  const oauth = (code: string, details?: Record<string, unknown>): OAuthError =>
    new OAuthError("library text", code, details);

  it.each([
    [
      "OAUTH_CONFIG_ERROR",
      oauth("OAUTH_CONFIG_ERROR", { field: "redirectUri" }),
      /redirect URI is not valid \(http:\/\/localhost:5173\/demo\/callback\)/u,
      "offline",
    ],
    [
      "OAUTH_CONFIG_ERROR (storage)",
      oauth("OAUTH_CONFIG_ERROR", { seam: "localStorage", operation: "write" }),
      /refused session storage/u,
      "signed-out",
    ],
    [
      "OAUTH_REGISTRATION_ERROR",
      oauth("OAUTH_REGISTRATION_ERROR", { status_code: 429 }),
      /Could not register this page .* \(OAUTH_REGISTRATION_ERROR\)/u,
      "signed-out",
    ],
    [
      "BROWSER_NO_PENDING_LOGIN",
      new BrowserUnsupportedError("x", BROWSER_NO_PENDING_LOGIN, {
        region: "us",
      }),
      /No sign-in in progress in this tab/u,
      "signed-out",
    ],
    [
      "OAUTH_AUTH_DENIED",
      oauth("OAUTH_AUTH_DENIED"),
      /declined/u,
      "signed-out",
    ],
    [
      "OAUTH_STATE_MISMATCH",
      oauth("OAUTH_STATE_MISMATCH"),
      /did not match this tab/u,
      "signed-out",
    ],
    [
      "OAUTH_PASTE_ERROR",
      oauth("OAUTH_PASTE_ERROR"),
      /malformed/u,
      "signed-out",
    ],
    [
      "OAUTH_TOKEN_ERROR (exchange)",
      oauth("OAUTH_TOKEN_ERROR", { status_code: 400 }),
      /refused the token exchange \(OAUTH_TOKEN_ERROR\)/u,
      "signed-out",
    ],
    [
      "OAUTH_TOKEN_ERROR (expired)",
      oauth("OAUTH_TOKEN_ERROR", { region: "us", has_refresh_token: true }),
      new RegExp(
        `expired at ${clockTime(EXPIRES_AT)}[.] The browser package has no refresh`,
        "u",
      ),
      "signed-out",
    ],
    [
      "ConfigError 401",
      new ConfigError("x", { status_code: 401, account_name: "browser" }),
      /token was rejected/u,
      "signed-out",
    ],
    [
      "ConfigError 403",
      new ConfigError("x", { status_code: 403, account_name: "browser" }),
      /cannot list projects/u,
      "signed-out",
    ],
    [
      "AuthenticationError",
      new AuthenticationError(),
      /no longer valid/u,
      "signed-out",
    ],
  ] as const)("%s ends the session", (_label, error, message, retry) => {
    const described = describeError(error, {
      redirectUri: REDIRECT_URI,
      expiresAt: EXPIRES_AT,
    });
    expect(described.fatal).toBe(true);
    expect(described.retry).toBe(retry);
    expect(described.message).toMatch(message);
    expect(described.code).toBe(error.code);
    expect(described.className).toBe(error.name);
  });

  it.each([
    ["QueryError", new QueryError("bad params", { statusCode: 400 }), 400],
    ["RateLimitError", new RateLimitError("slow down", { retryAfter: 7 }), 429],
    ["ServerError", new ServerError("boom", { statusCode: 503 }), 503],
  ])("%s stays inline with its status", (_label, error, status) => {
    const described = describeError(error);
    expect(described.fatal).toBe(false);
    expect(described.retry).toBeNull();
    expect(described.statusCode).toBe(status);
    expect(described.code).toBe(error.code);
    expect(described.message).toBe(error.message);
  });

  it("lists the suggestions of an unknown event", () => {
    const described = describeError(
      new EventNotFoundError("Sign Up", ["Signup", "Sign In"]),
    );
    expect(described.fatal).toBe(false);
    expect(described.message).toBe(
      '"Sign Up" is not an event of this project. Suggestions: Signup, Sign In.',
    );
    expect(described.code).toBe("EVENT_NOT_FOUND");
  });

  it("names the missing fixture route", () => {
    const described = describeError(
      new Error("demo fixture miss: GET /api/query/nothing"),
    );
    expect(described).toStrictEqual({
      code: null,
      className: "Error",
      message:
        "Playground fixture missing for GET /api/query/nothing — please report this.",
      statusCode: null,
      details: null,
      fatal: false,
      retry: null,
    });
  });

  it("hides an empty details bag and keeps a non-empty one", () => {
    expect(describeError(oauth("OAUTH_AUTH_DENIED")).details).toBeNull();
    expect(
      describeError(oauth("OAUTH_AUTH_DENIED", { a: 1 })).details,
    ).toStrictEqual({ a: 1 });
  });

  it("copes with a non-Error rejection", () => {
    expect(describeError("nope").message).toBe("nope");
  });

  it("builds the no-pending-login copy without the library", () => {
    const fromLibrary = describeError(
      new BrowserUnsupportedError("x", BROWSER_NO_PENDING_LOGIN),
    );
    expect(noPendingLoginError()).toStrictEqual({
      ...fromLibrary,
      details: null,
    });
  });
});

describe("project picker", () => {
  const payload = {
    user_id: 7,
    user_email: "me@example.com",
    organizations: {
      "10": { id: 10, name: "zeta" },
      "20": { id: 20, name: "Alpha" },
    },
    projects: {
      "3": { name: "beta", organization_id: 10 },
      "1": { name: "Gamma", organization_id: 20 },
      "2": { name: "alpha", organization_id: 20 },
      "4": { name: "Orphan", organization_id: 99 },
    },
    workspaces: {
      "100": { id: 100, name: "Zoo", project_id: 1, is_default: false },
      "101": { id: 101, name: "Main", project_id: 1, is_default: true },
      "102": { id: 102, name: "Extra", project_id: 1, is_default: false },
      "200": { id: 200, name: "Only", project_id: 2, is_default: true },
    },
  };

  it("groups by organization, case-folded, with workspaces default-first", async () => {
    const groups = groupProjects(await meFrom(payload));
    expect(
      groups.map((g) => [g.organization, g.projects.map((p) => p.id)]),
    ).toStrictEqual([
      ["Alpha", ["2", "1"]],
      ["Organization 99", ["4"]],
      ["zeta", ["3"]],
    ]);
    const gamma = groups[0]?.projects[1];
    expect(gamma?.workspaces.map((w) => w.name)).toStrictEqual([
      "Main",
      "Extra",
      "Zoo",
    ]);
    expect(defaultWorkspace(gamma?.workspaces ?? [])?.id).toBe(101);
    expect(
      defaultWorkspace(groups[2]?.projects[0]?.workspaces ?? []),
    ).toBeNull();
  });

  it("falls back to the first workspace when none is the default", () => {
    expect(
      defaultWorkspace([
        { id: 1, name: "a", isDefault: false },
        { id: 2, name: "b", isDefault: false },
      ])?.id,
    ).toBe(1);
  });
});

describe("live setup snippet", () => {
  it("quotes the picked target and omits an absent workspace", () => {
    expect(LIVE_SETUP).toContain(
      'await ws.use({ project: "12345", workspace: 67 });',
    );
    expect(
      liveSetup({ region: "eu", project: "99", workspace: null }),
    ).toContain('region: "eu",\n');
    expect(
      liveSetup({ region: "eu", project: "99", workspace: null }),
    ).toContain('await ws.use({ project: "99" });');
  });
});

describe("redirect login round trip", () => {
  it("lands the tokens in memory, nothing in the hop store, and /me answers", async () => {
    const requests: string[] = [];
    const fixtures = fixtureFetch(DEMO_FIXTURES, {
      today: () => new Date(2026, 8, 15),
    });
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(`${request.method} ${new URL(request.url).pathname}`);
      if (request.url.endsWith("/oauth/mcp/register/")) {
        return Response.json({ client_id: "dcr-client-123" }, { status: 201 });
      }
      if (request.url.endsWith("/oauth/token/")) {
        return Response.json({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "openid",
        });
      }
      expect(request.headers.get("authorization")).toBe(
        "Bearer new-access-token",
      );
      return fixtures(input, init);
    };
    const { storage, map } = mapStorage();
    const hop = new LocalStorageCredentialStore(storage);
    const memory = new InMemoryCredentialStore();
    const now = Date.UTC(2026, 8, 15, 10, 0, 0);

    const begun = await beginLogin({
      region: "us",
      redirectUri: REDIRECT_URI,
      store: hop,
      fetch: fetchImpl,
      now: () => now,
    });
    expect(map.has(CREDENTIAL_KEYS.pendingLogin("us"))).toBe(true);
    expect(map.has(CREDENTIAL_KEYS.clientInfo("us"))).toBe(true);
    const state = new URL(begun.authorizeUrl).searchParams.get("state");

    await completeLogin({
      region: "us",
      returnUrl: `${REDIRECT_URI}?code=auth-code&state=${state ?? ""}`,
      store: hop,
      fetch: fetchImpl,
      now: () => now,
    });
    const { expiresAt } = await finishLogin(hop, memory, "us");
    expect(Date.parse(expiresAt)).toBe(now + 3600 * 1000);
    expect(map.size).toBe(0);

    const ws = await createBrowserWorkspaceFromStore({
      region: "us",
      projectId: "0",
      store: memory,
      fetch: fetchImpl,
      now: () => now,
    });
    const me = await ws.me();
    expect(me.user_email).toBe(DEMO_FIXTURES.project.userEmail);
    const [group] = groupProjects(me);
    const project = group?.projects[0];
    expect(project?.id).toBe(DEMO_FIXTURES.project.id);
    await ws.use({
      project: project?.id ?? "",
      workspace: defaultWorkspace(project?.workspaces ?? [])?.id ?? null,
    });
    const top = await ws.topEvents({ limit: 3 });
    expect(top).toHaveLength(3);
    expect(requests).toStrictEqual([
      "POST /oauth/mcp/register/",
      "POST /oauth/token/",
      "GET /api/app/me",
      "GET /api/query/events/top",
    ]);

    await signOut(memory, hop, "us");
    expect(memory.get(CREDENTIAL_KEYS.tokens("us"))).toBeNull();
  });
});
