/**
 * Barrel for the `accounts` module of @mixpanel-headless/core — the
 * B7-A1 namespace surface (`b7-packets.md` §3): `mp.accounts` /
 * `mp.session` / `mp.targets` factories, the `AuthEffects` seam bag,
 * the pure naming helpers, and the real `ResolverSeams`
 * implementations.
 */
export * from "./auth-effects.js";
export * from "./naming.js";
export * from "./accounts-ops.js";
export * from "./login-unified.js";
export * from "./namespace.js";
export * from "./session-namespace.js";
export * from "./targets-namespace.js";
export * from "./resolver-seams.js";
