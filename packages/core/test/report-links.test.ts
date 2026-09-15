// The pure report-link module minus the parser: constants, `webHost`,
// `isSlug`, `generateSlug`, the url-grammar builders and table invariants,
// translated from `tests/unit/test_report_links.py` (parse rows live in
// `report-links-parse.test.ts`). Message text is out of contract, so builder
// rows assert `code` + `details`; `MappingProxyType` tables are ReadonlyMaps.

import { describe, expect, it } from "vitest";

import { codepoints } from "../src/compat/codepoint.js";
import { ParamValidationError } from "../src/errors.js";
import {
  APP_TO_REPORT_TYPE,
  BOOKMARK_HASH_FOR_TYPE,
  buildBookmarkUrl,
  buildSlugUrl,
  generateSlug,
  isSlug,
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

describe("Constants", () => {
  // python: TestConstants
  it("slug alphabet and length", () => {
    // python: test_slug_alphabet_and_length
    expect(SLUG_LENGTH).toBe(12);
    expect(SLUG_ALPHABET).toBe(
      "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
    );
    for (const banned of "0IOl") {
      expect(SLUG_ALPHABET.includes(banned)).toBe(false);
    }
  });

  it("the four lookup tables", () => {
    // python: test_tables
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

describe("Web host", () => {
  // python: TestWebHost
  it.each([
    ["us", "mixpanel.com"],
    ["eu", "eu.mixpanel.com"],
    ["in", "in.mixpanel.com"],
  ])("region %s maps to %s", (region, host) => {
    // python: test_known_regions
    expect(webHost(region)).toBe(host);
  });

  it("unknown region raises RL3", () => {
    // python: test_unknown_region_raises_rl3
    const exc = catchParamError(() => webHost("jp"));
    expect(exc.code).toBe("RL3_UNKNOWN_REGION");
    expect(exc.details).toStrictEqual({ region: "jp" });
  });
});

describe("Is slug", () => {
  // python: TestIsSlug
  it.each([
    SLUG,
    "aaaaaaaaaaaa",
    "000000000000",
    "ab_-CD12efGH",
    "____________",
  ])("%s is a slug", (value) => {
    // python: test_positive
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
  ])("%j is not a slug", (value) => {
    // python: test_negative
    expect(isSlug(value)).toBe(false);
  });

  it("SLUG_RE is the server regex", () => {
    expect(SLUG_RE.source).toBe("^[0-9a-zA-Z_-]{12}$");
  });
});

describe("Generate slug", () => {
  // python: TestGenerateSlug
  it("deterministic with injected choice", () => {
    // python: test_deterministic_with_injected_choice
    expect(generateSlug({ choice: (alphabet) => alphabet[0]! })).toBe(
      "1".repeat(12),
    );
    expect(
      generateSlug({
        choice: (alphabet) => alphabet.at(-1)!,
      }),
    ).toBe("z".repeat(12));
  });

  it("choice receives the alphabet", () => {
    // python: test_choice_receives_the_alphabet
    const seen: string[] = [];
    const choice = (alphabet: string): string => {
      seen.push(alphabet);
      return "A";
    };
    expect(generateSlug({ choice })).toBe("A".repeat(12));
    expect(seen).toStrictEqual(Array.from({ length: 12 }, () => SLUG_ALPHABET));
  });

  it("default is a valid slug", () => {
    // python: test_default_is_a_valid_slug
    const slug = generateSlug();
    expect(slug).toHaveLength(12);
    expect(isSlug(slug)).toBe(true);
    expect(codepoints(slug).every((c) => SLUG_ALPHABET.includes(c))).toBe(true);
  });
});

// --- url-grammar.md §6 builders -----------------------------------------------

describe("Builders", () => {
  // python: TestBuilders
  it("slug URL: us with workspace", () => {
    // python: test_slug_us_with_workspace
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

  it("slug URL: eu funnels uses the insights app", () => {
    // python: test_slug_eu_funnels_uses_insights_app
    expect(
      buildSlugUrl({
        region: "eu",
        project_id: 3,
        slug: SLUG,
        report_type: "funnels",
      }),
    ).toBe(`https://eu.mixpanel.com/project/3/app/insights#${SLUG}`);
  });

  it("slug URL: in flows", () => {
    // python: test_slug_in_flows
    expect(
      buildSlugUrl({
        region: "in",
        project_id: 3,
        slug: SLUG,
        report_type: "flows",
      }),
    ).toBe(`https://in.mixpanel.com/project/3/app/flows#${SLUG}`);
  });

  it("slug URL: retention uses the insights app", () => {
    // python: test_slug_retention_uses_insights_app
    expect(
      buildSlugUrl({
        region: "us",
        project_id: 3,
        slug: SLUG,
        report_type: "retention",
      }),
    ).toBe(`https://mixpanel.com/project/3/app/insights#${SLUG}`);
  });

  it("bookmark URL: insights", () => {
    // python: test_bookmark_insights
    expect(
      buildBookmarkUrl({
        region: "us",
        project_id: 3,
        bookmark_id: 123,
        report_type: "insights",
      }),
    ).toBe("https://mixpanel.com/project/3/app/insights#report/123");
  });

  it("bookmark URL: funnels with workspace", () => {
    // python: test_bookmark_funnels_with_workspace
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
  ])("bookmark URL: %s", (reportType, tail) => {
    // python: test_bookmark_other_types
    expect(
      buildBookmarkUrl({
        region: "us",
        project_id: 3,
        bookmark_id: 123,
        report_type: reportType,
      }),
    ).toBe(`https://mixpanel.com/project/3/app/${tail}`);
  });

  it("slug unknown type raises RL1", () => {
    // python: test_slug_unknown_type_raises_rl1
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

  it("bookmark unknown type raises RL1", () => {
    // python: test_bookmark_unknown_type_raises_rl1
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

  it("slug invalid slug raises RL2", () => {
    // python: test_slug_invalid_slug_raises_rl2
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
  ])(
    "slug builder rejects non-positive %j with RL6",
    (kwargs, field, value) => {
      // python: test_slug_non_positive_id_raises_rl6
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
    },
  );

  it.each([
    [{ project_id: 0 }, "project_id", 0],
    [{ workspace_id: -1 }, "workspace_id", -1],
    [{ bookmark_id: 0 }, "bookmark_id", 0],
    [{ bookmark_id: -1 }, "bookmark_id", -1],
  ])(
    "bookmark builder rejects non-positive %j with RL6",
    (kwargs, field, value) => {
      // python: test_bookmark_non_positive_id_raises_rl6
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
    },
  );

  it.each(["slug", "bookmark"])(
    "%s builder rejects an unknown region with RL3", // python: test_unknown_region_raises_rl3
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

describe("Table invariants", () => {
  // python: TestTableInvariants
  it("slug table keys match report link type", () => {
    // python: test_slug_table_keys_match_report_link_type
    expect(new Set(SLUG_APP_FOR_TYPE.keys())).toStrictEqual(
      new Set(REPORT_LINK_TYPE_VALUES),
    );
  });

  it("bookmark table keys match bookmark type", () => {
    // python: test_bookmark_table_keys_match_bookmark_type
    expect(new Set(BOOKMARK_HASH_FOR_TYPE.keys())).toStrictEqual(
      new Set(BOOKMARK_TYPE_VALUES),
    );
  });

  it.each([
    ["SLUG_APP_FOR_TYPE", SLUG_APP_FOR_TYPE],
    ["BOOKMARK_HASH_FOR_TYPE", BOOKMARK_HASH_FOR_TYPE],
    ["APP_TO_REPORT_TYPE", APP_TO_REPORT_TYPE],
    ["WEB_HOSTS", WEB_HOSTS],
  ])("%s is read-only", (_name, table) => {
    // python: test_tables_are_read_only
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
