/**
 * @mixpanel-headless/core — isomorphic core of the mixpanel_headless port.
 *
 * The module directories are laid out per the D11 design; `compat/` is the
 * first implemented module (TS-2, rulebook §11). Core is pure per R9.1 —
 * no Node built-ins, no undici, no `process` access.
 */
export * from "./compat/index.js";

// Phase-2 contract layer (P2-2): error taxonomy + Secret + coercion +
// invariant. `errors-codes.gen.ts` internals (parent-edge/default-code
// maps) stay module-scoped for the C8(c) registry test; the two registry
// sets mirror Python's `exceptions` module surface and re-export via
// errors.ts.
export * from "./errors.js";
export * from "./secret.js";
export * from "./coerce.js";
export * from "./invariant.js";

// Phase-2 contract layer (P2-3): the 37 Literal-alias unions + runtime
// membership tuples and the 8 Python Enum-class ports (public `__all__`
// names — phase2-design C2). The bookmarks/ enum tables are Python
// `_internal` and intentionally NOT re-exported here.
export * from "./types/index.js";

/** Package name constant exercised by the skeleton smoke test. */
export const CORE_PACKAGE_NAME = "@mixpanel-headless/core";
