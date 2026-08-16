/**
 * JSON value model shared by the lossless JSON loader and the D6
 * canonicalizer.
 *
 * D6 rule 3 defines canonical number rendering over the RAW JSON NUMBER
 * TOKEN, not a parsed double: `18` and `18.0` are distinct contracts, and
 * integer tokens above 2^53 must survive loading without silent rounding.
 * Plain `JSON.parse` destroys both distinctions, so vector/selftest JSON is
 * loaded into this model instead, with every number captured as a
 * {@link JsonNumber} wrapping its verbatim source token.
 */

/** Matches a syntactically valid RFC 8259 JSON number token. */
const JSON_NUMBER_TOKEN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * A JSON number captured as its raw source token.
 *
 * Preserves the integer-vs-float distinction (`18` vs `18.0`) and the exact
 * digits of integers too large for a JS double, both of which D6 rule 3 and
 * the `PRECISION_LOSS` verdict (D6/D12) require.
 */
export class JsonNumber {
  /** The verbatim number token as it appeared in the JSON source. */
  readonly raw: string;

  /**
   * Wrap a raw JSON number token.
   *
   * @param raw - The verbatim token text (e.g. `"18"`, `"18.0"`, `"1e-7"`).
   * @throws Error - If `raw` is not a valid JSON number token.
   */
  constructor(raw: string) {
    if (!JSON_NUMBER_TOKEN.test(raw)) {
      throw new Error(`invalid JSON number token: ${JSON.stringify(raw)}`);
    }
    this.raw = raw;
  }

  /**
   * Whether the token is an integer token (no fraction or exponent part).
   *
   * D6 rule 3: integer tokens render without exponent or fraction; tokens
   * with a fraction/exponent part render via float rendering even when
   * their value is integral.
   *
   * @returns `true` for tokens like `"18"`; `false` for `"18.0"`, `"1e2"`.
   */
  isIntegerToken(): boolean {
    return !/[.eE]/.test(this.raw);
  }

  /**
   * The token's value as a JS double (correctly rounded, possibly lossy).
   *
   * @returns The result of ECMAScript `Number(raw)`.
   */
  toNumber(): number {
    return Number(this.raw);
  }

  /**
   * Whether this is an integer token whose value cannot be represented
   * exactly as a JS double (magnitude above 2^53).
   *
   * This is the loader-side signal behind the `PRECISION_LOSS` verdict
   * (D6): with plain `JSON.parse` the check would be vacuous.
   *
   * @returns `true` when the integer token's exact value differs from its
   *   double rounding; always `false` for float tokens.
   */
  isUnsafeInteger(): boolean {
    if (!this.isIntegerToken()) {
      return false;
    }
    const exact = BigInt(this.raw);
    const asDouble = this.toNumber();
    if (!Number.isFinite(asDouble)) {
      return true;
    }
    return BigInt(asDouble) !== exact;
  }
}

/**
 * A JSON-like value as consumed by the canonicalizer.
 *
 * Numbers may appear either as {@link JsonNumber} raw tokens (values loaded
 * from vector/selftest JSON) or as native `number`/`bigint` values (live
 * outputs produced by the TS library under test).
 */
export type JsonValue =
  | null
  | boolean
  | string
  | number
  | bigint
  | JsonNumber
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Convert a lossless-parsed JSON tree to NATIVE JS values — the point
 * where the TS wire layer matches Python's `json.loads` product
 * (`int`/`float` → `number`, containers recursing).
 *
 * Used by response-model validation paths (`list_workspaces`), where the
 * Pydantic-lax coercion mirror consumes native scalars. Two documented
 * narrowings (R4.5 numbers policy): integer tokens beyond 2^53−1
 * double-round (Python keeps the exact int — no modeled endpoint emits
 * such ids), and float-ness of integral tokens is erased (`42.0` → `42`;
 * Pydantic-lax accepts both identically at every consuming field).
 *
 * @param value - The parsed tree ({@link JsonNumber} tokens intact).
 * @returns The native-valued tree.
 */
export function toNativeJson(value: JsonValue): unknown {
  if (value instanceof JsonNumber) {
    return value.toNumber();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toNativeJson(item));
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      out[key] = toNativeJson(member);
    }
    return out;
  }
  return value;
}
