// Layer-3 translation — tests/pbt/test_workspace_resolution_pbt.py →
// fast-check (Phase-3 packet B4-C1; same strategy shapes).
//
// Translated here: the two PURE selection-ladder properties
// (`test_select_result_belongs_to_input`,
// `test_all_project_data_name_chosen_without_global`).
//
// Header exclusion (packet C1 §Layer-3 + playbook Discrepancy #5): the
// three MeService-backed properties
// (`test_global_workspace_is_chosen_when_present`,
// `test_resolution_is_deterministic`, `test_never_selects_other_project`)
// drive `MeService.resolve_workspace` over a warm on-disk MeCache —
// both are B8-N2 modules; those properties translate at B8 against the
// real MeService.
import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { selectWorkspaceId, type WorkspaceView } from "../../src/client/me.js";

const GLOBAL_WORKSPACE_NAME = "All Project Data";

/** Unset-or-bool: an unset flag (null) must be distinguishable from
 * false — the ladder treats them differently. */
const triState = fc.constantFrom<boolean | null>(null, true, false);

/** Short free-form names (Hypothesis `st.text(min_size=1, max_size=8)`). */
const shortText = fc.string({ unit: "binary", minLength: 1, maxLength: 8 });

/** The `_views` strategy (:82-95): 1-6 views, unique ids, names biased
 * toward the global-view name. */
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

/** `_views_no_global_with_apd` (:98-140): no `is_global === true`
 * anywhere; exactly one view (random position) named APD. */
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

describe("select_workspace_id precedence (PBT)", () => {
  it("test_select_result_belongs_to_input", () => {
    fc.assert(
      fc.property(viewsArb, (views) => {
        // For a non-empty input, the chosen id is always one of the
        // views' ids.
        const ids = new Set(views.map((view) => view.id));
        expect(ids.has(selectWorkspaceId(views) as number)).toBe(true);
      }),
    );
  });

  it("test_all_project_data_name_chosen_without_global", () => {
    fc.assert(
      fc.property(viewsNoGlobalWithApd, (views) => {
        // With no global view, an 'All Project Data'-named view wins.
        const apdIds = new Set(
          views
            .filter((view) => view.name === GLOBAL_WORKSPACE_NAME)
            .map((view) => view.id),
        );
        expect(apdIds.has(selectWorkspaceId(views) as number)).toBe(true);
      }),
    );
  });
});
