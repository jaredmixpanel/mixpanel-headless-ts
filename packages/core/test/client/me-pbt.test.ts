// Property tests for the `selectWorkspaceId` selection ladder: the result
// always belongs to the input, and an "All Project Data" view wins when no
// global view exists. Mirrors the two pure properties of
// tests/pbt/test_workspace_resolution_pbt.py (fast-check for Hypothesis); the
// three MeService-backed properties belong to the node package's cache/service tests.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { selectWorkspaceId, type WorkspaceView } from "../../src/client/me.js";

const GLOBAL_WORKSPACE_NAME = "All Project Data";

/**
 * Unset-or-bool: an unset flag (null) must be distinguishable from
 * false — the ladder treats them differently.
 */
const triState = fc.constantFrom<boolean | null>(null, true, false);

/** Short free-form names (Hypothesis `st.text(min_size=1, max_size=8)`). */
const shortText = fc.string({ unit: "binary", minLength: 1, maxLength: 8 });

/**
 * The `_views` strategy: 1-6 views, unique ids, names biased
 * toward the global-view name.
 */
const viewsArb: fc.Arbitrary<WorkspaceView[]> = fc
  .uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
    minLength: 1,
    maxLength: 6,
  })
  .chain((ids) =>
    fc.tuple(
      ...ids.map((id) =>
        fc.record({
          id: fc.constant(id),
          name: fc.oneof(
            fc.constantFrom(GLOBAL_WORKSPACE_NAME, "Console", "Main"),
            shortText,
          ),
          is_global: triState,
          is_default: triState,
          is_visible: triState,
        }),
      ),
    ),
  );

/**
 * `_views_no_global_with_apd`: no `is_global === true`
 * anywhere; exactly one view (random position) named APD.
 */
const viewsNoGlobalWithApd: fc.Arbitrary<WorkspaceView[]> = fc
  .uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
    minLength: 1,
    maxLength: 6,
  })
  .chain((ids) =>
    fc
      .tuple(
        fc.tuple(
          ...ids.map((id) =>
            fc.record({
              id: fc.constant(id),
              name: shortText,
              is_global: fc.constantFrom<boolean | null>(null, false),
              is_default: triState,
              is_visible: triState,
            }),
          ),
        ),
        fc.integer({ min: 0, max: ids.length - 1 }),
      )
      .map(([views, apdIndex]) => {
        const out = [...views];
        const chosen = out[apdIndex] as WorkspaceView;
        out[apdIndex] = { ...chosen, name: GLOBAL_WORKSPACE_NAME };
        return out;
      }),
  );

describe("selectWorkspaceId precedence (properties)", () => {
  it("select result belongs to input", () => {
    // python: test_select_result_belongs_to_input
    fc.assert(
      fc.property(viewsArb, (views) => {
        // For a non-empty input, the chosen id is always one of the
        // views' ids.
        const ids = new Set(views.map((view) => view.id));
        expect(ids.has(selectWorkspaceId(views)!)).toBe(true);
      }),
    );
  });

  it("all project data name chosen without global", () => {
    // python: test_all_project_data_name_chosen_without_global
    fc.assert(
      fc.property(viewsNoGlobalWithApd, (views) => {
        // With no global view, an 'All Project Data'-named view wins.
        const apdIds = new Set(
          views
            .filter((view) => view.name === GLOBAL_WORKSPACE_NAME)
            .map((view) => view.id),
        );
        expect(apdIds.has(selectWorkspaceId(views)!)).toBe(true);
      }),
    );
  });
});
