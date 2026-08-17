// R10.9 harness — B9-R1 PKCE differential vs live CPython
// (b9-packets.md §2.7.3): >=500 random verifiers (base64url alphabet,
// lengths 43-128 per the RFC 7636 range, plus the 86-char production
// shape), TS `await PkceChallenge.challengeFor(v)` vs CPython
// `hashlib.sha256(v.encode('ascii'))` base64url-no-pad — batched
// through ONE `uv run python` process reading a JSON list on stdin
// (hook discipline: never bare python, §7 caution 10).
// Run: npx vite-node throwaway/b9-r1/pkce-differential.ts

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PkceChallenge } from "../../packages/core/src/auth/pkce.js";

const SEED = 20260816;
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
  // Bias half the set to the 86-char production shape; the rest sweep
  // the RFC 43-128 range.
  const length = i % 2 === 0 ? 86 : 43 + (nextU32() % 86);
  verifiers.push(randomVerifier(length));
}

const tsChallenges: string[] = [];
for (const verifier of verifiers) {
  tsChallenges.push(await PkceChallenge.challengeFor(verifier));
}

const driver = join(dirname(fileURLToPath(import.meta.url)), "pkce_driver.py");
const pyOut = execFileSync("uv", ["run", "python", driver], {
  cwd: PY_REPO,
  input: JSON.stringify(verifiers),
  encoding: "utf8",
});
const pyChallenges = JSON.parse(pyOut) as string[];

if (pyChallenges.length !== tsChallenges.length) {
  console.error(
    `length mismatch: py=${pyChallenges.length} ts=${tsChallenges.length}`,
  );
  process.exit(1);
}

let divergences = 0;
for (let i = 0; i < tsChallenges.length; i += 1) {
  if (tsChallenges[i] !== pyChallenges[i]) {
    divergences += 1;
    console.error(
      `DIVERGE @${i}: verifier=${verifiers[i]} ts=${tsChallenges[i]} py=${pyChallenges[i]}`,
    );
  }
}

console.log(
  `pkce-differential: ${verifiers.length} verifiers (seed ${SEED}, ` +
    `${COUNT} random + RFC vector; lengths 43-128 incl. 86-char ` +
    `production shape) — ${divergences} divergences`,
);
if (divergences > 0) process.exit(1);
