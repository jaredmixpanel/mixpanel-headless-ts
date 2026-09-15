// Retention as a cohort × bucket grid shaded by rate. Cells sit on the brand
// blue with an alpha that follows the rate; above 0.55 the text switches to
// white so the contrast stays at or above 4.5:1 in both colour schemes.

import { defineComponent, h, type PropType } from "vue";

import { formatCount, formatPct, type RetentionGrid } from "../model/series.js";

const WHITE_TEXT_ABOVE = 0.55;

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
        h("thead", [
          h("tr", [
            h("th", "Cohort"),
            h("th", { class: "mp-num" }, "Size"),
            ...Array.from({ length: buckets }, (_, i) =>
              h("th", { key: i, class: "mp-num" }, `${props.grid.unit} ${i}`),
            ),
          ]),
        ]),
        h(
          "tbody",
          props.grid.cohorts.map((cohort) =>
            h("tr", { key: cohort.date }, [
              h("th", { scope: "row" }, cohort.date),
              h("td", { class: "mp-num" }, formatCount(cohort.size)),
              ...cohort.rates.map((rate, i) =>
                h(
                  "td",
                  {
                    key: i,
                    class: [
                      "mp-num",
                      "mp-cell",
                      rate > WHITE_TEXT_ABOVE ? "mp-cell-inverse" : "",
                    ],
                    style: {
                      "--mp-cell-alpha": String(Math.min(Math.max(rate, 0), 1)),
                    },
                    title: `${cohort.date}, ${props.grid.unit} ${i}: ${formatPct(rate)}`,
                  },
                  formatPct(rate),
                ),
              ),
            ]),
          ),
        ),
      ]);
    };
  },
});
