// Report-type inference from bookmark params — heads spec 02 §5.3 / §10.1
// (`mixpanel-desktop-app/docs/specs/heads/02-queryref-and-two-body-identity.md`).
//
// The desktop derives a QueryRef's `bookmarkType` from the wire body of a
// bridged query, where the only thing it holds is `body.bookmark` — the
// params object. Spec §10.1 asks headless to own that classifier so there
// is one implementation, not two.
//
// **Every params object below is produced by running the real builders.**
// Hand-writing params would test the classifier against a fiction; the
// point is that it reads what `buildParams` et al. actually emit.
import { describe, expect, it } from "vitest";

import { inferBookmarkType } from "../../src/bookmarks/infer-type.js";
import { FlowStep } from "../../src/types/query-params/flow.js";
import { Metric } from "../../src/types/query-params/metric.js";
import { RetentionEvent } from "../../src/types/query-params/retention.js";
import { makeStubWorkspace } from "../../test-support/workspace-test-helpers.js";

describe("inferBookmarkType — real builder output", () => {
  const cases: Array<
    [
      string,
      "insights" | "funnels" | "retention" | "flows",
      () => Promise<unknown>,
    ]
  > = [
    [
      "buildParams, single event",
      "insights",
      () => makeStubWorkspace().buildParams("Login"),
    ],
    [
      "buildParams, several events with a breakdown",
      "insights",
      () =>
        makeStubWorkspace().buildParams(["Login", "Purchase"], {
          group_by: ["$city"],
          last: 7,
        }),
    ],
    [
      "buildParams, unique-count math on a Metric",
      "insights",
      () =>
        makeStubWorkspace().buildParams(
          new Metric({ event: "Purchase", math: "unique" }),
        ),
    ],
    [
      "buildFunnelParams, two steps",
      "funnels",
      () => makeStubWorkspace().buildFunnelParams(["Signup", "Purchase"]),
    ],
    [
      "buildFunnelParams, three steps with a breakdown",
      "funnels",
      () =>
        makeStubWorkspace().buildFunnelParams(["Signup", "View", "Purchase"], {
          group_by: ["$os"],
        }),
    ],
    [
      "buildRetentionParams, born + return event",
      "retention",
      () => makeStubWorkspace().buildRetentionParams("Signup", "Login"),
    ],
    [
      "buildRetentionParams, RetentionEvent objects",
      "retention",
      () =>
        makeStubWorkspace().buildRetentionParams(
          new RetentionEvent({ event: "Signup" }),
          new RetentionEvent({ event: "Login" }),
        ),
    ],
    [
      "buildFlowParams, single event",
      "flows",
      () => makeStubWorkspace().buildFlowParams("Purchase"),
    ],
    [
      "buildFlowParams, FlowStep list",
      "flows",
      () =>
        makeStubWorkspace().buildFlowParams([
          new FlowStep({ event: "Signup" }),
        ]),
    ],
  ];

  for (const [name, expected, build] of cases) {
    it(`${name} -> ${expected}`, async () => {
      expect(inferBookmarkType(await build())).toBe(expected);
    });
  }

  it("classifies every builder family distinctly (no two collide)", async () => {
    const ws = makeStubWorkspace();
    const seen = [
      inferBookmarkType(await ws.buildParams("Login")),
      inferBookmarkType(await ws.buildFunnelParams(["A", "B"])),
      inferBookmarkType(await ws.buildRetentionParams("A", "B")),
      inferBookmarkType(await ws.buildFlowParams("A")),
    ];
    expect(seen).toStrictEqual(["insights", "funnels", "retention", "flows"]);
    expect(new Set(seen).size).toBe(4);
  });

  it("is unaffected by key insertion order (it reads members, not order)", async () => {
    const params = (await makeStubWorkspace().buildFunnelParams([
      "A",
      "B",
    ])) as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(params).reverse());
    expect(inferBookmarkType(reordered)).toBe("funnels");
  });
});

describe("inferBookmarkType — returns null rather than guessing", () => {
  const ambiguous: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["a string", "insights"],
    ["an array", [{ sections: {} }]],
    ["an empty object", {}],
    ["sections present but not an object", { sections: 3, displayOptions: {} }],
    ["sections without a show list", { sections: {}, displayOptions: {} }],
    ["an empty show list", { sections: { show: [] }, displayOptions: {} }],
    [
      "a leading formula clause (no behavior to read)",
      {
        sections: { show: [{ type: "formula", formula: "A/B" }] },
        displayOptions: {},
      },
    ],
    [
      "a behavior with an unknown metric type",
      {
        sections: {
          show: [{ type: "metric", behavior: { type: "warehouse" } }],
        },
        displayOptions: {},
      },
    ],
    [
      "a behavior whose type is not a string",
      {
        sections: { show: [{ type: "metric", behavior: { type: 7 } }] },
        displayOptions: {},
      },
    ],
    ["flows-shaped but missing date_range", { steps: [], chartType: "sankey" }],
    ["flows-shaped but missing steps", { date_range: {}, chartType: "sankey" }],
    ["neither family", { foo: "bar" }],
  ];

  for (const [name, params] of ambiguous) {
    it(`${name} -> null`, () => {
      expect(inferBookmarkType(params)).toBeNull();
    });
  }
});

describe("inferBookmarkType — package surface", () => {
  it("is reachable from the package barrel", async () => {
    // The downstream consumer imports from "@mixpanel-headless/core";
    // `bookmarks/` is otherwise unexported, so lock the explicit line.
    const barrel = await import("../../src/index.js");
    expect(barrel.inferBookmarkType).toBe(inferBookmarkType);
  });
});
