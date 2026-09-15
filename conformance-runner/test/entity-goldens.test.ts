// Entity-model goldens, driven by corpus/contract/model-coverage.json: each
// `entity_golden` model decodes its wire payload through the real class and
// re-encodes the full field walk back to the original. Anti-vacuity per
// golden: `instanceof`, an unknown-key probe (forbid → throw, lax → drop),
// and `Object.keys(toJSON())` against the declared field list.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as entities from "@mixpanel-headless/core";
import {
  parseWorkspaceRef,
  ResponseValidationError,
  type WorkspaceRef,
} from "@mixpanel-headless/core";
import {
  EntityModel,
  type EntityModelStatics,
} from "@mixpanel-headless/core/internal";

import { createRunnerDeps } from "../src/bindings.js";
import type { JsonValue } from "../src/json-value.js";
import { loadCorpus, loadCorpusConfig } from "../src/loader.js";
import { diffPlainPayload } from "./support/plain-diff.js";

/** The conformance-runner package root. */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const config = loadCorpusConfig(PACKAGE_DIR);
const corpus = loadCorpus(
  resolve(PACKAGE_DIR, config.vectorsPath),
  config.sourceCommit,
  config.recordEpoch,
);
const deps = createRunnerDeps(config.recordEpoch);

/** Vectors indexed by id for artifact-driven lookup. */
const vectorsById = new Map(
  corpus.vectors.map((vector) => [vector.id, vector]),
);

/** Parsed shape of one model-coverage row. */
interface CoverageRow {
  readonly status: string;
  readonly entity_golden_vector_ids: readonly string[];
  readonly authored_fixture: string | null;
}

/** Parsed shape of the P2-1 model-coverage artifact. */
interface ModelCoverage {
  readonly models: Readonly<Record<string, CoverageRow>>;
}

const coverage = JSON.parse(
  readFileSync(
    resolve(PACKAGE_DIR, "corpus/contract/model-coverage.json"),
    "utf8",
  ),
) as ModelCoverage;

/** The artifact's entity_golden model set (the table contract). */
const goldenModels = Object.entries(coverage.models)
  .filter(([, row]) => row.status === "entity_golden")
  .map(([name]) => name)
  .sort();

/** One golden handler: decode + probe surface for a model. */
interface GoldenHandler {
  /** Strict decode through the real class. */
  readonly fromDict: (raw: unknown) => unknown;
  /** Anti-vacuity instanceof target (null = custom probe). */
  readonly cls: (new (...args: never[]) => unknown) | null;
  /** The class's extra policy (drives the mutation-probe arm). */
  readonly extraPolicy: "ignore" | "allow" | "forbid";
  /** Re-encode the full field walk for the golden diff. */
  readonly toVectorPayload: (instance: unknown) => Record<string, unknown>;
  /** The plain to-dict walk (declared-keys probe). */
  readonly toJSON: (instance: unknown) => Record<string, unknown>;
  /** Declared output key list (fields + computed). */
  readonly declaredKeys: readonly string[];
}

/**
 * Build the standard handler for one {@link EntityModel} class.
 *
 * @param cls - The entity-model class statics.
 * @returns The golden handler row.
 */
function modelHandler(cls: EntityModelStatics): GoldenHandler {
  return {
    fromDict: (raw) => cls.fromDict(raw),
    cls,
    extraPolicy: cls.extraPolicy,
    toVectorPayload: (instance) => (instance as EntityModel).toVectorPayload(),
    toJSON: (instance) => (instance as EntityModel).toJSON(),
    declaredKeys: [
      ...cls.fieldSpecs.map((spec) => spec.name),
      ...(cls.computedSpecs ?? []).map((spec) => spec.name),
    ],
  };
}

/**
 * Serialize a parsed {@link WorkspaceRef} back to the recorder's
 * four-field walk (`id`, `name`, `is_default`, `project_id` — Python
 * `model_fields` order, `null` for absent optionals: the recorder
 * always emits all four).
 *
 * @param ref - The parsed workspace reference.
 * @returns The full-field mapping.
 */
function workspaceRefToPayload(ref: WorkspaceRef): Record<string, unknown> {
  return {
    id: ref.id,
    name: ref.name ?? null,
    is_default: ref.is_default ?? null,
    project_id: ref.project_id ?? null,
  };
}

/**
 * The custom handler for `WorkspaceRef` — an auth-family interface +
 * parse factory, not an {@link EntityModel} subclass. The
 * mutation probe uses the lax arm: `parseWorkspaceRef` ignores unknown
 * keys and the serializer emits exactly the four declared fields, so
 * an echo cannot pass the declared-keys check.
 */
const workspaceRefHandler: GoldenHandler = {
  fromDict: (raw) => parseWorkspaceRef(raw),
  cls: null,
  extraPolicy: "ignore",
  toVectorPayload: (instance) =>
    workspaceRefToPayload(instance as WorkspaceRef),
  toJSON: (instance) => workspaceRefToPayload(instance as WorkspaceRef),
  declaredKeys: ["id", "name", "is_default", "project_id"],
};

/**
 * The hand-maintained model -> handler table (reviewed in the P2-10
 * mini-audit). Keys must equal the artifact's `entity_golden` set —
 * both directions are asserted below.
 */
const HANDLERS: Readonly<Record<string, GoldenHandler>> = {
  AlertCount: modelHandler(entities.AlertCount),
  AlertHistoryResponse: modelHandler(entities.AlertHistoryResponse),
  AlertScreenshotResponse: modelHandler(entities.AlertScreenshotResponse),
  Annotation: modelHandler(entities.Annotation),
  AnnotationTag: modelHandler(entities.AnnotationTag),
  AuditResponse: modelHandler(entities.AuditResponse),
  Bookmark: modelHandler(entities.Bookmark),
  BookmarkHistoryResponse: modelHandler(entities.BookmarkHistoryResponse),
  BulkCreateSchemasResponse: modelHandler(entities.BulkCreateSchemasResponse),
  BulkPatchResult: modelHandler(entities.BulkPatchResult),
  BusinessContext: modelHandler(entities.BusinessContext),
  BusinessContextChain: modelHandler(entities.BusinessContextChain),
  Cohort: modelHandler(entities.Cohort),
  CustomAlert: modelHandler(entities.CustomAlert),
  CustomEvent: modelHandler(entities.CustomEvent),
  CustomProperty: modelHandler(entities.CustomProperty),
  Dashboard: modelHandler(entities.Dashboard),
  DataVolumeAnomaly: modelHandler(entities.DataVolumeAnomaly),
  DeleteSchemasResponse: modelHandler(entities.DeleteSchemasResponse),
  DropFilter: modelHandler(entities.DropFilter),
  DropFilterLimitsResponse: modelHandler(entities.DropFilterLimitsResponse),
  EventDefinition: modelHandler(entities.EventDefinition),
  EventDeletionRequest: modelHandler(entities.EventDeletionRequest),
  Experiment: modelHandler(entities.Experiment),
  FeatureFlag: modelHandler(entities.FeatureFlag),
  FlagHistoryResponse: modelHandler(entities.FlagHistoryResponse),
  FlagLimitsResponse: modelHandler(entities.FlagLimitsResponse),
  LexiconTag: modelHandler(entities.LexiconTag),
  LookupTable: modelHandler(entities.LookupTable),
  LookupTableUploadUrl: modelHandler(entities.LookupTableUploadUrl),
  ProjectWebhook: modelHandler(entities.ProjectWebhook),
  PropertyDefinition: modelHandler(entities.PropertyDefinition),
  PublicWorkspace: modelHandler(entities.PublicWorkspace),
  SchemaEnforcementConfig: modelHandler(entities.SchemaEnforcementConfig),
  ValidateAlertsForBookmarkResponse: modelHandler(
    entities.ValidateAlertsForBookmarkResponse,
  ),
  WebhookMutationResult: modelHandler(entities.WebhookMutationResult),
  WebhookTestResult: modelHandler(entities.WebhookTestResult),
  WorkspaceRef: workspaceRefHandler,
};

/**
 * Extract the model payload(s) from one `expect.result`: list results
 * carry one payload per element; object results ARE the payload
 * (verified against the snapshot — every entity_golden api returns
 * the model or a list of it, never an envelope).
 *
 * @param result - The raw `expect.result` node.
 * @returns The raw payload subtrees.
 */
function extractPayloads(result: JsonValue): readonly JsonValue[] {
  return Array.isArray(result) ? result : [result];
}

describe("model-coverage accounting", () => {
  it("no model remains unresolved — every row is golden/tag/fixture/deferral", () => {
    for (const [name, row] of Object.entries(coverage.models)) {
      expect(
        ["corpus_tag", "entity_golden", "authored_fixture", "deferred"],
        name,
      ).toContain(row.status);
    }
  });

  it("every authored_fixture path resolves to a real TS test file", () => {
    const repoRoot = resolve(PACKAGE_DIR, "..");
    for (const [name, row] of Object.entries(coverage.models)) {
      if (row.status !== "authored_fixture") {
        continue;
      }
      expect(typeof row.authored_fixture, name).toBe("string");
      expect(
        existsSync(resolve(repoRoot, row.authored_fixture!)),
        `${name} -> ${String(row.authored_fixture)}`,
      ).toBe(true);
    }
  });
});

/**
 * The observable outcome of decoding a payload that carries an unknown
 * key: the surviving serialized keys, or `rejected` when the decode threw
 * {@link ResponseValidationError} (any other throw propagates).
 *
 * @param decode - Decode-and-serialize thunk.
 * @returns The outcome record compared against the model's extra policy.
 */
function unknownKeyOutcome(
  decode: () => object,
): { rejected: true } | { keys: string[] } {
  try {
    return { keys: Object.keys(decode()) };
  } catch (error) {
    if (error instanceof ResponseValidationError) {
      return { rejected: true };
    }
    throw error;
  }
}

describe("entity-model goldens", () => {
  it("handler table matches the artifact's entity_golden set exactly", () => {
    expect(Object.keys(HANDLERS).sort()).toStrictEqual(goldenModels);
  });

  // Models without a handler are reported by the set-equality test above.
  const handled = goldenModels.filter((name) => HANDLERS[name] !== undefined);
  describe.each(handled)("%s", (name) => {
    const handler = HANDLERS[name]!;
    const row = coverage.models[name];
    const ids = row === undefined ? [] : row.entity_golden_vector_ids;
    // Class-backed handlers decode to the real core class (and its
    // EntityModel base); the custom WorkspaceRef handler declares none.
    const decodedClasses =
      handler.cls === null ? [] : [handler.cls, EntityModel];

    it("resolves every artifact vector id in the snapshot", () => {
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(vectorsById.has(id), id).toBe(true);
      }
    });

    it("round-trips every expect.result payload through the class", () => {
      for (const id of ids) {
        const vector = vectorsById.get(id);
        if (vector === undefined) {
          continue; // reported above
        }
        const result = vector.expect["result"] as JsonValue;
        for (const [index, raw] of extractPayloads(result).entries()) {
          const where = `${id} @ result[${String(index)}]`;
          const decoded = deps.codecs.decodeValue(raw);
          const instance = handler.fromDict(decoded);
          for (const cls of decodedClasses) {
            expect(instance, where).toBeInstanceOf(cls);
          }
          diffPlainPayload(handler.toVectorPayload(instance), raw, where);
        }
      }
    });

    it("survives the unknown-key mutation probe (anti-vacuity)", () => {
      for (const id of ids) {
        const vector = vectorsById.get(id);
        if (vector === undefined) {
          continue;
        }
        const result = vector.expect["result"] as JsonValue;
        for (const raw of extractPayloads(result)) {
          const decoded = deps.codecs.decodeValue(raw) as Readonly<
            Record<string, unknown>
          >;
          const mutated = { ...decoded, __p2_7_unknown__: true };
          // Forbid models reject; lax models absorb the key but must
          // DROP it from the serialized walk — an echo implementation
          // fails here.
          expect(
            unknownKeyOutcome(() => handler.toJSON(handler.fromDict(mutated))),
            id,
          ).toStrictEqual(
            handler.extraPolicy === "forbid"
              ? { rejected: true }
              : { keys: [...handler.declaredKeys] },
          );
        }
      }
    });

    it("toJSON() emits exactly the declared field list", () => {
      for (const id of ids) {
        const vector = vectorsById.get(id);
        if (vector === undefined) {
          continue;
        }
        const result = vector.expect["result"] as JsonValue;
        for (const raw of extractPayloads(result)) {
          const instance = handler.fromDict(deps.codecs.decodeValue(raw));
          expect(Object.keys(handler.toJSON(instance)), id).toStrictEqual([
            ...handler.declaredKeys,
          ]);
        }
      }
    });
  });
});
