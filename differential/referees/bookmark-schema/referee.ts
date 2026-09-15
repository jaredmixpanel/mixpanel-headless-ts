/**
 * Referee (a) — insights bookmark payload validation (phase1-design D15a).
 *
 * Validates builder-emitted insights bookmark payloads against the vendored
 * generated schema `vendor/mixpanel-contracts/bookmark.json` (root
 * `InsightsBookmarkParams`, insights-only). The schema declares no `$schema`
 * but requires draft 2020-12 semantics (`prefixItems` on the `checkpoints`
 * tuple, `const` discriminators), so the validator is ajv's `Ajv2020` — a
 * plain draft-07 `Ajv` would silently ignore `prefixItems` and weaken the
 * tuple check. `strict: false` is mandatory: the schema carries 11
 * nonstandard `tsType` keywords (a json2ts extension) that strict mode
 * rejects with "unknown keyword".
 *
 * Scope caveats baked into this referee's contract (recon referee-assets.md):
 * - INSIGHTS ONLY: funnels/flows/retention payloads route to referee (b)
 *   (the Python-side bookmark_parser harness), never through this schema.
 * - `ShowClause` `oneOf` trap: show clauses must carry an explicit `"type"`
 *   (`"metric"` for behavior clauses) or they can multi-match branches and
 *   fail `oneOf`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ajv ships CJS; under NodeNext the default import binds the module
// namespace, so the class is picked off the named `Ajv2020` export (also
// present at runtime via `module.exports.Ajv2020 = Ajv2020`).
import ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";

const { Ajv2020 } = ajv2020;

/** Repo-relative location of the vendored schema, resolved from this file. */
const SCHEMA_URL = new URL(
  "../../../vendor/mixpanel-contracts/bookmark.json",
  import.meta.url,
);

/** Verdict returned by {@link refereeBookmarkPayload}. */
export interface BookmarkRefereeVerdict {
  /** True when the payload validates against `InsightsBookmarkParams`. */
  valid: boolean;
  /**
   * Human-readable ajv error strings (`<instancePath>: <message>`), empty
   * when `valid`. Referee comparisons are ACCEPT/REJECT verdicts only —
   * error text is diagnostic, never part of the cross-oracle contract.
   */
  errors: string[];
}

/**
 * Load the vendored insights bookmark schema from disk.
 *
 * @returns The parsed JSON schema object (root title `InsightsBookmarkParams`).
 */
export function loadBookmarkSchema(): Record<string, unknown> {
  const raw = readFileSync(fileURLToPath(SCHEMA_URL), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Lazily compiled validator, shared across calls (the schema is 164 KB). */
let compiledValidator: ValidateFunction | undefined;

/**
 * Compile (once) and return the ajv validator for the vendored schema.
 *
 * @returns The compiled `ValidateFunction` for `InsightsBookmarkParams`.
 */
export function createBookmarkValidator(): ValidateFunction {
  let validator = compiledValidator;
  if (validator === undefined) {
    const ajv = new Ajv2020({
      // 11 nonstandard `tsType` keywords in the generated schema; strict
      // mode would throw `strict mode: unknown keyword: "tsType"`.
      strict: false,
      // The Pydantic generator emits `"description": null` on 31 enum
      // definitions, which fails the draft-2020-12 META-schema (description
      // must be a string). Python's jsonschema Draft202012Validator never
      // meta-validates by default (the recon transcript ran that way), so
      // parity requires skipping ajv's meta-validation too. The schema is a
      // vendored verbatim artifact — payload validation is unaffected.
      validateSchema: false,
      // Referee verdicts must list every violation, not stop at the first.
      allErrors: true,
    });
    validator = ajv.compile(loadBookmarkSchema());
    compiledValidator = validator;
  }
  return validator;
}

/**
 * Validate one insights bookmark payload against the vendored schema.
 *
 * @param payload - The candidate `InsightsBookmarkParams` payload (any JSON
 *   value; non-objects simply fail validation).
 * @returns ACCEPT/REJECT verdict with diagnostic error strings.
 */
export function refereeBookmarkPayload(
  payload: unknown,
): BookmarkRefereeVerdict {
  const validate = createBookmarkValidator();
  const valid = validate(payload);
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validate.errors ?? []).map(
    (err) =>
      `${err.instancePath === "" ? "/" : err.instancePath}: ${err.message ?? "unknown error"}`,
  );
  return { valid: false, errors };
}
