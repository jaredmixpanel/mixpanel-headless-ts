// Unit tests for the naming-map §3 mechanical transform and §4 exception
// resolution (src/naming.ts, task TS-4).
import { describe, expect, it } from "vitest";

import {
  type NamingExceptionRow,
  resolveTsApiName,
  snakeToCamel,
} from "../src/naming.js";

describe("snakeToCamel (naming-map §3)", () => {
  it("camelizes multi-segment names", () => {
    expect(snakeToCamel("build_funnel_params")).toBe("buildFunnelParams");
  });

  it("keeps single-word names unchanged", () => {
    expect(snakeToCamel("id")).toBe("id");
    expect(snakeToCamel("where")).toBe("where");
  });

  it("keeps digits attached to their segment", () => {
    expect(snakeToCamel("r2_score")).toBe("r2Score");
    expect(snakeToCamel("sha256_hash")).toBe("sha256Hash");
  });

  it("never uppercases acronyms", () => {
    expect(snakeToCamel("url_normalizer")).toBe("urlNormalizer");
    expect(snakeToCamel("data_group_id")).toBe("dataGroupId");
  });

  it("drops a single leading underscore (R7.6 module-privates)", () => {
    expect(snakeToCamel("_sanitize_raw_cohort")).toBe("sanitizeRawCohort");
    expect(snakeToCamel("_iter_jsonl_lines")).toBe("iterJsonlLines");
  });

  it("rejects empty identifiers and empty segments", () => {
    expect(() => snakeToCamel("")).toThrow(/empty identifier/);
    expect(() => snakeToCamel("_")).toThrow(/empty identifier/);
    expect(() => snakeToCamel("a__b")).toThrow(/empty segment/);
    expect(() => snakeToCamel("trailing_")).toThrow(/empty segment/);
    expect(() => snakeToCamel("__x")).toThrow(/empty segment/);
  });
});

describe("resolveTsApiName (naming-map §4-§5)", () => {
  /** Minimal exceptions table exercising each resolution path. */
  const ROWS: readonly NamingExceptionRow[] = [
    {
      python: "segfilter.build_segfilter_entry",
      ts: "core/query/segfilter.buildSegfilterEntry",
      scope: "api",
      rule: "rename",
    },
    {
      python: "types.CohortDefinition.to_dict",
      ts: "core/types.CohortDefinition.toDict",
      scope: "api",
      rule: "rename",
    },
    {
      python: "api_client.*",
      ts: "core/client/api-client.*",
      scope: "api",
      rule: "rename",
    },
    { python: "bad.*", ts: "core/bad", scope: "api", rule: "rename" },
    { python: "where", ts: "where", scope: "kwarg:*", rule: "keep" },
  ];

  it("prefers exact rows over wildcards", () => {
    expect(resolveTsApiName("segfilter.build_segfilter_entry", ROWS)).toEqual({
      tsModule: "core/query/segfilter",
      tsName: "buildSegfilterEntry",
    });
  });

  it("splits exact rows on the FIRST dot (class-qualified members)", () => {
    expect(resolveTsApiName("types.CohortDefinition.to_dict", ROWS)).toEqual({
      tsModule: "core/types",
      tsName: "CohortDefinition.toDict",
    });
  });

  it("applies the mechanical transform under module wildcards", () => {
    expect(resolveTsApiName("api_client.get_events", ROWS)).toEqual({
      tsModule: "core/client/api-client",
      tsName: "getEvents",
    });
  });

  it("returns undefined for names covered by no row (never fuzzy)", () => {
    expect(resolveTsApiName("mystery.call", ROWS)).toBeUndefined();
    expect(resolveTsApiName("nodots", ROWS)).toBeUndefined();
    // Class-qualified names never fall back to the bare-module wildcard.
    expect(
      resolveTsApiName("api_client.SomeClass.method", ROWS),
    ).toBeUndefined();
  });

  it("ignores non-api scopes entirely", () => {
    expect(resolveTsApiName("where", ROWS)).toBeUndefined();
  });

  it("rejects malformed wildcard targets", () => {
    expect(() => resolveTsApiName("bad.thing", ROWS)).toThrow(
      /must map to '<module>\.\*'/,
    );
  });
});
