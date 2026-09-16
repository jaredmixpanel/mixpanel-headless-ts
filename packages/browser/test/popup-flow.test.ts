// The browser popup PKCE flow (loginInPopup / relayPopupReturn). The token
// protocol underneath is beginLogin / completeLogin (redirect-flow.test.ts);
// everything here — the window seam, the message gates, the close poll, the
// timeout, cancellation and the in-flight guard — is browser-only contract
// with no Python twin. The timeout code and budget mirror Python's callback
// server (mixpanel_headless._internal.auth.callback_server).

import { describe, expect, it, vi } from "vitest";

import { OAuthError } from "@mixpanel-headless/core";

import { InMemoryCredentialStore } from "../src/credential-store.js";
import {
  BROWSER_POPUP_BLOCKED,
  BROWSER_POPUP_CLOSED,
  BrowserUnsupportedError,
  completeLogin,
  CREDENTIAL_KEYS,
  DEFAULT_POPUP_TIMEOUT_MS,
  loginInPopup,
  POPUP_RETURN_MESSAGE_TYPE,
  POPUP_WINDOW_NAME,
  type PopupHost,
  type PopupWindowLike,
  relayPopupReturn,
} from "../src/index.js";
import {
  type BodyCapturingTransport,
  bodyCapturingTransport,
  jsonResponse,
  makeTokenResponse,
} from "./flow-helpers.js";

const PAGE_ORIGIN = "https://app.example.com";
const REDIRECT_URI = `${PAGE_ORIGIN}/oauth/callback`;
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

/** A controllable popup double. */
interface FakePopup extends PopupWindowLike {
  closed: boolean;
  readonly close: ReturnType<typeof vi.fn<() => void>>;
  readonly focus: ReturnType<typeof vi.fn<() => void>>;
}

/**
 * Build a popup double whose `close()` flips `closed`, as a real
 * `WindowProxy` does.
 *
 * @returns The popup double.
 */
function fakePopup(): FakePopup {
  const popup: FakePopup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
    focus: vi.fn(),
  };
  return popup;
}

/** One recorded `open` call. */
interface OpenCall {
  readonly url: string;
  readonly name: string;
  readonly features: string;
}

/** A scheduled timer on the fake host. */
interface FakeTimer {
  readonly fn: () => void;
  readonly ms: number;
}

/**
 * The `PopupHost` double: records listeners, `open` calls and timers,
 * and lets the test deliver messages and fire timers by hand — the
 * browser project runs under Node with no DOM, so the seam is the only
 * window there is.
 */
interface FakeHost extends PopupHost {
  readonly listeners: Set<(event: MessageEvent) => void>;
  readonly opens: OpenCall[];
  readonly timeouts: Map<number, FakeTimer>;
  readonly intervals: Map<number, FakeTimer>;
  /** What the next `open` returns (`null` = popup blocker). */
  nextPopup: FakePopup | null;
  /** Deliver a `message` event to every live listener. */
  readonly dispatch: (event: {
    readonly origin: string;
    readonly source: unknown;
    readonly data: unknown;
  }) => void;
  /** Run every live interval callback once. */
  readonly tick: () => void;
  /** Fire every pending timeout. */
  readonly expire: () => void;
}

/**
 * Build the host double.
 *
 * @param origin - The page's own origin.
 * @returns The host double.
 */
function fakeHost(origin: string = PAGE_ORIGIN): FakeHost {
  let nextHandle = 1;
  const host: FakeHost = {
    origin,
    listeners: new Set(),
    opens: [],
    timeouts: new Map(),
    intervals: new Map(),
    nextPopup: fakePopup(),
    open: (url, name, features) => {
      host.opens.push({ url, name, features });
      return host.nextPopup;
    },
    addEventListener: (_type, listener) => {
      host.listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      host.listeners.delete(listener);
    },
    setInterval: (fn, ms) => {
      const handle = nextHandle++;
      host.intervals.set(handle, { fn, ms });
      return handle;
    },
    clearInterval: (handle) => {
      host.intervals.delete(handle as number);
    },
    setTimeout: (fn, ms) => {
      const handle = nextHandle++;
      host.timeouts.set(handle, { fn, ms });
      return handle;
    },
    clearTimeout: (handle) => {
      host.timeouts.delete(handle as number);
    },
    dispatch: (event) => {
      for (const listener of host.listeners) {
        listener(event as unknown as MessageEvent);
      }
    },
    tick: () => {
      for (const timer of host.intervals.values()) {
        timer.fn();
      }
    },
    expire: () => {
      for (const timer of host.timeouts.values()) {
        timer.fn();
      }
    },
  };
  return host;
}

/** Everything one popup-login scenario needs. */
interface Scenario {
  readonly store: InMemoryCredentialStore;
  readonly transport: BodyCapturingTransport;
  readonly host: FakeHost;
  readonly login: Promise<unknown>;
  /** `true` once `login` has settled either way. */
  readonly settled: () => boolean;
}

/**
 * Start a popup login over a canned IdP with a frozen clock and wait
 * until the flow has reached `open`.
 *
 * @param overrides - Extra `loginInPopup` options.
 * @param host - The host double (default: a fresh one).
 * @returns The scenario.
 */
async function startLogin(
  overrides: Partial<Parameters<typeof loginInPopup>[0]> = {},
  host: FakeHost = fakeHost(),
): Promise<Scenario> {
  const store = new InMemoryCredentialStore();
  const transport = cannedIdp();
  let isSettled = false;
  const login = loginInPopup({
    region: "us",
    redirectUri: REDIRECT_URI,
    store,
    fetch: transport.fetch,
    now: () => FROZEN_NOW_MS,
    host,
    ...overrides,
  });
  login.then(
    () => {
      isSettled = true;
    },
    () => {
      isSettled = true;
    },
  );
  await vi.waitFor(() => {
    expect(host.opens.length + (isSettled ? 1 : 0)).toBeGreaterThan(0);
  });
  return { store, transport, host, login, settled: () => isSettled };
}

/**
 * The state of the pending record beginLogin wrote.
 *
 * @param store - The store.
 * @returns The state string.
 */
function pendingState(store: InMemoryCredentialStore): string {
  const raw = store.get(CREDENTIAL_KEYS.pendingLogin("us"));
  expect(raw).not.toBeNull();
  return (JSON.parse(raw!) as { state: string }).state;
}

/**
 * The relay message for a return URL, as the relay page would post it.
 *
 * @param url - The return URL.
 * @returns The message payload.
 */
function relayMessage(url: string): Record<string, unknown> {
  return { type: POPUP_RETURN_MESSAGE_TYPE, v: 1, url };
}

/**
 * Let queued macrotasks run, so a promise that was going to settle has.
 *
 * @returns Resolves on the next macrotask.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("constants", () => {
  it("pins the window name, the message type and Python's callback budget", () => {
    expect(POPUP_WINDOW_NAME).toBe("mixpanel-headless-login");
    expect(POPUP_RETURN_MESSAGE_TYPE).toBe("mixpanel-headless/oauth-return");
    expect(DEFAULT_POPUP_TIMEOUT_MS).toBe(300_000);
  });
});

describe("loginInPopup", () => {
  it("opens the authorize URL in the named popup and completes on the relayed return", async () => {
    const { store, transport, host, login } = await startLogin();
    const popup = host.nextPopup!;
    expect(host.opens).toStrictEqual([
      {
        url: expect.stringMatching(
          /^https:\/\/mixpanel\.com\/oauth\/authorize\/\?/,
        ) as string,
        name: POPUP_WINDOW_NAME,
        features: "popup=yes,width=520,height=760",
      },
    ]);
    expect(popup.focus).toHaveBeenCalledTimes(1);
    // The listener, the close poll and the timeout are all live.
    expect(host.listeners.size).toBe(1);
    expect([...host.intervals.values()].map((timer) => timer.ms)).toStrictEqual(
      [500],
    );
    expect([...host.timeouts.values()].map((timer) => timer.ms)).toStrictEqual([
      DEFAULT_POPUP_TIMEOUT_MS,
    ]);

    const state = pendingState(store);
    host.dispatch({
      origin: PAGE_ORIGIN,
      source: popup,
      data: relayMessage(`${REDIRECT_URI}?code=auth-code&state=${state}`),
    });
    const tokens = await login;
    expect(tokens).toMatchObject({ token_type: "Bearer" });
    expect(store.get(CREDENTIAL_KEYS.tokens("us"))).not.toBeNull();
    // Pending record consumed; every hook torn down; popup closed.
    expect(store.get(CREDENTIAL_KEYS.pendingLogin("us"))).toBeNull();
    expect(host.listeners.size).toBe(0);
    expect(host.intervals.size).toBe(0);
    expect(host.timeouts.size).toBe(0);
    expect(popup.close).toHaveBeenCalledTimes(1);
    // The token endpoint saw exactly one exchange.
    expect(
      transport.captures.filter((request) => request.url.endsWith("token/")),
    ).toHaveLength(1);
  });

  it("forwards windowFeatures and timeoutMs to the seam", async () => {
    const { host, login } = await startLogin({
      windowFeatures: "popup=yes,width=400,height=600",
      timeoutMs: 1_000,
    });
    expect(host.opens[0]?.features).toBe("popup=yes,width=400,height=600");
    expect([...host.timeouts.values()][0]?.ms).toBe(1_000);
    host.expire();
    await expect(login).rejects.toMatchObject({ code: "OAUTH_TIMEOUT" });
  });

  it("subscribes to messages before opening the popup", async () => {
    const host = fakeHost();
    let listenersAtOpen = -1;
    const popup = host.nextPopup;
    host.open = (url, name, features) => {
      listenersAtOpen = host.listeners.size;
      host.opens.push({ url, name, features });
      return popup;
    };
    const { login } = await startLogin({}, host);
    expect(listenersAtOpen).toBe(1);
    popup!.closed = true;
    host.tick();
    await expect(login).rejects.toMatchObject({ code: BROWSER_POPUP_CLOSED });
  });

  describe("ignored messages keep the flow waiting", () => {
    it.each([
      [
        "wrong origin",
        (popup: FakePopup, state: string) => ({
          origin: "https://evil.example.net",
          source: popup,
          data: relayMessage(`${REDIRECT_URI}?code=X&state=${state}`),
        }),
      ],
      [
        "right origin, wrong source",
        (_popup: FakePopup, state: string) => ({
          origin: PAGE_ORIGIN,
          source: { closed: false },
          data: relayMessage(`${REDIRECT_URI}?code=X&state=${state}`),
        }),
      ],
      [
        "null source",
        (_popup: FakePopup, state: string) => ({
          origin: PAGE_ORIGIN,
          source: null,
          data: relayMessage(`${REDIRECT_URI}?code=X&state=${state}`),
        }),
      ],
      [
        "wrong type",
        (popup: FakePopup, state: string) => ({
          origin: PAGE_ORIGIN,
          source: popup,
          data: {
            type: "other/thing",
            v: 1,
            url: `${REDIRECT_URI}?code=X&state=${state}`,
          },
        }),
      ],
      [
        "wrong version",
        (popup: FakePopup, state: string) => ({
          origin: PAGE_ORIGIN,
          source: popup,
          data: {
            type: POPUP_RETURN_MESSAGE_TYPE,
            v: 2,
            url: `${REDIRECT_URI}?code=X&state=${state}`,
          },
        }),
      ],
      [
        "non-string url",
        (popup: FakePopup) => ({
          origin: PAGE_ORIGIN,
          source: popup,
          data: { type: POPUP_RETURN_MESSAGE_TYPE, v: 1, url: 42 },
        }),
      ],
      [
        "non-object data",
        (popup: FakePopup) => ({
          origin: PAGE_ORIGIN,
          source: popup,
          data: "mixpanel-headless/oauth-return",
        }),
      ],
      [
        "wrong state",
        (popup: FakePopup) => ({
          origin: PAGE_ORIGIN,
          source: popup,
          data: relayMessage(`${REDIRECT_URI}?code=X&state=FORGED`),
        }),
      ],
    ])(
      "ignores %s, then completes on the correct message",
      async (_label, forge) => {
        const { store, transport, host, login, settled } = await startLogin();
        const popup = host.nextPopup!;
        const state = pendingState(store);
        const tokenCalls = (): number =>
          transport.captures.filter((request) => request.url.endsWith("token/"))
            .length;

        host.dispatch(forge(popup, state));
        await flush();
        expect(settled()).toBe(false);
        expect(host.listeners.size).toBe(1);
        expect(tokenCalls()).toBe(0);
        // The pending record is intact — the real return can still land.
        expect(pendingState(store)).toBe(state);

        host.dispatch({
          origin: PAGE_ORIGIN,
          source: popup,
          data: relayMessage(`${REDIRECT_URI}?code=auth-code&state=${state}`),
        });
        await expect(login).resolves.toMatchObject({ token_type: "Bearer" });
        expect(tokenCalls()).toBe(1);
      },
    );
  });

  it("rejects a relayed URL outside the redirect URI with OAUTH_PASTE_ERROR and keeps the pending record", async () => {
    const { store, transport, host, login } = await startLogin();
    const popup = host.nextPopup!;
    const state = pendingState(store);
    host.dispatch({
      origin: PAGE_ORIGIN,
      source: popup,
      data: relayMessage(`${PAGE_ORIGIN}/elsewhere?code=X&state=${state}`),
    });
    const error = await login.then(
      () => null,
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_PASTE_ERROR");
    // Consistent with completeLogin's parse failures: the record stays.
    expect(pendingState(store)).toBe(state);
    expect(host.listeners.size).toBe(0);
    expect(host.intervals.size).toBe(0);
    expect(host.timeouts.size).toBe(0);
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(
      transport.captures.filter((request) => request.url.endsWith("token/")),
    ).toHaveLength(0);
  });

  it("forwards a provider error return even when its state does not match (OAUTH_AUTH_DENIED, not a timeout)", async () => {
    const { store, host, login } = await startLogin();
    host.dispatch({
      origin: PAGE_ORIGIN,
      source: host.nextPopup!,
      data: relayMessage(
        `${REDIRECT_URI}?error=access_denied&error_description=user+cancelled`,
      ),
    });
    await expect(login).rejects.toMatchObject({ code: "OAUTH_AUTH_DENIED" });
    // completeLogin's own parse failure keeps the record, as in the
    // redirect flow.
    expect(store.get(CREDENTIAL_KEYS.pendingLogin("us"))).not.toBeNull();
  });

  it("rejects with BROWSER_POPUP_BLOCKED when open returns null and keeps the pending record for the link-and-paste fallback", async () => {
    const host = fakeHost();
    host.nextPopup = null;
    const { store, transport, login } = await startLogin({}, host);
    const error = await login.then(
      () => null,
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(BrowserUnsupportedError);
    expect((error as BrowserUnsupportedError).code).toBe(BROWSER_POPUP_BLOCKED);
    const details = (error as BrowserUnsupportedError).details as {
      reason: string;
      authorize_url: string;
      state: string;
    };
    const state = pendingState(store);
    expect(details).toStrictEqual({
      reason: "blocked",
      authorize_url: expect.stringContaining("/oauth/authorize/") as string,
      state,
    });
    expect(new URL(details.authorize_url).searchParams.get("state")).toBe(
      state,
    );
    expect(host.listeners.size).toBe(0);
    expect(host.intervals.size).toBe(0);
    expect(host.timeouts.size).toBe(0);
    expect(
      transport.captures.filter((request) => request.url.endsWith("token/")),
    ).toHaveLength(0);

    // The fallback: the user follows the link, pastes the return, and
    // completeLogin on the same store still succeeds.
    const tokens = await completeLogin({
      region: "us",
      returnUrl: `${REDIRECT_URI}?code=auth-code&state=${details.state}`,
      store,
      fetch: transport.fetch,
      now: () => FROZEN_NOW_MS,
    });
    expect(tokens.token_type).toBe("Bearer");
    expect(store.get(CREDENTIAL_KEYS.pendingLogin("us"))).toBeNull();
  });

  it("rejects with BROWSER_POPUP_CLOSED when the popup closes before returning", async () => {
    const { store, host, login } = await startLogin();
    const popup = host.nextPopup!;
    // A poll while the popup is still open changes nothing.
    host.tick();
    await flush();
    expect(host.listeners.size).toBe(1);

    popup.closed = true;
    host.tick();
    const error = await login.then(
      () => null,
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(BrowserUnsupportedError);
    expect((error as BrowserUnsupportedError).code).toBe(BROWSER_POPUP_CLOSED);
    expect(store.get(CREDENTIAL_KEYS.pendingLogin("us"))).toBeNull();
    expect(host.listeners.size).toBe(0);
    expect(host.intervals.size).toBe(0);
    expect(host.timeouts.size).toBe(0);
    // Already closed by the user: close() is not called again.
    expect(popup.close).not.toHaveBeenCalled();
  });

  it("rejects with OAUTH_TIMEOUT when no return arrives, closes the popup and discards the pending record", async () => {
    const { store, host, login } = await startLogin();
    const popup = host.nextPopup!;
    host.expire();
    const error = await login.then(
      () => null,
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_TIMEOUT");
    expect((error as OAuthError).details).toStrictEqual({
      timeout_ms: DEFAULT_POPUP_TIMEOUT_MS,
    });
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(store.get(CREDENTIAL_KEYS.pendingLogin("us"))).toBeNull();
    expect(host.listeners.size).toBe(0);
    expect(host.intervals.size).toBe(0);
    expect(host.timeouts.size).toBe(0);
  });

  it("rejects with the signal's own reason on abort, closes the popup and discards the pending record", async () => {
    const controller = new AbortController();
    const { store, host, login } = await startLogin({
      signal: controller.signal,
    });
    const popup = host.nextPopup!;
    const reason = new Error("user navigated away");
    controller.abort(reason);
    // Passed through untouched, never wrapped.
    await expect(login).rejects.toBe(reason);
    expect(popup.close).toHaveBeenCalledTimes(1);
    expect(store.get(CREDENTIAL_KEYS.pendingLogin("us"))).toBeNull();
    expect(host.listeners.size).toBe(0);
    expect(host.intervals.size).toBe(0);
    expect(host.timeouts.size).toBe(0);
  });

  it("refuses an already-aborted signal before any network or popup", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled first");
    controller.abort(reason);
    const host = fakeHost();
    const transport = cannedIdp();
    await expect(
      loginInPopup({
        region: "us",
        redirectUri: REDIRECT_URI,
        store: new InMemoryCredentialStore(),
        fetch: transport.fetch,
        host,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(transport.captures).toHaveLength(0);
    expect(host.opens).toHaveLength(0);
    expect(host.listeners.size).toBe(0);
  });

  it("refuses a second concurrent call over the same store and region with BROWSER_POPUP_BLOCKED (in_flight)", async () => {
    const first = await startLogin();
    const secondHost = fakeHost();
    const error = await loginInPopup({
      region: "us",
      redirectUri: REDIRECT_URI,
      store: first.store,
      fetch: first.transport.fetch,
      now: () => FROZEN_NOW_MS,
      host: secondHost,
    }).then(
      () => null,
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(BrowserUnsupportedError);
    expect((error as BrowserUnsupportedError).code).toBe(BROWSER_POPUP_BLOCKED);
    expect((error as BrowserUnsupportedError).details).toStrictEqual({
      reason: "in_flight",
      region: "us",
    });
    // The second call touched nothing: no popup, no DCR, no listener.
    expect(secondHost.opens).toHaveLength(0);
    expect(secondHost.listeners.size).toBe(0);
    expect(first.transport.captures).toHaveLength(1);

    // The first flow is unaffected and still completes.
    const state = pendingState(first.store);
    first.host.dispatch({
      origin: PAGE_ORIGIN,
      source: first.host.nextPopup!,
      data: relayMessage(`${REDIRECT_URI}?code=auth-code&state=${state}`),
    });
    await expect(first.login).resolves.toMatchObject({ token_type: "Bearer" });

    // Once settled, the slot is free again.
    const again = await startLogin({}, fakeHost());
    expect(again.host.opens).toHaveLength(1);
    again.host.expire();
    await expect(again.login).rejects.toMatchObject({ code: "OAUTH_TIMEOUT" });
  });

  it("lets a different region or store proceed while one login is in flight", async () => {
    const first = await startLogin();
    const eu = await startLogin({ region: "eu", store: first.store });
    expect(eu.host.opens).toHaveLength(1);
    eu.host.expire();
    await expect(eu.login).rejects.toMatchObject({ code: "OAUTH_TIMEOUT" });
    first.host.expire();
    await expect(first.login).rejects.toMatchObject({ code: "OAUTH_TIMEOUT" });
  });

  it("rejects a redirectUri on another origin with OAUTH_CONFIG_ERROR before any network", async () => {
    const host = fakeHost("https://embedded.example.org");
    const transport = cannedIdp();
    const store = new InMemoryCredentialStore();
    const error = await loginInPopup({
      region: "us",
      redirectUri: REDIRECT_URI,
      store,
      fetch: transport.fetch,
      host,
    }).then(
      () => null,
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(OAuthError);
    expect((error as OAuthError).code).toBe("OAUTH_CONFIG_ERROR");
    expect((error as OAuthError).details).toStrictEqual({
      field: "redirectUri",
      expected_origin: "https://embedded.example.org",
      origin: PAGE_ORIGIN,
    });
    expect(transport.captures).toHaveLength(0);
    expect(host.opens).toHaveLength(0);
    expect(host.listeners.size).toBe(0);
    expect(store.get(CREDENTIAL_KEYS.pendingLogin("us"))).toBeNull();
  });

  it("leaves an unparseable redirectUri to beginLogin's own gate", async () => {
    const transport = cannedIdp();
    await expect(
      loginInPopup({
        region: "us",
        redirectUri: "not a url",
        store: new InMemoryCredentialStore(),
        fetch: transport.fetch,
        host: fakeHost(),
      }),
    ).rejects.toMatchObject({ code: "OAUTH_CONFIG_ERROR" });
    expect(transport.captures).toHaveLength(0);
  });

  it("rejects with BROWSER_POPUP_BLOCKED (no_window) when there is no window and no host", async () => {
    // The default host wraps the page's window lazily: importing the
    // module under Node is fine, and only calling without a window fails.
    const transport = cannedIdp();
    const error = await loginInPopup({
      region: "us",
      redirectUri: REDIRECT_URI,
      store: new InMemoryCredentialStore(),
      fetch: transport.fetch,
    }).then(
      () => null,
      (error_: unknown) => error_,
    );
    expect(error).toBeInstanceOf(BrowserUnsupportedError);
    expect((error as BrowserUnsupportedError).code).toBe(BROWSER_POPUP_BLOCKED);
    expect((error as BrowserUnsupportedError).details).toStrictEqual({
      reason: "no_window",
    });
    expect(transport.captures).toHaveLength(0);
  });

  it("forwards maxPendingAgeMs to completeLogin", async () => {
    let nowMs = FROZEN_NOW_MS;
    const { store, host, login } = await startLogin({
      now: () => nowMs,
      maxPendingAgeMs: 1_000,
    });
    const popup = host.nextPopup!;
    const state = pendingState(store);
    nowMs += 2_000;
    host.dispatch({
      origin: PAGE_ORIGIN,
      source: popup,
      data: relayMessage(`${REDIRECT_URI}?code=auth-code&state=${state}`),
    });
    await expect(login).rejects.toMatchObject({
      code: "BROWSER_NO_PENDING_LOGIN",
    });
    // The popup is closed defensively after completeLogin settles either way.
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it("closes the popup after a failed exchange and survives a close() that throws", async () => {
    const host = fakeHost();
    const popup = host.nextPopup!;
    popup.close.mockImplementation(() => {
      throw new Error("cross-origin window");
    });
    const store = new InMemoryCredentialStore();
    const transport = bodyCapturingTransport((request) => {
      if (request.url.endsWith("mcp/register/")) {
        return jsonResponse(201, { client_id: "dcr-client-123" });
      }
      return jsonResponse(400, { error: "invalid_grant" });
    });
    const { login } = await startLogin({ store, fetch: transport.fetch }, host);
    const state = pendingState(store);
    host.dispatch({
      origin: PAGE_ORIGIN,
      source: popup,
      data: relayMessage(`${REDIRECT_URI}?code=auth-code&state=${state}`),
    });
    // The exchange error wins; the throwing close() is swallowed.
    await expect(login).rejects.toMatchObject({ code: "OAUTH_TOKEN_ERROR" });
    expect(popup.close).toHaveBeenCalledTimes(1);
  });
});

describe("relayPopupReturn", () => {
  /** The relay page's window double. */
  interface RelayWindow {
    name: string;
    opener: unknown;
    location: { href: string; origin: string };
  }

  /**
   * Build a relay-page window double parked on the redirect URI with a
   * return in its query.
   *
   * @param overrides - Fields to change.
   * @returns The window double, typed for the seam.
   */
  function relayWindow(
    overrides: Partial<RelayWindow> = {},
  ): RelayWindow & Pick<Window, "name" | "opener" | "location"> {
    const postMessage = vi.fn();
    return {
      name: POPUP_WINDOW_NAME,
      opener: { closed: false, postMessage },
      location: {
        href: `${REDIRECT_URI}?code=auth-code&state=abc`,
        origin: PAGE_ORIGIN,
      },
      ...overrides,
    } as RelayWindow & Pick<Window, "name" | "opener" | "location">;
  }

  it("posts exactly {type, v, url} to the opener at the page's own origin and returns true", () => {
    const w = relayWindow();
    const postMessage = (w.opener as { postMessage: ReturnType<typeof vi.fn> })
      .postMessage;
    expect(relayPopupReturn({ window: w })).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    const [payload, targetOrigin] = postMessage.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(targetOrigin).toBe(PAGE_ORIGIN);
    expect(Object.keys(payload)).toStrictEqual(["type", "v", "url"]);
    expect(payload).toStrictEqual({
      type: POPUP_RETURN_MESSAGE_TYPE,
      v: 1,
      url: `${REDIRECT_URI}?code=auth-code&state=abc`,
    });
    // Payload discipline: nothing but the page's own address crosses.
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain("verifier");
    expect(wire).not.toContain("access_token");
    expect(wire).not.toContain("refresh_token");
  });

  it("returns false when the window name is not the popup's", () => {
    const w = relayWindow({ name: "" });
    expect(relayPopupReturn({ window: w })).toBe(false);
    expect(
      (w.opener as { postMessage: ReturnType<typeof vi.fn> }).postMessage,
    ).not.toHaveBeenCalled();
  });

  it.each([
    ["no opener", null],
    ["undefined opener", undefined],
    ["closed opener", { closed: true, postMessage: vi.fn() }],
    ["opener without postMessage", { closed: false }],
  ])("returns false with %s", (_label, opener) => {
    expect(relayPopupReturn({ window: relayWindow({ opener }) })).toBe(false);
  });

  it("returns false outside a browser (no window at all)", () => {
    expect(relayPopupReturn()).toBe(false);
  });
});
