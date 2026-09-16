// The event strip: what `ws.topEvents()` returned, one chip per event, a
// row or two above the controls. Selecting an event is the playground's
// entry interaction. `topEvents` is Mixpanel's "top events today", so a
// live project can have more events than the strip shows (a trailing
// "More…" chip lists them all, `ws.events()`) or none at all (the empty
// state offers the same list as the way in).

import { defineComponent, h, type PropType, type VNode } from "vue";

import { formatCount, formatPct } from "../model/series.js";
import { button } from "./el.js";

/** One `topEvents` row as the strip shows it. */
export interface EventListItem {
  readonly event: string;
  readonly count: number;
  readonly percentChange: number;
}

/** Top events strip. */
export default defineComponent({
  name: "DemoEventStrip",
  props: {
    events: {
      type: Array as PropType<readonly EventListItem[]>,
      required: true,
    },
    selected: { type: String as PropType<string | null>, default: null },
    loading: { type: Boolean, default: false },
    /** Every event name the project has (`ws.events()`), once loaded. */
    names: { type: Array as PropType<readonly string[] | null>, default: null },
    /** Whether the strip already shows every event (hides "More…"). */
    complete: { type: Boolean, default: false },
  },
  emits: {
    select: (event: string) => typeof event === "string",
    moreEvents: () => true,
  },
  setup(props, { emit }) {
    const chip = (event: string, detail: VNode | null): VNode => {
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
          [h("span", { class: "mp-event-name" }, event), detail],
        ),
      ]);
    };

    const moreChip = (): VNode | null =>
      props.complete || props.names !== null
        ? null
        : h("li", { key: "more" }, [
            button("More…", () => emit("moreEvents"), {
              class: "mp-event mp-event-more",
              "aria-label": "List all events",
            }),
          ]);

    // The rest of the project's events, once "More…" has loaded them.
    const allEvents = (): VNode | null => {
      if (props.names === null) {
        return null;
      }
      const shown = new Set(props.events.map((e) => e.event));
      const rest = props.names.filter((name) => !shown.has(name));
      if (rest.length === 0) {
        return props.events.length === 0
          ? h("p", { class: "mp-muted" }, "This project has no events yet.")
          : null;
      }
      return h(
        "ul",
        {
          class: "mp-events mp-events-all",
          role: "list",
          "aria-label": "All events",
        },
        rest.map((name) => chip(name, null)),
      );
    };

    const empty = (): VNode =>
      h("div", { class: "mp-empty" }, [
        h("p", { class: "mp-muted" }, [
          "No events today for this project (",
          h("code", "topEvents"),
          " lists today's activity). Pick another project, or choose from every event the project has seen.",
        ]),
        props.names === null
          ? button("List all events", () => emit("moreEvents"), {
              class: "mp-btn mp-btn-small",
            })
          : allEvents(),
      ]);

    const meta = (entry: EventListItem): VNode =>
      h("span", { class: "mp-event-meta" }, [
        h("span", { class: "mp-num" }, formatCount(entry.count)),
        h(
          "span",
          { class: entry.percentChange >= 0 ? "mp-up" : "mp-down" },
          ` ${entry.percentChange >= 0 ? "▲" : "▼"}${formatPct(Math.abs(entry.percentChange))}`,
        ),
      ]);

    return () => {
      if (props.loading) {
        return h(
          "ul",
          { class: "mp-events", role: "list", "aria-busy": "true" },
          Array.from({ length: 6 }, (_, i) =>
            h("li", { key: i, class: "mp-skeleton-chip" }),
          ),
        );
      }
      if (props.events.length === 0) {
        return empty();
      }
      return h("div", { class: "mp-event-strip" }, [
        h(
          "ul",
          { class: "mp-events", role: "list", "aria-label": "Top events" },
          [
            ...props.events.map((entry) => chip(entry.event, meta(entry))),
            moreChip(),
          ],
        ),
        allEvents(),
      ]);
    };
  },
});
