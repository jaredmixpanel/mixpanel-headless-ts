/**
 * The fetch transport adapter — the B4-C1 implementation of the B0
 * {@link RequestExecutor} seam (`internals.ts`), replacing httpx's wire
 * layer.
 *
 * Contract (R2.10/R2.11/R2.12/R6.7):
 * - every transport-level failure (fetch `TypeError`, non-abort
 *   `DOMException`, undici `UND_ERR_*`) normalizes to
 *   {@link MixpanelHttpError} — never a bare catch;
 * - cancellations pass through as `DOMException` name `AbortError`
 *   (R6.7 "normalized on exit" — they must NOT read as HTTP errors);
 * - `redirect: 'manual'` on every request — httpx raises on 3xx where
 *   fetch would silently follow;
 * - the executor takes Python-named `timeoutSeconds` and owns nothing
 *   time-based itself (retry sleeps live in the B0 loops, R2.12).
 *
 * Serialization twins (vector-locked byte shapes):
 * - query params via httpx's `urlencode(..., doseq=True)` semantics —
 *   {@link quotePlus} percent-encoding with `+` for spaces, repeated
 *   keys for list values, httpx primitive rendering (`True → "true"`,
 *   `None → ""`);
 * - form bodies via the same `quotePlus` grammar (the recorded
 *   `body_text` fields are exact-byte comparisons);
 * - JSON bodies via `JSON.stringify` (request-side diffs compare
 *   canonically after lossless parsing, so whitespace is free), with a
 *   `bigint` member emitted as its exact digit run — the carrier for
 *   int64 ids beyond 2^53 ({@link stringifyJsonBody}).
 */

import { pythonFloatStr, pythonStrOf } from "../compat/index.js";
import {
  MixpanelHttpError,
  type RequestExecutor,
  type TransportRequestOptions,
  type WireResponse,
} from "./internals.js";

/** Characters urllib's `quote_plus` never escapes (ALWAYS_SAFE set). */
const QUOTE_PLUS_SAFE = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~",
);

/**
 * Percent-encode text exactly like `urllib.parse.quote_plus` with the
 * default safe set: ALPHA / DIGIT / `_.-~` pass through, space becomes
 * `+`, everything else is `%XX` uppercase-hex over the UTF-8 bytes.
 *
 * `encodeURIComponent` is NOT equivalent (it passes `!'()*`, which
 * Python escapes) — the recorded form `body_text` fields are byte-exact
 * comparisons, so the grammar must match urllib char-for-char.
 *
 * @param text - The text to encode.
 * @returns The encoded text.
 */
export function quotePlus(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (const byte of bytes) {
    const char = String.fromCharCode(byte);
    if (QUOTE_PLUS_SAFE.has(char)) {
      out += char;
    } else if (char === " ") {
      out += "+";
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

/**
 * Render one primitive query/form value the way httpx's
 * `primitive_value_to_str` does: `True → "true"`, `False → "false"`,
 * `None → ""`, everything else `str(value)`.
 *
 * Number rendering note: integers render as decimal digits; non-integral
 * numbers use the CPython float repr ({@link pythonFloatStr}) so a
 * fractional param spells exactly what Python sent. An INTEGRAL Python
 * float param (`10.0` → `"10.0"`) is not representable from a plain JS
 * number — no C1 surface passes float params; C2 threads float-ness via
 * its own call shapes where a vector requires it.
 *
 * @param value - The primitive value.
 * @returns The wire string.
 */
export function primitiveParamValue(value: unknown): string {
  if (value === true) {
    return "true";
  }
  if (value === false) {
    return "false";
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : pythonFloatStr(value);
  }
  // `urlencode` → `str(value)` for everything else (typed callers never
  // pass containers; a stray one renders as Python would, not as
  // `[object Object]`).
  return pythonStrOf(value);
}

/**
 * Serialize a params/form mapping with urlencode `doseq=True` semantics:
 * array values repeat the key once per element, in order.
 *
 * @param data - The mapping to serialize.
 * @returns The `k=v&k2=v2` text (empty string for an empty mapping).
 */
export function urlEncodePairs(
  data: Readonly<Record<string, unknown>>,
): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const values = Array.isArray(value) ? value : [value];
    for (const member of values) {
      pairs.push(`${quotePlus(key)}=${quotePlus(primitiveParamValue(member))}`);
    }
  }
  return pairs.join("&");
}

/**
 * Append serialized query params to a URL (httpx merges `params=` into
 * the request URL's query string).
 *
 * @param url - The base URL (may already carry a query string).
 * @param params - The query params (empty mapping appends nothing).
 * @returns The final URL.
 */
export function appendQueryParams(
  url: string,
  params: Readonly<Record<string, unknown>>,
): string {
  const query = urlEncodePairs(params);
  if (query === "") {
    return url;
  }
  return url.includes("?") ? `${url}&${query}` : `${url}?${query}`;
}

/**
 * Whether a merged header set already names `Content-Type`
 * (case-insensitive, like httpx's header merge — an explicit caller
 * header wins over the body-derived default).
 *
 * @param headers - The merged headers.
 * @returns `true` when any spelling of content-type is present.
 */
function hasContentType(headers: Readonly<Record<string, string>>): boolean {
  return Object.keys(headers).some(
    (name) => name.toLowerCase() === "content-type",
  );
}

/**
 * Normalize the abort reason to the R6.7 contract: every cancellation
 * path throws `DOMException(..., 'AbortError')` — a plain `Error` from
 * a signal reason would evade name-based checks.
 *
 * @param reason - The signal's abort reason (may be anything).
 * @returns The `AbortError` DOMException to throw.
 */
export function normalizedAbortError(reason: unknown): DOMException {
  if (reason instanceof DOMException && reason.name === "AbortError") {
    return reason;
  }
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * Whether a fetch rejection is a cancellation (passes through under
 * R6.7 rather than normalizing to {@link MixpanelHttpError}).
 *
 * @param cause - The rejection value.
 * @returns `true` for `AbortError` DOMExceptions.
 */
function isAbortRejection(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

/**
 * Everything the raw fetch step produces (C2's streaming path consumes
 * the `Response`; the {@link RequestExecutor} view reads the text).
 */
export interface RawFetchResult {
  /** The platform `Response` (body unread). */
  readonly response: Response;
  /**
   * Stop the request-timeout clock (idempotent). Streaming callers
   * invoke this once headers arrive: body reads are NOT clock-bounded
   * (deviation D-B4ARB-1 — httpx read-timeouts are per-read, so a
   * healthy long-running export stream must not be killed by a total
   * wall clock). Caller-signal abort forwarding stays live.
   */
  readonly stopTimeout: () => void;
  /**
   * {@link stopTimeout} plus detach caller-signal forwarding — call
   * once the body is fully consumed (or on error). Idempotent.
   */
  readonly release: () => void;
}

/**
 * Issue one request through the injected fetch with the full adapter
 * contract applied (URL/query/body serialization, `redirect: 'manual'`,
 * R2.10 normalization, R6.7 abort passthrough) and hand back the RAW
 * `Response` — the seam C2's streaming exports consume (they must not
 * buffer the body).
 *
 * Timeout enforcement (B4-ARB W-F2 — Python `timeout=... or
 * self._timeout` on every httpx call): `options.timeoutSeconds` arms a
 * clock that aborts the request when it fires. httpx timeouts are
 * per-operation (connect/read/write each get the budget); fetch has no
 * per-read primitive, so the TS clock covers the headers phase here and
 * — for buffered callers — the body read, via the returned handles
 * (deviation D-B4ARB-1, sanctioned in b4-review-resolution.md). A fired
 * clock rejects like httpx.TimeoutException ⊂ httpx.HTTPError: it
 * normalizes to {@link MixpanelHttpError} and is therefore retried and
 * then wrapped as `HTTP_ERROR` by the B0 loops.
 *
 * @param fetchImpl - The injected fetch.
 * @param options - The outbound request.
 * @param signal - Optional per-call cancellation signal (R6.7 point 2:
 *   "into the request").
 * @returns The raw response wrapper (plus the timeout/release handles).
 * @throws MixpanelHttpError - Any transport-level failure,
 *   including a fired request-timeout clock.
 * @throws DOMException - Name `AbortError` on cancellation —
 *   EVERY caller-initiated abort exits this way, custom reasons
 *   included (B4-ARB W-F3).
 */
export async function rawFetch(
  fetchImpl: typeof fetch,
  options: TransportRequestOptions,
  signal?: AbortSignal,
): Promise<RawFetchResult> {
  const url = appendQueryParams(options.url, options.params);
  const headers: Record<string, string> = { ...options.headers };
  let body: string | null = null;
  if (options.formBody !== null) {
    body = urlEncodePairs(options.formBody);
    if (!hasContentType(headers)) {
      // httpx: `data=` implies x-www-form-urlencoded (no charset suffix;
      // the recorded `content-type` header asserts the exact spelling).
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
  } else if (options.jsonBody !== null) {
    body = stringifyJsonBody(options.jsonBody);
    if (!hasContentType(headers)) {
      headers["Content-Type"] = "application/json";
    }
  }
  // One controller merges the caller signal and the timeout clock; the
  // caller signal's reason is forwarded verbatim so a caller abort is
  // distinguishable (checked FIRST in the catch below).
  const controller = new AbortController();
  const forwardAbort = (): void => {
    controller.abort(signal?.reason);
  };
  if (signal !== undefined) {
    if (signal.aborted) {
      forwardAbort();
    } else {
      signal.addEventListener("abort", forwardAbort, { once: true });
    }
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutMs = options.timeoutSeconds * 1000;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort(
        new DOMException(
          `Request timed out after ${options.timeoutSeconds} seconds`,
          "TimeoutError",
        ),
      );
    }, timeoutMs);
    // Node-only: an un-released clock must not hold the process open
    // (browsers return a number — no unref, harmless).
    (timer as unknown as { unref?: () => void }).unref?.();
  }
  const stopTimeout = (): void => {
    if (timer === null) {
      return;
    }

    clearTimeout(timer);
    timer = null;
  };
  const release = (): void => {
    stopTimeout();
    signal?.removeEventListener("abort", forwardAbort);
  };
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: options.method,
      headers,
      ...(body === null ? {} : { body }),
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    release();
    if (signal?.aborted === true) {
      // R6.7 / W-F3: caller cancellation wins and ALWAYS exits as a
      // DOMException named AbortError, whatever the abort reason was.
      throw normalizedAbortError(signal.reason);
    }
    if (error instanceof TypeError || error instanceof DOMException) {
      // R2.10: the adapter owns the fetch TypeError / DOMException /
      // UND_ERR_* mapping — the B0 retry loops catch MixpanelHttpError
      // (the `httpx.HTTPError` analog) and wrap it as HTTP_ERROR.
      // A non-caller AbortError/TimeoutError lands here too: with the
      // caller signal quiet, the only abort source is the timeout clock
      // (the httpx.TimeoutException analog — an HTTPError in Python).
      // Message derivation mirrors httpx's `str(e)` (which flows into
      // the HTTP_ERROR `details.error` bag): fetch's own "fetch failed"
      // wrapper text is useless, so the underlying cause's message wins
      // when present — that is where undici (and the conformance
      // harness) carry the real failure description.
      const inner: unknown = (error as { cause?: unknown }).cause;
      const description =
        inner instanceof Error && inner.message !== ""
          ? inner.message
          : error.message;
      throw new MixpanelHttpError(description, { cause: error });
    }
    throw error;
  }
  return { response, stopTimeout, release };
}

/**
 * Build the B0 {@link RequestExecutor} over an injected fetch — the
 * text-buffering view of {@link rawFetch} that `executeWithRetry` /
 * `appRequest` / `handleResponse` consume.
 *
 * @param fetchImpl - The injected fetch.
 * @param signal - Optional per-call cancellation signal, curried in at
 *   client assembly (R6.7 without touching B0 signatures — the
 *   B0-ARB carried item 6a mechanism).
 * @returns The executor.
 */
export function createRequestExecutor(
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): RequestExecutor {
  return async (options: TransportRequestOptions): Promise<WireResponse> => {
    // Buffered view: the timeout clock keeps running across the body
    // read (httpx read-timeouts also bound `response.read()`), released
    // once the text is in hand.
    const { response, release } = await rawFetch(fetchImpl, options, signal);
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (signal?.aborted === true) {
        // R6.7 / W-F3: caller cancellation always exits as AbortError.
        throw normalizedAbortError(signal.reason);
      }
      if (isAbortRejection(error)) {
        // Not caller-initiated: the request-timeout clock fired during
        // the body read (httpx.ReadTimeout analog).
        throw new MixpanelHttpError(
          `Request timed out after ${options.timeoutSeconds} seconds`,
          { cause: error },
        );
      }
      // Body-read failures are transport errors in httpx too
      // (`httpx.ReadError` while consuming the stream).
      throw new MixpanelHttpError(
        `transport body read failure: ${String(error)}`,
        {
          cause: error,
        },
      );
    } finally {
      release();
    }
    return {
      status: response.status,
      text,
      header: (name: string): string | null => response.headers.get(name),
    };
  };
}

/** The ES2024 `JSON.rawJSON` hook (typed locally — not in every lib). */
interface RawJsonCapableJson {
  readonly rawJSON?: ((text: string) => unknown) | undefined;
}

/**
 * `JSON.stringify` for a request body whose members may be `bigint`s —
 * the carrier for int64 ids beyond 2^53 (lookup-table `data-group-id`s
 * such as `-8644926364725811123`, which `update_lookup_table` and
 * `delete_lookup_tables` send in the JSON body).
 *
 * A `bigint` member is emitted as its exact digit run via
 * `JSON.rawJSON` (ES2024; Node ≥ 21 and evergreen browsers), where
 * Python writes the same bare integer token. Bodies without a `bigint`
 * serialize byte-identically to plain `JSON.stringify` (the replacer
 * returns every other member unchanged).
 *
 * @param value - The JSON body.
 * @returns The serialized body text.
 * @throws TypeError - A `bigint` member on an engine without
 *   `JSON.rawJSON` (plain `JSON.stringify` would throw for it too).
 */
export function stringifyJsonBody(value: unknown): string {
  const rawJSON = (JSON as RawJsonCapableJson).rawJSON;
  return JSON.stringify(value, (_key, member: unknown) => {
    if (typeof member !== "bigint") {
      return member;
    }
    if (rawJSON === undefined) {
      throw new TypeError(
        "A bigint JSON body member needs JSON.rawJSON (ES2024), which this " +
          "engine lacks; pass a safe-integer number instead",
      );
    }
    return rawJSON.call(JSON, member.toString(10));
  });
}
