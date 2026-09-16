// What the multi-query reports' builders share: a capped list of event
// chips (removable, extendable from the event list) and the run button's
// label, which says how many queries a run costs and, while one runs,
// which query is in flight. Plain `h()` helpers rather than a component:
// each builder owns the draft and the layout around them.

import { h, type VNode } from "vue";

import { button, select } from "./el.js";

/** Where a running loop is: `done` of `total` queries settled. */
export interface LoopProgress {
  readonly done: number;
  readonly total: number;
}

/** What the chip editor renders from. */
export interface ChipEditorProps {
  /** The events shown as chips, in order. */
  readonly events: readonly string[];
  /** Events "Add…" may append (current chips excluded). */
  readonly addable: readonly string[];
  /** Chips the list may hold at most; "Add…" disappears at the cap. */
  readonly max: number;
  /** Accessible name of the list. */
  readonly label: string;
  /** Accessible name of the "Add…" select. */
  readonly addLabel: string;
  /** Whether the full event list has been loaded (hides "more events"). */
  readonly complete: boolean;
  readonly onRemove: (event: string) => void;
  readonly onAdd: (event: string) => void;
  readonly onMoreEvents: () => void;
}

const eventOptions = (
  events: readonly string[],
): ReadonlyArray<{ value: string; label: string }> =>
  events.map((event) => ({ value: event, label: event }));

/**
 * Render the chip list with its "Add…" select and the "more events" link.
 *
 * @param props - Chips, cap and handlers.
 * @returns The editor row.
 */
export function chipEditor(props: ChipEditorProps): VNode {
  const chip = (event: string): VNode =>
    h("li", { key: event, class: "mp-chip mp-loop-chip" }, [
      h("span", event),
      button("×", () => props.onRemove(event), {
        class: "mp-btn mp-btn-icon mp-loop-remove",
        "aria-label": `Remove ${event}`,
      }),
    ]);
  const adder = (): VNode | null => {
    if (props.events.length >= props.max) {
      return null;
    }
    return select(eventOptions(props.addable), null, props.onAdd, {
      // Remount after each pick so the placeholder shows again.
      key: props.events.length,
      class: "mp-select mp-step-add",
      placeholder: "+ Add…",
      "aria-label": props.addLabel,
    });
  };
  return h("div", { class: "mp-builder mp-loop-candidates" }, [
    h(
      "ul",
      {
        class: "mp-chips mp-loop-chips",
        role: "list",
        "aria-label": props.label,
      },
      props.events.map((event) => chip(event)),
    ),
    adder(),
    props.complete
      ? null
      : button("more events…", props.onMoreEvents, {
          class: "mp-btn mp-btn-link",
        }),
  ]);
}

/**
 * The run button's label: the query in flight over the total while
 * running ("3 / 9"), otherwise the cost of a run ("Run 9 queries").
 *
 * @param running - Progress while the loop runs; `null` otherwise.
 * @param count - Queries a run would make.
 * @returns The label.
 */
export function runLabel(running: LoopProgress | null, count: number): string {
  if (running !== null) {
    const { done, total } = running;
    return `${String(Math.min(done + 1, total))} / ${String(total)}`;
  }
  return `Run ${String(count)} ${count === 1 ? "query" : "queries"}`;
}
