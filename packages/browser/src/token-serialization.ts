/**
 * Browser store writer shapes: the JSON payloads the browser
 * `CredentialStore` persists, rendered byte-for-byte like Python's
 * on-disk files. The tokens payload is the `tokens_{region}.json` twin
 * (`datetime.isoformat()` shape — offset `+00:00`, never `Z`); the
 * client-info payload is the `client_{region}.json` twin (pydantic JSON
 * mode — UTC spelled `Z`). Both go through core `pythonUtcIsoformat`;
 * nothing here imports `packages/node` or copies its
 * `pydantic-datetime.ts`.
 *
 * Closed-loop contract: the browser store only ever writes datetime
 * text this library produced — `pythonUtcIsoformat` over
 * integer-millisecond clocks (`Date.now` / an injected `now()`), so no
 * sub-millisecond text can arise. The renderers re-parse via
 * `Date.parse` (millisecond precision): foreign text carrying digits
 * beyond milliseconds (e.g. `.000120`) is outside the write contract
 * and would lose digits 4–6; text that is not a UTC-suffixed instant
 * (`Z` / `+00:00` / `-00:00`) passes verbatim, the same out-of-grammar
 * posture as the node formatters. Read paths are strict
 * (`parseOAuthTokens` / `parseOAuthClientInfo`); no lax read path
 * exists here.
 *
 * @see mixpanel_headless._internal.auth.storage.OAuthStorage
 */

import {
  type OAuthClientInfo,
  type OAuthTokens,
  pythonUtcIsoformat,
} from "@mixpanel-headless/core";

/** UTC-instant suffix grammar accepted by the closed-loop renderers. */
const UTC_SUFFIX = /(?:Z|[+-]00:00)$/;

/**
 * Render stored ISO text the way `datetime.isoformat()` does for UTC
 * instants (`+00:00`, 0-or-6 fractional digits) — the tokens-file
 * writer shape.
 *
 * @param text - Datetime text from the closed loop (see module header).
 * @returns Canonical isoformat text; verbatim when out of grammar.
 * @see mixpanel_headless._internal.auth.storage.OAuthStorage.save_tokens
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
 * instants (`Z`, 0-or-6 fractional digits) — the `client_{region}.json`
 * writer shape. Implemented as the isoformat rendering with its UTC
 * offset respelled `Z`: for UTC instants the two Python writers differ
 * only in that suffix.
 *
 * @param text - Datetime text from the closed loop (see module header).
 * @returns Canonical pydantic-JSON text; verbatim when out of grammar.
 * @see mixpanel_headless._internal.auth.storage.OAuthStorage.save_client_info
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
 * Serialize a token set for `CredentialStore` persistence — the
 * `save_tokens` payload twin: key set `access_token`, `expires_at`,
 * `scope`, `token_type`, plus `refresh_token` only when non-null;
 * `expires_at` in the `+00:00` isoformat shape. This is a deliberate
 * secret reveal site — the secrets are unwrapped explicitly, never via
 * `JSON.stringify(tokens)`.
 *
 * @param tokens - The tokens to serialize.
 * @returns JSON text (2-space indent, matching the node writer bytes).
 * @example
 * ```typescript
 * await store.set(CREDENTIAL_KEYS.tokens("us"), serializeTokensPayload(tokens));
 * ```
 * @see mixpanel_headless._internal.auth.storage.OAuthStorage.save_tokens
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
 * Serialize DCR client info for `CredentialStore` persistence — the
 * `save_client_info` payload twin: key set `client_id`, `region`,
 * `redirect_uri`, `scope`, `created_at`; `created_at` in the
 * pydantic-JSON `Z` shape.
 *
 * @param info - The client registration info to serialize.
 * @returns JSON text (2-space indent, matching the node writer bytes).
 * @example
 * ```typescript
 * await store.set(
 *   CREDENTIAL_KEYS.clientInfo("us"),
 *   serializeClientInfoPayload(clientInfo),
 * );
 * ```
 * @see mixpanel_headless._internal.auth.storage.OAuthStorage.save_client_info
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
