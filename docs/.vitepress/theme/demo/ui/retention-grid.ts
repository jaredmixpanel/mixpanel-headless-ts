// Retention as a cohort × bucket grid shaded by rate. Cells sit on the brand
// color with an alpha that follows the rate; the text switches to white
// above 0.55, and `cellShade` keeps the fill out of the alpha band where
// neither color reaches 4.5:1. A real table with scoped headers and a
// caption, so the grid reads row by row to assistive technology.

import { defineComponent, h, type PropType } from "vue";

import {
  cellShade,
  formatCount,
  formatPct,
  type RetentionGrid,
} from "../model/series.js";

/** Retention grid. */
export default defineComponent({
  name: "DemoRetentionGrid",
  props: {
    grid: { type: Object as PropType<RetentionGrid>, required: true },
  },
  setup(props) {
    return () => {
      const buckets = Math.max(
        ...props.grid.cohorts.map((c) => c.rates.length),
        0,
      );
      return h("table", { class: "mp-retention" }, [
        h(
          "caption",
          { class: "mp-visually-hidden" },
          `Retention by cohort: share of each cohort returning per ${props.grid.unit}, ${props.grid.cohorts.length} cohorts`,
        ),
        h("thead", [
          h("tr", [
            h("th", { scope: "col" }, "Cohort"),
            h("th", { scope: "col", class: "mp-num" }, "Size"),
            ...Array.from({ length: buckets }, (_, i) =>
              h(
                "th",
                { key: i, scope: "col", class: "mp-num" },
                `${props.grid.unit} ${i}`,
              ),
            ),
          ]),
        ]),
        h(
          "tbody",
          props.grid.cohorts.map((cohort) =>
            h("tr", { key: cohort.date }, [
              h("th", { scope: "row" }, cohort.date),
              h("td", { class: "mp-num" }, formatCount(cohort.size)),
              ...cohort.rates.map((rate, i) => {
                const shade = cellShade(rate);
                return h(
                  "td",
                  {
                    key: i,
                    class: [
                      "mp-num",
                      "mp-cell",
                      shade.inverse ? "mp-cell-inverse" : "",
                    ],
                    style: { "--mp-cell-alpha": shade.alpha.toFixed(3) },
                    title: `${cohort.date}, ${props.grid.unit} ${i}: ${formatPct(rate)}`,
                  },
                  formatPct(rate),
                );
              }),
            ]),
          ),
        ),
      ]);
    };
  },
});
