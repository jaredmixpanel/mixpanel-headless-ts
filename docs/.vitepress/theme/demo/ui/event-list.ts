// The left column's event list: what `ws.topEvents()` returned, one button
// per event. Selecting an event is the playground's entry interaction.
// `topEvents` is Mixpanel's "top events today", so a quiet project can
// return nothing at all; the empty state then offers the project's full
// event list (`ws.events()`) as the way in.

import { defineComponent, h, type PropType, type VNode } from "vue";

import { formatCount, formatPct } from "../model/series.js";
import { button } from "./el.js";

/** One `topEvents` row as the list shows it. */
export interface EventListItem {
  readonly event: string;
  readonly count: number;
  readonly percentChange: number;
}

/** Top events list. */
export default defineComponent({
  name: "DemoEventList",
  props: {
    events: {
      type: Array as PropType<readonly EventListItem[]>,
      required: true,
    },
    selected: { type: String as PropType<string | null>, default: null },
    loading: { type: Boolean, default: false },
    /** Every event name the project has (`ws.events()`), once loaded. */
    names: { type: Array as PropType<readonly string[] | null>, default: null },
  },
  emits: {
    select: (event: string) => typeof event === "string",
    moreEvents: () => true,
  },
  setup(props, { emit }) {
    const item = (event: string, meta: VNode | null): VNode => {
      const active = event === props.selected;
      return h("li", { key: event }, [
        h(
          "button",
          {
            type: "button",
            class: ["mp-event", active ? "mp-event-active" : ""],
            "aria-pressed": active,
            onClick: () => emit("select", event),
          },
          [h("span", { class: "mp-event-name" }, event), meta],
        ),
      ]);
    };

    const allEvents = (): VNode => {
      if (props.names === null) {
        return button("List all events", () => emit("moreEvents"), {
          class: "mp-btn mp-btn-small",
        });
      }
      if (props.names.length === 0) {
        return h("p", { class: "mp-muted" }, "This project has no events yet.");
      }
      return h(
        "ul",
        { class: "mp-events", role: "list", "aria-label": "All events" },
        props.names.map((name) => item(name, null)),
      );
    };

    const empty = (): VNode =>
      h("div", { class: "mp-empty" }, [
        h("p", { class: "mp-muted" }, [
          "No events today for this project (",
          h("code", "topEvents"),
          " lists today's activity). Pick another project, or choose from every event the project has seen.",
        ]),
        allEvents(),
      ]);

    return () => {
      if (props.loading) {
        return h(
          "ul",
          { class: "mp-events", role: "list", "aria-busy": "true" },
          Array.from({ length: 6 }, (_, i) =>
            h("li", { key: i, class: "mp-skeleton-row" }),
          ),
        );
      }
      if (props.events.length === 0) {
        return empty();
      }
      return h(
        "ul",
        { class: "mp-events", role: "list", "aria-label": "Top events" },
        props.events.map((entry) => {
          const trend = entry.percentChange >= 0 ? "▲" : "▼";
          return item(
            entry.event,
            h("span", { class: "mp-event-meta" }, [
              h("span", { class: "mp-num" }, formatCount(entry.count)),
              h(
                "span",
                { class: entry.percentChange >= 0 ? "mp-up" : "mp-down" },
                ` ${trend}${formatPct(Math.abs(entry.percentChange))}`,
              ),
            ]),
          );
        }),
      );
    };
  },
});
