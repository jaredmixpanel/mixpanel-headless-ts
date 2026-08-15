/**
 * Strict, lossless JSON parser (D6 rule 3 / D12 hard requirement).
 *
 * Identical grammar to RFC 8259 `JSON.parse`, except every number is
 * captured as a {@link JsonNumber} wrapping its verbatim source token so
 * that `18` vs `18.0` and integers above 2^53 survive loading. Duplicate
 * object keys follow last-wins semantics, matching both `JSON.parse` and
 * Python `json.loads`.
 */

import { JsonNumber, type JsonValue } from "./json-value.js";

/** Error raised for malformed JSON input, with a character offset. */
export class LosslessJsonError extends Error {
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
    this.name = "LosslessJsonError";
    this.offset = offset;
  }
}

/** Matches a JSON number token at a given position (sticky). */
const NUMBER_TOKEN = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** Matches a JSON string token at a given position (sticky). */
const STRING_TOKEN =
  // eslint-disable-next-line no-control-regex -- RFC 8259 forbids raw control chars in strings; the class is intentional
  /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;

/**
 * Parse JSON text losslessly.
 *
 * @param text - The JSON document.
 * @returns The parsed value; numbers are {@link JsonNumber} instances.
 * @throws LosslessJsonError - On any syntax error or trailing content.
 *
 * @example
 * ```typescript
 * const value = parseLossless('{"a": 18.0}');
 * // { a: JsonNumber { raw: "18.0" } }
 * ```
 */
export function parseLossless(text: string): JsonValue {
  const parser = new Parser(text);
  const value = parser.parseValue();
  parser.skipWhitespace();
  if (!parser.atEnd()) {
    throw new LosslessJsonError("unexpected trailing content", parser.pos);
  }
  return value;
}

/** Recursive-descent JSON parser over a source string. */
class Parser {
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
   * @throws LosslessJsonError - On malformed input.
   */
  parseValue(): JsonValue {
    this.skipWhitespace();
    if (this.atEnd()) {
      throw new LosslessJsonError("unexpected end of input", this.pos);
    }
    const ch = this.text[this.pos];
    switch (ch) {
      case "{":
        return this.parseObject();
      case "[":
        return this.parseArray();
      case '"':
        return this.parseString();
      case "t":
        this.expectLiteral("true");
        return true;
      case "f":
        this.expectLiteral("false");
        return false;
      case "n":
        this.expectLiteral("null");
        return null;
      default:
        return this.parseNumber();
    }
  }

  /**
   * Consume an exact literal (`true` / `false` / `null`).
   *
   * @param literal - The expected literal text.
   * @throws LosslessJsonError - If the source does not match.
   */
  private expectLiteral(literal: string): void {
    if (this.text.startsWith(literal, this.pos)) {
      this.pos += literal.length;
      return;
    }
    throw new LosslessJsonError(`expected '${literal}'`, this.pos);
  }

  /**
   * Parse a JSON object at the current position.
   *
   * @returns The parsed object (duplicate keys: last wins).
   * @throws LosslessJsonError - On malformed input.
   */
  private parseObject(): { [key: string]: JsonValue } {
    this.pos += 1; // consume '{'
    const result: { [key: string]: JsonValue } = {};
    this.skipWhitespace();
    if (this.text[this.pos] === "}") {
      this.pos += 1;
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.pos] !== '"') {
        throw new LosslessJsonError("expected object key string", this.pos);
      }
      const key = this.parseString();
      this.skipWhitespace();
      if (this.text[this.pos] !== ":") {
        throw new LosslessJsonError("expected ':' after object key", this.pos);
      }
      this.pos += 1;
      result[key] = this.parseValue();
      this.skipWhitespace();
      const next = this.text[this.pos];
      if (next === ",") {
        this.pos += 1;
        continue;
      }
      if (next === "}") {
        this.pos += 1;
        return result;
      }
      throw new LosslessJsonError("expected ',' or '}' in object", this.pos);
    }
  }

  /**
   * Parse a JSON array at the current position.
   *
   * @returns The parsed array.
   * @throws LosslessJsonError - On malformed input.
   */
  private parseArray(): JsonValue[] {
    this.pos += 1; // consume '['
    const result: JsonValue[] = [];
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
      throw new LosslessJsonError("expected ',' or ']' in array", this.pos);
    }
  }

  /**
   * Parse a JSON string token at the current position.
   *
   * Escape decoding is delegated to `JSON.parse` on the validated token,
   * which is guaranteed well-formed by the token regex.
   *
   * @returns The decoded string value.
   * @throws LosslessJsonError - On malformed input.
   */
  private parseString(): string {
    STRING_TOKEN.lastIndex = this.pos;
    const match = STRING_TOKEN.exec(this.text);
    if (match === null || match.index !== this.pos) {
      throw new LosslessJsonError("malformed string token", this.pos);
    }
    this.pos = STRING_TOKEN.lastIndex;
    return JSON.parse(match[0]) as string;
  }

  /**
   * Parse a JSON number token at the current position.
   *
   * @returns A {@link JsonNumber} wrapping the verbatim token.
   * @throws LosslessJsonError - On malformed input.
   */
  private parseNumber(): JsonNumber {
    NUMBER_TOKEN.lastIndex = this.pos;
    const match = NUMBER_TOKEN.exec(this.text);
    if (match === null || match.index !== this.pos) {
      throw new LosslessJsonError("malformed number token", this.pos);
    }
    this.pos = NUMBER_TOKEN.lastIndex;
    return new JsonNumber(match[0]);
  }
}
