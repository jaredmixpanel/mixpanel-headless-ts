// The wait between sign-in and the project picker: a card the shape of the
// picker to come, the run indicator across its top, a heading that names
// the step in flight, and a skeleton of the list that will replace it. One
// `/me` request lists every project and workspace an account can see, so
// for accounts with hundreds it runs for many seconds; the card says so
// once the wait is long enough to need saying, and again when it is long
// enough to look stuck. The timers belong to the component, so a phase
// change or an unmount cannot leave a stale line behind.

import {
  defineComponent,
  h,
  onBeforeUnmount,
  type PropType,
  ref,
  type VNode,
  watch,
} from "vue";

import LoadingBar from "./loading-bar.js";

/** The step the sign-in is at while the card shows. */
export type SignInPhase = "sign-in" | "projects";

const HEADING: Readonly<Record<SignInPhase, string>> = {
  "sign-in": "Completing sign-in…",
  projects: "Loading your projects…",
};

/** How long the project list may take before the card explains the wait. */
const PATIENCE_AFTER_MS = 4_000;
/** How long before the card confirms it is still waiting on the request. */
const STILL_WORKING_AFTER_MS = 15_000;

const PATIENCE_LINE =
  "Accounts with many projects take longer: one request lists every project and workspace you can see.";
/** The patience line per level: nothing, the explanation, then it plus a nudge. */
const NOTE: Readonly<Record<0 | 1 | 2, string>> = {
  0: "",
  1: PATIENCE_LINE,
  2: `${PATIENCE_LINE} Still working.`,
};

/**
 * Skeleton bar widths per project row, so the placeholder reads as a list
 * of different names rather than a grid.
 */
const ROW_WIDTHS: ReadonlyArray<readonly [name: string, workspace: string]> = [
  ["46%", "22%"],
  ["34%", "18%"],
  ["58%", "24%"],
  ["40%", "16%"],
  ["52%", "20%"],
];
/** Rows under the first and the second organization header. */
const ROWS_PER_ORG: readonly number[] = [3, 2];

/** Sign-in loading card. */
export default defineComponent({
  name: "DemoLoadingCard",
  props: {
    /** The step in flight; the heading names it. */
    phase: { type: String as PropType<SignInPhase>, required: true },
  },
  setup(props) {
    // 0: nothing yet; 1: the explanation; 2: the explanation plus "still
    // working". Only the project list is ever slow enough to earn either.
    const patience = ref<0 | 1 | 2>(0);
    let timers: Array<ReturnType<typeof setTimeout>> = [];
    const clearTimers = (): void => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers = [];
    };
    watch(
      () => props.phase,
      (phase) => {
        clearTimers();
        patience.value = 0;
        if (phase === "projects") {
          timers = [
            setTimeout(() => {
              patience.value = 1;
            }, PATIENCE_AFTER_MS),
            setTimeout(() => {
              patience.value = 2;
            }, STILL_WORKING_AFTER_MS),
          ];
        }
      },
      { immediate: true },
    );
    onBeforeUnmount(clearTimers);

    const skeletonRow = ([name, workspace]: readonly [string, string]): VNode =>
      h("li", { class: "mp-skeleton-row" }, [
        h("span", { class: "mp-skeleton-bar", style: { width: name } }),
        h("span", { class: "mp-skeleton-bar", style: { width: workspace } }),
      ]);
    const skeleton = (): VNode => {
      let next = 0;
      return h(
        "div",
        { class: "mp-skeleton-picker", "aria-hidden": "true" },
        ROWS_PER_ORG.map((count) =>
          h("div", { class: "mp-picker-org" }, [
            h("span", { class: "mp-skeleton-bar mp-skeleton-org" }),
            h(
              "ul",
              ROW_WIDTHS.slice(next, (next += count)).map((widths) =>
                skeletonRow(widths),
              ),
            ),
          ]),
        ),
      );
    };

    return (): VNode => {
      const note = NOTE[patience.value];
      return h(
        "section",
        {
          class: "mp-intro mp-picker mp-loading-card",
          "aria-busy": "true",
        },
        [
          h("div", { class: "mp-picker-head" }, [
            h("h2", "Signing in"),
            h(LoadingBar, { active: true, label: null }),
          ]),
          h(
            "p",
            {
              class: "mp-loading-title",
              role: "status",
              "aria-live": "polite",
            },
            HEADING[props.phase],
          ),
          // Mounted empty so assistive technology announces the text when
          // it arrives rather than a freshly inserted node.
          h(
            "p",
            {
              class: [
                "mp-loading-note",
                { "mp-loading-note-shown": note !== "" },
              ],
              role: "status",
              "aria-live": "polite",
            },
            note,
          ),
          skeleton(),
        ],
      );
    };
  },
});
