// PkceChallenge (RFC 7636). Mirrors tests/unit/test_auth_pkce.py, awaiting
// the WebCrypto-backed core implementation the node entry re-exports; the
// SHA-256 recomputation goes through node:crypto so the check is
// implementation-independent. Additive: the RFC 7636 Appendix B vector and
// the missing-`crypto.subtle` rejection.

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { PkceChallenge } from "@mixpanel-headless/core";

/** Base64url alphabet: A-Z, a-z, 0-9, -, _ (no padding =). */
const BASE64URL_NO_PAD_PATTERN = /^[A-Za-z0-9_-]+$/;

describe("PkceChallenge", () => {
  // python: test_auth_pkce.py::TestPkceChallenge
  it("verifier is 86 characters", async () => {
    // python: test_verifier_length_is_86_chars
    // 64 random bytes base64url-encoded without padding -> 86 chars
    // (within the RFC 7636 43-128 range).
    const challenge = await PkceChallenge.generate();
    expect(challenge.verifier).toHaveLength(86);
  });

  it("verifier is unpadded base64url", async () => {
    // python: test_verifier_is_base64url_no_pad
    const challenge = await PkceChallenge.generate();
    expect(challenge.verifier).toMatch(BASE64URL_NO_PAD_PATTERN);
    expect(challenge.verifier).not.toContain("=");
  });

  it("challenge is unpadded base64url", async () => {
    // python: test_challenge_is_base64url_no_pad
    const challenge = await PkceChallenge.generate();
    expect(challenge.challenge).toMatch(BASE64URL_NO_PAD_PATTERN);
    expect(challenge.challenge).not.toContain("=");
  });

  it("challenge is the base64url SHA-256 of the verifier", async () => {
    // python: test_challenge_is_sha256_of_verifier
    // RFC 7636 §4.2: code_challenge = BASE64URL(SHA256(code_verifier)).
    const challenge = await PkceChallenge.generate();
    const digest = createHash("sha256")
      .update(challenge.verifier, "ascii")
      .digest();
    const expected = digest.toString("base64url");
    expect(challenge.challenge).toBe(expected);
  });

  it("challenge computation is deterministic", async () => {
    // python: test_challenge_computation_is_deterministic
    const challenge = await PkceChallenge.generate();
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

  it("each generation produces a different verifier", async () => {
    // python: test_each_generation_produces_different_verifier
    const verifiers = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      verifiers.add((await PkceChallenge.generate()).verifier);
    }
    expect(verifiers.size).toBe(10);
  });

  it("each generation produces a different challenge", async () => {
    // python: test_each_generation_produces_different_challenge
    const challenges = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      challenges.add((await PkceChallenge.generate()).challenge);
    }
    expect(challenges.size).toBe(10);
  });

  it("challenge is 43 characters", async () => {
    // python: test_challenge_length_is_43_chars
    // SHA-256 -> 32 bytes -> ceil(32 * 4 / 3) = 43 base64url chars.
    const challenge = await PkceChallenge.generate();
    expect(challenge.challenge).toHaveLength(43);
  });

  it("verifier and challenge are strings", async () => {
    // python: test_verifier_and_challenge_are_strings
    const challenge = await PkceChallenge.generate();
    expect(typeof challenge.verifier).toBe("string");
    expect(typeof challenge.challenge).toBe("string");
  });

  it("matches the RFC 7636 Appendix B vector", async () => {
    // Not in the Python suite: the only lock that catches a wrong-alphabet
    // base64 encode.
    await expect(
      PkceChallenge.challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("rejects with coded OAUTH_CONFIG_ERROR when crypto.subtle is missing", async () => {
    // In an insecure browser context (http:// non-localhost)
    // `crypto.getRandomValues` exists but `crypto.subtle` is undefined —
    // the flow must not die with a bare uncoded TypeError.
    const original = crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: original.getRandomValues.bind(original),
    });
    try {
      await expect(
        PkceChallenge.challengeFor(
          "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
        ),
      ).rejects.toMatchObject({ code: "OAUTH_CONFIG_ERROR" });
      await expect(PkceChallenge.generate()).rejects.toMatchObject({
        code: "OAUTH_CONFIG_ERROR",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
