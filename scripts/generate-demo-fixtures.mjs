#!/usr/bin/env node
// Generates docs/.vitepress/theme/demo/fixtures/demo-project.gen.ts: the
// synthetic "Northwind Notes" project the docs playground serves through the
// library's fetch seam. Generated from a seeded PRNG rather than recorded
// from a real project so the data is reproducible, carries no personal data
// by construction, and never goes stale (series are day offsets; the
// transport materializes dates relative to "today").
//
// Usage:
//   npm run generate:demo-fixtures              # (re)write the .gen.ts file
//   npm run generate:demo-fixtures -- --check   # exit 1 if the committed file
//                                               # differs from a fresh render
//
// Output is byte-deterministic (fixed seed, sorted object keys), so `--check`
// doubles as the hand-edit tripwire (tests/demo-fixtures.test.ts).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Path of the generated TS module (output). */
const OUTPUT_PATH = resolve(
  REPO_ROOT,
  "docs/.vitepress/theme/demo/fixtures/demo-project.gen.ts",
);

const SEED = 0x4e4e_2026;
const DAYS = 90;
const MATHS = ["total", "unique", "dau"];
const WINDOWS = [1, 7, 14, 30];
const BASE_VOLUME = 1500;

/** Event → relative daily volume (App Opened ≈ 1 500 / day). */
const EVENTS = {
  "App Opened": 1,
  "Note Saved": 0.85,
  Search: 0.5,
  "Note Shared": 0.25,
  "Settings Changed": 0.15,
  Signup: 0.12,
  Export: 0.08,
  Upgrade: 0.03,
};

/** Property → value → share, in display order. */
const PROPERTIES = {
  platform: { iOS: 0.46, Android: 0.34, Web: 0.2 },
  plan: { free: 0.62, pro: 0.28, team: 0.1 },
  country: { US: 0.38, IN: 0.16, GB: 0.14, DE: 0.12, BR: 0.11, JP: 0.09 },
  source: { organic: 0.48, referral: 0.2, ads: 0.18, email: 0.14 },
  note_length: { medium: 0.42, short: 0.3, long: 0.2, "very long": 0.08 },
};
const COMMON_PROPERTIES = ["platform", "plan"];
const EXTRA_PROPERTIES = {
  Signup: ["country", "source"],
  "Note Saved": ["note_length"],
};

/** Events the funnel builder may combine (every ordered pair and triple). */
const FUNNEL_POOL = [
  "Signup",
  "App Opened",
  "Note Saved",
  "Note Shared",
  "Upgrade",
];
/**
 * Step-to-step conversion of every ordered pair at the 7-day window (the
 * playground's default). Designed rather than drawn so the conversion
 * matrix tells one story: Signup → Note Saved is the strongest pair and
 * Note Saved → Note Shared the strongest continuation, so the greedy best
 * path is Signup → Note Saved → Note Shared (100 % → 61 % → 23 %); Upgrade
 * is rare from anywhere and nothing leads back to Signup.
 */
const PAIR_RATES = {
  "Signup>App Opened": 0.44,
  "Signup>Note Saved": 0.61,
  "Signup>Note Shared": 0.27,
  "Signup>Upgrade": 0.06,
  "App Opened>Signup": 0.03,
  "App Opened>Note Saved": 0.47,
  "App Opened>Note Shared": 0.19,
  "App Opened>Upgrade": 0.03,
  "Note Saved>Signup": 0.02,
  "Note Saved>App Opened": 0.33,
  "Note Saved>Note Shared": 0.38,
  "Note Saved>Upgrade": 0.09,
  "Note Shared>Signup": 0.02,
  "Note Shared>App Opened": 0.35,
  "Note Shared>Note Saved": 0.36,
  "Note Shared>Upgrade": 0.14,
  "Upgrade>Signup": 0.01,
  "Upgrade>App Opened": 0.3,
  "Upgrade>Note Saved": 0.34,
  "Upgrade>Note Shared": 0.21,
};
const WINDOW_FACTOR = { 1: 0.69, 7: 1, 14: 1.11, 30: 1.2 };

/**
 * born → return events offered for retention: the two onboarding events
 * against every other event (the "which behavior predicts retention"
 * ranking needs the full row), plus Upgrade → Note Saved.
 */
const RETENTION_BORN = ["Signup", "App Opened"];
const RETENTION_EXTRA_PAIRS = { Upgrade: ["Note Saved"] };
/**
 * Return event → the retention curve it earns: the rate at bucket 1 and
 * the floor the curve decays towards. Spread so the ranking tells one
 * story at every range and unit: Note Shared clearly first, Export and
 * Upgrade high, Note Saved in the middle, Search and App Opened around
 * the median, Settings Changed last.
 */
const RETENTION_PROFILES = {
  "Note Shared": { start: 0.62, floor: 0.36 },
  Export: { start: 0.55, floor: 0.3 },
  Upgrade: { start: 0.52, floor: 0.28 },
  "Note Saved": { start: 0.44, floor: 0.18 },
  Search: { start: 0.4, floor: 0.14 },
  "App Opened": { start: 0.42, floor: 0.13 },
  "Settings Changed": { start: 0.25, floor: 0.07 },
  Signup: { start: 0.1, floor: 0.02 },
};
/** Born event → multiplier on every return rate (upgraded users stick). */
const RETENTION_BORN_FACTOR = { Signup: 1, "App Opened": 0.92, Upgrade: 1.15 };
/** Buckets the curve takes to close most of the gap to its floor. */
const RETENTION_DECAY = 2;
const RETENTION_SHAPES = {
  week: { cohorts: 13, buckets: 6, unitDays: 7, factor: 1 },
  day: { cohorts: 30, buckets: 8, unitDays: 1, factor: 0.8 },
};

/**
 * xorshift32 — small, seedable, and identical on every engine.
 *
 * @param {number} seed - Non-zero 32-bit seed.
 * @returns {() => number} Uniform draws in [0, 1).
 */
function xorshift(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

const rand = xorshift(SEED);
const jitter = (spread) => 1 + (rand() * 2 - 1) * spread;
const round3 = (x) => Math.round(x * 1000) / 1000;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const last = (xs, n) => xs.slice(xs.length - n);

/**
 * One event's 90-day series per math: a weekly cycle with a weekend dip, a
 * mild upward drift and per-day noise; unique ≈ 0.42 × total and dau ≈ 0.9 ×
 * unique (unique holds users seen across the whole day).
 *
 * @param {number} multiplier - The event's relative volume.
 * @returns {Record<string, number[]>} math → daily values (offsets -89..0).
 */
function trendSeries(multiplier) {
  const total = Array.from({ length: DAYS }, (_, i) => {
    const weekly = i % 7 >= 5 ? 0.72 : 1;
    return Math.round(
      BASE_VOLUME * multiplier * weekly * (1 + 0.004 * i) * jitter(0.08),
    );
  });
  const unique = total.map((n) => Math.round(n * 0.42 * jitter(0.05)));
  const dau = unique.map((n) => Math.round(n * 0.9 * jitter(0.03)));
  return { total, unique, dau };
}

/**
 * Split a series across segments by noisy, renormalized shares; the largest
 * segment absorbs the rounding remainder so segments always sum to the series.
 *
 * @param {number[]} series - Daily totals.
 * @param {Record<string, number>} shares - Segment → share.
 * @returns {Record<string, number[]>} segment → daily values.
 */
function breakdown(series, shares) {
  const names = Object.keys(shares);
  const out = Object.fromEntries(names.map((name) => [name, []]));
  for (const value of series) {
    const weights = names.map((name) => shares[name] * jitter(0.12));
    const total = sum(weights);
    const parts = weights.map((w) => Math.floor((value * w) / total));
    parts[0] += value - sum(parts);
    for (const [i, name] of names.entries()) {
      out[name].push(parts[i]);
    }
  }
  return out;
}

/**
 * Ordered k-tuples of distinct pool members.
 *
 * @param {string[]} pool - Candidates.
 * @param {number} k - Tuple length.
 * @returns {string[][]} Every ordered selection.
 */
function tuples(pool, k) {
  if (k === 0) {
    return [[]];
  }
  return pool.flatMap((head) =>
    tuples(
      pool.filter((e) => e !== head),
      k - 1,
    ).map((tail) => [head, ...tail]),
  );
}

/**
 * Render a value as a TypeScript literal: objects one key per line with
 * sorted, quoted keys; arrays of scalars inline.
 *
 * @param {unknown} value - JSON-compatible value.
 * @param {string} indent - Current indentation.
 * @returns {string} The literal text.
 */
function render(value, indent = "") {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== "object")) {
      return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
    }
    return `[\n${value.map((v) => `${inner}${render(v, inner)},\n`).join("")}${indent}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${render(value[k], inner)},\n`).join("")}${indent}}`;
  }
  return JSON.stringify(value);
}

/**
 * Build the whole project and render the module text.
 *
 * @returns {string} The .gen.ts source.
 */
function renderDemoFixtures() {
  const events = Object.keys(EVENTS);
  const trends = {};
  const breakdowns = {};
  const properties = {};
  const topEvents = [];
  for (const event of events) {
    const series = trendSeries(EVENTS[event]);
    const props = [...COMMON_PROPERTIES, ...(EXTRA_PROPERTIES[event] ?? [])];
    const recent = sum(last(series.total, 30));
    const prior = sum(series.total.slice(DAYS - 60, DAYS - 30));
    topEvents.push({
      event,
      amount: recent,
      percentChange: round3((recent - prior) / prior),
    });
    properties[event] = Object.fromEntries(
      props.map((p) => [p, Math.round(recent * (0.9 + rand() * 0.1))]),
    );
    for (const math of MATHS) {
      trends[`${event}|${math}`] = series[math];
      for (const prop of props) {
        breakdowns[`${event}|${math}|${prop}`] = breakdown(
          series[math],
          PROPERTIES[prop],
        );
      }
    }
  }
  topEvents.sort((a, b) => b.amount - a.amount);

  const pairRate = (a, b) => {
    const rate = PAIR_RATES[`${a}>${b}`];
    if (rate === undefined) {
      throw new Error(`generate-demo-fixtures: no PAIR_RATES entry ${a}>${b}`);
    }
    return rate;
  };
  const funnels = {};
  for (const steps of [...tuples(FUNNEL_POOL, 2), ...tuples(FUNNEL_POOL, 3)]) {
    const rates = steps.slice(1).map((step, i) => pairRate(steps[i], step));
    const hops = steps.slice(1).map(() => Math.round(600 + rand() * 172_800));
    for (const window of WINDOWS) {
      const count = [sum(last(trends[`${steps[0]}|unique`], 30))];
      const avgTime = [0];
      for (const [i, rate] of rates.entries()) {
        const converted = Math.min(0.95, rate * WINDOW_FACTOR[window]);
        count.push(Math.round(count[i] * converted));
        avgTime.push(Math.min(hops[i], window * 86_400));
      }
      funnels[`${steps.join(">")}|${window}`] = { count, avgTime };
    }
  }

  const retentionPairs = Object.entries(RETENTION_EXTRA_PAIRS);
  for (const born of RETENTION_BORN) {
    retentionPairs.push([born, events.filter((event) => event !== born)]);
  }
  const retention = {};
  for (const [born, returns] of retentionPairs) {
    for (const ret of returns) {
      const profile = RETENTION_PROFILES[ret];
      const rate = (bucket, shape) =>
        RETENTION_BORN_FACTOR[born] *
        shape.factor *
        (profile.floor +
          (profile.start - profile.floor) *
            Math.exp(-(bucket - 1) / RETENTION_DECAY));
      for (const [unit, shape] of Object.entries(RETENTION_SHAPES)) {
        const bornUnique = trends[`${born}|unique`];
        const first = [];
        const rates = [];
        for (let c = 0; c < shape.cohorts; c += 1) {
          const end = DAYS - (shape.cohorts - 1 - c) * shape.unitDays;
          // The oldest weekly cohort is a partial week (90 = 12 × 7 + 6), so
          // its slice is clamped to the stored window rather than wrapping.
          first.push(
            sum(bornUnique.slice(Math.max(0, end - shape.unitDays), end)),
          );
          const depth = Math.min(shape.buckets, shape.cohorts - c);
          const row = [1];
          for (let b = 1; b < depth; b += 1) {
            row.push(round3(Math.min(0.95, rate(b, shape) * jitter(0.08))));
          }
          rates.push(row);
        }
        retention[`${born}>>${ret}|${unit}`] = { first, rates };
      }
    }
  }

  const fixtures = {
    schema: 1,
    project: {
      id: "3141592",
      name: "Northwind Notes",
      workspaceId: 1,
      region: "us",
      timezone: "US/Pacific",
      userEmail: "demo@northwind.example",
      organizationName: "Northwind",
    },
    events: [...events].sort(),
    topEvents,
    properties,
    propertyValues: Object.fromEntries(
      Object.entries(PROPERTIES).map(([p, shares]) => [p, Object.keys(shares)]),
    ),
    trends,
    breakdowns,
    funnels,
    retention,
    reportLink: { createdAt: "2026-01-15T12:00:00Z" },
  };
  return `// GENERATED by scripts/generate-demo-fixtures.mjs — DO NOT EDIT
// Regenerate with: npm run generate:demo-fixtures
//
// The synthetic "Northwind Notes" project the playground serves offline.
// Series are day offsets (index 89 = today); fixture-fetch.ts materializes
// dates and wire envelopes at serve time.

import type { DemoFixtures } from "../model/fixture-types.js";

export const DEMO_FIXTURES: DemoFixtures = ${render(fixtures)};
`;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const rendered = renderDemoFixtures();
  if (process.argv.includes("--stdout")) {
    // The freshness test compares this against the committed file.
    process.stdout.write(rendered);
  } else if (process.argv.includes("--check")) {
    let committed;
    try {
      committed = readFileSync(OUTPUT_PATH, "utf8");
    } catch {
      committed = null;
    }
    if (committed !== rendered) {
      console.error(
        `generate-demo-fixtures: ${OUTPUT_PATH} is stale or hand-edited; ` +
          "run `npm run generate:demo-fixtures` to regenerate.",
      );
      process.exit(1);
    }
    console.log("generate-demo-fixtures: demo-project.gen.ts is up to date.");
  } else {
    writeFileSync(OUTPUT_PATH, rendered);
    console.log(`generate-demo-fixtures: wrote ${OUTPUT_PATH}`);
  }
}
