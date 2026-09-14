// C8(c) exception/code registry-equality lock (phase2-design C3):
//
// 1. `errors.ts` exports EXACTLY the 34 exception class names in the
//    synced contract artifact, with the same parent-edge set (verified by
//    walking `Object.getPrototypeOf` chains).
// 2. The TS `CODED_GUARD_REGISTRY` / `CODED_GUARD_TWIN_CODES` sets
//    (re-exported from the generated errors-codes.gen.ts) equal the
//    artifact's sets.
// 3. Per-class default codes match (each class instantiated with minimal
//    args; `.code` compared against the artifact's `default_codes`).
// 4. errors-codes.gen.ts is FRESH: `node scripts/gen-error-codes.mjs
//    --check` regenerates from the artifact and diffs byte-for-byte
//    (hand-edit tripwire, phase2-design C5 item 4).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  errorsModule as errors,
  CODED_GUARD_REGISTRY,
  CODED_GUARD_TWIN_CODES,
  DEFAULT_ERROR_CODES,
  ERROR_CODES_GENERATED_FROM,
  EXCEPTION_CLASS_PARENTS,
} from "@mixpanel-headless/core/internal";

/** The repo root (this file lives in conformance-runner/test). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Path of the synced Python-side contract artifact. */
const ARTIFACT_PATH = resolve(
  REPO_ROOT,
  "conformance-runner/corpus/contract/error-codes.json",
);

/** Parsed shape of error-codes.json (P2-1 generator output). */
interface ErrorCodesArtifact {
  readonly generated_from: string;
  readonly exception_classes: Readonly<Record<string, string | null>>;
  readonly default_codes: Readonly<Record<string, string>>;
  readonly coded_guard_registry: readonly string[];
  readonly coded_guard_twin_codes: readonly string[];
}

const artifact = JSON.parse(
  readFileSync(ARTIFACT_PATH, "utf8"),
) as ErrorCodesArtifact;

/** Constructor type for the exported exception classes. */
type ErrorClass = new (...args: never[]) => Error;

/** Every runtime export of errors.ts that is an Error subclass. */
const exportedClasses = new Map<string, ErrorClass>();
for (const [name, value] of Object.entries(errors as Record<string, unknown>)) {
  if (
    typeof value === "function" &&
    (value as { prototype: unknown }).prototype instanceof Error
  ) {
    exportedClasses.set(name, value as ErrorClass);
  }
}

/**
 * Minimal-argument instantiation table: class name → factory producing an
 * instance whose `.code` must equal the artifact's default code. Reviewed
 * against the Python constructor signatures (exceptions.py).
 */
const INSTANTIATION_TABLE: Readonly<
  Record<string, () => errors.MixpanelHeadlessError>
> = {
  MixpanelHeadlessError: () => new errors.MixpanelHeadlessError("m"),
  ParamValidationError: () => new errors.ParamValidationError("m"),
  ParamTypeError: () => new errors.ParamTypeError("m"),
  ResponseValidationError: () => new errors.ResponseValidationError("m"),
  APIError: () => new errors.APIError("m", { statusCode: 500 }),
  AuthenticationError: () => new errors.AuthenticationError(),
  RateLimitError: () => new errors.RateLimitError(),
  QueryError: () => new errors.QueryError(),
  ServerError: () => new errors.ServerError(),
  SessionReplayError: () => new errors.SessionReplayError("m"),
  SessionReplayAccessError: () => new errors.SessionReplayAccessError("m"),
  SignedURLExpiredError: () => new errors.SignedURLExpiredError("m"),
  ReplayNotFoundError: () => new errors.ReplayNotFoundError("m"),
  UnsupportedReplayFormatError: () =>
    new errors.UnsupportedReplayFormatError("m"),
  ConfigError: () => new errors.ConfigError("m"),
  AccountNotFoundError: () => new errors.AccountNotFoundError("a"),
  ProjectNotFoundError: () => new errors.ProjectNotFoundError("p"),
  AccountExistsError: () => new errors.AccountExistsError("a"),
  InvalidArgumentError: () =>
    new errors.InvalidArgumentError("m", { violation: "mutually_exclusive" }),
  AccountInUseError: () => new errors.AccountInUseError("a"),
  OAuthError: () => new errors.OAuthError("m"),
  RegionProbeError: () => new errors.RegionProbeError("m", { attempts: [] }),
  RegionProbeNetworkError: () =>
    new errors.RegionProbeNetworkError("m", { attempts: [] }),
  EventNotFoundError: () => new errors.EventNotFoundError("e"),
  DateRangeTooLargeError: () =>
    new errors.DateRangeTooLargeError("2024-01-01", "2024-01-02", 1),
  WorkspaceScopeError: () => new errors.WorkspaceScopeError("m"),
  BusinessContextValidationError: () =>
    new errors.BusinessContextValidationError("m"),
  BookmarkValidationError: () =>
    new errors.BookmarkValidationError([new errors.ValidationError("p", "m")]),
  // 045-report-links family (Python PR #223).
  ReportLinkError: () => new errors.ReportLinkError("m"),
  ReportLinkParseError: () => new errors.ReportLinkParseError("m"),
  UnsupportedReportLinkError: () => new errors.UnsupportedReportLinkError("m"),
  ReportLinkNotFoundError: () => new errors.ReportLinkNotFoundError("m"),
  ReportLinkScopeMismatchError: () =>
    new errors.ReportLinkScopeMismatchError("m"),
  ShortLinkResolutionError: () => new errors.ShortLinkResolutionError("m"),
};

describe("C8(c) registry equality vs corpus/contract/error-codes.json", () => {
  it("artifact sanity: 34 classes, 126 registry codes, 9 twin codes", () => {
    expect(Object.keys(artifact.exception_classes)).toHaveLength(34);
    expect(Object.keys(artifact.default_codes)).toHaveLength(34);
    expect(artifact.coded_guard_registry).toHaveLength(126);
    expect(artifact.coded_guard_twin_codes).toHaveLength(9);
  });

  it("(a) errors.ts exports exactly the artifact's 34 exception classes", () => {
    const exported = [...exportedClasses.keys()].sort();
    const expected = Object.keys(artifact.exception_classes).sort();
    expect(exported).toEqual(expected);
  });

  it("(a) parent-edge set matches (Object.getPrototypeOf walk)", () => {
    for (const [name, parentName] of Object.entries(
      artifact.exception_classes,
    )) {
      const cls = exportedClasses.get(name);
      expect(cls, `class ${name} missing from errors.ts`).toBeDefined();
      const parent = Object.getPrototypeOf(cls) as ErrorClass;
      if (parentName === null) {
        // Hierarchy root: parent is the platform Error, not a library class.
        expect(parent, `${name} must extend Error directly`).toBe(Error);
      } else {
        expect(parent, `${name} must extend ${parentName}`).toBe(
          exportedClasses.get(parentName),
        );
      }
    }
  });

  it("(b) TS CODED_GUARD_REGISTRY equals the artifact set", () => {
    expect([...CODED_GUARD_REGISTRY].sort()).toEqual(
      [...artifact.coded_guard_registry].sort(),
    );
    // The re-export through errors.ts is the same object.
    expect(errors.CODED_GUARD_REGISTRY).toBe(CODED_GUARD_REGISTRY);
  });

  it("(b) TS CODED_GUARD_TWIN_CODES equals the artifact set and is disjoint", () => {
    expect([...CODED_GUARD_TWIN_CODES].sort()).toEqual(
      [...artifact.coded_guard_twin_codes].sort(),
    );
    expect(errors.CODED_GUARD_TWIN_CODES).toBe(CODED_GUARD_TWIN_CODES);
    for (const twin of CODED_GUARD_TWIN_CODES) {
      expect(CODED_GUARD_REGISTRY.has(twin)).toBe(false);
    }
  });

  it("(c) default codes match on freshly constructed instances", () => {
    expect(Object.keys(INSTANTIATION_TABLE).sort()).toEqual(
      Object.keys(artifact.default_codes).sort(),
    );
    for (const [name, expectedCode] of Object.entries(artifact.default_codes)) {
      const factory = INSTANTIATION_TABLE[name];
      expect(factory, `no instantiation entry for ${name}`).toBeDefined();
      const instance = factory!();
      expect(instance.code, `${name} default code`).toBe(expectedCode);
      expect(instance.name).toBe(name);
      expect(instance).toBeInstanceOf(exportedClasses.get(name)!);
    }
  });

  it("(c) generated DEFAULT_ERROR_CODES map mirrors the artifact", () => {
    expect(Object.fromEntries(DEFAULT_ERROR_CODES)).toEqual(
      artifact.default_codes,
    );
    expect(Object.fromEntries(EXCEPTION_CLASS_PARENTS)).toEqual(
      artifact.exception_classes,
    );
    expect(ERROR_CODES_GENERATED_FROM).toBe(artifact.generated_from);
  });

  it("(d) errors-codes.gen.ts is freshly generated (regenerate-and-diff)", () => {
    // Exits non-zero (throws) if the committed file differs from a fresh
    // render of the artifact — catches hand edits and stale re-syncs.
    execFileSync(
      process.execPath,
      [resolve(REPO_ROOT, "scripts/gen-error-codes.mjs"), "--check"],
      { stdio: "pipe" },
    );
  });
});
