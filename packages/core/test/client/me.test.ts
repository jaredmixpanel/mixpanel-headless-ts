// Layer-3 translation — Phase-3 packet B4-C1 me-model locks. Sources:
//
// - tests/unit/test_me.py — the PURE model half: ::TestMeOrgInfo (:38),
//   ::TestMeProjectInfo (:71), ::TestMeWorkspaceInfo (:108),
//   ::TestMeResponse (:149). ::TestMeCache*/:.TestMeService/
//   ::TestMeCacheSymlinkRejection are B8-N2 (on-disk cache/service —
//   playbook Discrepancy #5; header exclusion per packet C1 §Layer-3).
// - tests/unit/test_workspace_resolution.py::TestSelectWorkspaceId
//   (:96-151) — the shared selection ladder.
//
// Entry-point substitutions: `model_validate` → `fromDict`;
// `model_extra` → `modelExtra`; `model_dump_json`/`model_validate_json`
// → `JSON.stringify(toJSON())` + `fromDict(JSON.parse(...))`.
import { describe, expect, it } from "vitest";

import {
  MeOrgInfo,
  MeProjectInfo,
  MeResponse,
  MeWorkspaceInfo,
  selectWorkspaceId,
  type WorkspaceView,
} from "../../src/client/me.js";

describe("TestMeOrgInfo", () => {
  it("test_construct", () => {
    const org = new MeOrgInfo({ id: 100, name: "Acme Corp" });
    expect(org.id).toBe(100);
    expect(org.name).toBe("Acme Corp");
    expect(org.role).toBeNull();
    expect(org.permissions).toBeNull();
  });

  it("test_construct_full", () => {
    const org = new MeOrgInfo({
      id: 100,
      name: "Acme Corp",
      role: "admin",
      permissions: ["manage_users", "view_billing"],
    });
    expect(org.role).toBe("admin");
    expect(org.permissions).toStrictEqual(["manage_users", "view_billing"]);
  });

  it("test_extra_fields_allowed", () => {
    const org = MeOrgInfo.fromDict({
      id: 1,
      name: "Test",
      future_field: "value",
    });
    expect(org.id).toBe(1);
    // Extra fields should be accessible via model_extra.
    expect(org.modelExtra).not.toBeNull();
    expect(org.modelExtra["future_field"]).toBe("value");
  });
});

describe("TestMeProjectInfo", () => {
  it("test_construct", () => {
    const project = new MeProjectInfo({
      name: "AI Demo",
      organization_id: 100,
    });
    expect(project.name).toBe("AI Demo");
    expect(project.organization_id).toBe(100);
    expect(project.timezone).toBeNull();
    expect(project.has_workspaces).toBeNull();
  });

  it("test_construct_full", () => {
    const project = new MeProjectInfo({
      name: "AI Demo",
      organization_id: 100,
      timezone: "US/Pacific",
      has_workspaces: true,
      domain: "mixpanel.com",
      type: "PROJECT",
    });
    expect(project.timezone).toBe("US/Pacific");
    expect(project.has_workspaces).toBe(true);
  });

  it("test_extra_fields_allowed", () => {
    const project = MeProjectInfo.fromDict({
      name: "Test",
      organization_id: 1,
      experimental_feature: true,
    });
    expect(project.modelExtra).not.toBeNull();
    expect(project.modelExtra["experimental_feature"]).toBe(true);
  });
});

describe("TestMeWorkspaceInfo", () => {
  it("test_construct", () => {
    const ws = new MeWorkspaceInfo({
      id: 3448413,
      name: "Default",
      project_id: 3713224,
    });
    expect(ws.id).toBe(3448413);
    expect(ws.name).toBe("Default");
    expect(ws.project_id).toBe(3713224);
    expect(ws.is_default).toBeNull();
  });

  it("test_construct_full", () => {
    const ws = new MeWorkspaceInfo({
      id: 3448413,
      name: "Default",
      project_id: 3713224,
      is_default: true,
      is_global: false,
      is_restricted: false,
      is_visible: true,
      description: "The default workspace",
      creator_name: "admin",
    });
    expect(ws.is_default).toBe(true);
    expect(ws.is_global).toBe(false);
  });

  it("test_extra_fields_allowed", () => {
    const ws = MeWorkspaceInfo.fromDict({
      id: 1,
      name: "Test",
      project_id: 100,
      new_api_field: "surprise",
    });
    expect(ws.modelExtra).not.toBeNull();
    expect(ws.modelExtra["new_api_field"]).toBe("surprise");
  });
});

describe("TestMeResponse", () => {
  it("test_construct_minimal", () => {
    const me = new MeResponse();
    expect(me.user_id).toBeNull();
    expect(me.user_email).toBeNull();
    expect(me.user_name).toBeNull();
    // Python `== {}` on the empty dicts → empty ordered Maps in TS
    // (B8-MAPFIX ordered-dict containers, user-ratifications.md:14-22).
    expect(me.organizations).toStrictEqual(new Map());
    expect(me.projects).toStrictEqual(new Map());
    expect(me.workspaces).toStrictEqual(new Map());
  });

  it("test_construct_full", () => {
    const me = new MeResponse({
      user_id: 42,
      user_email: "jared@example.com",
      user_name: "Jared",
      organizations: { "100": new MeOrgInfo({ id: 100, name: "Acme" }) },
      projects: {
        "3713224": new MeProjectInfo({ name: "AI Demo", organization_id: 100 }),
      },
      workspaces: {
        "3448413": new MeWorkspaceInfo({
          id: 3448413,
          name: "Default",
          project_id: 3713224,
        }),
      },
    });
    expect(me.user_id).toBe(42);
    expect(me.projects.has("3713224")).toBe(true);
    expect(me.projects.get("3713224")?.name).toBe("AI Demo");
  });

  it("test_extra_fields_allowed", () => {
    const me = MeResponse.fromDict({
      user_id: 1,
      feature_flags: { new_ui: true },
      demo_account: false,
    });
    expect(me.modelExtra).not.toBeNull();
    expect(me.modelExtra["demo_account"]).toBe(false);
  });

  it("test_serialization_round_trip", () => {
    const original = new MeResponse({
      user_id: 42,
      user_email: "test@example.com",
      organizations: {
        "100": new MeOrgInfo({ id: 100, name: "Acme", role: "admin" }),
      },
      projects: {
        "3713224": new MeProjectInfo({
          name: "AI Demo",
          organization_id: 100,
          timezone: "US/Pacific",
        }),
      },
      workspaces: {
        "3448413": new MeWorkspaceInfo({
          id: 3448413,
          name: "Default",
          project_id: 3713224,
          is_default: true,
        }),
      },
    });
    const jsonStr = JSON.stringify(original.toJSON());
    const restored = MeResponse.fromDict(JSON.parse(jsonStr));
    expect(restored.user_id).toBe(original.user_id);
    expect(restored.user_email).toBe(original.user_email);
    expect(restored.projects.get("3713224")?.name).toBe("AI Demo");
    expect(restored.workspaces.get("3448413")?.is_default).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tests/unit/test_workspace_resolution.py::TestSelectWorkspaceId
// ---------------------------------------------------------------------------

/** `_v` helper (:99-105): a WorkspaceView with sensible defaults. */
function v(overrides: Partial<WorkspaceView> & { id: number }): WorkspaceView {
  return {
    name: "v",
    is_global: null,
    is_default: null,
    is_visible: null,
    ...overrides,
  };
}

describe("TestSelectWorkspaceId", () => {
  it("test_empty_is_none", () => {
    expect(selectWorkspaceId([])).toBeNull();
  });

  it("test_global_wins", () => {
    const views = [
      v({ id: 1, is_default: true, name: "All Project Data" }),
      v({ id: 2, is_global: true }),
    ];
    expect(selectWorkspaceId(views)).toBe(2);
  });

  it("test_all_project_data_name_when_no_global", () => {
    const views = [v({ id: 1 }), v({ id: 2, name: "All Project Data" })];
    expect(selectWorkspaceId(views)).toBe(2);
  });

  it("test_default_then_first_visible_then_first", () => {
    expect(
      selectWorkspaceId([v({ id: 1 }), v({ id: 2, is_default: true })]),
    ).toBe(2);
    // no flags: is_visible null counts as visible, so the first is chosen
    expect(selectWorkspaceId([v({ id: 5 }), v({ id: 6 })])).toBe(5);
    // an explicitly invisible first view is skipped for the next visible one
    expect(
      selectWorkspaceId([
        v({ id: 7, is_visible: false }),
        v({ id: 8, is_visible: true }),
      ]),
    ).toBe(8);
    // everything invisible: falls back to the first
    expect(
      selectWorkspaceId([
        v({ id: 9, is_visible: false }),
        v({ id: 10, is_visible: false }),
      ]),
    ).toBe(9);
  });

  it("test_unset_visibility_beats_later_explicit_visible", () => {
    // Guards the `is_visible is not False` rung: a mutation to `is True`
    // would skip the unflagged first view and wrongly pick the second.
    const views = [
      v({ id: 1, is_visible: null }),
      v({ id: 2, is_visible: true }),
    ];
    expect(selectWorkspaceId(views)).toBe(1);
  });
});
