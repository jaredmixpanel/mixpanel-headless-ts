/**
 * B3-K3 R10.9 differential harness, Node driver.
 *
 *   node harness.mjs replay CASES.json [--verbose]
 *
 * Reads the CPython case corpus produced by `gen-cases.py` (which drives the
 * REAL `mixpanel_headless._internal.{segfilter,expressions,transforms}`),
 * reconstructs each input through the REAL ported `Filter` class, calls the
 * REAL `packages/core/src/query/*` modules through `.build/entry.mjs`, and
 * diffs outputs and errors BYTE-EXACTLY (no numeric-string normalization —
 * stricter than the conformance canonicalizer on purpose, so the R10.11
 * operand renderings are compared as written).
 */

import { readFileSync } from "node:fs";

import {
  buildSegfilterEntry,
  Filter,
  normalizeOnExpression,
  transformEvent,
  transformProfile,
} from "./.build/entry.mjs";

/** Twin of the conformance rig's PyFloat carrier (a CLASS instance). */
class PyFloat {
  constructor(spelling) {
    this.spelling = spelling;
  }
}

const FILTER_FIELDS = [
  "_property",
  "_operator",
  "_value",
  "_property_type",
  "_resource_type",
  "_date_unit",
  "_list_item_filters",
  "_list_item_quantifier",
];

/** Reconstruct a Python-encoded value into the TS value domain. */
function decode(value) {
  if (Array.isArray(value)) return value.map(decode);
  if (value === null || typeof value !== "object") return value;
  if (Object.hasOwn(value, "__f__") && Object.keys(value).length === 1) {
    return new PyFloat(value.__f__);
  }
  if (Object.hasOwn(value, "$dt") && Object.keys(value).length === 1) {
    return value.$dt;
  }
  if (Object.hasOwn(value, "$") && value.$ === "Filter") {
    const fields = {};
    for (const key of FILTER_FIELDS) fields[key] = decode(value.f[key]);
    return new Filter(fields);
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = decode(v);
  return out;
}

/** Encode a TS result into the same comparison form the generator emits. */
function encode(value, api) {
  if (value === undefined) return { $undefined: true };
  if (value === null || typeof value !== "object") {
    if (typeof value === "number") {
      // A bare JS number stands for a Python int here: every float the
      // generator drew crossed the boundary as a PyFloat carrier.
      return Number.isInteger(value) && Object.is(value, Math.trunc(value))
        ? value
        : { __f__: pythonFloatRepr(value) };
    }
    return value;
  }
  if (value instanceof PyFloat) return { __f__: value.spelling };
  if (Array.isArray(value)) return value.map((item) => encode(item, api));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = encode(v, api);
  return out;
}

/** CPython `repr(float)` for the handful of non-integral results. */
function pythonFloatRepr(value) {
  if (Number.isNaN(value)) return "nan";
  if (value === Infinity) return "inf";
  if (value === -Infinity) return "-inf";
  const text = String(value);
  return text.includes(".") || text.includes("e") ? text : `${text}.0`;
}

/** Canonical JSON for comparison — key order normalized, values verbatim. */
function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value === null || typeof value !== "object") {
    if (typeof value === "number") {
      return Object.is(value, -0) ? "num:-0" : `num:${String(value)}`;
    }
    return value;
  }
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = canon(value[key]);
  return out;
}

/** Call the TS twin for one case, returning the same outcome shape. */
function runTs(caseObj) {
  const input = {};
  for (const [k, v] of Object.entries(caseObj.input)) input[k] = decode(v);
  try {
    let result;
    switch (caseObj.api) {
      case "build_segfilter_entry":
        result = buildSegfilterEntry(input.f);
        break;
      case "normalize_on_expression":
        result = normalizeOnExpression(input.on);
        break;
      case "transform_event":
        result = transformEvent(input.event, { uuid: () => caseObj.uuid });
        // The ported library returns `event_time` as CPython isoformat
        // TEXT (packet design decision); the conformance binding wraps it
        // in `PyDatetime` so it encodes as {"$type":"datetime","iso":…}.
        // The harness mirrors that wrap — the generator emits Python's
        // `datetime` as {"$dt": isoformat()}, so this compares the SAME
        // bytes the binding will.
        result = { ...result, event_time: { $dt: result.event_time } };
        break;
      case "transform_profile":
        result = transformProfile(input.profile);
        break;
      default:
        throw new Error(`unknown api ${caseObj.api}`);
    }
    return { output: encode(result, caseObj.api) };
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
  const outcomes = {};
  const samples = [];
  for (const caseObj of corpus.cases) {
    compared += 1;
    perApi[caseObj.api] = (perApi[caseObj.api] ?? 0) + 1;
    const actual = runTs(caseObj);
    if (Object.hasOwn(caseObj, "output")) {
      outcomes.OK = (outcomes.OK ?? 0) + 1;
      const expectedJson = JSON.stringify(canon(caseObj.output));
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
      const key = caseObj.error.code ?? caseObj.error.class;
      outcomes[key] = (outcomes[key] ?? 0) + 1;
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
      } else if (
        actual.error.code !== caseObj.error.code ||
        actual.error.class !== caseObj.error.class
      ) {
        // Class AND code are both compared: the K3 builtin twins
        // (ValueError / OverflowError / AttributeError) exist precisely so
        // the bare class name matches CPython's.
        if (
          actual.error.code === caseObj.error.code &&
          actual.error.class !== caseObj.error.class
        ) {
          classOnly += 1;
        }
        divergences += 1;
        if (samples.length < 12)
          samples.push({
            tag: caseObj.tag,
            api: caseObj.api,
            py: JSON.stringify(caseObj.error),
            ts: JSON.stringify(actual.error),
            input: JSON.stringify(caseObj.input).slice(0, 400),
          });
      }
    }
    if (verbose && divergences > 0 && samples.length === 1) {
      console.log("first divergence", JSON.stringify(samples[0], null, 1));
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
        outcomes,
      },
      null,
      1,
    ),
  );
  for (const s of samples) console.log("DIVERGENCE", JSON.stringify(s, null, 1));
  if (divergences > 0) process.exitCode = 1;
}

main();
