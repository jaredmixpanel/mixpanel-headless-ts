// PKCE through the browser entry point: the RFC 7636 Appendix B vector and
// the 86/43 length locks over the re-export chain. The exhaustive suite
// lives once, in packages/node/test/pkce.test.ts.

import { describe, expect, it } from "vitest";

import { PkceChallenge } from "../src/index.js";

describe("PkceChallenge via the browser entry point", () => {
  it("reproduces the RFC 7636 Appendix-B S256 vector", async () => {
    const challenge = await PkceChallenge.challengeFor(
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    );
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("generates the 86-char verifier / 43-char challenge production shape", async () => {
    const pkce = await PkceChallenge.generate();
    expect(pkce.verifier).toHaveLength(86);
    expect(pkce.challenge).toHaveLength(43);
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
