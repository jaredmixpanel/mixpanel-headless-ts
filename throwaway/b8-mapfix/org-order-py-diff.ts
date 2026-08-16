/**
 * B8-MAPFIX R10.9 harness, part 2 — TS-side case generator + runner
 * for the CPython differential (Python is the behavior arbiter;
 * naming has NO oracle bridge surface per the auth posture, playbook
 * Risk 7, so this throwaway pair IS the cross-language proof on
 * out-of-order inputs).
 *
 * Emits JSONL cases to stdout: `{kind, body, existing, ts}` where
 * `body` is the /me JSON text with keys in GENERATED order and `ts`
 * is this port's answer computed through the real wire path
 * (`parseLossless` → `toNativeJson` → `MeResponse.fromDict`).
 *
 * - kind "naming": `ts` = `defaultAccountName(me, existing)`.
 * - kind "workspace": `ts` = `MeService.resolveWorkspace(project_id)`
 *   over a warm in-memory cache (`services/me.ts:386-407`).
 *
 * The Python twin (`py_driver.py`) recomputes each case with the real
 * `default_account_name` / `select_workspace_id` and reports
 * divergences.
 *
 * Run:
 *   npx vite-node throwaway/b8-mapfix/org-order-py-diff.ts > cases.jsonl
 *   (cd ../mixpanel-headless && uv run python \
 *      ../mixpanel-headless-ts/throwaway/b8-mapfix/py_driver.py \
 *      < ../mixpanel-headless-ts/cases.jsonl)
 */

import { parseLossless } from "../../packages/core/src/client/lossless-json.js";
import {
  toNativeJson,
  type JsonValue,
} from "../../packages/core/src/client/json-value.js";
import { MeResponse } from "../../packages/core/src/client/me.js";
import { defaultAccountName } from "../../packages/core/src/accounts/naming.js";
import {
  MeService,
  inMemoryMeCache,
  type MeClient,
} from "../../packages/core/src/services/me.js";

/**
 * Deterministic PRNG (mulberry32) so the case set is reproducible
 * from the recorded seed.
 *
 * @param seed - 32-bit seed.
 * @returns A `() => number` uniform source in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20260816;
const rnd = mulberry32(SEED);

/**
 * Draw an integer in [0, n).
 *
 * @param n - Exclusive upper bound.
 * @returns The draw.
 */
function nat(n: number): number {
  return Math.floor(rnd() * n);
}

/**
 * Draw one element from a list.
 *
 * @param items - Candidates.
 * @returns The pick.
 */
function pick<T>(items: readonly T[]): T {
  return items[nat(items.length)] as T;
}

const NAMES = [
  "Acme Corp",
  "Beta Systems",
  "Café Industries",
  "---",
  "",
  "Team X",
  "ZZ Top",
  "aaa",
  "𝒳 labs",
  "  spaced  ",
];

const EXISTING_POOL = [
  "acme-corp",
  "beta-systems",
  "account",
  "account-2",
  "org-100",
  "team-x",
  "cafe-industries",
  "zz-top",
];

/**
 * Render an object body with keys in the generated order.
 *
 * @param section - `organizations` / `workspaces`.
 * @param members - Pre-rendered `"key": {...}` member strings.
 * @returns The /me JSON text.
 */
function renderBody(section: string, members: readonly string[]): string {
  return `{${JSON.stringify(section)}: {${members.join(", ")}}}`;
}

/** One emitted case. */
interface Case {
  readonly kind: "naming" | "workspace";
  readonly body: string;
  readonly existing?: readonly string[];
  readonly project_id?: string;
  readonly ts: string | number | null;
}

/**
 * Parse a body through the real wire path.
 *
 * @param body - The /me JSON text.
 * @returns The MeResponse.
 */
function meFromWire(body: string): MeResponse {
  return MeResponse.fromDict(toNativeJson(parseLossless(body) as JsonValue));
}

const cases: Case[] = [];

// --- naming family: 600 cases, shuffled org key orders ---
for (let i = 0; i < 600; i += 1) {
  const count = nat(6);
  const seen = new Set<string>();
  const members: string[] = [];
  for (let j = 0; j < count; j += 1) {
    const integerLike = rnd() < 0.7;
    const key = integerLike
      ? String(nat(1000000))
      : `${pick(["team", "org", "x"])}-${String(nat(1000))}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    members.push(
      `${JSON.stringify(key)}: {"id": ${String(nat(1000000))}, ` +
        `"name": ${JSON.stringify(pick(NAMES))}}`,
    );
  }
  const body = renderBody("organizations", members);
  const existing: string[] = [];
  const existingCount = nat(4);
  for (let j = 0; j < existingCount; j += 1) {
    existing.push(pick(EXISTING_POOL));
  }
  const me = meFromWire(body);
  cases.push({
    kind: "naming",
    body,
    existing,
    ts: defaultAccountName(me, new Set(existing)),
  });
}

// --- workspace family: 400 cases, shuffled workspace key orders ---
for (let i = 0; i < 400; i += 1) {
  const count = 1 + nat(5);
  const seen = new Set<string>();
  const members: string[] = [];
  for (let j = 0; j < count; j += 1) {
    const id = nat(10000);
    const key = String(id);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const projectId = pick([1, 1, 1, 2]);
    const flags: string[] = [];
    if (rnd() < 0.25) {
      flags.push(`"is_global": ${rnd() < 0.5 ? "true" : "false"}`);
    }
    if (rnd() < 0.25) {
      flags.push(`"is_default": ${rnd() < 0.5 ? "true" : "false"}`);
    }
    if (rnd() < 0.4) {
      flags.push(`"is_visible": ${rnd() < 0.5 ? "true" : "false"}`);
    }
    const name = pick(["Console", "All Project Data", "Zeta", "View A"]);
    members.push(
      `${JSON.stringify(key)}: {"id": ${String(id)}, ` +
        `"name": ${JSON.stringify(name)}, ` +
        `"project_id": ${String(projectId)}` +
        (flags.length > 0 ? `, ${flags.join(", ")}` : "") +
        `}`,
    );
  }
  const body = renderBody("workspaces", members);
  const client: MeClient = {
    me: () => Promise.resolve(parseLossless(body) as Record<string, JsonValue>),
  };
  const svc = new MeService(client, inMemoryMeCache("harness"), "us");
  // Warm the cache synchronously via fetch, then resolve.
  const resolved = await svc.fetch().then(() => svc.resolveWorkspace("1"));
  cases.push({ kind: "workspace", body, project_id: "1", ts: resolved });
}

for (const c of cases) {
  console.log(JSON.stringify(c));
}
console.error(
  `org-order-py-diff: emitted ${String(cases.length)} cases ` +
    `(naming 600, workspace 400) seed ${String(SEED)}`,
);
