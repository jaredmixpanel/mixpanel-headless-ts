// The query vocabulary on the browser entry point.
//
// Pages built against the browser bundle construct their queries
// client-side: a control changes, the page rebuilds params with
// `Filter` / `Metric` / `FunnelStep` / `CohortDefinition` / … and
// re-queries. Those builders are pure core dataclasses (no transport,
// no credentials), but until now none of them were re-exported from
// `@mixpanel-headless/browser`, so the bundled IIFE global had no
// runtime presence for the vocabulary the README tells a consumer to
// import. This suite pins them onto the entry point.
//
// It also pins the two gates that must survive the addition:
//   - identity with core (the values are THE core classes, so the
//     purity proof that covers `packages/core` covers them here), and
//   - drift: every runtime export of core's `query-params` barrel is
//     present on the browser barrel, so a new core export — function or
//     not — cannot silently reopen the gap this suite closed.
//
// The same treatment covers the two identity helpers a page needs to
// name what it built: `pythonJsonDumpsCanonical` and `inferBookmarkType`
// (heads spec 02 §3.3).

import { describe, expect, it } from "vitest";

import * as browserEntry from "../src/index.js";
import * as coreQueryParams from "../../core/src/types/query-params/index.js";
import { CreateAnnotationParams as coreCreateAnnotationParams } from "../../core/src/types/entities/annotations.js";
import { inferBookmarkType as coreInferBookmarkType } from "../../core/src/bookmarks/infer-type.js";
import { pythonJsonDumpsCanonical as corePythonJsonDumpsCanonical } from "../../core/src/compat/python-json-dumps-canonical.js";
import { Workspace } from "../../core/src/workspace.js";
import {
  mockWorkspaceClient,
  TEST_SESSION,
} from "../../core/test-support/workspace-test-helpers.js";
import {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  CreateAnnotationParams,
  Filter,
  FlowStep,
  Formula,
  FrequencyBreakdown,
  FunnelStep,
  GroupBy,
  Metric,
  TimeComparison,
  validateBookmark,
} from "../src/index.js";

/** A cohort the breakdown/filter cases can share. */
function powerUsers(): CohortDefinition {
  return new CohortDefinition(
    CohortCriteria.didEvent("Purchase", { at_least: 3, within_days: 30 }),
  );
}

describe("browser entry — query vocabulary is present at runtime", () => {
  it("re-exports the builder classes as runtime values", () => {
    for (const name of [
      "CohortBreakdown",
      "CohortCriteria",
      "CohortDefinition",
      "Filter",
      "FlowStep",
      "Formula",
      "FrequencyBreakdown",
      "FunnelStep",
      "GroupBy",
      "Metric",
      "TimeComparison",
    ]) {
      expect(Object.keys(browserEntry)).toContain(name);
    }
  });

  it("exposes `Filter`'s static builders", () => {
    expect(typeof Filter.equals).toBe("function");
    expect(typeof Filter.inCohort).toBe("function");
    expect(Filter.equals("country", "US")).toBeInstanceOf(Filter);
    expect(Filter.inCohort(powerUsers(), "Power Users")).toBeInstanceOf(Filter);
  });

  it("constructs the insights vocabulary", () => {
    expect(new Metric({ event: "Signup", math: "unique" })).toBeInstanceOf(
      Metric,
    );
    expect(
      new Formula({ expression: "(B / A) * 100", label: "Conversion Rate" }),
    ).toBeInstanceOf(Formula);
    expect(
      new GroupBy({
        property: "amount",
        property_type: "number",
        bucket_size: 50,
      }),
    ).toBeInstanceOf(GroupBy);
    expect(TimeComparison.relative("month")).toBeInstanceOf(TimeComparison);
    expect(
      new FrequencyBreakdown({ event: "Purchase", bucket_max: 10 }),
    ).toBeInstanceOf(FrequencyBreakdown);
  });

  it("constructs the funnel and flow vocabulary", () => {
    expect(
      new FunnelStep({
        event: "Purchase",
        filters: [Filter.equals("plan", "pro")],
      }),
    ).toBeInstanceOf(FunnelStep);
    expect(
      new FlowStep({ event: "Purchase", forward: 3, reverse: 1 }),
    ).toBeInstanceOf(FlowStep);
  });

  it("constructs inline cohorts", () => {
    const cohort = powerUsers();
    expect(cohort).toBeInstanceOf(CohortDefinition);
    expect(
      CohortCriteria.didEvent("Purchase", { at_least: 3, within_days: 30 }),
    ).toBeInstanceOf(CohortCriteria);
    expect(new CohortBreakdown({ cohort, name: "Power Users" })).toBeInstanceOf(
      CohortBreakdown,
    );
  });

  it("re-exports `validateBookmark` as a callable", () => {
    expect(typeof validateBookmark).toBe("function");
    expect(Object.keys(browserEntry)).toContain("validateBookmark");
  });
});

describe("browser entry — the re-exports are the core values themselves", () => {
  // Identity, not a copy: whatever the core-purity proof (eslint
  // boundary + browser-smoke bundle) establishes about these classes
  // holds verbatim on the browser entry. A pure builder carries no
  // `fetch` path because it IS the core dataclass.
  //
  // The loop below reads EVERY runtime export, not just the callable
  // ones. A namespace object only ever carries runtime exports —
  // TypeScript's type-only exports have no presence in `Object.entries`
  // — so enumerating it wholesale is exactly "the runtime surface of
  // core's query-params barrel". Filtering to `typeof value ===
  // "function"` (as this guard first did) let a non-function runtime
  // export — a lookup table, an operator-name const, an enum-like frozen
  // object — be added to core and silently skip the check.
  it("every runtime export of core's query-params barrel is re-exported by identity", () => {
    const missing: string[] = [];
    const notIdentical: string[] = [];
    const entry = browserEntry as unknown as Record<string, unknown>;
    for (const [name, value] of Object.entries(coreQueryParams)) {
      if (!Object.hasOwn(entry, name)) {
        missing.push(name);
        continue;
      }
      if (entry[name] !== value) notIdentical.push(name);
    }
    expect(missing).toEqual([]);
    expect(notIdentical).toEqual([]);
  });

  it("carries no transport: no builder exposes a fetch/transport seam", () => {
    const entry = browserEntry as unknown as Record<string, unknown>;
    for (const name of Object.keys(coreQueryParams)) {
      const value = entry[name];
      // Constructor-shaped exports only — `.prototype` is what this
      // assertion reads, and a non-function value has none. The drift
      // guard above is the one that must see every runtime export.
      if (typeof value !== "function") continue;
      expect(Object.hasOwn(value, "fetch")).toBe(false);
      expect(Object.hasOwn(value, "transport")).toBe(false);
      expect(Object.hasOwn(value.prototype as object, "fetch")).toBe(false);
    }
  });
});

describe("browser entry — entity params for the v1 write scopes", () => {
  // Annotations is the ONE grantable write scope in v1 (spec 05 §2.1,
  // §3.2 rule 7), and `ws.createAnnotation(params)` takes a
  // `CreateAnnotationParams` INSTANCE — so a page with that scope
  // cannot call it unless this class has a runtime presence on the
  // bundled entry. It is the only entity model forwarded; the other
  // ~119 stay off this barrel until their write class is grantable.
  it("re-exports `CreateAnnotationParams` as a runtime class, by identity", () => {
    expect(Object.keys(browserEntry)).toContain("CreateAnnotationParams");
    expect(typeof CreateAnnotationParams).toBe("function");
    expect(CreateAnnotationParams).toBe(coreCreateAnnotationParams);
  });

  it("constructs from the documented field set", () => {
    const params = new CreateAnnotationParams({
      date: "2026-09-03 12:00:00",
      description: "Pricing page relaunch",
    });
    expect(params).toBeInstanceOf(CreateAnnotationParams);
    expect(params.description).toBe("Pricing page relaunch");
  });

  it("carries no transport: no fetch/transport seam", () => {
    expect(Object.hasOwn(CreateAnnotationParams, "fetch")).toBe(false);
    expect(Object.hasOwn(CreateAnnotationParams, "transport")).toBe(false);
    expect(Object.hasOwn(CreateAnnotationParams.prototype, "fetch")).toBe(
      false,
    );
    expect(Object.hasOwn(CreateAnnotationParams.prototype, "transport")).toBe(
      false,
    );
  });

  it("does NOT drag the rest of the entity family onto the barrel", () => {
    // The lead's scope line: one class, not the ~119-model surface.
    expect(Object.keys(browserEntry)).not.toContain("CreateCohortParams");
    expect(Object.keys(browserEntry)).not.toContain("CreateFeatureFlagParams");
    expect(Object.keys(browserEntry)).not.toContain("CreateDashboardParams");
  });
});

describe("browser entry — identity helpers (core re-exports)", () => {
  // Heads spec 02 §3.3: a page computes and cites QueryRef hashes. The
  // hash is defined over `pythonJsonDumpsCanonical(params)`, and the ref
  // is labelled with the report type `inferBookmarkType(params)` derives.
  // A page that builds its own params (the whole point of the query
  // vocabulary above) therefore needs BOTH on the bundled entry — the
  // desktop's vendored bundle is built from this barrel and has no other
  // module to reach into. Both are pure core functions.
  const IDENTITY_HELPERS: ReadonlyArray<readonly [string, unknown]> = [
    ["pythonJsonDumpsCanonical", corePythonJsonDumpsCanonical],
    ["inferBookmarkType", coreInferBookmarkType],
  ];

  it.each(IDENTITY_HELPERS)(
    "re-exports `%s` as a runtime function, by identity with core",
    (name, coreValue) => {
      const entry = browserEntry as unknown as Record<string, unknown>;
      expect(Object.keys(browserEntry)).toContain(name);
      expect(typeof entry[name]).toBe("function");
      expect(entry[name]).toBe(coreValue);
    },
  );

  it("canonicalizes through the entry exactly as core does", () => {
    const entry = browserEntry as unknown as Record<string, unknown>;
    const canonicalize = entry["pythonJsonDumpsCanonical"] as (
      value: unknown,
    ) => string;
    // Key-sorted, separator-tight — the bytes the QueryRef hash is taken
    // over. If this ever diverges from core the hashes a page cites stop
    // matching the ones the desktop computes.
    const params = { event: "Purchase", b: 1, a: [2, 3] };
    expect(canonicalize(params)).toBe(corePythonJsonDumpsCanonical(params));
    expect(canonicalize(params)).toBe('{"a":[2,3],"b":1,"event":"Purchase"}');
  });

  it("labels REAL builder output through the entry: funnel params -> `funnels`", async () => {
    // The positive case, and deliberately not a hand-written object: a
    // hand-written params bag would test the classifier against a
    // fiction. This is what `buildFunnelParams` actually emits — the
    // same posture `packages/core/test/bookmarks/infer-type.test.ts`
    // takes. The builders are pure, so the mocked client is never
    // called. `Workspace` is path-imported from core because the browser
    // barrel exports it TYPE-only (FB-2) — that gate is unaffected here.
    const entry = browserEntry as unknown as Record<string, unknown>;
    const infer = entry["inferBookmarkType"] as (value: unknown) => unknown;
    const ws = new Workspace({
      session: TEST_SESSION,
      client: mockWorkspaceClient().client,
    });
    const funnelParams = await ws.buildFunnelParams([
      "Signup",
      new FunnelStep({
        event: "Purchase",
        filters: [Filter.equals("plan", "pro")],
      }),
    ]);
    expect(infer(funnelParams)).toBe("funnels");
    expect(infer(funnelParams)).toBe(coreInferBookmarkType(funnelParams));
  });

  it("returns null rather than guessing, exactly as core does", () => {
    const entry = browserEntry as unknown as Record<string, unknown>;
    const infer = entry["inferBookmarkType"] as (value: unknown) => unknown;
    expect(infer({ foo: "bar" })).toBe(coreInferBookmarkType({ foo: "bar" }));
    expect(infer({ foo: "bar" })).toBeNull();
  });

  it("carries no transport: neither helper exposes a fetch/transport seam", () => {
    const entry = browserEntry as unknown as Record<string, unknown>;
    for (const [name] of IDENTITY_HELPERS) {
      const value = entry[name] as object;
      expect(Object.hasOwn(value, "fetch")).toBe(false);
      expect(Object.hasOwn(value, "transport")).toBe(false);
    }
  });
});
