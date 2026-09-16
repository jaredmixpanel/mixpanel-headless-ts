// The right column, sticky beside the workbench: the setup snippet plus
// every call behind what is on screen — and, for the ranking report, the
// loop program with its helper behind a disclosure — highlighted by the
// model's tokenizer. Tokens get the same `--shiki-light` / `--shiki-dark`
// variables Shiki emits, so the block matches the site's code blocks in
// both colour schemes.

import {
  computed,
  defineComponent,
  h,
  type PropType,
  ref,
  type VNode,
} from "vue";

import { type Call, renderCall } from "../model/call.js";
import { tokenize } from "../model/code-highlight.js";
import { withImports } from "../model/setup-snippets.js";

/** Token colours: the values of the two theme/shiki-mixpanel-*.json files. */
const COLOURS: Readonly<
  Record<string, readonly [light: string, dark: string]>
> = {
  keyword: ["#e34f2f", "#ef6347"],
  string: ["#219464", "#2eb87d"],
  number: ["#df7800", "#f08d1c"],
  comment: ["#8f8f91", "#9a9a9c"],
  punct: ["#626266", "#c0c0c0"],
  ident: ["#626266", "#e0e0e0"],
};

/** A helper function the panel shows collapsed under the program. */
export interface CodeHelper {
  /** The disclosure's label. */
  readonly summary: string;
  /** The helper's source text. */
  readonly source: string;
}

/**
 * Build the program the panel shows: the setup (its import line extended
 * with whatever the calls need), a blank line, then the calls and, when a
 * run prints as a program rather than one statement, that program.
 *
 * @param setup - The mode's setup snippet.
 * @param calls - The calls, in order.
 * @param program - Program text to append after the calls, if any.
 * @returns The program text.
 */
export function programText(
  setup: string,
  calls: readonly Call[],
  program = "",
): string {
  const prefix = withImports(
    setup,
    calls.flatMap((call) => call.imports),
  ).trimEnd();
  const body = [...calls.map((call) => renderCall(call)), program.trimEnd()]
    .filter((text) => text !== "")
    .join("\n");
  return `${prefix}\n\n${body}\n`;
}

/**
 * Highlight a program: one block per source line (so a line that wraps
 * gets a hanging indent from the stylesheet), one span per token in it.
 *
 * @param code - The program text.
 * @returns One line block per line, trailing newline dropped.
 */
function highlight(code: string): VNode[] {
  const lines: VNode[][] = [[]];
  for (const token of tokenize(code)) {
    const colour = COLOURS[token.type];
    for (const [k, text] of token.text.split("\n").entries()) {
      if (k > 0) {
        lines.push([]);
      }
      if (text !== "") {
        const line = lines.at(-1);
        // Strings carry hyphens and slashes (module specifiers, URLs),
        // which browsers treat as break opportunities; the class keeps
        // them whole.
        const string = token.type === "string" ? "mp-code-string" : "";
        line?.push(
          h(
            "span",
            colour === undefined
              ? { key: line.length, class: string }
              : {
                  key: line.length,
                  class: string,
                  style: {
                    "--shiki-light": colour[0],
                    "--shiki-dark": colour[1],
                  },
                },
            text,
          ),
        );
      }
    }
  }
  if (code.endsWith("\n")) {
    lines.pop();
  }
  return lines.map((spans, i) =>
    h("span", { key: i, class: "mp-code-line" }, spans),
  );
}

/** Code panel. */
export default defineComponent({
  name: "DemoCodePanel",
  props: {
    setup: { type: String, required: true },
    calls: { type: Array as PropType<readonly Call[]>, required: true },
    /** `rowColumns()` of the current result, shown under the code. */
    columns: {
      type: Array as PropType<readonly string[] | null>,
      default: null,
    },
    resultBinding: { type: String as PropType<string | null>, default: null },
    /**
     * A comment line closing the program while the shown engine has no
     * query to print (its tab is open, nothing has run there yet).
     */
    placeholder: { type: String as PropType<string | null>, default: null },
    /** A program printed after the calls (the ranking report's loop). */
    program: { type: String as PropType<string | null>, default: null },
    /** A helper the program calls, shown collapsed and copied with it. */
    helper: { type: Object as PropType<CodeHelper | null>, default: null },
  },
  setup(props) {
    const copied = ref(false);
    const text = computed(() => {
      const program = programText(
        props.setup,
        props.calls,
        props.program ?? "",
      );
      return props.placeholder === null
        ? program
        : `${program}${props.placeholder}\n`;
    });
    // The copied block is complete: the helper the program calls goes
    // with it, whether or not the disclosure is open.
    const copy = async (): Promise<void> => {
      const helper =
        props.helper === null ? "" : `\n${props.helper.source.trimEnd()}\n`;
      await navigator.clipboard.writeText(`${text.value}${helper}`);
      copied.value = true;
      setTimeout(() => {
        copied.value = false;
      }, 1500);
    };
    return () =>
      h("div", { class: "mp-codepanel" }, [
        h("div", { class: "mp-col-head" }, [
          h("h2", "Code"),
          h(
            "button",
            {
              type: "button",
              class: "mp-btn",
              onClick: () => void copy(),
            },
            copied.value ? "Copied" : "Copy code",
          ),
        ]),
        h("pre", { class: "mp-code", tabindex: 0 }, [
          h("code", highlight(text.value)),
        ]),
        props.helper === null
          ? null
          : h("details", { class: "mp-details mp-code-helper" }, [
              h("summary", props.helper.summary),
              h("pre", { class: "mp-code", tabindex: 0 }, [
                h("code", highlight(props.helper.source)),
              ]),
            ]),
        props.columns === null || props.resultBinding === null
          ? null
          : h("div", { class: "mp-code-result" }, [
              h("h3", "Result"),
              h("pre", { class: "mp-code" }, [
                h(
                  "code",
                  highlight(
                    `${props.resultBinding}.rowColumns();\n// ${JSON.stringify(props.columns)}\n`,
                  ),
                ),
              ]),
            ]),
      ]);
  },
});
