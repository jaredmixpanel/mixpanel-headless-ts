// Dependency-free trend chart: one `<path>` per series. The viewBox is
// the figure's own width (a resize observer keeps it so) at a fixed
// height, so one unit is one CSS pixel and the tick labels, strokes and
// tooltip keep their size at every column width instead of shrinking with
// it. The `<svg>` is one image to assistive technology (`role="img"` with a summary
// label, described by the result table), and the crosshair is keyboard
// driven: Left/Right step the day, Home/End jump, and a polite live region
// reads the values out. Every point also carries a `<title>` for mouse
// tooltips. No chart library: the origin rule forbids third-party script
// and the page already pays for the library chunk.

import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  type PropType,
  ref,
  type VNode,
} from "vue";

import { allZero, formatCount, type TrendLine } from "../model/series.js";

/** Width before the first measurement (and without a resize observer). */
const DEFAULT_WIDTH = 960;
const HEIGHT = 320;
const PAD = { top: 16, right: 16, bottom: 34, left: 60 } as const;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
/** Crosshair tooltip geometry (px). */
const BOX = { width: 220, pad: 10, row: 20, title: 24 } as const;
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
    const figure = ref<HTMLElement | null>(null);
    const width = ref(DEFAULT_WIDTH);
    let observer: ResizeObserver | null = null;
    onMounted(() => {
      if (figure.value === null || typeof ResizeObserver === "undefined") {
        return;
      }
      observer = new ResizeObserver((entries) => {
        const measured = entries[0]?.contentRect.width ?? 0;
        if (measured > 0) {
          width.value = Math.round(measured);
        }
      });
      observer.observe(figure.value);
    });
    onBeforeUnmount(() => observer?.disconnect());
    const plotW = computed(() => width.value - PAD.left - PAD.right);
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
      PAD.left +
      (length.value > 1 ? (index / (length.value - 1)) * plotW.value : 0);
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
      const plotX =
        ((clientX - rect.left) / rect.width) * width.value - PAD.left;
      const index = Math.round((plotX / plotW.value) * (length.value - 1));
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
            x2: width.value - PAD.right,
            y1: y(tick),
            y2: y(tick),
            class: "mp-chart-grid",
          }),
          h(
            "text",
            {
              x: PAD.left - 8,
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
            y: HEIGHT - 10,
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
                  r: hover.value === i ? 4.5 : 3,
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
      const left =
        x(i) + BOX.width + 20 > width.value ? x(i) - BOX.width - 12 : x(i) + 12;
      const rowY = (k: number): number =>
        PAD.top + BOX.pad + BOX.title + k * BOX.row;
      // Each value row carries its line's colour as a swatch; the text
      // itself stays in the body colour so it reads in both schemes.
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
          width: BOX.width,
          height: BOX.pad * 2 + BOX.title + rows.length * BOX.row - 6,
          rx: 6,
          class: "mp-chart-box",
        }),
        h(
          "text",
          {
            x: left + BOX.pad,
            y: PAD.top + BOX.pad + 12,
            class: "mp-chart-box-title",
          },
          dates.value[i] ?? "",
        ),
        ...rows.flatMap((row, k) => [
          h("rect", {
            key: `swatch-${k}`,
            x: left + BOX.pad,
            y: rowY(k) - 2,
            width: 10,
            height: 3,
            fill: SERIES_COLOURS[k % SERIES_COLOURS.length],
          }),
          h(
            "text",
            {
              key: `row-${k}`,
              x: left + BOX.pad + 16,
              y: rowY(k) + 3,
              class: "mp-chart-box-row",
            },
            row,
          ),
        ]),
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
      return h("figure", { class: "mp-chart", ref: figure }, [
        h(
          "svg",
          {
            viewBox: `0 0 ${width.value} ${HEIGHT}`,
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
