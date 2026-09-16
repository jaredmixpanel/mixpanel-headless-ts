// The playground's live trace (docs/.vitepress/theme/demo/model/trace.ts):
// the comment lines the code panel draws beside a running loop are pure
// text over the calls and their timings, opened by an emoji for the state
// (a stopwatch before, a turning clock face during, a check after), and
// they stay decoration — what "Copy code" and the Markdown export take is
// the program text, never the panel's DOM, so no clipboard write in the
// UI can reach them.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ahaCalls } from "../docs/.vitepress/theme/demo/model/aha.js";
import { matrixCalls } from "../docs/.vitepress/theme/demo/model/matrix.js";
import { topEventsCall } from "../docs/.vitepress/theme/demo/model/query-spec.js";
import {
  CLOCK_FACES,
  clockFace,
  DONE_EMOJI,
  formatDuration,
  IDLE_EMOJI,
  liveTrace,
  type TracedCall,
  traceLabel,
  traceSummary,
} from "../docs/.vitepress/theme/demo/model/trace.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UI = join(REPO_ROOT, "docs/.vitepress/theme/demo/ui");

const FUNNELS = matrixCalls({
  kind: "matrix",
  events: ["Signup", "Note Saved", "Note Shared"],
  conversionWindow: 7,
  last: 30,
});

const RETENTIONS = ahaCalls({
  kind: "aha",
  born: "Signup",
  candidates: ["Note Shared", "Note Saved", "Search"],
  retentionUnit: "week",
  last: 30,
});

/**
 * The funnel calls with the first `durations.length` settled.
 *
 * @param durations - One duration per settled call; `NaN` marks a failure.
 * @returns The traced calls.
 */
const traced = (durations: readonly number[]): TracedCall[] =>
  FUNNELS.map((call, i) => {
    const duration = durations[i];
    if (duration === undefined) {
      return { call, durationMs: null, failed: false };
    }
    const failed = Number.isNaN(duration);
    return { call, durationMs: failed ? 200 : duration, failed };
  });

describe("formatDuration", () => {
  it.each([
    [0, "0 ms"],
    [183.4, "183 ms"],
    [999.4, "999 ms"],
    [999.6, "1.0 s"],
    [4213, "4.2 s"],
    [-5, "0 ms"],
  ])("formats %d ms as %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("traceLabel", () => {
  it("quotes a funnel's two steps with an arrow between them", () => {
    expect(traceLabel(FUNNELS[0]!)).toBe('"Signup" → "Note Saved"');
  });

  it("quotes a retention query's return event", () => {
    expect(traceLabel(RETENTIONS[0]!)).toBe('"Note Shared"');
  });

  it("falls back to the binding for any other call", () => {
    expect(traceLabel(topEventsCall())).toBe(topEventsCall().binding);
  });
});

describe("the state emoji", () => {
  it("lists the twenty-four clock faces from twelve o'clock, hour and half hour alternating", () => {
    expect(CLOCK_FACES).toHaveLength(24);
    expect(CLOCK_FACES.slice(0, 6)).toStrictEqual([
      "🕛",
      "🕧",
      "🕐",
      "🕜",
      "🕑",
      "🕝",
    ]);
    expect(CLOCK_FACES.at(-1)).toBe("🕦");
    expect(new Set(CLOCK_FACES).size).toBe(24);
  });

  it("turns the hands one step per tick and comes round after twenty-four", () => {
    expect(clockFace(0)).toBe("🕛");
    expect(clockFace(3)).toBe("🕜");
    expect(clockFace(24)).toBe("🕛");
    expect(clockFace(25)).toBe("🕧");
    expect(clockFace(-2)).toBe("🕛");
  });

  it("presents the stopwatch as emoji, not as a text symbol", () => {
    expect(IDLE_EMOJI).toBe("⏱️");
    expect(DONE_EMOJI).toBe("✅");
  });
});

describe("liveTrace", () => {
  const clock = "🕒";

  it("is null for an empty loop", () => {
    expect(liveTrace([], { current: null, elapsedMs: null, clock })).toBeNull();
  });

  it("says nothing has run yet, with the stopwatch", () => {
    expect(
      liveTrace(traced([]), { current: null, elapsedMs: null, clock }),
    ).toStrictEqual({ emoji: IDLE_EMOJI, text: "0 / 6" });
  });

  it("names the iteration in flight with the clock face and its elapsed time", () => {
    expect(
      liveTrace(traced([150]), { current: 1, elapsedMs: 183.4, clock }),
    ).toStrictEqual({
      emoji: clock,
      text: '2 / 6 · "Signup" → "Note Shared" · 183 ms',
    });
  });

  it("leaves the elapsed time out when asked (reduced motion)", () => {
    expect(
      liveTrace(traced([150]), { current: 1, elapsedMs: null, clock: "🕛" }),
    ).toStrictEqual({ emoji: "🕛", text: '2 / 6 · "Signup" → "Note Shared"' });
  });

  it("is null once calls have settled and none is in flight (the summary takes over)", () => {
    expect(
      liveTrace(traced([150, 90]), { current: null, elapsedMs: null, clock }),
    ).toBeNull();
  });
});

describe("traceSummary", () => {
  it("is null until a call has settled", () => {
    expect(traceSummary(traced([]))).toBeNull();
    expect(traceSummary([])).toBeNull();
  });

  it("counts the queries, sums their time and names the slowest, with the check", () => {
    expect(traceSummary(traced([150, 412, 160, 170, 180, 190]))).toStrictEqual({
      emoji: DONE_EMOJI,
      text: '6 queries · 1.3 s · slowest "Signup" → "Note Shared" 412 ms',
    });
  });

  it("says how far a stopped loop got", () => {
    expect(traceSummary(traced([150, 90]))?.text).toBe(
      '2 of 6 queries · 240 ms · slowest "Signup" → "Note Saved" 150 ms',
    );
  });
});

describe("the trace never reaches the clipboard", () => {
  it.each(["code-panel.ts", "playground.ts"])(
    "%s writes nothing trace-related to the clipboard",
    (file) => {
      const source = readFileSync(join(UI, file), "utf8");
      const writes = [...source.matchAll(/writeText\(([^)]*)\)/gu)].map(
        (match) => match[1] ?? "",
      );
      expect(writes.length).toBeGreaterThan(0);
      for (const argument of writes) {
        expect(argument).not.toMatch(/trace|emoji/iu);
        expect(argument).not.toMatch(/document|querySelector|textContent/u);
      }
    },
  );

  it("draws the trace as hidden, unselectable blocks outside the program, emoji in the system font", () => {
    const panel = readFileSync(join(UI, "code-panel.ts"), "utf8");
    expect(panel).toMatch(/class: "mp-code-trace", "aria-hidden": "true"/u);
    const css = readFileSync(join(UI, "demo.css"), "utf8");
    expect(css).toMatch(/\.mp-code-trace \{[^}]*user-select: none/u);
    expect(css).toMatch(/\.mp-code-emoji \{[^}]*font-family: system-ui/u);
  });
});
