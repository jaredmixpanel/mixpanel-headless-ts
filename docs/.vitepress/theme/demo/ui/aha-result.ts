// The ranking report's result: a constellation with the born event in the
// middle and a spoke to each candidate as its retention result lands (the
// strongest lit once the ranking is known), then the candidates ranked by
// their average retention at the compared bucket, each row a
// small-multiple curve with the median candidate's rate as a reference
// line, the rate, the lift against that median, and the cohorts behind it.
// A failed candidate keeps its error in its row; the rest still rank.
// Every row is a button that hands the pair to the Retention tab. The
// ranking is `rankByRetention` over the settled results — the same call
// the program in the code panel ends with.

import { defineComponent, h, type PropType, type VNode } from "vue";

import {
  type AhaSpec,
  rankByRetention,
  type Ranking,
  TARGET_BUCKET,
} from "../model/aha.js";
import { formatCount, formatPct, sparklinePath } from "../model/series.js";
import { ErrorBlock } from "./banners.js";
import Constellation, { type ConstellationEdge } from "./constellation.js";
import type { CallOutcome, RetentionQueryResult } from "./use-query.js";

/** Sparkline geometry (user units = px). */
const SPARK = { width: 96, height: 28, pad: 3 } as const;

/**
 * A lift as signed percentage points, e.g. `+12.3 pts`; the median row
 * reads "median".
 *
 * @param lift - Rate minus the median rate.
 * @returns The label.
 */
function formatLift(lift: number): string {
  const points = lift * 100;
  if (Math.abs(points) < 0.05) {
    return "median";
  }
  return `${points > 0 ? "+" : "−"}${Math.abs(points).toFixed(1)} pts`;
}

/**
 * The ranking over the outcomes that produced a result, index-aligned with
 * the spec's candidates — what the list draws and the Markdown export
 * copies.
 *
 * @param spec - The report that ran.
 * @param outcomes - Its outcomes, one per candidate.
 * @returns The ranking of the successful candidates.
 * @example
 * ```ts
 * rankOutcomes(spec, outcomes).rows[0]?.event; // "Note Shared"
 * ```
 */
export function rankOutcomes(
  spec: AhaSpec,
  outcomes: readonly CallOutcome[],
): Ranking {
  const candidates: string[] = [];
  const results: RetentionQueryResult[] = [];
  for (const [i, outcome] of outcomes.entries()) {
    const event = spec.candidates[i];
    if (outcome.result !== null && event !== undefined) {
      candidates.push(event);
      results.push(outcome.result as RetentionQueryResult);
    }
  }
  return rankByRetention(candidates, results, { bucket: TARGET_BUCKET });
}

/** Ranking report result. */
export default defineComponent({
  name: "DemoAhaResult",
  props: {
    spec: { type: Object as PropType<AhaSpec>, required: true },
    outcomes: {
      type: Array as PropType<readonly CallOutcome[]>,
      required: true,
    },
    /** Whether the loop is still running (the list waits for it). */
    loading: { type: Boolean, default: false },
  },
  emits: {
    // A row was chosen: open `born → event` in the Retention tab.
    open: (event: string) => typeof event === "string",
  },
  setup(props, { emit }) {
    const sparkline = (
      curve: readonly number[],
      median: number,
      event: string,
    ): VNode => {
      const { width, height, pad } = SPARK;
      const inner = height - pad * 2;
      const y = (rate: number): number => pad + inner - rate * inner;
      const last = curve.length - 1;
      const x = (i: number): number =>
        pad + (last > 0 ? (i / last) * (width - pad * 2) : 0);
      return h(
        "svg",
        {
          class: "mp-aha-spark",
          viewBox: `0 0 ${String(width)} ${String(height)}`,
          role: "img",
          "aria-label": `${event}: ${curve.map((rate, i) => `${props.spec.retentionUnit} ${String(i)} ${formatPct(rate)}`).join(", ")}`,
        },
        [
          h("line", {
            class: "mp-aha-median",
            x1: pad,
            x2: width - pad,
            y1: y(median).toFixed(1),
            y2: y(median).toFixed(1),
          }),
          h("g", { transform: `translate(${String(pad)} ${String(pad)})` }, [
            h("path", {
              class: "mp-aha-curve",
              d: sparklinePath(curve, width - pad * 2, inner),
            }),
          ]),
          last >= 0
            ? h("circle", {
                class: "mp-aha-dot",
                cx: x(last).toFixed(1),
                cy: y(curve[last] ?? 0).toFixed(1),
                r: 2.5,
              })
            : null,
        ],
      );
    };

    const row = (ranking: Ranking, entry: Ranking["rows"][number]): VNode =>
      h("li", { key: entry.event, class: "mp-aha-row" }, [
        h(
          "button",
          {
            type: "button",
            class: "mp-aha-open",
            "aria-label": `${String(entry.rank)}. ${entry.event}: ${formatPct(entry.rate)} at ${props.spec.retentionUnit} ${String(ranking.bucket)}, ${formatLift(entry.lift)}. Open ${props.spec.born} → ${entry.event} in the Retention tab`,
            onClick: () => emit("open", entry.event),
          },
          [
            h("span", { class: "mp-aha-rank mp-num" }, String(entry.rank)),
            h(
              "span",
              { class: "mp-aha-event", title: entry.event },
              entry.event,
            ),
            sparkline(entry.curve, ranking.median, entry.event),
            h("span", { class: "mp-aha-rate mp-num" }, formatPct(entry.rate)),
            h(
              "span",
              {
                class: [
                  "mp-aha-lift",
                  "mp-num",
                  entry.lift > 0.0005 ? "mp-up" : "",
                  entry.lift < -0.0005 ? "mp-down" : "",
                ],
              },
              formatLift(entry.lift),
            ),
            h(
              "span",
              { class: "mp-aha-meta" },
              `${String(entry.cohorts)} cohort${entry.cohorts === 1 ? "" : "s"} · ${formatCount(entry.entrants)} entrants`,
            ),
          ],
        ),
      ]);

    const failed = (event: string, outcome: CallOutcome): VNode =>
      h("li", { key: event, class: "mp-aha-row mp-aha-failed" }, [
        h("span", { class: "mp-aha-event", title: event }, event),
        outcome.error === null
          ? h("span", { class: "mp-muted" }, "not run")
          : h(ErrorBlock, { error: outcome.error }),
      ]);

    // The born event in the middle, a spoke per settled candidate weighted
    // by its rate against the best seen so far; the top candidate's spoke
    // lit once the ranking is final.
    const constellation = (ranking: Ranking): VNode => {
      const { spec, outcomes } = props;
      const rates = new Map(
        ranking.rows.map((entry) => [entry.event, entry.rate]),
      );
      const top = Math.max(0, ...rates.values());
      const share = (rate: number): number => (top > 0 ? rate / top : 0);
      const leader = props.loading ? null : (ranking.rows[0]?.event ?? null);
      const edges = spec.candidates.flatMap((event, i): ConstellationEdge[] => {
        const outcome = outcomes[i];
        if (
          outcome === undefined ||
          (outcome.result === null && outcome.error === null)
        ) {
          return [];
        }
        const rate = rates.get(event);
        return [
          {
            key: event,
            from: 0,
            to: i + 1,
            weight: rate === undefined ? null : share(rate),
            highlight: event === leader,
          },
        ];
      });
      const leaderIndex =
        leader === null ? -1 : spec.candidates.indexOf(leader);
      // No count in the picture: the born event holds the middle, and the
      // status line under it says where the loop is.
      return h(Constellation, {
        nodes: [spec.born, ...spec.candidates],
        layout: "hub",
        edges,
        highlightNodes: leaderIndex === -1 ? [] : [0, leaderIndex + 1],
        settled: !props.loading,
      });
    };

    const progress = (): VNode | null => {
      if (!props.loading) {
        return null;
      }
      const settled = props.outcomes.filter(
        (outcome) => outcome.result !== null || outcome.error !== null,
      ).length;
      return h(
        "p",
        { class: "mp-muted mp-loop-progress", role: "status" },
        `Running query ${String(Math.min(settled + 1, props.outcomes.length))} of ${String(props.outcomes.length)}…`,
      );
    };

    return (): VNode => {
      const { spec, outcomes } = props;
      const ranking = rankOutcomes(spec, outcomes);
      const unit = spec.retentionUnit;
      const others = outcomes.flatMap((outcome, i) => {
        const event = spec.candidates[i];
        return outcome.result === null && event !== undefined
          ? [failed(event, outcome)]
          : [];
      });
      // The list waits for the loop: a ranking over half the candidates
      // would reorder under the visitor with every result.
      return h("div", { class: "mp-aha" }, [
        h("div", { class: "mp-loop-band" }, [
          constellation(ranking),
          props.loading
            ? progress()
            : h(
                "p",
                { class: "mp-muted mp-loop-sub" },
                `Average retention at ${unit} ${String(ranking.bucket)}, ${unit === "week" ? "weekly" : "daily"} cohorts over the last ${String(spec.last)} days. Median across ${String(ranking.rows.length)} candidates: ${formatPct(ranking.median)} (the dashed line). Select a row to run the pair in the Retention tab.`,
              ),
        ]),
        props.loading
          ? null
          : h(
              "ol",
              {
                class: "mp-aha-list",
                role: "list",
                "aria-label": `Candidates ranked by retention after ${spec.born}`,
              },
              [...ranking.rows.map((entry) => row(ranking, entry)), ...others],
            ),
      ]);
    };
  },
});
