// The playground's live-mode model (docs/.vitepress/theme/demo/model/):
// the token hand-off from the hop store to memory, sign-out, the error
// copy table keyed on the real error classes, the project picker's
// grouping, the framed page's transport choice and popup outcomes, and
// simulated logins over injected fetches (a redirect, and a popup that
// is completed by paste) — the same library calls the page makes, under Node.

import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  beginLogin,
  BROWSER_NO_PENDING_LOGIN,
  BROWSER_POPUP_BLOCKED,
  BROWSER_POPUP_CLOSED,
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
  loginInPopup,
  OAuthError,
  POPUP_WINDOW_NAME,
  type PopupHost,
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
  POPUP_BLOCKED_MESSAGE,
  POPUP_CANCELED_NOTICE,
  POPUP_TIMEOUT_NOTICE,
  popupLoginOutcome,
} from "../docs/.vitepress/theme/demo/model/errors.js";
import { fixtureFetch } from "../docs/.vitepress/theme/demo/model/fixture-fetch.js";
import {
  asRegion,
  completePastedLogin,
  defaultWorkspace,
  finishLogin,
  groupProjects,
  loginTransport,
  type Me,
  type Region,
  REGION_STORAGE_KEY,
  REGIONS,
  signOut,
  strandedReturn,
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
    [
      "BROWSER_POPUP_CLOSED",
      new BrowserUnsupportedError("x", BROWSER_POPUP_CLOSED, {
        reason: "closed",
      }),
      /^Sign-in canceled\.$/u,
      "signed-out",
    ],
    [
      "OAUTH_TIMEOUT",
      oauth("OAUTH_TIMEOUT", { timeout_ms: 300_000 }),
      /did not return within five minutes/u,
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

  it("keeps a blocked popup inline: the pending record is still usable", () => {
    const described = describeError(
      new BrowserUnsupportedError("x", BROWSER_POPUP_BLOCKED, {
        reason: "blocked",
        authorize_url: "https://mixpanel.com/oauth/authorize/?x=1",
        state: "s",
      }),
    );
    expect(described.fatal).toBe(false);
    expect(described.retry).toBeNull();
    expect(described.message).toBe(POPUP_BLOCKED_MESSAGE);
    expect(described.code).toBe(BROWSER_POPUP_BLOCKED);
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

describe("loginTransport", () => {
  it("picks the redirect flow for a top-level page", () => {
    const top = {};
    expect(loginTransport({ self: top, top })).toBe("redirect");
  });

  it("picks the popup flow for a framed page", () => {
    expect(loginTransport({ self: {}, top: {} })).toBe("popup");
  });
});

describe("popupLoginOutcome", () => {
  const AUTHORIZE_URL = "https://mixpanel.com/oauth/authorize/?state=abc";
  const blocked = (details: Record<string, unknown>): BrowserUnsupportedError =>
    new BrowserUnsupportedError("x", BROWSER_POPUP_BLOCKED, details);

  it("offers the authorize link when the browser refused the window", () => {
    expect(
      popupLoginOutcome(
        blocked({
          reason: "blocked",
          authorize_url: AUTHORIZE_URL,
          state: "abc",
        }),
      ),
    ).toStrictEqual({ kind: "blocked", authorizeUrl: AUTHORIZE_URL });
  });

  it("keeps waiting on a repeat click while the popup is open", () => {
    expect(
      popupLoginOutcome(blocked({ reason: "in_flight", region: "us" })),
    ).toStrictEqual({ kind: "in-flight" });
  });

  it("falls back to the error block for a blocked popup without a link", () => {
    const error = blocked({ reason: "no_window" });
    const described = describeError(error);
    expect(popupLoginOutcome(error)).toStrictEqual({
      kind: "error",
      error: described,
    });
    expect(described.code).toBe(BROWSER_POPUP_BLOCKED);
    expect(described.fatal).toBe(false);
  });

  it("drops back to signed-out quietly when the popup was closed", () => {
    expect(
      popupLoginOutcome(
        new BrowserUnsupportedError("x", BROWSER_POPUP_CLOSED, {
          reason: "closed",
        }),
      ),
    ).toStrictEqual({ kind: "signed-out", notice: POPUP_CANCELED_NOTICE });
  });

  it("drops back to signed-out with the timeout notice", () => {
    expect(
      popupLoginOutcome(
        new OAuthError("x", "OAUTH_TIMEOUT", { timeout_ms: 300_000 }),
      ),
    ).toStrictEqual({ kind: "signed-out", notice: POPUP_TIMEOUT_NOTICE });
  });

  it("hands every other rejection to the redirect flow's mapping", () => {
    const denied = new OAuthError("x", "OAUTH_AUTH_DENIED");
    const described = describeError(denied, { redirectUri: REDIRECT_URI });
    expect(
      popupLoginOutcome(denied, { redirectUri: REDIRECT_URI }),
    ).toStrictEqual({ kind: "error", error: described });
    expect(described.retry).toBe("signed-out");
  });
});

describe("strandedReturn", () => {
  it("is true for the popup window whose opener is gone", () => {
    expect(strandedReturn({ windowName: POPUP_WINDOW_NAME, search: "" })).toBe(
      true,
    );
  });

  it.each(["", "some-other-window"])(
    "is true for an authorization return no window here started (window name %j)",
    (windowName) => {
      expect(
        strandedReturn({ windowName, search: "?code=abc&state=xyz" }),
      ).toBe(true);
    },
  );

  it.each([
    ["nothing", ""],
    ["a code without a state", "?code=abc"],
    ["a provider error", "?error=access_denied&state=xyz"],
  ])("is false for %s", (_label, search) => {
    expect(strandedReturn({ windowName: "", search })).toBe(false);
  });
});

describe("completePastedLogin", () => {
  it("completes first and releases the popup wait afterwards", async () => {
    const order: string[] = [];
    const result = await completePastedLogin(
      async () => {
        await Promise.resolve();
        order.push("complete");
        return "tokens";
      },
      () => {
        order.push("release");
      },
    );
    expect(result).toBe("tokens");
    expect(order).toStrictEqual(["complete", "release"]);
  });

  it("releases the wait even when the paste fails, and rethrows", async () => {
    const order: string[] = [];
    await expect(
      completePastedLogin(
        () => {
          order.push("complete");
          return Promise.reject(new Error("bad paste"));
        },
        () => {
          order.push("release");
        },
      ),
    ).rejects.toThrow("bad paste");
    expect(order).toStrictEqual(["complete", "release"]);
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

describe("popup login completed by paste", () => {
  /**
   * A window seam whose popup never reports back — the case the paste box
   * exists for — over real timers the flow tears down itself.
   *
   * @param origin - The page's origin.
   * @returns The host and the popup it hands out.
   */
  function silentHost(origin: string): {
    host: PopupHost;
    popup: { closed: boolean; close: () => void; focus: () => void };
  } {
    const popup = {
      closed: false,
      close: () => {
        popup.closed = true;
      },
      focus: () => undefined,
    };
    const host: PopupHost = {
      origin,
      open: () => popup,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (handle) => {
        clearInterval(handle as ReturnType<typeof setInterval>);
      },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
    };
    return { host, popup };
  }

  it("lands the tokens in memory with the popup wait still open, then releases it", async () => {
    const fetchImpl: typeof fetch = (input, init) => {
      const request = new Request(input, init);
      if (request.url.endsWith("/oauth/mcp/register/")) {
        return Promise.resolve(
          Response.json({ client_id: "dcr-client-123" }, { status: 201 }),
        );
      }
      expect(request.url.endsWith("/oauth/token/")).toBe(true);
      return Promise.resolve(
        Response.json({
          access_token: "popup-access-token",
          refresh_token: null,
          expires_in: 3600,
          token_type: "Bearer",
          scope: "openid",
        }),
      );
    };
    const memory = new InMemoryCredentialStore();
    const now = Date.UTC(2026, 8, 15, 10, 0, 0);
    const { host, popup } = silentHost(new URL(REDIRECT_URI).origin);
    const controller = new AbortController();

    // The page's attempt: the popup opens and nothing comes back from it.
    const attempt = loginInPopup({
      region: "us",
      redirectUri: REDIRECT_URI,
      store: memory,
      signal: controller.signal,
      host,
      fetch: fetchImpl,
      now: () => now,
    });
    const settled = attempt.then(
      () => "resolved",
      (error: unknown) => error,
    );
    // Let `beginLogin` run so the pending record exists to paste against.
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    const pending = memory.get(CREDENTIAL_KEYS.pendingLogin("us"));
    expect(pending).not.toBeNull();
    const state = (JSON.parse(pending ?? "{}") as { state?: string }).state;

    // The visitor pastes the address the relay page showed them.
    const tokens = await completePastedLogin(
      () =>
        completeLogin({
          region: "us",
          returnUrl: `${REDIRECT_URI}?code=auth-code&state=${state ?? ""}`,
          store: memory,
          fetch: fetchImpl,
          now: () => now,
        }),
      () => {
        controller.abort();
      },
    );
    expect(Date.parse(tokens.expires_at)).toBe(now + 3600 * 1000);
    expect(memory.get(CREDENTIAL_KEYS.tokens("us"))).not.toBeNull();
    // The released wait rejects with the abort reason (which the page
    // ignores), closed the popup, and left the landed tokens alone.
    const released = await settled;
    expect(released).toBeInstanceOf(DOMException);
    expect((released as DOMException).name).toBe("AbortError");
    expect(popup.closed).toBe(true);
    expect(memory.get(CREDENTIAL_KEYS.tokens("us"))).not.toBeNull();
    expect(memory.get(CREDENTIAL_KEYS.pendingLogin("us"))).toBeNull();
  });
});
