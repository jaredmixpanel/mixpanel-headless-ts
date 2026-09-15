// The result under the workbench: a title line, the visualisation the
// engine calls for (chart, bars or grid), the actions row, then the raw
// rows. The controls that edit the spec live above it (tabs, strip,
// trend-controls, builders); this component only shows what they ran.

import { defineComponent, h, type PropType, type VNode } from "vue";

import type { QuerySpec, TrendMath } from "../model/query-spec.js";
import { funnelBars, retentionGrid, trendSeries } from "../model/series.js";
import type { DemoError } from "../model/session-state.js";
import { ErrorBlock } from "./banners.js";
import BarList from "./bar-list.js";
import LineChart from "./line-chart.js";
import ResultTable from "./result-table.js";
import RetentionGrid from "./retention-grid.js";
import type {
  AnyResult,
  FunnelQueryResult,
  QueryResult,
  RetentionQueryResult,
} from "./use-query.js";

const MATH_LABEL: Readonly<Record<TrendMath, string>> = {
  total: "events",
  unique: "unique users",
  dau: "daily active users",
};

/**
 * The result header, e.g. "Note Saved — total, last 30 days".
 *
 * @param spec - The current spec.
 * @param result - Its result, for the funnel's overall rate.
 * @returns The title text.
 */
function resultTitle(spec: QuerySpec, result: AnyResult | null): string {
  switch (spec.kind) {
    case "trend": {
      const by = spec.groupBy === undefined ? "" : ` by ${spec.groupBy}`;
      const where =
        spec.where === undefined
          ? ""
          : ` where ${spec.where.property} = ${spec.where.value}`;
      return `${spec.event} — ${spec.math}${by}${where}, last ${spec.last} days`;
    }
    case "funnel": {
      const rate =
        result !== null && "overall_conversion_rate" in result
          ? result.overall_conversion_rate
          : null;
      return `${spec.steps.join(" → ")}${rate === null ? "" : ` — ${Math.round(rate * 100)}% overall`}, last ${spec.last} days`;
    }
    case "retention": {
      return `${spec.born} → ${spec.returnEvent}, ${spec.retentionUnit === "week" ? "weekly" : "daily"}, last ${spec.last} days`;
    }
  }
}

/** Result panel. */
export default defineComponent({
  name: "DemoResultPanel",
  props: {
    spec: { type: Object as PropType<QuerySpec | null>, default: null },
    result: { type: Object as PropType<AnyResult | null>, default: null },
    loading: { type: Boolean, default: false },
    error: { type: Object as PropType<DemoError | null>, default: null },
  },
  setup(props, { slots }) {
    const body = (spec: QuerySpec, result: AnyResult): VNode => {
      switch (spec.kind) {
        case "trend": {
          return h(LineChart, {
            series: trendSeries(result as QueryResult),
            unit: MATH_LABEL[spec.math],
            event: spec.event,
            groupBy: spec.groupBy ?? null,
          });
        }
        case "funnel": {
          return h(BarList, { bars: funnelBars(result as FunnelQueryResult) });
        }
        case "retention": {
          return h(RetentionGrid, {
            grid: retentionGrid(result as RetentionQueryResult),
          });
        }
      }
    };

    const skeleton = (): VNode | null =>
      props.loading ? h("div", { class: "mp-skeleton-chart" }) : null;

    return () => {
      const { spec, result } = props;
      if (spec === null) {
        return h("section", { class: "mp-result" }, [
          h("div", { class: "mp-col-head" }, [h("h2", "Result")]),
          props.error === null
            ? h(
                "p",
                { class: "mp-muted" },
                "Pick an event above to run a query.",
              )
            : h(ErrorBlock, { error: props.error }),
        ]);
      }
      return h(
        "section",
        { class: "mp-result", "aria-busy": props.loading ? "true" : "false" },
        [
          h("div", { class: "mp-col-head" }, [h("h2", "Result")]),
          h("p", { class: "mp-result-title" }, resultTitle(spec, result)),
          props.error === null ? null : h(ErrorBlock, { error: props.error }),
          h(
            "div",
            { class: ["mp-result-body", props.loading ? "mp-loading" : ""] },
            [result === null ? skeleton() : body(spec, result)],
          ),
          result === null ? null : slots["actions"]?.(),
          result === null
            ? null
            : h(ResultTable, {
                columns: result.rowColumns(),
                rows: result.toRows(),
              }),
        ],
      );
    };
  },
});
