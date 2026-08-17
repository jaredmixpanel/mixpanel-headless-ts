// Shared canned-fetch helpers for the B9-R1 browser Layer-3 suites —
// a compact local mirror of the core `client-test-helpers.ts`
// `fakeTransport` (browser tests stay inside the packages/browser
// purity boundary: no node:* imports, no cross-package test coupling).
// All traffic in these suites is canned (b9-packets.md ground rule:
// the D2 spike owns the batch's only live budget).

/** The captured view a fake-fetch handler receives. */
export interface CapturedFetchRequest {
  /** HTTP method, uppercase. */
  readonly method: string;
  /** The full request URL (query string included). */
  readonly url: string;
  /** Parsed query params (single values; repeats collapse to last). */
  readonly params: Readonly<Record<string, string>>;
  /** Request headers, lowercase keys. */
  readonly headers: Readonly<Record<string, string>>;
}

/** A canned handler response. */
export interface CannedResponse {
  /** HTTP status code. */
  readonly status: number;
  /** JSON body (serialized with JSON.stringify + content-type json). */
  readonly json?: unknown;
}

/** The fake transport: injectable fetch + the capture log. */
export interface FakeTransport {
  /** The injectable fetch double. */
  readonly fetch: typeof fetch;
  /** Requests that reached the double (post-guard traffic only). */
  readonly captures: readonly CapturedFetchRequest[];
}

/**
 * Build a canned transport over the R2.4 injected-fetch seam.
 *
 * @param handler - Receives each captured request; returns the canned
 *   response.
 * @returns The fake transport with its capture log.
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
    const captured: CapturedFetchRequest = {
      method: request.method.toUpperCase(),
      url: request.url,
      params,
      headers,
    };
    captures.push(captured);
    const canned = handler(captured);
    return new Response(JSON.stringify(canned.json ?? null), {
      status: canned.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: fakeFetch, captures };
}

/** A minimal Storage-shaped double backed by a Map (StorageLike twin). */
export interface FakeStorage {
  /** The injectable Storage-shaped object. */
  readonly storage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
  /** The backing map, for direct assertions. */
  readonly map: Map<string, string>;
}

/**
 * Build an injectable `StorageLike` double over a plain Map.
 *
 * @returns The storage double plus its backing map.
 */
export function fakeStorage(): FakeStorage {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (key: string): string | null => map.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        map.set(key, value);
      },
      removeItem: (key: string): void => {
        map.delete(key);
      },
    },
  };
}
