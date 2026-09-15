// Body-capturing canned transport for the redirect-flow and DCR suites:
// unlike core's `fakeTransport` it records request bodies (the byte-compare
// locks read the form/JSON body) and lets the handler return any `Response`
// or throw.

/** The captured view of one request, body included. */
export interface FlowCapture {
  /** HTTP method, uppercase. */
  readonly method: string;
  /** Full request URL. */
  readonly url: string;
  /** Request headers, lowercase keys. */
  readonly headers: Readonly<Record<string, string>>;
  /** The raw request body text (empty string when absent). */
  readonly body: string;
}

/** A canned transport that records bodies. */
export interface BodyCapturingTransport {
  /** The injectable fetch double. */
  readonly fetch: typeof fetch;
  /** Requests that reached the double, in order. */
  readonly captures: readonly FlowCapture[];
}

/**
 * Build a body-capturing canned transport over the R2.4 fetch seam.
 *
 * @param handler - Receives each captured request; returns (or throws)
 *   the canned outcome.
 * @returns The transport with its capture log.
 */
export function bodyCapturingTransport(
  handler: (request: FlowCapture) => Response | Promise<Response>,
): BodyCapturingTransport {
  const captures: FlowCapture[] = [];
  const fakeFetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const headers: Record<string, string> = {};
    for (const [key, value] of request.headers.entries()) {
      headers[key.toLowerCase()] = value;
    }
    const captured: FlowCapture = {
      method: request.method.toUpperCase(),
      url: request.url,
      headers,
      body: await request.clone().text(),
    };
    captures.push(captured);
    return handler(captured);
  }) as typeof fetch;
  return { fetch: fakeFetch, captures };
}

/**
 * JSON `Response` shorthand for canned IdP bodies.
 *
 * @param status - HTTP status code.
 * @param body - The JSON payload.
 * @returns The canned response.
 */
export function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A well-formed token-endpoint 200 payload (the `_make_token_response`
 * twin, `test_auth_flow.py` fixture shape).
 *
 * @returns The token response payload.
 */
export function makeTokenResponse(): Record<string, unknown> {
  return {
    access_token: "new-access-token",
    refresh_token: "new-refresh-token",
    expires_in: 3600,
    token_type: "Bearer",
    scope: "openid",
  };
}
