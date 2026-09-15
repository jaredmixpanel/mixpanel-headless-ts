/**
 * TS wire-stub client for the D13 wire-path gate vectors (task TS-6).
 *
 * Mirror of the Python `conformance/record/pycompat_ref.py`
 * `WireStubClient`: a deliberately trivial "client" whose methods issue
 * exactly the HTTP traffic their arguments describe against the injected
 * fetch (the R2.4 replay seam). The authored `wirestub.*` vectors replay
 * through it to prove the wire replay pipeline — sequence + keyed
 * unordered serving, `headers_contain` patterns, `params_absent`,
 * `body_stream` chunk reassembly, and transport-error surfacing — before
 * any real module is ported. It is a test double for the pipeline, NOT a
 * port of any real module.
 *
 * Transport failures: native fetch rejects with `TypeError("fetch
 * failed")` carrying a coded `cause` (see `transport-errors.ts`). Like any
 * real fetch adapter under R2.10, the stub classifies that rejection
 * ITSELF, into a {@link WireStubTransportError} named after the httpx
 * class the Python side raised — which is what the vectors'
 * `expect.error.class` records.
 */

import type { JsonValue } from "./json-value.js";
import type { ExpectErrorConvertible } from "./runner.js";

/**
 * Fetch-rejection `cause.code` → httpx transport class name.
 *
 * Inverse of the representative entries in `transport-errors.ts`'s
 * committed table. The inverse is not injective (several httpx timeout
 * classes share `UND_ERR_CONNECT_TIMEOUT`), so each code maps to ONE
 * representative class; the D13 gate vectors only exercise
 * `ConnectError`.
 */
const CAUSE_CODE_TO_HTTPX_CLASS: Readonly<Record<string, string>> = {
  ECONNREFUSED: "ConnectError",
  UND_ERR_CONNECT_TIMEOUT: "ConnectTimeout",
  UND_ERR_HEADERS_TIMEOUT: "ReadTimeout",
  UND_ERR_BODY_TIMEOUT: "WriteTimeout",
  UND_ERR_SOCKET: "ReadError",
  ERR_INVALID_URL_SCHEME: "UnsupportedProtocol",
};

/**
 * A classified transport failure surfaced by the wire stub.
 *
 * Carries the httpx exception class name the equivalent Python failure
 * raises, so the runner can diff it against `expect.error` structurally
 * (R5.2/R5.4 — class name, never message text).
 */
export class WireStubTransportError
  extends Error
  implements ExpectErrorConvertible
{
  /** The httpx transport exception class name (e.g. `ConnectError`). */
  readonly httpxClass: string;

  /**
   * Create a classified transport error.
   *
   * @param httpxClass - The httpx class name from the rejection mapping.
   * @param cause - The original fetch rejection.
   */
  constructor(httpxClass: string, cause: unknown) {
    super(`wire stub transport failure: ${httpxClass}`, { cause });
    this.name = "WireStubTransportError";
    this.httpxClass = httpxClass;
  }

  /**
   * Encode this error as a vector `expect.error` value.
   *
   * @returns `{class: <httpx class name>}` — the shape the Python record
   *   side captured for propagated transport errors.
   */
  toExpectError(): JsonValue {
    return { class: this.httpxClass };
  }
}

/**
 * Classify a fetch rejection the way a real adapter would (R2.10).
 *
 * @param cause - The value the injected fetch rejected with.
 * @returns Never — always throws.
 * @throws WireStubTransportError - When the rejection is a native-style
 *   `TypeError` whose `cause.code` is in the committed mapping.
 * @throws unknown - The original value, unchanged, for everything else
 *   (e.g. a `VectorFetchSequenceError` must reach the runner intact).
 */
function classifyRejection(cause: unknown): never {
  if (cause instanceof TypeError) {
    const inner: unknown = cause.cause;
    if (
      typeof inner === "object" &&
      inner !== null &&
      "code" in inner &&
      typeof inner.code === "string"
    ) {
      const mapped =
        CAUSE_CODE_TO_HTTPX_CLASS[(inner as { code: string }).code];
      if (mapped !== undefined) {
        throw new WireStubTransportError(mapped, cause);
      }
    }
  }
  throw cause;
}

/** One plain request result: status code plus the parsed body. */
export interface WireStubResult {
  /** HTTP status code. */
  readonly status: number;
  /** JSON-parsed body when the response content-type says JSON, else text. */
  readonly body: unknown;
}

/** Keyword options for {@link WireStubClient.request}. */
export interface WireStubRequestOptions {
  /** Query params to send; omit entirely for the `params_absent` case. */
  readonly params?: Readonly<Record<string, string>>;
  /** Extra request headers to set verbatim. */
  readonly headers?: Readonly<Record<string, string>>;
  /** JSON request body, when given. */
  readonly jsonBody?: unknown;
}

/**
 * Mirror wire-stub client for the D13 wire-path gate vectors.
 *
 * Every public method issues the HTTP traffic its arguments describe,
 * verbatim, through the injected fetch.
 *
 * @example
 * ```typescript
 * const client = new WireStubClient({ fetch: harness.fetch });
 * const result = await client.request("GET", "/ping", { params: { q: "1" } });
 * // { status: 200, body: { ok: true } }
 * ```
 */
export class WireStubClient {
  /** The injected fetch implementation (the R2.4 replay seam). */
  private readonly fetchImpl: typeof fetch;

  /** Base URL prepended to request paths. */
  private readonly baseUrl: string;

  /**
   * Bind the stub to an injected fetch.
   *
   * @param options - `fetch` (the replay seam — `VectorFetch` in the
   *   runner) and an optional `baseUrl` (defaults to the recorded
   *   `https://wirestub.invalid`).
   */
  constructor(options: { fetch: typeof fetch; baseUrl?: string }) {
    this.fetchImpl = options.fetch;
    this.baseUrl = options.baseUrl ?? "https://wirestub.invalid";
  }

  /**
   * Issue one request exactly as directed and return a plain result.
   *
   * @param method - HTTP method (`GET`/`POST`/...).
   * @param path - Request path relative to the base URL.
   * @param options - Optional params/headers/JSON body.
   * @returns The status code and parsed body.
   * @throws WireStubTransportError - Classified native fetch rejections
   *   (the D13 `transport_error` gate slice).
   */
  async request(
    method: string,
    path: string,
    options: WireStubRequestOptions = {},
  ): Promise<WireStubResult> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.params ?? {})) {
      url.searchParams.set(key, value);
    }
    const headers = new Headers(options.headers ?? {});
    let body: string | undefined;
    if (options.jsonBody !== undefined) {
      body = JSON.stringify(options.jsonBody);
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url.href, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      });
    } catch (error) {
      classifyRejection(error);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const parsed: unknown = contentType.toLowerCase().includes("json")
      ? await response.json()
      : await response.text();
    return { status: response.status, body: parsed };
  }

  /**
   * Issue several requests in the given order (multi-interaction gate).
   *
   * Within an `unordered_group` vector the issue order may differ from
   * the recorded order — keyed serving (design D2/D7) is exactly what
   * this exercises.
   *
   * @param requests - One {@link request} argument set per call, in issue
   *   order.
   * @returns One {@link request} result per issued request, in issue
   *   order.
   * @throws WireStubTransportError - Propagated from the first failing
   *   request.
   */
  async requestSequence(
    requests: ReadonlyArray<{
      readonly method: string;
      readonly path: string;
      readonly options?: WireStubRequestOptions;
    }>,
  ): Promise<WireStubResult[]> {
    const results: WireStubResult[] = [];
    for (const entry of requests) {
      results.push(await this.request(entry.method, entry.path, entry.options));
    }
    return results;
  }

  /**
   * Stream a response and return its raw chunks (chunk-reassembly gate).
   *
   * Reads the response body chunk-by-chunk so the recorded `body_stream`
   * boundaries reach the caller verbatim (design D2/D12); each chunk is
   * decoded as UTF-8 independently, mirroring the Python stub's
   * per-chunk `bytes.decode("utf-8")`.
   *
   * @param method - HTTP method.
   * @param path - Request path relative to the base URL.
   * @param options - Optional extra request headers.
   * @returns The response's chunks decoded as UTF-8, in arrival order.
   * @throws WireStubTransportError - Classified native fetch rejections.
   * @throws TypeError - When a chunk is not valid standalone UTF-8 (gate
   *   vectors use text bodies only; mirrors Python `UnicodeDecodeError`).
   */
  async streamChunks(
    method: string,
    path: string,
    options: { readonly headers?: Readonly<Record<string, string>> } = {},
  ): Promise<string[]> {
    const url = new URL(this.baseUrl + path);
    let response: Response;
    try {
      response = await this.fetchImpl(url.href, {
        method,
        headers: new Headers(options.headers ?? {}),
      });
    } catch (error) {
      classifyRejection(error);
    }
    if (response.body === null) {
      return [];
    }
    const reader = response.body.getReader();
    const chunks: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(new TextDecoder("utf-8", { fatal: true }).decode(value));
    }
    return chunks;
  }
}
