// The ranking report's builder: the born event, the candidate chips (seeded
// from the top events, removable, extendable from the full event list) and
// the unit, then a run button that says how many queries it costs. The
// draft is the playground's (it also feeds the empty state and the "range
// changed" hint), so the builder edits it through `update` and never keeps
// state of its own.

import { defineComponent, h, type PropType, type VNode } from "vue";

import { MAX_CANDIDATES } from "../model/aha.js";
import { RETENTION_UNITS, type RetentionUnit } from "../model/query-spec.js";
import { button, field, segmented, select } from "./el.js";
import { chipEditor, type LoopProgress, runLabel } from "./loop-builder.js";

/** What the builder edits: the spec without the shared time range. */
export interface AhaDraft {
  readonly born: string;
  readonly candidates: readonly string[];
  readonly retentionUnit: RetentionUnit;
}

const CANDIDATE_HINT = `Up to ${String(MAX_CANDIDATES)} candidates, seeded from today's top events; each candidate is one retention query.`;

const eventOptions = (
  events: readonly string[],
): ReadonlyArray<{ value: string; label: string }> =>
  events.map((event) => ({ value: event, label: event }));

/** Ranking report builder. */
export default defineComponent({
  name: "DemoAhaBuilder",
  props: {
    draft: { type: Object as PropType<AhaDraft>, required: true },
    /** Events offered as the born event. */
    bornEvents: { type: Array as PropType<readonly string[]>, required: true },
    /** Events "Add…" may append (the born event and current candidates excluded). */
    addable: { type: Array as PropType<readonly string[]>, required: true },
    /** Whether the full event list has been loaded (hides "more events"). */
    complete: { type: Boolean, default: false },
    /** Progress while the loop runs; `null` otherwise. */
    running: { type: Object as PropType<LoopProgress | null>, default: null },
    /** Why the run button is disabled, or `null` when it is not. */
    blocked: { type: String as PropType<string | null>, default: null },
    /** Whether the shown result ran under another time range. */
    stale: { type: Boolean, default: false },
  },
  emits: {
    update: (draft: AhaDraft) => draft.born !== "",
    run: () => true,
    moreEvents: () => true,
  },
  setup(props, { emit }) {
    const update = (changes: Partial<AhaDraft>): void =>
      emit("update", { ...props.draft, ...changes });
    const remove = (event: string): void =>
      update({
        candidates: props.draft.candidates.filter((c) => c !== event),
      });
    const add = (event: string): void => {
      if (props.draft.candidates.length < MAX_CANDIDATES) {
        update({ candidates: [...props.draft.candidates, event] });
      }
    };

    return (): VNode =>
      h("div", { class: "mp-loop-builder" }, [
        h("div", { class: "mp-builder" }, [
          field(
            "Born",
            select(eventOptions(props.bornEvents), props.draft.born, (born) =>
              update({ born }),
            ),
            { class: "mp-field mp-field-inline" },
          ),
          segmented(
            RETENTION_UNITS.map((u) => ({ value: u, label: u })),
            props.draft.retentionUnit,
            (retentionUnit) => update({ retentionUnit }),
            "Retention unit",
          ),
        ]),
        chipEditor({
          events: props.draft.candidates,
          addable: props.addable,
          max: MAX_CANDIDATES,
          label: "Candidate events",
          addLabel: "Add candidate",
          complete: props.complete,
          onRemove: remove,
          onAdd: add,
          onMoreEvents: () => emit("moreEvents"),
        }),
        h("p", { class: "mp-muted mp-loop-hint" }, CANDIDATE_HINT),
        h("div", { class: "mp-builder" }, [
          button(
            runLabel(props.running, props.draft.candidates.length),
            () => emit("run"),
            {
              class: "mp-btn mp-btn-brand",
              disabled:
                props.running !== null ||
                props.blocked !== null ||
                props.draft.candidates.length === 0,
              "aria-busy": props.running === null ? "false" : "true",
              title: props.blocked ?? undefined,
            },
          ),
          props.stale
            ? h(
                "span",
                { class: "mp-muted", role: "status" },
                "The time range changed since this ran; run again to update.",
              )
            : null,
        ]),
      ]);
  },
});
