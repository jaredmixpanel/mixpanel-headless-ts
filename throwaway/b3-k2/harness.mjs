/**
 * B3-K2 R10.9 differential harness, Node driver.
 *
 *   node harness.mjs replay CASES.json [--verbose]
 *
 * Reads the CPython case corpus produced by `gen-cases.py` (which drives
 * the REAL `mixpanel_headless._internal.bookmark_builders`), reconstructs
 * each input through the REAL ported classes, calls the REAL
 * `packages/core/src/bookmarks/builders.ts` through `.build/entry.mjs`,
 * and diffs outputs and coded errors.
 */

import { readFileSync } from "node:fs";
import {
  builders,
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  CustomPropertyRef,
  Filter,
  FrequencyBreakdown,
  FrequencyFilter,
  GroupBy,
  InlineCustomProperty,
  ListItemGroupMode,
  PropertyInput,
  TimeComparison,
} from "./.build/entry.mjs";

/** Index-for-index twin of `gen-cases.py::COHORT_DEFS`. */
const COHORT_DEFS = [
  CohortDefinition.allOf(
    CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
  ),
  CohortDefinition.anyOf(
    CohortCriteria.didEvent("Login", { at_least: 2, within_days: 7 }),
    CohortCriteria.propertyIsSet("plan"),
  ),
];

const CLASSES = {
  Filter,
  GroupBy,
  CohortBreakdown,
  FrequencyBreakdown,
  FrequencyFilter,
  PropertyInput,
  InlineCustomProperty,
  CustomPropertyRef,
  ListItemGroupMode,
  TimeComparison,
};

/** Field lists mirroring `gen-cases.py::_FIELDS`. */
const FIELDS = {
  Filter: [
    "_property",
    "_operator",
    "_value",
    "_property_type",
    "_resource_type",
    "_date_unit",
    "_list_item_filters",
    "_list_item_quantifier",
  ],
  GroupBy: [
    "property",
    "property_type",
    "bucket_size",
    "bucket_min",
    "bucket_max",
    "_list_item_mode",
  ],
  CohortBreakdown: ["cohort", "name", "include_negated"],
  FrequencyBreakdown: ["event", "bucket_size", "bucket_min", "bucket_max", "label"],
  FrequencyFilter: [
    "event",
    "value",
    "operator",
    "date_range_value",
    "date_range_unit",
    "event_filters",
    "label",
  ],
  PropertyInput: ["name", "type", "resource_type"],
  InlineCustomProperty: ["formula", "inputs", "property_type", "resource_type"],
  CustomPropertyRef: ["id"],
  ListItemGroupMode: ["sub", "sub_type"],
  TimeComparison: ["type", "unit", "date"],
};

/** Reconstruct a Python-encoded value into the TS value domain. */
function decode(value) {
  if (Array.isArray(value)) return value.map(decode);
  if (value === null || typeof value !== "object") return value;
  if (Object.hasOwn(value, "__f__") && Object.keys(value).length === 1) {
    return Number(value.__f__);
  }
  if (Object.hasOwn(value, "$")) {
    if (value.$ === "CohortDefRef") return COHORT_DEFS[value.i];
    const Klass = CLASSES[value.$];
    if (!Klass) throw new Error(`unknown class ${value.$}`);
    const fields = {};
    for (const key of FIELDS[value.$]) fields[key] = decode(value.f[key]);
    return new Klass(fields);
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = decode(v);
  return out;
}

/** Encode a TS builder result into the comparison form. */
function encode(value) {
  if (value === undefined) return { $undefined: true };
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(encode);
  const name = value.constructor?.name;
  if (name === "CohortDefinition") {
    const index = COHORT_DEFS.indexOf(value);
    return { $: "CohortDefRef", i: index };
  }
  if (FIELDS[name]) {
    const fields = {};
    for (const key of FIELDS[name]) fields[key] = encode(value[key]);
    return { $: name, f: fields };
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = encode(v);
  return out;
}

/**
 * Canonical JSON for comparison. Python `{"__f__": repr}` carriers and JS
 * numbers both collapse to the numeric value, so int-vs-float-ness is NOT
 * diffed here (documented in RUN.md; the real codecs carry it).
 */
function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value === null || typeof value !== "object") {
    if (typeof value === "number") {
      return Object.is(value, -0) ? "num:-0" : `num:${String(value)}`;
    }
    return value;
  }
  if (Object.hasOwn(value, "__f__") && Object.keys(value).length === 1) {
    const n = Number(value.__f__);
    return Object.is(n, -0) ? "num:-0" : `num:${String(n)}`;
  }
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = canon(value[key]);
  // Key ORDER is normalized (the conformance canonicalizer sorts dict
  // keys too); key PRESENCE is fully diffed.
  return out;
}

/** Call the TS twin for one case, returning the same outcome shape. */
function runTs(caseObj) {
  const api = caseObj.api;
  const input = {};
  for (const [k, v] of Object.entries(caseObj.input)) input[k] = decode(v);
  const dgid = input["data_group_id"] ?? null;
  try {
    let result;
    switch (api) {
      case "build_filter_entry":
        result = builders.buildFilterEntry(input["f"]);
        break;
      case "build_filter_section":
        result = builders.buildFilterSection(input["where"]);
        break;
      case "build_group_section":
        result = builders.buildGroupSection(input["group_by"], {
          data_group_id: dgid,
        });
        break;
      case "build_flow_property_filter":
        result = builders.buildFlowPropertyFilter(input["filters"]);
        break;
      case "build_flow_cohort_filter":
        result = builders.buildFlowCohortFilter(input["where"]);
        break;
      case "build_frequency_filter_entry":
        result = builders.buildFrequencyFilterEntry(input["ff"]);
        break;
      case "build_frequency_group_entry":
        result = builders.buildFrequencyGroupEntry(input["fb"], {
          data_group_id: dgid,
        });
        break;
      case "build_time_section":
        result = builders.buildTimeSection({
          from_date: input["from_date"],
          to_date: input["to_date"],
          last: input["last"],
          unit: input["unit"],
          today: () => caseObj.today,
        });
        break;
      case "build_date_range":
        result = builders.buildDateRange({
          from_date: input["from_date"],
          to_date: input["to_date"],
          last: input["last"],
        });
        break;
      case "build_time_comparison":
        result = builders.buildTimeComparison(input["tc"]);
        break;
      case "patch_custom_property_filters_for_transform":
        result = builders.patchCustomPropertyFiltersForTransform(
          input["filter_entries"],
        );
        break;
      case "_build_composed_properties":
        result = builders.buildComposedProperties(input["inputs"]);
        break;
      default:
        throw new Error(`unknown api ${api}`);
    }
    return { output: encode(result) };
  } catch (err) {
    return {
      error: {
        class: err?.constructor?.name ?? "Error",
        code: err?.code ?? null,
      },
    };
  }
}

function main() {
  const file = process.argv[3];
  const verbose = process.argv.includes("--verbose");
  const corpus = JSON.parse(readFileSync(file, "utf8"));
  let compared = 0;
  let divergences = 0;
  let classOnly = 0;
  const perApi = {};
  const samples = [];
  for (const caseObj of corpus.cases) {
    compared += 1;
    perApi[caseObj.api] = (perApi[caseObj.api] ?? 0) + 1;
    const actual = runTs(caseObj);
    const expectedJson = JSON.stringify(
      canon(caseObj.output !== undefined ? caseObj.output : null),
    );
    if (Object.hasOwn(caseObj, "output")) {
      const actualJson = Object.hasOwn(actual, "output")
        ? JSON.stringify(canon(actual.output))
        : `THREW ${JSON.stringify(actual.error)}`;
      if (actualJson !== expectedJson) {
        divergences += 1;
        if (samples.length < 12)
          samples.push({
            tag: caseObj.tag,
            api: caseObj.api,
            py: expectedJson.slice(0, 400),
            ts: actualJson.slice(0, 400),
            input: JSON.stringify(caseObj.input).slice(0, 400),
          });
      }
    } else {
      if (!Object.hasOwn(actual, "error")) {
        divergences += 1;
        if (samples.length < 12)
          samples.push({
            tag: caseObj.tag,
            api: caseObj.api,
            py: JSON.stringify(caseObj.error),
            ts: `NO THROW ${JSON.stringify(canon(actual.output)).slice(0, 200)}`,
            input: JSON.stringify(caseObj.input).slice(0, 400),
          });
      } else if (actual.error.code !== caseObj.error.code) {
        divergences += 1;
        if (samples.length < 12)
          samples.push({
            tag: caseObj.tag,
            api: caseObj.api,
            py: JSON.stringify(caseObj.error),
            ts: JSON.stringify(actual.error),
            input: JSON.stringify(caseObj.input).slice(0, 400),
          });
      } else if (actual.error.class !== caseObj.error.class) {
        // Coded raises agree; only the BUILTIN class spelling differs
        // (Caution 9 — the builtin-class convention is a rig decision at
        // the (b′) binding task). Counted separately, never hidden.
        classOnly += 1;
        if (verbose)
          console.log(
            `class-only ${caseObj.api} ${caseObj.tag}: py=${caseObj.error.class} ts=${actual.error.class}`,
          );
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        seed: corpus.seed,
        per_family: corpus.per_family,
        compared,
        divergences,
        class_only_error_spellings: classOnly,
        per_api: perApi,
      },
      null,
      1,
    ),
  );
  for (const s of samples) console.log("DIVERGENCE", JSON.stringify(s, null, 1));
  if (divergences > 0) process.exitCode = 1;
}

main();
