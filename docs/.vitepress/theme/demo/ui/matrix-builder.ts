// The conversion matrix's builder: the event pool as chips (seeded from the
// top events, removable, extendable from the event list, capped so a run
// stays within the Query API's hourly allowance), the conversion window,
// then a run button that says how many funnel queries the pool costs. Like
// the ranking report's, the draft is the playground's: the builder edits
// it through `update` and keeps no state of its own.

import { defineComponent, h, type PropType, type VNode } from "vue";

import { MAX_POOL, MIN_POOL, orderedPairs } from "../model/matrix.js";
import {
  CONVERSION_WINDOWS,
  type ConversionWindow,
} from "../model/query-spec.js";
import { button, segmented } from "./el.js";
import { chipEditor, type LoopProgress, runLabel } from "./loop-builder.js";

/** What the builder edits: the spec without the shared time range. */
export interface MatrixDraft {
  readonly events: readonly string[];
  readonly conversionWindow: ConversionWindow;
}

const POOL_HINT = `Up to ${String(MAX_POOL)} events: every ordered pair is one funnel query (n × (n − 1)).`;

/** Conversion matrix builder. */
export default defineComponent({
  name: "DemoMatrixBuilder",
  props: {
    draft: { type: Object as PropType<MatrixDraft>, required: true },
    /** Events "Add…" may append (current pool excluded). */
    addable: { type: Array as PropType<readonly string[]>, required: true },
    /** Whether the full event list has been loaded (hides "more events"). */
    complete: { type: Boolean, default: false },
    /** Progress while the loop runs; `null` otherwise. */
    running: { type: Object as PropType<LoopProgress | null>, default: null },
    /** Whether the shown result ran under another time range. */
    stale: { type: Boolean, default: false },
  },
  emits: {
    update: (draft: MatrixDraft) => draft.events.length <= MAX_POOL,
    run: () => true,
    moreEvents: () => true,
  },
  setup(props, { emit }) {
    const update = (changes: Partial<MatrixDraft>): void =>
      emit("update", { ...props.draft, ...changes });
    const remove = (event: string): void =>
      update({ events: props.draft.events.filter((e) => e !== event) });
    const add = (event: string): void => {
      if (props.draft.events.length < MAX_POOL) {
        update({ events: [...props.draft.events, event] });
      }
    };

    return (): VNode => {
      const queries = orderedPairs(props.draft.events).length;
      const tooFew = props.draft.events.length < MIN_POOL;
      return h("div", { class: "mp-loop-builder" }, [
        chipEditor({
          events: props.draft.events,
          addable: props.addable,
          max: MAX_POOL,
          label: "Event pool",
          addLabel: "Add event",
          complete: props.complete,
          onRemove: remove,
          onAdd: add,
          onMoreEvents: () => emit("moreEvents"),
        }),
        h("p", { class: "mp-muted mp-loop-hint" }, POOL_HINT),
        h("div", { class: "mp-builder" }, [
          segmented(
            CONVERSION_WINDOWS.map((n) => ({
              value: n,
              label: `${String(n)}d`,
            })),
            props.draft.conversionWindow,
            (conversionWindow) => update({ conversionWindow }),
            "Conversion window (days)",
          ),
          button(runLabel(props.running, queries), () => emit("run"), {
            class: "mp-btn mp-btn-brand",
            disabled: props.running !== null || tooFew,
            "aria-busy": props.running === null ? "false" : "true",
            title: tooFew
              ? `Add at least ${String(MIN_POOL)} events.`
              : undefined,
          }),
          props.stale
            ? h(
                "span",
                { class: "mp-muted", role: "status" },
                "The time range changed since this ran; run again to update.",
              )
            : null,
        ]),
      ]);
    };
  },
});
