// The left column's event list: what `ws.topEvents()` returned, one button
// per event. Selecting an event is the playground's entry interaction.

import { defineComponent, h, type PropType } from "vue";

import { formatCount, formatPct } from "../model/series.js";

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
  },
  emits: { select: (event: string) => typeof event === "string" },
  setup(props, { emit }) {
    return () => {
      if (props.loading) {
        return h(
          "ul",
          { class: "mp-events", "aria-busy": "true" },
          Array.from({ length: 6 }, (_, i) =>
            h("li", { key: i, class: "mp-skeleton-row" }),
          ),
        );
      }
      if (props.events.length === 0) {
        return h("p", { class: "mp-muted" }, "No events in this range.");
      }
      return h(
        "ul",
        { class: "mp-events" },
        props.events.map((item) => {
          const active = item.event === props.selected;
          const trend = item.percentChange >= 0 ? "▲" : "▼";
          return h("li", { key: item.event }, [
            h(
              "button",
              {
                type: "button",
                class: ["mp-event", active ? "mp-event-active" : ""],
                "aria-pressed": active,
                onClick: () => emit("select", item.event),
              },
              [
                h("span", { class: "mp-event-name" }, item.event),
                h("span", { class: "mp-event-meta" }, [
                  h("span", { class: "mp-num" }, formatCount(item.count)),
                  h(
                    "span",
                    { class: item.percentChange >= 0 ? "mp-up" : "mp-down" },
                    ` ${trend}${formatPct(Math.abs(item.percentChange))}`,
                  ),
                ]),
              ],
            ),
          ]);
        }),
      );
    };
  },
});
