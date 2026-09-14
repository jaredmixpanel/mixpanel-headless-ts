// Shared helpers for the B4-C1 client Layer-3 translations: the
// `tests/conftest.py::make_session` mirror, a static token resolver
// (the OnDiskTokenResolver inline-token arm the Python tests exercise
// implicitly), and an httpx.MockTransport analog over the R2.4 injected
// fetch (entry-point substitution per B0-notes decision 13 — handlers
// receive the captured request view and return canned responses).

import type {
  Account,
  OAuthTokenAccount,
  TokenResolver,
} from "../src/auth/account.js";
import type { Region } from "../src/client/url.js";
import type { Session } from "../src/auth/session.js";
import { Secret } from "../src/secret.js";
import { OAuthError } from "../src/errors.js";
import {
  createMixpanelClient,
  type MixpanelClient,
  type MixpanelClientOptions,
} from "../src/client/client.js";

/** Kwargs of the `make_session` mirror (defaults match conftest.py). */
export interface MakeSessionOptions {
  readonly username?: string;
  readonly secret?: string;
  readonly projectId?: string;
  readonly region?: Region;
  readonly name?: string;
  readonly workspaceId?: number | null;
  readonly oauthToken?: string | null;
  readonly headers?: ReadonlyMap<string, string>;
}

/**
 * Build a Session for tests with sensible defaults (conftest.py:65-125).
 *
 * @param options - Overrides.
 * @returns A Session usable for `createMixpanelClient({session})`.
 */
export function makeSession(options: MakeSessionOptions = {}): Session {
  const region = options.region ?? "us";
  const name = options.name ?? "test_account";
  const account: Account =
    options.oauthToken !== undefined && options.oauthToken !== null
      ? {
          type: "oauth_token",
          name,
          region,
          token: new Secret(options.oauthToken),
        }
      : {
          type: "service_account",
          name,
          region,
          username: options.username ?? "test_user",
          secret: new Secret(options.secret ?? "test_secret"),
        };
  return {
    account,
    project: { id: options.projectId ?? "12345" },
    workspace:
      options.workspaceId !== undefined && options.workspaceId !== null
        ? { id: options.workspaceId }
        : null,
    headers: options.headers ?? new Map<string, string>(),
  };
}

/**
 * A TokenResolver mirroring OnDiskTokenResolver's inline-token arm:
 * `oauth_token` accounts resolve their inline `token`; everything else
 * raises `OAuthError` (the missing-token path).
 *
 * @returns The resolver.
 */
export function staticTokenResolver(): TokenResolver {
  return {
    getBrowserToken(): Promise<string> {
      return Promise.reject(new OAuthError("no tokens on disk"));
    },
    getStaticToken(account: OAuthTokenAccount): Promise<string> {
      const token = account.token;
      if (token === undefined || token === null) {
        return Promise.reject(new OAuthError("no static token"));
      }
      return Promise.resolve(token.reveal());
    },
  };
}

/** The captured view a fake-fetch handler receives (httpx.Request analog). */
export interface CapturedFetchRequest {
  /** HTTP method, uppercase. */
  readonly method: string;
  /** The full request URL (query string included). */
  readonly url: string;
  /** Parsed query params (single values; repeats collapse to last). */
  readonly params: Readonly<Record<string, string>>;
  /** Request headers, lowercase keys. */
  readonly headers: Readonly<Record<string, string>>;
  /** The request body text (empty string for none). */
  readonly bodyText: string;
}

/** A canned handler response (httpx.Response analog). */
export interface CannedResponse {
  readonly status: number;
  /** JSON body (serialized with JSON.stringify + content-type json). */
  readonly json?: unknown;
  /** Raw text body. */
  readonly text?: string;
  /** Response headers. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** The fake transport: injectable fetch + the capture log. */
export interface FakeTransport {
  readonly fetch: typeof fetch;
  readonly captures: readonly CapturedFetchRequest[];
}

/**
 * Build an httpx.MockTransport analog over the injected-fetch seam.
 *
 * @param handler - Receives each captured request; returns the canned
 *   response (or throws to simulate transport failure — throw a
 *   `TypeError` for the fetch-rejection analog of `httpx.ConnectError`).
 * @returns The fake transport.
 */
export function fakeTransport(
  handler: (request: CapturedFetchRequest) => CannedResponse,
): FakeTransport {
  const captures: CapturedFetchRequest[] = [];
  const fakeFetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const params: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) {
      params[key] = value;
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of request.headers.entries()) {
      headers[key.toLowerCase()] = value;
    }
    const bodyText = await request.text();
    const captured: CapturedFetchRequest = {
      method: request.method.toUpperCase(),
      url: request.url,
      params,
      headers,
      bodyText,
    };
    captures.push(captured);
    const canned = handler(captured);
    const responseHeaders = new Headers(canned.headers ?? {});
    let body: string | null = null;
    if (canned.json !== undefined) {
      body = JSON.stringify(canned.json);
      if (!responseHeaders.has("content-type")) {
        responseHeaders.set("content-type", "application/json");
      }
    } else if (canned.text !== undefined) {
      body = canned.text;
    }
    if ([204, 205, 304].includes(canned.status)) {
      body = null;
    }
    return new Response(body, {
      status: canned.status,
      headers: responseHeaders,
    });
  }) as typeof fetch;
  return { fetch: fakeFetch, captures };
}

/**
 * Create a client with a mock transport (create_mock_client analog).
 * Zero-delay sleep and zero RNG keep retry tests instant and
 * deterministic (B0 deviation 5: `_calculate_backoff` monkeypatch pins
 * translate to injected-RNG-deterministic values).
 *
 * @param session - The session to bind.
 * @param handler - The canned-response handler.
 * @param extra - Additional client options (e.g. `maxRetries`).
 * @returns The client plus the transport capture log.
 */
export function createMockClient(
  session: Session,
  handler: (request: CapturedFetchRequest) => CannedResponse,
  extra: Partial<MixpanelClientOptions> = {},
): { client: MixpanelClient; transport: FakeTransport; sleeps: number[] } {
  const transport = fakeTransport(handler);
  const sleeps: number[] = [];
  const client = createMixpanelClient({
    session,
    fetch: transport.fetch,
    sleep: async (ms: number): Promise<void> => {
      sleeps.push(ms);
    },
    random: () => 0,
    tokenResolver: staticTokenResolver(),
    ...extra,
  });
  return { client, transport, sleeps };
}
