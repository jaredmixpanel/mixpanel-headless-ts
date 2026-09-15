// C8(a)/C8(b) anti-vacuity repo audit (phase2-design C8, arbiter V3,
// packet P2-8): forbid raw-payload retention in the contract layer.
//
// A codec/`fromDict` implementation that stores the incoming payload
// (`this.raw = payload` style) and echoes it back from `toDict`/encode
// would round-trip every golden and sweep vector vacuously. The sweep's
// `instanceof` probes catch decode-to-plain-object; THIS audit catches
// the store-and-echo variant at the source level: no file under
// `packages/core/src/types/` may assign the whole raw/payload
// identifier (or a spread clone of it) to an instance field, nor
// mass-assign an unvalidated bag onto `this`.
//
// (`Object.assign(this, out)` in model-base.ts is legal: `out` is the
// per-field coerced/validated bag, not the raw payload — the forbidden
// identifiers below are exactly the raw-input names the decode paths
// use: `raw` in EntityModel/fromDict seams, `payload` in codecs.)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** The audited directory (the Phase-2 contract layer). */
const TYPES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/core/src/types",
);

/** One forbidden-pattern rule. */
interface AuditRule {
  /** Human-readable description for the failure message. */
  readonly why: string;
  /** The forbidden source pattern. */
  readonly pattern: RegExp;
}

/**
 * The forbidden retention idioms.
 *
 * `raw` / `payload` followed by `.` or `[` (property access) is fine —
 * only retention of the WHOLE payload value is an echo channel.
 */
const RULES: readonly AuditRule[] = [
  {
    why: "whole-payload field retention (`this.x = raw|payload`)",
    pattern: /this\s*\.\s*#?[A-Za-z_$][\w$]*\s*=\s*(raw|payload)\b(?!\s*[.[])/,
  },
  {
    why: "spread-clone retention (`this.x = { ...raw|payload }`)",
    pattern:
      /this\s*\.\s*#?[A-Za-z_$][\w$]*\s*=\s*\{\s*\.\.\.\s*(raw|payload)\b/,
  },
  {
    why: "mass-assign of an unvalidated bag (`Object.assign(this, raw|payload|fields)`)",
    pattern: /Object\.assign\(\s*this\s*,\s*(raw|payload|fields)\b/,
  },
];

/**
 * Recursively list audited `.ts` source files (tests and declaration
 * files excluded — fixtures may legitimately build echo shapes).
 *
 * @param dir - Directory to scan.
 * @returns Absolute paths, sorted for stable failure output.
 */
function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listSources(full));
    } else if (
      name.endsWith(".ts") &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".test-d.ts") &&
      !name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("raw-payload retention audit (packages/core/src/types)", () => {
  it("audits a non-empty contract layer (the scan is not vacuous)", () => {
    expect(listSources(TYPES_DIR).length).toBeGreaterThan(10);
  });

  it("no source file retains the raw decode payload", () => {
    const violations: string[] = [];
    for (const file of listSources(TYPES_DIR)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        for (const rule of RULES) {
          if (rule.pattern.test(line)) {
            violations.push(
              `${file}:${String(index + 1)} — ${rule.why}: ${line.trim()}`,
            );
          }
        }
      });
    }
    expect(violations).toStrictEqual([]);
  });

  it("the rules themselves match the forbidden idioms (self-check)", () => {
    const echoSamples = [
      "this.raw = payload;",
      "this.#stash = raw;",
      "this._raw = { ...payload };",
      "Object.assign(this, raw);",
      "Object.assign(this, fields);",
    ];
    for (const sample of echoSamples) {
      expect(
        RULES.some((rule) => rule.pattern.test(sample)),
        sample,
      ).toBe(true);
    }
    const legalSamples = [
      "this.name = raw.name;",
      'this.id = payload["id"];',
      "Object.assign(this, out);",
      "const copy = { ...resolved };",
    ];
    for (const sample of legalSamples) {
      expect(
        RULES.some((rule) => rule.pattern.test(sample)),
        sample,
      ).toBe(false);
    }
  });
});
