// The result under the workbench: a title line, the visualisation the
// engine calls for (chart, bars, grid, ranked list or heatmap), the actions
// row, then the raw rows. The controls that edit the spec live above it (tabs,
// strip, trend-controls, builders); this component only shows what they
// ran.

import { defineComponent, h, type PropType, type VNode } from "vue";

import type { MatrixPair } from "../model/matrix.js";
import type { ConversionWindow, TrendMath } from "../model/query-spec.js";
import { funnelBars, retentionGrid, trendSeries } from "../model/series.js";
import type { DemoError } from "../model/session-state.js";
import AhaResult from "./aha-result.js";
import { ErrorBlock } from "./banners.js";
import BarList from "./bar-list.js";
import LineChart from "./line-chart.js";
import MatrixResult, { type SweepPoint } from "./matrix-result.js";
import ResultTable from "./result-table.js";
import RetentionGrid from "./retention-grid.js";
import {
  type AnyResult,
  type AnySpec,
  type CallOutcome,
  type EngineKind,
  type FunnelQueryResult,
  isLoopSpec,
  type QueryResult,
  type RetentionQueryResult,
} from "./use-query.js";

const MATH_LABEL: Readonly<Record<TrendMath, string>> = {
  total: "events",
  unique: "unique users",
  dau: "daily active users",
};

/** What stands in for the result before an engine's first run. */
const EMPTY: Readonly<Record<EngineKind, string>> = {
  trend: "Pick an event above to run a query.",
  funnel: "Add two or more steps and run the funnel.",
  retention: "Pick a born and a return event, then run.",
  aha: "Which early behaviour predicts retention? Mixpanel has no report for this: it takes one retention query per candidate and a ranking, which is a loop.",
  matrix:
    "Which events lead where? Funnels shows one path at a time; a conversion matrix takes one funnel query per ordered pair, which is a loop.",
};

/**
 * The result header, e.g. "Note Saved — total, last 30 days".
 *
 * @param spec - The current spec.
 * @param result - Its result, for the funnel's overall rate.
 * @returns The title text.
 */
function resultTitle(spec: AnySpec, result: AnyResult | null): string {
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
    case "aha": {
      return `Behaviours that predict retention after ${spec.born}`;
    }
    case "matrix": {
      return `Conversion between ${String(spec.events.length)} events, ${String(spec.conversionWindow)}-day window, last ${String(spec.last)} days`;
    }
  }
}

/** Result panel. */
export default defineComponent({
  name: "DemoResultPanel",
  props: {
    /** The engine on show; picks the empty state while `spec` is `null`. */
    engine: { type: String as PropType<EngineKind>, required: true },
    spec: { type: Object as PropType<AnySpec | null>, default: null },
    result: { type: Object as PropType<AnyResult | null>, default: null },
    /** The shown run's outcomes; the ranking report draws from these. */
    outcomes: {
      type: Array as PropType<readonly CallOutcome[]>,
      default: () => [],
    },
    loading: { type: Boolean, default: false },
    error: { type: Object as PropType<DemoError | null>, default: null },
    /**
     * Replaces the ranking report's empty-state copy while its draft
     * cannot run (a range too short for the unit).
     */
    blocked: { type: String as PropType<string | null>, default: null },
    /** The matrix cell open in its side panel, or `null`. */
    selectedPair: {
      type: Object as PropType<MatrixPair | null>,
      default: null,
    },
    /** The selected pair at each window (the matrix's side panel). */
    sweep: {
      type: Array as PropType<readonly SweepPoint[]>,
      default: () => [],
    },
    /** Whether the selected pair's sweep is running. */
    sweeping: { type: Boolean, default: false },
  },
  emits: {
    // A ranking row was chosen: open `born → event` in the Retention tab.
    openRetention: (event: string) => typeof event === "string",
    // A matrix cell was chosen (or its panel closed).
    selectPair: (pair: MatrixPair | null) => pair === null || pair.length === 2,
    // Run the selected pair at the windows not fetched yet.
    sweep: () => true,
    // Open these steps at this window in the Funnel tab and run them.
    openFunnel: (steps: readonly string[], window: ConversionWindow) =>
      steps.length >= 2 && window > 0,
  },
  setup(props, { slots, emit }) {
    const body = (spec: AnySpec, result: AnyResult | null): VNode | null => {
      if (spec.kind === "aha") {
        return h(AhaResult, {
          spec,
          outcomes: props.outcomes,
          onOpen: (event: string) => emit("openRetention", event),
        });
      }
      if (spec.kind === "matrix") {
        return h(MatrixResult, {
          spec,
          outcomes: props.outcomes,
          loading: props.loading,
          selected: props.selectedPair,
          sweep: props.sweep,
          sweeping: props.sweeping,
          onSelect: (pair: MatrixPair | null) => emit("selectPair", pair),
          onSweep: () => emit("sweep"),
          onOpenFunnel: (steps: readonly string[], window: ConversionWindow) =>
            emit("openFunnel", steps, window),
        });
      }
      if (result === null) {
        return null;
      }
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

    // The ranking loop reports where it is under its skeleton; a query
    // shows the bare skeleton (its previous result stays until replaced).
    const skeleton = (spec: AnySpec): VNode | null => {
      if (!props.loading) {
        return null;
      }
      const settled = props.outcomes.filter(
        (outcome) => outcome.result !== null || outcome.error !== null,
      ).length;
      return h("div", [
        h("div", { class: "mp-skeleton-chart" }),
        isLoopSpec(spec)
          ? h(
              "p",
              { class: "mp-muted mp-loop-progress", role: "status" },
              `Running query ${String(Math.min(settled + 1, props.outcomes.length))} of ${String(props.outcomes.length)}…`,
            )
          : null,
      ]);
    };

    return () => {
      const { spec, result } = props;
      if (spec === null) {
        return h("section", { class: "mp-result" }, [
          h("div", { class: "mp-col-head" }, [h("h2", "Result")]),
          props.error === null
            ? h("div", { class: "mp-result-body mp-chart-empty" }, [
                h(
                  "div",
                  { class: "mp-empty", role: "status" },
                  props.blocked ?? EMPTY[props.engine],
                ),
              ])
            : h(ErrorBlock, { error: props.error }),
        ]);
      }
      // A query is ready once it has a result; the ranking once it has
      // finished with at least one answer to rank; the matrix at once — its
      // grid fills cell by cell as the loop settles.
      const ready =
        spec.kind === "matrix" ||
        (spec.kind === "aha"
          ? !props.loading &&
            props.outcomes.some((outcome) => outcome.result !== null)
          : result !== null);
      const dimmed = props.loading && spec.kind !== "matrix";
      return h(
        "section",
        { class: "mp-result", "aria-busy": props.loading ? "true" : "false" },
        [
          h("div", { class: "mp-col-head" }, [h("h2", "Result")]),
          h("p", { class: "mp-result-title" }, resultTitle(spec, result)),
          props.error === null ? null : h(ErrorBlock, { error: props.error }),
          h("div", { class: ["mp-result-body", dimmed ? "mp-loading" : ""] }, [
            ready ? body(spec, result) : skeleton(spec),
          ]),
          ready ? slots["actions"]?.() : null,
          ready && result !== null
            ? h(ResultTable, {
                columns: result.rowColumns(),
                rows: result.toRows(),
              })
            : null,
        ],
      );
    };
  },
});
