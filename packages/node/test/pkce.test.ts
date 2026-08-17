// Layer-3 translation of `tests/unit/test_auth_pkce.py` (b8-packets.md
// §4.3 row 1): `TestPkceChallenge` (:25) — all 9 tests. RFC 7636 PKCE
// invariants are runtime-independent; B9 re-uses the RFC rows against
// WebCrypto later (playbook :254-256 — different package, no
// conflict).
//
// Python's `hashlib.sha256` / `base64.urlsafe_b64encode` independent
// recomputation translates to `node:crypto` `createHash` +
// `Buffer.toString("base64url")` — the same independent mini-model
// the source tests use.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { PkceChallenge } from "../src/auth/pkce.js";

/** Base64url alphabet: A-Z, a-z, 0-9, -, _ (no padding =). */
const BASE64URL_NO_PAD_PATTERN = /^[A-Za-z0-9_-]+$/;

describe("TestPkceChallenge (test_auth_pkce.py:25)", () => {
  it("test_verifier_length_is_86_chars", () => {
    // 64 random bytes base64url-encoded without padding -> 86 chars
    // (within the RFC 7636 43-128 range).
    const challenge = PkceChallenge.generate();
    expect(challenge.verifier).toHaveLength(86);
  });

  it("test_verifier_is_base64url_no_pad", () => {
    const challenge = PkceChallenge.generate();
    expect(challenge.verifier).toMatch(BASE64URL_NO_PAD_PATTERN);
    expect(challenge.verifier).not.toContain("=");
  });

  it("test_challenge_is_base64url_no_pad", () => {
    const challenge = PkceChallenge.generate();
    expect(challenge.challenge).toMatch(BASE64URL_NO_PAD_PATTERN);
    expect(challenge.challenge).not.toContain("=");
  });

  it("test_challenge_is_sha256_of_verifier", () => {
    // RFC 7636 §4.2: code_challenge = BASE64URL(SHA256(code_verifier)).
    const challenge = PkceChallenge.generate();
    const digest = createHash("sha256")
      .update(challenge.verifier, "ascii")
      .digest();
    const expected = digest.toString("base64url");
    expect(challenge.challenge).toBe(expected);
  });

  it("test_challenge_computation_is_deterministic", () => {
    const challenge = PkceChallenge.generate();
    const digest1 = createHash("sha256")
      .update(challenge.verifier, "ascii")
      .digest()
      .toString("base64url");
    const digest2 = createHash("sha256")
      .update(challenge.verifier, "ascii")
      .digest()
      .toString("base64url");
    expect(digest1).toBe(digest2);
    expect(digest1).toBe(challenge.challenge);
  });

  it("test_each_generation_produces_different_verifier", () => {
    const verifiers = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      verifiers.add(PkceChallenge.generate().verifier);
    }
    expect(verifiers.size).toBe(10);
  });

  it("test_each_generation_produces_different_challenge", () => {
    const challenges = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      challenges.add(PkceChallenge.generate().challenge);
    }
    expect(challenges.size).toBe(10);
  });

  it("test_challenge_length_is_43_chars", () => {
    // SHA-256 -> 32 bytes -> ceil(32 * 4 / 3) = 43 base64url chars.
    const challenge = PkceChallenge.generate();
    expect(challenge.challenge).toHaveLength(43);
  });

  it("test_verifier_and_challenge_are_strings", () => {
    const challenge = PkceChallenge.generate();
    expect(typeof challenge.verifier).toBe("string");
    expect(typeof challenge.challenge).toBe("string");
  });

  it("RFC 7636 Appendix-B vector (NEW row — b8-packets.md §4.2 PKCE lock)", () => {
    // Not in the Python suite; the packet mandates the vector in
    // Layer-3 (runtime-independent; B9 re-uses it against WebCrypto).
    expect(
      PkceChallenge.challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
