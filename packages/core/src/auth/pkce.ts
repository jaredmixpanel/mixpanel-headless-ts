/**
 * PKCE (Proof Key for Code Exchange, RFC 7636) verifier/challenge
 * generation over WebCrypto — one implementation shared by
 * `@mixpanel-headless/node` and `@mixpanel-headless/browser`. `crypto`
 * is a global in every supported runtime, so this is the one place
 * `core` touches it. `crypto.subtle.digest` returns a Promise, so
 * `generate` / `challengeFor` are async where Python's are sync;
 * generation happens before any I/O in `login`, so no observable
 * ordering changes.
 *
 * @see mixpanel_headless._internal.auth.pkce.PkceChallenge
 */

import { OAuthError } from "../errors.js";

/**
 * The RFC 4648 §5 base64url alphabet (`-`/`_`, no `+`/`/`). The core
 * `base64EncodeUtf8` (`account.ts`) is text→base64 over the standard
 * alphabet and cannot be reused for bytes→base64url: a wrong-alphabet
 * encode still yields 86/43-char strings, and only the RFC 7636
 * Appendix B test vector catches it.
 */
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Encode arbitrary bytes as base64url without padding (the
 * `base64.urlsafe_b64encode(...).rstrip("=")` twin).
 *
 * Pure table walk — no `Buffer` (core purity), no `btoa` (byte-safe for
 * all 0-255 values by construction).
 *
 * @param bytes - The bytes to encode.
 * @returns Base64url text, `=`-padding stripped.
 * @example
 * ```typescript
 * base64UrlEncodeBytes(new Uint8Array([0xff, 0xef]));
 * // "_-8"
 * ```
 */
export function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = i + 1 < bytes.length ? (bytes[i + 1] as number) : null;
    const b2 = i + 2 < bytes.length ? (bytes[i + 2] as number) : null;
    out += BASE64URL_ALPHABET[b0 >> 2] as string;
    out += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)] as string;
    if (b1 !== null) {
      out += BASE64URL_ALPHABET[
        ((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)
      ] as string;
    }
    if (b2 !== null) {
      out += BASE64URL_ALPHABET[b2 & 0x3f] as string;
    }
  }
  return out;
}

/**
 * Immutable PKCE code verifier and challenge pair (the frozen dataclass
 * `PkceChallenge`).
 *
 * The verifier is 86 characters of base64url-encoded random bytes
 * (64 bytes, no padding). The challenge is the base64url-encoded
 * SHA-256 hash of the verifier (43 characters, no padding).
 *
 * @example
 * ```typescript
 * const pkce = await PkceChallenge.generate();
 * // pkce.verifier.length === 86; pkce.challenge.length === 43
 * ```
 * @see mixpanel_headless._internal.auth.pkce.PkceChallenge
 */
export class PkceChallenge {
  /** Base64url-encoded code verifier (86 chars, no padding). */
  readonly verifier: string;

  /** Base64url-encoded SHA-256 hash of the verifier (43 chars, no padding). */
  readonly challenge: string;

  /**
   * Construct a challenge pair (frozen — the dataclass `frozen=True`
   * twin; strict-mode mutation throws `TypeError`).
   *
   * @param fields - The verifier/challenge pair.
   */
  constructor(fields: {
    readonly verifier: string;
    readonly challenge: string;
  }) {
    this.verifier = fields.verifier;
    this.challenge = fields.challenge;
    Object.freeze(this);
  }

  /**
   * Generate a new PKCE verifier/challenge pair.
   *
   * Creates 64 cryptographically secure random bytes
   * (`crypto.getRandomValues`, the `secrets.token_bytes(64)` twin),
   * encodes them as a base64url string (no padding) for the verifier,
   * then computes the SHA-256 hash of the ASCII verifier encoded as
   * base64url (no padding) for the challenge.
   *
   * @returns A new {@link PkceChallenge} with both fields set.
   * @example
   * ```typescript
   * const pkce = await PkceChallenge.generate();
   * // 86-char verifier, 43-char challenge
   * ```
   * @see mixpanel_headless._internal.auth.pkce.PkceChallenge.generate
   */
  static async generate(): Promise<PkceChallenge> {
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    const verifier = base64UrlEncodeBytes(bytes);
    return new PkceChallenge({
      verifier,
      challenge: await PkceChallenge.challengeFor(verifier),
    });
  }

  /**
   * Compute the S256 challenge for a given verifier —
   * `BASE64URL(SHA256(ASCII(verifier)))`, RFC 7636 §4.2 (the inline
   * hash in Python's `generate`, factored out so the RFC 7636
   * Appendix B test vector exercises exactly this code path).
   *
   * The verifier is ASCII by construction (base64url alphabet ⊂
   * ASCII), so `TextEncoder` UTF-8 output equals Python's
   * `verifier.encode("ascii")`.
   *
   * @param verifier - The code verifier text (ASCII).
   * @returns The base64url-encoded challenge (no padding).
   */
  static async challengeFor(verifier: string): Promise<string> {
    // In an insecure browser context (any http:// origin other than
    // localhost) `crypto.getRandomValues` exists but `crypto.subtle` is
    // undefined — fail with a coded error instead of a bare TypeError.
    // Browser-environmental branch with no Python twin (hashlib is
    // always available).
    const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
    if (subtle === undefined) {
      throw new OAuthError(
        "WebCrypto SubtleCrypto is unavailable — PKCE requires a secure " +
          "context (https or localhost) in browsers, or Node >= 20.",
        "OAUTH_CONFIG_ERROR",
        { seam: "crypto.subtle" },
      );
    }
    const ascii = new TextEncoder().encode(verifier);
    const digest = await subtle.digest("SHA-256", ascii);
    return base64UrlEncodeBytes(new Uint8Array(digest));
  }
}
