// Referee (a) unit test — replays the recon referee-assets.md §1 payload
// triple (positive + 2 negative controls) through the ajv Ajv2020 harness.
// The expected verdicts were proven against the SAME schema bytes with
// Python jsonschema Draft202012Validator (transcript in the recon file);
// verdict parity here is the cross-language referee contract.
import { describe, expect, it } from "vitest";

import {
  KNOWN_INVALID_CHART_TYPE_PAYLOAD,
  KNOWN_INVALID_EXTRA_ROOT_KEY_PAYLOAD,
  KNOWN_VALID_INSIGHTS_PAYLOAD,
} from "../referees/bookmark-schema/known-payloads.js";
import {
  createBookmarkValidator,
  loadBookmarkSchema,
  refereeBookmarkPayload,
} from "../referees/bookmark-schema/referee.js";

describe("vendored bookmark.json schema", () => {
  it("is the insights-only InsightsBookmarkParams root", () => {
    const schema = loadBookmarkSchema();
    expect(schema["title"]).toBe("InsightsBookmarkParams");
    expect(schema["additionalProperties"]).toBe(false);
    expect(schema["required"]).toStrictEqual(["displayOptions", "sections"]);
  });

  it("compiles under Ajv2020 strict:false despite 11 tsType keywords", () => {
    // Compilation itself is the assertion: ajv strict mode would throw
    // `strict mode: unknown keyword: "tsType"`, and plain draft-07 Ajv
    // would mishandle prefixItems/const.
    expect(typeof createBookmarkValidator()).toBe("function");
  });
});

describe("referee verdicts on the recon known-payload triple", () => {
  it("accepts the minimal valid insights payload", () => {
    const verdict = refereeBookmarkPayload(KNOWN_VALID_INSIGHTS_PAYLOAD);
    expect(verdict.errors).toStrictEqual([]);
    expect(verdict.valid).toBe(true);
  });

  it("rejects an out-of-enum chartType (negative control 1)", () => {
    const verdict = refereeBookmarkPayload(KNOWN_INVALID_CHART_TYPE_PAYLOAD);
    expect(verdict.valid).toBe(false);
    expect(
      verdict.errors.some((e) => e.includes("/displayOptions/chartType")),
    ).toBe(true);
  });

  it("rejects an extra root key (negative control 2)", () => {
    const verdict = refereeBookmarkPayload(
      KNOWN_INVALID_EXTRA_ROOT_KEY_PAYLOAD,
    );
    expect(verdict.valid).toBe(false);
    expect(
      verdict.errors.some((e) =>
        e.includes("must NOT have additional properties"),
      ),
    ).toBe(true);
  });

  it("rejects an ambiguous empty show clause via the ShowClause oneOf multi-match trap", () => {
    // Documented scope caveat (D15a / recon §1, escalation 3): the ShowClause
    // branches have optional `type` consts and (for Formula) no required
    // keys, so a clause without distinguishing keys matches more than one
    // branch and fails oneOf ("must match exactly one schema"). An empty
    // clause {} is the minimal reproduction; generated fixtures must always
    // emit an explicit "type" to stay unambiguous.
    const ambiguous = JSON.parse(
      JSON.stringify(KNOWN_VALID_INSIGHTS_PAYLOAD),
    ) as Record<string, unknown>;
    const sections = ambiguous["sections"] as Record<string, unknown>;
    sections["show"] = [{}];
    const verdict = refereeBookmarkPayload(ambiguous);
    expect(verdict.valid).toBe(false);
    expect(
      verdict.errors.some((e) =>
        e.includes("must match exactly one schema in oneOf"),
      ),
    ).toBe(true);
  });

  it("fails non-object payloads outright", () => {
    expect(refereeBookmarkPayload(null).valid).toBe(false);
    expect(refereeBookmarkPayload([]).valid).toBe(false);
    expect(refereeBookmarkPayload("bookmark").valid).toBe(false);
  });
});
