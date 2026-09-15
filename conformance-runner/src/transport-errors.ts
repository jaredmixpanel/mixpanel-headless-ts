/**
 * httpx-class → native-fetch-rejection table (design D12).
 *
 * Vectors record transport failures as the httpx exception CLASS NAME the
 * mock handler raised (`interaction.response.transport_error`, schema
 * `$defs.transportError`). At replay, `VectorFetch` must reject the way
 * NATIVE fetch rejects — a `TypeError` whose `cause` carries the underlying
 * network error, exactly as undici/browser fetch produce — and NEVER a
 * pre-mapped library error: R2.10 puts the adapter's fetch-rejection →
 * error-taxonomy mapping UNDER TEST (e.g. the `upload_to_signed_url` port
 * must itself wrap transport failures into `UPLOAD_ERROR`; rejecting with
 * the mapped error would bypass exactly that code and risk double-wrapping).
 *
 * The table below covers the full httpx `TransportError` family so future
 * extractions cannot silently outgrow it; the current corpus uses
 * `ConnectError` and `TimeoutException`. Cause shapes mirror undici's
 * (Node >= 20 native fetch): a `TypeError("fetch failed")` with an Error
 * cause carrying a `code` such as `ECONNREFUSED` or `UND_ERR_*`.
 */

/** Raised when a vector names an httpx class this table does not cover. */
export class UnknownTransportErrorClass extends Error {
  /**
   * Create an unknown-class error.
   *
   * @param httpxClass - The unrecognized `transport_error` value.
   */
  constructor(httpxClass: string) {
    super(
      `transport-errors.ts has no entry for httpx class ${JSON.stringify(httpxClass)} ` +
        "— extend the committed table (design D12)",
    );
    this.name = "UnknownTransportErrorClass";
  }
}

/** The cause shape one table entry produces. */
interface RejectionSpec {
  /** `Error.name` of the cause (mirrors the undici cause class name). */
  readonly causeName: string;
  /** Human-readable cause message. */
  readonly causeMessage: string;
  /** The `code` property undici sets on the cause. */
  readonly causeCode: string;
}

/**
 * The committed httpx → native-fetch rejection table (design D12).
 *
 * Keys are httpx exception class names exactly as vectors carry them.
 * Values describe the `cause` attached to the `TypeError("fetch failed")`
 * rejection, shaped after what undici produces for the analogous failure.
 */
const REJECTION_TABLE: Readonly<Record<string, RejectionSpec>> = {
  // httpx.TimeoutException family.
  TimeoutException: {
    causeName: "ConnectTimeoutError",
    causeMessage: "Connect Timeout Error",
    causeCode: "UND_ERR_CONNECT_TIMEOUT",
  },
  ConnectTimeout: {
    causeName: "ConnectTimeoutError",
    causeMessage: "Connect Timeout Error",
    causeCode: "UND_ERR_CONNECT_TIMEOUT",
  },
  ReadTimeout: {
    causeName: "HeadersTimeoutError",
    causeMessage: "Headers Timeout Error",
    causeCode: "UND_ERR_HEADERS_TIMEOUT",
  },
  WriteTimeout: {
    causeName: "BodyTimeoutError",
    causeMessage: "Body Timeout Error",
    causeCode: "UND_ERR_BODY_TIMEOUT",
  },
  PoolTimeout: {
    causeName: "ConnectTimeoutError",
    causeMessage: "Connect Timeout Error",
    causeCode: "UND_ERR_CONNECT_TIMEOUT",
  },
  // httpx.NetworkError family.
  ConnectError: {
    causeName: "Error",
    causeMessage: "connect ECONNREFUSED 127.0.0.1:443",
    causeCode: "ECONNREFUSED",
  },
  ReadError: {
    causeName: "SocketError",
    causeMessage: "other side closed",
    causeCode: "UND_ERR_SOCKET",
  },
  WriteError: {
    causeName: "SocketError",
    causeMessage: "other side closed",
    causeCode: "UND_ERR_SOCKET",
  },
  CloseError: {
    causeName: "SocketError",
    causeMessage: "other side closed",
    causeCode: "UND_ERR_SOCKET",
  },
  // httpx.ProtocolError family.
  LocalProtocolError: {
    causeName: "SocketError",
    causeMessage: "other side closed",
    causeCode: "UND_ERR_SOCKET",
  },
  RemoteProtocolError: {
    causeName: "SocketError",
    causeMessage: "other side closed",
    causeCode: "UND_ERR_SOCKET",
  },
  // Remaining httpx.TransportError leaves.
  ProxyError: {
    causeName: "Error",
    causeMessage: "connect ECONNREFUSED 127.0.0.1:443",
    causeCode: "ECONNREFUSED",
  },
  UnsupportedProtocol: {
    causeName: "Error",
    causeMessage: "unsupported protocol",
    causeCode: "ERR_INVALID_URL_SCHEME",
  },
};

/**
 * Whether the committed table covers an httpx class name.
 *
 * @param httpxClass - The `transport_error` value from a vector.
 * @returns `true` when {@link createTransportRejection} can build the
 *   rejection.
 */
export function knownTransportErrorClass(httpxClass: string): boolean {
  return Object.hasOwn(REJECTION_TABLE, httpxClass);
}

/**
 * Build the native-style fetch rejection for one recorded transport error.
 *
 * @param httpxClass - The httpx exception class name from the vector
 *   (`interaction.response.transport_error`).
 * @returns A fresh `TypeError("fetch failed")` whose `cause` is an `Error`
 *   with the table's name/message and a `code` property — the shape the
 *   library's fetch adapter must classify itself (R2.10).
 * @throws UnknownTransportErrorClass - When the class is not in the table.
 * @example
 * ```typescript
 * const rejection = createTransportRejection("ConnectError");
 * // rejection instanceof TypeError; rejection.message === "fetch failed"
 * // (rejection.cause as Error & { code: string }).code === "ECONNREFUSED"
 * ```
 */
export function createTransportRejection(
  httpxClass: string,
  message?: string,
): TypeError {
  const spec = REJECTION_TABLE[httpxClass];
  if (spec === undefined) {
    throw new UnknownTransportErrorClass(httpxClass);
  }
  // The recorded exception message wins when present (B4-C1): the
  // Python replay transport re-raises `cls(recorded_message)` and
  // `str(e)` flows into `details_contain.error`, so the TS cause must
  // carry the same text for the wire error diff to reproduce it.
  const cause = new RecordedTransportCause(
    message ?? spec.causeMessage,
    spec.causeName,
    spec.causeCode,
  );
  return new TypeError("fetch failed", { cause });
}

/**
 * The undici-shaped `cause` of a replayed transport failure: a plain
 * `Error` carrying the recorded `name` and `code` (what
 * `MixpanelHttpError` classification reads).
 */
class RecordedTransportCause extends Error {
  override readonly name: string;
  /** The undici error code (`UND_ERR_*` / `ECONNREFUSED` …). */
  readonly code: string;

  constructor(message: string, name: string, code: string) {
    super(message);
    this.name = name;
    this.code = code;
  }
}
