// The conversion matrix's result: a constellation of the pool that draws
// one arc per pair as the loop settles (and stays, small, with the best
// path lit), an n × n heatmap (row = first step, column = second step,
// cell = overall conversion within the window) that fills alongside it,
// the best path `bestPath` chains with a button that opens it in the
// Funnel tab, and a side panel for one cell that runs the pair at the
// windows not fetched yet and draws the four values as a line. A real
// table with scoped headers and a caption; every cell is a button, so the
// panel opens from the keyboard too. The cells are shaded like the
// retention grid, through the same `cellShade`.

import { defineComponent, h, type PropType, type VNode } from "vue";

import {
  type BestPath,
  bestPath,
  type MatrixPair,
  type MatrixSpec,
  orderedPairs,
  PATH_STEPS,
} from "../model/matrix.js";
import type { ConversionWindow } from "../model/query-spec.js";
import {
  cellShade,
  formatPct,
  type FunnelResult,
  sparklinePath,
} from "../model/series.js";
import { ErrorBlock } from "./banners.js";
import Constellation, { type ConstellationEdge } from "./constellation.js";
import { button } from "./el.js";
import { type CallOutcome, pairKey } from "./use-query.js";

/** One window of a cell's sweep: fetched (an outcome) or not (`null`). */
export interface SweepPoint {
  readonly window: ConversionWindow;
  readonly outcome: CallOutcome | null;
}

/**
 * The row-header column's width relative to one event column. The table
 * is fixed-layout, so a long event name truncates in its cell instead of
 * widening the grid past the result column.
 */
const ROW_HEADER_SHARE = 1.4;

/** Sweep chart geometry (user units = px). */
const CHART = {
  width: 280,
  height: 132,
  top: 20,
  right: 18,
  bottom: 24,
  left: 40,
} as const;

/**
 * The results in `orderedPairs` order, `null` where a pair failed or has
 * not settled — what the heatmap draws, `bestPath` chains and the
 * Markdown export copies.
 *
 * @param spec - The report that ran.
 * @param outcomes - Its outcomes, one per pair.
 * @returns One entry per pair.
 * @example
 * ```ts
 * matrixResults(spec, outcomes)[0]?.overall_conversion_rate; // 0.44
 * ```
 */
export function matrixResults(
  spec: MatrixSpec,
  outcomes: readonly CallOutcome[],
): Array<FunnelResult | null> {
  return orderedPairs(spec.events).map(
    (_, i) => (outcomes[i]?.result as FunnelResult | null | undefined) ?? null,
  );
}

/**
 * A pair as the copy shows it.
 *
 * @param pair - The pair.
 * @returns `from → to`.
 */
const arrow = (pair: readonly string[]): string => pair.join(" → ");

/**
 * The y-axis top for a set of rates: the next tenth above the largest,
 * never below a tenth, so a row of small rates still has a visible slope.
 *
 * @param rates - The plotted rates.
 * @returns The axis maximum, 0.1–1.
 */
const axisTop = (rates: readonly number[]): number =>
  Math.min(1, Math.max(0.1, Math.ceil(Math.max(0, ...rates) * 10) / 10));

/**
 * Where a point's label sits relative to it: the first point's label
 * starts at it, the last one's ends at it, so neither leaves the chart.
 *
 * @param i - Point index.
 * @param count - Number of points.
 * @returns The `text-anchor` value.
 */
const anchor = (i: number, count: number): "start" | "middle" | "end" => {
  if (i === 0) {
    return "start";
  }
  return i === count - 1 ? "end" : "middle";
};

/**
 * One window's value as the side panel lists it.
 *
 * @param point - The window and what it holds.
 * @returns A percentage, or why there is none.
 */
const pointValue = (point: SweepPoint): string => {
  const result = point.outcome?.result as FunnelResult | null | undefined;
  if (result !== null && result !== undefined) {
    return formatPct(result.overall_conversion_rate);
  }
  return point.outcome === null ? "not fetched" : "failed";
};

/** Conversion matrix result. */
export default defineComponent({
  name: "DemoMatrixResult",
  props: {
    spec: { type: Object as PropType<MatrixSpec>, required: true },
    outcomes: {
      type: Array as PropType<readonly CallOutcome[]>,
      required: true,
    },
    loading: { type: Boolean, default: false },
    /** The cell open in the side panel, or `null`. */
    selected: { type: Object as PropType<MatrixPair | null>, default: null },
    /** The selected pair at each window, ascending. */
    sweep: {
      type: Array as PropType<readonly SweepPoint[]>,
      default: () => [],
    },
    /** Whether the selected pair's sweep is running. */
    sweeping: { type: Boolean, default: false },
  },
  emits: {
    // A cell was chosen (or the panel closed).
    select: (pair: MatrixPair | null) => pair === null || pair.length === 2,
    // Run the selected pair at the windows not fetched yet.
    sweep: () => true,
    // Open these steps at this window in the Funnel tab and run them.
    openFunnel: (steps: readonly string[], window: ConversionWindow) =>
      steps.length >= 2 && window > 0,
  },
  setup(props, { emit }) {
    const isSelected = (from: string, to: string): boolean =>
      props.selected !== null &&
      props.selected[0] === from &&
      props.selected[1] === to;

    const cell = (from: string, to: string, outcome: CallOutcome): VNode => {
      const result = outcome.result as FunnelResult | null;
      if (result === null) {
        if (outcome.error !== null) {
          return h(
            "td",
            {
              key: to,
              class: "mp-matrix-failed",
              title: outcome.error.message,
              "aria-label": `${arrow([from, to])}: failed, ${outcome.error.message}`,
            },
            "error",
          );
        }
        return h(
          "td",
          {
            key: to,
            class: "mp-num mp-matrix-pending",
            "aria-label": "pending",
          },
          "…",
        );
      }
      const rate = result.overall_conversion_rate;
      const shade = cellShade(rate);
      return h(
        "td",
        {
          key: to,
          class: [
            "mp-num",
            "mp-cell",
            "mp-matrix-cell",
            shade.inverse ? "mp-cell-inverse" : "",
          ],
          style: { "--mp-cell-alpha": shade.alpha.toFixed(3) },
        },
        [
          h(
            "button",
            {
              type: "button",
              class: "mp-matrix-btn",
              "aria-label": `${arrow([from, to])}: ${formatPct(rate)} within ${String(props.spec.conversionWindow)} days. Show across windows`,
              "aria-pressed": isSelected(from, to),
              onClick: () => emit("select", [from, to]),
            },
            formatPct(rate),
          ),
        ],
      );
    };

    const grid = (): VNode => {
      const { events, conversionWindow, last } = props.spec;
      const pairs = orderedPairs(events);
      const index = new Map(pairs.map((pair, i) => [JSON.stringify(pair), i]));
      const shares = events.length + ROW_HEADER_SHARE;
      const width = (share: number): string =>
        `${((share / shares) * 100).toFixed(2)}%`;
      // The truncated name keeps its full text in `title` (the tooltip) and
      // in the accessible name, so nothing is lost to the ellipsis.
      const header = (event: string, scope: "col" | "row"): VNode =>
        h(
          "th",
          {
            key: event,
            scope,
            class:
              scope === "col" ? "mp-num mp-matrix-event" : "mp-matrix-event",
            title: event,
            "aria-label": event,
          },
          event,
        );
      return h("table", { class: "mp-matrix" }, [
        h(
          "caption",
          { class: "mp-visually-hidden" },
          `Conversion from each row event to each column event within ${String(conversionWindow)} days, last ${String(last)} days, ${String(events.length)} events`,
        ),
        h("colgroup", [
          h("col", { style: { width: width(ROW_HEADER_SHARE) } }),
          ...events.map((event) =>
            h("col", { key: event, style: { width: width(1) } }),
          ),
        ]),
        h("thead", [
          h("tr", [
            h("th", { scope: "col", class: "mp-matrix-corner" }, [
              h("span", { "aria-hidden": "true" }, "from ↓ to →"),
              h("span", { class: "mp-visually-hidden" }, "From"),
            ]),
            ...events.map((event) => header(event, "col")),
          ]),
        ]),
        h(
          "tbody",
          events.map((from) =>
            h("tr", { key: from }, [
              header(from, "row"),
              ...events.map((to) => {
                if (to === from) {
                  return h(
                    "td",
                    { key: to, class: "mp-matrix-diag", "aria-label": "—" },
                    "—",
                  );
                }
                const i = index.get(JSON.stringify([from, to])) ?? -1;
                const outcome = props.outcomes[i];
                return outcome === undefined
                  ? h("td", { key: to })
                  : cell(from, to, outcome);
              }),
            ]),
          ),
        ),
      ]);
    };

    const settledCount = (): number =>
      props.outcomes.filter(
        (outcome) => outcome.result !== null || outcome.error !== null,
      ).length;

    const progress = (): VNode | null => {
      if (!props.loading) {
        return null;
      }
      return h(
        "p",
        { class: "mp-muted mp-loop-progress", role: "status" },
        `Running query ${String(Math.min(settledCount() + 1, props.outcomes.length))} of ${String(props.outcomes.length)}…`,
      );
    };

    // The best path once the loop is done, `null` while it runs or when
    // nothing converted.
    const pathOf = (): BestPath | null => {
      if (props.loading) {
        return null;
      }
      const path = bestPath(
        props.spec.events,
        matrixResults(props.spec, props.outcomes),
        { steps: PATH_STEPS },
      );
      return path.events.length < 2 ? null : path;
    };

    // The pool on a ring, one arc per settled pair in loop order; the best
    // path lit once it is known, the pair under a sweep pulsing meanwhile.
    const constellation = (path: BestPath | null): VNode => {
      const { events } = props.spec;
      const index = new Map(events.map((event, i) => [event, i]));
      const lit = new Set(
        path === null
          ? []
          : path.events
              .slice(1)
              .map((to, k) => `${path.events[k] ?? ""}>${to}`),
      );
      const sweeping =
        props.sweeping && props.selected !== null
          ? pairKey(props.selected)
          : null;
      const edges = orderedPairs(events).flatMap(
        ([from, to], i): ConstellationEdge[] => {
          const outcome = props.outcomes[i];
          const key = `${from}>${to}`;
          if (
            outcome === undefined ||
            (outcome.result === null && outcome.error === null)
          ) {
            return [];
          }
          const result = outcome.result as FunnelResult | null;
          return [
            {
              key,
              from: index.get(from) ?? 0,
              to: index.get(to) ?? 0,
              weight: result === null ? null : result.overall_conversion_rate,
              highlight: lit.has(key),
              pulse: sweeping === key,
            },
          ];
        },
      );
      return h(Constellation, {
        nodes: events,
        layout: "ring",
        edges,
        highlightNodes:
          path === null
            ? []
            : path.events.map((event) => index.get(event) ?? -1),
        count: props.loading
          ? `${String(settledCount())} / ${String(props.outcomes.length)}`
          : null,
        settled: !props.loading,
      });
    };

    const best = (path: BestPath | null): VNode | null => {
      if (path === null) {
        return null;
      }
      return h("p", { class: "mp-matrix-best" }, [
        h("span", "Best path: "),
        h("strong", arrow(path.events)),
        h("span", { "aria-hidden": "true" }, "·"),
        h(
          "span",
          {
            class: "mp-matrix-estimate",
            title:
              "≈ the product of the pairwise rates. The real three-step funnel is what “Open as funnel” runs.",
          },
          `≈ ${formatPct(path.estimate)} overall`,
        ),
        button(
          "Open as funnel",
          () => emit("openFunnel", path.events, props.spec.conversionWindow),
          { class: "mp-btn mp-btn-small" },
        ),
      ]);
    };

    const chart = (pair: MatrixPair, points: readonly SweepPoint[]): VNode => {
      const rates = points.map(
        (point) =>
          (point.outcome?.result as FunnelResult | null)
            ?.overall_conversion_rate ?? 0,
      );
      const top = axisTop(rates);
      const plotW = CHART.width - CHART.left - CHART.right;
      const plotH = CHART.height - CHART.top - CHART.bottom;
      const x = (i: number): number =>
        CHART.left +
        (points.length > 1 ? (i / (points.length - 1)) * plotW : 0);
      const y = (rate: number): number =>
        CHART.top + plotH - (rate / top) * plotH;
      return h(
        "svg",
        {
          class: "mp-sweep-chart",
          viewBox: `0 0 ${String(CHART.width)} ${String(CHART.height)}`,
          role: "img",
          "aria-label": `${arrow(pair)}: ${points.map((point, i) => `${String(point.window)} day${point.window === 1 ? "" : "s"} ${formatPct(rates[i] ?? 0)}`).join(", ")}`,
        },
        [
          h("line", {
            class: "mp-sweep-axis",
            x1: CHART.left,
            x2: CHART.width - CHART.right,
            y1: y(0),
            y2: y(0),
          }),
          h(
            "text",
            {
              class: "mp-sweep-tick",
              x: CHART.left - 6,
              y: y(0) + 4,
              "text-anchor": "end",
            },
            "0%",
          ),
          h(
            "text",
            {
              class: "mp-sweep-tick",
              x: CHART.left - 6,
              y: y(top) + 4,
              "text-anchor": "end",
            },
            formatPct(top),
          ),
          h(
            "g",
            {
              transform: `translate(${String(CHART.left)} ${String(CHART.top)})`,
            },
            [
              h("path", {
                class: "mp-sweep-line",
                d: sparklinePath(
                  rates.map((rate) => rate / top),
                  plotW,
                  plotH,
                ),
              }),
            ],
          ),
          ...points.flatMap((point, i) => [
            h("circle", {
              key: `dot-${String(point.window)}`,
              class: "mp-sweep-dot",
              cx: x(i).toFixed(1),
              cy: y(rates[i] ?? 0).toFixed(1),
              r: 3,
            }),
            h(
              "text",
              {
                key: `val-${String(point.window)}`,
                class: "mp-sweep-value",
                x: x(i).toFixed(1),
                y: (y(rates[i] ?? 0) - 8).toFixed(1),
                "text-anchor": anchor(i, points.length),
              },
              formatPct(rates[i] ?? 0),
            ),
            h(
              "text",
              {
                key: `win-${String(point.window)}`,
                class: "mp-sweep-tick",
                x: x(i).toFixed(1),
                y: CHART.height - 6,
                "text-anchor": anchor(i, points.length),
              },
              `${String(point.window)}d`,
            ),
          ]),
        ],
      );
    };

    const panel = (pair: MatrixPair): VNode => {
      const points = props.sweep;
      // Unfetched and failed windows alike: a failed one is offered again.
      const missing = points.filter(
        (point) => point.outcome === null || point.outcome.result === null,
      ).length;
      const failed = points.flatMap((point) =>
        point.outcome?.error == null ? [] : [point.outcome.error],
      );
      const complete = points.length > 0 && missing === 0;
      return h(
        "aside",
        {
          class: "mp-matrix-panel",
          "aria-label": `${arrow(pair)} across windows`,
        },
        [
          h("div", { class: "mp-matrix-panel-head" }, [
            h("h3", `${arrow(pair)} across windows`),
            button("×", () => emit("select", null), {
              class: "mp-btn mp-btn-icon",
              "aria-label": "Close",
            }),
          ]),
          h("div", { class: "mp-matrix-panel-body" }, [
            complete ? chart(pair, points) : null,
            h(
              "ul",
              { class: "mp-matrix-windows", role: "list" },
              points.map((point) =>
                h("li", { key: point.window }, [
                  h(
                    "span",
                    `${String(point.window)} day${point.window === 1 ? "" : "s"}`,
                  ),
                  h("span", { class: "mp-num" }, pointValue(point)),
                ]),
              ),
            ),
          ]),
          ...failed.map((error, i) => h(ErrorBlock, { key: i, error })),
          h("div", { class: "mp-actions" }, [
            missing > 0
              ? button(
                  props.sweeping
                    ? "Running…"
                    : `Run ${String(missing)} more ${missing === 1 ? "query" : "queries"}`,
                  () => emit("sweep"),
                  {
                    class: "mp-btn mp-btn-brand",
                    disabled: props.sweeping,
                    "aria-busy": props.sweeping ? "true" : "false",
                  },
                )
              : null,
            button(
              "Open as funnel",
              () => emit("openFunnel", pair, props.spec.conversionWindow),
              { class: "mp-btn" },
            ),
          ]),
          missing > 0 && !props.sweeping
            ? h(
                "p",
                { class: "mp-muted mp-loop-hint" },
                `One funnel query per window not fetched yet; the ${String(props.spec.conversionWindow)}-day cell is reused.`,
              )
            : null,
        ],
      );
    };

    return (): VNode => {
      const path = pathOf();
      return h("div", { class: "mp-matrix-layout" }, [
        h("div", { class: "mp-matrix-main" }, [
          h(
            "p",
            { class: "mp-muted mp-loop-sub" },
            `Share of users who did the row event and then the column event within ${String(props.spec.conversionWindow)} days, over the last ${String(props.spec.last)} days. Select a cell to see the pair across windows.`,
          ),
          // The constellation fills the band while the loop runs and
          // shrinks beside the best path once it is done.
          h("div", { class: "mp-loop-band" }, [
            constellation(path),
            progress(),
            best(path),
          ]),
          grid(),
        ]),
        props.selected === null ? null : panel(props.selected),
      ]);
    };
  },
});
