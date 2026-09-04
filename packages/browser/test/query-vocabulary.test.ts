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
//     present on the browser barrel, so a new core builder cannot
//     silently reopen the gap this suite closed.

import { describe, expect, it } from "vitest";

import * as browserEntry from "../src/index.js";
import * as coreQueryParams from "../../core/src/types/query-params/index.js";
import { CreateAnnotationParams as coreCreateAnnotationParams } from "../../core/src/types/entities/annotations.js";
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
  it("every runtime export of core's query-params barrel is re-exported by identity", () => {
    const missing: string[] = [];
    const notIdentical: string[] = [];
    const entry = browserEntry as unknown as Record<string, unknown>;
    for (const [name, value] of Object.entries(coreQueryParams)) {
      if (typeof value !== "function") continue;
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
