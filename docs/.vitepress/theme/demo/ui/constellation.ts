// The loop reports' waiting picture: the events as nodes on a ring (or one
// in the middle with the rest around it), and one directed arc per query
// as its result lands, drawn in loop order and weighted by what it found.
// It is a picture of the loop's progress, not a chart of the result — the
// table or list that follows is the accessible representation, so the
// SVG is hidden from assistive technology. Dependency-free, like the
// other visualisations.

import { defineComponent, h, type PropType, type VNode } from "vue";

import { cellShade } from "../model/series.js";

/** One settled query as an arc from one node to another. */
export interface ConstellationEdge {
  /** Stable key, so a drawn arc is never redrawn by a later render. */
  readonly key: string;
  /** Index into `nodes`. */
  readonly from: number;
  /** Index into `nodes`. */
  readonly to: number;
  /**
   * What the query found, 0–1, driving the arc's weight and opacity;
   * `null` when the query failed (a dashed grey arc).
   */
  readonly weight: number | null;
  /** Whether the arc is part of the result the report singles out. */
  readonly highlight?: boolean;
  /** Whether a follow-up query on this pair is in flight. */
  readonly pulse?: boolean;
}

/** Where the nodes sit. */
export type ConstellationLayout = "ring" | "hub";

/** Drawing geometry (user units = px at full size). */
const VIEW = { width: 640, height: 320 } as const;
const CENTRE = { x: VIEW.width / 2, y: VIEW.height / 2 } as const;
const RING_RADIUS = 112;
const NODE_RADIUS = 5;
const HUB_RADIUS = 7;
/** How far outside the ring a label sits. */
const LABEL_GAP = 16;
/** Labels longer than this truncate; the full name stays in the tooltip. */
const LABEL_MAX = 22;
/** The arc's bow as a share of the chord: opposite directions bow apart. */
const BOW = 0.18;
const HEAD_LENGTH = 7;
const HEAD_HALF_WIDTH = 3.2;
/** Segments the arc length is estimated over (for the draw-in animation). */
const LENGTH_SAMPLES = 12;
/** The thinnest visible arc: a pair that never converts still draws. */
const HAIRLINE = 0.75;
/** Below this weight an arc is the hairline rather than a scaled stroke. */
const HAIRLINE_BELOW = 0.005;
/** A hairline's opacity, and the floor a weighted arc's opacity starts from. */
const FAINT_ALPHA = 0.3;
/** Nodes grow by this once the picture has shrunk to its settled size. */
const SETTLED_SCALE = 1.5;

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The node positions for a layout: evenly around the ring from the top,
 * clockwise; the hub layout keeps the first node in the middle.
 *
 * @param count - Number of nodes.
 * @param layout - Ring or hub.
 * @returns One point per node.
 */
function positions(count: number, layout: ConstellationLayout): Point[] {
  const onRing = layout === "hub" ? count - 1 : count;
  const ring = Array.from({ length: Math.max(onRing, 0) }, (_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(onRing, 1);
    return {
      x: CENTRE.x + RING_RADIUS * Math.cos(angle),
      y: CENTRE.y + RING_RADIUS * Math.sin(angle),
    };
  });
  return layout === "hub" ? [CENTRE, ...ring] : ring;
}

const unit = (from: Point, to: Point): Point => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
};

const along = (point: Point, direction: Point, distance: number): Point => ({
  x: point.x + direction.x * distance,
  y: point.y + direction.y * distance,
});

const fixed = (value: number): string => value.toFixed(1);

/**
 * The arc from one node to another: a quadratic curve bowed to the side
 * so the reverse pair bows the other way, trimmed off both nodes with
 * room for the arrowhead, plus the arrowhead itself.
 *
 * @param from - Source node centre.
 * @param to - Target node centre.
 * @param radii - The two nodes' radii.
 * @returns The curve's `d`, the head's `d`, and the curve's length.
 */
function arc(
  from: Point,
  to: Point,
  radii: readonly [from: number, to: number],
): { curve: string; head: string; length: number } {
  const chord = unit(from, to);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const control = along(mid, { x: -chord.y, y: chord.x }, distance * BOW);
  const start = along(from, unit(from, control), radii[0] + 2);
  const arrival = unit(control, to);
  const end = along(to, arrival, -(radii[1] + 2 + HEAD_LENGTH));
  const tip = along(end, arrival, HEAD_LENGTH);
  const side = { x: -arrival.y, y: arrival.x };
  const left = along(end, side, HEAD_HALF_WIDTH);
  const right = along(end, side, -HEAD_HALF_WIDTH);
  let length = 0;
  let previous = start;
  for (let k = 1; k <= LENGTH_SAMPLES; k++) {
    const t = k / LENGTH_SAMPLES;
    const point = {
      x: (1 - t) ** 2 * start.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x,
      y: (1 - t) ** 2 * start.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y,
    };
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return {
    curve: `M${fixed(start.x)},${fixed(start.y)} Q${fixed(control.x)},${fixed(control.y)} ${fixed(end.x)},${fixed(end.y)}`,
    head: `M${fixed(tip.x)},${fixed(tip.y)} L${fixed(left.x)},${fixed(left.y)} L${fixed(right.x)},${fixed(right.y)} Z`,
    length,
  };
}

/**
 * Where a ring label sits relative to its node: outside the ring, anchored
 * away from the centre, above or below when the node is near the top or
 * bottom.
 *
 * @param point - The node.
 * @returns The label's position and anchor.
 */
function labelPlacement(point: Point): {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
} {
  const direction = unit(CENTRE, point);
  const at = along(point, direction, LABEL_GAP);
  let anchor: "start" | "middle" | "end" = "middle";
  if (Math.abs(direction.x) > 0.3) {
    anchor = direction.x > 0 ? "start" : "end";
  }
  let dy = 4;
  if (direction.y < -0.3) {
    dy = -4;
  } else if (direction.y > 0.3) {
    dy = 14;
  }
  return { x: at.x, y: at.y + dy, anchor };
}

const truncate = (name: string): string =>
  name.length > LABEL_MAX ? `${name.slice(0, LABEL_MAX - 1)}…` : name;

/** Constellation. */
export default defineComponent({
  name: "DemoConstellation",
  props: {
    /** Node labels, in ring order (the hub layout's first node is the centre). */
    nodes: { type: Array as PropType<readonly string[]>, required: true },
    layout: { type: String as PropType<ConstellationLayout>, default: "ring" },
    /** The settled queries, in loop order. */
    edges: {
      type: Array as PropType<readonly ConstellationEdge[]>,
      required: true,
    },
    /** Indices of the nodes the result singles out (filled). */
    highlightNodes: {
      type: Array as PropType<readonly number[]>,
      default: () => [],
    },
    /** A count shown in the middle of the ring (under the hub), or `null`. */
    count: { type: String as PropType<string | null>, default: null },
    /** Whether the loop has finished: the picture shrinks to a keepsake. */
    settled: { type: Boolean, default: false },
  },
  setup(props) {
    const radiusOf = (index: number): number =>
      (props.layout === "hub" && index === 0 ? HUB_RADIUS : NODE_RADIUS) *
      (props.settled ? SETTLED_SCALE : 1);

    const edge = (
      entry: ConstellationEdge,
      points: readonly Point[],
    ): VNode | null => {
      const from = points[entry.from];
      const to = points[entry.to];
      if (from === undefined || to === undefined) {
        return null;
      }
      const drawn = arc(from, to, [radiusOf(entry.from), radiusOf(entry.to)]);
      const weight = entry.weight;
      const failed = weight === null;
      const hairline = !failed && weight < HAIRLINE_BELOW;
      const width =
        failed || hairline ? HAIRLINE : 1 + 3 * cellShade(weight).alpha;
      const alpha =
        failed || hairline
          ? FAINT_ALPHA
          : FAINT_ALPHA + (1 - FAINT_ALPHA) * cellShade(weight).alpha;
      return h(
        "g",
        {
          key: entry.key,
          class: [
            "mp-const-edge",
            failed ? "mp-const-failed" : "",
            entry.highlight === true ? "mp-const-hi" : "",
            entry.pulse === true ? "mp-const-pulse" : "",
          ],
          style: {
            "--mp-edge-alpha": alpha.toFixed(3),
            "--mp-edge-width": width.toFixed(2),
            // A dash as long as the arc, offset away and animated back.
            "--mp-edge-len": fixed(drawn.length + 2),
          },
        },
        [
          h("path", { class: "mp-const-arc", d: drawn.curve }),
          h("path", { class: "mp-const-head", d: drawn.head }),
        ],
      );
    };

    const node = (
      name: string,
      index: number,
      points: readonly Point[],
    ): VNode | null => {
      const point = points[index];
      if (point === undefined) {
        return null;
      }
      const hub = props.layout === "hub" && index === 0;
      const highlighted = props.highlightNodes.includes(index);
      const place = hub
        ? {
            x: point.x,
            y: point.y + HUB_RADIUS + 16,
            anchor: "middle" as const,
          }
        : labelPlacement(point);
      return h(
        "g",
        {
          key: name,
          class: ["mp-const-node", highlighted ? "mp-const-node-hi" : ""],
          style: { "--mp-i": String(index) },
        },
        [
          h("circle", {
            cx: fixed(point.x),
            cy: fixed(point.y),
            r: radiusOf(index),
          }),
          h(
            "text",
            {
              class: ["mp-const-label", hub ? "mp-const-label-hub" : ""],
              x: fixed(place.x),
              y: fixed(place.y),
              "text-anchor": place.anchor,
            },
            [h("title", name), truncate(name)],
          ),
        ],
      );
    };

    return (): VNode => {
      const points = positions(props.nodes.length, props.layout);
      // The count sits in the ring's middle; with a node there, just above it.
      const countAt =
        props.layout === "hub"
          ? { x: CENTRE.x, y: CENTRE.y - HUB_RADIUS - 12 }
          : { x: CENTRE.x, y: CENTRE.y + 7 };
      return h(
        "div",
        {
          class: ["mp-const", props.settled ? "mp-const-settled" : ""],
          "aria-hidden": "true",
        },
        [
          h(
            "svg",
            {
              class: "mp-const-svg",
              viewBox: `0 0 ${String(VIEW.width)} ${String(VIEW.height)}`,
              focusable: "false",
            },
            [
              h(
                "g",
                { class: "mp-const-edges" },
                props.edges.map((entry) => edge(entry, points)),
              ),
              h(
                "g",
                { class: "mp-const-nodes" },
                props.nodes.map((name, index) => node(name, index, points)),
              ),
              props.count === null
                ? null
                : h(
                    "text",
                    {
                      class: "mp-const-count",
                      x: fixed(countAt.x),
                      y: fixed(countAt.y),
                      "text-anchor": "middle",
                    },
                    props.count,
                  ),
            ],
          ),
        ],
      );
    };
  },
});
