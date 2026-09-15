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
//   members, so `test_query_result_alias_members` lives in
//   `report-links.test-d.ts` as an `expectTypeOf` assertion.
// - Pydantic `model_validate` → `BookmarkUrl.fromDict`; keyword
//   construction → `new BookmarkUrl({...})`; `model_extra` → the
//   `__extras` bag on `EntityModel`; `model_dump(by_alias=True)` →
//   `modelDump({ byAlias: true })`.
// - Dataclass `FrozenInstanceError` → `Object.isFrozen` plus a strict-mode
//   write (`Object.assign`) that throws `TypeError`; the compile-time
//   `readonly` contract is pinned in `report-links.test-d.ts`.
// - `dataclasses.replace(...)` → re-construct from a spread of the field
//   bag with the overridden keys.
// - Message-TEXT assertions (`"source='slug'" in str(exc)`) are not
//   carried; class, `.code` and `.details` are.
import { describe, expect, it } from "vitest";

import { ParamValidationError } from "../../src/errors.js";
import { Bookmark, BookmarkUrl } from "../../src/types/entities/bookmarks.js";
import { REPORT_LINK_TYPE_VALUES } from "../../src/types/literals.js";
import {
  ReportLink,
  ResolvedReport,
  type ResolvedReportFields,
} from "../../src/types/report-links.js";

const SLUG = "EBrV5bW2u9Mw";
const PARAMS = {
  sections: { show: [] },
  displayOptions: { chartType: "line" },
} as const;

describe("Report link type", () => {
  // python: TestReportLinkType
  it("members", () => {
    // python: test_members
    expect(new Set(REPORT_LINK_TYPE_VALUES)).toStrictEqual(
      new Set(["insights", "funnels", "retention", "flows"]),
    );
  });
});

describe("Bookmark URL", () => {
  // python: TestBookmarkUrl
  it("parses server record with type alias", () => {
    // python: test_parses_server_record_with_type_alias
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
    expect(record.params).toStrictEqual(PARAMS);
    expect(record.project_id).toBe(3);
    expect(record.user_id).toBe(42);
    expect(record.created_at).toBe("2026-09-02T10:00:00");
    expect(record.name).toBeNull();
    expect(record.description).toBeNull();
    expect(record.overrides).toBeNull();
    expect(record.bookmark_id).toBeNull();
    expect(record.bookmark).toBeNull();
  });

  it("params default empty dict", () => {
    // python: test_params_default_empty_dict
    const record = BookmarkUrl.fromDict({ slug: SLUG, type: "insights" });
    expect(record.params).toStrictEqual({});
  });

  it("populate by name", () => {
    // python: test_populate_by_name
    const record = new BookmarkUrl({ slug: SLUG, bookmark_type: "retention" });
    expect(record.bookmark_type).toBe("retention");
    // populate_by_name also applies on the strict decode seam.
    expect(
      BookmarkUrl.fromDict({ slug: SLUG, bookmark_type: "retention" })
        .bookmark_type,
    ).toBe("retention");
  });

  it("embedded bookmark", () => {
    // python: test_embedded_bookmark
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
    expect(record.overrides).toStrictEqual({ originDashboard: 555 });
  });

  it("extra keys kept", () => {
    // python: test_extra_keys_kept
    const record = BookmarkUrl.fromDict({
      slug: SLUG,
      type: "insights",
      future_key: 1,
    });
    expect(record.__extras).toStrictEqual({ future_key: 1 });
  });

  // Python `BookmarkUrl` is `model_config(frozen=True)` and raises on
  // attribute assignment; the TS `EntityModel` base never calls
  // `Object.freeze`, so `BookmarkUrl` instances are mutable at runtime
  // (PORTING.md "Runtime immutability"). Only the compile-time `readonly`
  // contract holds — pinned in `report-links.test-d.ts`. Once `EntityModel`
  // freezes, assert `Object.isFrozen` plus a throwing write here.
  it.todo("frozen"); // python: test_frozen

  it("dump by alias", () => {
    // python: test_dump_by_alias
    const record = new BookmarkUrl({ slug: SLUG, bookmark_type: "flows" });
    const dumped = record.modelDump({ byAlias: true });
    expect(dumped["type"]).toBe("flows");
    expect("bookmark_type" in dumped).toBe(false);
  });
});

describe("Report link", () => {
  // python: TestReportLink
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

  it("to dict returns every field", () => {
    // python: test_to_dict_returns_every_field
    const link = build();
    const d = link.toDict();
    expect(d).toStrictEqual({
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

  it("defaults", () => {
    // python: test_defaults
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

  it("str is URL", () => {
    // python: test_str_is_url
    const link = build();
    expect(String(link)).toBe(link.url);
    // eslint-disable-next-line unicorn/no-useless-template-literals, @typescript-eslint/restrict-template-expressions -- test_str_is_url exercises template-literal rendering of a ReportLink
    expect(`${link}`).toBe(link.url);
  });

  it("frozen", () => {
    // python: test_frozen
    const link = build();
    expect(Object.isFrozen(link)).toBe(true);
    // A strict-mode write to a frozen object throws; the compile-time
    // `readonly` half is in report-links.test-d.ts.
    expect(() => Object.assign(link, { slug: "x" })).toThrow(TypeError);
    expect(link.slug).toBe(SLUG);
  });
});

describe("Resolved report", () => {
  // python: TestResolvedReport
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

  it("to dict serializes bookmark by alias", () => {
    // python: test_to_dict_serializes_bookmark_by_alias
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

  it("to dict passes null bookmark through", () => {
    // python: test_to_dict_passes_none_bookmark_through
    const d = build(null).toDict();
    expect(d["bookmark"]).toBeNull();
    expect(d["source"]).toBe("slug");
    expect(d["report_type"]).toBe("insights");
    expect(d["params"]).toStrictEqual(PARAMS);
    expect(d["project_id"]).toBe(3);
    expect(d["workspace_id"]).toBe(75);
    expect(d["region"]).toBe("us");
    expect(d["input"]).toBe(SLUG);
    expect(d["expanded_url"]).toBeNull();
    expect(d["slug"]).toBe(SLUG);
    expect(d["bookmark_id"]).toBeNull();
    expect(d["name"]).toBe("Logins");
    expect(d["description"]).toBeNull();
    expect(d["overrides"]).toStrictEqual({ originDashboard: 555 });
    expect(new Set(Object.keys(d))).toStrictEqual(
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

  it("frozen", () => {
    // python: test_frozen
    const resolved = build(null);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(() => Object.assign(resolved, { params: {} })).toThrow(TypeError);
    expect(resolved.params).toStrictEqual(PARAMS);
  });

  it("slug source requires slug", () => {
    // python: test_slug_source_requires_slug
    let caught: unknown;
    try {
      new ResolvedReport({ ...fields(null), slug: null });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    const exc = caught as ParamValidationError;
    expect(exc.code).toBe("RL5_RESOLVED_REPORT_INCONSISTENT");
    expect(exc.details).toStrictEqual({ source: "slug", missing: "slug" });
  });

  it("bookmark source requires bookmark ID", () => {
    // python: test_bookmark_source_requires_bookmark_id
    let caught: unknown;
    try {
      new ResolvedReport({ ...fields(null), source: "bookmark", slug: null });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParamValidationError);
    const exc = caught as ParamValidationError;
    expect(exc.code).toBe("RL5_RESOLVED_REPORT_INCONSISTENT");
    expect(exc.details).toStrictEqual({
      source: "bookmark",
      missing: "bookmark_id",
    });
  });

  it("bookmark source with ID is fine", () => {
    // python: test_bookmark_source_with_id_is_fine
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
