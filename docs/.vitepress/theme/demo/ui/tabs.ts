// The engine tabs over the workbench: which builder the panel below shows.
// A real tablist — roving tabindex, Left/Right/Home/End move the selection
// and focus together — with the shared time range on the same row, since
// `last` applies to every engine.

import { defineComponent, h, type PropType, type VNode } from "vue";

import { TIME_RANGES, type TimeRange } from "../model/query-spec.js";
import { segmented } from "./el.js";

/** The query engines the playground offers, in tab order. */
export const ENGINES = ["trend", "funnel", "retention"] as const;

/** Member of {@link ENGINES}. */
export type Engine = (typeof ENGINES)[number];

const LABEL: Readonly<Record<Engine, string>> = {
  trend: "Trend",
  funnel: "Funnel",
  retention: "Retention",
};

/**
 * The id of an engine's tab button (`aria-labelledby` of its panel).
 *
 * @param engine - The engine.
 * @returns The element id.
 */
export const tabId = (engine: Engine): string => `mp-tab-${engine}`;

/**
 * The id of an engine's tab panel (`aria-controls` of its tab).
 *
 * @param engine - The engine.
 * @returns The element id.
 */
export const panelId = (engine: Engine): string => `mp-panel-${engine}`;

/**
 * The engine a navigation key moves to, or `null` for any other key.
 *
 * @param key - `KeyboardEvent.key`.
 * @param current - The selected engine.
 * @returns The next engine, wrapping at both ends.
 */
function nextEngine(key: string, current: Engine): Engine | null {
  const index = ENGINES.indexOf(current);
  const last = ENGINES.length - 1;
  switch (key) {
    case "ArrowRight": {
      return ENGINES[index === last ? 0 : index + 1] ?? null;
    }
    case "ArrowLeft": {
      return ENGINES[index === 0 ? last : index - 1] ?? null;
    }
    case "Home": {
      return ENGINES[0];
    }
    case "End": {
      return ENGINES[last] ?? null;
    }
    default: {
      return null;
    }
  }
}

/** Engine tabs with the time range. */
export default defineComponent({
  name: "DemoEngineTabs",
  props: {
    engine: { type: String as PropType<Engine>, required: true },
    last: { type: Number as PropType<TimeRange>, required: true },
  },
  emits: {
    select: (engine: Engine) => ENGINES.includes(engine),
    range: (last: TimeRange) => typeof last === "number",
  },
  setup(props, { emit }) {
    const onKeydown = (event: KeyboardEvent): void => {
      const next = nextEngine(event.key, props.engine);
      if (next === null) {
        return;
      }
      event.preventDefault();
      emit("select", next);
      document.querySelector<HTMLElement>(`#${tabId(next)}`)?.focus();
    };
    const tab = (engine: Engine): VNode =>
      h(
        "button",
        {
          key: engine,
          type: "button",
          role: "tab",
          id: tabId(engine),
          class: "mp-tab",
          "aria-selected": engine === props.engine,
          "aria-controls": panelId(engine),
          tabindex: engine === props.engine ? 0 : -1,
          onClick: () => emit("select", engine),
          onKeydown,
        },
        LABEL[engine],
      );
    return () =>
      h("div", { class: "mp-tabbar" }, [
        h(
          "div",
          { class: "mp-tabs", role: "tablist", "aria-label": "Query engine" },
          ENGINES.map((engine) => tab(engine)),
        ),
        segmented(
          TIME_RANGES.map((n) => ({ value: n, label: `${n}d` })),
          props.last,
          (n) => emit("range", n),
          "Time range",
        ),
      ]);
  },
});
