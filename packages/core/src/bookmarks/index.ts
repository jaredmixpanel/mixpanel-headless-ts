/**
 * Barrel for the `bookmarks` module of @mixpanel-headless/core (D11
 * layout). Holds the `_internal/bookmark_enums.py` constant-table port
 * (P2-3); the bookmark builders arrive with Phase-3 batch B3.
 *
 * Python-side this surface is `_internal` — it is exported here for
 * in-package consumers (B2/B3 validators) and the conformance lock
 * tests, but deliberately NOT re-exported from the package barrel
 * (`src/index.ts`), mirroring its absence from `__all__`.
 */
export * from "./enums.js";
