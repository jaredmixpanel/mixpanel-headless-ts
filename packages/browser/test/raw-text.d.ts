// Ambient declaration for the vite `?raw` source-text import used by the
// security-warning check in credential-store.test.ts (browser tests sit
// inside the purity boundary, so the source text arrives through the bundler
// rather than node:fs).

declare module "*?raw" {
  const text: string;
  export default text;
}
