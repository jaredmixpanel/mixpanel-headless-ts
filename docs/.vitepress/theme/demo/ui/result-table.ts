// The result's rows exactly as `toRows()` returns them, under the columns
// `rowColumns()` names — the same data "Copy as Markdown" exports, so a
// visitor can check the table against the library's own output shape.
// Numbers are formatted for display only; the Markdown export stays raw.

import { defineComponent, h, type PropType } from "vue";

import { formatCount, formatPct } from "../model/series.js";

/** A result row (`Row` from the facade: column → value). */
export type ResultRow = Readonly<Record<string, unknown>>;

const RATIO_COLUMN = /(?:ratio|rate)$/u;

/**
 * Format one cell for display: ratio columns as percentages, other numbers
 * with grouping, everything else as text.
 *
 * @param column - The column name.
 * @param value - The raw cell.
 * @returns The display text.
 */
function formatCell(column: string, value: unknown): string {
  if (typeof value === "number") {
    return RATIO_COLUMN.test(column) ? formatPct(value) : formatCount(value);
  }
  if (value === null || value === undefined) {
    return "—";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Result table. */
export default defineComponent({
  name: "DemoResultTable",
  props: {
    columns: { type: Array as PropType<readonly string[]>, required: true },
    rows: { type: Array as PropType<readonly ResultRow[]>, required: true },
  },
  setup(props) {
    return () =>
      // The id lets the chart name these rows as its long description.
      h("div", { class: "mp-table-wrap", id: "mp-result-table" }, [
        h("table", { class: "mp-table" }, [
          h("thead", [
            h(
              "tr",
              props.columns.map((column) => h("th", { key: column }, column)),
            ),
          ]),
          h(
            "tbody",
            props.rows.map((row, i) =>
              h(
                "tr",
                { key: i },
                props.columns.map((column) =>
                  h(
                    "td",
                    {
                      key: column,
                      class: typeof row[column] === "number" ? "mp-num" : "",
                    },
                    formatCell(column, row[column]),
                  ),
                ),
              ),
            ),
          ),
        ]),
        h("p", { class: "mp-table-foot" }, `${props.rows.length} rows`),
      ]);
  },
});
