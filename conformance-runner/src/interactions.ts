/**
 * Typed parsing of `expect.interactions[]` (vector.schema.json
 * `$defs.interaction` / `expectedRequest` / `givenResponse` /
 * `transportError`).
 *
 * The loader keeps `expect` raw (`JsonValue` trees with lossless
 * {@link JsonNumber} leaves); this module lifts the wire-replay fields into
 * typed structures for `VectorFetch` (serving) and the runner (request
 * diffing). Values that participate in canonical comparison (`params`,
 * `json_body`, `headers_contain`) stay `JsonValue` so the D6 raw-token
 * rules apply unchanged.
 */

import { boundJsonReaders } from "./internal/guards.js";
import { JsonNumber, type JsonValue } from "./json-value.js";

/** Raised when a vector's `expect.interactions` violates the schema. */
export class MalformedInteractionError extends Error {
  /**
   * Create a malformed-interaction error.
   *
   * @param message - Description of the schema violation.
   */
  constructor(message: string) {
    super(message);
    this.name = "MalformedInteractionError";
  }
}

/** The object/string readers, raising {@link MalformedInteractionError}. */
const { asObject, optionalString } = boundJsonReaders(
  (message) => new MalformedInteractionError(message),
);

/** One `body_stream` chunk (chunk boundaries are contract, design D2). */
export interface StreamChunk {
  /** Chunk text encoding (`utf8` or `base64`). */
  readonly encoding: "utf8" | "base64";
  /** The chunk payload in that encoding. */
  readonly data: string;
}

/** The expected-request half of one interaction (schema `expectedRequest`). */
export interface ExpectedRequest {
  /** HTTP method (uppercase). */
  readonly method: string;
  /** Origin, e.g. `https://mixpanel.com` — asserted only when present. */
  readonly schemeHost?: string;
  /** URL path. */
  readonly path: string;
  /** Decoded query params (string or string[] values), when recorded. */
  readonly params?: Readonly<Record<string, JsonValue>>;
  /** Expected JSON body (raw tree; lossless numbers), when recorded. */
  readonly jsonBody?: JsonValue;
  /** Whether `json_body` was present (a recorded `null` body is distinct). */
  readonly hasJsonBody: boolean;
  /** Expected textual body, when recorded. */
  readonly bodyText?: string;
  /** Expected binary body, base64, when recorded. */
  readonly bodyBase64?: string;
  /** Subset-matched headers (values: string or `{pattern}`), when recorded. */
  readonly headersContain?: Readonly<Record<string, JsonValue>>;
  /** Header names only a Node runner can assert (D5.6). */
  readonly headersNodeOnly: readonly string[];
  /** Header names asserted absent. */
  readonly headersAbsent: readonly string[];
  /** Query-param keys asserted absent. */
  readonly paramsAbsent: readonly string[];
}

/** A served mock response (schema `givenResponse`). */
export interface GivenResponse {
  /** Discriminant. */
  readonly type: "response";
  /** HTTP status code. */
  readonly status: number;
  /** Response headers the mock handler set (lowercase keys). */
  readonly headers: Readonly<Record<string, string>>;
  /** JSON body (raw tree), when recorded. */
  readonly body?: JsonValue;
  /** Whether `body` was present (a recorded JSON `null` body is distinct). */
  readonly hasBody: boolean;
  /** Textual body, when recorded. */
  readonly bodyText?: string;
  /** Binary body, base64, when recorded. */
  readonly bodyBase64?: string;
  /** Chunk-boundary-preserving stream body, when recorded (D2). */
  readonly bodyStream?: readonly StreamChunk[];
}

/** A recorded transport failure (schema `transportError`). */
export interface TransportErrorResponse {
  /** Discriminant. */
  readonly type: "transport_error";
  /** The httpx exception class name the mock handler raised. */
  readonly httpxClass: string;
  /**
   * The recorded exception message, when captured. The Python replay
   * transport re-raises `cls(message)` (`transport.py:144-162`), and
   * `str(e)` flows into wire `details_contain.error` bags — so the TS
   * rejection must carry it too (threaded into the fetch rejection's
   * `cause.message` by `vector-fetch.ts`).
   */
  readonly message?: string;
}

/** One parsed interaction: expected request + canned response. */
export interface ParsedInteraction {
  /** Zero-based position in `expect.interactions[]`. */
  readonly index: number;
  /** Multiset group id (D2), when the interaction is unordered. */
  readonly unorderedGroup?: number;
  /** The expected request. */
  readonly request: ExpectedRequest;
  /** The canned response or transport failure to serve. */
  readonly response: GivenResponse | TransportErrorResponse;
  /** The raw interaction object (for diff rendering). */
  readonly raw: Readonly<Record<string, JsonValue>>;
}

/**
 * Read an optional array-of-strings field.
 *
 * @param record - The containing object.
 * @param key - Field name.
 * @param context - Location for the error message.
 * @returns The string array (empty when absent).
 * @throws MalformedInteractionError - When present but malformed.
 */
function stringArray(
  record: Record<string, JsonValue>,
  key: string,
  context: string,
): readonly string[] {
  const value = record[key];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new MalformedInteractionError(
      `${context}: field ${JSON.stringify(key)} must be an array of strings`,
    );
  }
  return value as string[];
}

/**
 * Parse the `request` member of one interaction.
 *
 * @param value - The raw request object.
 * @param context - Location for error messages.
 * @returns The typed expected request.
 * @throws MalformedInteractionError - On schema violations.
 */
function parseRequest(value: JsonValue, context: string): ExpectedRequest {
  const record = asObject(value, `${context}.request`);
  const method = optionalString(record, "method", `${context}.request`);
  const path = optionalString(record, "path", `${context}.request`);
  if (method === undefined || path === undefined) {
    throw new MalformedInteractionError(
      `${context}.request: method and path are required`,
    );
  }
  const params = record["params"];
  const headersContain = record["headers_contain"];
  const schemeHost = optionalString(
    record,
    "scheme_host",
    `${context}.request`,
  );
  const bodyText = optionalString(record, "body_text", `${context}.request`);
  const bodyBase64 = optionalString(
    record,
    "body_base64",
    `${context}.request`,
  );
  return {
    method,
    ...(schemeHost === undefined ? {} : { schemeHost }),
    path,
    ...(params === undefined
      ? {}
      : { params: asObject(params, `${context}.request.params`) }),
    ...(Object.hasOwn(record, "json_body")
      ? { jsonBody: record["json_body"] as JsonValue }
      : {}),
    hasJsonBody: Object.hasOwn(record, "json_body"),
    ...(bodyText === undefined ? {} : { bodyText }),
    ...(bodyBase64 === undefined ? {} : { bodyBase64 }),
    ...(headersContain === undefined
      ? {}
      : {
          headersContain: asObject(
            headersContain,
            `${context}.request.headers_contain`,
          ),
        }),
    headersNodeOnly: stringArray(record, "headers_node_only", context),
    headersAbsent: stringArray(record, "headers_absent", context),
    paramsAbsent: stringArray(record, "params_absent", context),
  };
}

/**
 * Parse the `response` member of one interaction.
 *
 * @param value - The raw response object (givenResponse or transportError).
 * @param context - Location for error messages.
 * @returns The typed response.
 * @throws MalformedInteractionError - On schema violations.
 */
function parseResponse(
  value: JsonValue,
  context: string,
): GivenResponse | TransportErrorResponse {
  const record = asObject(value, `${context}.response`);
  const transportError = optionalString(
    record,
    "transport_error",
    `${context}.response`,
  );
  if (transportError !== undefined) {
    const message = optionalString(record, "message", `${context}.response`);
    return {
      type: "transport_error",
      httpxClass: transportError,
      ...(message === undefined ? {} : { message }),
    };
  }
  const status = record["status"];
  if (!(status instanceof JsonNumber) || !status.isIntegerToken()) {
    throw new MalformedInteractionError(
      `${context}.response: status must be an integer`,
    );
  }
  const headers: Record<string, string> = {};
  const rawHeaders = record["headers"];
  if (rawHeaders !== undefined) {
    for (const [key, item] of Object.entries(
      asObject(rawHeaders, `${context}.response.headers`),
    )) {
      if (typeof item !== "string") {
        throw new MalformedInteractionError(
          `${context}.response.headers: values must be strings`,
        );
      }
      headers[key.toLowerCase()] = item;
    }
  }
  const bodyText = optionalString(record, "body_text", `${context}.response`);
  const bodyBase64 = optionalString(
    record,
    "body_base64",
    `${context}.response`,
  );
  let bodyStream: StreamChunk[] | undefined;
  const rawStream = record["body_stream"];
  if (rawStream !== undefined) {
    if (!Array.isArray(rawStream)) {
      throw new MalformedInteractionError(
        `${context}.response.body_stream: must be an array`,
      );
    }
    bodyStream = rawStream.map((chunk, chunkIndex) => {
      const chunkRecord = asObject(
        chunk,
        `${context}.response.body_stream[${String(chunkIndex)}]`,
      );
      const encoding = chunkRecord["encoding"];
      const data = chunkRecord["data"];
      if (
        (encoding !== "utf8" && encoding !== "base64") ||
        typeof data !== "string"
      ) {
        throw new MalformedInteractionError(
          `${context}.response.body_stream[${String(chunkIndex)}]: malformed chunk`,
        );
      }
      return { encoding, data };
    });
  }
  return {
    type: "response",
    status: status.toNumber(),
    headers,
    ...(Object.hasOwn(record, "body")
      ? { body: record["body"] as JsonValue }
      : {}),
    hasBody: Object.hasOwn(record, "body"),
    ...(bodyText === undefined ? {} : { bodyText }),
    ...(bodyBase64 === undefined ? {} : { bodyBase64 }),
    ...(bodyStream === undefined ? {} : { bodyStream }),
  };
}

/**
 * Parse a vector's raw `expect.interactions` value into typed interactions.
 *
 * @param interactions - The raw `expect.interactions` member (may be
 *   `undefined` for wire vectors that fired no transport traffic).
 * @param vectorId - The vector id, for error messages.
 * @returns The parsed interactions in recorded order (empty when absent).
 * @throws MalformedInteractionError - On any schema-shape violation.
 * @example
 * ```typescript
 * const parsed = parseInteractions(vector.expect["interactions"], vector.id);
 * // parsed[0].request.method === "GET"
 * ```
 */
export function parseInteractions(
  interactions: JsonValue | undefined,
  vectorId: string,
): ParsedInteraction[] {
  if (interactions === undefined) {
    return [];
  }
  if (!Array.isArray(interactions)) {
    throw new MalformedInteractionError(
      `${vectorId}: expect.interactions must be an array`,
    );
  }
  return interactions.map((raw, index) => {
    const context = `${vectorId} interactions[${String(index)}]`;
    const record = asObject(raw, context);
    const group = record["unordered_group"];
    let unorderedGroup: number | undefined;
    if (group !== undefined) {
      if (!(group instanceof JsonNumber) || !group.isIntegerToken()) {
        throw new MalformedInteractionError(
          `${context}: unordered_group must be an integer`,
        );
      }
      unorderedGroup = group.toNumber();
    }
    return {
      index,
      ...(unorderedGroup === undefined ? {} : { unorderedGroup }),
      request: parseRequest(record["request"] as JsonValue, context),
      response: parseResponse(record["response"] as JsonValue, context),
      raw: record,
    };
  });
}
