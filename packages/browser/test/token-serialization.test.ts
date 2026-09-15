// Layer-3 suite for the browser store's WRITER shapes (b9-packets.md
// §2.1 R11.9 rule + §2.6 row 2). Python twins for the byte shapes:
// - tokens payload = the tokens_{region}.json twin — `save_tokens`,
//   `storage.py:451-478` (`datetime.isoformat()` → `+00:00`, never `Z`);
// - client-info payload = the client_{region}.json twin —
//   `save_client_info`, `storage.py:526-543` (pydantic JSON mode → `Z`).
// Byte-parity goldens copied WITH CITE from the B8 probe/golden set
// (`b8-reviewB-resolution.md` F2 table: saveTokens renders `+00:00`
// even from a `Z`-spelled model; saveClientInfo renders `Z` even from
// a `+00:00` model; live pydantic probe `2030-01-01T00:00:00Z` /
// `...00.500000Z`).
// Reads are STRICT (`parseOAuthTokens` / `parseOAuthClientInfo`) — the
// round-trip locks make the store's closed write→read loop explicit.

import { describe, expect, it } from "vitest";

import {
  type OAuthClientInfo,
  OAuthTokens,
  parseOAuthClientInfo,
  parseOAuthTokens,
  Secret,
} from "@mixpanel-headless/core";

import {
  serializeClientInfoPayload,
  serializeTokensPayload,
} from "../src/index.js";

/**
 * Build a token set for the writer tests.
 *
 * @param expiresAt - The `expires_at` text under test.
 * @param refreshToken - Optional refresh token value.
 * @returns The token set.
 */
function makeTokens(
  expiresAt: string,
  refreshToken: string | null = null,
): OAuthTokens {
  return new OAuthTokens({
    access_token: new Secret("access-abc"),
    refresh_token: refreshToken === null ? null : new Secret(refreshToken),
    expires_at: expiresAt,
    scope: "projects analysis",
    token_type: "Bearer",
  });
}

/** A client-info fixture with a `+00:00`-spelled `created_at`. */
const CLIENT_INFO: OAuthClientInfo = {
  client_id: "client-123",
  region: "us",
  redirect_uri: "https://app.example.com/oauth/callback",
  scope: "projects analysis",
  created_at: "2030-01-01T00:00:00+00:00",
};

describe("serializeTokensPayload — tokens.json writer twin (storage.py:451-478)", () => {
  it("renders expires_at with +00:00 (never Z) — B8 golden: +00:00 from a Z model", () => {
    const payload = serializeTokensPayload(makeTokens("2030-01-01T00:00:00Z"));
    expect(payload).toContain('"expires_at": "2030-01-01T00:00:00+00:00"');
    expect(payload).not.toContain('"2030-01-01T00:00:00Z"');
  });

  it("keeps a +00:00 model verbatim (b8-reviewB-resolution.md probe: 2030-01-01T00:00:00+00:00)", () => {
    const payload = serializeTokensPayload(
      makeTokens("2030-01-01T00:00:00+00:00"),
    );
    expect(payload).toContain('"expires_at": "2030-01-01T00:00:00+00:00"');
  });

  it("renders millisecond fractions with six digits (pythonUtcIsoformat shape)", () => {
    const payload = serializeTokensPayload(
      makeTokens("2030-01-01T00:00:00.500000+00:00"),
    );
    expect(payload).toContain(
      '"expires_at": "2030-01-01T00:00:00.500000+00:00"',
    );
  });

  it("omits refresh_token when null; includes it when present (save_tokens key set)", () => {
    const withoutRefresh = JSON.parse(
      serializeTokensPayload(makeTokens("2030-01-01T00:00:00+00:00")),
    ) as Record<string, unknown>;
    expect(Object.keys(withoutRefresh)).toStrictEqual([
      "access_token",
      "expires_at",
      "scope",
      "token_type",
    ]);
    const withRefresh = JSON.parse(
      serializeTokensPayload(
        makeTokens("2030-01-01T00:00:00+00:00", "refresh-xyz"),
      ),
    ) as Record<string, unknown>;
    expect(withRefresh["refresh_token"]).toBe("refresh-xyz");
  });

  it("reveals secrets explicitly (designated reveal site — no masked text in payload)", () => {
    const payload = serializeTokensPayload(
      makeTokens("2030-01-01T00:00:00+00:00", "refresh-xyz"),
    );
    expect(payload).toContain('"access_token": "access-abc"');
    expect(payload).not.toContain("**");
  });

  it("strict-read round-trip through parseOAuthTokens (closed-loop lock)", () => {
    const tokens = makeTokens("2030-01-01T00:00:00Z", "refresh-xyz");
    const parsed = parseOAuthTokens(JSON.parse(serializeTokensPayload(tokens)));
    expect(parsed.access_token.reveal()).toBe("access-abc");
    expect(parsed.refresh_token?.reveal()).toBe("refresh-xyz");
    expect(parsed.expires_at).toBe("2030-01-01T00:00:00+00:00");
    expect(parsed.scope).toBe("projects analysis");
    expect(parsed.token_type).toBe("Bearer");
  });
});

describe("serializeClientInfoPayload — client_{region}.json writer twin (storage.py:526-543)", () => {
  it("renders created_at with Z — B8 golden: Z from a +00:00 model", () => {
    const payload = serializeClientInfoPayload(CLIENT_INFO);
    expect(payload).toContain('"created_at": "2030-01-01T00:00:00Z"');
  });

  it("renders millisecond fractions with six digits then Z (live pydantic probe ...00.500000Z)", () => {
    const payload = serializeClientInfoPayload({
      ...CLIENT_INFO,
      created_at: "2030-01-01T00:00:00.500000+00:00",
    });
    expect(payload).toContain('"created_at": "2030-01-01T00:00:00.500000Z"');
  });

  it("strict-read round-trip through parseOAuthClientInfo (closed-loop lock)", () => {
    const parsed = parseOAuthClientInfo(
      JSON.parse(serializeClientInfoPayload(CLIENT_INFO)),
    );
    expect(parsed.client_id).toBe("client-123");
    expect(parsed.region).toBe("us");
    expect(parsed.redirect_uri).toBe("https://app.example.com/oauth/callback");
    expect(parsed.scope).toBe("projects analysis");
    expect(parsed.created_at).toBe("2030-01-01T00:00:00Z");
  });

  it("full key set matches save_client_info (client_id, region, redirect_uri, scope, created_at)", () => {
    const record = JSON.parse(
      serializeClientInfoPayload(CLIENT_INFO),
    ) as Record<string, unknown>;
    expect(Object.keys(record)).toStrictEqual([
      "client_id",
      "region",
      "redirect_uri",
      "scope",
      "created_at",
    ]);
  });
});
