// The right column, sticky beside the workbench: the setup snippet plus
// every call behind what is on screen — and, for the loop reports, the
// loop program with its helper behind a disclosure — highlighted by the
// model's tokenizer. Tokens get the same `--shiki-light` / `--shiki-dark`
// variables Shiki emits, so the block matches the site's code blocks in
// both color schemes. While a loop runs, its `await` line carries a
// caret and a live comment beneath it (a clock face turning on the
// panel's own timer); when it is done, a summary comment follows the
// loop. Both are decoration on the rendered lines, outside the program
// text, so what "Copy code" takes is the program alone.

import {
  computed,
  defineComponent,
  h,
  onBeforeUnmount,
  type PropType,
  ref,
  type VNode,
  watch,
} from "vue";

import { type Call, renderCall } from "../model/call.js";
import { tokenize } from "../model/code-highlight.js";
import { withImports } from "../model/setup-snippets.js";
import {
  clockFace,
  DONE_EMOJI,
  liveTrace,
  type TracedCall,
  type TraceLine,
  traceSummary,
} from "../model/trace.js";

/** Token colors: the values of the two theme/shiki-mixpanel-*.json files. */
const COLORS: Readonly<Record<string, readonly [light: string, dark: string]>> =
  {
    keyword: ["#e34f2f", "#ef6347"],
    string: ["#219464", "#2eb87d"],
    number: ["#df7800", "#f08d1c"],
    comment: ["#8f8f91", "#9a9a9c"],
    punct: ["#626266", "#c0c0c0"],
    ident: ["#626266", "#e0e0e0"],
  };

/** A loop run as the panel traces it, drawn beside the program's lines. */
export interface CodeTrace {
  /** The loop's calls with their timings so far. */
  readonly calls: readonly TracedCall[];
  /** Index of the call in flight, or `null`. */
  readonly current: number | null;
  /** `performance.now()` when the call in flight began, or `null`. */
  readonly startedAt: number | null;
}

/** The trace resolved for one render. */
interface Decoration {
  /** The program's first line in the block (the trace goes below it). */
  readonly from: number;
  /** Whether an iteration is in flight (the caret shows). */
  readonly running: boolean;
  /** Calls settled so far (each one re-strikes the gutter tick). */
  readonly settled: number;
  /** The comment under the `await` line, or `null`. */
  readonly live: TraceLine | null;
  /** The comment under the loop's closing brace once it is done, or `null`. */
  readonly summary: TraceLine | null;
}

/** One step of the clock face: a revolution every 4.8 s, slow enough that the hands read as turning rather than flickering. */
const CLOCK_STEP_MS = 200;

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
 * An emoji in the system font, so the monospace font does not substitute.
 *
 * @param emoji - The emoji.
 * @returns The span.
 */
const emojiSpan = (emoji: string): VNode =>
  h("span", { class: "mp-code-emoji" }, emoji);

/**
 * The gutter of the loop's `await` line: a caret while an iteration is
 * in flight, and a check keyed by the settled count so each landing
 * strikes it afresh (it fades and stays).
 *
 * @param decoration - The resolved trace.
 * @returns The gutter node.
 */
function gutter(decoration: Decoration): VNode {
  return h("span", { class: "mp-code-gutter", "aria-hidden": "true" }, [
    decoration.settled > 0
      ? h(
          "span",
          { key: decoration.settled, class: "mp-code-tick mp-code-emoji" },
          DONE_EMOJI,
        )
      : null,
    decoration.running ? h("span", { class: "mp-code-caret" }, "▍") : null,
  ]);
}

/**
 * A trace comment as an extra block under a line, indented like it so it
 * reads as part of the program — though it is not a line of it (selection
 * and copying skip it), nor for assistive technology (the result panel's
 * status line says the same).
 *
 * @param key - Vue key.
 * @param line - The state emoji and the text after it.
 * @param annotated - The text of the line it sits under.
 * @returns The block.
 */
const traceLine = (key: string, line: TraceLine, annotated: string): VNode =>
  h("span", { key, class: "mp-code-trace", "aria-hidden": "true" }, [
    `${/^\s*/u.exec(annotated)?.[0] ?? ""}//  `,
    emojiSpan(line.emoji),
    ` ${line.text}`,
  ]);

/**
 * Highlight a program: one block per source line (so a line that wraps
 * gets a hanging indent from the stylesheet), one span per token in it.
 * With a decoration, the loop's `await` line — found by its text, from
 * the program's first line on — gets the gutter and the live comment,
 * and the loop's closing brace the summary.
 *
 * @param code - The program text.
 * @param decoration - The trace to draw, or `null`.
 * @returns One line block per line, trailing newline dropped, plus any
 *   trace blocks.
 */
function highlight(
  code: string,
  decoration: Decoration | null = null,
): VNode[] {
  const lines: Array<{ spans: VNode[]; text: string }> = [
    { spans: [], text: "" },
  ];
  for (const token of tokenize(code)) {
    const color = COLORS[token.type];
    for (const [k, text] of token.text.split("\n").entries()) {
      if (k > 0) {
        lines.push({ spans: [], text: "" });
      }
      const line = lines.at(-1);
      if (text !== "" && line !== undefined) {
        line.text += text;
        // Strings carry hyphens and slashes (module specifiers, URLs),
        // which browsers treat as break opportunities; the class keeps
        // them whole.
        const string = token.type === "string" ? "mp-code-string" : "";
        line.spans.push(
          h(
            "span",
            color === undefined
              ? { key: line.spans.length, class: string }
              : {
                  key: line.spans.length,
                  class: string,
                  style: {
                    "--shiki-light": color[0],
                    "--shiki-dark": color[1],
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
  const live =
    decoration === null
      ? -1
      : lines.findIndex(
          (line, i) => i >= decoration.from && line.text.includes("await ws."),
        );
  const close =
    live === -1
      ? -1
      : lines.findIndex((line, i) => i > live && line.text === "}");
  return lines.flatMap(({ spans, text: lineText }, i) => {
    if (decoration === null || i !== live) {
      const plain = h("span", { key: i, class: "mp-code-line" }, spans);
      return i === close && decoration?.summary != null
        ? [
            plain,
            traceLine(`summary-${String(i)}`, decoration.summary, lineText),
          ]
        : [plain];
    }
    const block = h(
      "span",
      { key: i, class: ["mp-code-line", "mp-code-live"] },
      [gutter(decoration), ...spans],
    );
    return decoration.live === null
      ? [block]
      : [block, traceLine(`live-${String(i)}`, decoration.live, lineText)];
  });
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
    /** The loop run the panel traces beside the program; `null` for none. */
    trace: { type: Object as PropType<CodeTrace | null>, default: null },
  },
  setup(props) {
    const copied = ref(false);
    // One timer for the whole run, so the clock keeps turning across
    // iterations and the elapsed time counts up; it stops with the loop
    // and never starts under reduced motion (a still dial instead).
    const tick = ref(0);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = (): void => {
      if (timer === null) {
        return;
      }
      clearInterval(timer);
      timer = null;
    };
    watch(
      () => props.trace !== null && props.trace.current !== null,
      (running) => {
        stop();
        if (running && !reduced.matches) {
          timer = setInterval(() => {
            tick.value += 1;
          }, CLOCK_STEP_MS);
        }
      },
      { immediate: true },
    );
    onBeforeUnmount(stop);
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
    // The program is the tail of the block, so its first line is the
    // block's line count less the program's. Reading `tick` here is what
    // re-renders the live line every step.
    const decoration = computed((): Decoration | null => {
      const { trace, program } = props;
      if (trace === null || program === null) {
        return null;
      }
      const total = text.value.split("\n").length - 1;
      const lines = program.trimEnd().split("\n").length;
      const running = trace.current !== null;
      const motion = !reduced.matches;
      const elapsedMs =
        running && motion && trace.startedAt !== null
          ? performance.now() - trace.startedAt
          : null;
      return {
        from: Math.max(0, total - lines),
        running,
        settled: trace.calls.filter((call) => call.durationMs !== null).length,
        live: liveTrace(trace.calls, {
          current: trace.current,
          elapsedMs,
          clock: clockFace(motion ? tick.value : 0),
        }),
        summary: running ? null : traceSummary(trace.calls),
      };
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
          h("code", highlight(text.value, decoration.value)),
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
