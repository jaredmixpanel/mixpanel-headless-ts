/**
 * PKCE re-export — the B8 `node:crypto` implementation is RETIRED per
 * the B9 placement ruling (b9-packets.md §1: one WebCrypto
 * implementation in `packages/core/src/auth/pkce.ts`, reused by both
 * node and browser — R10.8: shared internals ported once, by name;
 * plan §4.1 homes "PKCE primitives (WebCrypto)" in core).
 *
 * The file survives as a documented re-export so every existing import
 * path (`flow.ts`, the Layer-3 suite) keeps working; the suite's 10
 * assertions run unchanged against the core implementation (§1.3 —
 * the zero-behavior-change proof). Node ≥20 has WebCrypto globally
 * (`engines.node: ">=20"`).
 */

export { PkceChallenge } from "../../../core/src/auth/pkce.js";
