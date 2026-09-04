/**
 * Barrel for the `bookmarks` module of @mixpanel-headless/core (D11
 * layout). Holds the `_internal/bookmark_enums.py` constant-table port
 * (P2-3) and the `_internal/bookmark_schema.py` sorting slice (B2 shard
 * V1b: the pydantic-mirror models + error adapter that
 * `validate_sorting_block` delegates to — B3-K1 grows that file with
 * the rest of the module); the bookmark builders arrive with batch B3.
 *
 * Python-side this surface is `_internal` — it is exported here for
 * in-package consumers (B2/B3 validators) and the conformance lock
 * tests, but deliberately NOT re-exported from the package barrel
 * (`src/index.ts`), mirroring its absence from `__all__`.
 */
export * from "./builders.js";
// Authored (no Python twin): the report-type classifier heads spec 02
// §10.1 asks headless to own. Unlike the rest of this module it IS
// re-exported from the package barrel — it is a public request from a
// downstream consumer, not an `_internal` mirror.
export * from "./infer-type.js";
export * from "./enums.js";
export * from "./schema-sorting.js";
export * from "./schema.js";
