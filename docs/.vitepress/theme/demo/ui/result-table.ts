// The result's rows exactly as `toRows()` returns them, under the columns
// `rowColumns()` names — the same data "Copy as Markdown" exports, so a
// visitor can check the table against the library's own output shape.
// Numbers are formatted and midnight timestamps trimmed to the day for
// display only; the Markdown export stays raw.

import { defineComponent, h, type PropType } from "vue";

import { formatCount, formatPct } from "../model/series.js";

/** A result row (`Row` from the facade: column → value). */
export type ResultRow = Readonly<Record<string, unknown>>;

const RATIO_COLUMN = /(?:ratio|rate)$/u;
/** A day-granular timestamp as the query API returns it. */
const MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00:00$/u;

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
  if (typeof value === "string") {
    return MIDNIGHT.exec(value)?.[1] ?? value;
  }
  return JSON.stringify(value);
}

/** Result table. */
export default defineComponent({
  name: "DemoResultTable",
  props: {
    columns: { type: Array as PropType<readonly string[]>, required: true },
    rows: { type: Array as PropType<readonly ResultRow[]>, required: true },
  },
  setup(props) {
    return () => {
      // Numeric columns (by the first row) right-align header and cells.
      const first = props.rows[0];
      const numeric = (column: string): string =>
        typeof first?.[column] === "number" ? "mp-num" : "";
      // The id lets the chart name these rows as its long description.
      return h("div", { class: "mp-table-wrap", id: "mp-result-table" }, [
        h("table", { class: "mp-table" }, [
          h("thead", [
            h(
              "tr",
              props.columns.map((column) =>
                h("th", { key: column, class: numeric(column) }, column),
              ),
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
                      class: numeric(column),
                      title:
                        typeof row[column] === "string" &&
                        MIDNIGHT.test(row[column])
                          ? row[column]
                          : undefined,
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
    };
  },
});
