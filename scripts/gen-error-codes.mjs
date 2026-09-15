// Generates packages/core/src/errors-codes.gen.ts from the synced contract
// artifact conformance-runner/corpus/contract/error-codes.json (phase2-design
// C3: the error-code registry is GENERATED, never hand-typed).
//
// Usage:
//   node scripts/gen-error-codes.mjs           # (re)write the .gen.ts file
//   node scripts/gen-error-codes.mjs --check   # exit 1 if the committed file
//                                              # differs from a fresh render
//
// Output is prettier-formatted and byte-deterministic (all collections are
// emitted sorted), so `--check` doubles as the hand-edit tripwire required
// by phase2-design C5 item 4.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import prettier from "prettier";

/** Repo root (this script lives in scripts/). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Path of the synced contract artifact (input). */
export const ARTIFACT_PATH = resolve(
  REPO_ROOT,
  "conformance-runner/corpus/contract/error-codes.json",
);

/** Path of the generated TS module (output). */
export const OUTPUT_PATH = resolve(
  REPO_ROOT,
  "packages/core/src/errors-codes.gen.ts",
);

/**
 * Render the errors-codes.gen.ts module text from the parsed artifact.
 *
 * @param {object} artifact - Parsed error-codes.json content.
 * @returns {Promise<string>} Prettier-formatted TypeScript source text.
 */
export async function renderErrorCodesModule(artifact) {
  const {
    generated_from: generatedFrom,
    exception_classes: exceptionClasses,
    default_codes: defaultCodes,
    coded_guard_registry: registry,
    coded_guard_twin_codes: twins,
  } = artifact;

  const sortedNames = Object.keys(exceptionClasses).sort();
  const classEntries = sortedNames
    .map((name) => {
      const parent = exceptionClasses[name];
      return `  [${JSON.stringify(name)}, ${parent === null ? "null" : JSON.stringify(parent)}],`;
    })
    .join("\n");
  const defaultEntries = Object.keys(defaultCodes)
    .sort()
    .map(
      (name) =>
        `  [${JSON.stringify(name)}, ${JSON.stringify(defaultCodes[name])}],`,
    )
    .join("\n");
  const registryEntries = [...registry]
    .sort()
    .map((code) => `  ${JSON.stringify(code)},`)
    .join("\n");
  const twinEntries = [...twins]
    .sort()
    .map((code) => `  ${JSON.stringify(code)},`)
    .join("\n");

  const body = `// GENERATED FROM conformance-runner/corpus/contract/error-codes.json @ ${generatedFrom} — DO NOT EDIT
// Regenerate with: node scripts/gen-error-codes.mjs
//
// Mirror of the Python-side error-code contract artifact (phase2-design C3):
// exception class parent edges, per-class default codes, and the coded-guard
// registry (\`exceptions.CODED_GUARD_REGISTRY\` / \`CODED_GUARD_TWIN_CODES\`).
// The C8(c) registry-equality test diffs this module against the artifact
// AND against the live classes in errors.ts.

/** Python-side commit SHA the source artifact was generated from. */
export const ERROR_CODES_GENERATED_FROM = ${JSON.stringify(generatedFrom)};

/**
 * Exception class name → parent class name (\`null\` for the hierarchy
 * root \`MixpanelHeadlessError\`). ReadonlyMap per R4.8.
 */
export const EXCEPTION_CLASS_PARENTS: ReadonlyMap<string, string | null> =
  new Map([
${classEntries}
  ]);

/** Exception class name → default machine code. ReadonlyMap per R4.8. */
export const DEFAULT_ERROR_CODES: ReadonlyMap<string, string> = new Map([
${defaultEntries}
]);

/**
 * Every full error code minted by the E2 uncoded-raise coding pass —
 * mirror of Python \`exceptions.CODED_GUARD_REGISTRY\` (frozenset).
 */
export const CODED_GUARD_REGISTRY: ReadonlySet<string> = new Set([
${registryEntries}
]);

/**
 * Pre-existing registry codes reused by dual-enforcement guard twins —
 * mirror of Python \`exceptions.CODED_GUARD_TWIN_CODES\` (frozenset).
 */
export const CODED_GUARD_TWIN_CODES: ReadonlySet<string> = new Set([
${twinEntries}
]);
`;

  const prettierConfig = (await prettier.resolveConfig(OUTPUT_PATH)) ?? {};
  return prettier.format(body, { ...prettierConfig, parser: "typescript" });
}

/**
 * Read + parse the artifact, render the module text.
 *
 * @returns {Promise<string>} The rendered module text.
 */
export async function renderFromDisk() {
  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf8"));
  return renderErrorCodesModule(artifact);
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const rendered = await renderFromDisk();
  if (process.argv.includes("--check")) {
    let committed;
    try {
      committed = readFileSync(OUTPUT_PATH, "utf8");
    } catch {
      committed = null;
    }
    if (committed !== rendered) {
      console.error(
        `gen-error-codes: ${OUTPUT_PATH} is stale or hand-edited; ` +
          "run `node scripts/gen-error-codes.mjs` to regenerate.",
      );
      process.exit(1);
    }
    console.log("gen-error-codes: errors-codes.gen.ts is up to date.");
  } else {
    writeFileSync(OUTPUT_PATH, rendered);
    console.log(`gen-error-codes: wrote ${OUTPUT_PATH}`);
  }
}
