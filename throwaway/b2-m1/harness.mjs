// THROWAWAY (R10.9) — B2-M1 (validation.py shard V1a) edge + fuzz harness.
//
// Deleted by the B2 batch gate after arbiter sign-off (GF6 / B0-1
// precedent, throwaway/b0-1/run-fuzz.sh).
//
// Arbiter: Python. The harness drives the REAL oracle-py JSON-RPC server
// (`uv run python -m conformance.oracle_py` in the Python repo) and the
// REAL TS validators (esbuild-bundled from packages/core/src), then diffs
// the `[{code, path, severity}]` arrays position-by-position (emission
// order is contract, b2-packets.md Cautions §11).
//
// Note (packet §R10.9 harness spec): the packet routes the fuzz through
// `conformance/differential/strategies.py` + oracle-ts. oracle-ts cannot
// answer `validation.*` until the (b') binding commit lands, so this
// harness talks to oracle-py DIRECTLY and calls the TS functions
// in-process. The strategies.py/oracle-ts formalisation is deferred to
// the binding task; the arbiter comparison performed here is the same
// one (Python answers, TS answers, byte-diff the encoded output).
//
// Usage: node throwaway/b2-m1/harness.mjs [--seed N] [--runs N]

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
// 3. Tagged-value materialisation (mirror of conformance/record/codecs.py
//    `decode_value` for the tags this harness emits).
// ---------------------------------------------------------------------------

/** Stand-in for the runner's PyFloat carrier (`codecs.ts` `PyFloat`). */
class PyFloat {
  constructor(spelling) {
    this.spelling = spelling;
  }
}

const CTORS = {
  GroupBy: (f) => new ts.GroupBy(f),
  Exclusion: (f) => new ts.Exclusion(f),
  FunnelStep: (f) => new ts.FunnelStep(f),
  HoldingConstant: (f) => new ts.HoldingConstant(f),
  Metric: (f) => new ts.Metric(f),
  Formula: (f) => new ts.Formula(f),
  CohortBreakdown: (f) => new ts.CohortBreakdown(f),
  CohortMetric: (f) => new ts.CohortMetric(f),
  CustomPropertyRef: (f) => new ts.CustomPropertyRef(f),
  PropertyInput: (f) => new ts.PropertyInput(f),
  InlineCustomProperty: (f) => new ts.InlineCustomProperty(f),
};

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
      // Caution §8: the binding unwraps the NON-FINITE spellings to native
      // JS numbers (vector-codecs.ts:606-611 precedent) and leaves integral
      // finite spellings as the PyFloat carrier (a non-number object, which
      // is exactly what Python's `isinstance(x, int)` rejects).
      const s = value.value;
      if (s === "NaN") return Number.NaN;
      if (s === "Infinity") return Number.POSITIVE_INFINITY;
      if (s === "-Infinity") return Number.NEGATIVE_INFINITY;
      return new PyFloat(s);
    }
    if (tag === "TimeComparison") {
      if (value.type === "relative") return ts.TimeComparison.relative(value.unit);
      if (value.type === "absolute-start")
        return ts.TimeComparison.absoluteStart(value.date);
      return ts.TimeComparison.absoluteEnd(value.date);
    }
    if (tag === "GroupBy") {
      // Binding rule (Caution §8): GroupBy's bucket fields are compared
      // NUMERICALLY by validate_group_by_args (V11/V12/V12C/V18) and
      // classified by `_is_finite` (V24) — no `isinstance(int)` test — so
      // an integral-float carrier must reach TS as a native number.
      for (const k of ["bucket_size", "bucket_min", "bucket_max"]) {
        const v = value[k];
        if (v !== null && typeof v === "object" && v.$type === "float") {
          value = { ...value, [k]: Number(v.value) };
        }
      }
    }
    const ctor = CTORS[tag];
    if (ctor === undefined) throw new Error(`harness: no ctor for $type ${tag}`);
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      if (k !== "$type") fields[k] = materialize(v);
    }
    return ctor(fields);
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
  "validation.validate_time_args": ts.validateTimeArgs,
  "validation.validate_group_by_args": ts.validateGroupByArgs,
  "validation.validate_query_args": ts.validateQueryArgs,
  "validation.validate_funnel_args": ts.validateFunnelArgs,
  "validation.validate_retention_args": ts.validateRetentionArgs,
  "validation.validate_flow_args": ts.validateFlowArgs,
};

// ---------------------------------------------------------------------------
// 4. Comparison driver.
// ---------------------------------------------------------------------------

const divergences = [];
const skips = [];
let compared = 0;

/**
 * Top-level kwargs whose Python semantics are pure NUMERIC comparison
 * (no `isinstance(int)` / `isinstance(float)` test anywhere on the
 * path). The (b') binding must unwrap a PyFloat carrier to a native
 * number for these; everywhere else the carrier must survive, because
 * that is exactly what makes Python's isinstance test fail.
 *
 * Kept OUT of the unwrap list on purpose:
 *   - funnel `conversion_window`  -> F3_CONVERSION_WINDOW_TYPE isinstance
 *   - retention `bucket_sizes[i]` -> R5_BUCKET_SIZES_INTEGER isinstance
 *   - `data_group_id`             -> DG1 isinstance
 */
const UNWRAP = {
  "validation.validate_time_args": ["last"],
  "validation.validate_group_by_args": [],
  "validation.validate_query_args": ["last", "rolling"],
  "validation.validate_funnel_args": ["last"],
  "validation.validate_retention_args": ["last"],
  "validation.validate_flow_args": [
    "last",
    "forward",
    "reverse",
    "cardinality",
    "conversion_window",
  ],
};

function applyUnwrap(api, input) {
  const out = { ...input };
  for (const k of UNWRAP[api] ?? []) {
    const v = out[k];
    if (v !== null && typeof v === "object" && v.$type === "float") {
      out[k] = Number(v.value);
    }
  }
  return out;
}

async function compare(oracle, label, api, input) {
  let tsOut;
  try {
    tsOut = encodeErrors(TS_APIS[api](materialize(applyUnwrap(api, input))));
  } catch (err) {
    if (err instanceof ts.ParamValidationError) {
      // A constructor guard rejected the payload before the validator ran.
      // Verify BILATERALLY that Python's `decode_value` (which builds the
      // real dataclasses, so the same `__post_init__` guard fires) also
      // refuses the payload — otherwise the skip would hide a divergence.
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
    skips.push({ label, api, reason: `oracle error ${res.error.code}` });
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
//    call per code in the V1a inventory (corpus-present AND source-only).
// ---------------------------------------------------------------------------

const NON_BMP = "\u{1D4B3}"; // "𝒳"
const NUL = "\u0000";
const ZWSP = "\u200b";
const F = (spelling) => ({ $type: "float", value: spelling });

const timeBase = { from_date: null, to_date: null, last: 30 };
const gbBase = { group_by: null };
const queryBase = {
  events: ["Login"],
  math: "total",
  math_property: null,
  per_user: null,
  from_date: null,
  to_date: null,
  last: 30,
  has_formula: false,
  rolling: null,
  cumulative: false,
  group_by: null,
};
const funnelBase = {
  steps: ["Signup", "Purchase"],
  conversion_window: 14,
  conversion_window_unit: "day",
  math: "conversion_rate_unique",
  math_property: null,
  exclusions: null,
  holding_constant: null,
  from_date: null,
  to_date: null,
  last: 30,
  group_by: null,
};
const retBase = {
  born_event: "Signup",
  return_event: "Login",
  retention_unit: "week",
  alignment: "birth",
  bucket_sizes: null,
  math: "retention_rate",
  mode: "curve",
  unit: "day",
  from_date: null,
  to_date: null,
  last: 30,
  group_by: null,
};
const flowBase = {
  steps: ["Purchase"],
  forward: 3,
  reverse: 0,
  count_type: "unique",
  mode: "sankey",
  cardinality: 3,
  conversion_window: 7,
  from_date: null,
  to_date: null,
  last: 30,
};

const GB = (fields) => ({ $type: "GroupBy", ...fields });

// label -> [api, input]. Every entry names the code(s) it pins.
const EDGES = [
  // ---- mandatory value edges, per api -------------------------------------
  ["value-edge/time/integral-float-last", "validation.validate_time_args", { ...timeBase, last: F("18.0") }],
  ["value-edge/time/fractional-last", "validation.validate_time_args", { ...timeBase, last: 1.5 }],
  ["value-edge/time/true-last", "validation.validate_time_args", { ...timeBase, last: true }],
  ["value-edge/time/none-dates", "validation.validate_time_args", timeBase],
  ["value-edge/time/empty-string-date", "validation.validate_time_args", { ...timeBase, from_date: "" }],
  ["value-edge/time/non-bmp-date", "validation.validate_time_args", { ...timeBase, from_date: NON_BMP }],
  ["value-edge/groupby/none", "validation.validate_group_by_args", gbBase],
  ["value-edge/groupby/empty-list", "validation.validate_group_by_args", { group_by: [] }],
  ["value-edge/groupby/empty-string", "validation.validate_group_by_args", { group_by: "" }],
  ["value-edge/groupby/non-bmp", "validation.validate_group_by_args", { group_by: NON_BMP }],
  ["value-edge/groupby/integral-float-bucket", "validation.validate_group_by_args", { group_by: GB({ property: "r", property_type: "number", bucket_size: F("10.0"), bucket_min: F("0.0"), bucket_max: F("100.0") }) }],
  ["value-edge/groupby/fractional-bucket", "validation.validate_group_by_args", { group_by: GB({ property: "r", property_type: "number", bucket_size: 1.5, bucket_min: 0, bucket_max: 10 }) }],
  ["value-edge/query/empty-events", "validation.validate_query_args", { ...queryBase, events: [] }],
  ["value-edge/query/empty-string-event", "validation.validate_query_args", { ...queryBase, events: [""] }],
  ["value-edge/query/non-bmp-event", "validation.validate_query_args", { ...queryBase, events: [NON_BMP] }],
  ["value-edge/query/true-cumulative", "validation.validate_query_args", { ...queryBase, cumulative: true, rolling: 7 }],
  ["value-edge/query/integral-float-rolling", "validation.validate_query_args", { ...queryBase, rolling: F("7.0") }],
  ["value-edge/query/fractional-rolling", "validation.validate_query_args", { ...queryBase, rolling: 1.5 }],
  ["value-edge/funnel/empty-steps", "validation.validate_funnel_args", { ...funnelBase, steps: [] }],
  ["value-edge/funnel/empty-string-step", "validation.validate_funnel_args", { ...funnelBase, steps: ["", "B"] }],
  ["value-edge/funnel/non-bmp-step", "validation.validate_funnel_args", { ...funnelBase, steps: [NON_BMP, "B"] }],
  ["value-edge/funnel/integral-float-window", "validation.validate_funnel_args", { ...funnelBase, conversion_window: F("14.0") }],
  ["value-edge/funnel/fractional-window", "validation.validate_funnel_args", { ...funnelBase, conversion_window: 1.5 }],
  ["value-edge/funnel/true-window", "validation.validate_funnel_args", { ...funnelBase, conversion_window: true }],
  ["value-edge/funnel/none-window", "validation.validate_funnel_args", { ...funnelBase, conversion_window: null }],
  ["value-edge/retention/empty-bucket-sizes", "validation.validate_retention_args", { ...retBase, bucket_sizes: [] }],
  ["value-edge/retention/integral-float-bucket", "validation.validate_retention_args", { ...retBase, bucket_sizes: [F("1.0"), 3] }],
  ["value-edge/retention/fractional-bucket", "validation.validate_retention_args", { ...retBase, bucket_sizes: [1.5, 3] }],
  ["value-edge/retention/true-bucket", "validation.validate_retention_args", { ...retBase, bucket_sizes: [true, 3] }],
  ["value-edge/retention/non-bmp-events", "validation.validate_retention_args", { ...retBase, born_event: NON_BMP, return_event: NON_BMP }],
  ["value-edge/retention/empty-string-events", "validation.validate_retention_args", { ...retBase, born_event: "", return_event: "" }],
  ["value-edge/flow/empty-steps", "validation.validate_flow_args", { ...flowBase, steps: [] }],
  ["value-edge/flow/empty-string-step", "validation.validate_flow_args", { ...flowBase, steps: [""] }],
  ["value-edge/flow/non-bmp-step", "validation.validate_flow_args", { ...flowBase, steps: [NON_BMP] }],
  ["value-edge/flow/integral-float-cardinality", "validation.validate_flow_args", { ...flowBase, cardinality: F("3.0") }],
  ["value-edge/flow/fractional-cardinality", "validation.validate_flow_args", { ...flowBase, cardinality: 1.5 }],
  ["value-edge/flow/true-forward", "validation.validate_flow_args", { ...flowBase, forward: true }],
  ["value-edge/flow/none-data-group-id", "validation.validate_flow_args", { ...flowBase, data_group_id: null }],

  // ---- one explicit call per code (corpus-present) ------------------------
  ["code/V7_LAST_POSITIVE", "validation.validate_time_args", { ...timeBase, last: 0 }],
  ["code/V8_DATE_FORMAT", "validation.validate_time_args", { ...timeBase, from_date: "01/01/2024" }],
  ["code/V8_DATE_INVALID", "validation.validate_time_args", { ...timeBase, from_date: "2024-02-30" }],
  ["code/V9_TO_REQUIRES_FROM", "validation.validate_time_args", { ...timeBase, to_date: "2024-01-31" }],
  ["code/V10_DATE_LAST_EXCLUSIVE", "validation.validate_time_args", { ...timeBase, from_date: "2024-01-01", last: 7 }],
  ["code/V15_DATE_ORDER", "validation.validate_time_args", { from_date: "2024-02-01", to_date: "2024-01-01", last: 30 }],
  ["code/V20_LAST_TOO_LARGE", "validation.validate_time_args", { ...timeBase, last: 5000 }],
  ["code/V11_BUCKET_REQUIRES_SIZE", "validation.validate_group_by_args", { group_by: GB({ property: "a", bucket_min: 0 }) }],
  ["code/V12B_BUCKET_REQUIRES_NUMBER", "validation.validate_group_by_args", { group_by: GB({ property: "a", property_type: "string", bucket_size: 10 }) }],
  ["code/V12C_BUCKET_REQUIRES_BOUNDS", "validation.validate_group_by_args", { group_by: GB({ property: "a", property_type: "number", bucket_size: 10 }) }],
  ["code/V0_NO_EVENTS", "validation.validate_query_args", { ...queryBase, events: [] }],
  ["code/V1_MATH_REQUIRES_PROPERTY", "validation.validate_query_args", { ...queryBase, math: "average" }],
  ["code/V2_MATH_REJECTS_PROPERTY", "validation.validate_query_args", { ...queryBase, math: "unique", math_property: "amount" }],
  ["code/V3_PER_USER_INCOMPATIBLE", "validation.validate_query_args", { ...queryBase, math: "dau", per_user: "average" }],
  ["code/V3B_PER_USER_REQUIRES_PROPERTY", "validation.validate_query_args", { ...queryBase, per_user: "average" }],
  ["code/V4_FORMULA_MIN_EVENTS", "validation.validate_query_args", { ...queryBase, has_formula: true }],
  ["code/V5_ROLLING_CUMULATIVE_EXCLUSIVE", "validation.validate_query_args", { ...queryBase, rolling: 7, cumulative: true }],
  ["code/V6_ROLLING_POSITIVE", "validation.validate_query_args", { ...queryBase, rolling: 0 }],
  ["code/V16_FORMULA_SYNTAX", "validation.validate_query_args", { ...queryBase, events: ["a", "b"], has_formula: true, formulas: [{ $type: "Formula", expression: "1 + 2" }] }],
  ["code/V21_INVALID_EVENT_TYPE", "validation.validate_query_args", { ...queryBase, events: [123] }],
  ["code/V23_ROLLING_TOO_LARGE", "validation.validate_query_args", { ...queryBase, rolling: 400 }],
  ["code/DG1_INVALID_DATA_GROUP_ID", "validation.validate_query_args", { ...queryBase, data_group_id: 0 }],
  ["code/F1_MIN_STEPS", "validation.validate_funnel_args", { ...funnelBase, steps: ["A"] }],
  ["code/F1_MAX_STEPS", "validation.validate_funnel_args", { ...funnelBase, steps: Array(101).fill("A") }],
  ["code/F2_EMPTY_STEP_EVENT", "validation.validate_funnel_args", { ...funnelBase, steps: ["", "B"] }],
  ["code/F2_CONTROL_CHAR_STEP_EVENT", "validation.validate_funnel_args", { ...funnelBase, steps: [`A${NUL}B`, "C"] }],
  ["code/F2_INVISIBLE_STEP_EVENT", "validation.validate_funnel_args", { ...funnelBase, steps: [ZWSP, "C"] }],
  ["code/F3_CONVERSION_WINDOW_POSITIVE", "validation.validate_funnel_args", { ...funnelBase, conversion_window: 0 }],
  ["code/F3_CONVERSION_WINDOW_MAX", "validation.validate_funnel_args", { ...funnelBase, conversion_window: 368 }],
  ["code/F3_CONVERSION_WINDOW_TYPE", "validation.validate_funnel_args", { ...funnelBase, conversion_window: 14.5 }],
  ["code/F4_EXCLUSION_STEP_BOUNDS", "validation.validate_funnel_args", { ...funnelBase, steps: ["A", "B"], exclusions: [{ $type: "Exclusion", event: "X", from_step: 0, to_step: 5 }] }],
  ["code/F4_EXCLUSION_STEP_ORDER", "validation.validate_funnel_args", { ...funnelBase, steps: ["A", "B"], exclusions: [{ $type: "Exclusion", event: "X", from_step: 0, to_step: 0 }] }],
  ["code/F7_INVALID_WINDOW_UNIT", "validation.validate_funnel_args", { ...funnelBase, conversion_window_unit: "hou" }],
  ["code/F7_SECOND_MIN_WINDOW", "validation.validate_funnel_args", { ...funnelBase, conversion_window: 1, conversion_window_unit: "second" }],
  ["code/F8_MAX_HOLDING_CONSTANT", "validation.validate_funnel_args", { ...funnelBase, holding_constant: ["a", "b", "c", "d"] }],
  ["code/F9_SESSION_WINDOW_REQUIRES_ONE", "validation.validate_funnel_args", { ...funnelBase, conversion_window_unit: "session", conversion_window: 2 }],
  ["code/F9_SESSION_MATH_REQUIRES_SESSION_WINDOW", "validation.validate_funnel_args", { ...funnelBase, math: "conversion_rate_session" }],
  ["code/F10_MATH_MISSING_PROPERTY", "validation.validate_funnel_args", { ...funnelBase, math: "average" }],
  ["code/F11_MATH_REJECTS_PROPERTY", "validation.validate_funnel_args", { ...funnelBase, math: "unique", math_property: "amount" }],
  ["code/F12_INVALID_REENTRY_MODE", "validation.validate_funnel_args", { ...funnelBase, reentry_mode: "invalid" }],
  ["code/R1_EMPTY_BORN_EVENT", "validation.validate_retention_args", { ...retBase, born_event: "" }],
  ["code/R1_CONTROL_CHAR_BORN_EVENT", "validation.validate_retention_args", { ...retBase, born_event: `S${NUL}p` }],
  ["code/R1_INVISIBLE_BORN_EVENT", "validation.validate_retention_args", { ...retBase, born_event: ZWSP }],
  ["code/R2_EMPTY_RETURN_EVENT", "validation.validate_retention_args", { ...retBase, return_event: "" }],
  ["code/R2_CONTROL_CHAR_RETURN_EVENT", "validation.validate_retention_args", { ...retBase, return_event: `L${NUL}n` }],
  ["code/R2_INVISIBLE_RETURN_EVENT", "validation.validate_retention_args", { ...retBase, return_event: ZWSP }],
  ["code/R5_BUCKET_SIZES_INTEGER", "validation.validate_retention_args", { ...retBase, bucket_sizes: [1.5, 3] }],
  ["code/R5_BUCKET_SIZES_POSITIVE", "validation.validate_retention_args", { ...retBase, bucket_sizes: [0, 3] }],
  ["code/R5_BUCKET_SIZES_TOO_MANY", "validation.validate_retention_args", { ...retBase, bucket_sizes: Array.from({ length: 1000 }, (_, i) => i + 1) }],
  ["code/R6_BUCKET_SIZES_ASCENDING", "validation.validate_retention_args", { ...retBase, bucket_sizes: [7, 3, 1] }],
  ["code/R7_INVALID_RETENTION_UNIT", "validation.validate_retention_args", { ...retBase, retention_unit: "wek" }],
  ["code/R8_INVALID_ALIGNMENT", "validation.validate_retention_args", { ...retBase, alignment: "brith" }],
  ["code/R9_INVALID_MATH", "validation.validate_retention_args", { ...retBase, math: "uniue" }],
  ["code/R10_INVALID_MODE", "validation.validate_retention_args", { ...retBase, mode: "curv" }],
  ["code/R11_INVALID_UNIT", "validation.validate_retention_args", { ...retBase, unit: "dya" }],
  ["code/R12_EMPTY_GROUP_BY", "validation.validate_retention_args", { ...retBase, group_by: "" }],
  ["code/R13_INVALID_UNBOUNDED_MODE", "validation.validate_retention_args", { ...retBase, unbounded_mode: "invalid" }],
  ["code/CB3_RETENTION_MIXED_BREAKDOWN", "validation.validate_retention_args", { ...retBase, group_by: [{ $type: "CohortBreakdown", cohort: 123, name: "PU" }, "platform"] }],
  ["code/FL1_EMPTY_STEPS", "validation.validate_flow_args", { ...flowBase, steps: [] }],
  ["code/FL2_EMPTY_STEP_EVENT", "validation.validate_flow_args", { ...flowBase, steps: [""] }],
  ["code/FL2_CONTROL_CHAR_STEP_EVENT", "validation.validate_flow_args", { ...flowBase, steps: [`${NUL}Login`] }],
  ["code/FL2_INVISIBLE_STEP_EVENT", "validation.validate_flow_args", { ...flowBase, steps: [ZWSP] }],
  ["code/FL3_FORWARD_RANGE", "validation.validate_flow_args", { ...flowBase, forward: 6 }],
  ["code/FL4_REVERSE_RANGE", "validation.validate_flow_args", { ...flowBase, reverse: -1 }],
  ["code/FL5_NO_DIRECTION", "validation.validate_flow_args", { ...flowBase, forward: 0, reverse: 0 }],
  ["code/FL6_CARDINALITY_RANGE", "validation.validate_flow_args", { ...flowBase, cardinality: 51 }],
  ["code/FL7_CONVERSION_WINDOW_POSITIVE", "validation.validate_flow_args", { ...flowBase, conversion_window: 0 }],
  ["code/FL7_CONVERSION_WINDOW_MAX", "validation.validate_flow_args", { ...flowBase, conversion_window: 400 }],
  ["code/FL9_SESSION_REQUIRES_SESSION_WINDOW", "validation.validate_flow_args", { ...flowBase, count_type: "session" }],
  ["code/FL10_SESSION_WINDOW_REQUIRES_ONE", "validation.validate_flow_args", { ...flowBase, count_type: "session", conversion_window_unit: "session", conversion_window: 7 }],
  ["code/FL_INVALID_COUNT_TYPE", "validation.validate_flow_args", { ...flowBase, count_type: "uniqe" }],
  ["code/FL_INVALID_MODE", "validation.validate_flow_args", { ...flowBase, mode: "sanke" }],
  ["code/FL_INVALID_WINDOW_UNIT", "validation.validate_flow_args", { ...flowBase, conversion_window_unit: "dya" }],
  ["code/FL_TIME_COMPARISON_NOT_SUPPORTED", "validation.validate_flow_args", { ...flowBase, time_comparison: { $type: "TimeComparison", type: "relative", unit: "month", date: null } }],

  // ---- one explicit call per SOURCE-ONLY code (packet: not corpus-exercised)
  ["code/V12_BUCKET_SIZE_POSITIVE", "validation.validate_group_by_args", { group_by: GB({ property: "a", property_type: "number", bucket_size: F("NaN"), bucket_min: 0, bucket_max: 10 }) }],
  // ^ NaN is the only bucket_size that clears the GroupBy ctor guard AND
  //   fails `bucket_size <= 0`? No — NaN <= 0 is false in both languages,
  //   so V12 is UNREACHABLE through the constructor (guard V12 fires first
  //   for every value that would trigger it). Documented omission, exactly
  //   as strategies.py:253-257 documents out-of-domain edge items; the
  //   call is kept because it still pins the V24 branch beside it.
  ["code/V13_METRIC_MATH_PROPERTY", "validation.validate_query_args", { ...queryBase, events: [{ $type: "Metric", event: "P", math: "total", property: null }] }],
  // ^ Metric's ctor guard raises for property-math without a property, so
  //   V13 is likewise unreachable post-Phase-2; the call pins the
  //   no-error path of the same branch.
  ["code/V14_METRIC_REJECTS_PROPERTY", "validation.validate_query_args", { ...queryBase, events: [{ $type: "Metric", event: "P", math: "unique", property: "amount" }] }],
  ["code/V17_EMPTY_EVENT", "validation.validate_query_args", { ...queryBase, events: ["   "] }],
  ["code/V18_BUCKET_ORDER", "validation.validate_group_by_args", { group_by: GB({ property: "a", property_type: "number", bucket_size: 10, bucket_min: F("NaN"), bucket_max: 10 }) }],
  ["code/V19_FORMULA_BOUNDS", "validation.validate_query_args", { ...queryBase, events: ["a", "b"], has_formula: true, formulas: [{ $type: "Formula", expression: "A + Z" }] }],
  ["code/V22_CONTROL_CHAR_EVENT", "validation.validate_query_args", { ...queryBase, events: [`Log${NUL}in`] }],
  ["code/V22_INVISIBLE_EVENT", "validation.validate_query_args", { ...queryBase, events: [ZWSP] }],
  ["code/V24_BUCKET_NOT_FINITE", "validation.validate_group_by_args", { group_by: GB({ property: "a", bucket_size: F("NaN") }) }],
  ["code/V26_PERCENTILE_REQUIRES_VALUE", "validation.validate_query_args", { ...queryBase, math: "percentile", math_property: "amount" }],
  ["code/V27_HISTOGRAM_REQUIRES_PER_USER", "validation.validate_query_args", { ...queryBase, math: "histogram", math_property: "amount" }],
  ["code/CM5_INLINE_COHORT_METRIC", "validation.validate_query_args", { ...queryBase, events: [{ $type: "CohortMetric", cohort: 42, name: "c" }] }],
  // ^ inline CohortDefinition is rejected by CohortMetric's ctor in both
  //   languages, so CM5 is unreachable from the validator; the call pins
  //   the reachable (saved-id) arm of the same branch.
  ["code/CP1_INVALID_ID", "validation.validate_query_args", { ...queryBase, group_by: GB({ property: { $type: "CustomPropertyRef", id: 0 } }) }],
  ["code/CP2_EMPTY_FORMULA", "validation.validate_query_args", { ...queryBase, group_by: GB({ property: { $type: "InlineCustomProperty", formula: "   ", inputs: { A: { $type: "PropertyInput", name: "p" } } } }) }],
  ["code/CP3_EMPTY_INPUTS", "validation.validate_query_args", { ...queryBase, group_by: GB({ property: { $type: "InlineCustomProperty", formula: "A", inputs: {} } }) }],
  ["code/CP4_INVALID_INPUT_KEY", "validation.validate_query_args", { ...queryBase, group_by: GB({ property: { $type: "InlineCustomProperty", formula: "A", inputs: { aa: { $type: "PropertyInput", name: "p" } } } }) }],
  ["code/CP5_FORMULA_TOO_LONG", "validation.validate_query_args", { ...queryBase, group_by: GB({ property: { $type: "InlineCustomProperty", formula: NON_BMP.repeat(20001), inputs: { A: { $type: "PropertyInput", name: "p" } } } }) }],
  ["code/CP6_EMPTY_INPUT_NAME", "validation.validate_query_args", { ...queryBase, group_by: GB({ property: { $type: "InlineCustomProperty", formula: "A", inputs: { A: { $type: "PropertyInput", name: "  " } } } }) }],
  ["code/F4_CONTROL_CHAR_EXCLUSION", "validation.validate_funnel_args", { ...funnelBase, exclusions: [{ $type: "Exclusion", event: "X", from_step: 0, to_step: 1 }] }],
  // ^ Exclusion's ctor guard rejects control characters, so
  //   F4_CONTROL_CHAR_EXCLUSION is unreachable from the validator.
  ["code/F4_EMPTY_EXCLUSION_EVENT", "validation.validate_funnel_args", { ...funnelBase, exclusions: [{ $type: "Exclusion", event: "Valid", from_step: 0, to_step: 1 }] }],
  // ^ likewise unreachable (ctor guard EV1_EMPTY_EVENT).
  ["code/F4_EXCLUSION_NEGATIVE_STEP", "validation.validate_funnel_args", { ...funnelBase, exclusions: [{ $type: "Exclusion", event: "X", from_step: 0 }] }],
  // ^ likewise unreachable (ctor guard EX1_FROM_STEP_NEGATIVE).
  ["code/F8_EMPTY_HOLDING_CONSTANT_PROPERTY", "validation.validate_funnel_args", { ...funnelBase, holding_constant: ["", "b"] }],
];

// ---------------------------------------------------------------------------
// 6. Fixed-budget fuzz (>=500 examples per api family, derandomised).
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const SEED = Number(argv[argv.indexOf("--seed") + 1] || 20260815);
const RUNS = Number(argv[argv.indexOf("--runs") + 1] || 500);

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

const DATE_POOL = [
  null, "2024-01-01", "2024-12-31", "2024-02-29", "2023-02-29", "2024-02-30",
  "0000-01-01", "9999-12-31", "01/01/2024", "not-a-date", "", "2024-1-1",
  "2024-01-01\n", NON_BMP, `2024-01-0${NON_BMP}`, "٢٠٢٤-٠١-٠١",
];
const LAST_POOL = [-100, -1, 0, 1, 29, 30, 31, 3650, 3651, 5000, true, 1.5, F("30.0")];
const EVENT_POOL = ["Login", "", "   ", `A${NUL}B`, ZWSP, NON_BMP, "\u00ad", "\u2060", "Purchase", "\t"];
const MATH_POOL = ["total", "unique", "average", "median", "p99", "dau", "wau", "mau", "histogram", "percentile", "totl", "", NON_BMP];
const FMATH_POOL = ["conversion_rate_unique", "conversion_rate_session", "unique", "total", "average", "median", "p99", "uniqe", ""];
const CWU_POOL = ["second", "minute", "hour", "day", "week", "month", "session", "hou", "", NON_BMP];
const FLOW_CWU_POOL = ["day", "week", "month", "session", "dya", "", NON_BMP];
const CT_POOL = ["unique", "total", "session", "uniqe", "", NON_BMP];
const FMODE_POOL = ["sankey", "paths", "tree", "sanke", "", NON_BMP];
const RUNIT_POOL = ["day", "week", "month", "wek", "Week", "", NON_BMP];
const ALIGN_POOL = ["birth", "interval_start", "brith", "", NON_BMP];
const RMATH_POOL = ["retention_rate", "unique", "total", "average", "uniue", "", NON_BMP];
const RMODE_POOL = ["curve", "trends", "table", "curv", null, "", NON_BMP];
const UB_POOL = [null, "none", "carry_back", "carry_forward", "consecutive_forward", "invalid", ""];
const REENTRY_POOL = [null, "default", "basic", "aggressive", "optimized", "invalid", ""];
const DGID_POOL = [null, 1, 0, -1, true, false, 1.5, F("2.0"), "3", []];
const PROP_POOL = [null, "amount", "", NON_BMP];
const PERUSER_POOL = [null, "total", "average", "min", "max"];

function randGroupBy() {
  const r = rng();
  if (r < 0.25) return null;
  if (r < 0.4) return pick(["country", "", "  ", NON_BMP]);
  if (r < 0.5) return [pick(["country", ""]), pick(["platform", NON_BMP])];
  const numeric = [null, 1, 10, 50, 1.5, F("NaN"), F("Infinity"), F("10.0")];
  return GB({
    property: pick(["revenue", NON_BMP, "amount"]),
    property_type: pick(["string", "number", "boolean", "datetime"]),
    bucket_size: pick(numeric),
    bucket_min: pick(numeric),
    bucket_max: pick(numeric),
  });
}

function randBucketSizes() {
  const r = rng();
  if (r < 0.3) return null;
  if (r < 0.4) return [];
  const n = int(1, 6);
  const pool = [1, 2, 3, 7, 0, -1, 1.5, true, false, F("2.0"), "3", null, 731];
  return Array.from({ length: n }, () => pick(pool));
}

const FAMILIES = {
  "validation.validate_time_args": () => ({
    from_date: pick(DATE_POOL),
    to_date: pick(DATE_POOL),
    last: pick(LAST_POOL),
  }),
  "validation.validate_group_by_args": () => ({ group_by: randGroupBy() }),
  "validation.validate_query_args": () => ({
    events: Array.from({ length: int(0, 3) }, () => pick(EVENT_POOL)),
    math: pick(MATH_POOL),
    math_property: pick(PROP_POOL),
    per_user: pick(PERUSER_POOL),
    percentile_value: pick([null, 95, 1.5]),
    from_date: pick(DATE_POOL),
    to_date: pick(DATE_POOL),
    last: pick(LAST_POOL),
    has_formula: pick([true, false]),
    rolling: pick([null, 0, 7, 400, -1, 1.5, true]),
    cumulative: pick([true, false]),
    group_by: randGroupBy(),
    formulas: pick([
      null,
      [],
      [{ $type: "Formula", expression: pick(["A + B", "1 + 2", "A + Z", NON_BMP]) }],
      [
        { $type: "Formula", expression: "A" },
        { $type: "Formula", expression: "ZZ" },
      ],
    ]),
    data_group_id: pick(DGID_POOL),
  }),
  "validation.validate_funnel_args": () => ({
    steps: Array.from({ length: int(0, 4) }, () => pick(EVENT_POOL)),
    conversion_window: pick([0, 1, 2, 14, 368, -1, 1.5, true, null, F("14.0"), "7"]),
    conversion_window_unit: pick(CWU_POOL),
    math: pick(FMATH_POOL),
    math_property: pick(PROP_POOL),
    exclusions: pick([
      null,
      [],
      [{ $type: "Exclusion", event: "Logout", from_step: int(0, 4), to_step: pick([null, 0, 1, 5]) }],
    ]),
    holding_constant: pick([null, [], ["a"], ["a", "b", "c", "d"], ["", "b"], [1]]),
    from_date: pick(DATE_POOL),
    to_date: pick(DATE_POOL),
    last: pick(LAST_POOL),
    group_by: randGroupBy(),
    reentry_mode: pick(REENTRY_POOL),
    data_group_id: pick(DGID_POOL),
  }),
  "validation.validate_retention_args": () => ({
    born_event: pick(EVENT_POOL),
    return_event: pick(EVENT_POOL),
    retention_unit: pick(RUNIT_POOL),
    alignment: pick(ALIGN_POOL),
    bucket_sizes: randBucketSizes(),
    math: pick(RMATH_POOL),
    mode: pick(RMODE_POOL),
    unit: pick(RUNIT_POOL),
    from_date: pick(DATE_POOL),
    to_date: pick(DATE_POOL),
    last: pick(LAST_POOL),
    group_by: pick([
      randGroupBy(),
      [{ $type: "CohortBreakdown", cohort: 123, name: "PU" }, "platform"],
      [{ $type: "CohortBreakdown", cohort: 123, name: "PU" }],
    ]),
    unbounded_mode: pick(UB_POOL),
    data_group_id: pick(DGID_POOL),
  }),
  "validation.validate_flow_args": () => ({
    steps: Array.from({ length: int(0, 3) }, () => pick(EVENT_POOL)),
    forward: pick([-1, 0, 1, 3, 5, 6, true, 1.5]),
    reverse: pick([-1, 0, 1, 5, 6, true]),
    count_type: pick(CT_POOL),
    mode: pick(FMODE_POOL),
    cardinality: pick([0, 1, 3, 50, 51, -1, 1.5]),
    conversion_window: pick([0, 1, 7, 366, 367, 400, -1, 1.5]),
    conversion_window_unit: pick(FLOW_CWU_POOL),
    from_date: pick(DATE_POOL),
    to_date: pick(DATE_POOL),
    last: pick(LAST_POOL),
    time_comparison: pick([null, { $type: "TimeComparison", type: "relative", unit: "month", date: null }]),
    data_group_id: pick(DGID_POOL),
  }),
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
  task: "B2-M1 (validation.py shard V1a)",
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
  divergences: divergences.length,
  divergence_detail: divergences.slice(0, 20),
};
writeFileSync(
  path.join(HERE, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
process.exit(divergences.length === 0 ? 0 : 1);
