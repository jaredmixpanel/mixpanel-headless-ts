// THROWAWAY (R10.9) — B2-M3 (`query/user_validators.py` shard V2)
// edge + fuzz differential harness.
//
// Deleted by the B2 batch gate after arbiter sign-off (GF6 / B0-1
// precedent, throwaway/b0-1/run-fuzz.sh; B2-M1 precedent,
// throwaway/b2-m1/harness.mjs — this file follows its structure).
//
// Arbiter: Python. The harness drives the REAL oracle-py JSON-RPC
// server (`uv run python -m conformance.oracle_py` in the Python repo,
// which runs under the D1.4 frozen clock RECORD_EPOCH
// 2026-01-15T12:00:00Z) and the REAL TS validators (esbuild-bundled
// from packages/core/src), then diffs the `[{code, path, severity}]`
// arrays position-by-position (emission order is contract,
// b2-packets.md Cautions §11).
//
// Note (packet §V2 R10.9 harness spec): the packet routes the fuzz
// through `conformance/differential/strategies.py` + oracle-ts.
// oracle-ts cannot answer `user_validators.*` until the (b′) binding
// commit lands, so this harness talks to oracle-py DIRECTLY and calls
// the TS functions in-process. Formalising `user_args_family` /
// `user_params_family` in strategies.py is deferred to (b′); the
// arbiter comparison performed here is the same one (Python answers,
// TS answers, byte-diff the encoded output).
//
// Usage: node throwaway/b2-m3/harness.mjs [--seed N] [--runs N]

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TS_ROOT = path.resolve(HERE, "../..");
const PY_ROOT = path.resolve(TS_ROOT, "../mixpanel-headless");

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
let SEED = 0;
for (const ch of String(argOf("--seed", "20260815"))) {
  SEED = (SEED * 10 + (ch.charCodeAt(0) - 0x30)) >>> 0;
}
let RUNS = 0;
for (const ch of String(argOf("--runs", "700"))) {
  RUNS = RUNS * 10 + (ch.charCodeAt(0) - 0x30);
}

// The oracle-py clock freeze (conformance/record/clock.py:27
// RECORD_EPOCH = "2026-01-15T12:00:00Z") is what `date.today()` sees
// on the Python side, so the TS side is handed the same date through
// the `today` seam. The U8 boundary edge calls below (frozen-1 /
// frozen / frozen+1) would fail loudly if this were wrong.
const FROZEN_TODAY = "2026-01-15";

// ---------------------------------------------------------------------------
// 1. Bundle the TS validators.
// ---------------------------------------------------------------------------

const esbuild = require("esbuild");
mkdirSync(path.join(HERE, ".build"), { recursive: true });
const BUNDLE = path.join(HERE, ".build", "user-validators.mjs");
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
// 3. Tagged-value materialisation (mirror of conformance/record/codecs.py
//    `decode_value` for the tags this harness emits).
// ---------------------------------------------------------------------------

/** Stand-in for the runner's PyFloat carrier (`codecs.ts` `PyFloat`). */
class PyFloat {
  constructor(spelling) {
    this.spelling = spelling;
  }
}

function materialize(value) {
  if (Array.isArray(value)) return value.map(materialize);
  if (value !== null && typeof value === "object") {
    const tag = value.$type;
    if (tag === undefined) {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = materialize(v);
      return out;
    }
    if (tag === "float") {
      // Caution §8: the non-finite spellings unwrap to native JS
      // numbers (vector-codecs.ts:606-611 precedent); an integral
      // finite spelling stays a carrier unless the api-level UNWRAP
      // table (below) says otherwise.
      const s = value.value;
      if (s === "NaN") return Number.NaN;
      if (s === "Infinity") return Number.POSITIVE_INFINITY;
      if (s === "-Infinity") return Number.NEGATIVE_INFINITY;
      return new PyFloat(s);
    }
    if (tag === "Filter") {
      const fields = {};
      for (const [k, v] of Object.entries(value)) {
        if (k !== "$type") fields[k] = materialize(v);
      }
      return new ts.Filter(fields);
    }
    if (tag === "CustomPropertyRef") {
      return new ts.CustomPropertyRef(value.id);
    }
    if (tag === "CohortCriteria") {
      const bag = {};
      for (const [k, v] of Object.entries(value)) {
        if (k !== "$type") bag[k] = materialize(v);
      }
      return new ts.CohortCriteria(bag);
    }
    if (tag === "CohortDefinition") {
      const criteria = value._criteria.map(materialize);
      return value._operator === "or"
        ? ts.CohortDefinition.anyOf(...criteria)
        : ts.CohortDefinition.allOf(...criteria);
    }
    throw new Error(`harness: no ctor for $type ${tag}`);
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

/**
 * PyFloat carrier policy for the V2 surface (the finding handed to the
 * (b′) binding task, mirroring B2-M1's table).
 *
 * `user_validators.py` contains **no** `isinstance(x, int)` /
 * `isinstance(x, float)` test at all (measured 2026-08-15: the only
 * isinstance calls are against `str`, `Filter`, `CohortDefinition`,
 * `dict` and `list`). Every numeric argument is used in a pure
 * NUMERIC comparison, so a PyFloat carrier MUST reach TS as a native
 * number or the comparison silently flips:
 *
 *   - `limit`        -> U3  (`limit <= 0`)
 *   - `percentile`   -> U28 (`0 < percentile < 100`)
 *   - `workers`      -> U23 (`workers < 1 or workers > 5`)
 *   - `segment_by[i]`-> U17 (`sid <= 0`)  [element-level unwrap]
 *
 * `cohort` and `as_of` accept numbers too but are only tested for
 * `is None` / `isinstance(str)` / `isinstance(CohortDefinition)`, all
 * of which a carrier answers identically — they are left alone.
 */
const UNWRAP_SCALAR = ["limit", "percentile", "workers"];
const UNWRAP_LIST = ["segment_by"];

function unwrapFloat(v) {
  if (v !== null && typeof v === "object" && v.$type === "float") {
    const s = v.value;
    if (s === "NaN") return Number.NaN;
    if (s === "Infinity") return Number.POSITIVE_INFINITY;
    if (s === "-Infinity") return Number.NEGATIVE_INFINITY;
    // Verbatim CPython repr of a float; the harness stands in for the
    // binding's pythonFloat-based unwrap.
    return Number(s);
  }
  return v;
}

// Self-test switch for the review pair: `--break-unwrap` disables the
// carrier unwrap, which MUST make the harness report divergences (it
// proves the comparison is not vacuous).
const BREAK_UNWRAP = argv.includes("--break-unwrap");

function applyUnwrap(api, input) {
  if (BREAK_UNWRAP) return input;
  if (api !== "user_validators.validate_user_args") return input;
  const out = { ...input };
  for (const k of UNWRAP_SCALAR) {
    if (k in out) out[k] = unwrapFloat(out[k]);
  }
  for (const k of UNWRAP_LIST) {
    if (Array.isArray(out[k])) out[k] = out[k].map(unwrapFloat);
  }
  return out;
}

const TS_APIS = {
  "user_validators.validate_user_args": (input) =>
    ts.validateUserArgs({ ...input, today: () => FROZEN_TODAY }),
  "user_validators.validate_user_params": (input) =>
    ts.validateUserParams(input.params),
};

// ---------------------------------------------------------------------------
// 4. Comparison driver.
// ---------------------------------------------------------------------------

const divergences = [];
const skips = [];
const codesSeen = new Set();
let compared = 0;

async function compare(oracle, label, api, input) {
  let tsOut;
  try {
    tsOut = encodeErrors(TS_APIS[api](materialize(applyUnwrap(api, input))));
  } catch (err) {
    if (err instanceof ts.ParamValidationError) {
      // A constructor guard rejected the payload before the validator
      // ran. Verify BILATERALLY that Python's `decode_value` (which
      // builds the real dataclasses, so the same `__post_init__` guard
      // fires) also refuses it — otherwise the skip would hide a
      // divergence.
      const probe = await oracle.call(api, input);
      if (probe.error) {
        skips.push({
          label,
          api,
          reason: `ctor guard ${err.code ?? "?"} (python decode also rejects)`,
        });
      } else {
        divergences.push({
          label,
          api,
          input,
          python: probe.output,
          tsError: String(err),
        });
      }
      return;
    }
    divergences.push({ label, api, input, tsError: String(err) });
    return;
  }
  const res = await oracle.call(api, input);
  if (res.error) {
    // Two distinguishable oracle failures:
    //   * protocol/decode refusal — `{code, message}` (JSON-RPC error);
    //   * the ported function RAISED — `{class: "TypeError", …}` in the
    //     result payload (`{"ok": false, "error": {...}}`).
    // Both are recorded WITH the input and the TS answer so the review
    // pair can audit that none of them hides a divergence.
    skips.push({
      label,
      api,
      input,
      reason:
        res.error.class !== undefined
          ? `python raised ${res.error.class}`
          : `oracle error ${res.error.code}: ${res.error.message}`,
      tsOut,
    });
    return;
  }
  compared += 1;
  for (const e of res.output ?? []) codesSeen.add(e.code);
  const a = JSON.stringify(res.output);
  const b = JSON.stringify(tsOut);
  if (a !== b) {
    divergences.push({ label, api, input, python: res.output, ts: tsOut });
  }
}

// ---------------------------------------------------------------------------
// 5. Mandatory edge set (R10.9): the seven value edges per api + one
//    explicit call per code in the §V2 inventory (corpus-present AND
//    the corpus-silent U24), plus the `today`-seam boundary.
// ---------------------------------------------------------------------------

const ARGS = "user_validators.validate_user_args";
const PARAMS = "user_validators.validate_user_params";
const NON_BMP = "\u{1D4B3}"; // "𝒳"
const F = (spelling) => ({ $type: "float", value: spelling });

const strFilter = (property, value) => ({
  $type: "Filter",
  _property: property,
  _operator: "equals",
  _value: [value],
  _property_type: "string",
  _resource_type: "events",
  _date_unit: null,
  _list_item_filters: null,
  _list_item_quantifier: null,
});
const cohortFilter = (id, negated) => ({
  $type: "Filter",
  _property: "$cohorts",
  _operator: negated ? "does not contain" : "contains",
  _value: [{ cohort: { negated, name: "", id } }],
  _property_type: "list",
  _resource_type: "events",
  _date_unit: null,
  _list_item_filters: null,
  _list_item_quantifier: null,
});
const refFilter = (id) => ({
  $type: "Filter",
  _property: { $type: "CustomPropertyRef", id },
  _operator: "equals",
  _value: ["x"],
  _property_type: "string",
  _resource_type: "events",
  _date_unit: null,
  _list_item_filters: null,
  _list_item_quantifier: null,
});
const cohortDef = (operator) => ({
  $type: "CohortDefinition",
  _criteria: [
    {
      $type: "CohortCriteria",
      _selector_node: {
        property: "behaviors",
        value: "bhvr_0",
        operator: ">=",
        operand: 1,
      },
      _behavior_key: "bhvr_0",
      _behavior: {
        count: {
          event_selector: { event: "Purchase", selector: null },
          type: "absolute",
        },
        window: { unit: "day", value: 30 },
      },
    },
  ],
  _operator: operator,
});

// -- one explicit call per code -------------------------------------------
//
// Omission notice (`strategies.py:253-257` style): **U24** cannot be
// driven from a serialisable input. It fires only when
// `CohortDefinition.to_dict()` RAISES, and every definition the codec
// can decode is well-formed by construction (its `__post_init__`
// guards already ran), so `to_dict()` always succeeds on both sides.
// The rule is covered instead by the Layer-3 twins
// `test_u24_cohort_definition_to_dict_must_succeed` /
// `…_type_error` in packages/core/test/query/user-validators.test.ts.
// Every OTHER code in the §V2 inventory (U0-U8, U10-U23, U25-U30,
// UP1-UP4) has an entry below and the driver asserts each one was
// actually observed in oracle-py's answer.
const CODE_EDGES = [
  ["U0", ARGS, { where: ["not-a-filter"], mode: "profiles" }],
  [
    "U1",
    ARGS,
    { distinct_id: "a", distinct_ids: ["b"], mode: "profiles" },
  ],
  ["U2", ARGS, { cohort: 7, where: [cohortFilter(1, false)], mode: "profiles" }],
  ["U3", ARGS, { limit: 0, mode: "profiles" }],
  ["U4", ARGS, { distinct_ids: [], mode: "profiles" }],
  ["U5", ARGS, { sort_by: "   ", mode: "profiles" }],
  ["U6", ARGS, { as_of: "2025-02-30", mode: "profiles" }],
  ["U7", ARGS, { include_all_users: true, mode: "profiles" }],
  ["U8", ARGS, { as_of: "2026-06-01", mode: "profiles" }],
  ["U10", ARGS, { where: strFilter("", "t"), mode: "profiles" }],
  ["U11", ARGS, { properties: ["ok", "  "], mode: "profiles" }],
  ["U12", ARGS, { where: cohortFilter(3, true), mode: "profiles" }],
  [
    "U13",
    ARGS,
    {
      where: [cohortFilter(1, false), cohortFilter(2, false)],
      mode: "profiles",
    },
  ],
  ["U14", ARGS, { mode: "aggregate", aggregate: "extremes" }],
  [
    "U15",
    ARGS,
    { mode: "aggregate", aggregate: "count", aggregate_property: "ltv" },
  ],
  ["U16", ARGS, { segment_by: [1], mode: "profiles" }],
  ["U17", ARGS, { segment_by: [0], mode: "aggregate", aggregate: "count" }],
  ["U18", ARGS, { parallel: true, mode: "aggregate", aggregate: "count" }],
  ["U19", ARGS, { sort_by: "s", mode: "aggregate", aggregate: "count" }],
  ["U20", ARGS, { search: "j", mode: "aggregate", aggregate: "count" }],
  ["U21", ARGS, { distinct_id: "u", mode: "aggregate", aggregate: "count" }],
  ["U22", ARGS, { properties: ["p"], mode: "aggregate", aggregate: "count" }],
  ["U23", ARGS, { workers: 9, mode: "profiles" }],
  ["U25", ARGS, { where: refFilter(42), mode: "profiles" }],
  [
    "U26",
    ARGS,
    { mode: "aggregate", aggregate: "percentile", aggregate_property: "a" },
  ],
  ["U27", ARGS, { mode: "aggregate", aggregate: "count", percentile: 50 }],
  [
    "U28",
    ARGS,
    {
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "a",
      percentile: 0,
    },
  ],
  ["U29", ARGS, { properties: [], mode: "profiles" }],
  ["U30", ARGS, { as_of: "2025-01-01", mode: "aggregate", aggregate: "count" }],
  ["UP1", PARAMS, { params: { sort_order: "asc" } }],
  ["UP2", PARAMS, { params: { filter_by_cohort: {} } }],
  ["UP3", PARAMS, { params: { output_properties: [] } }],
  ["UP4", PARAMS, { params: { action: "median(x)" } }],
];

// -- the seven mandatory value edges, per api ------------------------------
//
// Omission notices: `where`/`properties`/`distinct_ids`/`segment_by`
// are LIST-typed, so the scalar edges (`True`, `1.5`, `18.0`, non-BMP
// string) are injected as list ELEMENTS; `mode`/`aggregate` are
// Literal-typed and are exercised through the near-miss fuzz rather
// than the value edges. `params` is dict-typed, so the scalar edges
// ride its VALUES.
const VALUE_EDGES = [
  // integral float 18.0 (the PyFloat carrier)
  ["float-int/limit", ARGS, { limit: F("18.0"), mode: "profiles" }],
  ["float-int/workers", ARGS, { workers: F("18.0"), mode: "profiles" }],
  [
    "float-int/percentile",
    ARGS,
    {
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "a",
      percentile: F("50.0"),
    },
  ],
  [
    "float-int/segment_by",
    ARGS,
    { segment_by: [F("2.0")], mode: "aggregate", aggregate: "count" },
  ],
  ["float-int/as_of", ARGS, { as_of: F("18.0"), mode: "profiles" }],
  ["float-int/cohort", ARGS, { cohort: F("18.0"), mode: "profiles" }],
  // fractional float 1.5 — NOTE the `$type: "float"` tag is
  // decode-REJECTED for finite non-integral spellings (codecs.py:36-44:
  // finite floats must stay raw number tokens, D6 rule 3), so the
  // fractional edge travels as a bare JSON number on both sides.
  ["float-frac/limit", ARGS, { limit: 1.5, mode: "profiles" }],
  ["float-frac/workers", ARGS, { workers: 1.5, mode: "profiles" }],
  [
    "float-frac/percentile",
    ARGS,
    {
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "a",
      percentile: 1.5,
    },
  ],
  [
    "float-frac/segment_by",
    ARGS,
    { segment_by: [-1.5], mode: "aggregate", aggregate: "count" },
  ],
  // non-finite float spellings (unwrap to native non-finite numbers)
  [
    "float-inf/percentile",
    ARGS,
    {
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "a",
      percentile: F("Infinity"),
    },
  ],
  [
    "float-nan/percentile",
    ARGS,
    {
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "a",
      percentile: F("NaN"),
    },
  ],
  ["float-inf/limit", ARGS, { limit: F("-Infinity"), mode: "profiles" }],
  // True
  ["true/parallel", ARGS, { parallel: true, mode: "profiles" }],
  ["true/include_all_users", ARGS, { include_all_users: true, cohort: 1 }],
  ["true/limit", ARGS, { limit: true, mode: "profiles" }],
  ["true/workers", ARGS, { workers: true, mode: "profiles" }],
  [
    "true/percentile",
    ARGS,
    {
      mode: "aggregate",
      aggregate: "percentile",
      aggregate_property: "a",
      percentile: true,
    },
  ],
  [
    "true/segment_by",
    ARGS,
    { segment_by: [true], mode: "aggregate", aggregate: "count" },
  ],
  // None
  ["none/all", ARGS, {}],
  [
    "none/explicit",
    ARGS,
    {
      where: null,
      cohort: null,
      properties: null,
      sort_by: null,
      limit: null,
      search: null,
      distinct_id: null,
      distinct_ids: null,
      group_id: null,
      as_of: null,
      aggregate_property: null,
      percentile: null,
      segment_by: null,
      mode: "profiles",
    },
  ],
  // empty list
  ["empty-list/where", ARGS, { where: [], mode: "profiles" }],
  ["empty-list/properties", ARGS, { properties: [], mode: "profiles" }],
  ["empty-list/distinct_ids", ARGS, { distinct_ids: [], mode: "profiles" }],
  [
    "empty-list/segment_by",
    ARGS,
    { segment_by: [], mode: "aggregate", aggregate: "count" },
  ],
  // empty string
  ["empty-str/sort_by", ARGS, { sort_by: "", mode: "profiles" }],
  ["empty-str/search", ARGS, { search: "", mode: "profiles" }],
  ["empty-str/as_of", ARGS, { as_of: "", mode: "profiles" }],
  ["empty-str/where", ARGS, { where: "", mode: "profiles" }],
  ["empty-str/distinct_id", ARGS, { distinct_id: "", mode: "profiles" }],
  ["empty-str/properties", ARGS, { properties: [""], mode: "profiles" }],
  [
    "empty-str/filter-prop",
    ARGS,
    { where: strFilter("", "v"), mode: "profiles" },
  ],
  // non-BMP string
  ["nonbmp/sort_by", ARGS, { sort_by: NON_BMP, mode: "profiles" }],
  ["nonbmp/properties", ARGS, { properties: [NON_BMP], mode: "profiles" }],
  ["nonbmp/as_of", ARGS, { as_of: NON_BMP, mode: "profiles" }],
  [
    "nonbmp/filter-prop",
    ARGS,
    { where: strFilter(NON_BMP, NON_BMP), mode: "profiles" },
  ],
  ["nonbmp/search", ARGS, { search: NON_BMP, mode: "profiles" }],
  // `today` seam boundary (U8) — frozen-1 / frozen / frozen+1
  ["today/-1", ARGS, { as_of: "2026-01-14", mode: "profiles" }],
  ["today/0", ARGS, { as_of: "2026-01-15", mode: "profiles" }],
  ["today/+1", ARGS, { as_of: "2026-01-16", mode: "profiles" }],
  // _DATE_RE / fromisoformat grammar corners (V2 trap 2a)
  ["date/compact", ARGS, { as_of: "20260114", mode: "profiles" }],
  ["date/dashless-short", ARGS, { as_of: "2026-1-4", mode: "profiles" }],
  ["date/trailing-nl", ARGS, { as_of: "2026-01-14\n", mode: "profiles" }],
  ["date/nd-digits", ARGS, { as_of: "٢٠٢٦-٠١-١٤", mode: "profiles" }],
  ["date/year-zero", ARGS, { as_of: "0000-01-01", mode: "profiles" }],
  ["date/leap", ARGS, { as_of: "2024-02-29", mode: "profiles" }],
  ["date/non-leap", ARGS, { as_of: "2025-02-29", mode: "profiles" }],
  // cohort definitions (U2/U24 happy path)
  ["cohortdef/and", ARGS, { cohort: cohortDef("and"), mode: "profiles" }],
  ["cohortdef/or", ARGS, { cohort: cohortDef("or"), mode: "profiles" }],
  // validate_user_params value edges
  ["params/empty", PARAMS, { params: {} }],
  ["params/float-int", PARAMS, { params: { sort_order: F("18.0") } }],
  ["params/float-frac", PARAMS, { params: { output_properties: 1.5 } }],
  ["params/true", PARAMS, { params: { sort_order: true, action: true } }],
  [
    "params/none",
    PARAMS,
    {
      params: {
        sort_order: null,
        filter_by_cohort: null,
        output_properties: null,
        action: null,
      },
    },
  ],
  [
    "params/empty-list",
    PARAMS,
    { params: { output_properties: [], filter_by_cohort: [] } },
  ],
  [
    "params/empty-str",
    PARAMS,
    {
      params: {
        sort_order: "",
        filter_by_cohort: "",
        output_properties: "",
        action: "",
      },
    },
  ],
  [
    "params/nonbmp",
    PARAMS,
    {
      params: {
        sort_order: NON_BMP,
        action: `extremes(properties["${NON_BMP}"])`,
      },
    },
  ],
  // UP2/UP3 JSON string forms + the early-return interaction
  [
    "params/up2-json-ok",
    PARAMS,
    { params: { filter_by_cohort: '{"id": 1}' } },
  ],
  [
    "params/up2-json-scalar",
    PARAMS,
    { params: { filter_by_cohort: "123" } },
  ],
  [
    "params/up2-json-nan",
    PARAMS,
    { params: { filter_by_cohort: "NaN" } },
  ],
  [
    "params/up2-bad-json-early-return",
    PARAMS,
    { params: { filter_by_cohort: "nope", action: "bad", sort_order: "x" } },
  ],
  ["params/up3-json-empty", PARAMS, { params: { output_properties: "[]" } }],
  [
    "params/up3-json-full",
    PARAMS,
    { params: { output_properties: '["$email"]' } },
  ],
  [
    "params/up3-bad-json",
    PARAMS,
    { params: { output_properties: "notjson" } },
  ],
  // UP4 action grammar corners (\s / \d / . / $ Python semantics)
  ["params/up4-count", PARAMS, { params: { action: "count()" } }],
  ["params/up4-count-nl", PARAMS, { params: { action: "count()\n" } }],
  ["params/up4-count-nl2", PARAMS, { params: { action: "count()\n\n" } }],
  [
    "params/up4-nbsp",
    PARAMS,
    { params: { action: 'percentile(properties["a"], 50)' } },
  ],
  [
    "params/up4-tab",
    PARAMS,
    { params: { action: 'percentile(properties["a"],\t50)' } },
  ],
  [
    "params/up4-u2028",
    PARAMS,
    { params: { action: 'percentile(properties["a"], 50)' } },
  ],
  [
    "params/up4-feff",
    PARAMS,
    { params: { action: 'percentile(properties["a"],﻿50)' } },
  ],
  [
    "params/up4-nd-digits",
    PARAMS,
    { params: { action: 'percentile(properties["a"], ٠١)' } },
  ],
  [
    "params/up4-dots-only",
    PARAMS,
    { params: { action: 'percentile(properties["a"], ..)' } },
  ],
  [
    "params/up4-greedy",
    PARAMS,
    { params: { action: 'percentile(properties["a"], 5"], 7)' } },
  ],
  [
    "params/up4-cr",
    PARAMS,
    { params: { action: 'extremes(properties["a\rb"])' } },
  ],
  [
    "params/up4-nl-inside",
    PARAMS,
    { params: { action: 'extremes(properties["a\nb"])' } },
  ],
  [
    "params/up4-empty-prop",
    PARAMS,
    { params: { action: 'extremes(properties[""])' } },
  ],
];

// ---------------------------------------------------------------------------
// 6. Fuzz families (≥500 examples each, P2-9 budget).
// ---------------------------------------------------------------------------

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);
const pick = (xs) => xs[Math.floor(rand() * xs.length) % xs.length];
const maybe = (p, v) => (rand() < p ? v : undefined);

const AS_OF_POOL = [
  "2026-01-14",
  "2026-01-15",
  "2026-01-16",
  "2025-12-31",
  "2027-01-01",
  "2026-02-30",
  "2026-13-01",
  "2026-00-10",
  "20260114",
  "2026-1-4",
  "2026-01-14\n",
  "٢٠٢٦-٠١-١٤",
  "0000-01-01",
  "9999-12-31",
  "not-a-date",
  "",
  NON_BMP,
  1700000000,
  0,
  -1,
  F("18.0"),
  true,
  null,
];
const NUM_POOL = [
  0,
  1,
  -1,
  5,
  6,
  100,
  -100,
  true,
  false,
  1.5,
  -1.5,
  F("0.0"),
  F("5.0"),
  F("NaN"),
  F("Infinity"),
  F("-Infinity"),
  null,
];
// `workers` has the Python default `5` (NOT `None`), so `workers=None`
// makes CPython raise `TypeError: '<' not supported between instances
// of 'NoneType' and 'int'` — an input outside BOTH the Python type
// annotation and the TS `workers?: number` signature. It is excluded
// from the fuzz domain (documented omission, `strategies.py:253-257`
// style); the same applies to `mode=None` / `aggregate=None`, which
// ARE in the shared domain (string comparison, no raise) and so stay
// in their pools below as explicit near-misses.
const WORKERS_POOL = NUM_POOL.filter((v) => v !== null);
const STR_POOL = ["", "   ", "$last_seen", NON_BMP, "​", "", "a\nb"];
const WHERE_POOL = [
  null,
  "",
  'properties["a"] == 1',
  strFilter("plan", "premium"),
  strFilter("", "x"),
  strFilter(NON_BMP, "x"),
  refFilter(9),
  cohortFilter(1, false),
  cohortFilter(2, true),
  [],
  [strFilter("plan", "pro")],
  [cohortFilter(1, false), cohortFilter(2, false)],
  [cohortFilter(1, false), cohortFilter(2, true)],
  [strFilter("a", "b"), "not-a-filter"],
  ["not-a-filter"],
  [42],
  [refFilter(1), strFilter("", "y")],
];
const COHORT_POOL = [null, 1, 0, -3, cohortDef("and"), cohortDef("or")];
const MODE_POOL = ["profiles", "aggregate", "Profiles", "", null];
const AGG_POOL = [
  "count",
  "extremes",
  "percentile",
  "numeric_summary",
  "Count",
  "",
  null,
];

function fuzzUserArgs() {
  const input = {};
  const put = (k, v) => {
    if (v !== undefined) input[k] = v;
  };
  put("mode", pick(MODE_POOL));
  put("aggregate", maybe(0.8, pick(AGG_POOL)));
  put("aggregate_property", maybe(0.5, pick([...STR_POOL, null])));
  put("percentile", maybe(0.5, pick(NUM_POOL)));
  put("limit", maybe(0.5, pick(NUM_POOL)));
  put("workers", maybe(0.4, pick(WORKERS_POOL)));
  put(
    "segment_by",
    maybe(
      0.35,
      pick([
        null,
        [],
        [1, 2],
        [0],
        [-1],
        [1, 0, -1],
        [F("2.0")],
        [-1.5],
        [true],
      ]),
    ),
  );
  put("where", maybe(0.5, pick(WHERE_POOL)));
  put("cohort", maybe(0.35, pick(COHORT_POOL)));
  put("properties", maybe(0.4, pick([null, [], ["$email"], ["", "a"], [NON_BMP], ["   "]])));
  put("sort_by", maybe(0.35, pick([...STR_POOL, null])));
  put("search", maybe(0.3, pick([...STR_POOL, null])));
  put("distinct_id", maybe(0.3, pick([...STR_POOL, null])));
  put("distinct_ids", maybe(0.3, pick([null, [], ["u1"], ["u1", "u2"]])));
  put("group_id", maybe(0.15, pick([...STR_POOL, null])));
  put("as_of", maybe(0.5, pick(AS_OF_POOL)));
  put("parallel", maybe(0.35, pick([true, false])));
  put("include_all_users", maybe(0.35, pick([true, false])));
  put("sort_order", maybe(0.2, pick(["ascending", "descending", "asc"])));
  return input;
}

const ACTION_POOL = [
  "count()",
  "count()\n",
  "count()\n\n",
  'extremes(properties["ltv"])',
  'extremes(properties[""])',
  `extremes(properties["${NON_BMP}"])`,
  'extremes(properties["a\nb"])',
  'extremes(properties["a\rb"])',
  'numeric_summary(properties["revenue"])',
  'percentile(properties["age"], 50)',
  'percentile(properties["age"],50)',
  'percentile(properties["age"],\t50)',
  'percentile(properties["age"], 50)',
  'percentile(properties["age"], 50)',
  'percentile(properties["age"],﻿50)',
  'percentile(properties["age"], ٠١)',
  'percentile(properties["age"], ..)',
  'percentile(properties["age"], 5"], 7)',
  'percentile(properties["age"], )',
  "median(ltv)",
  "",
  "  count()  ",
  42,
  null,
  true,
  ["count()"],
];
const FBC_POOL = [
  null,
  {},
  { id: 1 },
  { raw_cohort: { selector: {} } },
  { name: "x" },
  { id: null },
  '{"id": 1}',
  '{"name": "x"}',
  "123",
  "NaN",
  "Infinity",
  "nope",
  "{",
  "[]",
  "[{}]",
  [],
  [{ id: 1 }],
  42,
  true,
  "",
  NON_BMP,
];
const OP_POOL = [
  null,
  [],
  ["$email"],
  "[]",
  '["$email"]',
  "notjson",
  "{}",
  '{"a":1}',
  "",
  42,
  true,
  {},
];

function fuzzUserParams() {
  const params = {};
  const put = (k, v) => {
    if (v !== undefined) params[k] = v;
  };
  put(
    "sort_order",
    maybe(0.6, pick(["ascending", "descending", "asc", "", null, 1, true, NON_BMP])),
  );
  put("filter_by_cohort", maybe(0.6, pick(FBC_POOL)));
  put("output_properties", maybe(0.6, pick(OP_POOL)));
  put("action", maybe(0.6, pick(ACTION_POOL)));
  put("distinct_id", maybe(0.2, "u1"));
  return { params };
}

// ---------------------------------------------------------------------------
// 7. Run.
// ---------------------------------------------------------------------------

const oracle = new OraclePy();
const info = await oracle.send("oracle.info", {});

let edgeCalls = 0;
for (const [label, api, input] of CODE_EDGES) {
  edgeCalls += 1;
  await compare(oracle, `code:${label}`, api, input);
}
for (const [label, api, input] of VALUE_EDGES) {
  edgeCalls += 1;
  await compare(oracle, `edge:${label}`, api, input);
}
const edgeCompared = compared;

const fuzzCompared = {};
for (const [family, api, gen] of [
  ["user_args_family", ARGS, fuzzUserArgs],
  ["user_params_family", PARAMS, fuzzUserParams],
]) {
  const before = compared;
  for (let i = 0; i < RUNS; i++) {
    await compare(oracle, `${family}#${i}`, api, gen());
  }
  fuzzCompared[family] = compared - before;
}

await oracle.shutdown();

// Every code the shard owns except U24 must have been observed in
// oracle-py's answers (see the omission notice above).
const OWNED = [
  ...Array.from({ length: 9 }, (_, i) => `U${i}`),
  ...Array.from({ length: 21 }, (_, i) => `U${i + 10}`),
  "UP1",
  "UP2",
  "UP3",
  "UP4",
].filter((c) => c !== "U24");
const missingCodes = OWNED.filter((c) => !codesSeen.has(c));

const report = {
  seed: SEED,
  runs_per_family: RUNS,
  oracle_info: info.result ?? info,
  frozen_today: FROZEN_TODAY,
  edge_calls: edgeCalls,
  edge_compared: edgeCompared,
  fuzz_compared_per_family: fuzzCompared,
  total_compared: compared,
  codes_observed: [...codesSeen].sort(),
  missing_codes: missingCodes,
  skips: skips.length,
  skip_detail: skips.slice(0, 40),
  divergences: divergences.length,
  divergence_detail: divergences.slice(0, 20),
  oracle_stderr_tail: oracle.stderr.slice(-2000),
};
writeFileSync(
  path.join(HERE, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
process.exit(divergences.length === 0 && missingCodes.length === 0 ? 0 : 1);
