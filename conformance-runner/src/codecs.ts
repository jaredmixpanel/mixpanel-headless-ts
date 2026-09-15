/**
 * `$type` value codecs for vector payloads (`vector.schema.json`
 * `taggedValue`).
 *
 * Decode side (replay): vector `call.input` values reconstruct rich
 * arguments. The non-dataclass built-ins (`datetime`, `date`, `SecretStr`,
 * `bytes`, `callback`, `float`) are always available; dataclass/model tags
 * (`Filter`, `FunnelStep`, `CreateAnnotationParams`, ...) are registered
 * through {@link CodecRegistry.register}. An unknown tag throws
 * {@link UndecodableValueError} loudly — a committed vector that fails
 * decode is a codec-table or vector bug, never something to degrade around.
 *
 * Encode side (diff preparation): live TS outputs are converted to
 * vector-JSON shape before canonicalization — `Uint8Array` to
 * `$type: bytes`, wrapper types back to their tags — with lone surrogates and
 * non-finite floats rejected at the boundary (canonicalization rules 2
 * and 5). Decoded `JsonNumber` tokens become JS `number`s; integer tokens
 * whose exact value exceeds 2^53 become `bigint`, never silently rounded,
 * because the `PRECISION_LOSS` verdict depends on the distinction.
 *
 * @see conformance.record.codecs
 */

import { pythonFloatStr, Secret } from "@mixpanel-headless/core";

import { JsonNumber, type JsonValue } from "./json-value.js";

/**
 * Raised when a vector value cannot be decoded back to a TS value.
 *
 * @example
 * ```ts
 * new CodecRegistry().decodeValue({ $type: "Mystery", value: 1 });
 * // throws UndecodableValueError: no codec for $type "Mystery"
 * ```
 */
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

/**
 * Raised when a live TS value cannot be encoded into vector JSON.
 *
 * @example
 * ```ts
 * encodeExpectValue(() => undefined);
 * // throws UnencodableValueError: no encoding for function in output position
 * ```
 */
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

/**
 * Historical name for the decoded `SecretStr` product.
 *
 * @deprecated The `$type: SecretStr` built-in decodes to the real core
 * {@link Secret} wrapper; the placeholder class is gone and this alias
 * survives only so older call sites keep typechecking. Read the revealed
 * value via `.reveal()`.
 */
export type SecretValue = Secret;

/**
 * Decoded `$type: datetime` — the ISO string, kept lossless.
 *
 * @example
 * ```ts
 * const when = new PyDatetime("2026-01-15T12:00:00+00:00");
 * encodeExpectValue(when);
 * // { $type: "datetime", iso: "2026-01-15T12:00:00+00:00" }
 * ```
 */
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

/**
 * Decoded `$type: float` — the canonical spelling, kept lossless.
 *
 * The recorder tags integral-valued floats inside rich payloads because
 * `1716810000.0` cannot survive a double-only decode as a raw token (it
 * collapses to the integer and the round-trip diffs), and the authored
 * validation vectors carry the non-finite spellings
 * (`Infinity`/`-Infinity`/`NaN`). The wrapper preserves the spelling so
 * encode re-emits the tagged form byte-for-byte.
 *
 * @example
 * ```ts
 * new PyFloat("18.0").toNumber(); // 18
 * new PyFloat("Infinity").toNumber(); // Infinity
 * new PyFloat("18.5"); // throws UndecodableValueError (must stay a raw token)
 * ```
 */
export class PyFloat {
  /** The canonical spelling exactly as the tagged payload carried it. */
  readonly spelling: string;

  /**
   * Wrap a canonical float spelling.
   *
   * @param spelling - `Infinity`, `-Infinity`, `NaN`, or the canonical
   *   Python `repr` of an integral float (e.g. `"18.0"`, `"1e+16"`).
   * @throws UndecodableValueError - On any other spelling (non-integral
   *   finite floats must stay raw JSON number tokens — canonicalization
   *   rule 3).
   */
  constructor(spelling: string) {
    if (!["Infinity", "-Infinity", "NaN"].includes(spelling)) {
      const parsed = Number(spelling);
      const canonical =
        Number.isFinite(parsed) &&
        Number.isInteger(parsed) &&
        pythonFloatStr(parsed) === spelling;
      if (!canonical) {
        throw new UndecodableValueError(
          `$type float carries non-canonical spelling ${JSON.stringify(spelling)} ` +
            "(non-integral finite floats must be raw JSON number tokens — " +
            "design D6 rule 3; taggable spellings are Infinity/-Infinity/NaN " +
            "and canonical integral reprs)",
        );
      }
    }
    this.spelling = spelling;
  }

  /**
   * The numeric value of the spelling.
   *
   * @returns ECMAScript `Number(spelling)` (`NaN` for the NaN spelling).
   */
  toNumber(): number {
    return Number(this.spelling);
  }
}

/**
 * Decoded `$type: date` — the ISO date string, kept lossless.
 *
 * @example
 * ```ts
 * const day = new PyDate("2026-01-15");
 * encodeExpectValue(day);
 * // { $type: "date", iso: "2026-01-15" }
 * ```
 */
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
 * Replay stub for `$type: callback` kwargs.
 *
 * Both runners inject one per callback-tagged kwarg; {@link fn} is passed
 * to the library, and the recorded {@link calls} log (positional args,
 * encoded) is diffed against `expect.callback_calls[<kwarg>]`.
 *
 * @example
 * ```ts
 * const stub = new RecordingCallback("progress");
 * stub.fn(3, "loading");
 * stub.calls; // [[3, "loading"]]
 * ```
 * @see conformance.record.codecs.RecordingCallback
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

/**
 * Encoder callback for one registered rich `$type` tag (the encode half
 * of a tag codec).
 *
 * `matches` doubles as an anti-vacuity `instanceof` probe: it must be true
 * only for instances of the tag's real core class, so a
 * decode-to-plain-object codec can never round-trip through it.
 */
export interface RichTagEncoder {
  /**
   * Whether a live value is an instance of this tag's core class.
   *
   * @param value - A live TS value produced by decode or the library.
   * @returns True when {@link RichTagEncoder.encode} can serialize it.
   */
  matches: (value: unknown) => boolean;

  /**
   * Serialize the instance back to its tagged vector-JSON shape
   * (`$type` first, all declared fields — mirror of Python
   * `_encode_common(tagged_models=True)`).
   *
   * @param value - A value for which {@link RichTagEncoder.matches}
   *   returned true.
   * @param encodeChild - Recursive encoder for nested field values.
   * @returns The tagged object.
   */
  encode: (
    value: unknown,
    encodeChild: (value: unknown) => JsonValue,
  ) => JsonValue;
}

/** Matches a lone (unpaired) UTF-16 surrogate anywhere in a string. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Reject strings containing lone surrogates (canonicalization rule 2).
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
  } catch (error) {
    throw new UndecodableValueError(
      `malformed base64 in $type bytes payload: ${String(error)}`,
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
 * The decode-side codec table.
 *
 * Built-in tags are always available; rich dataclass/model tags are
 * registered on top. One registry instance is expected per runner
 * process; tests may build isolated instances.
 *
 * @example
 * ```ts
 * const registry = new CodecRegistry();
 * registry.registerTagCodec("Filter", codec.decode, codec);
 * registry.decodeValue({ $type: "date", iso: "2026-01-15" }); // PyDate
 * registry.encodeValue(new Uint8Array([104, 105]));
 * // { $type: "bytes", encoding: "base64", data: "aGk=" }
 * ```
 */
export class CodecRegistry {
  /** Registered rich-tag decoders, keyed by `$type` name. */
  private readonly decoders = new Map<string, TagDecoder>();

  /** Registered rich-tag encoders, keyed by `$type` name. */
  private readonly encoders = new Map<string, RichTagEncoder>();

  /**
   * Register a decoder for a rich `$type` tag (e.g. `Filter`).
   *
   * @param tag - The `$type` name exactly as vectors carry it.
   * @param decoder - The reconstruction callback.
   * @throws Error - If the tag is already registered or shadows a
   *   built-in (`datetime`, `date`, `SecretStr`, `bytes`, `callback`,
   *   `float`).
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
   * Register a full rich-tag codec: decoder plus encoder (the
   * `registerContractCodecs` wiring point uses this).
   *
   * @param tag - The `$type` name exactly as vectors carry it.
   * @param decoder - The reconstruction callback.
   * @param encoder - The encode half ({@link encodeValue} consults it).
   * @throws Error - If the tag is already registered or shadows a
   *   built-in (same rules as {@link register}).
   */
  registerTagCodec(
    tag: string,
    decoder: TagDecoder,
    encoder: RichTagEncoder,
  ): void {
    this.register(tag, decoder);
    this.encoders.set(tag, encoder);
  }

  /**
   * Encode a live TS value into vector-JSON shape, consulting the
   * registered rich-tag encoders for core class instances the built-in
   * {@link encodeExpectValue} table does not know.
   *
   * @param value - A live TS value (decode product or library output).
   * @returns A vector-JSON structure ready for canonicalization.
   * @throws UnencodableValueError - If no built-in branch and no
   *   registered encoder matches.
   */
  encodeValue(value: unknown): JsonValue {
    return encodeExpectValue(value, (candidate) => {
      for (const encoder of this.encoders.values()) {
        if (encoder.matches(candidate)) {
          return encoder.encode(candidate, (child) => this.encodeValue(child));
        }
      }
      return;
    });
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
   * Decode one vector JSON value into a TS value.
   *
   * Plain JSON passes through; `JsonNumber` tokens become `number` (or
   * `bigint` above 2^53); `$type`-tagged objects dispatch through the
   * built-in table then registered decoders; containers recurse.
   *
   * @param value - A value loaded from a vector's `call.input`.
   * @returns The decoded TS value.
   * @throws UndecodableValueError - If any nested tag is unknown or its
   *   payload malformed.
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
   * @returns Decoded values keyed by the Python parameter names (kwarg
   *   camelization for options-bag calls is applied later, at invocation
   *   binding — this layer only reconstructs values).
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
      case "datetime": {
        return new PyDatetime(requireTagString(payload, "iso", tag));
      }
      case "date": {
        return new PyDate(requireTagString(payload, "iso", tag));
      }
      case "SecretStr": {
        // The real core Secret, not a runner placeholder: the round-trip
        // must preserve the revealed value, not a mask.
        return new Secret(requireTagString(payload, "value", tag));
      }
      case "bytes": {
        if (payload["encoding"] !== "base64") {
          throw new UndecodableValueError(
            `unknown bytes encoding ${JSON.stringify(payload["encoding"])}`,
          );
        }
        return decodeBase64(requireTagString(payload, "data", tag));
      }
      case "callback": {
        return new RecordingCallback(requireTagString(payload, "name", tag));
      }
      case "float": {
        return new PyFloat(requireTagString(payload, "value", tag));
      }
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
  "float",
]);

/**
 * Encode a live TS value into vector-JSON shape for diffing.
 *
 * Bytes and datetime wrappers stay `$type`-tagged; `JsonNumber`/`bigint`
 * pass through for the canonicalizer's raw-token rules; lone surrogates and
 * non-finite floats are rejected.
 *
 * `undefined` follows ECMAScript JSON semantics — the least surprising rule
 * given that absent and `null` compare distinctly: an object property whose
 * value is `undefined` is treated as absent (dropped, like
 * `JSON.stringify`), while a bare/array-item `undefined` encodes as `null`
 * (a void TS return is the analog of Python's `None` return).
 *
 * @param value - A value produced by the TS library under test (or a
 *   callback-argument capture).
 * @param encodeRich - Optional hook for registered rich-tag instances:
 *   consulted for any object no built-in branch handles, before the final
 *   throw; returning `undefined` means "not mine".
 *   {@link CodecRegistry.encodeValue} supplies the registered-encoder
 *   lookup; direct calls omit it (built-ins only).
 * @returns A vector-JSON structure ready for canonicalization.
 * @throws UnencodableValueError - If the value has no encoding (functions,
 *   symbols, unknown class instances) or violates canonicalization rules
 *   2 or 5.
 * @example
 * ```ts
 * encodeExpectValue({ a: 1n, b: undefined, c: [undefined] });
 * // { a: 1n, c: [null] } — `b` is absent, the array hole is null
 * encodeExpectValue(new Secret("s3cret"));
 * // { $type: "SecretStr", value: "s3cret" }
 * ```
 * @see conformance.record.codecs.encode_expect_value
 */
// eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export function encodeExpectValue(
  value: unknown,
  encodeRich?: (value: object) => JsonValue | undefined,
): JsonValue {
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
  if (value instanceof PyFloat) {
    return { $type: "float", value: value.spelling };
  }
  if (value instanceof Secret) {
    // Never `toJSON()`: its `'**********'` mask in an encoded vector would
    // make mask-vs-mask comparisons vacuously equal, so the encoded form
    // carries the revealed value.
    return { $type: "SecretStr", value: rejectBadString(value.reveal()) };
  }
  if (Array.isArray(value)) {
    return value.map((item) => encodeExpectValue(item, encodeRich));
  }
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) {
        continue; // absent, not null (JSON.stringify semantics)
      }
      out[rejectBadString(key)] = encodeExpectValue(item, encodeRich);
    }
    return out;
  }
  if (typeof value === "object" && encodeRich !== undefined) {
    const encoded = encodeRich(value);
    if (encoded !== undefined) {
      return encoded;
    }
  }
  throw new UnencodableValueError(
    `no encoding for ${typeof value === "object" ? value.constructor.name || "object" : typeof value} in output position`,
  );
}

export { Secret } from "@mixpanel-headless/core";
