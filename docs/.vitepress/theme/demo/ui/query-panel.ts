// The middle column: the controls that edit the current spec (math, time
// range, breakdown) and the result they produced — chart, bars or grid,
// then the raw rows. Every control emits; the playground rebuilds the spec
// and runs it, so this component never touches the facade.

import { defineComponent, h, type PropType, type VNode } from "vue";

import {
  type QuerySpec,
  TIME_RANGES,
  type TimeRange,
  TREND_MATHS,
  type TrendMath,
} from "../model/query-spec.js";
import { funnelBars, retentionGrid, trendSeries } from "../model/series.js";
import type { DemoError } from "../model/session-state.js";
import { ErrorBlock } from "./banners.js";
import BarList from "./bar-list.js";
import { button, segmented, select } from "./el.js";
import LineChart from "./line-chart.js";
import ResultTable from "./result-table.js";
import RetentionGrid from "./retention-grid.js";
import type {
  AnyResult,
  FunnelQueryResult,
  PropertyValues,
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
      return `${spec.event} — ${spec.math}${spec.groupBy === undefined ? "" : ` by ${spec.groupBy}`}, last ${spec.last} days`;
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

/** Query panel. */
export default defineComponent({
  name: "DemoQueryPanel",
  props: {
    spec: { type: Object as PropType<QuerySpec | null>, default: null },
    result: { type: Object as PropType<AnyResult | null>, default: null },
    loading: { type: Boolean, default: false },
    error: { type: Object as PropType<DemoError | null>, default: null },
    properties: {
      type: Array as PropType<readonly string[] | null>,
      default: null,
    },
    values: { type: Object as PropType<PropertyValues | null>, default: null },
  },
  emits: {
    math: (math: TrendMath) => typeof math === "string",
    range: (last: TimeRange) => typeof last === "number",
    breakdownOpen: () => true,
    groupBy: (property: string | null) => property === null || property !== "",
    values: (property: string) => property !== "",
  },
  setup(props, { emit, slots }) {
    const trendControls = (spec: QuerySpec & { kind: "trend" }): VNode =>
      h("div", { class: "mp-controls" }, [
        segmented(
          TREND_MATHS.map((m) => ({ value: m, label: m })),
          spec.math,
          (m) => emit("math", m),
          "Math",
        ),
        props.properties === null
          ? button("Break down by…", () => emit("breakdownOpen"), {
              class: "mp-btn mp-btn-small",
            })
          : h("label", { class: "mp-field" }, [
              h("span", { class: "mp-field-caption" }, "Break down by"),
              select(
                [
                  { value: "", label: "—" },
                  ...props.properties.map((p) => ({ value: p, label: p })),
                ],
                spec.groupBy ?? "",
                (p) => emit("groupBy", p === "" ? null : p),
              ),
            ]),
        spec.groupBy === undefined
          ? null
          : button(
              `values of ${spec.groupBy}`,
              () => emit("values", spec.groupBy ?? ""),
              { class: "mp-btn mp-btn-small" },
            ),
      ]);

    const chips = (): VNode | null =>
      props.values === null
        ? null
        : h(
            "div",
            {
              class: "mp-chips",
              "aria-label": `Values of ${props.values.property}`,
            },
            [
              ...props.values.values.map((v) =>
                h("span", { key: v, class: "mp-chip" }, v),
              ),
              h(
                "span",
                { class: "mp-muted" },
                " (informational — filters arrive later)",
              ),
            ],
          );

    const body = (spec: QuerySpec, result: AnyResult): VNode => {
      switch (spec.kind) {
        case "trend": {
          return h(LineChart, {
            series: trendSeries(result as QueryResult),
            unit: MATH_LABEL[spec.math],
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
                "Pick an event on the left to run a query.",
              )
            : h(ErrorBlock, { error: props.error }),
        ]);
      }
      return h(
        "section",
        { class: "mp-result", "aria-busy": props.loading ? "true" : "false" },
        [
          h("div", { class: "mp-col-head" }, [
            h("h2", "Result"),
            segmented(
              TIME_RANGES.map((n) => ({ value: n, label: `${n}d` })),
              spec.last,
              (n) => emit("range", n),
              "Time range",
            ),
          ]),
          h("p", { class: "mp-result-title" }, resultTitle(spec, result)),
          spec.kind === "trend" ? trendControls(spec) : null,
          chips(),
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
