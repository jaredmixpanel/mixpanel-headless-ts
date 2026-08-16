/**
 * B5-S2 R10.9 differential harness — the TS side.
 *
 * Reads `cases.json` (written by `py-side.py`), rebuilds the SAME typed
 * objects from each recipe, runs the five builder members, writes
 * `ts-out.json`.
 *
 *     npx vite-node throwaway/b5-s2/ts-side.ts
 *
 * Throwaway (packet §7.5 removes `throwaway/b5-s2/` at the batch gate).
 */

/* eslint-disable @typescript-eslint/no-explicit-any --
   Throwaway harness: `cases.json` is an untyped recipe language read on
   both sides, and the transform dispatch table is heterogeneous. Using
   `unknown` here would only add casts at every use site. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Session } from "../../packages/core/src/auth/session.js";
import type { MixpanelClient } from "../../packages/core/src/client/client.js";
import { Secret } from "../../packages/core/src/secret.js";
import { Workspace } from "../../packages/core/src/workspace.js";
import { CohortBreakdown } from "../../packages/core/src/types/query-params/cohort.js";
import { Filter } from "../../packages/core/src/types/query-params/filter.js";
import { FlowStep } from "../../packages/core/src/types/query-params/flow.js";
import { FrequencyBreakdown } from "../../packages/core/src/types/query-params/frequency.js";
import {
  Exclusion,
  FunnelStep,
  HoldingConstant,
} from "../../packages/core/src/types/query-params/funnel.js";
import { GroupBy } from "../../packages/core/src/types/query-params/group-by.js";
import {
  CohortMetric,
  Metric,
} from "../../packages/core/src/types/query-params/metric.js";
import { RetentionEvent } from "../../packages/core/src/types/query-params/retention.js";
import type { BookmarkValidationError } from "../../packages/core/src/errors.js";
import { parseLossless } from "../../packages/core/src/client/lossless-json.js";
import { toNativeJson } from "../../packages/core/src/client/json-value.js";
import {
  extractCohortsAndAverage,
  extractFunnelStepsFromSeries,
  extractStepsFromDateData,
  normalizeCohortDate,
  transformFunnel,
  transformRetention,
} from "../../packages/core/src/services/live-query-transforms.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A recipe object as loaded from `cases.json`. */
type Rec = Record<string, any>;

const SESSION: Session = {
  account: {
    type: "service_account",
    name: "test_account",
    region: "us",
    username: "test_user",
    secret: new Secret("test_secret"),
    default_project: "12345",
  },
  project: { id: "12345" },
  workspace: null,
  headers: new Map<string, string>(),
};

/** A client stub that fails loudly if any wire call is attempted. */
const CLIENT = new Proxy(
  {},
  {
    get(): never {
      throw new Error("harness: no wire call expected from a builder member");
    },
  },
) as unknown as MixpanelClient;

const ws = new Workspace({ session: SESSION, client: CLIENT });

/**
 * Build the `Filter` a recipe describes (mirror of `_build_filter`).
 *
 * @param spec - The recipe.
 * @returns The filter.
 * @throws Error - On an unknown op (the two sides share one op list).
 */
function buildFilter(spec: Rec): Filter {
  const prop = spec["prop"] as string;
  switch (spec["op"]) {
    case "equals":
      return Filter.equals(prop, spec["value"]);
    case "greater_than":
      return Filter.greaterThan(prop, spec["value"]);
    case "less_than":
      return Filter.lessThan(prop, spec["value"]);
    case "contains":
      return Filter.contains(prop, spec["value"]);
    case "is_set":
      return Filter.isSet(prop);
    case "is_not_set":
      return Filter.isNotSet(prop);
    case "between":
      return Filter.between(prop, spec["value"][0], spec["value"][1]);
    case "in_cohort":
      return Filter.inCohort(spec["cohort_id"], spec["name"]);
    case "not_in_cohort":
      return Filter.notInCohort(spec["cohort_id"], spec["name"]);
    default:
      throw new Error(`unknown filter op ${String(spec["op"])}`);
  }
}

/**
 * Build the group-by value a recipe describes (`_build_group`).
 *
 * @param spec - The recipe.
 * @returns The group-by value.
 */
function buildGroup(spec: Rec): unknown {
  switch (spec["kind"]) {
    case "str":
      return spec["v"];
    case "groupby":
      return new GroupBy({
        property: spec["property"],
        property_type: spec["property_type"],
      });
    case "bucketed":
      return new GroupBy({
        property: spec["property"],
        property_type: "number",
        bucket_size: spec["bucket_size"],
        bucket_min: spec["bucket_min"],
        bucket_max: spec["bucket_max"],
      });
    case "cohort":
      return new CohortBreakdown({
        cohort: spec["cohort"],
        name: spec["name"],
        include_negated: spec["include_negated"],
      });
    default:
      return new FrequencyBreakdown({
        event: spec["event"],
        label: spec["label"],
      });
  }
}

/**
 * Build the insights event value a recipe describes (`_build_event`).
 *
 * @param spec - The recipe.
 * @returns The event value.
 */
function buildEvent(spec: Rec): unknown {
  if (spec["kind"] === "str") {
    return spec["v"];
  }
  if (spec["kind"] === "cohort_metric") {
    return new CohortMetric({ cohort: spec["cohort"], name: spec["name"] });
  }
  const fields: Rec = { event: spec["event"], math: spec["math"] };
  if (Object.hasOwn(spec, "property")) {
    fields["property"] = spec["property"];
  }
  if (Object.hasOwn(spec, "filters")) {
    fields["filters"] = (spec["filters"] as Rec[]).map(buildFilter);
    fields["filters_combinator"] = spec["filters_combinator"];
  }
  if (Object.hasOwn(spec, "segment_method")) {
    fields["segment_method"] = spec["segment_method"];
  }
  return new Metric(fields as never);
}

/** `_resolve_where`. */
function resolveWhere(spec: unknown): unknown {
  if (spec === null || spec === undefined) {
    return null;
  }
  if (typeof spec === "string") {
    return spec;
  }
  return (spec as Rec[]).map(buildFilter);
}

/** `_resolve_group`. */
function resolveGroup(spec: unknown): unknown {
  if (spec === null || spec === undefined) {
    return null;
  }
  return (spec as Rec[]).map(buildGroup);
}

/**
 * Run `fn`, recording the raised class + codes the way `_guarded` does.
 *
 * @param fn - The thunk.
 * @returns The result, or an `{error, codes}` envelope.
 */
async function guarded(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    return await fn();
  } catch (exc) {
    const err = exc as Partial<BookmarkValidationError> & {
      code?: string;
      constructor: { name: string };
    };
    let codes: string[] = [];
    if (typeof err.code === "string") {
      codes = [err.code];
    }
    // The AGGREGATE inner codes win over the envelope code.
    if (Array.isArray(err.errors) && err.errors.length > 0) {
      codes = err.errors.map((e) => e.code);
    }
    if (process.env["HARNESS_DEBUG"] === "1") {
      console.error((exc as Error).stack?.split("\n").slice(0, 6).join("\n"));
    }
    return { error: err.constructor.name, codes };
  }
}

const cases = JSON.parse(
  readFileSync(join(HERE, "cases.json"), "utf8"),
) as Record<string, Rec[]>;

const out: Record<string, unknown[]> = {};

// --- build_params ---------------------------------------------------------
out["build_params"] = [];
for (const c of cases["build_params"]!) {
  // Recipe interpretation happens INSIDE the guard because the Python
  // side builds its objects inside the `_guarded` lambda too — a ctor
  // guard (e.g. `CF2_COHORT_NAME_EMPTY`) must be recorded, not crash.
  out["build_params"].push(
    await guarded(() => {
      // POSITIONALS FIRST: CPython evaluates positional arguments before
      // the `**kwargs` mapping, so a ctor guard inside `events` must win
      // over one inside `where` (e.g. `CM2_…` over `CF2_…`).
      const built = (c["events"] as Rec[]).map(buildEvent);
      const kwargs: Rec = {};
      for (const [k, v] of Object.entries(c["kwargs"] as Rec)) {
        kwargs[k] =
          k === "where"
            ? resolveWhere(v)
            : k === "group_by"
              ? resolveGroup(v)
              : v;
      }
      return ws.buildParams(built as never, kwargs);
    }),
  );
}

// --- build_funnel_params --------------------------------------------------
/** `_funnel_steps`. */
function funnelSteps(items: Rec[]): Array<string | FunnelStep> {
  return items.map((s) => {
    if (s["kind"] === "str") {
      return s["v"] as string;
    }
    const fields: Rec = { event: s["event"] };
    if (Object.hasOwn(s, "filters")) {
      fields["filters"] = (s["filters"] as Rec[]).map(buildFilter);
      fields["filters_combinator"] = s["filters_combinator"];
    }
    if (Object.hasOwn(s, "label")) {
      fields["label"] = s["label"];
    }
    if (Object.hasOwn(s, "order")) {
      fields["order"] = s["order"];
    }
    return new FunnelStep(fields as never);
  });
}

/** `_exclusions`. */
function exclusions(items: unknown): unknown {
  if (items === null || items === undefined) {
    return null;
  }
  return (items as Rec[]).map((e) =>
    e["kind"] === "str"
      ? (e["v"] as string)
      : new Exclusion({
          event: e["event"],
          from_step: e["from_step"],
          to_step: e["to_step"],
        }),
  );
}

/** `_holding`. */
function holding(items: unknown): unknown {
  if (items === null || items === undefined) {
    return null;
  }
  return (items as Rec[]).map((h) =>
    h["kind"] === "str"
      ? (h["v"] as string)
      : new HoldingConstant({
          property: h["property"],
          resource_type: h["resource_type"],
        }),
  );
}

out["build_funnel_params"] = [];
for (const c of cases["build_funnel_params"]!) {
  out["build_funnel_params"].push(
    await guarded(() => {
      const steps = funnelSteps(c["steps"] as Rec[]);
      const kwargs: Rec = {};
      for (const [k, v] of Object.entries(c["kwargs"] as Rec)) {
        kwargs[k] =
          k === "where"
            ? resolveWhere(v)
            : k === "group_by"
              ? resolveGroup(v)
              : k === "exclusions"
                ? exclusions(v)
                : k === "holding_constant"
                  ? holding(v)
                  : v;
      }
      return ws.buildFunnelParams(steps, kwargs);
    }),
  );
}

// --- build_flow_params ----------------------------------------------------
/** `_flow_step`. */
function flowStep(spec: Rec): unknown {
  if (spec["kind"] === "str") {
    return spec["v"];
  }
  if (spec["kind"] === "list") {
    return (spec["items"] as Rec[]).map(flowStep);
  }
  const fields: Rec = { event: spec["event"] };
  for (const key of ["forward", "reverse", "label", "session_event"]) {
    if (Object.hasOwn(spec, key)) {
      fields[key] = spec[key];
    }
  }
  if (Object.hasOwn(spec, "filters")) {
    fields["filters"] = (spec["filters"] as Rec[]).map(buildFilter);
    fields["filters_combinator"] = spec["filters_combinator"];
  }
  return new FlowStep(fields as never);
}

out["build_flow_params"] = [];
for (const c of cases["build_flow_params"]!) {
  out["build_flow_params"].push(
    await guarded(() => {
      const anchor = flowStep(c["event"] as Rec);
      const kwargs: Rec = {};
      for (const [k, v] of Object.entries(c["kwargs"] as Rec)) {
        kwargs[k] =
          k === "where"
            ? resolveWhere(v)
            : k === "segments"
              ? resolveGroup(v)
              : v;
      }
      return ws.buildFlowParams(anchor as never, kwargs);
    }),
  );
}

// --- build_retention_params -----------------------------------------------
/** `_ret_event`. */
function retEvent(spec: Rec): string | RetentionEvent {
  if (spec["kind"] === "str") {
    return spec["v"] as string;
  }
  const fields: Rec = { event: spec["event"] };
  if (Object.hasOwn(spec, "filters")) {
    fields["filters"] = (spec["filters"] as Rec[]).map(buildFilter);
    fields["filters_combinator"] = spec["filters_combinator"];
  }
  return new RetentionEvent(fields as never);
}

out["build_retention_params"] = [];
for (const c of cases["build_retention_params"]!) {
  out["build_retention_params"].push(
    await guarded(() => {
      const born = retEvent(c["born"] as Rec);
      const ret = retEvent(c["ret"] as Rec);
      const kwargs: Rec = {};
      for (const [k, v] of Object.entries(c["kwargs"] as Rec)) {
        kwargs[k] =
          k === "where"
            ? resolveWhere(v)
            : k === "group_by"
              ? resolveGroup(v)
              : v;
      }
      return ws.buildRetentionParams(born, ret, kwargs);
    }),
  );
}

// --- build_user_params ----------------------------------------------------
out["build_user_params"] = [];
for (const c of cases["build_user_params"]!) {
  out["build_user_params"].push(
    await guarded(() => {
      const kwargs: Rec = {};
      for (const [k, v] of Object.entries(c["kwargs"] as Rec)) {
        if (k === "where") {
          kwargs["where"] = resolveWhere(v);
        } else if (k === "where_raw" || k === "where_scalar") {
          kwargs["where"] = v;
        } else {
          kwargs[k] = v;
        }
      }
      return ws.buildUserParams(kwargs);
    }),
  );
}

// --- transforms -----------------------------------------------------------
// Bodies arrive as JSON **text** so the TS side walks the production wire
// path (`parseLossless` + `toNativeJson`, B0-1 F1), not a bare
// `JSON.parse`. This is where the mandated integral-float `18.0` counts
// are exercised end to end.
const TRANSFORMS: Record<string, (...args: any[]) => unknown> = {
  normalizeCohortDate,
  extractStepsFromDateData,
  transformFunnel,
  transformRetention,
  extractFunnelStepsFromSeries: (series: unknown) =>
    extractFunnelStepsFromSeries(series, () => {}),
  extractCohortsAndAverage,
};

out["transforms"] = [];
for (const c of cases["transforms"]!) {
  out["transforms"].push(
    await guarded(() => {
      const fn = TRANSFORMS[c["fn"] as string]!;
      const args = [...(c["args"] as unknown[])];
      if (c["body"] !== null) {
        args.unshift(
          toNativeJson(
            parseLossless(c["body"] as string, { pythonConstants: true }),
          ),
        );
      }
      // Class instances project through their own enumerable fields,
      // which the port mirrors 1:1 with the Python dataclass fields
      // (`dataclasses.asdict` on the arbiter side).
      return JSON.parse(JSON.stringify(fn(...args) ?? null)) as unknown;
    }),
  );
}

writeFileSync(join(HERE, "ts-out.json"), JSON.stringify(out), "utf8");
for (const [family, values] of Object.entries(out)) {
  const errors = values.filter(
    (v) => v !== null && typeof v === "object" && "error" in (v as Rec),
  ).length;
  console.log(
    `${family.padEnd(26)} ${String(values.length).padStart(5)} cases  ` +
      `${String(errors).padStart(5)} raised`,
  );
}
