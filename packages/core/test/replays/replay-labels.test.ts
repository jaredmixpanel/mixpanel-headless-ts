// Translated label tests (packet B5-S3, `b5-packets.md` §5):
// assertion-for-assertion ports (R10.2) of the three label classes in
//   tests/unit/test_replay_bundle.py
//     TestUrlNormalizer     :97
//     TestDefaultLabelFn    :118
//     TestSelectorLabelFn   :135
//
// The remaining classes of that file are owned elsewhere: TestRrwebAnalyzer
// :162 → `rrweb-analyzer.test.ts`; TestReplayBundleAggregations :325 +
// TestAggregatorFunctions :459 → `aggregators.test.ts`;
// TestReplayBundleProjections :260, TestReplayBundleFilters :415,
// TestCodedUserActionCodes :485 and TestCodedReplayBundleCodes :513 were
// translated in Phase 2 (`test/types/results/replays.test.ts:1-21`) — the
// four asserts excluded THERE (test_elements_df,
// test_elements_df_normalizes_urls, test_error_sessions,
// test_sample_determinism) come alive in `aggregators.test.ts` with the
// TODO(port) closure.
import { describe, expect, it } from "vitest";

import {
  defaultLabelFn,
  selectorLabelFn,
  urlNormalizer,
} from "../../src/replays/replay-labels.js";
import { UserAction } from "../../src/types/results/replays.js";

/**
 * Construct a `UserAction` for label tests (Python `_build_action`,
 * `test_replay_bundle.py:49-64`).
 *
 * @param overrides - Field overrides applied over the Python defaults.
 * @returns The constructed action.
 */
function buildAction(
  overrides: {
    timestamp?: number;
    action?: string;
    target_desc?: string;
    url?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): UserAction {
  return new UserAction({
    timestamp: overrides.timestamp ?? 1716810000000,
    action: (overrides.action ?? "click") as UserAction["action"],
    target_node_id: 1,
    target_desc: overrides.target_desc ?? "button",
    url:
      overrides.url === undefined ? "https://example.com/login" : overrides.url,
    metadata: overrides.metadata ?? {},
  });
}

describe("url_normalizer collapses parameterized URLs (TestUrlNormalizer)", () => {
  it("test_strips_query_string", () => {
    expect(urlNormalizer("/x?a=1&b=2")).toBe("/x");
  });

  it("test_replaces_numeric_segments", () => {
    expect(urlNormalizer("/users/12345/profile")).toBe("/users/:id/profile");
  });

  it("test_preserves_host", () => {
    const out = urlNormalizer(
      "https://app.example.com/users/12345/profile?ref=x",
    );
    expect(out).toBe("https://app.example.com/users/:id/profile");
  });

  it("test_empty_url", () => {
    expect(urlNormalizer("")).toBe("");
  });
});

describe("default_label_fn produces the canonical action:tag@url shape (TestDefaultLabelFn)", () => {
  it("test_label_shape", () => {
    const action = buildAction({
      target_desc: 'button "Sign in"',
      url: "/users/12345/profile?ref=x",
    });
    expect(defaultLabelFn(action)).toBe(
      'click:button "Sign in"@/users/:id/profile',
    );
  });

  it("test_no_url", () => {
    const action = buildAction({ url: null });
    expect(defaultLabelFn(action)).toContain("@(no-url)");
  });
});

describe("selector_label_fn prefers stable attributes when present (TestSelectorLabelFn)", () => {
  it("test_uses_data_testid_when_present", () => {
    const fn = selectorLabelFn("data-testid");
    const action = buildAction({
      target_desc: "some long ugly description",
      metadata: { "data-testid": "signin-button" },
      url: "/login",
    });
    const out = fn(action);
    expect(out).toContain("signin-button");
    expect(out).not.toContain("ugly description");
  });

  it("test_falls_back_to_default", () => {
    const fn = selectorLabelFn("data-testid");
    const action = buildAction({ target_desc: "button", url: "/login" });
    expect(fn(action)).toBe(defaultLabelFn(action));
  });
});

// ADDITIVE (no Python twin): the R10.9 differential harness caught the
// label forking on a non-`str` metadata value — Python's f-string is
// `str(candidate)`, so a boolean renders `True`, not `true`. Recorded
// here because `throwaway/b5-s3/` is deleted at the batch gate
// (`b5-packets.md` §7.5) and this is the surviving lock.
describe("selector_label_fn renders non-str values with PYTHON spelling", () => {
  it.each([
    [true, "True"],
    [42, "42"],
    [1.5, "1.5"],
    [["a", "b"], "['a', 'b']"],
    [{ k: 1 }, "{'k': 1}"],
  ] as ReadonlyArray<readonly [unknown, string]>)(
    "metadata value %o renders as %s",
    (value, expected) => {
      const fn = selectorLabelFn("data-testid");
      const action = buildAction({
        metadata: { "data-testid": value },
        url: "/login",
      });
      expect(fn(action)).toBe(`click:${expected}@/login`);
    },
  );
});
