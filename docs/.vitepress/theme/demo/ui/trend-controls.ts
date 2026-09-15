// The trend tab's controls row: math, the breakdown property, the active
// `where` filter, and the value chips a breakdown offers as filters. Every
// control emits; the playground rebuilds the spec and runs it, so this
// component never touches the facade.

import { defineComponent, h, type PropType, type VNode } from "vue";

import {
  TREND_MATHS,
  type TrendMath,
  type TrendSpec,
  type WhereFilter,
} from "../model/query-spec.js";
import { button, segmented, select } from "./el.js";
import type { PropertyValues } from "./use-query.js";

/** Trend controls. */
export default defineComponent({
  name: "DemoTrendControls",
  props: {
    spec: { type: Object as PropType<TrendSpec>, required: true },
    properties: {
      type: Array as PropType<readonly string[] | null>,
      default: null,
    },
    values: { type: Object as PropType<PropertyValues | null>, default: null },
  },
  emits: {
    math: (math: TrendMath) => typeof math === "string",
    breakdownOpen: () => true,
    groupBy: (property: string | null) => property === null || property !== "",
    values: (property: string) => property !== "",
    where: (where: WhereFilter | null) =>
      where === null || where.property !== "",
  },
  setup(props, { emit }) {
    const breakdown = (spec: TrendSpec): VNode =>
      props.properties === null
        ? button("Break down by…", () => emit("breakdownOpen"), {
            class: "mp-btn",
          })
        : h("label", { class: "mp-field mp-field-inline" }, [
            h("span", { class: "mp-field-caption" }, "Break down by"),
            select(
              [
                { value: "", label: "—" },
                ...props.properties.map((p) => ({ value: p, label: p })),
              ],
              spec.groupBy ?? "",
              (p) => emit("groupBy", p === "" ? null : p),
            ),
          ]);

    const filterLine = (where: WhereFilter): VNode =>
      h("p", { class: "mp-filter-line" }, [
        "filtered by ",
        h("code", where.property),
        " = ",
        h("code", where.value),
        button("×", () => emit("where", null), {
          class: "mp-btn mp-btn-icon mp-filter-clear",
          "aria-label": `Clear the ${where.property} filter`,
          title: "Clear filter",
        }),
      ]);

    // A chip is a toggle: pressing the active one clears the filter.
    const chips = (spec: TrendSpec): VNode | null => {
      const values = props.values;
      if (values === null) {
        return null;
      }
      const isActive = (v: string): boolean =>
        spec.where?.property === values.property && spec.where.value === v;
      return h(
        "div",
        {
          class: "mp-chips",
          role: "group",
          "aria-label": `Filter by ${values.property}`,
        },
        values.values.map((v) =>
          button(
            v,
            () =>
              emit(
                "where",
                isActive(v) ? null : { property: values.property, value: v },
              ),
            {
              key: v,
              class: "mp-chip mp-chip-toggle",
              "aria-pressed": isActive(v),
            },
          ),
        ),
      );
    };

    return () => {
      const { spec } = props;
      return h("div", { class: "mp-trend-controls" }, [
        h("div", { class: "mp-controls" }, [
          segmented(
            TREND_MATHS.map((m) => ({ value: m, label: m })),
            spec.math,
            (m) => emit("math", m),
            "Math",
          ),
          breakdown(spec),
          spec.groupBy === undefined
            ? null
            : button(
                `values of ${spec.groupBy}`,
                () => emit("values", spec.groupBy ?? ""),
                { class: "mp-btn" },
              ),
          spec.where === undefined ? null : filterLine(spec.where),
        ]),
        chips(spec),
      ]);
    };
  },
});
