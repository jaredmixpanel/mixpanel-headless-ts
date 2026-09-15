// Funnel result as horizontal bars: the bar width is the overall conversion
// ratio, the label the step-to-step one, so a drop between adjacent steps
// is visible at a glance. `role="list"` is explicit because the theme
// removes the list markers, which makes some screen readers drop the
// list semantics with them.

import { defineComponent, h, type PropType } from "vue";

import { formatCount, formatPct, type FunnelBar } from "../model/series.js";

/** Funnel bars. */
export default defineComponent({
  name: "DemoBarList",
  props: {
    bars: { type: Array as PropType<readonly FunnelBar[]>, required: true },
  },
  setup(props) {
    return () =>
      h(
        "ol",
        {
          class: "mp-bars",
          role: "list",
          "aria-label": `Funnel, ${props.bars.length} steps`,
        },
        props.bars.map((bar, i) =>
          h("li", { key: `${i}-${bar.event}`, class: "mp-bar-row" }, [
            h("div", { class: "mp-bar-head" }, [
              h("span", { class: "mp-bar-step" }, `${i + 1}. ${bar.event}`),
              h("span", { class: "mp-bar-count" }, formatCount(bar.count)),
            ]),
            h(
              "div",
              {
                class: "mp-bar-track",
                role: "meter",
                "aria-valuemin": 0,
                "aria-valuemax": 100,
                "aria-valuenow": Math.round(bar.overallRatio * 100),
                "aria-label": `${bar.event}: ${formatPct(bar.overallRatio)} of step 1`,
              },
              [
                h("div", {
                  class: "mp-bar-fill",
                  style: { width: `${Math.max(bar.overallRatio * 100, 0.5)}%` },
                }),
              ],
            ),
            h(
              "div",
              { class: "mp-bar-meta" },
              i === 0
                ? `${formatPct(bar.overallRatio)} overall`
                : `${formatPct(bar.stepRatio)} from step ${i} · ${formatPct(bar.overallRatio)} overall`,
            ),
          ]),
        ),
      );
  },
});
