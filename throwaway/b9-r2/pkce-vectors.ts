// R10.9 harness — B9-R2 PKCE RFC vectors vs WebCrypto (b9-packets.md
// §3.5.2): the RFC 7636 Appendix-B vector + the §2.7.3 CPython
// differential re-run at the R2 seed, THROUGH THE BROWSER ENTRY POINT
// (proves the hoist + re-export chain end-to-end). Batched: ONE
// `uv run python` process reads a JSON list on stdin (hook discipline
// — never bare python, §7 caution 10).
// Run: npx vite-node throwaway/b9-r2/pkce-vectors.ts

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PkceChallenge } from "../../packages/browser/src/index.js";

const SEED = 20260817; // R2 seed (R1 ran 20260816)
const COUNT = 600;
const PY_REPO = "/Users/jaredmcfarland/Developer/mixpanel-headless";

// Deterministic 32-bit LCG so the RUN record's seed reproduces the set.
let state = SEED >>> 0;
function nextU32(): number {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state;
}

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function randomVerifier(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[nextU32() % 64];
  }
  return out;
}

const verifiers: string[] = [];
// RFC Appendix-B vector first (known-answer anchor).
verifiers.push("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
for (let i = 0; i < COUNT; i += 1) {
  const length = i % 2 === 0 ? 86 : 43 + (nextU32() % 86);
  verifiers.push(randomVerifier(length));
}

const tsChallenges: string[] = [];
for (const verifier of verifiers) {
  tsChallenges.push(await PkceChallenge.challengeFor(verifier));
}

// Known-answer check before the differential.
if (tsChallenges[0] !== "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM") {
  console.error("FAIL: RFC 7636 Appendix-B vector mismatch");
  process.exit(1);
}

const driver = join(dirname(fileURLToPath(import.meta.url)), "pkce_driver.py");
const pyOut = execFileSync("uv", ["run", "python", driver], {
  cwd: PY_REPO,
  input: JSON.stringify(verifiers),
  encoding: "utf8",
});
const pyChallenges = JSON.parse(pyOut) as string[];

let divergences = 0;
for (let i = 0; i < verifiers.length; i += 1) {
  if (tsChallenges[i] !== pyChallenges[i]) {
    divergences += 1;
    console.error(
      `DIVERGE verifier=${verifiers[i] as string} ts=${tsChallenges[i] as string} py=${pyChallenges[i] as string}`,
    );
  }
}
console.log(
  `b9-r2 pkce differential: seed=${SEED} cases=${verifiers.length} ` +
    `(RFC vector + ${COUNT} random) divergences=${divergences}`,
);
if (divergences > 0) {
  process.exit(1);
}
