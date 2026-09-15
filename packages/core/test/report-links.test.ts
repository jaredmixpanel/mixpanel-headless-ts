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

import {
  urljoin,
  urlsplit,
  UrlSplitError,
  urlunsplit,
} from "../src/compat/urllib.js";
import { ParamValidationError, ReportLinkParseError } from "../src/errors.js";
import {
  APP_TO_REPORT_TYPE,
  BOOKMARK_HASH_FOR_TYPE,
  buildBookmarkUrl,
  buildSlugUrl,
  generateSlug,
  isSlug,
  type ParsedReportLink,
  parseReportLink,
  SLUG_ALPHABET,
  SLUG_APP_FOR_TYPE,
  SLUG_LENGTH,
  SLUG_RE,
  WEB_HOSTS,
  webHost,
} from "../src/report-links.js";
import {
  BOOKMARK_TYPE_VALUES,
  REPORT_LINK_TYPE_VALUES,
} from "../src/types/literals.js";

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
 * Run `fn`, require it to throw a `ParamValidationError`, and return it.
 *
 * @param fn - The call under test.
 * @returns The thrown error.
 */
function catchParamError(fn: () => unknown): ParamValidationError {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ParamValidationError);
  return caught as ParamValidationError;
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

describe("TestConstants", () => {
  it("test_slug_alphabet_and_length", () => {
    expect(SLUG_LENGTH).toBe(12);
    expect(SLUG_ALPHABET).toBe(
      "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
    );
    for (const banned of "0IOl") {
      expect(SLUG_ALPHABET.includes(banned)).toBe(false);
    }
  });

  it("test_tables", () => {
    expect(Object.fromEntries(WEB_HOSTS)).toStrictEqual({
      us: "mixpanel.com",
      eu: "eu.mixpanel.com",
      in: "in.mixpanel.com",
    });
    expect(Object.fromEntries(SLUG_APP_FOR_TYPE)).toStrictEqual({
      insights: "insights",
      funnels: "insights",
      retention: "insights",
      flows: "flows",
    });
    expect(Object.fromEntries(BOOKMARK_HASH_FOR_TYPE)).toStrictEqual({
      insights: "insights#report/{id}",
      funnels: "funnels#view/{id}",
      retention: "retention#report/{id}",
      flows: "flows#report/{id}",
      "launch-analysis": "impact#report/{id}",
    });
    expect(Object.fromEntries(APP_TO_REPORT_TYPE)).toStrictEqual({
      insights: "insights",
      funnels: "funnels",
      retention: "retention",
      flows: "flows",
      impact: "launch-analysis",
    });
  });
});

describe("TestWebHost", () => {
  it.each([
    ["us", "mixpanel.com"],
    ["eu", "eu.mixpanel.com"],
    ["in", "in.mixpanel.com"],
  ])("test_known_regions[%s]", (region, host) => {
    expect(webHost(region)).toBe(host);
  });

  it("test_unknown_region_raises_rl3", () => {
    const exc = catchParamError(() => webHost("jp"));
    expect(exc.code).toBe("RL3_UNKNOWN_REGION");
    expect(exc.details).toStrictEqual({ region: "jp" });
  });
});

describe("TestIsSlug", () => {
  it.each([
    SLUG,
    "aaaaaaaaaaaa",
    "000000000000",
    "ab_-CD12efGH",
    "____________",
  ])("test_positive[%s]", (value) => {
    expect(isSlug(value)).toBe(true);
  });

  it.each([
    "",
    "tooShort",
    "thirteenchars",
    "EBrV5bW2u9M!",
    "EBrV5bW2u9M ",
    " EBrV5bW2u9M",
    "EBrV5bW2u9Mw\n",
    "report/12345",
    "ÉBrV5bW2u9Mw",
  ])("test_negative[%j]", (value) => {
    expect(isSlug(value)).toBe(false);
  });

  it("SLUG_RE is the server regex", () => {
    expect(SLUG_RE.source).toBe("^[0-9a-zA-Z_-]{12}$");
  });
});

describe("TestGenerateSlug", () => {
  it("test_deterministic_with_injected_choice", () => {
    expect(generateSlug({ choice: (alphabet) => alphabet[0] as string })).toBe(
      "1".repeat(12),
    );
    expect(
      generateSlug({
        choice: (alphabet) => alphabet[alphabet.length - 1] as string,
      }),
    ).toBe("z".repeat(12));
  });

  it("test_choice_receives_the_alphabet", () => {
    const seen: string[] = [];
    const choice = (alphabet: string): string => {
      seen.push(alphabet);
      return "A";
    };
    expect(generateSlug({ choice })).toBe("A".repeat(12));
    expect(seen).toStrictEqual(Array.from({ length: 12 }, () => SLUG_ALPHABET));
  });

  it("test_default_is_a_valid_slug", () => {
    const slug = generateSlug();
    expect(slug).toHaveLength(12);
    expect(isSlug(slug)).toBe(true);
    expect([...slug].every((c) => SLUG_ALPHABET.includes(c))).toBe(true);
  });
});

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

describe("TestParseTable", () => {
  it.each(PARSE_ROWS)("test_row[%j]", (value, expected) => {
    const parsed = parseReportLink(value);
    expectParsedReportLink(parsed);
    for (const name of Object.keys(expected) as Array<keyof ParsedReportLink>) {
      expect(parsed[name], name).toBe(expected[name]);
    }
    // Rows that pin `raw` were checked in the loop; the rest default to
    // the trimmed input.
    expect(parsed.raw).toBe("raw" in expected ? expected.raw : value.trim());
  });

  it.each(ERROR_ROWS)("test_error_row[%j]", (value, code) => {
    const exc = catchParseError(() => parseReportLink(value));
    expect(exc.code).toBe(code);
    expect(exc.details).toHaveProperty("hint");
  });

  it("test_unparseable_message", () => {
    const exc = catchParseError(() => parseReportLink("not a url at all"));
    expect(exc.code).toBe("REPORT_LINK_UNPARSEABLE");
    expect(exc.details["raw"]).toBe("not a url at all");
    expect(exc.details["hint"]).toBe(
      "Pass a full Mixpanel report URL, a shortlink " +
        "(https://mixpanel.com/s/...), or a 12-character slug.",
    );
  });

  it("test_not_mixpanel_host_message", () => {
    const exc = catchParseError(() =>
      parseReportLink("https://example.com/project/3/app/insights#x"),
    );
    expect(exc.code).toBe("REPORT_LINK_NOT_MIXPANEL_HOST");
    expect(exc.details["host"]).toBe("example.com");
    expect(exc.details["hint"]).toBe(
      "Expected mixpanel.com, eu.mixpanel.com, or in.mixpanel.com.",
    );
  });

  it("test_unrecognized_path_message", () => {
    const exc = catchParseError(() =>
      parseReportLink("https://mixpanel.com/settings/project/3"),
    );
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_PATH");
    expect(exc.details["path"]).toBe("/settings/project/3");
    expect(exc.details["hint"]).toContain("/s/{code}");
  });

  it("test_unrecognized_hash_message", () => {
    const exc = catchParseError(() =>
      parseReportLink("https://mixpanel.com/project/3/app/insights#foo/bar"),
    );
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_HASH");
    expect(exc.details["hash"]).toBe("foo/bar");
    expect(exc.details["hint"]).toContain("12-character slug");
  });

  it("test_empty_hash_message", () => {
    const exc = catchParseError(() =>
      parseReportLink("https://mixpanel.com/project/3/app/funnels#"),
    );
    expect(exc.code).toBe("REPORT_LINK_EMPTY_HASH");
    expect(exc.details["app"]).toBe("funnels");
    expect(exc.details["project_id"]).toBe(3);
  });

  it("test_parse_error_details_carry_parsed_fields", () => {
    const exc = catchParseError(() =>
      parseReportLink("https://eu.mixpanel.com/project/9/view/2/app/flows#x"),
    );
    expect(exc.details["region"]).toBe("eu");
    expect(exc.details["project_id"]).toBe(9);
    expect(exc.details["workspace_id"]).toBe(2);
  });

  it("test_frozen", () => {
    const parsed = parseReportLink(SLUG);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(() => {
      (parsed as unknown as { slug: string }).slug = "x";
    }).toThrow(TypeError);
    expect(parsed.slug).toBe(SLUG);
  });

  it("test_boards_id_outside_boards_app_is_unrecognized", () => {
    const exc = catchParseError(() =>
      parseReportLink("https://mixpanel.com/project/3/app/insights#id=555"),
    );
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_HASH");
  });

  it("test_boards_with_invalid_edited_bookmark_is_dashboard", () => {
    const parsed = parseReportLink(
      "https://mixpanel.com/project/3/app/boards#id=555&edited-bookmark=short",
    );
    expect(parsed.kind).toBe("dashboard");
    expect(parsed.dashboard_id).toBe(555);
    expect(parsed.slug).toBeNull();
  });

  it("test_short_link_without_code_is_unrecognized_path", () => {
    const exc = catchParseError(() =>
      parseReportLink("https://mixpanel.com/s/"),
    );
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_PATH");
  });

  it("test_unknown_app_is_unrecognized_path", () => {
    const exc = catchParseError(() =>
      parseReportLink("https://mixpanel.com/project/3/app/users#abc"),
    );
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_PATH");
  });

  it("test_non_ascii_digits_are_not_ids", () => {
    const exc = catchParseError(() =>
      parseReportLink(`https://mixpanel.com/project/٣/app/insights#${SLUG}`),
    );
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_PATH");
  });

  it("test_bare_known_host_is_unrecognized_path", () => {
    const exc = catchParseError(() => parseReportLink("mixpanel.com"));
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_PATH");
  });

  it("test_host_prefix_lookalike_is_unparseable", () => {
    const exc = catchParseError(() =>
      parseReportLink(`mixpanel.comx/project/3/app/insights#${SLUG}`),
    );
    expect(exc.code).toBe("REPORT_LINK_UNPARSEABLE");
    expect(exc.details["raw"]).toBe(
      `mixpanel.comx/project/3/app/insights#${SLUG}`,
    );
  });

  it("test_boards_hash_without_id_is_unrecognized", () => {
    const exc = catchParseError(() =>
      parseReportLink("https://mixpanel.com/project/3/app/boards#foo=bar"),
    );
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_HASH");
  });

  it("test_malformed_netloc_is_unparseable", () => {
    const exc = catchParseError(() =>
      parseReportLink("https://[::1/project/3/app/insights#x"),
    );
    expect(exc.code).toBe("REPORT_LINK_UNPARSEABLE");
  });
});

// --- url-grammar.md §6 builders -----------------------------------------------

describe("TestBuilders", () => {
  it("test_slug_us_with_workspace", () => {
    expect(
      buildSlugUrl({
        region: "us",
        project_id: 3,
        slug: SLUG,
        report_type: "insights",
        workspace_id: 75,
      }),
    ).toBe(`https://mixpanel.com/project/3/view/75/app/insights#${SLUG}`);
  });

  it("test_slug_eu_funnels_uses_insights_app", () => {
    expect(
      buildSlugUrl({
        region: "eu",
        project_id: 3,
        slug: SLUG,
        report_type: "funnels",
      }),
    ).toBe(`https://eu.mixpanel.com/project/3/app/insights#${SLUG}`);
  });

  it("test_slug_in_flows", () => {
    expect(
      buildSlugUrl({
        region: "in",
        project_id: 3,
        slug: SLUG,
        report_type: "flows",
      }),
    ).toBe(`https://in.mixpanel.com/project/3/app/flows#${SLUG}`);
  });

  it("test_slug_retention_uses_insights_app", () => {
    expect(
      buildSlugUrl({
        region: "us",
        project_id: 3,
        slug: SLUG,
        report_type: "retention",
      }),
    ).toBe(`https://mixpanel.com/project/3/app/insights#${SLUG}`);
  });

  it("test_bookmark_insights", () => {
    expect(
      buildBookmarkUrl({
        region: "us",
        project_id: 3,
        bookmark_id: 123,
        report_type: "insights",
      }),
    ).toBe("https://mixpanel.com/project/3/app/insights#report/123");
  });

  it("test_bookmark_funnels_with_workspace", () => {
    expect(
      buildBookmarkUrl({
        region: "us",
        project_id: 3,
        bookmark_id: 123,
        report_type: "funnels",
        workspace_id: 75,
      }),
    ).toBe("https://mixpanel.com/project/3/view/75/app/funnels#view/123");
  });

  it.each([
    ["retention", "retention#report/123"],
    ["flows", "flows#report/123"],
    ["launch-analysis", "impact#report/123"],
  ])("test_bookmark_other_types[%s]", (reportType, tail) => {
    expect(
      buildBookmarkUrl({
        region: "us",
        project_id: 3,
        bookmark_id: 123,
        report_type: reportType,
      }),
    ).toBe(`https://mixpanel.com/project/3/app/${tail}`);
  });

  it("test_slug_unknown_type_raises_rl1", () => {
    const exc = catchParamError(() =>
      buildSlugUrl({
        region: "us",
        project_id: 3,
        slug: SLUG,
        report_type: "boards",
      }),
    );
    expect(exc.code).toBe("RL1_UNKNOWN_REPORT_TYPE");
    expect(exc.details).toStrictEqual({
      report_type: "boards",
      allowed: ["flows", "funnels", "insights", "retention"],
    });
  });

  it("test_bookmark_unknown_type_raises_rl1", () => {
    const exc = catchParamError(() =>
      buildBookmarkUrl({
        region: "us",
        project_id: 3,
        bookmark_id: 1,
        report_type: "boards",
      }),
    );
    expect(exc.code).toBe("RL1_UNKNOWN_REPORT_TYPE");
    // Python asserts the allowed list appears in the message text; the
    // structured `allowed` detail is the in-contract equivalent.
    expect(exc.details["allowed"]).toContain("launch-analysis");
  });

  it("test_slug_invalid_slug_raises_rl2", () => {
    const exc = catchParamError(() =>
      buildSlugUrl({
        region: "us",
        project_id: 3,
        slug: "short",
        report_type: "insights",
      }),
    );
    expect(exc.code).toBe("RL2_INVALID_SLUG");
    expect(exc.details).toStrictEqual({ slug: "short" });
  });

  it.each([
    [{ project_id: 0 }, "project_id", 0],
    [{ project_id: -3 }, "project_id", -3],
    [{ workspace_id: 0 }, "workspace_id", 0],
    [{ workspace_id: -1 }, "workspace_id", -1],
  ])("test_slug_non_positive_id_raises_rl6[%j]", (kwargs, field, value) => {
    const exc = catchParamError(() =>
      buildSlugUrl({
        region: "us",
        project_id: 3,
        slug: SLUG,
        report_type: "insights",
        ...kwargs,
      }),
    );
    expect(exc.code).toBe("RL6_INVALID_ID");
    expect(exc.details).toStrictEqual({ field, value });
  });

  it.each([
    [{ project_id: 0 }, "project_id", 0],
    [{ workspace_id: -1 }, "workspace_id", -1],
    [{ bookmark_id: 0 }, "bookmark_id", 0],
    [{ bookmark_id: -1 }, "bookmark_id", -1],
  ])("test_bookmark_non_positive_id_raises_rl6[%j]", (kwargs, field, value) => {
    const exc = catchParamError(() =>
      buildBookmarkUrl({
        region: "us",
        project_id: 3,
        bookmark_id: 123,
        report_type: "insights",
        ...kwargs,
      }),
    );
    expect(exc.code).toBe("RL6_INVALID_ID");
    expect(exc.details).toStrictEqual({ field, value });
  });

  it.each(["slug", "bookmark"])(
    "test_unknown_region_raises_rl3[%s]",
    (builder) => {
      const exc = catchParamError(() =>
        builder === "slug"
          ? buildSlugUrl({
              region: "jp",
              project_id: 3,
              slug: SLUG,
              report_type: "insights",
            })
          : buildBookmarkUrl({
              region: "jp",
              project_id: 3,
              bookmark_id: 1,
              report_type: "insights",
            }),
      );
      expect(exc.code).toBe("RL3_UNKNOWN_REGION");
    },
  );
});

describe("TestTableInvariants", () => {
  it("test_slug_table_keys_match_report_link_type", () => {
    expect(new Set(SLUG_APP_FOR_TYPE.keys())).toStrictEqual(
      new Set(REPORT_LINK_TYPE_VALUES),
    );
  });

  it("test_bookmark_table_keys_match_bookmark_type", () => {
    expect(new Set(BOOKMARK_HASH_FOR_TYPE.keys())).toStrictEqual(
      new Set(BOOKMARK_TYPE_VALUES),
    );
  });

  it.each([
    ["SLUG_APP_FOR_TYPE", SLUG_APP_FOR_TYPE],
    ["BOOKMARK_HASH_FOR_TYPE", BOOKMARK_HASH_FOR_TYPE],
    ["APP_TO_REPORT_TYPE", APP_TO_REPORT_TYPE],
    ["WEB_HOSTS", WEB_HOSTS],
  ])("test_tables_are_read_only[%s]", (_name, table) => {
    // `MappingProxyType` → `ReadonlyMap`: the exported type exposes no
    // mutator (a compile-time fact, pinned here as a type-level assertion)
    // and the runtime value is a real `Map`.
    const view: ReadonlyMap<string, string> = table;
    type HasMutator = "set" | "delete" | "clear" extends keyof typeof view
      ? true
      : false;
    const hasMutator: HasMutator = false;
    expect(hasMutator).toBe(false);
    expect(view).toBeInstanceOf(Map);
    expect(view.has("x")).toBe(false);
  });
});

describe("TestParserTolerance", () => {
  it("test_trailing_slash_after_bookmark_hash", () => {
    const parsed = parseReportLink(
      "https://mixpanel.com/project/3/app/insights#report/123/",
    );
    expect(parsed.kind).toBe("bookmark");
    expect(parsed.bookmark_id).toBe(123);
    expect(parsed.title_segment).toBeNull();
  });

  it("test_trailing_slash_after_slug", () => {
    const parsed = parseReportLink(
      `https://mixpanel.com/project/3/app/insights#${SLUG}/`,
    );
    expect(parsed.kind).toBe("slug");
    expect(parsed.slug).toBe(SLUG);
  });

  it("test_query_tail_after_slug", () => {
    const parsed = parseReportLink(
      `https://mixpanel.com/project/3/app/insights#${SLUG}?utm=x`,
    );
    expect(parsed.kind).toBe("slug");
    expect(parsed.slug).toBe(SLUG);
  });

  it("test_query_tail_after_bookmark_hash", () => {
    const parsed = parseReportLink(
      "https://mixpanel.com/project/3/app/insights#report/123?utm=x",
    );
    expect(parsed.kind).toBe("bookmark");
    expect(parsed.bookmark_id).toBe(123);
  });

  it("test_overrides_tail_keeps_question_mark_and_slash", () => {
    const parsed = parseReportLink(
      "https://mixpanel.com/project/3/app/funnels#view/123/~(a~'x?y/z')/",
    );
    expect(parsed.kind).toBe("bookmark");
    expect(parsed.bookmark_id).toBe(123);
    expect(parsed.overrides_jsurl).toBe("~(a~'x?y/z')/");
  });

  it("test_slash_only_hash_is_empty", () => {
    const exc = catchParseError(() =>
      parseReportLink("https://mixpanel.com/project/3/app/insights#/"),
    );
    expect(exc.code).toBe("REPORT_LINK_EMPTY_HASH");
  });

  it.each([
    `javascript://mixpanel.com/project/3/app/insights#${SLUG}`,
    `ftp://mixpanel.com/project/3/app/insights#${SLUG}`,
    `file://mixpanel.com/project/3/app/insights#${SLUG}`,
  ])("test_non_http_scheme_is_unparseable[%s]", (url) => {
    const exc = catchParseError(() => parseReportLink(url));
    expect(exc.code).toBe("REPORT_LINK_UNPARSEABLE");
  });

  it.each(["http", "HTTP", "Https"])(
    "test_http_schemes_parse[%s]",
    (scheme) => {
      const parsed = parseReportLink(
        `${scheme}://mixpanel.com/project/3/app/insights#${SLUG}`,
      );
      expect(parsed.slug).toBe(SLUG);
    },
  );

  it("test_percent_hash_decodes_only_the_hash", () => {
    const parsed = parseReportLink(
      "https://mixpanel.com/project/3/app/insights%23report/123/my%2Ftitle",
    );
    expect(parsed.kind).toBe("bookmark");
    expect(parsed.bookmark_id).toBe(123);
    expect(parsed.title_segment).toBe("my%2Ftitle");
  });

  it("test_percent_hash_lower_case", () => {
    const parsed = parseReportLink(
      `https://mixpanel.com/project/3/app/insights%23${SLUG}`,
    );
    expect(parsed.slug).toBe(SLUG);
  });

  it("test_non_digit_workspace_segment_is_unrecognized_path", () => {
    const exc = catchParseError(() =>
      parseReportLink(
        `https://mixpanel.com/project/3/view/x/app/insights#${SLUG}`,
      ),
    );
    expect(exc.code).toBe("REPORT_LINK_UNRECOGNIZED_PATH");
  });

  it("test_duplicate_fragment_keys_first_wins", () => {
    const parsed = parseReportLink(
      "https://mixpanel.com/project/3/app/boards#id=1&id=2",
    );
    expect(parsed.kind).toBe("dashboard");
    expect(parsed.dashboard_id).toBe(1);
  });

  it("test_scheme_without_host_is_unparseable", () => {
    const exc = catchParseError(() => parseReportLink("https://"));
    expect(exc.code).toBe("REPORT_LINK_UNPARSEABLE");
  });
});

// --- compat/urllib: the CPython urlsplit / urljoin twins the parser rides on --

describe("compat/urllib (CPython urlsplit / urlunsplit / urljoin twins)", () => {
  describe("urlsplit", () => {
    it("lower-cases the scheme and hostname, keeps the netloc verbatim", () => {
      const parts = urlsplit(
        `HTTPS://MIXPANEL.COM/project/3/app/insights#${SLUG}`,
      );
      expect(parts.scheme).toBe("https");
      expect(parts.netloc).toBe("MIXPANEL.COM");
      expect(parts.hostname).toBe("mixpanel.com");
      expect(parts.path).toBe("/project/3/app/insights");
      expect(parts.query).toBe("");
      expect(parts.fragment).toBe(SLUG);
    });

    it("strips the port and userinfo from hostname only", () => {
      const parts = urlsplit(
        "https://user:pw@Eu.Mixpanel.com:8443/project/3/app/insights?utm=x#h",
      );
      expect(parts.netloc).toBe("user:pw@Eu.Mixpanel.com:8443");
      expect(parts.hostname).toBe("eu.mixpanel.com");
      expect(parts.path).toBe("/project/3/app/insights");
      expect(parts.query).toBe("utm=x");
      expect(parts.fragment).toBe("h");
    });

    it("strips a default :443 port from hostname", () => {
      expect(urlsplit("https://mixpanel.com:443/x").hostname).toBe(
        "mixpanel.com",
      );
    });

    it("splits the fragment before the query, so a ? inside the hash stays", () => {
      const parts = urlsplit("https://mixpanel.com/a?b=1#c?d=2");
      expect(parts.query).toBe("b=1");
      expect(parts.fragment).toBe("c?d=2");
    });

    it("does not percent-decode anything", () => {
      const parts = urlsplit(
        "https://mixpanel.com/project/3/app/insights%23report/123/my%2Ftitle",
      );
      expect(parts.path).toBe(
        "/project/3/app/insights%23report/123/my%2Ftitle",
      );
      expect(parts.fragment).toBe("");
    });

    it("treats a scheme-less host as a relative path (no netloc)", () => {
      const parts = urlsplit("mixpanel.com/s/abc");
      expect(parts.scheme).toBe("");
      expect(parts.netloc).toBe("");
      expect(parts.hostname).toBeNull();
      expect(parts.path).toBe("mixpanel.com/s/abc");
    });

    it("yields a null hostname for a scheme with no host", () => {
      const parts = urlsplit("https://");
      expect(parts.netloc).toBe("");
      expect(parts.hostname).toBeNull();
      expect(parts.path).toBe("");
    });

    it("keeps a non-http scheme (the parser rejects it upstream)", () => {
      expect(urlsplit("javascript://mixpanel.com/x").scheme).toBe("javascript");
      expect(urlsplit("FTP://mixpanel.com/x").scheme).toBe("ftp");
    });

    it("unbrackets an IPv6 host and keeps its port out of hostname", () => {
      const parts = urlsplit("https://[::1]:8080/x");
      expect(parts.netloc).toBe("[::1]:8080");
      expect(parts.hostname).toBe("::1");
    });

    it("raises UrlSplitError on an unbalanced IPv6 bracket", () => {
      expect(() => urlsplit("https://[::1/project/3/app/insights#x")).toThrow(
        UrlSplitError,
      );
      expect(() => urlsplit("https://::1]/x")).toThrow(UrlSplitError);
    });

    it("raises UrlSplitError on an invalid bracketed host", () => {
      expect(() => urlsplit("https://[not-ipv6]/x")).toThrow(UrlSplitError);
    });

    it("strips leading C0 controls/space and removes tab/CR/LF everywhere", () => {
      const parts = urlsplit("  \thttps://mix\npanel.com/pa\rth#f\tg");
      expect(parts.scheme).toBe("https");
      expect(parts.hostname).toBe("mixpanel.com");
      expect(parts.path).toBe("/path");
      expect(parts.fragment).toBe("fg");
    });

    it("does not lower-case a scoped IPv6 zone id", () => {
      expect(urlsplit("https://[FE80::1%ETH0]/x").hostname).toBe(
        "fe80::1%ETH0",
      );
    });
  });

  describe("urlunsplit", () => {
    it("round-trips a full report URL through urlsplit", () => {
      const url = `https://mixpanel.com/project/3/app/insights?utm=x#${SLUG}`;
      expect(urlunsplit(urlsplit(url))).toBe(url);
    });

    it("keeps the raw netloc case (only the scheme is normalized)", () => {
      expect(urlunsplit(urlsplit("HTTPS://MIXPANEL.COM/x"))).toBe(
        "https://MIXPANEL.COM/x",
      );
    });

    it("emits // for a netloc-using scheme even with an empty netloc", () => {
      expect(
        urlunsplit({
          scheme: "https",
          netloc: "",
          path: "/x",
          query: "",
          fragment: "",
        }),
      ).toBe("https:///x");
    });

    it("prefixes a relative path with / when a netloc is present", () => {
      expect(
        urlunsplit({
          scheme: "https",
          netloc: "mixpanel.com",
          path: "x",
          query: "q",
          fragment: "f",
        }),
      ).toBe("https://mixpanel.com/x?q#f");
    });
  });

  describe("urljoin", () => {
    const base = "https://mixpanel.com/s/AbC123";

    it("returns an absolute target unchanged", () => {
      const target = `https://eu.mixpanel.com/project/3/app/insights#${SLUG}`;
      expect(urljoin(base, target)).toBe(target);
    });

    it("resolves a root-relative target against the base host", () => {
      expect(urljoin(base, `/project/3/app/insights#${SLUG}`)).toBe(
        `https://mixpanel.com/project/3/app/insights#${SLUG}`,
      );
    });

    it("resolves a sibling-relative target against the base directory", () => {
      expect(urljoin(base, "XyZ789")).toBe("https://mixpanel.com/s/XyZ789");
      expect(urljoin("https://mixpanel.com/a/b/", "c")).toBe(
        "https://mixpanel.com/a/b/c",
      );
    });

    it("resolves . and .. dot segments", () => {
      const deep = "https://mixpanel.com/a/b/c";
      expect(urljoin(deep, "../d")).toBe("https://mixpanel.com/a/d");
      expect(urljoin(deep, "./d")).toBe("https://mixpanel.com/a/b/d");
      expect(urljoin(deep, "..")).toBe("https://mixpanel.com/a/");
      expect(urljoin(deep, ".")).toBe("https://mixpanel.com/a/b/");
      expect(urljoin(deep, "../../d")).toBe("https://mixpanel.com/d");
      expect(urljoin(deep, "../../../d")).toBe("https://mixpanel.com/d");
      expect(urljoin(deep, "d/./e/../f")).toBe("https://mixpanel.com/a/b/d/f");
    });

    it("keeps the base path for query-only and fragment-only targets", () => {
      expect(urljoin(`${base}?x=1`, "?y=2")).toBe(`${base}?y=2`);
      expect(urljoin(`${base}?x=1`, "#frag")).toBe(`${base}?x=1#frag`);
    });

    it("adopts the base scheme for a scheme-relative target", () => {
      expect(urljoin(base, "//eu.mixpanel.com/project/3/app/flows#x")).toBe(
        "https://eu.mixpanel.com/project/3/app/flows#x",
      );
    });

    it("returns a target with a different scheme unchanged", () => {
      expect(urljoin(base, "mailto:someone@example.com")).toBe(
        "mailto:someone@example.com",
      );
      expect(urljoin(base, "http://mixpanel.com/x")).toBe(
        "http://mixpanel.com/x",
      );
    });

    it("returns the other operand when one side is empty", () => {
      expect(urljoin("", base)).toBe(base);
      expect(urljoin(base, "")).toBe(base);
    });

    it("propagates UrlSplitError from a malformed operand", () => {
      expect(() => urljoin(base, "https://[::1/x")).toThrow(UrlSplitError);
    });
  });
});
