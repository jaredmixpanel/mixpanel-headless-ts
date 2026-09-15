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

import { setOwn } from "../compat/python-dict.js";

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
 * Non-enumerable sidecar recording an object's SOURCE key order where
 * it differs from JS enumeration order (B8-MAPFIX, user ratification
 * `user-ratifications.md:14-22`).
 *
 * JS plain objects enumerate integer-like keys in ascending numeric
 * order regardless of insertion order, while Python `json.loads`
 * preserves source order — the mechanism behind playbook Discrepancies
 * #9/#10/#13. The lossless parser attaches this symbol (holding
 * `readonly string[]`) to any parsed object whose source key order the
 * plain object cannot represent; {@link orderedKeys} /
 * {@link orderedEntries} read it back. Being non-enumerable, the
 * sidecar is invisible to `Object.keys` / `JSON.stringify` / spread.
 */
export const LOSSLESS_KEY_ORDER: unique symbol = Symbol("losslessKeyOrder");

/** An object possibly carrying the {@link LOSSLESS_KEY_ORDER} sidecar. */
interface KeyOrdered {
  /** Source key order, when the plain object cannot represent it. */
  readonly [LOSSLESS_KEY_ORDER]?: readonly string[];
}

/**
 * Attach the source-key-order sidecar to a parsed object.
 *
 * @param target - The freshly built object (mutated in place).
 * @param keys - The source key order (first occurrence wins for
 *   duplicate keys, matching Python dict position semantics).
 */
export function attachKeyOrder(target: object, keys: readonly string[]): void {
  Object.defineProperty(target, LOSSLESS_KEY_ORDER, {
    value: keys,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/**
 * An object's keys in SOURCE order: the {@link LOSSLESS_KEY_ORDER}
 * sidecar when present, else `Object.keys` (which already equals
 * source order for objects without out-of-order integer-like keys).
 *
 * @param value - Any plain object (parsed or hand-built).
 * @returns The keys in Python-dict order.
 */
export function orderedKeys(value: object): readonly string[] {
  const sidecar = (value as KeyOrdered)[LOSSLESS_KEY_ORDER];
  return sidecar ?? Object.keys(value);
}

/**
 * `Object.entries` in SOURCE order (see {@link orderedKeys}).
 *
 * @param value - Any plain object (parsed or hand-built).
 * @returns `[key, value]` pairs in Python-dict order.
 */
export function orderedEntries(
  value: Readonly<Record<string, unknown>>,
): Array<[string, unknown]> {
  return orderedKeys(value).map((key) => [key, value[key]]);
}

/** Options of {@link toNativeJson}. */
export interface ToNativeJsonOptions {
  /**
   * What an integer token above the safe-integer range becomes:
   * `"round"` (default) — the correctly-rounded double, `"bigint"` — the
   * exact `bigint`.
   */
  readonly unsafeIntegers?: "round" | "bigint" | undefined;
}

/**
 * Convert a lossless-parsed JSON tree to NATIVE JS values — the point
 * where the TS wire layer matches Python's `json.loads` product
 * (`int`/`float` → `number`, containers recursing).
 *
 * Used by response-model validation paths (`list_workspaces`), where the
 * Pydantic-lax coercion mirror consumes native scalars. Two documented
 * narrowings (R4.5 numbers policy): by default integer tokens beyond
 * 2^53−1 double-round (Python keeps the exact int), and float-ness of
 * integral tokens is erased (`42.0` → `42`; Pydantic-lax accepts both
 * identically at every consuming field).
 *
 * The first narrowing is opt-out: `unsafeIntegers: "bigint"` maps an
 * integer token whose exact value is not a safe integer to a `bigint`
 * instead (safe integers and float tokens still become `number`). The
 * lookup-table members use it because Mixpanel's `data_group_id`s are
 * negative int64s (`-8644926364725811123`) that a double would round.
 *
 * @param value - The parsed tree ({@link JsonNumber} tokens intact); typed
 *   `unknown` because the facade layer receives client payloads untyped.
 * @param options - `unsafeIntegers`: `"round"` (default) or `"bigint"`.
 * @returns The native-valued tree.
 */
export function toNativeJson(
  value: unknown,
  options: ToNativeJsonOptions = {},
): unknown {
  if (value instanceof JsonNumber) {
    if (
      options.unsafeIntegers === "bigint" &&
      value.isIntegerToken() &&
      !Number.isSafeInteger(value.toNumber())
    ) {
      // Safe-range test, not `isUnsafeInteger()`: ±2^53 itself is
      // representable yet not safe, and `coerceInt64` narrows on the
      // same boundary so the two agree.
      return BigInt(value.raw);
    }
    return value.toNumber();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toNativeJson(item, options));
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      setOwn(out, key, toNativeJson(member, options));
    }
    // Key-order sidecar propagates (B8-MAPFIX): the native tree feeds
    // the ordered-dict model fields (`MeResponse`), which must see the
    // SOURCE order the parser captured.
    const sidecar = (value as KeyOrdered)[LOSSLESS_KEY_ORDER];
    if (sidecar !== undefined) {
      attachKeyOrder(out, sidecar);
    }
    return out;
  }
  return value;
}
