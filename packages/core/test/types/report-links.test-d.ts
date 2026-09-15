// Type-level twins of the `test_frozen` assertions in
// tests/unit/test_types_report_links.py. Python raises on attribute
// assignment; the TS contract is `readonly`, which only the compiler can
// check, so these pins live here rather than behind `@ts-expect-error` in
// the runtime file. `ReportLink` and `ResolvedReport` also freeze at runtime
// (asserted in report-links.test.ts); `BookmarkUrl` does not — PORTING.md
// "Runtime immutability" — so for it this file is the whole test.
import { describe, expectTypeOf, it } from "vitest";

import type { BookmarkUrl } from "../../src/types/entities/bookmarks.js";
import type { ReportLinkType } from "../../src/types/literals.js";
import type {
  ReportLink,
  ReportLinkQueryResult,
  ResolvedReport,
} from "../../src/types/report-links.js";
import type {
  FlowQueryResult,
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
} from "../../src/types/results/query-engine.js";

declare const record: BookmarkUrl;
declare const link: ReportLink;
declare const resolved: ResolvedReport;

describe("TestBookmarkUrl", () => {
  it("test_frozen — fields are readonly (runtime freeze is the open todo)", () => {
    // @ts-expect-error -- `slug` is readonly
    record.slug = "x";
    // @ts-expect-error -- `params` is readonly
    record.params = {};
    expectTypeOf(record.slug).toEqualTypeOf<string>();
    expectTypeOf(record.bookmark_type).toEqualTypeOf<string>();
    expectTypeOf(record.params).toEqualTypeOf<
      Readonly<Record<string, unknown>>
    >();
  });
});

describe("TestReportLink", () => {
  it("test_frozen — fields are readonly", () => {
    // @ts-expect-error -- `slug` is readonly
    link.slug = "x";
    // @ts-expect-error -- `url` is readonly
    link.url = "x";
    expectTypeOf(link.report_type).toEqualTypeOf<ReportLinkType>();
    expectTypeOf(link.workspace_id).toEqualTypeOf<number | null>();
  });
});

describe("TestResolvedReport", () => {
  it("test_frozen — fields are readonly", () => {
    // @ts-expect-error -- `params` is readonly
    resolved.params = {};
    expectTypeOf(resolved.source).toEqualTypeOf<"slug" | "bookmark">();
    expectTypeOf(resolved.params).toEqualTypeOf<
      Readonly<Record<string, unknown>>
    >();
  });
});

describe("TestReportLinkType", () => {
  it("test_query_result_alias_members", () => {
    expectTypeOf<ReportLinkQueryResult>().toEqualTypeOf<
      QueryResult | FunnelQueryResult | RetentionQueryResult | FlowQueryResult
    >();
  });
});
