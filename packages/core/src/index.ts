/**
 * @mixpanel-headless/core — isomorphic core of the mixpanel_headless port.
 *
 * The module directories are laid out per the D11 design; `compat/` is the
 * first implemented module (TS-2, rulebook §11). Core is pure per R9.1 —
 * no Node built-ins, no undici, no `process` access.
 */
export * from "./compat/index.js";

/** Package name constant exercised by the skeleton smoke test. */
export const CORE_PACKAGE_NAME = "@mixpanel-headless/core";
