// "Copy as Markdown" (docs/.vitepress/theme/demo/model/markdown-table.ts):
// a GFM table from `rowColumns()` / `toRows()` of a result the real library
// built over the fixture transport, with raw numbers, escaped pipes, and the
// generated code in a fence above it.

import { describe, expect, it } from "vitest";

import { createBrowserWorkspace } from "@mixpanel-headless/browser";

import { DEMO_FIXTURES } from "../docs/.vitepress/theme/demo/fixtures/demo-project.gen.js";
import { renderCall } from "../docs/.vitepress/theme/demo/model/call.js";
import { fixtureFetch } from "../docs/.vitepress/theme/demo/model/fixture-fetch.js";
import {
  MARKDOWN_HEADER,
  toMarkdown,
} from "../docs/.vitepress/theme/demo/model/markdown-table.js";
import { toCall } from "../docs/.vitepress/theme/demo/model/query-spec.js";

const ws = createBrowserWorkspace({
  token: "demo",
  projectId: "3141592",
  region: "us",
  workspaceId: 1,
  fetch: fixtureFetch(DEMO_FIXTURES, { today: () => new Date(2026, 8, 15) }),
});

describe("toMarkdown", () => {
  it("renders a real query result as a GFM table under the code", async () => {
    const call = toCall({
      kind: "trend",
      event: "Note Saved",
      math: "total",
      last: 7,
    });
    const result = await ws.query("Note Saved", { math: "total", last: 7 });
    const markdown = toMarkdown({
      code: renderCall(call),
      columns: result.rowColumns(),
      rows: result.toRows(),
    });
    const lines = markdown.split("\n");
    expect(lines[0]).toBe(MARKDOWN_HEADER);
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("```ts");
    // The rendered call spans several lines (one option key per line).
    const close = lines.indexOf("```", 3);
    expect(lines.slice(3, close).join("\n")).toBe(renderCall(call));
    expect(lines[close + 1]).toBe("");
    expect(lines[close + 2]).toBe("| date | event | count |");
    expect(lines[close + 3]).toBe("| --- | --- | --- |");
    expect(lines[close + 4]).toBe(
      `| 2026-09-09T00:00:00 | Note Saved | ${String(result.toRows()[0]?.["count"])} |`,
    );
    expect(lines.slice(close + 4, -1)).toHaveLength(7);
    expect(markdown.endsWith("|\n")).toBe(true);
  });

  it("keeps numbers raw", () => {
    const markdown = toMarkdown({
      code: "x",
      columns: ["count", "rate"],
      rows: [{ count: 45_407, rate: 0.6098 }],
    });
    expect(markdown).toContain("| 45407 | 0.6098 |");
  });

  it("escapes pipes and flattens line breaks inside cells", () => {
    const markdown = toMarkdown({
      code: "x",
      columns: ["event", "note"],
      rows: [{ event: "a|b", note: "two\nlines" }],
    });
    expect(markdown).toContain(String.raw`| a\|b | two lines |`);
  });

  it("renders missing and nested cells", () => {
    const markdown = toMarkdown({
      code: "x",
      columns: ["a", "b", "c"],
      rows: [{ a: null, c: { deep: [1, "x|y"] } }],
    });
    expect(markdown).toContain(String.raw`|  |  | {"deep":[1,"x\|y"]} |`);
  });

  it("escapes a pipe in a column name", () => {
    const markdown = toMarkdown({ code: "x", columns: ["a|b"], rows: [] });
    expect(markdown).toContain(String.raw`| a\|b |`);
  });
});
