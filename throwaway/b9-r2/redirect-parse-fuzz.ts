// R10.9 harness — B9-R2 redirect-parse differential fuzz
// (b9-packets.md §3.5.3): fast-check, >=500 examples of URL-ish
// strings (unicode-biased, `+`/`%`-injection, duplicate params)
// through TS `parsePastedRedirect` vs CPython
// `_parse_pasted_redirect`, compared code-or-result via ONE batched
// `uv run python` driver. Known-class divergences #9/#10 cannot arise
// (parsed query pairs are arrays); expect ZERO — any divergence
// blocks.
// Run: npx vite-node throwaway/b9-r2/redirect-parse-fuzz.ts

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import fc from "fast-check";

import { parsePastedRedirect } from "../../packages/core/src/auth/redirect-parse.js";

const SEED = 20260817;
const NUM_RUNS = 700;
const PY_REPO = "/Users/jaredmcfarland/Developer/mixpanel-headless";

const tokenArb = fc.oneof(
  fc.constantFrom(
    "ABC",
    "code",
    "state",
    "error",
    "error_description",
    "18.0",
    "1.5",
    "true",
    "",
    "𝒳",
    "a+b",
    "%zz",
    "%C3%BC",
    "%F0%9D%92%B3",
    "%",
    "a%2",
    "sp ace",
    "XYZ",
  ),
  fc.string({ maxLength: 12 }),
  fc.string({ unit: "binary", maxLength: 8 }),
);
const pairArb = fc
  .tuple(tokenArb, tokenArb)
  .map(([key, value]) => `${key}=${value}`);
const queryArb = fc
  .array(fc.oneof(pairArb, tokenArb), { maxLength: 6 })
  .map((parts) => parts.join("&"));
const lineArb = fc.oneof(
  queryArb,
  queryArb.map((query) => `?${query}`),
  queryArb.map((query) => `http://localhost:19284/callback?${query}`),
  queryArb.map((query) => `https://app.example.com/cb?${query}`),
  queryArb.map((query) => `  ${query}\n`),
  fc.string({ maxLength: 30 }),
);
const caseArb = fc.record({
  line: lineArb,
  expected_state: fc.constantFrom("XYZ", "𝒳", "st ate", "", "18.0"),
});

interface Case {
  readonly line: string;
  readonly expected_state: string;
}
type Outcome =
  | { readonly code: string; readonly state: string }
  | { readonly error_code: string };

const cases: Case[] = fc.sample(caseArb, { seed: SEED, numRuns: NUM_RUNS });
// Anchor rows (the 9 translated TestParsePastedRedirect shapes).
cases.push(
  {
    line: "http://localhost:19284/callback?code=ABC&state=XYZ",
    expected_state: "XYZ",
  },
  { line: "code=ABC&state=XYZ", expected_state: "XYZ" },
  { line: "?code=ABC&state=XYZ", expected_state: "XYZ" },
  {
    line: "  http://localhost:19284/callback?code=ABC&state=XYZ\n",
    expected_state: "XYZ",
  },
  { line: "   \n", expected_state: "XYZ" },
  { line: "code=ABC&state=ATTACKER", expected_state: "XYZ" },
  { line: "state=XYZ", expected_state: "XYZ" },
  { line: "code=ABC", expected_state: "XYZ" },
  {
    line: "?error=access_denied&error_description=user+cancelled&state=XYZ",
    expected_state: "XYZ",
  },
);

const tsOutcomes: Outcome[] = cases.map((testCase) => {
  try {
    const result = parsePastedRedirect(testCase.line, {
      expectedState: testCase.expected_state,
    });
    return { code: result.code, state: result.state };
  } catch (error) {
    return { error_code: (error as { code: string }).code };
  }
});

const driver = join(dirname(fileURLToPath(import.meta.url)), "parse_driver.py");
const pyOut = execFileSync("uv", ["run", "python", driver], {
  cwd: PY_REPO,
  input: JSON.stringify(cases),
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const pyOutcomes = JSON.parse(pyOut) as Outcome[];

let divergences = 0;
for (let i = 0; i < cases.length; i += 1) {
  const ts = JSON.stringify(tsOutcomes[i]);
  const py = JSON.stringify(pyOutcomes[i]);
  if (ts !== py) {
    divergences += 1;
    console.error(`DIVERGE case=${JSON.stringify(cases[i])} ts=${ts} py=${py}`);
  }
}
console.log(
  `b9-r2 redirect-parse fuzz: seed=${SEED} cases=${cases.length} ` +
    `(${NUM_RUNS} fast-check + 9 anchors) divergences=${divergences}`,
);
if (divergences > 0) {
  process.exit(1);
}
