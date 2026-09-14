/**
 * Browser store WRITER shapes (b9-packets.md §2.1, rulebook amendment
 * R11.9 — which explicitly binds "B9's browser CredentialStore"):
 * every writer renders datetimes through the Python-twin formatter.
 *
 * - Tokens payload = the `tokens_{region}.json` twin (`save_tokens`,
 *   `storage.py:451-478`): `datetime.isoformat()` shape — offset
 *   `+00:00`, NEVER `Z` (B8-ARB-B F2 byte-parity golden,
 *   `b8-reviewB-resolution.md`).
 * - Client-info payload = the `client_{region}.json` twin
 *   (`save_client_info`, `storage.py:526-543`): pydantic JSON mode —
 *   UTC spelled `Z` (live probe `2030-01-01T00:00:00Z`).
 *
 * Both renderings go through core `pythonUtcIsoformat`
 * (`core/src/auth/token.ts` — already core-homed, R11.9's named
 * formatter; no `packages/node` import, and NO copy of node's
 * `pydantic-datetime.ts` — §2.1 forbids it).
 *
 * CLOSED-LOOP CONTRACT (documented narrowing, §2.1): the browser store
 * only ever writes values whose datetime text this library produced —
 * `pythonUtcIsoformat` over integer-millisecond clocks (`Date.now` /
 * injected `now()`), so no sub-millisecond text can arise. The
 * renderers below re-parse via `Date.parse` (millisecond precision):
 * foreign text carrying digits beyond milliseconds (e.g. `.000120`)
 * is OUTSIDE the write contract and would lose digits 4–6; text that
 * is not a UTC-suffixed instant (`Z` / `+00:00` / `-00:00`) passes
 * VERBATIM — the same out-of-grammar posture as the node formatters.
 * Read paths are STRICT (`parseOAuthTokens` / `parseOAuthClientInfo`);
 * no lax-twin read path exists here, so the §2.1 STOP condition does
 * not trigger.
 */

import {
  pythonUtcIsoformat,
  type OAuthClientInfo,
  type OAuthTokens,
} from "@mixpanel-headless/core";

/** UTC-instant suffix grammar accepted by the closed-loop renderers. */
const UTC_SUFFIX = /(?:Z|[+-]00:00)$/;

/**
 * Render stored ISO text the way `datetime.isoformat()` does for UTC
 * instants (`+00:00`, 0-or-6 fractional digits) — the tokens.json
 * writer shape (`storage.py:471`; R11.9 tokens-twin arm).
 *
 * @param text - Datetime text from the closed loop (see module header).
 * @returns Canonical isoformat text; verbatim when out of grammar.
 */
function tokensDatetimeText(text: string): string {
  if (!UTC_SUFFIX.test(text)) {
    return text;
  }
  const epochMs = Date.parse(text);
  if (Number.isNaN(epochMs)) {
    return text;
  }
  return pythonUtcIsoformat(epochMs);
}

/**
 * Render stored ISO text the way pydantic JSON mode does for UTC
 * instants (`Z`, 0-or-6 fractional digits) — the client_{region}.json
 * writer shape (`storage.py:541`; R11.9 pydantic-JSON-twin arm).
 * Implemented as the isoformat rendering with its UTC offset respelled
 * `Z` (the two Python writers differ ONLY in that suffix for UTC
 * instants — `b8-reviewB-resolution.md` F2 table).
 *
 * @param text - Datetime text from the closed loop (see module header).
 * @returns Canonical pydantic-JSON text; verbatim when out of grammar.
 */
function clientInfoDatetimeText(text: string): string {
  if (!UTC_SUFFIX.test(text)) {
    return text;
  }
  const epochMs = Date.parse(text);
  if (Number.isNaN(epochMs)) {
    return text;
  }
  return pythonUtcIsoformat(epochMs).replace(/\+00:00$/, "Z");
}

/**
 * Serialize a token set for {@link CredentialStore} persistence — the
 * `save_tokens` payload twin (`storage.py:451-478`): key set
 * `access_token`, `expires_at`, `scope`, `token_type`, plus
 * `refresh_token` ONLY when non-null; `expires_at` in the `+00:00`
 * isoformat shape. CRED designated reveal site — secrets are unwrapped
 * explicitly, never via `JSON.stringify(tokens)`.
 *
 * @param tokens - The tokens to serialize.
 * @returns JSON text (2-space indent, matching the node writer bytes).
 *
 * @example
 * ```typescript
 * await store.set(CREDENTIAL_KEYS.tokens("us"), serializeTokensPayload(tokens));
 * ```
 */
export function serializeTokensPayload(tokens: OAuthTokens): string {
  const data: Record<string, unknown> = {
    access_token: tokens.access_token.reveal(),
    expires_at: tokensDatetimeText(tokens.expires_at),
    scope: tokens.scope,
    token_type: tokens.token_type,
  };
  if (tokens.refresh_token !== null) {
    data["refresh_token"] = tokens.refresh_token.reveal();
  }
  return JSON.stringify(data, null, 2);
}

/**
 * Serialize DCR client info for {@link CredentialStore} persistence —
 * the `save_client_info` payload twin (`storage.py:526-543`): key set
 * `client_id`, `region`, `redirect_uri`, `scope`, `created_at`;
 * `created_at` in the pydantic-JSON `Z` shape.
 *
 * @param info - The client registration info to serialize.
 * @returns JSON text (2-space indent, matching the node writer bytes).
 */
export function serializeClientInfoPayload(info: OAuthClientInfo): string {
  const data: Record<string, unknown> = {
    client_id: info.client_id,
    region: info.region,
    redirect_uri: info.redirect_uri,
    scope: info.scope,
    created_at: clientInfoDatetimeText(info.created_at),
  };
  return JSON.stringify(data, null, 2);
}
