// Translated rrweb-analyzer tests (packet B5-S3, `b5-packets.md` §5):
// assertion-for-assertion ports (R10.2) of ALL NINE classes of
//   tests/unit/test_rrweb_analyzer.py
//     TestAnalyzeEventsWrapper   :162
//     TestConsoleErrors          :199
//     TestDebouncing             :267
//     TestMouseInteractions      :349
//     TestSelectionEvents        :487
//     TestMutations              :536
//     TestDescriptionFallbacks   :620
//     TestDOMTrackerDirect       :708
//     TestMarkdownReporter       :768
// plus TestRrwebAnalyzer :162 of tests/unit/test_replay_bundle.py (the
// sample-fixture pair the packet routes here).
//
// The golden-file suite lives in `rrweb-analyzer.golden.test.ts`
// (plan Layer-3, `typescript-port-plan.md:351-354`).
//
// Message-text asserts on the two `analyze_events` ValueErrors keep the
// Python wording: these are plain CPython `ValueError`s with no registry
// code, so the substring IS the only available discriminator (R5.4's
// "code over message" has no code to prefer here).
import { describe, expect, it } from "vitest";

import { ValueError } from "../../src/query/python-builtins.js";
import { selectorLabelFn } from "../../src/replays/replay-labels.js";
import {
  analyzeEvents,
  DOMTracker,
  MarkdownReporter,
  RrwebAnalyzer,
} from "../../src/replays/rrweb-analyzer.js";
import type { UserAction } from "../../src/types/results/replays.js";

type Dict = Record<string, unknown>;

// =============================================================================
// Tiny event builders (`test_rrweb_analyzer.py:31-152`)
// =============================================================================

/**
 * Meta event (type 4) carrying a URL.
 *
 * @param ts - Unix ms timestamp.
 * @param href - The navigated-to URL.
 * @returns The event dict.
 */
function meta(ts: number, href: string): Dict {
  return {
    type: 4,
    data: { href, width: 1280, height: 800 },
    timestamp: ts,
  };
}

/**
 * FullSnapshot (type 2) wrapping a DOM root.
 *
 * @param ts - Unix ms timestamp.
 * @param root - The DOM root node.
 * @returns The event dict.
 */
function fullSnapshot(ts: number, root: Dict): Dict {
  return {
    type: 2,
    data: { node: root, initialOffset: { left: 0, top: 0 } },
    timestamp: ts,
  };
}

/**
 * IncrementalSnapshot Mutation (source 0).
 *
 * @param ts - Unix ms timestamp.
 * @param payload - The mutation payload members.
 * @returns The event dict.
 */
function mutation(ts: number, payload: Dict): Dict {
  return { type: 3, data: { source: 0, ...payload }, timestamp: ts };
}

/**
 * IncrementalSnapshot MouseInteraction (source 2).
 *
 * @param ts - Unix ms timestamp.
 * @param nodeId - The target node id.
 * @param clickType - The rrweb interaction type (default `2`).
 * @returns The event dict.
 */
function click(ts: number, nodeId: number, clickType = 2): Dict {
  return {
    type: 3,
    data: { source: 2, type: clickType, id: nodeId, x: 0, y: 0 },
    timestamp: ts,
  };
}

/**
 * IncrementalSnapshot Scroll (source 3).
 *
 * @param ts - Unix ms timestamp.
 * @param nodeId - The scrolled node id (default `1`).
 * @returns The event dict.
 */
function scroll(ts: number, nodeId = 1): Dict {
  return {
    type: 3,
    data: { source: 3, id: nodeId, x: 0, y: 0 },
    timestamp: ts,
  };
}

/**
 * IncrementalSnapshot Input (source 5).
 *
 * @param ts - Unix ms timestamp.
 * @param nodeId - The input node id.
 * @param options - `text` / `checked` payload members.
 * @returns The event dict.
 */
function input(
  ts: number,
  nodeId: number,
  options: { text?: string; checked?: boolean } = {},
): Dict {
  const data: Dict = { source: 5, id: nodeId, text: options.text ?? "" };
  if (options.checked !== undefined) {
    data["isChecked"] = options.checked;
  }
  return { type: 3, data, timestamp: ts };
}

/**
 * IncrementalSnapshot Selection (source 14).
 *
 * @param ts - Unix ms timestamp.
 * @param start - Range start node id.
 * @param end - Range end node id.
 * @param options - `startOffset` / `endOffset` (default `0`).
 * @returns The event dict.
 */
function selection(
  ts: number,
  start: number,
  end: number,
  options: { startOffset?: number; endOffset?: number } = {},
): Dict {
  return {
    type: 3,
    data: {
      source: 14,
      ranges: [
        {
          start,
          end,
          startOffset: options.startOffset ?? 0,
          endOffset: options.endOffset ?? 0,
        },
      ],
    },
    timestamp: ts,
  };
}

/**
 * Plugin event (type 6) — rrweb console-plugin error payload.
 *
 * @param ts - Unix ms timestamp.
 * @param messages - Message strings (quoted like the recorder does).
 * @returns The event dict.
 */
function pluginConsoleError(ts: number, ...messages: string[]): Dict {
  return {
    type: 6,
    data: {
      plugin: "rrweb/console@1",
      payload: { level: "error", payload: messages.map((m) => `"${m}"`) },
    },
    timestamp: ts,
  };
}

/**
 * Build a type=2 element node, optionally with a single text child.
 *
 * @param nodeId - The rrweb node id.
 * @param tag - The tag name.
 * @param options - `attributes` / `text` / `children`.
 * @returns The node dict.
 */
function elementNode(
  nodeId: number,
  tag: string,
  options: {
    attributes?: Record<string, string>;
    text?: string | null;
    children?: Dict[];
  } = {},
): Dict {
  const childNodes: Dict[] = [...(options.children ?? [])];
  if (options.text !== undefined && options.text !== null) {
    childNodes.push({
      id: nodeId * 1000,
      type: 3,
      textContent: options.text,
    });
  }
  return {
    id: nodeId,
    type: 2,
    tagName: tag,
    attributes: options.attributes ?? {},
    childNodes,
  };
}

/**
 * Wrap element nodes in a synthetic document root.
 *
 * @param elementChildren - The body's element children.
 * @returns The document-root node dict.
 */
function documentRoot(...elementChildren: Dict[]): Dict {
  return {
    id: 1,
    type: 0,
    childNodes: [
      elementNode(2, "html", {
        attributes: { lang: "en" },
        children: [
          elementNode(3, "body", { attributes: {}, children: elementChildren }),
        ],
      }),
    ],
  };
}

/**
 * Filter an action list by its `action` literal.
 *
 * @param actions - The analyzer's action list.
 * @param label - The literal to keep.
 * @returns The matching actions.
 */
function byAction(
  actions: readonly UserAction[],
  label: string,
): readonly UserAction[] {
  return actions.filter((a) => a.action === label);
}

// =============================================================================
// Convenience entry points
// =============================================================================

describe("analyze_events() convenience function (TestAnalyzeEventsWrapper)", () => {
  it("test_empty_raises_value_error", () => {
    expect(() => analyzeEvents([])).toThrow(ValueError);
    expect(() => analyzeEvents([])).toThrow(/cannot be empty/);
  });

  it("test_non_list_raises_value_error", () => {
    // Python passes the string "not a list": non-empty and non-list, so
    // the emptiness guard passes and the list guard fires.
    const notAList = "not a list" as unknown as readonly Dict[];
    expect(() => analyzeEvents(notAList)).toThrow(ValueError);
    expect(() => analyzeEvents(notAList)).toThrow(/must be a list/);
  });

  it("test_returns_string", () => {
    const out = analyzeEvents([meta(1000, "/x")]);
    expect(out).toContain("Navigated to /x");
  });

  it("test_actions_carry_description", () => {
    const result = new RrwebAnalyzer().analyze([meta(1000, "/x")]);
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.actions[0]?.description).toBe("Navigated to /x");
    // The structured description and the rendered markdown agree.
    expect(result.markdown_summary).toContain(result.actions[0]?.description);
  });
});

// =============================================================================
// Console errors
// =============================================================================

describe("rrweb/console@* level=error plugin events (TestConsoleErrors)", () => {
  it("test_console_error_emitted", () => {
    const events = [
      meta(1000, "/x"),
      pluginConsoleError(2000, "TypeError: bad"),
    ];
    const result = new RrwebAnalyzer().analyze(events);
    const errors = byAction(result.actions, "console_error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.target_desc).toContain("TypeError: bad");
    // Also recorded in the structured errors list.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toBe("TypeError: bad");
  });

  it("test_non_error_plugin_ignored", () => {
    const events = [
      meta(1000, "/x"),
      {
        type: 6,
        data: {
          plugin: "rrweb/console@1",
          payload: { level: "warn", payload: ['"deprecation"'] },
        },
        timestamp: 2000,
      },
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(result.actions.some((a) => a.action === "console_error")).toBe(
      false,
    );
  });

  it("test_unrelated_plugin_ignored", () => {
    const events = [
      meta(1000, "/x"),
      {
        type: 6,
        data: { plugin: "rrweb/canvas@1", payload: {} },
        timestamp: 2000,
      },
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(result.actions.some((a) => a.action === "console_error")).toBe(
      false,
    );
  });

  it("test_empty_message_not_emitted", () => {
    const events = [
      meta(1000, "/x"),
      {
        type: 6,
        data: {
          plugin: "rrweb/console@1",
          payload: { level: "error", payload: [] },
        },
        timestamp: 2000,
      },
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(result.actions.some((a) => a.action === "console_error")).toBe(
      false,
    );
  });
});

// =============================================================================
// Debouncing
// =============================================================================

describe("scroll / input / selection debouncing (TestDebouncing)", () => {
  it("test_scroll_debounced", () => {
    const events = [
      meta(1000, "/x"),
      scroll(2000),
      scroll(2100),
      scroll(2200),
      scroll(2300),
      scroll(2400),
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(byAction(result.actions, "scroll")).toHaveLength(1);
  });

  it("test_scroll_re_fires_after_gap", () => {
    const events = [meta(1000, "/x"), scroll(2000), scroll(5000)];
    const result = new RrwebAnalyzer().analyze(events);
    expect(byAction(result.actions, "scroll")).toHaveLength(2);
  });

  it("test_input_debounced_per_node", () => {
    const root = documentRoot(
      elementNode(10, "input", { attributes: { id: "email", type: "text" } }),
      elementNode(11, "input", {
        attributes: { id: "password", type: "password" },
      }),
    );
    const events = [
      meta(1000, "/x"),
      fullSnapshot(1500, root),
      input(2000, 10, { text: "a" }),
      input(2500, 10, { text: "ab" }), // within 1s on node 10 → suppressed
      input(2100, 11, { text: "x" }), // different node → emitted
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(byAction(result.actions, "input")).toHaveLength(2);
  });

  it("test_input_checkbox", () => {
    const root = documentRoot(
      elementNode(20, "input", {
        attributes: { type: "checkbox", id: "agree" },
      }),
    );
    const events = [
      meta(1000, "/x"),
      fullSnapshot(1500, root),
      input(2000, 20, { checked: true }),
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(result.markdown_summary).toContain("to checked");
  });

  it("test_input_no_text_no_check_modified_fallback", () => {
    const root = documentRoot(
      elementNode(30, "input", { attributes: { type: "text", id: "foo" } }),
    );
    const events = [
      meta(1000, "/x"),
      fullSnapshot(1500, root),
      input(2000, 30),
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(result.markdown_summary).toContain("Modified");
  });
});

// =============================================================================
// Mouse-interaction subtypes
// =============================================================================

describe("all five mouse-interaction types (TestMouseInteractions)", () => {
  it.each([
    [2, "Clicked", "click"],
    [3, "Right-clicked", "click"],
    [4, "Double-clicked", "click"],
    [5, "Focused", "click"],
    [7, "Tapped", "touch_start"],
  ] as ReadonlyArray<readonly [number, string, string]>)(
    "test_each_interaction_type[%i]",
    (clickType, expectedVerb, expectedAction) => {
      const root = documentRoot(
        elementNode(40, "button", { attributes: { id: "go" }, text: "Go" }),
      );
      const events = [
        meta(1000, "/x"),
        fullSnapshot(1500, root),
        click(2000, 40, clickType),
      ];
      const result = new RrwebAnalyzer().analyze(events);
      // Description contains the upstream-style verb (the Python assert
      // is a three-way `or`; the markdown branch is the reachable one).
      expect(
        result.actions.some((a) => a.target_desc.includes(expectedVerb)) ||
          result.markdown_summary.includes(expectedVerb),
      ).toBe(true);
      // Structured action carries the documented literal.
      expect(
        byAction(result.actions, expectedAction).length,
      ).toBeGreaterThanOrEqual(1);
    },
  );

  it("test_unknown_interaction_type_ignored", () => {
    const root = documentRoot(
      elementNode(50, "div", { attributes: { id: "x" } }),
    );
    const events = [
      meta(1000, "/x"),
      fullSnapshot(1500, root),
      click(2000, 50, 99), // not in the enum
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(
      result.actions.some(
        (a) => a.action === "click" || a.action === "touch_start",
      ),
    ).toBe(false);
  });

  it("test_click_on_unknown_node_describes_as_element", () => {
    const events = [meta(1000, "/x"), click(2000, 999)];
    const result = new RrwebAnalyzer().analyze(events);
    const clicks = byAction(result.actions, "click");
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.target_desc).toBe("element");
  });

  it("test_click_with_no_node_id_is_dropped", () => {
    const events = [
      meta(1000, "/x"),
      { type: 3, data: { source: 2, type: 2, x: 0, y: 0 }, timestamp: 2000 },
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(result.actions.some((a) => a.action === "click")).toBe(false);
  });

  it("test_data_selectors_propagated_to_click_metadata", () => {
    const root = documentRoot(
      elementNode(40, "button", {
        attributes: {
          id: "go",
          "data-testid": "signin-button",
          "data-cy": "signin",
        },
        text: "Sign in",
      }),
    );
    const events = [fullSnapshot(1500, root), click(2000, 40, 2)];
    const result = new RrwebAnalyzer().analyze(events);
    const clicks = byAction(result.actions, "click");
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.metadata["data-testid"]).toBe("signin-button");
    expect(clicks[0]?.metadata["data-cy"]).toBe("signin");
    // Non-data attributes stay out of metadata.
    expect(Object.hasOwn(clicks[0]?.metadata ?? {}, "id")).toBe(false);
  });

  it("test_selector_label_fn_uses_propagated_testid", () => {
    const root = documentRoot(
      elementNode(41, "button", {
        attributes: { "data-testid": "checkout" },
        text: "Checkout",
      }),
    );
    const events = [
      meta(1000, "/cart"),
      fullSnapshot(1500, root),
      click(2000, 41, 2),
    ];
    const result = new RrwebAnalyzer().analyze(events);
    const clickAction = result.actions.find((a) => a.action === "click");
    expect(clickAction).toBeDefined();
    expect(selectorLabelFn("data-testid")(clickAction!)).toBe(
      "click:checkout@/cart",
    );
  });
});

// =============================================================================
// Selection events
// =============================================================================

describe("selection events with text extraction (TestSelectionEvents)", () => {
  it("test_selection_extracts_text", () => {
    const root = documentRoot(
      elementNode(60, "p", { text: "hello world from acme" }),
    );
    const events = [
      meta(1000, "/x"),
      fullSnapshot(1500, root),
      selection(2000, 60, 60, { startOffset: 6, endOffset: 11 }),
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(byAction(result.actions, "select")).toHaveLength(1);
    expect(result.markdown_summary).toContain("Selected");
  });

  it("test_selection_without_text_fallback", () => {
    const events = [
      meta(1000, "/x"),
      { type: 3, data: { source: 14, ranges: [] }, timestamp: 2000 },
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(result.actions.some((a) => a.action === "select")).toBe(false);
  });

  it("test_selection_unknown_node_fallback", () => {
    const events = [
      meta(1000, "/x"),
      selection(2000, 999, 999, { startOffset: 0, endOffset: 5 }),
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(byAction(result.actions, "select")).toHaveLength(1);
    expect(result.markdown_summary).toContain("Selected text");
  });
});

// =============================================================================
// Mutations
// =============================================================================

describe("DOM tracker mutation application (TestMutations)", () => {
  it("test_mutation_adds", () => {
    const root = documentRoot(); // empty body
    const events = [
      meta(1000, "/x"),
      fullSnapshot(1500, root),
      mutation(1800, {
        adds: [
          {
            parentId: 3,
            node: elementNode(70, "button", { text: "Click me" }),
          },
        ],
      }),
      click(2000, 70),
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(result.actions.some((a) => a.target_desc.includes("Click me"))).toBe(
      true,
    );
  });

  it("test_mutation_removes", () => {
    const root = documentRoot(elementNode(80, "button", { text: "Bye" }));
    const events = [
      meta(1000, "/x"),
      fullSnapshot(1500, root),
      mutation(1800, { removes: [{ id: 80 }] }),
      click(2000, 80),
    ];
    const result = new RrwebAnalyzer().analyze(events);
    const clicks = byAction(result.actions, "click");
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.target_desc).toBe("element");
  });

  it("test_mutation_text_change", () => {
    const root = documentRoot(elementNode(90, "button", { text: "Old" }));
    const events = [
      meta(1000, "/x"),
      fullSnapshot(1500, root),
      click(1700, 90), // primes the cache with "Old"
      mutation(1800, { texts: [{ id: 90 * 1000, value: "New" }] }),
      click(2900, 90),
    ];
    const result = new RrwebAnalyzer().analyze(events);
    const clicks = byAction(result.actions, "click");
    expect(clicks.some((a) => a.target_desc.includes('"New"'))).toBe(true);
  });

  it("test_mutation_attribute_change", () => {
    const root = documentRoot(elementNode(100, "button"));
    const events = [
      meta(1000, "/x"),
      fullSnapshot(1500, root),
      mutation(1800, {
        attributes: [{ id: 100, attributes: { "aria-label": "Submit form" } }],
      }),
      click(2000, 100),
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(
      result.actions.some((a) => a.target_desc.includes("Submit form")),
    ).toBe(true);
  });

  it("test_mutation_text_change_for_unknown_node", () => {
    const events = [
      meta(1000, "/x"),
      mutation(1800, { texts: [{ id: 999, value: "ghost" }] }),
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(result.actions.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Description fallbacks
// =============================================================================

describe("descriptive-attribute priority ladder (TestDescriptionFallbacks)", () => {
  it.each([
    [{ "aria-label": "Save changes" }, null, '"Save changes"'],
    [{ title: "tooltip-text" }, null, '"tooltip-text"'],
    [{ alt: "logo" }, null, 'alt="logo"'],
    [{}, "Sign in", '"Sign in"'],
    [{ placeholder: "search…" }, null, 'placeholder="search…"'],
    [{ id: "go" }, null, "#go"],
  ] as ReadonlyArray<readonly [Record<string, string>, string | null, string]>)(
    "test_button_description[%#]",
    (attributes, text, fragment) => {
      const root = documentRoot(
        elementNode(200, "button", { attributes, text }),
      );
      const events = [
        meta(1000, "/x"),
        fullSnapshot(1500, root),
        click(2000, 200),
      ];
      const result = new RrwebAnalyzer().analyze(events);
      expect(result.actions.some((a) => a.target_desc.includes(fragment))).toBe(
        true,
      );
    },
  );

  it("test_anchor_with_http_href_appends_path", () => {
    const root = documentRoot(
      elementNode(210, "a", {
        attributes: { href: "https://example.com/docs/intro" },
        text: "Docs",
      }),
    );
    const events = [
      meta(1000, "/x"),
      fullSnapshot(1500, root),
      click(2000, 210),
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(
      result.actions.some((a) => a.target_desc.includes("to /docs/intro")),
    ).toBe(true);
  });

  it("test_input_with_type", () => {
    const root = documentRoot(
      elementNode(220, "input", {
        attributes: { type: "email", id: "email" },
      }),
    );
    const events = [
      meta(1000, "/x"),
      fullSnapshot(1500, root),
      input(2000, 220, { text: "alice@example.com" }),
    ];
    const result = new RrwebAnalyzer().analyze(events);
    expect(
      result.actions.some((a) => a.target_desc.includes("type=email")),
    ).toBe(true);
  });

  it("test_ancestor_traversal_fallback", () => {
    const span = elementNode(300, "span");
    const button = elementNode(301, "button", {
      attributes: { id: "go" },
      text: "Go",
      children: [span],
    });
    const root = documentRoot(button);
    const events = [
      meta(1000, "/x"),
      fullSnapshot(1500, root),
      click(2000, 300), // click on the span
    ];
    const result = new RrwebAnalyzer().analyze(events);
    const clicks = byAction(result.actions, "click");
    expect(clicks.some((a) => a.target_desc.includes("in button"))).toBe(true);
  });
});

// =============================================================================
// DOMTracker direct API
// =============================================================================

describe("DOMTracker direct exercises (TestDOMTrackerDirect)", () => {
  it("test_sanitize_value_strips_and_drops_none_string", () => {
    expect(DOMTracker.sanitizeValue("  ")).toBe("");
    expect(DOMTracker.sanitizeValue("None")).toBe("");
    expect(DOMTracker.sanitizeValue("hi  ")).toBe("hi");
    expect(DOMTracker.sanitizeValue(42)).toBe(42);
  });

  it("test_describe_unknown_node_returns_element", () => {
    expect(new DOMTracker().getNodeDescription(9999)).toBe("element");
  });

  it("test_max_nodes_warning", () => {
    const tracker = new DOMTracker();
    tracker.MAX_NODES = 2;
    tracker.addNode(elementNode(1, "div"));
    tracker.addNode(elementNode(2, "div"));
    tracker.addNode(elementNode(3, "div"));
    expect(tracker.reachedMaxNodes).toBe(true);
  });

  it("test_max_nodes_caps_growth_after_trip", () => {
    const tracker = new DOMTracker();
    tracker.MAX_NODES = 2;
    for (let nodeId = 1; nodeId < 8; nodeId += 1) {
      tracker.addNode(elementNode(nodeId, "div"));
    }
    expect(tracker.reachedMaxNodes).toBe(true);
    expect(tracker.nodes.size).toBe(2); // nodes 1 and 2 only
  });

  it("test_max_nodes_still_updates_existing_nodes_at_cap", () => {
    const tracker = new DOMTracker();
    tracker.MAX_NODES = 2;
    tracker.addNode(elementNode(1, "button", { attributes: { id: "first" } }));
    tracker.addNode(elementNode(2, "div"));
    tracker.addNode(elementNode(3, "div")); // trips the cap, skipped
    tracker.addNode(
      elementNode(1, "button", { attributes: { id: "updated" } }),
    );
    expect(tracker.nodes.size).toBe(2);
    expect(tracker.nodes.get(1)?.attributes?.get("id")).toBe("updated");
  });
});

// =============================================================================
// MarkdownReporter
// =============================================================================

describe("MarkdownReporter line rendering (TestMarkdownReporter)", () => {
  it("test_empty_returns_no_actions_sentinel", () => {
    expect(new MarkdownReporter([]).generate()).toBe(
      "No user actions recorded.",
    );
  });

  it("test_renders_seconds", () => {
    expect(new MarkdownReporter([[2500, "Did a thing"]]).generate()).toBe(
      "2: Did a thing",
    );
  });

  it("test_multiple_lines_joined", () => {
    expect(
      new MarkdownReporter([
        [1000, "a"],
        [2000, "b"],
      ]).generate(),
    ).toBe("1: a\n2: b");
  });

  it("test_collapses_consecutive_duplicates", () => {
    expect(
      new MarkdownReporter([
        [1000, "Clicked X"],
        [1200, "Clicked X"],
        [1400, "Clicked X"],
      ]).generate(),
    ).toBe("1: Clicked X (×3)");
  });

  it("test_non_adjacent_duplicates_not_collapsed", () => {
    expect(
      new MarkdownReporter([
        [1000, "Clicked X"],
        [2000, "Scrolled"],
        [3000, "Clicked X"],
      ]).generate(),
    ).toBe("1: Clicked X\n2: Scrolled\n3: Clicked X");
  });
});
