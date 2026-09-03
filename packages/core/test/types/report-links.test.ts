// Report-link public type unit tests (045-report-links), translated from
// tests/unit/test_types_report_links.py.
//
// One `describe` per Python class, one `it` per Python test (same order,
// mirrored names).
//
// Translation notes (documented substitutions, NOT weakened assertions):
// - `get_args(ReportLinkType)` becomes the runtime membership tuple
//   `REPORT_LINK_TYPE_VALUES` (literals.ts keeps a tuple per Literal
//   alias). `ReportLinkQueryResult` is a TS type alias with no runtime
//   members, so `test_query_result_alias_members` is a compile-time
//   mutual-assignability check (`tsc` enforces it; the runtime `expect`
//   only pins the constant).
// - Pydantic `model_validate` → `BookmarkUrl.fromDict`; keyword
//   construction → `new BookmarkUrl({...})`; `model_extra` → the
//   `__extras` bag on `EntityModel`; `model_dump(by_alias=True)` →
//   `modelDump({ byAlias: true })`.
// - Dataclass `FrozenInstanceError` → `Object.isFrozen` plus a strict-mode
//   assignment that throws `TypeError`; the compile-time `readonly`
//   contract is pinned with `@ts-expect-error`.
// - `dataclasses.replace(...)` → re-construct from a spread of the field
//   bag with the overridden keys.
// - Message-TEXT assertions (`"source='slug'" in str(exc)`) are not
//   carried (R5.4); class, `.code` and `.details` are.
import { describe, expect, it } from "vitest";
import { ParamValidationError } from "../../src/errors.js";
import { Bookmark, BookmarkUrl } from "../../src/types/entities/bookmarks.js";
import { REPORT_LINK_TYPE_VALUES } from "../../src/types/literals.js";
import {
  ReportLink,
  ResolvedReport,
  type ReportLinkQueryResult,
  type ResolvedReportFields,
} from "../../src/types/report-links.js";
import type {
  FlowQueryResult,
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
} from "../../src/types/results/query-engine.js";

const SLUG = "EBrV5bW2u9Mw";
const PARAMS = {
  sections: { show: [] },
  displayOptions: { chartType: "line" },
} as const;

/** Compile-time `A` ≡ `B` (mutual assignability, tuple-wrapped). */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

describe("TestReportLinkType", () => {
  it("test_members", () => {
    expect(new Set(REPORT_LINK_TYPE_VALUES)).toEqual(
      new Set(["insights", "funnels", "retention", "flows"]),
    );
  });

  it("test_query_result_alias_members", () => {
    type Expected =
      QueryResult | FunnelQueryResult | RetentionQueryResult | FlowQueryResult;
    const same: Same<ReportLinkQueryResult, Expected> = true;
    expect(same).toBe(true);
  });
});

describe("TestBookmarkUrl", () => {
  it("test_parses_server_record_with_type_alias", () => {
    const record = BookmarkUrl.fromDict({
      slug: SLUG,
      type: "funnels",
      params: PARAMS,
      project_id: 3,
      user_id: 42,
      created_at: "2026-09-02T10:00:00",
    });
    expect(record.slug).toBe(SLUG);
    expect(record.bookmark_type).toBe("funnels");
    expect(record.params).toEqual(PARAMS);
    expect(record.project_id).toBe(3);
    expect(record.user_id).toBe(42);
    expect(record.created_at).toBe("2026-09-02T10:00:00");
    expect(record.name).toBeNull();
    expect(record.description).toBeNull();
    expect(record.overrides).toBeNull();
    expect(record.bookmark_id).toBeNull();
    expect(record.bookmark).toBeNull();
  });

  it("test_params_default_empty_dict", () => {
    const record = BookmarkUrl.fromDict({ slug: SLUG, type: "insights" });
    expect(record.params).toEqual({});
  });

  it("test_populate_by_name", () => {
    const record = new BookmarkUrl({ slug: SLUG, bookmark_type: "retention" });
    expect(record.bookmark_type).toBe("retention");
    // populate_by_name also applies on the strict decode seam.
    expect(
      BookmarkUrl.fromDict({ slug: SLUG, bookmark_type: "retention" })
        .bookmark_type,
    ).toBe("retention");
  });

  it("test_embedded_bookmark", () => {
    const record = BookmarkUrl.fromDict({
      slug: SLUG,
      type: "insights",
      params: {},
      overrides: { originDashboard: 555 },
      bookmark: {
        id: 123,
        name: "Weekly actives",
        type: "insights",
        params: { sections: {} },
      },
    });
    expect(record.bookmark).toBeInstanceOf(Bookmark);
    expect(record.bookmark?.id).toBe(123);
    expect(record.bookmark?.bookmark_type).toBe("insights");
    expect(record.overrides).toEqual({ originDashboard: 555 });
  });

  it("test_extra_keys_kept", () => {
    const record = BookmarkUrl.fromDict({
      slug: SLUG,
      type: "insights",
      future_key: 1,
    });
    expect(record.__extras).toEqual({ future_key: 1 });
  });

  // PORT-GAP: Python `BookmarkUrl` is `model_config(frozen=True)` and raises
  // on attribute assignment; the TS `EntityModel` base never calls
  // `Object.freeze`, so `BookmarkUrl` instances are mutable at runtime
  // (only the compile-time `readonly` contract holds — pinned below via
  // `@ts-expect-error`, which `tsc` still checks on a skipped body).
  it.skip("test_frozen", () => {
    const record = new BookmarkUrl({ slug: SLUG, bookmark_type: "insights" });
    // @ts-expect-error -- `slug` is readonly (compile-time frozen contract).
    const assign = (): void => void (record.slug = "x");
    expect(Object.isFrozen(record)).toBe(true);
    expect(assign).toThrow(TypeError);
  });

  it("test_dump_by_alias", () => {
    const record = new BookmarkUrl({ slug: SLUG, bookmark_type: "flows" });
    const dumped = record.modelDump({ byAlias: true });
    expect(dumped["type"]).toBe("flows");
    expect("bookmark_type" in dumped).toBe(false);
  });
});

describe("TestReportLink", () => {
  /**
   * Construct a ReportLink with every field set (`_build`).
   *
   * @returns The fully populated link.
   */
  function build(): ReportLink {
    return new ReportLink({
      url: `https://mixpanel.com/project/3/view/75/app/insights#${SLUG}`,
      slug: SLUG,
      report_type: "insights",
      project_id: 3,
      workspace_id: 75,
      name: "Logins",
      description: "last 7 days",
      bookmark_id: 9,
      created_at: "2026-09-02T10:00:00",
    });
  }

  it("test_to_dict_returns_every_field", () => {
    const link = build();
    const d = link.toDict();
    expect(d).toEqual({
      url: link.url,
      slug: SLUG,
      report_type: "insights",
      project_id: 3,
      workspace_id: 75,
      name: "Logins",
      description: "last 7 days",
      bookmark_id: 9,
      created_at: "2026-09-02T10:00:00",
    });
    expect(() => JSON.stringify(d)).not.toThrow();
  });

  it("test_defaults", () => {
    const link = new ReportLink({
      url: `https://mixpanel.com/project/3/app/flows#${SLUG}`,
      slug: SLUG,
      report_type: "flows",
      project_id: 3,
      workspace_id: null,
    });
    expect(link.name).toBe("");
    expect(link.description).toBe("");
    expect(link.bookmark_id).toBeNull();
    expect(link.created_at).toBeNull();
  });

  it("test_str_is_url", () => {
    const link = build();
    expect(String(link)).toBe(link.url);
    expect(`${link}`).toBe(link.url);
  });

  it("test_frozen", () => {
    const link = build();
    // @ts-expect-error -- `slug` is readonly (compile-time frozen contract).
    const assign = (): void => void (link.slug = "x");
    expect(Object.isFrozen(link)).toBe(true);
    expect(assign).toThrow(TypeError);
    expect(link.slug).toBe(SLUG);
  });
});

describe("TestResolvedReport", () => {
  /**
   * Field bag for a slug-link ResolvedReport (`_build` inputs), so twins of
   * `dataclasses.replace` can spread and override.
   *
   * @param bookmark - Optional embedded bookmark.
   * @returns The constructor bag.
   */
  function fields(bookmark: Bookmark | null): ResolvedReportFields {
    return {
      source: "slug",
      report_type: "insights",
      params: PARAMS,
      project_id: 3,
      workspace_id: 75,
      region: "us",
      url: `https://mixpanel.com/project/3/view/75/app/insights#${SLUG}`,
      input: SLUG,
      expanded_url: null,
      slug: SLUG,
      bookmark_id: null,
      bookmark,
      name: "Logins",
      description: null,
      overrides: { originDashboard: 555 },
    };
  }

  /**
   * Construct a ResolvedReport for a slug link (`_build`).
   *
   * @param bookmark - Optional embedded bookmark.
   * @returns The resolved report.
   */
  function build(bookmark: Bookmark | null): ResolvedReport {
    return new ResolvedReport(fields(bookmark));
  }

  it("test_to_dict_serializes_bookmark_by_alias", () => {
    const bookmark = new Bookmark({
      id: 123,
      name: "Weekly",
      bookmark_type: "funnels",
      params: {},
    });
    const d = build(bookmark).toDict();
    const dumped = d["bookmark"] as Record<string, unknown>;
    expect(dumped["id"]).toBe(123);
    expect(dumped["type"]).toBe("funnels");
    expect("bookmark_type" in dumped).toBe(false);
    expect(() => JSON.stringify(d)).not.toThrow();
  });

  it("test_to_dict_passes_none_bookmark_through", () => {
    const d = build(null).toDict();
    expect(d["bookmark"]).toBeNull();
    expect(d["source"]).toBe("slug");
    expect(d["report_type"]).toBe("insights");
    expect(d["params"]).toEqual(PARAMS);
    expect(d["project_id"]).toBe(3);
    expect(d["workspace_id"]).toBe(75);
    expect(d["region"]).toBe("us");
    expect(d["input"]).toBe(SLUG);
    expect(d["expanded_url"]).toBeNull();
    expect(d["slug"]).toBe(SLUG);
    expect(d["bookmark_id"]).toBeNull();
    expect(d["name"]).toBe("Logins");
    expect(d["description"]).toBeNull();
    expect(d["overrides"]).toEqual({ originDashboard: 555 });
    expect(new Set(Object.keys(d))).toEqual(
      new Set([
        "source",
        "report_type",
        "params",
        "project_id",
        "workspace_id",
        "region",
        "url",
        "input",
        "expanded_url",
        "slug",
        "bookmark_id",
        "bookmark",
        "name",
        "description",
        "overrides",
      ]),
    );
  });

  it("test_frozen", () => {
    const resolved = build(null);
    // @ts-expect-error -- `params` is readonly (compile-time frozen contract).
    const assign = (): void => void (resolved.params = {});
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(assign).toThrow(TypeError);
    expect(resolved.params).toEqual(PARAMS);
  });

  it("test_slug_source_requires_slug", () => {
    let caught: unknown;
    try {
      new ResolvedReport({ ...fields(null), slug: null });
    } catch (exc) {
      caught = exc;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    const exc = caught as ParamValidationError;
    expect(exc.code).toBe("RL5_RESOLVED_REPORT_INCONSISTENT");
    expect(exc.details).toEqual({ source: "slug", missing: "slug" });
  });

  it("test_bookmark_source_requires_bookmark_id", () => {
    let caught: unknown;
    try {
      new ResolvedReport({ ...fields(null), source: "bookmark", slug: null });
    } catch (exc) {
      caught = exc;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    const exc = caught as ParamValidationError;
    expect(exc.code).toBe("RL5_RESOLVED_REPORT_INCONSISTENT");
    expect(exc.details).toEqual({ source: "bookmark", missing: "bookmark_id" });
  });

  it("test_bookmark_source_with_id_is_fine", () => {
    const resolved = new ResolvedReport({
      ...fields(null),
      source: "bookmark",
      slug: null,
      bookmark_id: 123,
    });
    expect(resolved.bookmark_id).toBe(123);
    expect(resolved.bookmark).toBeNull();
    expect(resolved.slug).toBeNull();
  });
});
