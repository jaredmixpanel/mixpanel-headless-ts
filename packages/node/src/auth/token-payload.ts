/**
 * Canonical on-disk `tokens.json` serialization. Every site that writes
 * a per-account `tokens.json` (the on-disk resolver's refresh, the token
 * store, the bridge-token materialization) routes through this helper so
 * the written shape stays in lockstep with what the loaders read back.
 * `refresh_token` is omitted when `null` (not written as an explicit
 * JSON `null`), matching the loaders' "missing key means null" reading.
 *
 * This is a designated secret-reveal site: `Secret.toJSON()` returns the
 * mask, so the payload is built from explicit `reveal()` calls, never
 * via `JSON.stringify(tokens)`.
 *
 * @see mixpanel_headless._internal.auth.token.token_payload_bytes
 */

import { type OAuthTokens, pythonJsonDumps } from "@mixpanel-headless/core";

import { pythonIsoformatDatetimeText } from "./pydantic-datetime.js";

/**
 * Serialize `tokens` to UTF-8 JSON bytes for `atomicWriteBytes`.
 *
 * @param tokens - The tokens to serialize. `expires_at` is tz-aware ISO
 *   text (enforced at model construction) and is re-rendered through the
 *   `datetime.isoformat()` twin so foreign spellings such as `Z` never
 *   reach the written file.
 * @returns UTF-8 encoded JSON bytes.
 * @example
 * ```ts
 * const path = join(ensureAccountDir(name), "tokens.json");
 * atomicWriteBytes(path, tokenPayloadBytes(tokens));
 * ```
 */
export function tokenPayloadBytes(tokens: OAuthTokens): Uint8Array {
  const payload: Record<string, unknown> = {
    access_token: tokens.access_token.reveal(),
    expires_at: pythonIsoformatDatetimeText(tokens.expires_at),
    token_type: tokens.token_type,
    scope: tokens.scope,
  };
  if (tokens.refresh_token !== null) {
    payload["refresh_token"] = tokens.refresh_token.reveal();
  }
  // `json.dumps(payload)` default separators (`", "` / `": "`) keep the
  // file byte-identical to what Python writes.
  return new TextEncoder().encode(pythonJsonDumps(payload));
}
