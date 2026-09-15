// The project picker shown after sign-in: `/me`'s projects grouped by
// organisation, each with its workspaces (default preselected), and one
// "Use" button per project that becomes `ws.use({ project, workspace })`.

import { defineComponent, h, type PropType, ref, type VNode } from "vue";

import {
  defaultWorkspace,
  groupProjects,
  type Me,
  type PickedProject,
  type PickedWorkspace,
  type PickerProject,
} from "../model/session-state.js";
import { button, select } from "./el.js";

/** Project picker. */
export default defineComponent({
  name: "DemoProjectPicker",
  props: {
    me: { type: Object as PropType<Me>, required: true },
    busy: { type: Boolean, default: false },
  },
  emits: {
    pick: (project: PickedProject, workspace: PickedWorkspace | null) =>
      typeof project.id === "string" &&
      (workspace === null || typeof workspace.id === "number"),
    signOut: () => true,
    back: () => true,
  },
  setup(props, { emit }) {
    const groups = groupProjects(props.me);
    // Workspace choice per project id; unset means the default.
    const chosen = ref<Record<string, number>>({});

    const workspaceOf = (project: PickerProject): PickedWorkspace | null => {
      const id = chosen.value[project.id];
      return (
        project.workspaces.find((w) => w.id === id) ??
        defaultWorkspace(project.workspaces)
      );
    };

    const row = (project: PickerProject): VNode => {
      const workspace = workspaceOf(project);
      return h("li", { class: "mp-picker-project" }, [
        h("div", { class: "mp-picker-name" }, [
          h("strong", project.name),
          h("span", { class: "mp-muted" }, ` · ${project.id}`),
        ]),
        project.workspaces.length > 1
          ? select(
              project.workspaces.map((w) => ({
                value: w.id,
                label: w.isDefault ? `${w.name} (default)` : w.name,
              })),
              workspace?.id ?? null,
              (id) => {
                chosen.value = { ...chosen.value, [project.id]: id };
              },
              { "aria-label": `Workspace for ${project.name}` },
            )
          : h(
              "span",
              { class: "mp-muted" },
              workspace === null ? "no workspaces" : workspace.name,
            ),
        button(
          "Use",
          () => {
            const { id, name, organization } = project;
            emit("pick", { id, name, organization }, workspace);
          },
          { class: "mp-btn mp-btn-brand", disabled: props.busy },
        ),
      ]);
    };

    return () =>
      h("section", { class: "mp-intro mp-picker" }, [
        h("p", [
          "Signed in as ",
          h("em", props.me.user_email ?? "unknown user"),
          ". Pick a project (and a workspace if the project has several). Only read-only calls are made.",
        ]),
        groups.length === 0
          ? h(
              "p",
              { class: "mp-muted" },
              "This account has no projects the page can list.",
            )
          : groups.map((group) =>
              h("div", { class: "mp-picker-org" }, [
                h("h3", group.organization),
                h(
                  "ul",
                  group.projects.map((project) => row(project)),
                ),
              ]),
            ),
        h("div", { class: "mp-intro-actions" }, [
          button("Sign out", () => emit("signOut")),
          button("Back to demo", () => emit("back")),
        ]),
      ]);
  },
});
