// The pure `maybeScopedPath(domainPath, scope)` (project- vs
// workspace-scoped App API paths, including workspace id 0 and negatives).
// Mirrors the `maybe_scoped_path` cases of TestWorkspaceScoping and
// TestAppApiEdgeCases from tests/unit/test_app_api_client.py; Python's mutable
// `set_workspace_id` state becomes the `{projectId, workspaceId}` scope argument.
import { describe, expect, it } from "vitest";

import { maybeScopedPath } from "../../src/client/scope.js";

describe("Workspace scoping (maybe_scoped_path half)", () => {
  // python: TestWorkspaceScoping
  it("maybe scoped path without workspace", () => {
    // python: test_maybe_scoped_path_without_workspace
    expect(
      maybeScopedPath("dashboards", { projectId: "12345", workspaceId: null }),
    ).toBe("/projects/12345/dashboards");
  });

  it("maybe scoped path with workspace", () => {
    // python: test_maybe_scoped_path_with_workspace
    expect(
      maybeScopedPath("dashboards", { projectId: "12345", workspaceId: 789 }),
    ).toBe("/workspaces/789/dashboards");
  });

  it("maybe scoped path with workspace null resets", () => {
    // python: test_maybe_scoped_path_with_workspace_none_resets
    // Python: set_workspace_id(789) then set_workspace_id(None) —
    // the cleared state is the null-workspace scope.
    expect(
      maybeScopedPath("dashboards", { projectId: "12345", workspaceId: null }),
    ).toBe("/projects/12345/dashboards");
  });
});

describe("App API edge cases", () => {
  // python: TestAppApiEdgeCases
  it("set workspace ID zero", () => {
    // python: test_set_workspace_id_zero
    // Workspace ID 0 is unusual but accepted: Python's guard is
    // `is not None`, NOT truthiness.
    const path = maybeScopedPath("dashboards", {
      projectId: "12345",
      workspaceId: 0,
    });
    expect(path).toContain("/workspaces/0/");
  });

  it("set workspace ID negative", () => {
    // python: test_set_workspace_id_negative
    // Negative IDs are not validated client-side — server's concern.
    const path = maybeScopedPath("dashboards", {
      projectId: "12345",
      workspaceId: -1,
    });
    expect(path).toContain("/workspaces/-1/");
  });
});
