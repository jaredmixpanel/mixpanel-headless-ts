// The playground's single-source-of-truth rule (docs/.vitepress/theme/demo/
// model/call.ts, query-spec.ts): the TypeScript the code panel shows is
// the call that ran. Re-parses every rendered argument list back into the
// `Call` (expressions as their tag plus arguments), pins the read-only
// method allowlist, the closed expression table and the option-key order,
// checks the import merge that keeps a copied block compiling, and
// snapshots every rendered block so a change to the printer is a
// reviewable diff. Also covers the tokenizer that colors those blocks.

import { describe, expect, it } from "vitest";

import { Filter } from "@mixpanel-headless/browser";
import { MATH_TYPE_VALUES } from "@mixpanel-headless/core";

import {
  type Call,
  type CallArg,
  EXPR_NAMES,
  isBindingRef,
  isExprArg,
  printArgs,
  READ_METHODS,
  renderCall,
  runCall,
} from "../docs/.vitepress/theme/demo/model/call.js";
import { tokenize } from "../docs/.vitepress/theme/demo/model/code-highlight.js";
import {
  eventsCall,
  propertiesCall,
  propertyValuesCall,
  type QuerySpec,
  reportLinkCall,
  toCall,
  topEventsCall,
  TREND_MATHS,
  type TrendSpec,
  withWhere,
} from "../docs/.vitepress/theme/demo/model/query-spec.js";
import {
  LIVE_SETUP,
  OFFLINE_SETUP,
  withImports,
} from "../docs/.vitepress/theme/demo/model/setup-snippets.js";

/** A property that is not an identifier, so its key must print quoted. */
const QUOTED_KEY_SPEC: QuerySpec = {
  kind: "trend",
  event: "App Opened",
  math: "total",
  last: 30,
  groupBy: "$browser",
};

/** The filtered query the playground page's third twoslash block shows. */
const FILTERED_SPEC: TrendSpec = {
  kind: "trend",
  event: "Note Saved",
  math: "total",
  last: 30,
  where: { property: "platform", value: "iOS" },
};

const SPECS: ReadonlyArray<readonly [string, QuerySpec]> = [
  [
    "trend, total, 30 days",
    { kind: "trend", event: "Note Saved", math: "total", last: 30 },
  ],
  [
    "trend, unique, 7 days",
    { kind: "trend", event: "Note Saved", math: "unique", last: 7 },
  ],
  [
    "trend, dau, 90 days, broken down",
    {
      kind: "trend",
      event: "Note Saved",
      math: "dau",
      last: 90,
      groupBy: "platform",
    },
  ],
  ["trend with a quoted-key property", QUOTED_KEY_SPEC],
  ["trend, filtered", FILTERED_SPEC],
  [
    "trend, broken down and filtered on another property",
    {
      kind: "trend",
      event: "Note Saved",
      math: "unique",
      last: 7,
      groupBy: "plan",
      where: { property: "platform", value: "Android" },
    },
  ],
  [
    "funnel, three steps, default window",
    {
      kind: "funnel",
      steps: ["Signup", "Note Saved", "Note Shared"],
      last: 30,
    },
  ],
  [
    "funnel, two steps, 7-day window",
    {
      kind: "funnel",
      steps: ["Signup", "Note Saved"],
      last: 7,
      conversionWindow: 7,
    },
  ],
  [
    "retention, weekly",
    {
      kind: "retention",
      born: "Signup",
      returnEvent: "Note Saved",
      retentionUnit: "week",
      last: 30,
    },
  ],
  [
    "retention, daily",
    {
      kind: "retention",
      born: "Signup",
      returnEvent: "App Opened",
      retentionUnit: "day",
      last: 7,
    },
  ],
];

const DISCOVERY: ReadonlyArray<readonly [string, Call]> = [
  ["top events", topEventsCall()],
  ["properties", propertiesCall("Note Saved")],
  ["property values", propertyValuesCall("platform", "Note Saved")],
  ["event names", eventsCall()],
  [
    "report link",
    reportLinkCall("result", "Playground: Note Saved, last 30 days"),
  ],
];

const ALL: ReadonlyArray<readonly [string, Call]> = [
  ...SPECS.map(([name, spec]) => [name, toCall(spec)] as const),
  ...DISCOVERY,
];

/** Matches `Name.member(<args>)` for every expression the table knows. */
const EXPRESSION_CALL = new RegExp(
  String.raw`\b(${EXPR_NAMES.map((name) => name.replaceAll(".", String.raw`\.`)).join("|")})\(([^()]*)\)`,
  "gu",
);

/**
 * Turn the printed argument list back into JSON: rewrite an expression
 * call as its tag object, quote identifier keys, drop trailing commas, and
 * quote the bare identifiers binding refs print as, so `JSON.parse` yields
 * the original `args` (refs as their names, expressions as themselves).
 *
 * @param call - The call whose arguments were printed.
 * @returns The parsed arguments.
 */
function reparse(call: Call): unknown[] {
  let text = printArgs(call.args)
    .replaceAll(
      EXPRESSION_CALL,
      (_match, name: string, args: string) =>
        `{"$expr":"${name}","args":[${args}]}`,
    )
    .replaceAll(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/gu, '$1"$2":')
    .replaceAll(/,(\s*[}\]])/gu, "$1");
  for (const arg of call.args) {
    if (isBindingRef(arg)) {
      text = text.replace(
        new RegExp(`(^|, )${arg.$binding}(?=, |$)`, "u"),
        (_match, before: string) => `${before}"${arg.$binding}"`,
      );
    }
  }
  return JSON.parse(`[${text}]`) as unknown[];
}

/**
 * The expected reparse result: literals as they are, refs as their names.
 *
 * @param args - The call's arguments.
 * @returns JSON-comparable arguments.
 */
function expected(args: readonly CallArg[]): unknown[] {
  return args.map((arg) => (isBindingRef(arg) ? arg.$binding : arg));
}

describe("renderCall round trip", () => {
  it.each(ALL)("re-parses to the same args: %s", (_name, call) => {
    expect(reparse(call)).toStrictEqual(expected(call.args));
  });

  it("prints one statement binding the result", () => {
    for (const [, call] of ALL) {
      const text = renderCall(call);
      expect(
        text.startsWith(`const ${call.binding} = await ws.${call.method}(`),
      ).toBe(true);
      expect(text.endsWith(");")).toBe(true);
    }
  });

  it("prints a quoted key when the property is not an identifier", () => {
    expect(renderCall(toCall(QUOTED_KEY_SPEC))).toContain('"$browser"');
  });

  it("prints a filter as the Filter.equals call that runs", () => {
    expect(renderCall(toCall(FILTERED_SPEC))).toBe(
      `const result = await ws.query("Note Saved", {
  math: "total",
  last: 30,
  where: Filter.equals("platform", "iOS"),
});`,
    );
  });

  it("holds no class instance in args, only the expression tag", () => {
    const options = toCall(FILTERED_SPEC).args[1] as Record<string, CallArg>;
    expect(isExprArg(options["where"] as CallArg)).toBe(true);
    expect(options["where"]).toStrictEqual({
      $expr: "Filter.equals",
      args: ["platform", "iOS"],
    });
  });
});

describe("imports", () => {
  it("a filtered query declares Filter; every other call declares nothing", () => {
    for (const [, call] of ALL) {
      const filtered = renderCall(call).includes("Filter.equals(");
      expect(call.imports).toStrictEqual(filtered ? ["Filter"] : []);
    }
  });

  it("merges a name into the offline setup's one-line import", () => {
    expect(withImports(OFFLINE_SETUP, ["Filter"]).split("\n", 1)[0]).toBe(
      'import { createBrowserWorkspace, Filter } from "@mixpanel-headless/browser";',
    );
  });

  it("merges a name into the live setup's multi-line import in sorted order", () => {
    expect(withImports(LIVE_SETUP, ["Filter"]).split("\n", 5)).toStrictEqual([
      "import {",
      "  createBrowserWorkspaceFromStore,",
      "  Filter,",
      "  InMemoryCredentialStore,",
      '} from "@mixpanel-headless/browser";',
    ]);
  });

  it("leaves the setup alone for no names or names already present", () => {
    expect(withImports(OFFLINE_SETUP, [])).toBe(OFFLINE_SETUP);
    expect(withImports(OFFLINE_SETUP, ["createBrowserWorkspace"])).toBe(
      OFFLINE_SETUP,
    );
    expect(
      withImports(withImports(OFFLINE_SETUP, ["Filter"]), ["Filter"]),
    ).toBe(withImports(OFFLINE_SETUP, ["Filter"]));
  });

  it("refuses a setup without the browser import line", () => {
    expect(() => withImports("const x = 1;\n", ["Filter"])).toThrow(
      "no browser import line",
    );
  });
});

describe("withWhere", () => {
  const base: TrendSpec = {
    kind: "trend",
    event: "E",
    math: "total",
    last: 30,
  };

  it("sets, replaces and removes the filter without leaving the key behind", () => {
    const ios = withWhere(base, { property: "platform", value: "iOS" });
    expect(ios).toStrictEqual({
      ...base,
      where: { property: "platform", value: "iOS" },
    });
    expect(
      withWhere(ios, { property: "plan", value: "pro" }).where,
    ).toStrictEqual({ property: "plan", value: "pro" });
    expect(withWhere(ios, null)).toStrictEqual(base);
    expect(Object.keys(withWhere(ios, null))).not.toContain("where");
  });

  it("keeps the breakdown when the filter is on another property", () => {
    const spec = withWhere(
      { ...base, groupBy: "plan" },
      { property: "platform", value: "iOS" },
    );
    expect(spec.groupBy).toBe("plan");
    expect(toCall(spec).imports).toStrictEqual(["Filter"]);
  });
});

describe("option key order", () => {
  it("trend options are math, last, group_by, where", () => {
    const call = toCall({
      kind: "trend",
      event: "E",
      math: "unique",
      last: 7,
      groupBy: "plan",
      where: { property: "platform", value: "iOS" },
    });
    expect(Object.keys(call.args[1] as object)).toStrictEqual([
      "math",
      "last",
      "group_by",
      "where",
    ]);
  });

  it("a filter without a breakdown gives math, last, where", () => {
    expect(Object.keys(toCall(FILTERED_SPEC).args[1] as object)).toStrictEqual([
      "math",
      "last",
      "where",
    ]);
  });

  it("funnel options are conversion_window, last", () => {
    const call = toCall({
      kind: "funnel",
      steps: ["A", "B"],
      last: 30,
      conversionWindow: 1,
    });
    expect(Object.keys(call.args[1] as object)).toStrictEqual([
      "conversion_window",
      "last",
    ]);
  });

  it("retention options are retention_unit, last", () => {
    const call = toCall({
      kind: "retention",
      born: "A",
      returnEvent: "B",
      retentionUnit: "day",
      last: 90,
    });
    expect(Object.keys(call.args[2] as object)).toStrictEqual([
      "retention_unit",
      "last",
    ]);
  });

  it("never emits limit for a query", () => {
    for (const [, spec] of SPECS) {
      expect(renderCall(toCall(spec))).not.toContain("limit");
    }
  });
});

describe("method allowlist", () => {
  it("is the closed list of read methods plus createReportLink", () => {
    expect([...READ_METHODS]).toStrictEqual([
      "topEvents",
      "events",
      "properties",
      "propertyValues",
      "query",
      "queryFunnel",
      "queryRetention",
      "createReportLink",
    ]);
  });

  it("every generated call uses an allowed method", () => {
    for (const [, call] of ALL) {
      expect(READ_METHODS).toContain(call.method);
    }
  });

  it("runCall refuses a method outside the list", async () => {
    const call = {
      method: "createBookmark",
      args: [],
      binding: "x",
      imports: [],
    } as unknown as Call;
    const ws = { createBookmark: () => Promise.resolve("written") };
    await expect(
      runCall(ws as unknown as Parameters<typeof runCall>[0], call),
    ).rejects.toThrow("method createBookmark is not allowed");
  });

  it("runCall refuses an unbound reference", async () => {
    const ws = { createReportLink: () => Promise.resolve("link") };
    await expect(
      runCall(
        ws as unknown as Parameters<typeof runCall>[0],
        reportLinkCall("result", "x"),
      ),
    ).rejects.toThrow("no result bound to result");
  });

  it("runCall resolves a reference from the scope", async () => {
    const seen: unknown[] = [];
    const ws = {
      createReportLink: (...args: unknown[]) => {
        seen.push(...args);
        return Promise.resolve("link");
      },
    };
    const marker = { rows: 1 };
    await runCall(
      ws as unknown as Parameters<typeof runCall>[0],
      reportLinkCall("result", "x"),
      { result: marker },
    );
    expect(seen).toStrictEqual([marker, { name: "x" }]);
  });
});

describe("expression table", () => {
  it("is closed: Filter.equals only", () => {
    expect([...EXPR_NAMES]).toStrictEqual(["Filter.equals"]);
  });

  it("runCall evaluates Filter.equals into the library's Filter", async () => {
    const seen: unknown[] = [];
    const ws = {
      query: (...args: unknown[]) => {
        seen.push(...args);
        return Promise.resolve("rows");
      },
    };
    await runCall(
      ws as unknown as Parameters<typeof runCall>[0],
      toCall(FILTERED_SPEC),
    );
    const options = seen[1] as { where: unknown };
    expect(seen[0]).toBe("Note Saved");
    expect(options.where).toBeInstanceOf(Filter);
    expect(options.where).toStrictEqual(Filter.equals("platform", "iOS"));
  });

  it("runCall refuses an expression outside the table", async () => {
    const ws = { query: () => Promise.resolve("rows") };
    const call = {
      method: "query",
      args: ["E", { where: { $expr: "Filter.contains", args: ["p", "v"] } }],
      binding: "result",
      imports: ["Filter"],
    } as unknown as Call;
    await expect(
      runCall(ws as unknown as Parameters<typeof runCall>[0], call),
    ).rejects.toThrow("expression Filter.contains is not allowed");
  });

  it("runCall refuses malformed Filter.equals arguments", async () => {
    const ws = { query: () => Promise.resolve("rows") };
    const call = {
      method: "query",
      args: ["E", { where: { $expr: "Filter.equals", args: ["p"] } }],
      binding: "result",
      imports: ["Filter"],
    } as unknown as Call;
    await expect(
      runCall(ws as unknown as Parameters<typeof runCall>[0], call),
    ).rejects.toThrow("Filter.equals takes (property, value) strings");
  });
});

describe("maths", () => {
  it("every trend math is a member of MATH_TYPE_VALUES", () => {
    for (const math of TREND_MATHS) {
      expect(MATH_TYPE_VALUES).toContain(math);
    }
  });
});

describe("rendered blocks", () => {
  it("match their snapshots", () => {
    const blocks = Object.fromEntries(
      ALL.map(([name, call]) => [name, renderCall(call)]),
    );
    expect(blocks).toMatchSnapshot();
  });
});

describe("tokenize", () => {
  it("round-trips every rendered block", () => {
    for (const [, call] of ALL) {
      const code = renderCall(call);
      expect(
        tokenize(code)
          .map((t) => t.text)
          .join(""),
      ).toBe(code);
    }
  });

  it("classifies keywords, strings, numbers, identifiers and punctuation", () => {
    const types = tokenize('const r = await ws.query("E", { last: 30 });')
      .filter((t) => t.type !== "space")
      .map((t) => `${t.type}:${t.text}`);
    expect(types).toStrictEqual([
      "keyword:const",
      "ident:r",
      "punct:=",
      "keyword:await",
      "ident:ws",
      "punct:.",
      "ident:query",
      "punct:(",
      'string:"E"',
      "punct:,",
      "punct:{",
      "ident:last",
      "punct::",
      "number:30",
      "punct:});",
    ]);
  });

  it("keeps comments and template strings whole", () => {
    const tokens = tokenize("// note\nconst s = `a ${b}`;");
    expect(tokens[0]).toStrictEqual({ type: "comment", text: "// note" });
    expect(tokens.find((t) => t.type === "string")?.text).toBe("`a ${b}`");
  });

  it("emits an unterminated string as punctuation without losing text", () => {
    const code = 'const s = "open';
    expect(
      tokenize(code)
        .map((t) => t.text)
        .join(""),
    ).toBe(code);
  });
});
