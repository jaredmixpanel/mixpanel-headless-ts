// B9-R2 (b9-packets.md §1.3 item 4 / §3.5.2): re-run of the PKCE RFC
// 7636 Appendix-B vector + the 86/43 length locks THROUGH THE BROWSER
// ENTRY POINT (`packages/browser/src/index.ts`) — locks the re-export
// chain per the B8 outbound row "PKCE RFC 7636 vector rows re-translate
// against WebCrypto". The exhaustive 10-assertion suite lives once, at
// the core-owned node path (`packages/node/test/pkce.test.ts` —
// single implementation ⇒ single exhaustive lock, R10.8).

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
