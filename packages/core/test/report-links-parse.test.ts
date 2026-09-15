// Unit tests for the pure report-link module (045-report-links), translated
// from tests/unit/test_report_links.py: one parametrized case per row of
// contracts/url-grammar.md §5 (parse table) and §6 (builders), plus
// `is_slug`, `web_host`, and `generate_slug`.
//
// Translation notes (documented exclusions, NOT weakened assertions):
// - Message-TEXT assertions (`str(exc) == ...`) are deliberately not
//   carried: error message text is out of contract (R5.4). Class, `code`,
//   and `details` — everything the conformance canonicalizer compares —
//   are asserted for every row.
// - `ParsedReportLink` is a frozen plain object, so `test_frozen` asserts
//   `Object.isFrozen` + the strict-mode `TypeError` on assignment instead
//   of Python's `AttributeError`.
// - `MappingProxyType` read-only tables are `ReadonlyMap`s here:
//   `test_tables_are_read_only` asserts the type has no `set` member and
//   the runtime value is a `Map` (the key-set/Literal agreement lives in
//   the two `TestTableInvariants` siblings).
// - Python `str.strip()` on the parse-table inputs is `String#trim()`
//   (every whitespace decoration in the table is ASCII).
// - A `compat/urllib` block is appended at the end: the parser observes
//   the RAW CPython `urlsplit` (lower-cased host, port stripped, everything
//   else verbatim) and `resolve_short_link` echoes `urljoin` targets, so
//   the twins are pinned here alongside the parser they serve.

import { describe, expect, it } from "vitest";

import { ReportLinkParseError } from "../src/errors.js";
import { type ParsedReportLink, parseReportLink } from "../src/report-links.js";

const SLUG = "EBrV5bW2u9Mw";

/** Every field name of `ParsedReportLink`, for the "is a parsed link" check. */
const PARSED_FIELDS: ReadonlyArray<keyof ParsedReportLink> = [
  "kind",
  "raw",
  "host",
  "region",
  "project_id",
  "workspace_id",
  "app",
  "report_type_hint",
  "slug",
  "bookmark_id",
  "dashboard_id",
  "short_code",
  "title_segment",
  "overrides_jsurl",
];

/**
 * Twin of `isinstance(parsed, ParsedReportLink)` — a frozen object that
 * carries exactly the dataclass fields.
 *
 * @param parsed - The parse result.
 */
function expectParsedReportLink(parsed: ParsedReportLink): void {
  expect(Object.isFrozen(parsed)).toBe(true);
  expect(Object.keys(parsed).sort()).toStrictEqual([...PARSED_FIELDS].sort());
}

/**
 * Run `fn`, require it to throw a `ReportLinkParseError`, and return it.
 *
 * @param fn - The call under test.
 * @returns The thrown error.
 */
function catchParseError(fn: () => unknown): ReportLinkParseError {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ReportLinkParseError);
  return caught as ReportLinkParseError;
}

// --- url-grammar.md §5 parse table --------------------------------------------

const PARSE_ROWS: ReadonlyArray<readonly [string, Partial<ParsedReportLink>]> =
  [
    [
      SLUG,
      {
        kind: "slug",
        slug: SLUG,
        host: null,
        region: null,
        project_id: null,
        workspace_id: null,
      },
    ],
    [`  ${SLUG}  `, { kind: "slug", slug: SLUG, raw: SLUG }],
    [
      "https://mixpanel.com/s/AbC123",
      {
        kind: "short_link",
        short_code: "AbC123",
        region: "us",
        host: "mixpanel.com",
      },
    ],
    [
      "https://eu.mixpanel.com/s/AbC123",
      { kind: "short_link", short_code: "AbC123", region: "eu" },
    ],
    [
      `https://eu.mixpanel.com/project/3/view/75/app/insights#${SLUG}`,
      {
        kind: "slug",
        region: "eu",
        project_id: 3,
        workspace_id: 75,
        app: "insights",
        report_type_hint: "insights",
        slug: SLUG,
      },
    ],
    [
      `https://mixpanel.com/project/3/app/insights/#${SLUG}`,
      { kind: "slug", project_id: 3, workspace_id: null, slug: SLUG },
    ],
    [
      "https://mixpanel.com/project/3/app/insights#report/123",
      {
        kind: "bookmark",
        bookmark_id: 123,
        report_type_hint: "insights",
        title_segment: null,
        overrides_jsurl: null,
      },
    ],
    [
      "https://mixpanel.com/project/3/app/insights#report/123/weekly-actives",
      {
        kind: "bookmark",
        bookmark_id: 123,
        title_segment: "weekly-actives",
        overrides_jsurl: null,
      },
    ],
    [
      "https://mixpanel.com/project/3/app/insights#report/123/weekly-actives/~(a~1)",
      {
        kind: "bookmark",
        bookmark_id: 123,
        title_segment: "weekly-actives",
        overrides_jsurl: "~(a~1)",
      },
    ],
    [
      "https://mixpanel.com/project/3/app/insights#report/123/~(a~1)",
      {
        kind: "bookmark",
        bookmark_id: 123,
        title_segment: null,
        overrides_jsurl: "~(a~1)",
      },
    ],
    [
      "https://mixpanel.com/project/3/app/funnels#view/456",
      {
        kind: "bookmark",
        bookmark_id: 456,
        report_type_hint: "funnels",
        app: "funnels",
      },
    ],
    [
      "https://mixpanel.com/project/3/app/retention#report/7",
      { kind: "bookmark", bookmark_id: 7, report_type_hint: "retention" },
    ],
    [
      "https://mixpanel.com/project/3/app/flows#report/8",
      { kind: "bookmark", bookmark_id: 8, report_type_hint: "flows" },
    ],
    [
      "https://mixpanel.com/project/3/app/insights#segmentation-report/9",
      { kind: "bookmark", bookmark_id: 9, report_type_hint: "insights" },
    ],
    [
      "https://mixpanel.com/project/3/app/impact#report/10",
      {
        kind: "bookmark",
        bookmark_id: 10,
        report_type_hint: "launch-analysis",
        app: "impact",
      },
    ],
    [
      "https://mixpanel.com/report/3/insights#report/123",
      {
        kind: "bookmark",
        project_id: 3,
        workspace_id: null,
        bookmark_id: 123,
        app: "insights",
      },
    ],
    [
      "https://mixpanel.com/report/3/view/75/insights#report/123",
      { kind: "bookmark", project_id: 3, workspace_id: 75, bookmark_id: 123 },
    ],
    [
      `in.mixpanel.com/project/3/app/insights#${SLUG}`,
      { kind: "slug", region: "in", host: "in.mixpanel.com", slug: SLUG },
    ],
    [
      `HTTPS://MIXPANEL.COM/project/3/app/insights#${SLUG}`,
      { kind: "slug", host: "mixpanel.com", region: "us", slug: SLUG },
    ],
    [
      `https://mixpanel.com:443/project/3/app/insights#${SLUG}`,
      { kind: "slug", host: "mixpanel.com", project_id: 3, slug: SLUG },
    ],
    [
      `https://mixpanel.com/project/3/app/insights?utm=x#${SLUG}`,
      { kind: "slug", project_id: 3, slug: SLUG },
    ],
    [
      `https://mixpanel.com/project/3/app/insights%23${SLUG}`,
      { kind: "slug", project_id: 3, slug: SLUG },
    ],
    [
      `https://mixpanel.org/project/3/app/insights#${SLUG}`,
      { kind: "slug", region: "us", host: "mixpanel.org", slug: SLUG },
    ],
    [
      "https://mixpanel.com/project/3/app/boards#id=555",
      {
        kind: "dashboard",
        dashboard_id: 555,
        host: "mixpanel.com",
        region: "us",
        project_id: 3,
        workspace_id: null,
        app: "boards",
        report_type_hint: null,
        slug: null,
      },
    ],
    [
      "https://eu.mixpanel.com/project/3/view/75/app/boards#id=555",
      {
        kind: "dashboard",
        dashboard_id: 555,
        host: "eu.mixpanel.com",
        region: "eu",
        project_id: 3,
        workspace_id: 75,
        app: "boards",
      },
    ],
    [
      `https://in.mixpanel.com/project/3/view/75/app/boards#id=555&edited-bookmark=${SLUG}`,
      {
        kind: "slug",
        slug: SLUG,
        dashboard_id: 555,
        host: "in.mixpanel.com",
        region: "in",
        project_id: 3,
        workspace_id: 75,
        app: "boards",
        report_type_hint: null,
      },
    ],
    [
      "https://eu.mixpanel.com/project/3/view/75/app/funnels#~(x)",
      {
        kind: "legacy_jsurl",
        host: "eu.mixpanel.com",
        region: "eu",
        project_id: 3,
        workspace_id: 75,
        app: "funnels",
        report_type_hint: "funnels",
        slug: null,
        bookmark_id: null,
        dashboard_id: null,
      },
    ],
    [
      `https://mixpanel.com/project/3/app/boards#id=555&edited-bookmark=${SLUG}`,
      { kind: "slug", slug: SLUG, dashboard_id: 555 },
    ],
    [
      "https://mixpanel.com/project/3/app/insights#~(sections~(...))",
      {
        kind: "legacy_jsurl",
        host: "mixpanel.com",
        region: "us",
        project_id: 3,
        workspace_id: null,
        app: "insights",
        report_type_hint: "insights",
        slug: null,
        bookmark_id: null,
      },
    ],
  ];

const ERROR_ROWS: ReadonlyArray<readonly [string, string]> = [
  ["https://mixpanel.com/project/3/app/insights", "REPORT_LINK_EMPTY_HASH"],
  ["https://mixpanel.com/project/3/app/insights#", "REPORT_LINK_EMPTY_HASH"],
  [
    `https://example.com/project/3/app/insights#${SLUG}`,
    "REPORT_LINK_NOT_MIXPANEL_HOST",
  ],
  [
    "https://api.mixpanel.com/project/3/app/insights#x",
    "REPORT_LINK_NOT_MIXPANEL_HOST",
  ],
  ["https://mixpanel.com/settings/project/3", "REPORT_LINK_UNRECOGNIZED_PATH"],
  [
    `https://mixpanel.com/project/abc/app/insights#${SLUG}`,
    "REPORT_LINK_UNRECOGNIZED_PATH",
  ],
  [
    "https://mixpanel.com/project/3/app/insights#foo/bar",
    "REPORT_LINK_UNRECOGNIZED_HASH",
  ],
  [
    "https://mixpanel.com/project/3/app/insights#tooShort",
    "REPORT_LINK_UNRECOGNIZED_HASH",
  ],
  ["", "REPORT_LINK_UNPARSEABLE"],
  ["not a url at all", "REPORT_LINK_UNPARSEABLE"],
];

describe("Parse table", () => {
  // python: TestParseTable
  it.each(PARSE_ROWS)("row[%j]", (value, expected) => {
    // python: test_row
    const parsed = parseReportLink(value);
    expectParsedReportLink(parsed);
    for (const name of Object.keys(expected) as Array<keyof ParsedReportLink>) {
      expect(parsed[name], name).toBe(expected[name]);
    }
    // Rows that pin `raw` were checked in the loop; the rest default to
    // the trimmed input.
    expect(parsed.raw).toBe("raw" in expected ? expected.raw : value.trim());
  });

  it.each(ERROR_ROWS)("error row[%j]", (value, code) => {
    // python: test_error_row
    const exc = catchParseError(() => parseReportLink(value));
    expect(exc.code).toBe(code);
    expect(exc.details).toHaveProperty("hint");
  });

  it("unparseable message", () => {
    // python: test_unparseable_message
    const exc = catchParseError(() => parseReportLink("not a url at all"));
    expect(exc.code).toBe("REPORT_LINK_UNPARSEABLE");
    expect(exc.details["raw"]).toBe("not a url at all");
    expect(exc.details["hint"]).toBe(
      "Pass a full Mixpanel report URL, a shortlink " +
        "(https://mixpanel.com/s/...), or a 12-character slug.",
    );
  });

  it("not mixpanel host message", () => {
    // python: test_not_mixpanel_host_message
    const exc = catchParseError(() =>
      parseReportLink("https://example.com/project/3/app/insights#x"),
    );
    expect(exc.code).toBe("REPORT_LINK_NOT_MIXPANEL_HOST");
    expect(exc.details["host"]).toBe("example.com");
    expect(exc.details["hint"]).toBe(
      "Expected mixpanel.com, eu.mixpanel.com, or in.mixpanel.com.",
    );
  });

  it("unrecognized path message", () => {
    // python: test_unrecognized_path_message
    const exc = catchParseError(() =>
      parseReportLink("https://mixpanel.com/settings/project/3"),
    );
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_PATH");
    expect(exc.details["path"]).toBe("/settings/project/3");
    expect(exc.details["hint"]).toContain("/s/{code}");
  });

  it("unrecognized hash message", () => {
    // python: test_unrecognized_hash_message
    const exc = catchParseError(() =>
      parseReportLink("https://mixpanel.com/project/3/app/insights#foo/bar"),
    );
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_HASH");
    expect(exc.details["hash"]).toBe("foo/bar");
    expect(exc.details["hint"]).toContain("12-character slug");
  });

  it("empty hash message", () => {
    // python: test_empty_hash_message
    const exc = catchParseError(() =>
      parseReportLink("https://mixpanel.com/project/3/app/funnels#"),
    );
    expect(exc.code).toBe("REPORT_LINK_EMPTY_HASH");
    expect(exc.details["app"]).toBe("funnels");
    expect(exc.details["project_id"]).toBe(3);
  });

  it("parse error details carry parsed fields", () => {
    // python: test_parse_error_details_carry_parsed_fields
    const exc = catchParseError(() =>
      parseReportLink("https://eu.mixpanel.com/project/9/view/2/app/flows#x"),
    );
    expect(exc.details["region"]).toBe("eu");
    expect(exc.details["project_id"]).toBe(9);
    expect(exc.details["workspace_id"]).toBe(2);
  });

  it("frozen", () => {
    // python: test_frozen
    const parsed = parseReportLink(SLUG);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(() => {
      (parsed as unknown as { slug: string }).slug = "x";
    }).toThrow(TypeError);
    expect(parsed.slug).toBe(SLUG);
  });

  it("boards ID outside boards app is unrecognized", () => {
    // python: test_boards_id_outside_boards_app_is_unrecognized
    const exc = catchParseError(() =>
      parseReportLink("https://mixpanel.com/project/3/app/insights#id=555"),
    );
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_HASH");
  });

  it("boards with invalid edited bookmark is dashboard", () => {
    // python: test_boards_with_invalid_edited_bookmark_is_dashboard
    const parsed = parseReportLink(
      "https://mixpanel.com/project/3/app/boards#id=555&edited-bookmark=short",
    );
    expect(parsed.kind).toBe("dashboard");
    expect(parsed.dashboard_id).toBe(555);
    expect(parsed.slug).toBeNull();
  });

  it("short link without code is unrecognized path", () => {
    // python: test_short_link_without_code_is_unrecognized_path
    const exc = catchParseError(() =>
      parseReportLink("https://mixpanel.com/s/"),
    );
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_PATH");
  });

  it("unknown app is unrecognized path", () => {
    // python: test_unknown_app_is_unrecognized_path
    const exc = catchParseError(() =>
      parseReportLink("https://mixpanel.com/project/3/app/users#abc"),
    );
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_PATH");
  });

  it("non ascii digits are not IDs", () => {
    // python: test_non_ascii_digits_are_not_ids
    const exc = catchParseError(() =>
      parseReportLink(`https://mixpanel.com/project/٣/app/insights#${SLUG}`),
    );
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_PATH");
  });

  it("bare known host is unrecognized path", () => {
    // python: test_bare_known_host_is_unrecognized_path
    const exc = catchParseError(() => parseReportLink("mixpanel.com"));
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_PATH");
  });

  it("host prefix lookalike is unparseable", () => {
    // python: test_host_prefix_lookalike_is_unparseable
    const exc = catchParseError(() =>
      parseReportLink(`mixpanel.comx/project/3/app/insights#${SLUG}`),
    );
    expect(exc.code).toBe("REPORT_LINK_UNPARSEABLE");
    expect(exc.details["raw"]).toBe(
      `mixpanel.comx/project/3/app/insights#${SLUG}`,
    );
  });

  it("boards hash without ID is unrecognized", () => {
    // python: test_boards_hash_without_id_is_unrecognized
    const exc = catchParseError(() =>
      parseReportLink("https://mixpanel.com/project/3/app/boards#foo=bar"),
    );
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_HASH");
  });

  it("malformed netloc is unparseable", () => {
    // python: test_malformed_netloc_is_unparseable
    const exc = catchParseError(() =>
      parseReportLink("https://[::1/project/3/app/insights#x"),
    );
    expect(exc.code).toBe("REPORT_LINK_UNPARSEABLE");
  });
});

describe("Parser tolerance", () => {
  // python: TestParserTolerance
  it("trailing slash after bookmark hash", () => {
    // python: test_trailing_slash_after_bookmark_hash
    const parsed = parseReportLink(
      "https://mixpanel.com/project/3/app/insights#report/123/",
    );
    expect(parsed.kind).toBe("bookmark");
    expect(parsed.bookmark_id).toBe(123);
    expect(parsed.title_segment).toBeNull();
  });

  it("trailing slash after slug", () => {
    // python: test_trailing_slash_after_slug
    const parsed = parseReportLink(
      `https://mixpanel.com/project/3/app/insights#${SLUG}/`,
    );
    expect(parsed.kind).toBe("slug");
    expect(parsed.slug).toBe(SLUG);
  });

  it("query tail after slug", () => {
    // python: test_query_tail_after_slug
    const parsed = parseReportLink(
      `https://mixpanel.com/project/3/app/insights#${SLUG}?utm=x`,
    );
    expect(parsed.kind).toBe("slug");
    expect(parsed.slug).toBe(SLUG);
  });

  it("query tail after bookmark hash", () => {
    // python: test_query_tail_after_bookmark_hash
    const parsed = parseReportLink(
      "https://mixpanel.com/project/3/app/insights#report/123?utm=x",
    );
    expect(parsed.kind).toBe("bookmark");
    expect(parsed.bookmark_id).toBe(123);
  });

  it("overrides tail keeps question mark and slash", () => {
    // python: test_overrides_tail_keeps_question_mark_and_slash
    const parsed = parseReportLink(
      "https://mixpanel.com/project/3/app/funnels#view/123/~(a~'x?y/z')/",
    );
    expect(parsed.kind).toBe("bookmark");
    expect(parsed.bookmark_id).toBe(123);
    expect(parsed.overrides_jsurl).toBe("~(a~'x?y/z')/");
  });

  it("slash only hash is empty", () => {
    // python: test_slash_only_hash_is_empty
    const exc = catchParseError(() =>
      parseReportLink("https://mixpanel.com/project/3/app/insights#/"),
    );
    expect(exc.code).toBe("REPORT_LINK_EMPTY_HASH");
  });

  it.each([
    `javascript://mixpanel.com/project/3/app/insights#${SLUG}`,
    `ftp://mixpanel.com/project/3/app/insights#${SLUG}`,
    `file://mixpanel.com/project/3/app/insights#${SLUG}`,
  ])("non HTTP scheme is unparseable[%s]", (url) => {
    // python: test_non_http_scheme_is_unparseable
    const exc = catchParseError(() => parseReportLink(url));
    expect(exc.code).toBe("REPORT_LINK_UNPARSEABLE");
  });

  it.each(["http", "HTTP", "Https"])(
    "HTTP schemes parse[%s]", // python: test_http_schemes_parse
    (scheme) => {
      const parsed = parseReportLink(
        `${scheme}://mixpanel.com/project/3/app/insights#${SLUG}`,
      );
      expect(parsed.slug).toBe(SLUG);
    },
  );

  it("percent hash decodes only the hash", () => {
    // python: test_percent_hash_decodes_only_the_hash
    const parsed = parseReportLink(
      "https://mixpanel.com/project/3/app/insights%23report/123/my%2Ftitle",
    );
    expect(parsed.kind).toBe("bookmark");
    expect(parsed.bookmark_id).toBe(123);
    expect(parsed.title_segment).toBe("my%2Ftitle");
  });

  it("percent hash lower case", () => {
    // python: test_percent_hash_lower_case
    const parsed = parseReportLink(
      `https://mixpanel.com/project/3/app/insights%23${SLUG}`,
    );
    expect(parsed.slug).toBe(SLUG);
  });

  it("non digit workspace segment is unrecognized path", () => {
    // python: test_non_digit_workspace_segment_is_unrecognized_path
    const exc = catchParseError(() =>
      parseReportLink(
        `https://mixpanel.com/project/3/view/x/app/insights#${SLUG}`,
      ),
    );
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_PATH");
  });

  it("duplicate fragment keys first wins", () => {
    // python: test_duplicate_fragment_keys_first_wins
    const parsed = parseReportLink(
      "https://mixpanel.com/project/3/app/boards#id=1&id=2",
    );
    expect(parsed.kind).toBe("dashboard");
    expect(parsed.dashboard_id).toBe(1);
  });

  it("scheme without host is unparseable", () => {
    // python: test_scheme_without_host_is_unparseable
    const exc = catchParseError(() => parseReportLink("https://"));
    expect(exc.code).toBe("REPORT_LINK_UNPARSEABLE");
  });
});
