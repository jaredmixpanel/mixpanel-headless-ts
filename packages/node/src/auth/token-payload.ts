/**
 * Canonical on-disk `tokens.json` serialization — TS port of
 * `token_payload_bytes` (`token.py`; b8-packets.md §3.1).
 *
 * Every site that writes a per-account `tokens.json`
 * (`OnDiskTokenResolver._refresh_and_persist`, `TokenStore.writeTokens`,
 * the bridge-token materialization) routes through this helper so the
 * written shape stays in lockstep with what the loaders read back.
 * `refresh_token` is OMITTED when `null` (not an explicit JSON `null`)
 * — matching the loaders' "missing key → null" behavior.
 *
 * CRED-F3 (b7-reviewB-resolution.md): this is a DESIGNATED reveal
 * site — `Secret.toJSON()` returns the mask, so the payload is built
 * from explicit `reveal()` calls, never via `JSON.stringify(tokens)`.
 */

import { type OAuthTokens, pythonJsonDumps } from "@mixpanel-headless/core";

import { pythonIsoformatDatetimeText } from "./pydantic-datetime.js";

/**
 * Serialize `tokens` to UTF-8 JSON bytes for `atomicWriteBytes`.
 *
 * @param tokens - The tokens to serialize (`expires_at` is tz-aware
 *   ISO text, enforced at model construction; re-rendered through the
 *   `datetime.isoformat()` twin so foreign spellings like `Z` never
 *   leak into the written file — B8-ARB-B F2,
 *   `b8-reviewB-resolution.md`).
 * @returns UTF-8 encoded JSON bytes.
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
  // `json.dumps(payload)` default separators — `", "` / `": "`
  // (B8-ARB-B ripple: byte parity with `token.py`, probed
  // byte-identical in `b8-reviewB-resolution.md`).
  return new TextEncoder().encode(pythonJsonDumps(payload));
}
