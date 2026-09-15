// OAuthTokens / OAuthClientInfo: parse factories, the tz-aware expiry
// validator, the 30-second expiry buffer and `fromTokenResponse`. TS unit
// tests over `token.py`'s documented behaviour; no Python suite is mirrored.

import { describe, expect, it } from "vitest";

import {
  OAuthTokens,
  parseOAuthClientInfo,
  parseOAuthTokens,
} from "../../src/auth/token.js";
import {
  ParamValidationError,
  ResponseValidationError,
} from "../../src/errors.js";
import { Secret } from "../../src/secret.js";

/** A valid corpus-shaped token payload (auth/test_auth_flow vectors). */
const TOKENS_PAYLOAD = {
  access_token: "expired-access",
  refresh_token: "valid-refresh",
  expires_at: "2026-01-15T11:00:00+00:00",
  scope: "projects analysis",
  token_type: "Bearer",
} as const;

describe("parseOAuthTokens", () => {
  it("parses the corpus shape, wrapping secrets and keeping iso text", () => {
    const tokens = parseOAuthTokens(TOKENS_PAYLOAD);
    expect(tokens).toBeInstanceOf(OAuthTokens);
    expect(tokens.access_token).toBeInstanceOf(Secret);
    expect(tokens.access_token.reveal()).toBe("expired-access");
    expect(tokens.refresh_token?.reveal()).toBe("valid-refresh");
    // The ISO text is preserved byte-for-byte (never re-rendered).
    expect(tokens.expires_at).toBe("2026-01-15T11:00:00+00:00");
    expect(tokens.scope).toBe("projects analysis");
    expect(tokens.token_type).toBe("Bearer");
  });

  it("normalizes an absent/null refresh_token to null (Python None)", () => {
    const rest: Record<string, unknown> = { ...TOKENS_PAYLOAD };
    delete rest["refresh_token"];
    expect(parseOAuthTokens(rest).refresh_token).toBeNull();
    expect(
      parseOAuthTokens({ ...rest, refresh_token: null }).refresh_token,
    ).toBeNull();
  });

  it("accepts Secret instances directly (already-decoded fields)", () => {
    const secret = new Secret("abc");
    const tokens = parseOAuthTokens({
      ...TOKENS_PAYLOAD,
      access_token: secret,
    });
    expect(tokens.access_token).toBe(secret);
  });

  it("REJECTS naive expires_at (tz-aware validator)", () => {
    expect(() =>
      parseOAuthTokens({
        ...TOKENS_PAYLOAD,
        expires_at: "2026-01-15T11:00:00",
      }),
    ).toThrow(ResponseValidationError);
    // Z-suffix and seconds-bearing offsets are aware.
    expect(
      parseOAuthTokens({
        ...TOKENS_PAYLOAD,
        expires_at: "2026-01-15T11:00:00Z",
      }).expires_at,
    ).toBe("2026-01-15T11:00:00Z");
    expect(
      parseOAuthTokens({
        ...TOKENS_PAYLOAD,
        expires_at: "2026-01-15T11:00:00+05:30",
      }).expires_at,
    ).toBe("2026-01-15T11:00:00+05:30");
  });

  it("rejects missing/malformed required fields", () => {
    for (const field of ["access_token", "expires_at", "scope", "token_type"]) {
      const broken: Record<string, unknown> = Object.fromEntries(
        Object.entries(TOKENS_PAYLOAD).filter(([key]) => key !== field),
      );
      expect(() => parseOAuthTokens(broken)).toThrow(ResponseValidationError);
    }
    expect(() =>
      parseOAuthTokens({ ...TOKENS_PAYLOAD, access_token: 42 }),
    ).toThrow(ResponseValidationError);
  });
});

describe("OAuthTokens.isExpired (30-second buffer)", () => {
  it("treats past instants as expired", () => {
    expect(parseOAuthTokens(TOKENS_PAYLOAD).isExpired()).toBe(true);
  });

  it("treats instants inside the 30s buffer as expired", () => {
    const soon = new Date(Date.now() + 10_000).toISOString();
    const tokens = parseOAuthTokens({ ...TOKENS_PAYLOAD, expires_at: soon });
    expect(tokens.isExpired()).toBe(true);
  });

  it("treats instants beyond the buffer as valid", () => {
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const tokens = parseOAuthTokens({ ...TOKENS_PAYLOAD, expires_at: later });
    expect(tokens.isExpired()).toBe(false);
  });
});

describe("OAuthTokens.fromTokenResponse", () => {
  it("builds a token set from a raw endpoint response", () => {
    const tokens = OAuthTokens.fromTokenResponse({
      access_token: "eyJ...",
      refresh_token: "dGhp...",
      expires_in: 3600,
      scope: "read:project",
      token_type: "Bearer",
    });
    expect(tokens.access_token.reveal()).toBe("eyJ...");
    expect(tokens.refresh_token?.reveal()).toBe("dGhp...");
    expect(tokens.isExpired()).toBe(false);
    expect(tokens.scope).toBe("read:project");
  });

  it("defaults scope to '' and refresh_token to null (dict.get parity)", () => {
    const tokens = OAuthTokens.fromTokenResponse({
      access_token: "x",
      expires_in: 10,
      token_type: "Bearer",
    });
    expect(tokens.scope).toBe("");
    expect(tokens.refresh_token).toBeNull();
    // 10s < 30s buffer -> already expired (Python docstring example).
    expect(tokens.isExpired()).toBe(true);
  });

  it("renders non-string members as Python str() would", () => {
    // `token.py` does `str(data[...])`; a JSON object lands as
    // `{'x': 1}` on both sides, never as `[object Object]`.
    const tokens = OAuthTokens.fromTokenResponse({
      access_token: 12345,
      refresh_token: true,
      expires_in: 3600,
      scope: { x: 1 },
      token_type: null,
    });
    expect(tokens.access_token.reveal()).toBe("12345");
    expect(tokens.refresh_token?.reveal()).toBe("True");
    expect(tokens.scope).toBe("{'x': 1}");
    expect(tokens.token_type).toBe("None");
  });

  it("rejects missing required keys and non-integer expires_in", () => {
    expect(() =>
      OAuthTokens.fromTokenResponse({ expires_in: 1, token_type: "B" }),
    ).toThrow(ParamValidationError);
    expect(() =>
      OAuthTokens.fromTokenResponse({
        access_token: "x",
        expires_in: "soon",
        token_type: "B",
      }),
    ).toThrow(ParamValidationError);
  });
});

describe("parseOAuthClientInfo", () => {
  it("parses all five string fields (naive created_at allowed)", () => {
    const info = parseOAuthClientInfo({
      client_id: "cid",
      region: "us",
      redirect_uri: "http://127.0.0.1:8123/callback",
      scope: "projects",
      created_at: "2026-01-15T11:00:00",
    });
    expect(info.client_id).toBe("cid");
    // No tz-aware validator on OAuthClientInfo.created_at in Python.
    expect(info.created_at).toBe("2026-01-15T11:00:00");
  });

  it("rejects missing fields", () => {
    expect(() => parseOAuthClientInfo({ client_id: "cid" })).toThrow(
      ResponseValidationError,
    );
  });
});
