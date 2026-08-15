/**
 * `$type` value codecs — TS mirror of `conformance/record/codecs.py`
 * (design D4.4; vector.schema.json `taggedValue`).
 *
 * Decode side (replay): vector `call.input` values reconstruct rich
 * arguments. The non-dataclass built-ins (`datetime`, `date`, `SecretStr`,
 * `bytes`, `callback`) are always available; dataclass/model tags
 * (`Filter`, `FunnelStep`, `CreateAnnotationParams`, ...) are registered by
 * each port batch through {@link CodecRegistry.register} as their TS types
 * come into existence — an unknown tag throws {@link UndecodableValueError}
 * loudly (a committed vector that fails decode is a codec-table or vector
 * bug, mirroring the Python rule), it never silently degrades.
 *
 * Encode side (diff prep for TS-5): live TS outputs are converted to
 * vector-JSON shape before canonicalization — `Uint8Array` -> `$type:
 * bytes`, wrapper types back to their tags — with lone surrogates and
 * non-finite floats rejected at the boundary per D6 rules 2 and 5.
 *
 * Numbers: decoded `JsonNumber` tokens become JS `number`s; integer tokens
 * whose exact value exceeds 2^53 become `bigint` (never silently rounded —
 * the D6 `PRECISION_LOSS` machinery depends on the distinction).
 */

import { JsonNumber, type JsonValue } from "./json-value.js";

/** Raised when a vector value cannot be decoded back to a TS value. */
export class UndecodableValueError extends Error {
  /**
   * Create a decode error.
   *
   * @param message - Description of the malformed or unknown payload.
   */
  constructor(message: string) {
    super(message);
    this.name = "UndecodableValueError";
  }
}

/** Raised when a live TS value cannot be encoded into vector JSON. */
export class UnencodableValueError extends Error {
  /**
   * Create an encode error.
   *
   * @param message - Description of the unencodable value.
   */
  constructor(message: string) {
    super(message);
    this.name = "UnencodableValueError";
  }
}

/** Mirror of Python's `SecretStr` argument wrapper (D5.5 revealed literal). */
export class SecretValue {
  /** The revealed fake test value. */
  readonly value: string;

  /**
   * Wrap a secret literal.
   *
   * @param value - The revealed fake test value from the vector.
   */
  constructor(value: string) {
    this.value = value;
  }
}

/** Decoded `$type: datetime` — the ISO string, kept lossless. */
export class PyDatetime {
  /** ISO-8601 text exactly as Python `datetime.isoformat()` emitted it. */
  readonly iso: string;

  /**
   * Wrap an ISO datetime string.
   *
   * @param iso - The `iso` field of the tagged object.
   */
  constructor(iso: string) {
    this.iso = iso;
  }
}

/** Decoded `$type: date` — the ISO date string, kept lossless. */
export class PyDate {
  /** ISO-8601 date text exactly as Python `date.isoformat()` emitted it. */
  readonly iso: string;

  /**
   * Wrap an ISO date string.
   *
   * @param iso - The `iso` field of the tagged object.
   */
  constructor(iso: string) {
    this.iso = iso;
  }
}

/**
 * Replay stub for `$type: callback` kwargs (design D4.4).
 *
 * Both runners inject one per callback-tagged kwarg; {@link fn} is passed
 * to the library, and the recorded {@link calls} log (positional args,
 * encoded) is diffed against `expect.callback_calls[<kwarg>]` in TS-5.
 */
export class RecordingCallback {
  /** The kwarg name the stub replaces. */
  readonly name: string;

  /** Ordered list of encoded positional-argument lists. */
  readonly calls: JsonValue[][] = [];

  /** The callable handed to the library under test. */
  readonly fn: (...args: unknown[]) => void;

  /**
   * Create an empty recording stub.
   *
   * @param name - The kwarg name this stub stands in for.
   */
  constructor(name: string) {
    this.name = name;
    this.fn = (...args: unknown[]): void => {
      this.calls.push(args.map((arg) => encodeExpectValue(arg)));
    };
  }
}

/**
 * Decoder callback for one registered rich `$type` tag.
 *
 * Receives the tagged payload (minus nothing — `$type` included) and a
 * recursive decode function for field values; returns the reconstructed
 * TS value.
 */
export type TagDecoder = (
  payload: Readonly<Record<string, JsonValue>>,
  decodeField: (value: JsonValue) => unknown,
) => unknown;

/** Matches a lone (unpaired) UTF-16 surrogate anywhere in a string. */
const LONE_SURROGATE =
  /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/;

/**
 * Reject strings containing lone surrogates (D6 rule 2).
 *
 * @param value - Candidate string.
 * @returns The same string when well-formed.
 * @throws UnencodableValueError - When an unpaired surrogate is present.
 */
function rejectBadString(value: string): string {
  if (LONE_SURROGATE.test(value)) {
    throw new UnencodableValueError(
      `string contains a lone surrogate: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Decode a base64 string to bytes.
 *
 * @param data - Base64 text from a `$type: bytes` payload.
 * @returns The decoded bytes.
 * @throws UndecodableValueError - On malformed base64.
 */
function decodeBase64(data: string): Uint8Array {
  try {
    // atob is available in Node >= 16 and browsers (isomorphic-safe).
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (cause) {
    throw new UndecodableValueError(
      `malformed base64 in $type bytes payload: ${String(cause)}`,
    );
  }
}

/**
 * Encode bytes as base64 text.
 *
 * @param bytes - The raw byte payload.
 * @returns Base64 text for the `$type: bytes` tagged object.
 */
function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Read a required string field from a tagged payload.
 *
 * @param payload - The tagged object.
 * @param key - Field name.
 * @param tag - The `$type` value, for error messages.
 * @returns The string value.
 * @throws UndecodableValueError - When absent or not a string.
 */
function requireTagString(
  payload: Readonly<Record<string, JsonValue>>,
  key: string,
  tag: string,
): string {
  const value = payload[key];
  if (typeof value !== "string") {
    throw new UndecodableValueError(
      `malformed $type ${JSON.stringify(tag)} payload: missing string ${JSON.stringify(key)}`,
    );
  }
  return value;
}

/**
 * The decode-side codec table (design D4.4 mirror).
 *
 * Built-in tags are always available; rich dataclass/model tags are
 * registered per port batch. One registry instance is expected per runner
 * process; tests may build isolated instances.
 */
export class CodecRegistry {
  /** Registered rich-tag decoders, keyed by `$type` name. */
  private readonly decoders = new Map<string, TagDecoder>();

  /**
   * Register a decoder for a rich `$type` tag (e.g. `Filter`).
   *
   * @param tag - The `$type` name exactly as vectors carry it.
   * @param decoder - The reconstruction callback.
   * @throws Error - If the tag is already registered or shadows a
   *   built-in (`datetime`, `date`, `SecretStr`, `bytes`, `callback`).
   */
  register(tag: string, decoder: TagDecoder): void {
    if (BUILTIN_TAGS.has(tag)) {
      throw new Error(
        `cannot override built-in $type tag ${JSON.stringify(tag)}`,
      );
    }
    if (this.decoders.has(tag)) {
      throw new Error(
        `duplicate codec registration for $type ${JSON.stringify(tag)}`,
      );
    }
    this.decoders.set(tag, decoder);
  }

  /**
   * Whether a tag is decodable (built-in or registered).
   *
   * @param tag - The `$type` name.
   * @returns True when {@link decodeValue} can handle the tag.
   */
  knows(tag: string): boolean {
    return BUILTIN_TAGS.has(tag) || this.decoders.has(tag);
  }

  /**
   * Decode one vector JSON value into a TS value (design D12 replay side).
   *
   * Plain JSON passes through; `JsonNumber` tokens become `number` (or
   * `bigint` above 2^53); `$type`-tagged objects dispatch through the
   * built-in table then registered decoders; containers recurse.
   *
   * @param value - A value loaded from a vector's `call.input`.
   * @returns The decoded TS value.
   * @throws UndecodableValueError - If any nested tag is unknown or its
   *   payload malformed.
   *
   * @example
   * ```typescript
   * const registry = new CodecRegistry();
   * registry.decodeValue({ $type: "bytes", encoding: "base64", data: "aGk=" });
   * // Uint8Array [104, 105]
   * ```
   */
  decodeValue(value: JsonValue): unknown {
    if (value instanceof JsonNumber) {
      if (value.isUnsafeInteger()) {
        return BigInt(value.raw);
      }
      return value.toNumber();
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.decodeValue(item));
    }
    if (typeof value === "object" && value !== null) {
      const tag = value["$type"];
      if (typeof tag === "string") {
        return this.decodeTagged(tag, value);
      }
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        out[key] = this.decodeValue(item);
      }
      return out;
    }
    return value;
  }

  /**
   * Decode a vector `call.input` object into named arguments.
   *
   * @param input - The vector's `call.input` mapping.
   * @returns Decoded values keyed by the PYTHON parameter names (kwarg
   *   camelization for options-bag calls is applied later, at invocation
   *   binding, per naming-map §2 — this layer only reconstructs values).
   * @throws UndecodableValueError - If any value fails to decode.
   */
  decodeInputKwargs(
    input: Readonly<Record<string, JsonValue>>,
  ): Record<string, unknown> {
    const decoded: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(input)) {
      decoded[name] = this.decodeValue(value);
    }
    return decoded;
  }

  /**
   * Dispatch one tagged payload (built-ins first, then registered tags).
   *
   * @param tag - The `$type` value.
   * @param payload - The tagged object.
   * @returns The reconstructed value.
   * @throws UndecodableValueError - On unknown tags or malformed payloads.
   */
  private decodeTagged(
    tag: string,
    payload: Readonly<Record<string, JsonValue>>,
  ): unknown {
    switch (tag) {
      case "datetime":
        return new PyDatetime(requireTagString(payload, "iso", tag));
      case "date":
        return new PyDate(requireTagString(payload, "iso", tag));
      case "SecretStr":
        return new SecretValue(requireTagString(payload, "value", tag));
      case "bytes": {
        if (payload["encoding"] !== "base64") {
          throw new UndecodableValueError(
            `unknown bytes encoding ${JSON.stringify(payload["encoding"])}`,
          );
        }
        return decodeBase64(requireTagString(payload, "data", tag));
      }
      case "callback":
        return new RecordingCallback(requireTagString(payload, "name", tag));
      default: {
        const decoder = this.decoders.get(tag);
        if (decoder === undefined) {
          throw new UndecodableValueError(
            `no codec for $type ${JSON.stringify(tag)} (extend conformance-runner/src/codecs.ts ` +
              "and conformance/record/codecs.py together — design D4.4)",
          );
        }
        return decoder(payload, (value) => this.decodeValue(value));
      }
    }
  }
}

/** Built-in `$type` names handled without registration. */
const BUILTIN_TAGS: ReadonlySet<string> = new Set([
  "datetime",
  "date",
  "SecretStr",
  "bytes",
  "callback",
]);

/**
 * Encode a live TS value into vector-JSON shape for diffing (D6/D4.4).
 *
 * Mirror of Python `encode_expect_value`: bytes and datetime wrappers stay
 * `$type`-tagged; `JsonNumber`/`bigint` pass through for the canonicalizer's
 * raw-token rules; lone surrogates and non-finite floats are rejected.
 *
 * `undefined` follows ECMAScript JSON semantics — the least surprising rule
 * under R3.5's absent-vs-null discipline: an object property whose value is
 * `undefined` is treated as ABSENT (dropped, like `JSON.stringify`), while
 * a bare/array-item `undefined` encodes as `null` (a void TS return is the
 * analog of Python's `None` return).
 *
 * @param value - A value produced by the TS library under test (or a
 *   callback-argument capture).
 * @returns A vector-JSON structure ready for canonicalization.
 * @throws UnencodableValueError - If the value has no encoding (functions,
 *   symbols, unknown class instances) or violates D6 rules 2/5.
 */
export function encodeExpectValue(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new UnencodableValueError(
        `non-finite number in output: ${String(value)}`,
      );
    }
    return value;
  }
  if (typeof value === "bigint" || value instanceof JsonNumber) {
    return value;
  }
  if (typeof value === "string") {
    return rejectBadString(value);
  }
  if (value instanceof Uint8Array) {
    return { $type: "bytes", encoding: "base64", data: encodeBase64(value) };
  }
  if (value instanceof PyDatetime) {
    return { $type: "datetime", iso: value.iso };
  }
  if (value instanceof PyDate) {
    return { $type: "date", iso: value.iso };
  }
  if (value instanceof SecretValue) {
    return { $type: "SecretStr", value: rejectBadString(value.value) };
  }
  if (Array.isArray(value)) {
    return value.map((item) => encodeExpectValue(item));
  }
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) {
        continue; // absent, not null (R3.5 / JSON.stringify semantics)
      }
      out[rejectBadString(key)] = encodeExpectValue(item);
    }
    return out;
  }
  throw new UnencodableValueError(
    `no encoding for ${typeof value === "object" ? value.constructor.name || "object" : typeof value} in output position`,
  );
}
