// B8-N1 R10.9 harness — fast-check over the io-utils + TOML-round-trip
// surfaces (b8-packets.md §2.5 rows 1/2/5 randomized halves).
// Run: npx vite-node throwaway/b8-n1/io-fuzz.ts
//
// Surface A (500): atomicWriteBytes round-trip vs an in-memory map
// mini-model — random payloads (0..4096 bytes) and modes {0600, 0400,
// 0200, 0700}; after each write the on-disk bytes and mode must equal
// the model's. Surface B (500): custom-header TOML string round-trip —
// random unicode strings (graphemes; the ported value domain excludes
// lone surrogates, which cannot cross the UTF-8 wire) written via
// `setCustomHeader` and re-read through a FRESH manager must come back
// VERBATIM (no normalization, no escaping loss).

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import fc from "fast-check";

import { atomicWriteBytes } from "../../packages/node/src/io-utils.js";
import { ConfigManager } from "../../packages/node/src/config.js";

const SEED = 20260816;
const ROOT = mkdtempSync(join(tmpdir(), "mp-b8n1-iofuzz-"));
const home = resolve(homedir());
if (ROOT === home || ROOT.startsWith(home + sep)) {
  throw new Error(`real-home guard tripped: ${ROOT}`);
}

// ── Surface A: atomic write round-trip vs mini-model ────────────────
const dirA = join(ROOT, "a");
mkdirSync(dirA);
const model = new Map<string, { bytes: Uint8Array; mode: number }>();
let aExamples = 0;
fc.assert(
  fc.property(
    fc.constantFrom("f1.bin", "f2.bin", "f3.bin"),
    fc.uint8Array({ minLength: 0, maxLength: 4096 }),
    fc.constantFrom(0o600, 0o400, 0o700),
    (name, payload, mode) => {
      aExamples += 1;
      const path = join(dirA, name);
      atomicWriteBytes(path, payload, { mode });
      model.set(name, { bytes: payload, mode });
      for (const [n, expected] of model) {
        const p = join(dirA, n);
        const onDisk = readFileSync(p);
        if (Buffer.compare(onDisk, Buffer.from(expected.bytes)) !== 0) {
          throw new Error(`byte divergence at ${n}`);
        }
        if ((statSync(p).mode & 0o7777) !== expected.mode) {
          throw new Error(`mode divergence at ${n}`);
        }
      }
    },
  ),
  { seed: SEED, numRuns: 500 },
);

// ── Surface B: TOML string round-trip (custom header) ───────────────
let bExamples = 0;
let bSeq = 0;
fc.assert(
  fc.property(
    fc.string({ unit: "grapheme", minLength: 0, maxLength: 64 }),
    fc.string({ unit: "grapheme", minLength: 1, maxLength: 32 }),
    (value, name) => {
      bExamples += 1;
      bSeq += 1;
      const dir = join(ROOT, `b${bSeq}`);
      mkdirSync(dir);
      const path = join(dir, "config.toml");
      new ConfigManager({ configPath: path }).setCustomHeader({ name, value });
      const back = new ConfigManager({ configPath: path }).getCustomHeader();
      if (back === null || back[0] !== name || back[1] !== value) {
        throw new Error(
          `TOML round-trip divergence: ${JSON.stringify({ name, value, back })}`,
        );
      }
      rmSync(dir, { recursive: true, force: true });
    },
  ),
  { seed: SEED, numRuns: 500 },
);

rmSync(ROOT, { recursive: true, force: true });
console.log(
  `io-fuzz: surfaceA(atomic-write) ${aExamples} examples, ` +
    `surfaceB(toml-round-trip) ${bExamples} examples, divergences 0, seed ${SEED}`,
);
