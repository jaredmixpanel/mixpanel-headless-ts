// Dependency-free trend chart: one `<path>` per series inside a fixed
// viewBox, so it scales with the column without a resize observer. The
// `<svg>` is one image to assistive technology (`role="img"` with a summary
// label, described by the result table), and the crosshair is keyboard
// driven: Left/Right step the day, Home/End jump, and a polite live region
// reads the values out. Every point also carries a `<title>` for mouse
// tooltips. No chart library: the origin rule forbids third-party script
// and the page already pays for the library chunk.

import {
  computed,
  defineComponent,
  h,
  type PropType,
  ref,
  type VNode,
} from "vue";

import { allZero, formatCount, type TrendLine } from "../model/series.js";

const WIDTH = 640;
const HEIGHT = 240;
const PAD = { top: 12, right: 12, bottom: 28, left: 52 } as const;
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
/** Target tick count; the 1-2-5 step then rounds the axis top up. */
const TICKS = 5;
const ANCHORS = ["start", "middle", "end"] as const;

/** Series colours, in order; all defined in theme/mixpanel.css. */
const SERIES_COLOURS = [
  "var(--mp-blue)",
  "var(--mp-purple)",
  "var(--mp-green)",
  "var(--mp-red)",
  "var(--mp-purple-light)",
  "var(--mp-text-body)",
] as const;

/**
 * Pick a tick step by the 1-2-5 rule so the axis ends on a round number.
 *
 * @param max - The largest value plotted.
 * @returns The step between ticks (at least 1).
 */
function niceStep(max: number): number {
  const raw = Math.max(max, 1) / TICKS;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const candidate = [1, 2, 5, 10].find((m) => m * magnitude >= raw) ?? 10;
  return candidate * magnitude;
}

/**
 * The index a navigation key moves the crosshair to, or `null` for any
 * other key.
 *
 * @param key - `KeyboardEvent.key`.
 * @param current - The highlighted index (`null` before the first key).
 * @param length - Number of days.
 * @returns The clamped next index, or `null`.
 */
function nextIndex(
  key: string,
  current: number | null,
  length: number,
): number | null {
  const last = length - 1;
  switch (key) {
    case "ArrowRight": {
      return Math.min((current ?? -1) + 1, last);
    }
    case "ArrowLeft": {
      return Math.max((current ?? length) - 1, 0);
    }
    case "Home": {
      return 0;
    }
    case "End": {
      return last;
    }
    default: {
      return null;
    }
  }
}

/** Trend line chart. */
export default defineComponent({
  name: "DemoLineChart",
  props: {
    series: { type: Array as PropType<readonly TrendLine[]>, required: true },
    unit: { type: String, required: true },
    /** The event queried; names the chart when the series are segments. */
    event: { type: String, default: "" },
    /** The breakdown property, when there is one. */
    groupBy: { type: String as PropType<string | null>, default: null },
  },
  setup(props) {
    const hover = ref<number | null>(null);
    /** What the live region reads; set by the keyboard only, never the mouse. */
    const announcement = ref("");
    const length = computed(() =>
      Math.max(...props.series.map((s) => s.points.length), 0),
    );
    const step = computed(() =>
      niceStep(
        Math.max(
          ...props.series.flatMap((s) => s.points.map((p) => p.value)),
          0,
        ),
      ),
    );
    const top = computed(() => {
      const max = Math.max(
        ...props.series.flatMap((s) => s.points.map((p) => p.value)),
        0,
      );
      return Math.max(Math.ceil(max / step.value), 1) * step.value;
    });
    const x = (index: number): number =>
      PAD.left + (length.value > 1 ? (index / (length.value - 1)) * PLOT_W : 0);
    const y = (value: number): number =>
      PAD.top + PLOT_H - (value / top.value) * PLOT_H;
    const dates = computed(
      () => props.series[0]?.points.map((p) => p.date) ?? [],
    );
    const eventName = computed(
      () => props.event || props.series[0]?.name || "",
    );
    const flat = computed(() => allZero(props.series));
    /** Per-day totals across the drawn lines, for the summary. */
    const totals = computed(() =>
      Array.from({ length: length.value }, (_, i) =>
        props.series.reduce((sum, s) => sum + (s.points[i]?.value ?? 0), 0),
      ),
    );
    const summary = computed(() => {
      const first = dates.value[0] ?? "";
      const last = dates.value.at(-1) ?? "";
      const peak = Math.max(...totals.value, 0);
      const peakDay = dates.value[totals.value.indexOf(peak)] ?? first;
      const breakdown =
        props.series.length > 1
          ? `${props.series.length} lines by ${props.groupBy ?? "segment"}, `
          : "";
      return `${eventName.value}: ${props.unit} per day, ${first} to ${last}. ${breakdown}first ${formatCount(totals.value[0] ?? 0)}, last ${formatCount(totals.value.at(-1) ?? 0)}, peak ${formatCount(peak)} on ${peakDay}. Use the arrow keys to step through the days.`;
    });
    const rowsAt = (i: number): string[] =>
      props.series.map(
        (s) => `${s.name}: ${formatCount(s.points[i]?.value ?? 0)}`,
      );

    const moveHover = (clientX: number, svg: SVGSVGElement): void => {
      const rect = svg.getBoundingClientRect();
      const plotX = ((clientX - rect.left) / rect.width) * WIDTH - PAD.left;
      const index = Math.round((plotX / PLOT_W) * (length.value - 1));
      hover.value = Math.min(Math.max(index, 0), length.value - 1);
    };
    const onKeydown = (event: KeyboardEvent): void => {
      const next = nextIndex(event.key, hover.value, length.value);
      if (next === null || length.value === 0) {
        return;
      }
      event.preventDefault();
      hover.value = next;
      announcement.value = `${dates.value[next] ?? ""}: ${rowsAt(next).join(", ")}`;
    };
    const leave = (): void => {
      hover.value = null;
      announcement.value = "";
    };

    const axis = (): VNode[] =>
      Array.from(
        { length: Math.round(top.value / step.value) + 1 },
        (_, i) => i * step.value,
      ).map((tick) =>
        h("g", { key: tick }, [
          h("line", {
            x1: PAD.left,
            x2: WIDTH - PAD.right,
            y1: y(tick),
            y2: y(tick),
            class: "mp-chart-grid",
          }),
          h(
            "text",
            {
              x: PAD.left - 6,
              y: y(tick) + 4,
              class: "mp-chart-tick",
              "text-anchor": "end",
            },
            formatCount(tick),
          ),
        ]),
      );

    const xLabels = (): VNode[] => {
      const n = dates.value.length;
      if (n === 0) {
        return [];
      }
      const indices = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : [0, n - 1];
      return indices.map((i, k) =>
        h(
          "text",
          {
            key: i,
            x: x(i),
            y: HEIGHT - 8,
            class: "mp-chart-tick",
            "text-anchor": ANCHORS[k === indices.length - 1 ? 2 : k],
          },
          dates.value[i] ?? "",
        ),
      );
    };

    const lines = (): VNode[] =>
      props.series.map((s, k) =>
        h(
          "g",
          {
            key: s.name,
            style: { color: SERIES_COLOURS[k % SERIES_COLOURS.length] },
          },
          [
            h("path", {
              d: s.points
                .map(
                  (p, i) =>
                    `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`,
                )
                .join(" "),
              class: "mp-chart-line",
            }),
            ...s.points.map((p, i) =>
              h(
                "circle",
                {
                  cx: x(i),
                  cy: y(p.value),
                  r: hover.value === i ? 4 : 2.5,
                  class: "mp-chart-dot",
                },
                [
                  h(
                    "title",
                    `${s.name} · ${p.date}: ${formatCount(p.value)} ${props.unit}`,
                  ),
                ],
              ),
            ),
          ],
        ),
      );

    const crosshair = (): VNode | null => {
      const i = hover.value;
      if (i === null || i >= length.value) {
        return null;
      }
      const rows = rowsAt(i);
      const boxW = 180;
      const left = x(i) + boxW + 16 > WIDTH ? x(i) - boxW - 8 : x(i) + 8;
      return h("g", { class: "mp-chart-hover" }, [
        h("line", {
          x1: x(i),
          x2: x(i),
          y1: PAD.top,
          y2: PAD.top + PLOT_H,
          class: "mp-chart-cross",
        }),
        h("rect", {
          x: left,
          y: PAD.top,
          width: boxW,
          height: 16 + rows.length * 16,
          rx: 4,
          class: "mp-chart-box",
        }),
        h(
          "text",
          { x: left + 8, y: PAD.top + 14, class: "mp-chart-box-title" },
          dates.value[i] ?? "",
        ),
        ...rows.map((row, k) =>
          h(
            "text",
            {
              x: left + 8,
              y: PAD.top + 30 + k * 16,
              class: "mp-chart-box-row",
              style: { fill: SERIES_COLOURS[k % SERIES_COLOURS.length] },
            },
            row,
          ),
        ),
      ]);
    };

    const legend = (): VNode | null =>
      props.series.length > 1
        ? h(
            "figcaption",
            { class: "mp-chart-legend" },
            props.series.map((s, k) =>
              h(
                "span",
                {
                  key: s.name,
                  class: "mp-legend-item",
                  style: { color: SERIES_COLOURS[k % SERIES_COLOURS.length] },
                },
                s.name,
              ),
            ),
          )
        : null;

    const noEvents = (): string => `No ${eventName.value} events in this range`;

    return () => {
      // A breakdown with no segments, or a result with no rows at all:
      // nothing to draw, so the caption says which of the two it is.
      if (props.series.length === 0) {
        return h("figure", { class: "mp-chart mp-chart-empty" }, [
          h(
            "figcaption",
            { class: "mp-empty", role: "status" },
            props.groupBy === null
              ? noEvents()
              : `No values recorded for ${props.groupBy}`,
          ),
        ]);
      }
      return h("figure", { class: "mp-chart" }, [
        h(
          "svg",
          {
            viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
            role: "img",
            "aria-label": summary.value,
            "aria-describedby": "mp-result-table",
            tabindex: 0,
            onMousemove: (event: MouseEvent) =>
              moveHover(event.clientX, event.currentTarget as SVGSVGElement),
            onMouseleave: () => {
              hover.value = null;
            },
            onKeydown,
            onBlur: leave,
          },
          [...axis(), ...xLabels(), ...lines(), crosshair()],
        ),
        h(
          "div",
          { class: "mp-visually-hidden", "aria-live": "polite" },
          announcement.value,
        ),
        flat.value
          ? h("figcaption", { class: "mp-empty", role: "status" }, noEvents())
          : legend(),
      ]);
    };
  },
});
