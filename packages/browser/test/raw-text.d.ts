// Ambient declaration for vitest/vite `?raw` source-text imports —
// used by the §2.6 security-warning-exists check in
// credential-store.test.ts (the repo's header-grep precedent lives in
// conformance-runner/test/, which sits outside the purity boundary and
// uses node:fs; packages/browser tests are INSIDE the boundary, so the
// source text arrives through the bundler instead — B9-R1 notes,
// design decision 5).
declare module "*?raw" {
  const text: string;
  export default text;
}
