// `buildAuthorizeUrl`, the fetch-pure OAuth HTTP helper hoisted to core
// from the node package (the node suites cover the rest). TS addition: a
// byte-comparison lock — the authorize URL for a fixture exercising the
// `urlencode` vs `URLSearchParams` divergence set (`~`, space, `+`, `/`,
// `:`, non-ASCII) must equal the recorded CPython `urlencode` output.

import { describe, expect, it } from "vitest";

import { OAUTH_BASE_URLS } from "../../src/auth/oauth-constants.js";
import { buildAuthorizeUrl } from "../../src/auth/oauth-http.js";

describe("buildAuthorizeUrl (CPython urlencode golden)", () => {
  it("byte-matches the recorded CPython urlencode output", () => {
    // Golden generated in the Python repo with
    //   uv run python -c "from urllib.parse import urlencode; print(
    //     'https://mixpanel.com/oauth/authorize/?' + urlencode({
    //       'response_type': 'code',
    //       'client_id': 'cli~ent id+x',
    //       'redirect_uri': 'https://app.example.com/cb path/ü:1?x=*',
    //       'state': 'st*ate~/+',
    //       'code_challenge': 'ch/allenge~ =',
    //       'code_challenge_method': 'S256'}))"
    // Output pasted verbatim below (quote_plus rules: `~` bare, space
    // as `+`, `*` percent-encoded, UTF-8 percent runs for non-ASCII).
    const golden =
      "https://mixpanel.com/oauth/authorize/?response_type=code&" +
      "client_id=cli~ent+id%2Bx&" +
      "redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb+path%2F%C3%BC%3A1%3Fx%3D%2A&" +
      "state=st%2Aate~%2F%2B&" +
      "code_challenge=ch%2Fallenge~+%3D&" +
      "code_challenge_method=S256";
    const url = buildAuthorizeUrl(OAUTH_BASE_URLS["us"]!, {
      clientId: "cli~ent id+x",
      redirectUri: "https://app.example.com/cb path/ü:1?x=*",
      challenge: "ch/allenge~ =",
      state: "st*ate~/+",
    });
    expect(url).toBe(golden);
  });

  it("locks param insertion order and the intentional scope omission", () => {
    // `flow.py`: scope is INTENTIONALLY OMITTED — DCR apps have an
    // empty scope field, so the provider defaults to all scopes. Param
    // order is Python dict insertion order.
    const url = buildAuthorizeUrl(OAUTH_BASE_URLS["eu"]!, {
      clientId: "cid",
      redirectUri: "https://app.example.com/cb",
      challenge: "chal",
      state: "st",
    });
    expect(url).toBe(
      "https://eu.mixpanel.com/oauth/authorize/?response_type=code&" +
        "client_id=cid&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb&" +
        "state=st&code_challenge=chal&code_challenge_method=S256",
    );
    expect(url).not.toContain("scope=");
  });
});
