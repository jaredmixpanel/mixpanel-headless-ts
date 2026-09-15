/**
 * Order-preserving lossless JSON for the oracle bridge (design D14).
 *
 * The oracle cannot parse request lines with the runner's `parseLossless`
 * alone: that parser stores objects as plain JS objects, and ECMAScript
 * reorders integer-like keys (`{"1": .., "0": ..}` iterates `"0"` first),
 * while Python `str(dict)` — the contract behind `compat.python_str` —
 * renders keys in INSERTION order. A bridge that silently reorders keys
 * would report false divergences the library never produced.
 *
 * This module therefore parses request lines into a {@link RawValue} tree
 * that keeps object members as an ordered entry list ({@link RawObject})
 * and every number as a verbatim {@link JsonNumber} token, plus:
 *
 * - {@link toJsonValue} — the bridge into the runner's `JsonValue` model
 *   (codec decoding, D6 canonicalization);
 * - {@link serializeAsciiJson} — the D14 ASCII-safe response writer
 *   (every non-ASCII code unit, lone surrogates included, escapes as
 *   `\uXXXX`, mirroring oracle-py's `ensure_ascii=True` framing).
 */

import {
  JsonNumber,
  type JsonValue,
} from "@mixpanel-headless/conformance-runner";

/** Error raised for malformed JSON request text, with a character offset. */
export class RawJsonError extends Error {
  /** Zero-based character offset where parsing failed. */
  readonly offset: number;

  /**
   * Create a parse error.
   *
   * @param message - Human-readable description of the syntax problem.
   * @param offset - Zero-based character offset of the failure.
   */
  constructor(message: string, offset: number) {
    super(`${message} at offset ${offset}`);
    this.name = "RawJsonError";
    this.offset = offset;
  }
}

/**
 * A JSON object captured as its ordered member list.
 *
 * Duplicate keys follow `JSON.parse` / Python `json.loads` semantics:
 * the LAST occurrence's value wins, at the FIRST occurrence's position
 * (both languages update in place when rebuilding the mapping).
 */
export class RawObject {
  /** The ordered `(key, value)` members exactly as they appeared. */
  readonly entries: ReadonlyArray<readonly [string, RawValue]>;

  /**
   * Wrap an ordered member list.
   *
   * @param entries - The `(key, value)` pairs in source order (already
   *   deduplicated by the parser).
   */
  constructor(entries: ReadonlyArray<readonly [string, RawValue]>) {
    this.entries = entries;
  }

  /**
   * Look up a member by key.
   *
   * @param key - The member name.
   * @returns The member value, or `undefined` when absent.
   */
  get(key: string): RawValue | undefined {
    for (const [name, value] of this.entries) {
      if (name === key) {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Whether a member with the given key exists.
   *
   * @param key - The member name.
   * @returns `true` when present (even with a `null` value).
   */
  has(key: string): boolean {
    return this.entries.some(([name]) => name === key);
  }
}

/** A JSON value with ordered objects and verbatim number tokens. */
export type RawValue =
  null | boolean | string | JsonNumber | RawValue[] | RawObject;

/** Matches a JSON number token at a given position (sticky). */
const NUMBER_TOKEN = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** Matches a JSON string token at a given position (sticky). */
const STRING_TOKEN =
  // eslint-disable-next-line no-control-regex -- RFC 8259 forbids raw control chars in strings; the class is intentional
  /"(?:[^"\\\u0000-\u001F]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;

/**
 * Parse one JSON document into the ordered lossless model.
 *
 * @param text - The JSON document (one request line).
 * @returns The parsed {@link RawValue}; objects keep member order,
 *   numbers keep their verbatim tokens.
 * @throws RawJsonError - On any syntax error or trailing content.
 * @example
 * ```typescript
 * const value = parseRawJson('{"1": 18.0, "0": null}') as RawObject;
 * value.entries.map(([key]) => key); // ["1", "0"]  (insertion order kept)
 * ```
 */
export function parseRawJson(text: string): RawValue {
  const parser = new RawParser(text);
  const value = parser.parseValue();
  parser.skipWhitespace();
  if (!parser.atEnd()) {
    throw new RawJsonError("unexpected trailing content", parser.pos);
  }
  return value;
}

/** Recursive-descent parser over a source string (order-preserving). */
class RawParser {
  /** The JSON source text. */
  private readonly text: string;

  /** Current zero-based scan position. */
  pos = 0;

  /**
   * Create a parser over the given source.
   *
   * @param text - The JSON document to scan.
   */
  constructor(text: string) {
    this.text = text;
  }

  /**
   * Whether the scan position has reached the end of input.
   *
   * @returns `true` when no characters remain.
   */
  atEnd(): boolean {
    return this.pos >= this.text.length;
  }

  /** Advance the scan position past any JSON whitespace. */
  skipWhitespace(): void {
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        this.pos += 1;
      } else {
        break;
      }
    }
  }

  /**
   * Parse one JSON value at the current position.
   *
   * @returns The parsed value.
   * @throws RawJsonError - On malformed input.
   */
  parseValue(): RawValue {
    this.skipWhitespace();
    if (this.atEnd()) {
      throw new RawJsonError("unexpected end of input", this.pos);
    }
    // `charAt` (not indexing): `atEnd()` above guarantees a character, and
    // `charAt` is typed `string`, so the switch is over a closed set.
    const ch = this.text.charAt(this.pos);
    switch (ch) {
      case "{": {
        return this.parseObject();
      }
      case "[": {
        return this.parseArray();
      }
      case '"': {
        return this.parseString();
      }
      case "t": {
        this.expectLiteral("true");
        return true;
      }
      case "f": {
        this.expectLiteral("false");
        return false;
      }
      case "n": {
        this.expectLiteral("null");
        return null;
      }
      default: {
        return this.parseNumber();
      }
    }
  }

  /**
   * Consume an exact literal (`true` / `false` / `null`).
   *
   * @param literal - The expected literal text.
   * @throws RawJsonError - If the source does not match.
   */
  private expectLiteral(literal: string): void {
    if (this.text.startsWith(literal, this.pos)) {
      this.pos += literal.length;
      return;
    }
    throw new RawJsonError(`expected '${literal}'`, this.pos);
  }

  /**
   * Parse a JSON object at the current position.
   *
   * @returns The parsed {@link RawObject} (duplicate keys: last value
   *   wins at the first occurrence's position).
   * @throws RawJsonError - On malformed input.
   */
  private parseObject(): RawObject {
    this.pos += 1; // consume '{'
    const keys: string[] = [];
    const values = new Map<string, RawValue>();
    this.skipWhitespace();
    if (this.text[this.pos] === "}") {
      this.pos += 1;
      return new RawObject([]);
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] !== '"') {
        throw new RawJsonError("expected object key string", this.pos);
      }
      const key = this.parseString();
      this.skipWhitespace();
      if (this.text[this.pos] !== ":") {
        throw new RawJsonError("expected ':' after object key", this.pos);
      }
      this.pos += 1;
      if (!values.has(key)) {
        keys.push(key);
      }
      values.set(key, this.parseValue());
      this.skipWhitespace();
      const next = this.text[this.pos];
      if (next === ",") {
        this.pos += 1;
        continue;
      }
      if (next === "}") {
        this.pos += 1;
        return new RawObject(
          keys.map((name) => [name, values.get(name) as RawValue] as const),
        );
      }
      throw new RawJsonError("expected ',' or '}' in object", this.pos);
    }
  }

  /**
   * Parse a JSON array at the current position.
   *
   * @returns The parsed array.
   * @throws RawJsonError - On malformed input.
   */
  private parseArray(): RawValue[] {
    this.pos += 1; // consume '['
    const result: RawValue[] = [];
    this.skipWhitespace();
    if (this.text[this.pos] === "]") {
      this.pos += 1;
      return result;
    }
    for (;;) {
      result.push(this.parseValue());
      this.skipWhitespace();
      const next = this.text[this.pos];
      if (next === ",") {
        this.pos += 1;
        continue;
      }
      if (next === "]") {
        this.pos += 1;
        return result;
      }
      throw new RawJsonError("expected ',' or ']' in array", this.pos);
    }
  }

  /**
   * Parse a JSON string token at the current position.
   *
   * Escape decoding is delegated to `JSON.parse` on the validated token,
   * which is guaranteed well-formed by the token regex (lone-surrogate
   * `\uXXXX` escapes decode to lone-surrogate code units, exactly like
   * Python `json.loads`).
   *
   * @returns The decoded string value.
   * @throws RawJsonError - On malformed input.
   */
  private parseString(): string {
    STRING_TOKEN.lastIndex = this.pos;
    const match = STRING_TOKEN.exec(this.text);
    if (match?.index !== this.pos) {
      throw new RawJsonError("malformed string token", this.pos);
    }
    this.pos = STRING_TOKEN.lastIndex;
    return JSON.parse(match[0]) as string;
  }

  /**
   * Parse a JSON number token at the current position.
   *
   * @returns A {@link JsonNumber} wrapping the verbatim token.
   * @throws RawJsonError - On malformed input.
   */
  private parseNumber(): JsonNumber {
    NUMBER_TOKEN.lastIndex = this.pos;
    const match = NUMBER_TOKEN.exec(this.text);
    if (match?.index !== this.pos) {
      throw new RawJsonError("malformed number token", this.pos);
    }
    this.pos = NUMBER_TOKEN.lastIndex;
    return new JsonNumber(match[0]);
  }
}

/**
 * Convert a {@link RawValue} into the runner's `JsonValue` model.
 *
 * Objects flatten to plain JS objects (integer-like keys may iterate in
 * a different order afterwards — acceptable for the codec/canonicalizer
 * consumers, which are order-insensitive; order-sensitive consumers walk
 * the {@link RawValue} tree directly). Number tokens pass through as the
 * shared `JsonNumber` instances.
 *
 * @param value - The ordered lossless value.
 * @returns The equivalent `JsonValue`.
 */
export function toJsonValue(value: RawValue): JsonValue {
  if (value instanceof RawObject) {
    const out: Record<string, JsonValue> = {};
    for (const [key, member] of value.entries) {
      out[key] = toJsonValue(member);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }
  return value;
}

/**
 * The value domain {@link serializeAsciiJson} accepts: response envelopes
 * mix plain JSON members (ids, error codes), `JsonValue` outputs (which
 * may carry `JsonNumber` tokens or `bigint`), and echoed {@link RawValue}
 * request members.
 */
export type SerializableValue =
  | null
  | undefined
  | boolean
  | string
  | number
  | bigint
  | JsonNumber
  | RawObject
  | SerializableValue[]
  | { readonly [key: string]: SerializableValue };

/**
 * Serialize a response value as single-line, ASCII-safe JSON (D14).
 *
 * Every code unit at or above `U+007F` — including each half of an astral
 * surrogate pair AND lone surrogates — escapes as `\uXXXX`, byte-for-byte
 * matching Python's `json.dumps(..., ensure_ascii=True)` framing, so no
 * strategy-generated string can produce a non-ASCII (or raw-newline) byte
 * on the bridge's stdout. `JsonNumber` emits its verbatim token; `bigint`
 * emits its exact decimal digits; `undefined` renders as `null` (it only
 * appears when echoing an absent request `id`).
 *
 * @param value - The value to serialize.
 * @returns The single-line JSON text.
 * @throws Error - On non-finite `number` values or non-plain objects
 *   (response construction bugs; never reachable from request data).
 */
export function serializeAsciiJson(value: SerializableValue): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return serializeAsciiString(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`non-finite number in response: ${String(value)}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof JsonNumber) {
    return value.raw;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeAsciiJson(item)).join(", ")}]`;
  }
  if (value instanceof RawObject) {
    const rawMembers = value.entries.map(
      ([key, member]) =>
        `${serializeAsciiString(key)}: ${serializeAsciiJson(member)}`,
    );
    return `{${rawMembers.join(", ")}}`;
  }
  if (typeof value === "object" && !isPlainObject(value)) {
    throw new Error(
      `no ASCII-JSON serialization for ${value.constructor.name || "object"}`,
    );
  }
  const members = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .map(
      ([key, member]) =>
        `${serializeAsciiString(key)}: ${serializeAsciiJson(member)}`,
    );
  return `{${members.join(", ")}}`;
}

/**
 * Whether a value is a plain object literal (serializable as members).
 *
 * @param value - The candidate object.
 * @returns `true` for `Object.prototype`- or `null`-prototyped objects.
 */
function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Serialize one string as an ASCII-only JSON string literal.
 *
 * @param value - The string (any code units, lone surrogates included).
 * @returns The quoted, fully-escaped literal.
 */
function serializeAsciiString(value: string): string {
  let out = '"';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const ch = value[index] as string;
    switch (ch) {
      case '"':
      case "\\": {
        out += `\\${ch}`;

        break;
      }
      case "\b": {
        out += String.raw`\b`;

        break;
      }
      case "\f": {
        out += String.raw`\f`;

        break;
      }
      case "\n": {
        out += String.raw`\n`;

        break;
      }
      case "\r": {
        out += String.raw`\r`;

        break;
      }
      case "\t": {
        out += String.raw`\t`;

        break;
      }
      default: {
        if (code < 0x20 || code >= 0x7f) {
          out += String.raw`\u${code.toString(16).padStart(4, "0")}`;
        } else {
          out += ch;
        }
      }
    }
  }
  return `${out}"`;
}
