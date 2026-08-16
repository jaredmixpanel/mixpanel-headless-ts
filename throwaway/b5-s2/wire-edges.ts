/**
 * B5-S2 R10.9 harness, part 2 — the WIRE edge set (packet §3 "R10.9
 * harness spec (S2)").
 *
 * Part 1 (`py-side.py` / `ts-side.ts` / `compare.ts`) is the *differential*
 * half: the five oracle-callable builders plus the transform math, run
 * against the Python arbiter. This half covers what has no arbiter —
 * the STATUS branches of the 22 wire members and the error registry
 * codes reachable through them — by replaying the mandated edge set
 * (`18.0`, `1.5`, `true`, `null`, `[]`, `""`, `"𝒳"`) through canned
 * responses on the injected fetch seam.
 *
 *     npx vite-node throwaway/b5-s2/wire-edges.ts
 *
 * Throwaway (packet §7.5 removes `throwaway/b5-s2/` at the batch gate).
 */

import {
  createMockClient,
  makeSession,
  type CannedResponse,
  type CapturedFetchRequest,
} from "../../packages/core/test/client/client-test-helpers.js";
import { LiveQueryService } from "../../packages/core/src/services/live-query.js";
import { Workspace } from "../../packages/core/src/workspace.js";
import type { Session } from "../../packages/core/src/auth/session.js";
import { Filter } from "../../packages/core/src/types/query-params/filter.js";

let checks = 0;
let failures = 0;

/**
 * Record one expectation.
 *
 * @param label - What is being checked.
 * @param actual - The observed value (JSON-compared).
 * @param expected - The expected value.
 */
function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    failures += 1;
    console.log(`FAIL ${label}\n  actual   ${a}\n  expected ${b}`);
  }
}

/**
 * Run a thunk and return the thrown error's class name (or `null`).
 *
 * @param fn - The thunk.
 * @returns The class name, or `null` when it resolved.
 */
async function thrown(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

/**
 * Run a thunk and return the thrown error's registry code (or `null`).
 *
 * @param fn - The thunk.
 * @returns The first `ValidationError.code`, the `.code`, or `null`.
 */
async function code(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    const err = error as { code?: string; errors?: Array<{ code: string }> };
    if (Array.isArray(err.errors) && err.errors.length > 0) {
      return err.errors[0]!.code;
    }
    return err.code ?? null;
  }
}

/** Build a LiveQueryService over a canned handler plus its call log. */
function svc(handler: (r: CapturedFetchRequest) => CannedResponse): {
  service: LiveQueryService;
  calls: CapturedFetchRequest[];
  warnings: string[];
} {
  const calls: CapturedFetchRequest[] = [];
  const warnings: string[] = [];
  const { client } = createMockClient(makeSession(), (request) => {
    calls.push(request);
    return handler(request);
  });
  return {
    service: new LiveQueryService(client, {
      warn: (m: string) => warnings.push(m),
    }),
    calls,
    warnings,
  };
}

/** Build a Workspace over a canned handler plus its call log. */
function ws(handler: (r: CapturedFetchRequest) => CannedResponse): {
  workspace: Workspace;
  calls: CapturedFetchRequest[];
} {
  const calls: CapturedFetchRequest[] = [];
  const session = makeSession() as Session;
  const { client } = createMockClient(session, (request) => {
    calls.push(request);
    return handler(request);
  });
  return { workspace: new Workspace({ session, client }), calls };
}

/** `{status, json}` shorthand. */
function res(status: number, json: unknown): CannedResponse {
  return { status, json };
}

/** The mandated R10.9 edge set. */
const EDGE: readonly unknown[] = [18.0, 1.5, true, null, [], "", "\u{1D4B3}"];

/** Runs the whole edge suite. */
async function main(): Promise<void> {
  // =======================================================================
  // 1. Status branches — EVERY consumed status, through a wire member of
  //    each family (the B4 client owns the mapping; S2 must not re-handle
  //    it, so the assertion is pure passthrough).
  // =======================================================================
  {
    const statuses: Array<[number, string]> = [
      [400, "QueryError"],
      [401, "AuthenticationError"],
      // 403 is a QueryError in the Python client (`api_client.py:521`),
      // NOT an AuthenticationError — arbiter-confirmed.
      [403, "QueryError"],
      [404, "QueryError"],
      [429, "RateLimitError"],
      [500, "ServerError"],
      [502, "ServerError"],
      [503, "ServerError"],
    ];
    for (const [status, expected] of statuses) {
      const s = svc(() => res(status, { error: "boom" }));
      check(
        `segmentation/${String(status)}`,
        await thrown(() =>
          s.service.segmentation("Login", "2025-01-01", "2025-01-31"),
        ),
        expected,
      );
      const f = svc(() => res(status, { error: "boom" }));
      check(
        `funnel/${String(status)}`,
        await thrown(() => f.service.funnel(1, "2025-01-01", "2025-01-31")),
        expected,
      );
      const r = svc(() => res(status, { error: "boom" }));
      check(
        `retention/${String(status)}`,
        await thrown(() =>
          r.service.retention("A", "B", "2025-01-01", "2025-01-31"),
        ),
        expected,
      );
      const q = ws(() => res(status, { error: "boom" }));
      check(
        `workspace.query/${String(status)}`,
        await thrown(() =>
          q.workspace.query("Login", {
            from_date: "2025-01-01",
            to_date: "2025-01-31",
          }),
        ),
        expected,
      );
      const u = ws(() => res(status, { error: "boom" }));
      check(
        `workspace.queryUser/${String(status)}`,
        await thrown(() => u.workspace.queryUser({ limit: 1 })),
        expected,
      );
    }
  }

  // =======================================================================
  // 2. Error-as-200 — the four `raw["error"]` sites the transforms own.
  //    Python raises `QueryError` with the stringified payload; the edge
  //    set is replayed through the payload slot.
  // =======================================================================
  {
    for (const payload of EDGE) {
      const s = ws(() => res(200, { error: payload }));
      check(
        `query/error-as-200 ${JSON.stringify(payload)}`,
        await thrown(() =>
          s.workspace.query("Login", {
            from_date: "2025-01-01",
            to_date: "2025-01-31",
          }),
        ),
        "QueryError",
      );
      const f = ws(() => res(200, { error: payload }));
      check(
        `queryFunnel/error-as-200 ${JSON.stringify(payload)}`,
        await thrown(() => f.workspace.queryFunnel(["A", "B"])),
        "QueryError",
      );
      const r = ws(() => res(200, { error: payload }));
      check(
        `queryRetention/error-as-200 ${JSON.stringify(payload)}`,
        await thrown(() => r.workspace.queryRetention("A", "B")),
        "QueryError",
      );
    }
  }

  // =======================================================================
  // 3. Transform math through the WIRE members (canned bodies) — the
  //    packet's named shapes, asserted on the computed numbers.
  // =======================================================================
  {
    // Zero-denominator funnel: steps[0].count == 0 -> overall 0.0.
    const zero = svc(() =>
      res(200, {
        data: {
          "2025-01-01": {
            steps: [
              { event: "A", count: 0 },
              { event: "B", count: 0 },
            ],
          },
        },
      }),
    );
    const zeroResult = await zero.service.funnel(1, "2025-01-01", "2025-01-31");
    check("funnel/zero denominator overall", zeroResult.conversion_rate, 0.0);
    check(
      "funnel/zero denominator step rates",
      zeroResult.steps.map((s) => s.conversion_rate),
      [1.0, 0.0],
    );

    // prev_count == 0 -> step rate 0.0 (but step 0 is the literal 1.0).
    const prevZero = svc(() =>
      res(200, {
        data: {
          "2025-01-01": {
            steps: [
              { event: "A", count: 100 },
              { event: "B", count: 0 },
              { event: "C", count: 0 },
            ],
          },
        },
      }),
    );
    const prevResult = await prevZero.service.funnel(
      1,
      "2025-01-01",
      "2025-01-31",
    );
    check(
      "funnel/prev_count==0 step rates",
      prevResult.steps.map((s) => s.conversion_rate),
      [1.0, 0.0, 0.0],
    );
    check("funnel/prev_count==0 overall", prevResult.conversion_rate, 0.0);

    // Single-step funnel.
    const single = svc(() =>
      res(200, {
        data: { "2025-01-01": { steps: [{ event: "A", count: 10 }] } },
      }),
    );
    const singleResult = await single.service.funnel(
      1,
      "2025-01-01",
      "2025-01-31",
    );
    check("funnel/single step count", singleResult.steps.length, 1);
    check("funnel/single step overall", singleResult.conversion_rate, 1.0);

    // Empty-steps funnel.
    const empty = svc(() =>
      res(200, { data: { "2025-01-01": { steps: [] } } }),
    );
    const emptyResult = await empty.service.funnel(
      1,
      "2025-01-01",
      "2025-01-31",
    );
    check("funnel/empty steps", emptyResult.steps.length, 0);
    check("funnel/empty overall", emptyResult.conversion_rate, 0.0);

    // Segmented `$overall` funnel.
    const overall = svc(() =>
      res(200, {
        data: {
          "2025-01-01": {
            $overall: [
              { event: "A", count: 18.0 },
              { event: "B", count: 9.0 },
            ],
            Chrome: [{ event: "A", count: 5 }],
          },
        },
      }),
    );
    const overallResult = await overall.service.funnel(
      1,
      "2025-01-01",
      "2025-01-31",
    );
    check(
      "funnel/$overall counts (integral floats through parseLossless)",
      overallResult.steps.map((s) => s.count),
      [18, 9],
    );
    check("funnel/$overall rate", overallResult.conversion_rate, 0.5);

    // `$overall`-absent segmented shape: Python falls through to the
    // FIRST segment's list (`_extract_steps_from_date_data`).
    const noOverall = svc(() =>
      res(200, {
        data: { "2025-01-01": { Chrome: [{ event: "A", count: 4 }] } },
      }),
    );
    const noOverallResult = await noOverall.service.funnel(
      1,
      "2025-01-01",
      "2025-01-31",
    );
    check(
      // `_extract_steps_from_date_data` has NO first-segment fallback:
      // neither "steps" nor "$overall" -> `[]` (`live_query.py:76`).
      "funnel/$overall-absent yields no steps",
      noOverallResult.steps.map((s) => s.count),
      [],
    );

    // Empty-cohort retention: size 0 -> all-0.0 row, never NaN.
    const emptyCohort = svc(() =>
      res(200, { "2025-01-01": { first: 0, counts: [0, 0, 0] } }),
    );
    const emptyCohortResult = await emptyCohort.service.retention(
      "A",
      "B",
      "2025-01-01",
      "2025-01-31",
    );
    check(
      "retention/empty cohort",
      emptyCohortResult.cohorts[0]!.retention,
      [0.0, 0.0, 0.0],
    );

    // Mixed empty/live cohorts, code-point ordered by date key.
    const mixed = svc(() =>
      res(200, {
        "2025-01-02": { first: 0, counts: [0] },
        "2025-01-01": { first: 100, counts: [100, 50] },
        "\u{1D4B3}": { first: 4, counts: [2] },
        "": { first: 2, counts: [1] },
      }),
    );
    const mixedResult = await mixed.service.retention(
      "A",
      "B",
      "2025-01-01",
      "2025-01-31",
    );
    check(
      "retention/mixed cohorts, code-point key order",
      mixedResult.cohorts.map((c) => c.date),
      ["", "2025-01-01", "2025-01-02", "\u{1D4B3}"],
    );
    check(
      "retention/mixed cohort rates",
      mixedResult.cohorts.map((c) => c.retention),
      [[0.5], [1.0, 0.5], [0.0], [0.5]],
    );

    // Integral-float cohort sizes through parseLossless.
    const floats = svc(() =>
      res(200, { "2025-01-01": { first: 18.0, counts: [18.0, 9.0] } }),
    );
    const floatResult = await floats.service.retention(
      "A",
      "B",
      "2025-01-01",
      "2025-01-31",
    );
    check(
      "retention/integral-float counts",
      floatResult.cohorts[0]!.retention,
      [1.0, 0.5],
    );

    // Non-dict retention series member -> AttributeError (R10.9 row T2).
    const badCohort = svc(() => res(200, { "2025-01-01": "notadict" }));
    check(
      "retention/non-dict cohort -> AttributeError",
      await thrown(() =>
        badCohort.service.retention("A", "B", "2025-01-01", "2025-01-31"),
      ),
      "AttributeError",
    );

    // Cohort-date normalization on the insights retention path.
    const normalized = ws(() =>
      res(200, {
        computed_at: "2025-01-15T12:00:00",
        date_range: { from_date: "2025-01-01", to_date: "2025-01-31" },
        series: {
          "A and then B": {
            "2025-01-01T00:00:00+00:00": { first: 10, counts: [10, 5] },
            $average: { first: 10, counts: [10, 5] },
          },
        },
        meta: {},
      }),
    );
    const normalizedResult = await normalized.workspace.queryRetention(
      "A",
      "B",
    );
    check(
      "queryRetention/cohort date normalized to YYYY-MM-DD",
      Object.keys(normalizedResult.cohorts),
      ["2025-01-01"],
    );
    check(
      "queryRetention/$average excluded from cohorts",
      Object.hasOwn(normalizedResult.cohorts, "$average"),
      false,
    );

    // Non-dict retention series (insights path) -> QueryError.
    const badSeries = ws(() =>
      res(200, {
        computed_at: "2025-01-15T12:00:00",
        date_range: {},
        series: "notadict",
        meta: {},
      }),
    );
    check(
      "queryRetention/non-dict series",
      await thrown(() => badSeries.workspace.queryRetention("A", "B")),
      "QueryError",
    );
  }

  // =======================================================================
  // 4. Owned error branches — the registry codes reachable from the 22
  //    members (Layer-1/Layer-2 guards; no wire call must happen).
  // =======================================================================
  {
    const noCall = (label: string, calls: CapturedFetchRequest[]): void =>
      check(`${label}: no wire call`, calls.length, 0);

    const a = ws(() => res(200, {}));
    check(
      "query/[] events",
      await code(() => a.workspace.query([])),
      "V0_NO_EVENTS",
    );
    noCall("query/[] events", a.calls);

    const b = ws(() => res(200, {}));
    check(
      "query/non-event type",
      await code(() => b.workspace.query(18.0 as never)),
      "V21_INVALID_EVENT_TYPE",
    );
    noCall("query/non-event type", b.calls);

    const c = ws(() => res(200, {}));
    check(
      "query/non-filter where",
      await code(() => c.workspace.query("Login", { where: 18.0 as never })),
      "V25_INVALID_FILTER_TYPE",
    );
    noCall("query/non-filter where", c.calls);

    const d = ws(() => res(200, {}));
    check(
      "queryFunnel/single step",
      await code(() => d.workspace.queryFunnel(["A"])),
      "F1_MIN_STEPS",
    );
    noCall("queryFunnel/single step", d.calls);

    const e = ws(() => res(200, {}));
    check(
      "queryFunnel/[] steps",
      await code(() => e.workspace.queryFunnel([])),
      "F1_MIN_STEPS",
    );
    noCall("queryFunnel/[] steps", e.calls);

    const f = ws(() => res(200, {}));
    check(
      "queryRetention/'' born event",
      await thrown(() => f.workspace.queryRetention("", "Login")),
      "ParamValidationError",
    );
    noCall("queryRetention/'' born event", f.calls);

    const g = ws(() => res(200, {}));
    check(
      "queryFlow/'' anchor",
      await thrown(() => g.workspace.queryFlow("")),
      "ParamValidationError",
    );
    noCall("queryFlow/'' anchor", g.calls);

    const h = ws(() => res(200, {}));
    check(
      "queryUser/percentile without aggregate",
      await code(() =>
        h.workspace.queryUser({
          aggregate: "percentile",
          aggregate_property: "x",
        }),
      ),
      "U26",
    );
    noCall("queryUser/percentile without aggregate", h.calls);

    // There is NO mode-value guard in Python (`user_validators.py` only
    // ever compares `mode` against the two literals), so an unknown mode
    // validates clean and REACHES the wire — arbiter-confirmed by
    // `build_user_params` case 9 (`{}` params, no error).
    const i = ws(() => res(200, {}));
    check(
      "queryUser/unknown mode is not rejected",
      await code(() => i.workspace.queryUser({ mode: "\u{1D4B3}" as never })),
      null,
    );
    check("queryUser/unknown mode reaches the wire", i.calls.length, 1);

    const j = ws(() => res(200, {}));
    check(
      "queryUser/unknown sort_order",
      await code(() =>
        j.workspace.queryUser({ sort_by: "ltv", sort_order: "" as never }),
      ),
      "U19",
    );
    noCall("queryUser/unknown sort_order", j.calls);

    const k = ws(() => res(200, {}));
    check(
      "buildUserParams/non-filter where",
      await code(() => k.workspace.buildUserParams({ where: 18.0 as never })),
      "U9",
    );
    noCall("buildUserParams/non-filter where", k.calls);
  }

  // =======================================================================
  // 5. The edge set as ARGUMENT values on the wire members that accept
  //    free-form scalars (filter values + segmentation `on`).
  // =======================================================================
  {
    for (const value of EDGE) {
      const s = ws(() =>
        res(200, {
          series: {},
          computed_at: "2025-01-01T00:00:00",
          date_range: {},
          meta: {},
        }),
      );
      const outcome = await thrown(() =>
        s.workspace.query("Login", {
          where: Filter.equals("p", value as never),
          from_date: "2025-01-01",
          to_date: "2025-01-31",
        }),
      );
      // `[]` is the one edge value the filter guard rejects
      // (`B20_EMPTY_FILTER_VALUE`) — arbiter-confirmed.
      const rejected = Array.isArray(value);
      check(
        `query/where value ${JSON.stringify(value)}`,
        outcome,
        rejected ? "BookmarkValidationError" : null,
      );
      check(
        `query/where value ${JSON.stringify(value)} wire calls`,
        s.calls.length,
        rejected ? 0 : 1,
      );
    }
    for (const on of ["", "\u{1D4B3}", 'properties["x"]']) {
      const s = svc(() => res(200, { data: { series: [], values: {} } }));
      check(
        `segmentation/on ${JSON.stringify(on)}`,
        await thrown(() =>
          s.service.segmentation("Login", "2025-01-01", "2025-01-31", { on }),
        ),
        null,
      );
    }
  }

  // =======================================================================
  // 6. Bodies the wire layer, not the service, must reject.
  // =======================================================================
  {
    const garbage = svc(() => ({
      status: 200,
      text: "<html>nope",
      headers: { "content-type": "text/html" },
    }));
    console.log(
      `note: non-JSON 200 -> ${String(
        await thrown(() =>
          garbage.service.segmentation("Login", "2025-01-01", "2025-01-31"),
        ),
      )}`,
    );
    const { client } = createMockClient(makeSession(), () => {
      throw new TypeError("fetch failed");
    });
    console.log(
      `note: transport failure -> ${String(
        await thrown(() =>
          new LiveQueryService(client).segmentation(
            "Login",
            "2025-01-01",
            "2025-01-31",
          ),
        ),
      )}`,
    );
  }

  console.log(`\n${String(checks)} checks / ${String(failures)} failures`);
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
