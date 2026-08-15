// THROWAWAY (R10.9) — B2-M2 (validation.py shard V1b) edge + fuzz harness.
//
// Deleted by the B2 batch gate after arbiter sign-off (GF6 / B0-1
// precedent, throwaway/b0-1/run-fuzz.sh; B2-M1 precedent
// throwaway/b2-m1/harness.mjs, whose structure this file reuses).
//
// Arbiter: Python. The harness drives the REAL oracle-py JSON-RPC server
// (`uv run python -m conformance.oracle_py` in the Python repo) and the
// REAL TS validators (esbuild-bundled from packages/core/src), then diffs
// the `[{code, path, severity}]` arrays position-by-position (emission
// order is contract, b2-packets.md Cautions §11).
//
// Note (packet §V1b R10.9 harness spec): the packet routes the fuzz
// through `conformance/differential/strategies.py` + oracle-ts. oracle-ts
// cannot answer `validation.*` until the (b') binding commit lands, so
// this harness talks to oracle-py DIRECTLY and calls the TS functions
// in-process — same arbiter comparison, same budget. Formalising
// `bookmark_family` / `flow_bookmark_family` / `sorting_family` in
// strategies.py is deferred to (b'), exactly as B2-M1 deferred its five.
//
// Usage: node throwaway/b2-m2/harness.mjs [--seed N] [--runs N]

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TS_ROOT = path.resolve(HERE, "../..");
const PY_ROOT = path.resolve(TS_ROOT, "../mixpanel-headless");

// ---------------------------------------------------------------------------
// 1. Bundle the TS validators.
// ---------------------------------------------------------------------------

const esbuild = require("esbuild");
mkdirSync(path.join(HERE, ".build"), { recursive: true });
const BUNDLE = path.join(HERE, ".build", "validators.mjs");
await esbuild.build({
  entryPoints: [path.join(HERE, "entry.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: BUNDLE,
  logLevel: "warning",
});
const ts = await import(BUNDLE);

// ---------------------------------------------------------------------------
// 2. oracle-py client (newline-delimited JSON-RPC 2.0 over stdio).
// ---------------------------------------------------------------------------

class OraclePy {
  constructor() {
    this.proc = spawn("uv", ["run", "python", "-m", "conformance.oracle_py"], {
      cwd: PY_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.buf = "";
    this.pending = [];
    this.nextId = 1;
    this.stderr = "";
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => {
      this.buf += chunk;
      let idx;
      while ((idx = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + 1);
        const resolve = this.pending.shift();
        if (resolve) resolve(JSON.parse(line));
      }
    });
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
  }

  send(method, params) {
    const id = this.nextId++;
    const line = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const promise = new Promise((resolve) => this.pending.push(resolve));
    this.proc.stdin.write(line + "\n");
    return promise;
  }

  async call(api, input) {
    const res = await this.send("oracle.call", { api, input });
    if (res.error) return { error: res.error };
    return res.result;
  }

  async shutdown() {
    await this.send("oracle.shutdown", {});
    this.proc.stdin.end();
  }
}

// ---------------------------------------------------------------------------
// 3. Tagged-value materialisation.
//
// B2-M2 inputs are plain JSON dicts; the only tag that appears is
// `{$type:"float"}`. Binding policy (Caution §8, refined by this shard):
//   * NON-FINITE spellings unwrap to native JS non-finite numbers
//     (vector-codecs.ts:606-611 precedent) — B20B's `_is_finite` check.
//   * FINITE spellings stay PyFloat carriers, which is what makes
//     `isinstance(x, int)` fail in TS exactly where it fails in Python
//     (B18B customPropertyId, B22 cohort id).
//   * The sorting slice needs NO special rule: schema-sorting.ts is
//     carrier-aware on `int` fields (pydantic accepts integral floats),
//     so one params dict can carry both an isinstance-checked float and a
//     pydantic-checked float without a path-dependent binding hack.
// ---------------------------------------------------------------------------

class PyFloat {
  constructor(spelling) {
    this.spelling = spelling;
  }
}

function materialize(value) {
  if (Array.isArray(value)) return value.map(materialize);
  if (value !== null && typeof value === "object") {
    if (value.$type === "float") {
      const s = value.value;
      if (s === "NaN") return Number.NaN;
      if (s === "Infinity") return Number.POSITIVE_INFINITY;
      if (s === "-Infinity") return Number.NEGATIVE_INFINITY;
      return new PyFloat(s);
    }
    if (value.$type !== undefined) {
      throw new Error(`harness: unexpected $type ${value.$type}`);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = materialize(v);
    return out;
  }
  return value;
}

/** Encode a TS `ValidationError[]` the way the recorder codec does. */
function encodeErrors(errors) {
  return errors.map((e) => ({
    code: e.code,
    path: e.path,
    severity: e.severity,
  }));
}

const TS_APIS = {
  "validation.validate_bookmark": (input) =>
    ts.validateBookmark(
      materialize(input.params),
      input.bookmark_type === undefined
        ? {}
        : { bookmark_type: input.bookmark_type },
    ),
  "validation.validate_flow_bookmark": (input) =>
    ts.validateFlowBookmark(materialize(input.params)),
  "validation.validate_sorting_block": (input) =>
    ts.validateSortingBlock(materialize(input.sorting)),
};

// ---------------------------------------------------------------------------
// 4. Comparison driver.
// ---------------------------------------------------------------------------

const divergences = [];
const skips = [];
let compared = 0;

async function compare(oracle, label, api, input) {
  let tsOut;
  try {
    tsOut = encodeErrors(TS_APIS[api](input));
  } catch (err) {
    // The Layer-2 validators are total functions: a TS throw is either a
    // port bug or the documented `unhashable type` divergence. Ask Python
    // before deciding — a bilateral refusal is a skip, anything else is a
    // divergence.
    const probe = await oracle.call(api, input);
    if (probe.error) {
      skips.push({
        label,
        api,
        reason: `ts threw + python errored (${probe.error.code})`,
      });
    } else {
      divergences.push({ label, api, input, python: probe.output, tsError: String(err) });
    }
    return;
  }
  const res = await oracle.call(api, input);
  if (res.error) {
    // UNILATERAL skip: TS answered, Python raised. Every one of these is
    // recorded verbatim in the RUN record — the only sanctioned class is
    // the documented `unhashable type` TypeError (validation-bookmark.ts
    // module TODO(port)); anything else is a finding.
    const message = String(res.error.message ?? res.error.data ?? "");
    skips.push({
      label,
      api,
      reason: `python raised: ${(message || JSON.stringify(res.error)).slice(0, 200)}`,
      unilateral: true,
      input,
      ts: tsOut,
    });
    return;
  }
  compared += 1;
  const a = JSON.stringify(res.output);
  const b = JSON.stringify(tsOut);
  if (a !== b) {
    divergences.push({ label, api, input, python: res.output, ts: tsOut });
  }
}

// ---------------------------------------------------------------------------
// 5. Mandatory edge set (R10.9): the value edges per api + one explicit
//    call per code in the V1b inventory (corpus-present AND source-only).
// ---------------------------------------------------------------------------

const NON_BMP = "\u{1D4B3}"; // "𝒳"
const NUL = " ";
const ZWSP = "​";
const F = (spelling) => ({ $type: "float", value: spelling });

/** Minimal valid insights bookmark (test_validation.py `_minimal_bookmark`). */
const bm = (over = {}) => ({
  sections: {
    show: [
      {
        behavior: {
          type: "event",
          resourceType: "events",
          value: { name: "Login" },
        },
        measurement: { math: "total" },
      },
    ],
    time: [{ unit: "day", dateRangeType: "in the last", value: 30 }],
    filter: [],
    group: [],
  },
  displayOptions: { chartType: "line", analysis: "linear" },
  ...over,
});

/** Same, with a mutated single show clause. */
const bmShow = (clause) => bm({ sections: { ...bm().sections, show: [clause] } });
/** Same, with a single filter clause. */
const bmFilter = (f) => bm({ sections: { ...bm().sections, filter: [f] } });
/** Same, with a single group clause. */
const bmGroup = (g) => bm({ sections: { ...bm().sections, group: [g] } });
/** Same, with a single time clause. */
const bmTime = (t) => bm({ sections: { ...bm().sections, time: [t] } });
// (a bookmark-with-sorting helper is not needed: the sorting block is
// driven directly through validate_sorting_block and through the fuzz
// family's `params.sorting` key.)

/** Valid flow bookmark (test_validation_flow.py `_valid_flow_bookmark`). */
const fb = (over = {}) => ({
  steps: [{ event: "Purchase", forward: 3, reverse: 0 }],
  date_range: {
    type: "in the last",
    from_date: { unit: "day", value: 30 },
    to_date: "$now",
  },
  chartType: "sankey",
  count_type: "unique",
  version: 2,
  ...over,
});

const cohortShow = (behavior, measurement = { math: "unique" }) =>
  bmShow({ behavior, measurement });

const EDGES = [
  // ---- mandatory value edges, per api -------------------------------------
  ["value-edge/bookmark/integral-float", "validation.validate_bookmark", { params: bmFilter({ value: "c", filterValue: F("18.0") }) }],
  ["value-edge/bookmark/fractional-float", "validation.validate_bookmark", { params: bmFilter({ value: "c", filterValue: 1.5 }) }],
  ["value-edge/bookmark/true", "validation.validate_bookmark", { params: bmFilter({ value: true, customPropertyId: true }) }],
  ["value-edge/bookmark/none", "validation.validate_bookmark", { params: { sections: null, displayOptions: null } }],
  ["value-edge/bookmark/empty-list", "validation.validate_bookmark", { params: { sections: { show: [] }, displayOptions: {} } }],
  ["value-edge/bookmark/empty-string", "validation.validate_bookmark", { params: bmFilter({ value: "", propertyName: "" }) }],
  ["value-edge/bookmark/non-bmp", "validation.validate_bookmark", { params: bmShow({ behavior: { type: NON_BMP, value: { name: NON_BMP } }, measurement: { math: NON_BMP } }) }],
  ["value-edge/bookmark/bookmark-type-non-bmp", "validation.validate_bookmark", { params: bm(), bookmark_type: NON_BMP }],
  ["value-edge/flow-bookmark/integral-float-version", "validation.validate_flow_bookmark", { params: fb({ version: F("2.0") }) }],
  ["value-edge/flow-bookmark/fractional-version", "validation.validate_flow_bookmark", { params: fb({ version: 1.5 }) }],
  ["value-edge/flow-bookmark/true-version", "validation.validate_flow_bookmark", { params: fb({ version: true }) }],
  ["value-edge/flow-bookmark/none-count-type", "validation.validate_flow_bookmark", { params: fb({ count_type: null, chartType: null }) }],
  ["value-edge/flow-bookmark/empty-list-steps", "validation.validate_flow_bookmark", { params: fb({ steps: [] }) }],
  ["value-edge/flow-bookmark/empty-string-event", "validation.validate_flow_bookmark", { params: fb({ steps: [{ event: "" }] }) }],
  ["value-edge/flow-bookmark/non-bmp-event", "validation.validate_flow_bookmark", { params: fb({ steps: [{ event: NON_BMP }] }) }],
  ["value-edge/sorting/integral-float-viewn", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "value", sortOrder: "asc", colSortAttrs: [], viewNLimit: F("5.0") } } }],
  ["value-edge/sorting/fractional-viewn", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "value", sortOrder: "asc", colSortAttrs: [], viewNLimit: 1.5 } } }],
  ["value-edge/sorting/true-viewn", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "value", sortOrder: "asc", colSortAttrs: [], viewNLimit: true } } }],
  ["value-edge/sorting/none", "validation.validate_sorting_block", { sorting: null }],
  ["value-edge/sorting/empty-list", "validation.validate_sorting_block", { sorting: [] }],
  ["value-edge/sorting/empty-dict", "validation.validate_sorting_block", { sorting: {} }],
  ["value-edge/sorting/empty-string", "validation.validate_sorting_block", { sorting: "" }],
  ["value-edge/sorting/empty-string-key", "validation.validate_sorting_block", { sorting: { "": {} } }],
  ["value-edge/sorting/non-bmp-key", "validation.validate_sorting_block", { sorting: { [NON_BMP]: {} } }],
  ["value-edge/sorting/non-bmp-valuefield", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "value", sortOrder: "asc", colSortAttrs: [], valueField: NON_BMP } } }],

  // ---- one explicit call per code: validate_bookmark (B*) -----------------
  ["code/B1_MISSING_SECTIONS", "validation.validate_bookmark", { params: { displayOptions: { chartType: "line" } } }],
  ["code/B1_MISSING_SECTIONS/not-a-dict", "validation.validate_bookmark", { params: { sections: ["x"], displayOptions: { chartType: "line" } } }],
  ["code/B2_MISSING_DISPLAY_OPTIONS", "validation.validate_bookmark", { params: { sections: { show: [{ behavior: { type: "event" } }] } } }],
  ["code/B3_MISSING_SHOW", "validation.validate_bookmark", { params: { sections: { time: [], filter: [] }, displayOptions: { chartType: "line" } } }],
  ["code/B4_SHOW_EMPTY", "validation.validate_bookmark", { params: { sections: { show: [] }, displayOptions: { chartType: "line" } } }],
  ["code/B5_INVALID_CHART_TYPE", "validation.validate_bookmark", { params: bm({ displayOptions: { chartType: "barchart" } }) }],
  ["code/B5_INVALID_CHART_TYPE/missing", "validation.validate_bookmark", { params: bm({ displayOptions: { analysis: "linear" } }) }],
  ["code/B6_MISSING_BEHAVIOR", "validation.validate_bookmark", { params: bmShow({ measurement: { math: "total" } }) }],
  ["code/B6_MISSING_BEHAVIOR/not-a-dict-clause", "validation.validate_bookmark", { params: bmShow("nope") }],
  ["code/B6_MISSING_BEHAVIOR/behavior-not-a-dict", "validation.validate_bookmark", { params: bmShow({ behavior: "nope" }) }],
  ["code/B7_INVALID_BEHAVIOR_TYPE", "validation.validate_bookmark", { params: bmShow({ behavior: { type: "evnt", value: { name: "L" } } }) }],
  ["code/B8_MISSING_EVENT_NAME", "validation.validate_bookmark", { params: bmShow({ behavior: { type: "event" } }) }],
  ["code/B9_INVALID_MATH", "validation.validate_bookmark", { params: bmShow({ behavior: { type: "event", value: { name: "L" } }, measurement: { math: "totl" } }) }],
  ["code/B10_MATH_MISSING_PROPERTY", "validation.validate_bookmark", { params: bmShow({ behavior: { type: "event", value: { name: "L" } }, measurement: { math: "average" } }) }],
  ["code/B11_INVALID_PER_USER", "validation.validate_bookmark", { params: bmShow({ behavior: { type: "event", value: { name: "L" } }, measurement: { math: "total", perUserAggregation: "nope" } }) }],
  ["code/B12_INVALID_TIME_UNIT", "validation.validate_bookmark", { params: bmTime({ unit: "fortnite" }) }],
  ["code/B12_INVALID_TIME_UNIT/not-a-dict", "validation.validate_bookmark", { params: bmTime("nope") }],
  ["code/B13_INVALID_DATE_RANGE_TYPE", "validation.validate_bookmark", { params: bmTime({ unit: "day", dateRangeType: "whenever" }) }],
  ["code/B14_INVALID_FILTER_TYPE", "validation.validate_bookmark", { params: bmFilter({ filterType: "nope", filterOperator: "equals", value: "country", filterValue: ["US"] }) }],
  ["code/B14_INVALID_FILTER_TYPE/not-a-dict", "validation.validate_bookmark", { params: bmFilter("nope") }],
  ["code/B15_INVALID_FILTER_OPERATOR", "validation.validate_bookmark", { params: bmFilter({ filterType: "string", filterOperator: "approximately", value: "country", filterValue: ["US"] }) }],
  ["code/B16_INVALID_RESOURCE_TYPE", "validation.validate_bookmark", { params: bmGroup({ propertyName: "p", resourceType: "BOGUS" }) }],
  ["code/B17_INVALID_PROPERTY_TYPE", "validation.validate_bookmark", { params: bmGroup({ propertyName: "p", propertyType: "FAKE" }) }],
  ["code/B17_INVALID_PROPERTY_TYPE/not-a-dict", "validation.validate_bookmark", { params: bmGroup("nope") }],
  ["code/B18_MISSING_FILTER_PROPERTY", "validation.validate_bookmark", { params: bmFilter({ filterType: "string", filterOperator: "equals", filterValue: ["US"] }) }],
  ["code/B18B_INVALID_CP_ID", "validation.validate_bookmark", { params: bmFilter({ customPropertyId: 0 }) }],
  ["code/B18B_INVALID_CP_ID/float", "validation.validate_bookmark", { params: bmFilter({ customPropertyId: F("42.0") }) }],
  ["code/B18B_INVALID_CP_ID/bool", "validation.validate_bookmark", { params: bmFilter({ customPropertyId: true }) }],
  ["code/B19_INVALID_FILTERS_DETERMINER", "validation.validate_bookmark", { params: bmShow({ behavior: { type: "event", value: { name: "L" }, filtersDeterminer: "some" } }) }],
  ["code/B20_EMPTY_FILTER_VALUE", "validation.validate_bookmark", { params: bmFilter({ value: "country", filterValue: [] }) }],
  ["code/B20B_FILTER_VALUE_NOT_FINITE", "validation.validate_bookmark", { params: bmFilter({ value: "c", filterValue: F("Infinity") }) }],
  ["code/B20B_FILTER_VALUE_NOT_FINITE/nan-in-list", "validation.validate_bookmark", { params: bmFilter({ value: "c", filterValue: [1, F("NaN"), F("-Infinity")] }) }],
  ["code/B21_FILTER_VALUE_TOO_MANY", "validation.validate_bookmark", { params: bmFilter({ value: "c", filterValue: Array.from({ length: 1001 }, (_u, i) => `v${i}`) }) }],
  ["code/B22_COHORT_BEHAVIOR_ID", "validation.validate_bookmark", { params: cohortShow({ type: "cohort", id: 0, resourceType: "cohorts" }) }],
  ["code/B22_COHORT_BEHAVIOR_ID/bool-true", "validation.validate_bookmark", { params: cohortShow({ type: "cohort", id: true, resourceType: "cohorts" }) }],
  ["code/B22_COHORT_BEHAVIOR_ID/bool-false", "validation.validate_bookmark", { params: cohortShow({ type: "cohort", id: false, resourceType: "cohorts" }) }],
  ["code/B22_COHORT_MISSING_IDENTIFIER", "validation.validate_bookmark", { params: cohortShow({ type: "cohort", resourceType: "cohorts" }) }],
  ["code/B23_COHORT_RESOURCE_TYPE", "validation.validate_bookmark", { params: cohortShow({ type: "cohort", id: 1, resourceType: "events" }) }],
  ["code/B24_COHORT_MATH", "validation.validate_bookmark", { params: cohortShow({ type: "cohort", id: 1, resourceType: "cohorts" }, { math: "total" }) }],
  ["code/B25_COHORT_FILTER_VALUE", "validation.validate_bookmark", { params: bmFilter({ resourceType: "events", filterType: "list", value: "wrong", filterOperator: "contains", filterValue: [{ cohort: { id: 1, name: "PU", negated: false } }] }) }],
  ["code/B26_EMPTY_COHORTS", "validation.validate_bookmark", { params: bmGroup({ propertyName: "p", cohorts: [] }) }],
  ["code/bookmark-type/funnels", "validation.validate_bookmark", { params: bmShow({ behavior: { type: "funnel" }, measurement: { math: "dau" } }), bookmark_type: "funnels" }],
  ["code/bookmark-type/retention", "validation.validate_bookmark", { params: bmShow({ behavior: { type: "event", value: { name: "S" } }, measurement: { math: "dau" } }), bookmark_type: "retention" }],

  // ---- one explicit call per code: validate_flow_bookmark (FLB*) ----------
  ["code/FLB1_EMPTY_STEPS", "validation.validate_flow_bookmark", { params: fb({ steps: [] }) }],
  ["code/FLB1_EMPTY_STEPS/not-a-list", "validation.validate_flow_bookmark", { params: fb({ steps: "Purchase" }) }],
  ["code/FLB2_EMPTY_STEP_EVENT", "validation.validate_flow_bookmark", { params: fb({ steps: [{ event: "   " }] }) }],
  ["code/FLB2_EMPTY_STEP_EVENT/control-char", "validation.validate_flow_bookmark", { params: fb({ steps: [{ event: `A${NUL}B` }] }) }],
  ["code/FLB2_EMPTY_STEP_EVENT/zwsp", "validation.validate_flow_bookmark", { params: fb({ steps: [{ event: ZWSP }] }) }],
  ["code/FLB3_INVALID_COUNT_TYPE", "validation.validate_flow_bookmark", { params: fb({ count_type: "uniqe" }) }],
  ["code/FLB4_INVALID_CHART_TYPE", "validation.validate_flow_bookmark", { params: fb({ chartType: "sanke" }) }],
  ["code/FLB5_MISSING_DATE_RANGE", "validation.validate_flow_bookmark", { params: (() => { const p = fb(); delete p.date_range; return p; })() }],
  ["code/FLB6_INVALID_VERSION", "validation.validate_flow_bookmark", { params: fb({ version: 1 }) }],

  // ---- one explicit call per code: sorting (S*) ---------------------------
  ["code/S1_INVALID_SORT_BY", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "totally bogus", colSortAttrs: [] } } }],
  ["code/S2_MISSING_COL_SORT_ATTRS", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "value" } } }],
  ["code/S3_UNKNOWN_FIELD", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "value", colSortAttrs: [], segmentation: "x" } } }],
  ["code/S3_UNKNOWN_FIELD/whole-chart-type", "validation.validate_sorting_block", { sorting: { sankey: { sortBy: "value" } } }],
  ["code/S4_UNKNOWN_CHART_TYPE", "validation.validate_sorting_block", { sorting: { barz: { sortBy: "column", colSortAttrs: [] } } }],
  ["code/S5_NOT_A_DICT", "validation.validate_sorting_block", { sorting: ["asc"] }],
  ["code/S5_NOT_A_DICT/config", "validation.validate_sorting_block", { sorting: { bar: "asc" } }],
  ["code/S5_NOT_A_DICT/col-elem", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "column", colSortAttrs: ["x"] } } }],
  ["code/S6_INVALID_SORT_ORDER", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "value", sortOrder: "ascending", colSortAttrs: [] } } }],
  ["code/S7_NOT_A_LIST", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "column", colSortAttrs: {} } } }],
  ["code/S7_NOT_A_LIST/null", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "column", colSortAttrs: null } } }],
  ["code/S8_MISSING_SORT_BY", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "column", colSortAttrs: [{ sortOrder: "asc" }] } } }],
  ["code/S9_MISSING_SORT_ORDER", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "column", colSortAttrs: [{ sortBy: "label" }] } } }],
  // Sorting fallbacks (source-present, corpus-silent per the packet):
  ["code/B0_WRONG_TYPE/string_type", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "value", sortOrder: "asc", colSortAttrs: [], valueField: 3 } } }],
  ["code/B0_WRONG_TYPE/int_parsing", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "value", sortOrder: "asc", colSortAttrs: [], viewNLimit: "x" } } }],
  ["code/B0_WRONG_TYPE/int_type", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "value", sortOrder: "asc", colSortAttrs: [], viewNLimit: [] } } }],
  ["code/B0_INVALID_LITERAL", "validation.validate_sorting_block", { sorting: { table: { sortBy: "value", sortOrder: "asc", sortColumn: "nope", colSortAttrs: [] } } }],
  ["code/VALIDATION_ERROR/int_from_float", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "value", sortOrder: "asc", colSortAttrs: [], viewNLimit: 5.5 } } }],
  ["code/VALIDATION_ERROR/finite_number", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "value", sortOrder: "asc", colSortAttrs: [], viewNLimit: F("NaN") } } }],
  // B0_MISSING_FIELD and B0_VALIDATOR_ERROR are UNREACHABLE through
  // validate_sorting_block (notes §probe finding 5): every required field
  // is sortBy/sortOrder/colSortAttrs (→ S8/S9/S2) or sortColumn, whose
  // `missing` cannot fire because `_table_sort_discriminator` only routes
  // to OldTableSortByValue when the key is PRESENT; and no sorting model
  // declares a @field_validator. The two calls below pin the reachable
  // neighbours of those branches (strategies.py:253-257 style).
  ["code/B0_MISSING_FIELD/nearest-reachable", "validation.validate_sorting_block", { sorting: { table: { sortColumn: null, sortOrder: "asc", colSortAttrs: [] } } }],
  ["code/B0_VALIDATOR_ERROR/nearest-reachable", "validation.validate_sorting_block", { sorting: { table: { sortBy: "value", sortOrder: "asc", sortColumn: null, colSortAttrs: [] } } }],

  // ---- pydantic lax-coercion grammar (probe-pinned, notes finding 4) ------
  ...[
    "5", " 5 ", " 5", "﻿5", "5", "+5", "-5", "1_0", "1__0",
    "_1", "1_", "0x5", "5.0", "5.", ".5", "1e3", "10.01", "1.0_0", "٤٢",
    "９", "", "  ", "9007199254740993", "1.000000000000000000000000",
    "1.0000000000000001", "  +1_0.0  ", `5${ZWSP}`,
  ].map((s) => [
    `coerce/int-from-string/${JSON.stringify(s)}`,
    "validation.validate_sorting_block",
    { sorting: { bar: { sortBy: "value", sortOrder: "asc", colSortAttrs: [], viewNLimit: s } } },
  ]),

  // ---- emission-order pins (Caution §11) ----------------------------------
  ["order/sorting/field-order-then-extras", "validation.validate_sorting_block", { sorting: { pie: { sortBy: "nope", colSortAttrs: [] }, sankey: {}, bar: { sortBy: "nope", colSortAttrs: [] }, "funnel-steps": { sortBy: "nope", colSortAttrs: [] }, column: {}, table: { sortBy: "nope", colSortAttrs: [] }, barz: {} } }],
  ["order/sorting/two-extras-two-fields", "validation.validate_sorting_block", { sorting: { bar: { zz: 1, sortBy: "nope", aa: 2, colSortAttrs: [] } } }],
  ["order/sorting/nested-cols", "validation.validate_sorting_block", { sorting: { bar: { sortBy: "column", colSortAttrs: [{ sortBy: "label" }, { sortBy: "value", sortOrder: "x" }, {}] } } }],
  ["order/bookmark/all-sections", "validation.validate_bookmark", { params: { sections: { show: [{ behavior: { type: "bogus" } }, { measurement: {} }], time: [{ unit: "nope" }], filter: [{ filterType: "nope" }], group: [{ propertyType: "nope" }] }, displayOptions: { chartType: "nope" }, sorting: { bar: { sortBy: "nope" } } } }],
];

// ---------------------------------------------------------------------------
// 6. Fixed-budget fuzz (>=500 examples per api family, derandomised).
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const SEED = Number(argv[argv.indexOf("--seed") + 1] || 20260815);
const RUNS = Number(argv[argv.indexOf("--runs") + 1] || 600);

/** mulberry32 — derandomised PRNG so a recorded seed replays exactly. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(SEED);
const pick = (xs) => xs[Math.floor(rng() * xs.length)];
const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const maybe = (p, v) => (rng() < p ? v : undefined);

const STR_POOL = ["Login", "", "  ", NON_BMP, `A${NUL}B`, ZWSP, "country"];
const MATH_POOL = ["total", "unique", "average", "median", "dau", "wau", "retention_rate", "conversion_rate_unique", "totl", "", NON_BMP, null, 5, []];
const BTYPE_POOL = ["event", "simple", "custom-event", "cohort", "funnel", "formula", "evnt", null, "", 7];
const CHART_POOL = ["line", "bar", "table", "sankey", "funnel-steps", "barchart", "", NON_BMP, null, 3];
const RT_POOL = [null, "events", "people", "cohorts", "BOGUS", "", 4];
const PT_POOL = [null, "string", "number", "boolean", "datetime", "list", "FAKE", ""];
const OP_POOL = [null, "equals", "contains", "does not contain", "in", "approximately", "was on", "", NON_BMP];
const UNIT_POOL = [null, "day", "week", "month", "hour", "fortnite", "", 2];
const DRT_POOL = [null, "in the last", "between", "since", "on", "relative_after", "whenever", ""];
const CPID_POOL = [undefined, null, 0, 1, -3, true, false, 1.5, F("42.0"), "42", []];
const FV_POOL = [
  undefined, null, [], ["US"], [1, 2, 3], "2024-01-01", 5, F("NaN"),
  F("Infinity"), F("-Infinity"), [F("NaN"), 1], [{ cohort: { id: 1 } }],
  [{ notcohort: 1 }], {},
];
const SORTBY_POOL = ["value", "column", "label", "liftComparisonValue", "bogus", "", null, [], 5];
const SORTORDER_POOL = [undefined, "asc", "desc", "ascending", "", null, 3];
const VIEWN_POOL = [undefined, null, 5, 0, -1, 5.5, true, "5", "x", " 5 ", F("5.0"), F("NaN"), [], {}];
const VF_POOL = [undefined, null, "averageValue", "", 3, true, NON_BMP, []];
const CHART_KEY_POOL = ["bar", "table", "line", "pie", "insights-metric", "retention-curve", "funnel-steps", "sankey", "column", "barz", "", NON_BMP];

/** Drop `undefined` values so the JSON payload matches "key absent". */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function randFlatSortAttr() {
  return compact({
    sortBy: pick(SORTBY_POOL),
    sortOrder: pick(SORTORDER_POOL),
    valueField: pick(VF_POOL),
    viewNLimit: pick(VIEWN_POOL),
    ...(rng() < 0.15 ? { colSortAttrs: [] } : {}),
    ...(rng() < 0.1 ? { zz: 1 } : {}),
  });
}

function randSortConfig() {
  const r = rng();
  if (r < 0.08) return pick(["asc", 5, [], null, true]);
  return compact({
    sortBy: pick(SORTBY_POOL),
    sortOrder: pick(SORTORDER_POOL),
    valueField: pick(VF_POOL),
    viewNLimit: pick(VIEWN_POOL),
    sortColumn: maybe(0.2, pick([null, "Linear", "sum", "value", "nope"])),
    colSortAttrs: maybe(
      0.6,
      pick([
        [],
        [randFlatSortAttr()],
        [randFlatSortAttr(), randFlatSortAttr()],
        "x",
        {},
        null,
        [null],
      ]),
    ),
    ...(rng() < 0.15 ? { segmentation: "value" } : {}),
  });
}

function randSorting() {
  const r = rng();
  if (r < 0.06) return pick(["asc", [], null, 5, true]);
  const out = {};
  const n = int(0, 3);
  for (let i = 0; i < n; i++) {
    out[pick(CHART_KEY_POOL)] = rng() < 0.1 ? null : randSortConfig();
  }
  return out;
}

function randBehavior() {
  return compact({
    type: pick(BTYPE_POOL),
    name: maybe(0.3, pick(STR_POOL)),
    value: maybe(0.6, pick([{ name: pick(STR_POOL) }, {}, null, "x", { name: null }])),
    id: maybe(0.5, pick([1, 0, -1, true, false, null, 1.5, F("3.0"), "7"])),
    raw_cohort: maybe(0.2, pick([null, { selector: {} }])),
    resourceType: pick(RT_POOL),
    filtersDeterminer: maybe(0.3, pick([null, "all", "any", "some", 3])),
    filters: maybe(0.3, pick([[], [randFilter()], "x"])),
  });
}

function randFilter() {
  return compact({
    filterType: pick(PT_POOL),
    filterOperator: pick(OP_POOL),
    value: maybe(0.7, pick([...STR_POOL, "$cohorts", null, 0, [], {}])),
    propertyName: maybe(0.3, pick(STR_POOL)),
    customPropertyId: pick(CPID_POOL),
    customProperty: maybe(0.15, pick([null, { displayFormula: "A" }])),
    resourceType: pick(RT_POOL),
    filterValue: pick(FV_POOL),
  });
}

function randShowClause() {
  const r = rng();
  if (r < 0.06) return pick(["x", null, 5, []]);
  return compact({
    formula: maybe(0.15, pick(["", { definition: "A/B" }])),
    type: maybe(0.2, pick(["formula", "metric", null])),
    behavior: maybe(0.85, pick([randBehavior(), null, "x", {}])),
    measurement: maybe(
      0.8,
      compact({
        math: pick(MATH_POOL),
        property: maybe(0.4, pick([null, { type: pick(PT_POOL), resourceType: pick(RT_POOL) }, "x"])),
        perUserAggregation: maybe(0.3, pick([null, "total", "average", "nope"])),
      }),
    ),
  });
}

const FAMILIES = {
  "validation.validate_bookmark": () => {
    const sections = compact({
      show: maybe(
        0.9,
        pick([
          [],
          [randShowClause()],
          [randShowClause(), randShowClause()],
          "x",
          null,
        ]),
      ),
      time: maybe(0.7, pick([[], [compact({ unit: pick(UNIT_POOL), dateRangeType: pick(DRT_POOL) })], "x", [null]])),
      filter: maybe(0.7, pick([[], [randFilter()], [randFilter(), randFilter()], "x", [null]])),
      group: maybe(0.7, pick([[], [compact({ propertyName: pick(STR_POOL), propertyType: pick(PT_POOL), resourceType: pick(RT_POOL), cohorts: maybe(0.4, pick([null, [], [{ id: 1 }], "x"])) })], [null]])),
    });
    return compact({
      params: compact({
        sections: rng() < 0.9 ? sections : pick(["x", null, []]),
        displayOptions: maybe(0.9, pick([{ chartType: pick(CHART_POOL) }, {}, "x", null])),
        sorting: maybe(0.35, randSorting()),
      }),
      bookmark_type: maybe(0.4, pick(["insights", "funnels", "retention", "bogus"])),
    });
  },
  "validation.validate_flow_bookmark": () => ({
    params: compact({
      steps: maybe(
        0.9,
        pick([
          [],
          [compact({ event: pick(STR_POOL) })],
          [compact({ event: pick(STR_POOL) }), compact({ event: pick(STR_POOL) })],
          [null],
          ["Purchase"],
          "Purchase",
          [{}],
        ]),
      ),
      date_range: maybe(0.7, pick([null, { type: "in the last" }, "x"])),
      chartType: maybe(0.8, pick(["sankey", "top-paths", "tree", "sanke", "", null, NON_BMP, 5])),
      count_type: maybe(0.8, pick(["unique", "total", "session", "uniqe", "", null, 7])),
      version: maybe(0.85, pick([2, 1, 3, "2", true, null, F("2.0"), 2.5])),
    }),
  }),
  "validation.validate_sorting_block": () => ({ sorting: randSorting() }),
};

// ---------------------------------------------------------------------------
// 7. Run.
// ---------------------------------------------------------------------------

const oracle = new OraclePy();
const info = await oracle.send("oracle.info", {});
const perFamily = {};

for (const [label, api, input] of EDGES) {
  await compare(oracle, label, api, input);
}
const edgeCount = compared;

for (const [api, gen] of Object.entries(FAMILIES)) {
  const before = compared;
  for (let i = 0; i < RUNS; i++) {
    await compare(oracle, `fuzz/${api}#${i}`, api, gen());
  }
  perFamily[api] = compared - before;
}

await oracle.shutdown();

const report = {
  task: "B2-M2 (validation.py shard V1b)",
  seed: SEED,
  runs_per_family: RUNS,
  oracle_info: info.result,
  edge_calls: EDGES.length,
  edge_compared: edgeCount,
  fuzz_compared_per_family: perFamily,
  total_compared: compared,
  skips: skips.length,
  skip_reasons: [...new Set(skips.map((s) => s.reason))],
  skip_breakdown: Object.entries(
    skips.reduce((acc, s) => {
      const key = `${s.api} :: ${s.reason}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .sort()
    .map(([key, count]) => ({ key, count })),
  skip_detail: skips.slice(0, 20),
  divergences: divergences.length,
  divergence_detail: divergences.slice(0, 20),
};
writeFileSync(
  path.join(HERE, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
process.exit(divergences.length === 0 ? 0 : 1);
