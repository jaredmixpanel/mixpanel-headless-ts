/**
 * `@mixpanel-headless/core/internal` — the NOT-semver-stable surface.
 *
 * Exists for the verification rig (`conformance-runner`, `differential`)
 * and the platform packages (`@mixpanel-headless/node`,
 * `@mixpanel-headless/browser`), which need core plumbing that the public
 * barrel (`./index.ts`) deliberately does not promise to keep: validators,
 * bookmark builders, model bases, service classes, lock-test tables.
 * Anything here may change or disappear in a patch release. Application
 * code should import from `@mixpanel-headless/core` only.
 *
 * Populated by the Phase-3 import rewrite (CLEANUP-PLAN §7.3/§7.4).
 */
export {};
