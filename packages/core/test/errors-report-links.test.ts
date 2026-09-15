// The report-link exception family, translated from
// `tests/unit/test_exceptions_report_links.py` (one describe per class, one
// it per test, parametrize rows as `it.each`). Message text is out of
// contract, so twins assert code + details (cross-checking `parseReportLink`
// where pure); `repr` → `.name` + `.code`; `issubclass` → prototype chains.

import { describe, expect, it } from "vitest";

import {
  APIError,
  CODED_GUARD_REGISTRY,
  MixpanelHeadlessError,
  ParamValidationError,
  ReportLinkError,
  ReportLinkNotFoundError,
  ReportLinkParseError,
  ReportLinkScopeMismatchError,
  ShortLinkResolutionError,
  UnsupportedReportLinkError,
} from "../src/errors.js";
import { parseReportLink } from "../src/report-links.js";

type ReportLinkErrorClass = typeof ReportLinkError;

const LEAF_CLASSES: ReadonlyArray<[string, ReportLinkErrorClass]> = [
  ["ReportLinkParseError", ReportLinkParseError],
  ["UnsupportedReportLinkError", UnsupportedReportLinkError],
  ["ReportLinkNotFoundError", ReportLinkNotFoundError],
  ["ReportLinkScopeMismatchError", ReportLinkScopeMismatchError],
  ["ShortLinkResolutionError", ShortLinkResolutionError],
];

/**
 * Throw-and-catch helper so the raise-site cross-checks can inspect the
 * thrown error without `any`.
 *
 * @param fn - Callable expected to throw.
 * @returns The thrown value.
 */
function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the callable to throw");
}

describe("Report link hierarchy", () => {
  // python: TestReportLinkHierarchy
  it("the base class subclasses MixpanelHeadlessError", () => {
    // python: test_base_subclasses_mixpanel_headless_error
    expect(ReportLinkError.prototype instanceof MixpanelHeadlessError).toBe(
      true,
    );
    expect(ReportLinkError.prototype instanceof APIError).toBe(false);
  });

  it.each(LEAF_CLASSES)(
    "%s subclasses ReportLinkError", // python: test_leaf_subclasses_report_link_error
    (_name, excCls) => {
      expect(excCls.prototype instanceof ReportLinkError).toBe(true);
      expect(excCls.prototype instanceof MixpanelHeadlessError).toBe(true);
    },
  );

  it("leaves are catchable as the base", () => {
    // python: test_catchable_as_base
    expect(() => {
      throw new ReportLinkParseError("boom");
    }).toThrow(ReportLinkError);
  });
});

describe("Default codes", () => {
  // python: TestDefaultCodes
  it.each<[string, ReportLinkErrorClass, string]>([
    ["ReportLinkError", ReportLinkError, "REPORT_LINK_ERROR"],
    ["ReportLinkParseError", ReportLinkParseError, "REPORT_LINK_UNPARSEABLE"],
    [
      "UnsupportedReportLinkError",
      UnsupportedReportLinkError,
      "UNSUPPORTED_REPORT_LINK",
    ],
    [
      "ReportLinkNotFoundError",
      ReportLinkNotFoundError,
      "REPORT_LINK_NOT_FOUND",
    ],
    [
      "ReportLinkScopeMismatchError",
      ReportLinkScopeMismatchError,
      "REPORT_LINK_SCOPE_MISMATCH",
    ],
    [
      "ShortLinkResolutionError",
      ShortLinkResolutionError,
      "SHORT_LINK_RESOLUTION_ERROR",
    ],
  ])("%s default code", (name, excCls, expected) => {
    // python: test_default_code
    const exc = new excCls("msg");
    expect(exc.code).toBe(expected);
    expect(exc.message).toBe("msg");
    expect(exc.name).toBe(name);
    expect(exc).toBeInstanceOf(excCls);
  });

  it.each<[string, ReportLinkErrorClass, string]>([
    [
      "ReportLinkParseError",
      ReportLinkParseError,
      "REPORT_LINK_NOT_MIXPANEL_HOST",
    ],
    [
      "ReportLinkParseError",
      ReportLinkParseError,
      "REPORT_LINK_UNRECOGNIZED_PATH",
    ],
    [
      "ReportLinkParseError",
      ReportLinkParseError,
      "REPORT_LINK_UNRECOGNIZED_HASH",
    ],
    ["ReportLinkParseError", ReportLinkParseError, "REPORT_LINK_EMPTY_HASH"],
    [
      "UnsupportedReportLinkError",
      UnsupportedReportLinkError,
      "UNSUPPORTED_LEGACY_HASH",
    ],
    [
      "UnsupportedReportLinkError",
      UnsupportedReportLinkError,
      "UNSUPPORTED_DASHBOARD_LINK",
    ],
    [
      "UnsupportedReportLinkError",
      UnsupportedReportLinkError,
      "UNSUPPORTED_REPORT_TYPE",
    ],
    [
      "ReportLinkNotFoundError",
      ReportLinkNotFoundError,
      "REPORT_LINK_SLUG_NOT_FOUND",
    ],
    [
      "ReportLinkNotFoundError",
      ReportLinkNotFoundError,
      "REPORT_LINK_BOOKMARK_NOT_FOUND",
    ],
    [
      "ReportLinkNotFoundError",
      ReportLinkNotFoundError,
      "SHORT_LINK_NOT_FOUND",
    ],
    [
      "ReportLinkScopeMismatchError",
      ReportLinkScopeMismatchError,
      "REPORT_LINK_PROJECT_MISMATCH",
    ],
    [
      "ReportLinkScopeMismatchError",
      ReportLinkScopeMismatchError,
      "REPORT_LINK_REGION_MISMATCH",
    ],
    [
      "ShortLinkResolutionError",
      ShortLinkResolutionError,
      "SHORT_LINK_NO_LOCATION",
    ],
    [
      "ShortLinkResolutionError",
      ShortLinkResolutionError,
      "SHORT_LINK_UNEXPECTED_RESPONSE",
    ],
    ["ShortLinkResolutionError", ShortLinkResolutionError, "SHORT_LINK_CHAIN"],
  ])("%s accepts explicit code %s", (_name, excCls, code) => {
    // python: test_explicit_code_override
    const exc = new excCls("msg", { code });
    expect(exc.code).toBe(code);
  });
});

describe("Details and to dict", () => {
  // python: TestDetailsAndToDict
  it("details default to empty", () => {
    // python: test_details_default_empty
    expect(new ReportLinkError("msg").details).toStrictEqual({});
  });

  it("details carry parsed fields and hint", () => {
    // python: test_details_carry_parsed_fields_and_hint
    const exc = new ReportLinkScopeMismatchError("mismatch", {
      code: "REPORT_LINK_PROJECT_MISMATCH",
      details: {
        kind: "slug",
        region: "us",
        project_id: 3,
        workspace_id: 75,
        slug: "EBrV5bW2u9Mw",
        hint: "switch project",
      },
    });
    expect(exc.details["kind"]).toBe("slug");
    expect(exc.details["region"]).toBe("us");
    expect(exc.details["project_id"]).toBe(3);
    expect(exc.details["workspace_id"]).toBe(75);
    expect(exc.details["slug"]).toBe("EBrV5bW2u9Mw");
    expect(exc.details["hint"]).toBe("switch project");
  });

  it("toDict shape", () => {
    // python: test_to_dict_shape
    const exc = new ReportLinkNotFoundError("gone", {
      code: "SHORT_LINK_NOT_FOUND",
      details: { short_code: "AbC123", host: "mixpanel.com" },
    });
    const d = exc.toDict();
    expect(d).toStrictEqual({
      code: "SHORT_LINK_NOT_FOUND",
      message: "gone",
      details: { short_code: "AbC123", host: "mixpanel.com" },
    });
    expect(Object.keys(d)).toStrictEqual(["code", "message", "details"]);
    expect(() => JSON.stringify(d)).not.toThrow();
  });

  it("name and code stand in for repr", () => {
    // python: test_repr_names_class_and_code
    const exc = new ShortLinkResolutionError("x", { code: "SHORT_LINK_CHAIN" });
    expect(exc.name).toBe("ShortLinkResolutionError");
    expect(exc.code).toBe("SHORT_LINK_CHAIN");
  });
});

describe("Canonical messages", () => {
  // python: TestCanonicalMessages
  it("unparseable input: REPORT_LINK_UNPARSEABLE with raw + hint", () => {
    // python: test_parse_unparseable
    const raw = "not a url at all";
    const hint =
      "Pass a full Mixpanel report URL, a shortlink " +
      "(https://mixpanel.com/s/...), or a 12-character slug.";
    const exc = new ReportLinkParseError(
      `Could not parse report link: ${raw}`,
      {
        details: { raw, hint },
      },
    );
    expect(exc.code).toBe("REPORT_LINK_UNPARSEABLE");
    expect(exc.details["raw"]).toBe(raw);
    expect(exc.details["hint"]).toBe(hint);

    // Raise-site cross-check: the parser populates the same code/keys.
    const thrown = capture(() => parseReportLink(raw));
    expect(thrown).toBeInstanceOf(ReportLinkParseError);
    const parseExc = thrown as ReportLinkParseError;
    expect(parseExc.code).toBe("REPORT_LINK_UNPARSEABLE");
    expect(parseExc.details["raw"]).toBe(raw);
    expect(typeof parseExc.details["hint"]).toBe("string");
  });

  it("non-Mixpanel host: REPORT_LINK_NOT_MIXPANEL_HOST with host + hint", () => {
    // python: test_parse_not_mixpanel_host
    const exc = new ReportLinkParseError(
      "Report link host 'example.com' is not a Mixpanel web host.",
      {
        code: "REPORT_LINK_NOT_MIXPANEL_HOST",
        details: {
          host: "example.com",
          hint: "Expected mixpanel.com, eu.mixpanel.com, or in.mixpanel.com.",
        },
      },
    );
    expect(exc.code).toBe("REPORT_LINK_NOT_MIXPANEL_HOST");
    expect(exc.details["host"]).toBe("example.com");
    expect(Object.keys(exc.details)).toStrictEqual(["host", "hint"]);

    // Raise-site cross-check: the parser populates the same code/keys.
    const thrown = capture(() =>
      parseReportLink("https://example.com/project/3/app/insights#abc"),
    );
    expect(thrown).toBeInstanceOf(ReportLinkParseError);
    const parseExc = thrown as ReportLinkParseError;
    expect(parseExc.code).toBe("REPORT_LINK_NOT_MIXPANEL_HOST");
    expect(parseExc.details["host"]).toBe("example.com");
    expect(typeof parseExc.details["hint"]).toBe("string");
  });

  it("legacy JSURL hash: UNSUPPORTED_LEGACY_HASH with kind + hint", () => {
    // python: test_unsupported_legacy_hash
    const hint =
      "Open it in a browser (the app re-mints a shareable link " +
      "on load) and copy the new URL.";
    const exc = new UnsupportedReportLinkError(
      "This link uses the legacy JSURL hash format, which " +
        "mixpanel-headless cannot decode.",
      {
        code: "UNSUPPORTED_LEGACY_HASH",
        details: { kind: "legacy_jsurl", hint },
      },
    );
    expect(exc.code).toBe("UNSUPPORTED_LEGACY_HASH");
    expect(exc.details["kind"]).toBe("legacy_jsurl");
    expect(exc.details["hint"]).toBe(hint);
  });

  it("missing slug: REPORT_LINK_SLUG_NOT_FOUND with slug/project/region", () => {
    // python: test_not_found_slug
    const exc = new ReportLinkNotFoundError(
      "No unsaved report found for slug EBrV5bW2u9Mw in project 3 (us). " +
        "A slug is only readable in the project and region that created it.",
      {
        code: "REPORT_LINK_SLUG_NOT_FOUND",
        details: { slug: "EBrV5bW2u9Mw", project_id: 3, region: "us" },
      },
    );
    expect(exc.code).toBe("REPORT_LINK_SLUG_NOT_FOUND");
    expect(exc.details).toStrictEqual({
      slug: "EBrV5bW2u9Mw",
      project_id: 3,
      region: "us",
    });
  });

  it("project mismatch: REPORT_LINK_PROJECT_MISMATCH with both ids", () => {
    // python: test_scope_project_mismatch
    const exc = new ReportLinkScopeMismatchError(
      "Report link belongs to project 3 but the active session is " +
        'project 12345. Switch with ws.use(project="3") ' +
        "(CLI: mp --project 3 ...) and retry.",
      {
        code: "REPORT_LINK_PROJECT_MISMATCH",
        details: { link_project_id: 3, session_project_id: 12345 },
      },
    );
    expect(exc.code).toBe("REPORT_LINK_PROJECT_MISMATCH");
    expect(exc.details["link_project_id"]).toBe(3);
    expect(exc.details["session_project_id"]).toBe(12345);
  });

  it("shortlink chain: SHORT_LINK_CHAIN with short_code/target/hint", () => {
    // python: test_short_link_chain
    const exc = new ShortLinkResolutionError(
      "Shortlink /s/AbC redirects to another shortlink " +
        "(https://mixpanel.com/s/XyZ). mixpanel-headless follows one " +
        "redirect only.",
      {
        code: "SHORT_LINK_CHAIN",
        details: {
          short_code: "AbC",
          target: "https://mixpanel.com/s/XyZ",
          hint: "Resolve the target shortlink directly.",
        },
      },
    );
    expect(exc.code).toBe("SHORT_LINK_CHAIN");
    expect(exc.details["short_code"]).toBe("AbC");
    expect(exc.details["target"]).toBe("https://mixpanel.com/s/XyZ");
    expect(exc.details["hint"]).toBe("Resolve the target shortlink directly.");
  });
});

describe("Builder guard codes", () => {
  // python: TestBuilderGuardCodes
  it.each([
    "RL1_UNKNOWN_REPORT_TYPE",
    "RL2_INVALID_SLUG",
    "RL3_UNKNOWN_REGION",
    "RL4_REPORT_TYPE_CONFLICT",
  ])("%s is registered", (code) => {
    // python: test_registered
    expect(CODED_GUARD_REGISTRY.has(code)).toBe(true);
  });

  // TS-port addition: the two RL codes the port's raise sites also use
  // (`ResolvedReport.__post_init__` and the positive-id guards).
  it.each(["RL5_RESOLVED_REPORT_INCONSISTENT", "RL6_INVALID_ID"])(
    "%s is registered (port addition)", // python: test_registered
    (code) => {
      expect(CODED_GUARD_REGISTRY.has(code)).toBe(true);
    },
  );

  it("ParamValidationError carries an RL code", () => {
    // python: test_param_validation_error_carries_rl_code
    const exc = new ParamValidationError(
      "Unknown region 'jp'. Expected one of: us, eu, in.",
      "RL3_UNKNOWN_REGION",
    );
    expect(exc).toBeInstanceOf(MixpanelHeadlessError);
    expect(exc).not.toBeInstanceOf(ReportLinkError);
    expect(exc.code).toBe("RL3_UNKNOWN_REGION");
  });
});
