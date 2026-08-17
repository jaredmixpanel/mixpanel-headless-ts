/**
 * PKCE (Proof Key for Code Exchange) challenge generation — TS port of
 * `mixpanel_headless/_internal/auth/pkce.py` (whole file,
 * b8-packets.md §4.1 row 1).
 *
 * Implements RFC 7636 PKCE for the OAuth 2.0 Authorization Code flow
 * over `node:crypto` (sync `createHash` / `randomBytes`, matching
 * Python's sync `generate()` — B9 builds its OWN WebCrypto async twin,
 * packet §4.1: do not pre-abstract).
 *
 * SOURCE-OF-TRUTH NOTE (disclosed, shard notes): the packet §4.2
 * sketch says "verifier = `secrets.token_urlsafe(32)`", but the Python
 * source at HEAD uses `secrets.token_bytes(64)` (`pkce.py:65`) and the
 * Layer-3 suite locks the resulting 86-char verifier — Python is the
 * behavior arbiter, so 64 random bytes it is.
 */

import { createHash, randomBytes } from "node:crypto";

/**
 * Immutable PKCE code verifier and challenge pair (port of the frozen
 * dataclass `PkceChallenge`, `pkce.py:25-73`).
 *
 * The verifier is 86 characters of base64url-encoded random bytes
 * (64 bytes, no padding). The challenge is the base64url-encoded
 * SHA-256 hash of the verifier (43 characters, no padding).
 *
 * @example
 * ```typescript
 * const pkce = PkceChallenge.generate();
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
   * `PkceChallenge.generate`, `pkce.py:46-73`).
   *
   * Creates 64 cryptographically secure random bytes, encodes them as
   * a base64url string (no padding) for the verifier, then computes
   * the SHA-256 hash of the ASCII verifier encoded as base64url (no
   * padding) for the challenge.
   *
   * @returns A new {@link PkceChallenge} with both fields set.
   *
   * @example
   * ```typescript
   * const pkce = PkceChallenge.generate();
   * // 86-char verifier, 43-char challenge
   * ```
   */
  static generate(): PkceChallenge {
    const verifier = randomBytes(64).toString("base64url");
    return new PkceChallenge({
      verifier,
      challenge: PkceChallenge.challengeFor(verifier),
    });
  }

  /**
   * Compute the S256 challenge for a given verifier —
   * `BASE64URL(SHA256(ASCII(verifier)))`, RFC 7636 §4.2 (the inline
   * hash of `pkce.py:68-71`, factored so the Layer-3 RFC 7636
   * Appendix-B vector locks THIS code path per packet §4.2; B9 re-uses
   * the vector rows against its WebCrypto twin).
   *
   * @param verifier - The code verifier text (ASCII).
   * @returns The base64url-encoded challenge (no padding).
   */
  static challengeFor(verifier: string): string {
    return createHash("sha256")
      .update(verifier, "ascii")
      .digest()
      .toString("base64url");
  }
}
