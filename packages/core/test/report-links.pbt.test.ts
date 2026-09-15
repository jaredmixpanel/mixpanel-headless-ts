// Property-based tests for the pure report-link module (045-report-links),
// translated from tests/unit/test_report_links_pbt.py — fast-check twins of
// the Hypothesis strategies covering the seven invariants in
// contracts/url-grammar.md §7.
//
// Strategy mirroring notes (R10.2):
// - `st.text()` → `fc.string({ unit: "binary" })` (full code-point domain,
//   not ASCII-only — the B2 ASSERT-F1 precedent).
// - `st.integers(min_value=1, max_value=10**9)` → `fc.integer({ min: 1,
//   max: 1e9 })`; `st.none() | st.integers(...)` → `fc.oneof(fc.constant(
//   null), ...)`; `st.integers(max_value=0)` → `fc.integer({ max: 0 })`
//   (Python's unbounded negatives shrink to the same `<= 0` guard).
// - `st.text(alphabet=_SERVER_ALPHABET, min_size=12, max_size=12)` → a
//   12-element `fc.array(fc.constantFrom(...alphabet))` joined.
// - `dataclasses.replace(got, raw=base.raw) == base` → object spread +
//   `toEqual` (`ParsedReportLink` is a frozen plain object).
// - Totality (§7.5): any exception thrown by the parser MUST be a
//   `ReportLinkParseError`; the `try/catch` twins assert `instanceof`
//   before returning, so a foreign throw fails the property.
// - Hypothesis profile sizes come from `tests/conftest.py`; the default
//   `max_examples=100` is fast-check's default `numRuns`, kept implicit.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { codepoints } from "../src/compat/codepoint.js";
import { ParamValidationError, ReportLinkParseError } from "../src/errors.js";
import {
  BOOKMARK_HASH_FOR_TYPE,
  buildBookmarkUrl,
  buildSlugUrl,
  generateSlug,
  isSlug,
  type ParsedReportLink,
  parseReportLink,
  SLUG_ALPHABET,
  SLUG_APP_FOR_TYPE,
} from "../src/report-links.js";

const SERVER_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
const SERVER_RE = /^[0-9a-zA-Z_-]{12}$/u;

const regions = fc.constantFrom("us", "eu", "in");
const projectIds = fc.integer({ min: 1, max: 1e9 });
const workspaceIds = fc.oneof(
  fc.constant<number | null>(null),
  fc.integer({ min: 1, max: 1e9 }),
);
const slugs = fc
  .array(fc.constantFrom(...codepoints(SERVER_ALPHABET)), {
    minLength: 12,
    maxLength: 12,
  })
  .map((chars) => chars.join(""));
const slugTypes = fc.constantFrom(...[...SLUG_APP_FOR_TYPE.keys()].sort());
const bookmarkTypes = fc.constantFrom(
  ...[...BOOKMARK_HASH_FOR_TYPE.keys()].sort(),
);
const bookmarkIds = fc.integer({ min: 1, max: 1e9 });
const anyText = fc.string({ unit: "binary" });

type Variant =
  "trailing_slash" | "query" | "upper_host" | "no_scheme" | "percent_hash";

const VARIANTS: readonly Variant[] = [
  "trailing_slash",
  "query",
  "upper_host",
  "no_scheme",
  "percent_hash",
];

/**
 * Python `str.partition(sep)` — split at the first `sep`.
 *
 * @param text - The text.
 * @param sep - The separator.
 * @returns `[head, sep-or-empty, tail]`.
 */
function partition(text: string, sep: string): [string, string, string] {
  const at = text.indexOf(sep);
  if (at === -1) {
    return [text, "", ""];
  }
  return [text.slice(0, at), sep, text.slice(at + sep.length)];
}

/**
 * Apply one decoration variant to a built URL (`_decorate`).
 *
 * @param url - A URL produced by `buildSlugUrl` or `buildBookmarkUrl`.
 * @param variant - The decoration to apply.
 * @returns The decorated URL string.
 */
function decorate(url: string, variant: Variant): string {
  const [head, , fragment] = partition(url, "#");
  switch (variant) {
    case "trailing_slash": {
      return `${head}/#${fragment}`;
    }
    case "query": {
      return `${head}?utm=x#${fragment}`;
    }
    case "upper_host": {
      const [scheme, , rest] = partition(url, "://");
      const [host, , tail] = partition(rest, "/");
      return `${scheme}://${host.toUpperCase()}/${tail}`;
    }
    case "no_scheme": {
      return url.split("://", 2)[1] as string;
    }
    case "percent_hash": {
      return `${head}%23${fragment}`;
    }
  }
}

/**
 * Run the parser and require any throw to be a `ReportLinkParseError`
 * (the totality rule) — `except ReportLinkParseError` with a foreign
 * exception failing the property instead of propagating.
 *
 * @param value - The parser input.
 * @returns The parse result, or the parse error.
 */
function parseTotal(value: string): ParsedReportLink | ReportLinkParseError {
  try {
    return parseReportLink(value);
  } catch (error) {
    expect(error).toBeInstanceOf(ReportLinkParseError);
    return error as ReportLinkParseError;
  }
}

/**
 * Run a builder and require it to throw a `ParamValidationError`.
 *
 * @param fn - The builder call.
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

describe("TestSlugInvariants", () => {
  it("test_generate_slug_shape", () => {
    fc.assert(
      fc.property(fc.integer(), () => {
        const slug = generateSlug();
        expect(slug).toHaveLength(12);
        expect(codepoints(slug).every((c) => SLUG_ALPHABET.includes(c))).toBe(
          true,
        );
        expect(isSlug(slug)).toBe(true);
      }),
    );
  });

  it("test_is_slug_matches_server_regex", () => {
    fc.assert(
      fc.property(anyText, (value) => {
        expect(isSlug(value)).toBe(SERVER_RE.test(value));
      }),
    );
  });

  it("test_non_slugs_are_never_slugs", () => {
    fc.assert(
      fc.property(
        anyText.filter(
          (s) =>
            s.length !== 12 ||
            codepoints(s).some((c) => !SERVER_ALPHABET.includes(c)),
        ),
        (value) => {
          expect(isSlug(value)).toBe(false);
        },
      ),
    );
  });
});

describe("TestRoundTrips", () => {
  it("test_slug_url_round_trip", () => {
    fc.assert(
      fc.property(
        regions,
        projectIds,
        workspaceIds,
        slugs,
        slugTypes,
        (region, pid, wid, slug, reportType) => {
          const url = buildSlugUrl({
            region,
            project_id: pid,
            slug,
            report_type: reportType,
            workspace_id: wid,
          });
          const parsed = parseReportLink(url);
          expect(parsed.kind).toBe("slug");
          expect(parsed.region).toBe(region);
          expect(parsed.project_id).toBe(pid);
          expect(parsed.workspace_id).toBe(wid);
          expect(parsed.slug).toBe(slug);
          expect(parsed.app).toBe(SLUG_APP_FOR_TYPE.get(reportType));
        },
      ),
    );
  });

  it("test_bookmark_url_round_trip", () => {
    fc.assert(
      fc.property(
        regions,
        projectIds,
        workspaceIds,
        bookmarkIds,
        bookmarkTypes,
        (region, pid, wid, bid, reportType) => {
          const url = buildBookmarkUrl({
            region,
            project_id: pid,
            bookmark_id: bid,
            report_type: reportType,
            workspace_id: wid,
          });
          const parsed = parseReportLink(url);
          expect(parsed.kind).toBe("bookmark");
          expect(parsed.region).toBe(region);
          expect(parsed.project_id).toBe(pid);
          expect(parsed.workspace_id).toBe(wid);
          expect(parsed.bookmark_id).toBe(bid);
          expect(parsed.report_type_hint).toBe(reportType);
        },
      ),
    );
  });
});

describe("TestNonPositiveIds", () => {
  it("test_slug_builder_rejects_non_positive_project", () => {
    fc.assert(
      fc.property(
        regions,
        fc.integer({ max: 0 }),
        slugs,
        slugTypes,
        (region, pid, slug, reportType) => {
          const exc = catchParamError(() =>
            buildSlugUrl({
              region,
              project_id: pid,
              slug,
              report_type: reportType,
            }),
          );
          expect(exc.code).toBe("RL6_INVALID_ID");
        },
      ),
    );
  });

  it("test_bookmark_builder_rejects_non_positive_workspace", () => {
    fc.assert(
      fc.property(
        regions,
        projectIds,
        fc.integer({ max: 0 }),
        bookmarkIds,
        bookmarkTypes,
        (region, pid, wid, bid, reportType) => {
          const exc = catchParamError(() =>
            buildBookmarkUrl({
              region,
              project_id: pid,
              bookmark_id: bid,
              report_type: reportType,
              workspace_id: wid,
            }),
          );
          expect(exc.code).toBe("RL6_INVALID_ID");
        },
      ),
    );
  });

  it("test_bookmark_builder_rejects_non_positive_bookmark", () => {
    fc.assert(
      fc.property(
        regions,
        projectIds,
        fc.integer({ max: 0 }),
        bookmarkTypes,
        (region, pid, bid, reportType) => {
          const exc = catchParamError(() =>
            buildBookmarkUrl({
              region,
              project_id: pid,
              bookmark_id: bid,
              report_type: reportType,
            }),
          );
          expect(exc.code).toBe("RL6_INVALID_ID");
        },
      ),
    );
  });
});

describe("TestDecorationInvariance", () => {
  it("test_slug_url_decorations", () => {
    fc.assert(
      fc.property(
        regions,
        projectIds,
        workspaceIds,
        slugs,
        slugTypes,
        fc.constantFrom(...VARIANTS),
        (region, pid, wid, slug, reportType, variant) => {
          const url = buildSlugUrl({
            region,
            project_id: pid,
            slug,
            report_type: reportType,
            workspace_id: wid,
          });
          const base = parseReportLink(url);
          const decorated = decorate(url, variant);
          const got = parseReportLink(decorated);
          expect({ ...got, raw: base.raw }).toEqual(base);
        },
      ),
    );
  });

  it("test_bookmark_url_decorations", () => {
    fc.assert(
      fc.property(
        regions,
        projectIds,
        workspaceIds,
        bookmarkIds,
        bookmarkTypes,
        fc.constantFrom(...VARIANTS),
        (region, pid, wid, bid, reportType, variant) => {
          const url = buildBookmarkUrl({
            region,
            project_id: pid,
            bookmark_id: bid,
            report_type: reportType,
            workspace_id: wid,
          });
          const base = parseReportLink(url);
          const got = parseReportLink(decorate(url, variant));
          expect({ ...got, raw: base.raw }).toEqual(base);
        },
      ),
    );
  });
});

/**
 * Assert the per-kind id field invariants of url-grammar.md §7.6
 * (`_assert_kind_fields`).
 *
 * @param parsed - Any parse result.
 */
function assertKindFields(parsed: ParsedReportLink): void {
  switch (parsed.kind) {
    case "slug": {
      expect(parsed.slug).not.toBeNull();
      expect(isSlug(parsed.slug as string)).toBe(true);
      break;
    }
    case "bookmark": {
      expect(parsed.bookmark_id).not.toBeNull();
      break;
    }
    case "short_link": {
      expect(parsed.short_code).not.toBeNull();
      expect(parsed.region).not.toBeNull();
      break;
    }
    case "dashboard": {
      expect(parsed.dashboard_id).not.toBeNull();
      break;
    }
    case "legacy_jsurl": {
      // No kind-specific field.
      break;
    }
  }
}

describe("TestTotality", () => {
  it("test_any_text", () => {
    fc.assert(
      fc.property(anyText, (value) => {
        const result = parseTotal(value);
        if (result instanceof ReportLinkParseError) {
          return;
        }
        expect(Object.isFrozen(result)).toBe(true);
        assertKindFields(result);
      }),
    );
  });

  it("test_mixpanel_host_with_random_path_and_hash", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("mixpanel.com", "eu.mixpanel.com", "in.mixpanel.com"),
        fc.string({ unit: "binary", maxLength: 60 }),
        fc.string({ unit: "binary", maxLength: 40 }),
        (host, path, fragment) => {
          const value = `https://${host}/${path}#${fragment}`;
          const result = parseTotal(value);
          if (result instanceof ReportLinkParseError) {
            expect(result.code.startsWith("REPORT_LINK_")).toBe(true);
            return;
          }
          assertKindFields(result);
        },
      ),
    );
  });

  it("test_bare_slug_has_no_scope", () => {
    fc.assert(
      // Python draws (region, pid, wid, slug, report_type) and uses only
      // the slug; the unused draws are moved ahead of it so the predicate
      // stays lint-clean without a positional-arg ignore pattern.
      fc.property(
        regions,
        projectIds,
        workspaceIds,
        slugTypes,
        slugs,
        (_region, _pid, _wid, _reportType, slug) => {
          const parsed = parseReportLink(slug);
          expect(parsed.kind).toBe("slug");
          expect(parsed.slug).toBe(slug);
          expect([
            parsed.host,
            parsed.region,
            parsed.project_id,
            parsed.workspace_id,
          ]).toEqual([null, null, null, null]);
        },
      ),
    );
  });
});

describe("test_decorate_helper_changes_the_string", () => {
  it.each(VARIANTS)("%s", (variant) => {
    const url = "https://mixpanel.com/project/3/app/insights#EBrV5bW2u9Mw";
    expect(decorate(url, variant)).not.toBe(url);
  });
});
