/**
 * `VectorFetch` — the injected-fetch replay seam (design D12, R2.4).
 *
 * A factory takes a vector's parsed `expect.interactions[]` and returns a
 * fetch implementation that:
 *
 * - captures every outgoing request (method/url/headers/body) for the
 *   runner's request diff;
 * - serves the canned recorded response for the request's slot — ordered
 *   interactions are served POSITIONALLY (field mismatches are the
 *   runner's diff to report, not a serve-time crash), while interactions
 *   inside an `unordered_group` are served BY KEY on the canonical
 *   `(method, path, params)` triple, each consumable once (D2/D7: the
 *   i-th replay request need not be the i-th recorded request under async
 *   scheduling);
 * - rejects `transport_error` slots the way NATIVE fetch rejects — a
 *   `TypeError` with `cause` from the committed table in
 *   `transport-errors.ts`, never a pre-mapped library error (R2.10);
 * - rebuilds `body_stream` chunks into a `ReadableStream` that preserves
 *   the recorded chunk boundaries (D2 — gzip/JSONL chunk reassembly is a
 *   named port target).
 *
 * Sequence violations (a request beyond the recorded count, or no key
 * match inside an unordered group) both THROW a
 * {@link VectorFetchSequenceError} into the library AND record the
 * violation on the harness, so a library that swallows the throw still
 * fails the vector with `FAIL_REQUEST`.
 */

import { canonicalize } from "./canonical.js";
import type { GivenResponse, ParsedInteraction } from "./interactions.js";
import { JsonNumber, type JsonValue } from "./json-value.js";
import { createTransportRejection } from "./transport-errors.js";

/** Raised into the library when replay traffic diverges from the record. */
export class VectorFetchSequenceError extends Error {
  /**
   * Create a sequence error.
   *
   * @param message - Description of the divergence.
   */
  constructor(message: string) {
    super(message);
    this.name = "VectorFetchSequenceError";
  }
}

/** One captured outgoing request. */
export interface CapturedRequest {
  /** HTTP method, uppercase. */
  readonly method: string;
  /** Origin, e.g. `https://mixpanel.com`. */
  readonly schemeHost: string;
  /** URL path. */
  readonly path: string;
  /** Decoded query params: single values as strings, repeats as arrays. */
  readonly params: Readonly<Record<string, string | string[]>>;
  /** Request headers, lowercase keys. */
  readonly headers: Readonly<Record<string, string>>;
  /** Raw request body bytes (empty array for no body). */
  readonly bodyBytes: Uint8Array;
  /** Index of the interaction slot that served it (null on overflow). */
  readonly slotIndex: number | null;
}

/** The replay harness returned by {@link createVectorFetch}. */
export interface VectorFetchHarness {
  /** The injectable fetch implementation (R2.4 seam). */
  readonly fetch: typeof fetch;
  /** Captured requests, in arrival order. */
  readonly captures: readonly CapturedRequest[];
  /** Sequence violations recorded during replay. */
  readonly violations: readonly string[];
  /**
   * Indices of interactions never served (missing requests).
   *
   * @returns Slot indices still unconsumed after the measured call.
   */
  unservedSlots: () => number[];
}

/** HTTP statuses whose `Response` must carry a null body. */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

/**
 * Convert captured query params to a `JsonValue` for canonical keying.
 *
 * @param params - The captured params map.
 * @returns The map as a JSON object, or `null` when empty (matching an
 *   omitted `request.params` in the recorded interaction).
 */
export function paramsToJson(
  params: Readonly<Record<string, string | string[]>>,
): JsonValue {
  const entries = Object.entries(params);
  if (entries.length === 0) {
    return null;
  }
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of entries) {
    out[key] = typeof value === "string" ? value : [...value];
  }
  return out;
}

/**
 * Compute the canonical `(method, path, params)` serving key (D2/D7).
 *
 * @param method - HTTP method.
 * @param path - URL path.
 * @param params - Params value (`null` for none) — recorded or captured.
 * @returns The canonical JSON key string.
 */
function servingKey(method: string, path: string, params: JsonValue): string {
  return canonicalize([method, path, params]);
}

/**
 * Decode one recorded stream chunk to bytes.
 *
 * @param encoding - `utf8` or `base64`.
 * @param data - The chunk payload in that encoding.
 * @returns The chunk bytes, boundaries preserved.
 */
function chunkBytes(encoding: "utf8" | "base64", data: string): Uint8Array {
  if (encoding === "utf8") {
    return new TextEncoder().encode(data);
  }
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Build the canned `Response` for one recorded `givenResponse`.
 *
 * Body precedence follows the schema's mutually exclusive fields: `body`
 * (compact JSON text in STORED key order — see {@link storedJsonText}),
 * `body_text`, `body_base64`, or `body_stream`
 * (a `ReadableStream` enqueuing each recorded chunk as its own
 * `Uint8Array`, preserving boundaries per D2). When a JSON `body` is
 * present and the recorded headers carry no `content-type`,
 * `application/json` is defaulted (httpx MockTransport's `json=` behavior
 * at record time).
 *
 * @param given - The parsed recorded response.
 * @returns A fresh `Response`.
 */
/**
 * Serialize a recorded JSON `body` EXACTLY as the Python replay
 * transport does (`conformance/runner/transport.py:188-190` —
 * `json.dumps(body, separators=(",", ":"), ensure_ascii=False)`):
 * compact separators, stored KEY ORDER preserved (never canonicalized —
 * key order is observable to order-sensitive consumers like
 * `get_event_properties`'s `list(response.keys())`, found by the first
 * B4-C2 replay), lossless number tokens verbatim.
 *
 * @param value - The loaded body value.
 * @returns The serialized text.
 */
function storedJsonText(value: JsonValue): string {
  if (value === null) {
    return "null";
  }
  if (value === true) {
    return "true";
  }
  if (value === false) {
    return "false";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof JsonNumber) {
    return value.raw;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => storedJsonText(item)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .map(([key, member]) => `${JSON.stringify(key)}:${storedJsonText(member)}`)
    .join(",")}}`;
}

export function buildResponse(given: GivenResponse): Response {
  const headers = new Headers(given.headers);
  let body: BodyInit | null = null;
  if (given.hasBody) {
    body = storedJsonText(given.body ?? null);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  } else if (given.bodyText !== undefined) {
    body = given.bodyText;
  } else if (given.bodyBase64 !== undefined) {
    body = chunkBytes("base64", given.bodyBase64) as unknown as BodyInit;
  } else if (given.bodyStream !== undefined) {
    const chunks = given.bodyStream.map((chunk) =>
      chunkBytes(chunk.encoding, chunk.data),
    );
    body = new ReadableStream<Uint8Array>({
      start(controller): void {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
  }
  if (NULL_BODY_STATUSES.has(given.status)) {
    body = null;
  }
  return new Response(body, { status: given.status, headers });
}

/**
 * Capture one outgoing request's observable fields.
 *
 * @param request - The materialized `Request`.
 * @param slotIndex - The serving slot (null on overflow).
 * @returns The captured view (body fully read).
 */
async function captureRequest(
  request: Request,
  slotIndex: number | null,
): Promise<CapturedRequest> {
  const url = new URL(request.url);
  const params: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    params[key] = all.length === 1 ? (all[0] as string) : all;
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    headers[key.toLowerCase()] = value;
  }
  const bodyBytes = new Uint8Array(await request.arrayBuffer());
  return {
    method: request.method.toUpperCase(),
    schemeHost: url.origin,
    path: url.pathname,
    params,
    headers,
    bodyBytes,
    slotIndex,
  };
}

/**
 * Create the injected-fetch replay harness for one wire/parse vector
 * (design D12).
 *
 * @param interactions - The vector's parsed `expect.interactions[]`.
 * @returns The {@link VectorFetchHarness}: an injectable `fetch`, the
 *   capture log, and the violation log the runner turns into
 *   `FAIL_REQUEST`.
 * @example
 * ```typescript
 * const harness = createVectorFetch(parseInteractions(raw, id));
 * const client = makeClient({ fetch: harness.fetch });
 * await client.doThing();
 * // harness.captures[0].path === "/api/query/segmentation"
 * ```
 */
export function createVectorFetch(
  interactions: readonly ParsedInteraction[],
): VectorFetchHarness {
  const consumed: boolean[] = interactions.map(() => false);
  const captures: CapturedRequest[] = [];
  const violations: string[] = [];

  /**
   * Pick the serving slot for an incoming request.
   *
   * @param captured - The captured incoming request.
   * @returns The slot index, or null when the sequence is violated.
   */
  const pickSlot = (captured: CapturedRequest): number | null => {
    const nextIndex = consumed.findIndex((used) => !used);
    if (nextIndex === -1) {
      violations.push(
        `request ${String(captures.length + 1)} (${captured.method} ${captured.path}) ` +
          `arrived after all ${String(interactions.length)} recorded interactions were served`,
      );
      return null;
    }
    const nextSlot = interactions[nextIndex] as ParsedInteraction;
    if (nextSlot.unorderedGroup === undefined) {
      return nextIndex;
    }
    // Keyed serving within the unordered group (D2/D7): match by the
    // canonical (method, path, params) triple, each slot consumable once.
    const group = nextSlot.unorderedGroup;
    const incomingKey = servingKey(
      captured.method,
      captured.path,
      paramsToJson(captured.params),
    );
    for (const [index, interaction] of interactions.entries()) {
      const slot = interaction as ParsedInteraction;
      if (consumed[index] === true || slot.unorderedGroup !== group) {
        continue;
      }
      const recordedParams =
        slot.request.params !== undefined &&
        Object.keys(slot.request.params).length > 0
          ? (slot.request.params as JsonValue)
          : null;
      const slotKey = servingKey(
        slot.request.method,
        slot.request.path,
        recordedParams,
      );
      if (slotKey === incomingKey) {
        return index;
      }
    }
    violations.push(
      `no unconsumed interaction in unordered_group ${String(group)} matches ` +
        `${captured.method} ${captured.path} (keyed (method, path, params) serving, D2)`,
    );
    return null;
  };

  const vectorFetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const preliminary = await captureRequest(request, null);
    const slotIndex = pickSlot(preliminary);
    const captured: CapturedRequest = { ...preliminary, slotIndex };
    captures.push(captured);
    if (slotIndex === null) {
      throw new VectorFetchSequenceError(violations.at(-1) as string);
    }
    consumed[slotIndex] = true;
    const slot = interactions[slotIndex] as ParsedInteraction;
    if (slot.response.type === "transport_error") {
      throw createTransportRejection(
        slot.response.httpxClass,
        slot.response.message,
      );
    }
    return buildResponse(slot.response);
  }) as typeof fetch;

  return {
    fetch: vectorFetch,
    captures,
    violations,
    unservedSlots(): number[] {
      const unserved: number[] = [];
      consumed.forEach((used, index) => {
        if (!used) {
          unserved.push(index);
        }
      });
      return unserved;
    },
  };
}
