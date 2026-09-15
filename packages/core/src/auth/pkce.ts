/**
 * PKCE (Proof Key for Code Exchange) challenge generation — TS port of
 * `mixpanel_headless/_internal/auth/pkce.py` (whole file), homed in
 * `packages/core` per plan §4.1 ("core/auth … PKCE primitives
 * (WebCrypto)") and the b9-packets.md §1 placement RULING: ONE
 * WebCrypto implementation reused by BOTH `packages/node` (re-export,
 * §1.3) and `packages/browser` — R10.8: shared internals ported once,
 * by name. The B8 `node:crypto` implementation is retired in the same
 * commit.
 *
 * R9.1-legal: core may touch the `crypto` global (`crypto.subtle` /
 * `getRandomValues` — WebCrypto is global in every supported runtime;
 * root `engines.node: ">=20"` pins it on the node side).
 *
 * Sync→async note (§1.1): `crypto.subtle.digest` is Promise-returning,
 * so `generate` / `challengeFor` are async where Python's are sync
 * (`pkce.py`). Python has no observable-ordering contract around
 * generation (it happens before any I/O in `login`, `flow.py`
 * region), so the asyncification is behavior-preserving at every
 * observation point.
 *
 * SOURCE-OF-TRUTH NOTE (carried from the B8 header, disclosed): the B8
 * packet §4.2 sketch said "verifier = `secrets.token_urlsafe(32)`",
 * but the Python source at HEAD uses `secrets.token_bytes(64)`
 * (`pkce.py`) and the Layer-3 suite locks the resulting 86-char
 * verifier — Python is the behavior arbiter, so 64 random bytes it is.
 */

import { OAuthError } from "../errors.js";

/**
 * The RFC 4648 §5 base64url alphabet (`-`/`_`, no `+`/`/`). The core
 * `base64EncodeUtf8` (`account.ts`) is TEXT→base64 over the STANDARD
 * alphabet — not reusable for bytes→base64url (b9-packets.md §1.2
 * watchlist: a wrong-alphabet encode still yields 86/43-char strings;
 * the RFC 7636 Appendix-B vector is the lock that catches it).
 */
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Encode arbitrary bytes as base64url WITHOUT padding (the
 * `base64.urlsafe_b64encode(...).rstrip("=")` twin, `pkce.py:66,71`).
 *
 * Pure table walk — no `Buffer` (core purity, R9.1), no `btoa`
 * (byte-safe for all 0-255 values by construction).
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
 * Immutable PKCE code verifier and challenge pair (port of the frozen
 * dataclass `PkceChallenge`, `pkce.py`).
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
   * Generate a new PKCE verifier/challenge pair (port of
   * `PkceChallenge.generate`, `pkce.py`).
   *
   * Creates 64 cryptographically secure random bytes
   * (`crypto.getRandomValues` — the `secrets.token_bytes(64)` twin,
   * `pkce.py`), encodes them as a base64url string (no padding) for
   * the verifier (`pkce.py`), then computes the SHA-256 hash of the
   * ASCII verifier encoded as base64url (no padding) for the challenge.
   *
   * @returns A new {@link PkceChallenge} with both fields set.
   * @example
   * ```typescript
   * const pkce = await PkceChallenge.generate();
   * // 86-char verifier, 43-char challenge
   * ```
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
   * hash of `pkce.py`, factored so the Layer-3 RFC 7636
   * Appendix-B vector locks THIS code path).
   *
   * The verifier is ASCII by construction (base64url alphabet ⊂
   * ASCII), so `TextEncoder` UTF-8 output equals Python's
   * `verifier.encode("ascii")`.
   *
   * @param verifier - The code verifier text (ASCII).
   * @returns The base64url-encoded challenge (no padding).
   */
  static async challengeFor(verifier: string): Promise<string> {
    // Pair-B FB-10 (`b9-reviewB-resolution.md`): in an insecure
    // browser context (any http:// origin other than localhost)
    // `crypto.getRandomValues` exists but `crypto.subtle` is
    // UNDEFINED — fail with a coded error (R5) instead of a bare
    // TypeError. Browser-environmental branch with no Python twin
    // (hashlib is always available); R9.3 arbitrated.
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
