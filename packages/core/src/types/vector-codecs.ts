/**
 * Contract-layer `$type` tag codecs (phase2-design C7 item 1).
 *
 * One {@link ContractTagCodec} entry per Phase-2 rich tag: `decode`
 * reconstructs the REAL core instance through its constructor/factory
 * (guards FIRE on decode — a vector carrying an invalid payload is a
 * vector bug and must fail loudly, mirroring Python's
 * `_decode_dataclass`/`_decode_model`), and `encode` performs the
 * field-level walk of Python `_encode_common(tagged_models=True)`: ALL
 * declared fields, `$type` first, `null` for Python `None`.
 *
 * The table is wired into the conformance runner by
 * `conformance-runner/src/bindings.ts::registerContractCodecs` — this
 * module stays free of runner imports (dependency direction: runner ->
 * core, never the reverse), so the child-codec callbacks are typed
 * structurally (`unknown`) and datetime children are duck-typed on their
 * `iso` field rather than on the runner's `PyDatetime` class.
 *
 * P2-4 seeds the table with `OAuthTokens` (the one auth-model corpus
 * tag); P2-5a..c, P2-6, and P2-7 extend it with the query-param, result,
 * and entity tags.
 *
 * @internal Exported for the conformance binding — NOT part of the
 * public package surface (excluded from the barrel).
 */

import { parseOAuthTokens, OAuthTokens } from "../auth/token.js";
import { Secret } from "../secret.js";

/**
 * One registered rich-tag codec (phase2-design C7 `TagCodec`).
 *
 * @internal
 */
export interface ContractTagCodec {
  /**
   * Reconstruct the real core instance from a tagged payload.
   *
   * @param payload - The tagged object (`$type` included).
   * @param decodeChild - Recursive decoder for nested field values.
   * @returns The reconstructed instance.
   */
  readonly decode: (
    payload: Readonly<Record<string, unknown>>,
    decodeChild: (value: unknown) => unknown,
  ) => unknown;

  /**
   * Anti-vacuity probe + encode-dispatch predicate: whether a live value
   * is an instance of this tag's core class (C8a — a decode-to-plain-
   * object codec must be impossible to register).
   *
   * @param value - A live TS value.
   * @returns True when {@link encode} can serialize it.
   */
  readonly matches: (value: unknown) => boolean;

  /**
   * Serialize a core instance back to its tagged vector-JSON shape.
   *
   * @param instance - A value for which {@link matches} returned true.
   * @param encodeChild - Recursive encoder for nested field values.
   * @returns The tagged object (`$type` first, all declared fields).
   */
  readonly encode: (
    instance: unknown,
    encodeChild: (value: unknown) => unknown,
  ) => Readonly<Record<string, unknown>>;
}

/**
 * Extract the ISO text from a decoded datetime child.
 *
 * The runner decodes `$type: datetime` payloads to its lossless
 * `PyDatetime` wrapper (an object with a string `iso` field); this module
 * cannot import that class, so it duck-types the shape. A raw string
 * passes through (already-decoded callers).
 *
 * @param value - The decoded child value.
 * @param field - Field name for error messages.
 * @returns The ISO-8601 text.
 * @throws Error - When the value is neither an iso-carrying object nor a
 *   string (a malformed vector payload — must fail loudly).
 */
function requireIsoText(value: unknown, field: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "iso" in value &&
    typeof (value as { iso: unknown }).iso === "string"
  ) {
    return (value as { iso: string }).iso;
  }
  throw new Error(
    `OAuthTokens.${field} must decode to a datetime (got ${typeof value})`,
  );
}

/**
 * Reject payload keys outside the declared field set (mirror of Python
 * `_decode_model`'s unknown-field guard — the CODEC is strict even where
 * the Pydantic model ignores extras).
 *
 * @param payload - The tagged payload.
 * @param fields - Declared field names (without `$type`).
 * @param tag - The `$type` name for error messages.
 * @throws Error - When unknown fields are present.
 */
function rejectUnknownFields(
  payload: Readonly<Record<string, unknown>>,
  fields: ReadonlySet<string>,
  tag: string,
): void {
  const extra = Object.keys(payload)
    .filter((key) => key !== "$type" && !fields.has(key))
    .sort();
  if (extra.length > 0) {
    throw new Error(`unknown fields ${JSON.stringify(extra)} for $type ${tag}`);
  }
}

/** Declared `OAuthTokens` fields, in Python `model_fields` order. */
const OAUTH_TOKENS_FIELDS: readonly string[] = [
  "access_token",
  "refresh_token",
  "expires_at",
  "scope",
  "token_type",
];

/** The `OAuthTokens` tag codec (phase2-design C4/C7). */
const oauthTokensCodec: ContractTagCodec = {
  decode: (payload, decodeChild) => {
    rejectUnknownFields(payload, new Set(OAUTH_TOKENS_FIELDS), "OAuthTokens");
    const decoded: Record<string, unknown> = {};
    for (const field of OAUTH_TOKENS_FIELDS) {
      if (Object.hasOwn(payload, field)) {
        decoded[field] = decodeChild(payload[field]);
      }
    }
    if (Object.hasOwn(decoded, "expires_at")) {
      decoded["expires_at"] = requireIsoText(
        decoded["expires_at"],
        "expires_at",
      );
    }
    return parseOAuthTokens(decoded);
  },
  matches: (value) => value instanceof OAuthTokens,
  encode: (instance, encodeChild) => {
    const tokens = instance as OAuthTokens;
    // Field-level walk, ALL declared fields, $type first (mirror of
    // Python `_encode_common(tagged_models=True)`): `refresh_token`
    // emits `null` when unset, `expires_at` re-tags the preserved iso
    // text byte-for-byte.
    return {
      $type: "OAuthTokens",
      access_token: encodeChild(tokens.access_token),
      refresh_token:
        tokens.refresh_token === null
          ? null
          : encodeChild(tokens.refresh_token),
      expires_at: { $type: "datetime", iso: tokens.expires_at },
      scope: tokens.scope,
      token_type: tokens.token_type,
    };
  },
};

/**
 * The Phase-2 contract tag-codec table, keyed by `$type` name.
 *
 * @internal
 */
export const CONTRACT_TAG_CODECS: ReadonlyMap<string, ContractTagCodec> =
  new Map([["OAuthTokens", oauthTokensCodec]]);

// Re-exported so the runner's SecretStr built-in swap and the codec-sweep
// anti-vacuity probes have a single import site alongside the table.
export { OAuthTokens, Secret };
