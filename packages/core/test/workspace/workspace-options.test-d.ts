// Type-level contract of the `Workspace` facade's public surface: the
// constructor option bag and the method signatures a consumer compiles
// against. Runtime behavior lives in test/workspace/*.test.ts; this file
// only fails when a signature drifts.
import { describe, expectTypeOf, it } from "vitest";

import type {
  Dashboard,
  ResolvedReport,
  SegmentationResult,
  Workspace,
  WorkspaceFunnelOptions,
  WorkspaceOptions,
  WorkspaceRetentionOptions,
  WorkspaceSegmentationOptions,
} from "../../src/index.js";

describe("WorkspaceOptions", () => {
  it("every option is optional — `new Workspace({})` compiles", () => {
    expectTypeOf({}).toExtend<WorkspaceOptions>();
  });

  it("rejects keys that are not resolver axes or seams", () => {
    // @ts-expect-error -- the project axis is `project`, not `projectId`
    const options: WorkspaceOptions = { projectId: "12345" };
    expectTypeOf(options).toEqualTypeOf<WorkspaceOptions>();
  });

  it("resolver axes keep Python's `str | None` / `int | None` shape", () => {
    expectTypeOf<WorkspaceOptions["account"]>().toEqualTypeOf<
      string | null | undefined
    >();
    expectTypeOf<WorkspaceOptions["project"]>().toEqualTypeOf<
      string | null | undefined
    >();
    expectTypeOf<WorkspaceOptions["workspace"]>().toEqualTypeOf<
      number | null | undefined
    >();
    expectTypeOf<WorkspaceOptions["target"]>().toEqualTypeOf<
      string | null | undefined
    >();
  });
});

describe("live-query option bags", () => {
  it("segmentation(event, options) requires the date window", () => {
    expectTypeOf<Workspace["segmentation"]>().parameters.toEqualTypeOf<
      [string, WorkspaceSegmentationOptions]
    >();
    expectTypeOf<
      Workspace["segmentation"]
    >().returns.resolves.toEqualTypeOf<SegmentationResult>();
    // @ts-expect-error -- `from_date` / `to_date` are required
    const bag: WorkspaceSegmentationOptions = {};
    expectTypeOf(bag).toEqualTypeOf<WorkspaceSegmentationOptions>();
  });

  it("funnel(funnelId, options) takes a numeric id", () => {
    expectTypeOf<Workspace["funnel"]>().parameter(0).toEqualTypeOf<number>();
    expectTypeOf<Workspace["funnel"]>()
      .parameter(1)
      .toEqualTypeOf<WorkspaceFunnelOptions>();
    // @ts-expect-error -- ids are numbers, not digit strings
    const id: Parameters<Workspace["funnel"]>[0] = "123";
    expectTypeOf(id).toBeNumber();
  });

  it("retention(options) requires both events and the date window", () => {
    expectTypeOf<WorkspaceRetentionOptions>()
      .toHaveProperty("born_event")
      .toEqualTypeOf<string>();
    expectTypeOf<WorkspaceRetentionOptions>()
      .toHaveProperty("return_event")
      .toEqualTypeOf<string>();
    // @ts-expect-error -- `born_event` / `return_event` are required
    const bag: WorkspaceRetentionOptions = {
      from_date: "2024-01-01",
      to_date: "2024-01-31",
    };
    expectTypeOf(bag).toEqualTypeOf<WorkspaceRetentionOptions>();
  });
});

describe("entity and report-link methods", () => {
  it("dashboards resolve to Dashboard entities keyed by numeric id", () => {
    expectTypeOf<Workspace["listDashboards"]>().returns.resolves.toEqualTypeOf<
      Dashboard[]
    >();
    expectTypeOf<Workspace["getDashboard"]>().parameters.toEqualTypeOf<
      [number]
    >();
    expectTypeOf<
      Workspace["getDashboard"]
    >().returns.resolves.toEqualTypeOf<Dashboard>();
  });

  it("resolveReportLink takes the pasted string and resolves to ResolvedReport", () => {
    expectTypeOf<Workspace["resolveReportLink"]>().parameters.toEqualTypeOf<
      [string]
    >();
    expectTypeOf<
      Workspace["resolveReportLink"]
    >().returns.resolves.toEqualTypeOf<ResolvedReport>();
  });
});
