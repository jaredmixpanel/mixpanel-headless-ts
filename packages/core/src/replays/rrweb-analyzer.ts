/**
 * rrweb event-stream analyzer — TS port of
 * `mixpanel_headless/_internal/replays/rrweb_analyzer.py` (969 lines,
 * whole file, pure stdlib) for Phase-3 batch B5, shard S3
 * (`docs/history/phase3/design/b5-packets.md` §5).
 *
 * Walks the raw rrweb event stream, maintains DOM state, and emits two
 * parallel outputs from a single pass: a list of `UserAction` records
 * (the structured surface `ReplayBundle` aggregations consume) and a
 * plain-text markdown timeline (`{timestamp_seconds}: {description}`
 * per line).
 *
 * Port-wide conventions applied here:
 *
 * - R4.3 — the four Python `IntEnum`s (`EventType`,
 *   `IncrementalSource`, `MouseInteractionType`, `NodeType`) port as
 *   frozen `const` objects plus literal unions, preserving the numeric
 *   values so the wire comparisons stay identical.
 * - R11.7 — `value.strip()` routes through {@link pythonStrip};
 *   `int(event.get("timestamp", 0))` through {@link pythonIntCoerce}
 *   (packet §9 Caution #3: CPython `int()` TRUNCATES floats toward zero
 *   and parses strings with the CPython grammar, never `Number()`).
 * - R11.6 — `text_content[start:end]` is a CODE-POINT slice
 *   ({@link cpSlice}); `len(text)` is {@link cpLength}.
 * - Watchlist #13 — `isinstance(x, dict)` is {@link isPythonDict}.
 * - R9.5 — the two `log.debug` / `log.info` sites are an injected sink
 *   ({@link AnalyzerLogger}); `core` never touches `console`.
 * - R4.8 — the `dict[int, ...]` node map and description cache become
 *   `Map`s (prototype-safe; integer keys keep insertion order, which a
 *   plain JS object would NOT — integer-like object keys sort
 *   numerically first).
 * - Guard order is SOURCE order throughout (`_build_node_description`'s
 *   aria-label → title → alt → text → placeholder ladder is
 *   order-sensitive, packet §9 Caution #11).
 *
 * The analyzer is intentionally free of `Workspace` / client
 * dependencies: `Workspace.fetch_replay` runs it a layer above
 * (`replays.py:129-133`).
 */

import { codepoints, cpLength, cpSlice } from "../compat/codepoint.js";
import { ValueError } from "../compat/python-builtins.js";
import { isPythonDict } from "../compat/python-dict.js";
import { pythonIntCoerce } from "../compat/python-int.js";
import {
  pythonStr,
  pythonStrOf,
  type PythonValue,
} from "../compat/python-str.js";
import { pythonStrip } from "../compat/python-strip.js";
import { defined } from "../invariant.js";
import { type ReplayActionLabel, UserAction } from "./user-action.js";

/** Any JSON-shaped mapping the analyzer reads off the event stream. */
type Dict = Readonly<Record<string, unknown>>;

// =============================================================================
// rrweb event-shape enums (R4.3 — const objects, numeric values preserved)
// =============================================================================

/** RRWeb event types (`EventType`, `rrweb_analyzer.py:52-59`). */
const EventType = {
  FULL_SNAPSHOT: 2,
  INCREMENTAL_SNAPSHOT: 3,
  META: 4,
  PLUGIN: 6,
} as const;

/**
 * RRWeb `IncrementalSnapshot.data.source` discriminators we handle
 * (`IncrementalSource`, `rrweb_analyzer.py:61-69`).
 */
const IncrementalSource = {
  MUTATION: 0,
  MOUSE_INTERACTION: 2,
  SCROLL: 3,
  INPUT: 5,
  SELECTION: 14,
} as const;

/**
 * `MouseInteraction.data.type` values we emit actions for
 * (`MouseInteractionType`, `rrweb_analyzer.py:71-79`).
 */
const MouseInteractionType = {
  CLICK: 2,
  CONTEXT_MENU: 3,
  DBL_CLICK: 4,
  FOCUS: 5,
  TOUCH_START: 7,
} as const;

/** rrweb DOM node types (`NodeType`, `rrweb_analyzer.py:81-86`). */
const NodeType = {
  ELEMENT: 2,
  TEXT: 3,
} as const;

// =============================================================================
// Public result types
// =============================================================================

/**
 * A single page navigation extracted from Meta events (`PageVisit`,
 * `rrweb_analyzer.py:94-105`).
 */
interface PageVisit {
  /** Unix ms timestamp of the Meta event. */
  readonly timestamp: number;
  /** The navigated-to URL. */
  readonly url: string;
}

/**
 * A console-error log entry extracted from the rrweb console plugin
 * (`ConsoleError`, `rrweb_analyzer.py:107-120`).
 */
interface ConsoleError {
  /** Unix ms timestamp. */
  readonly timestamp: number;
  /** Joined message text. */
  readonly message: string;
  /** Active page URL at the time of the error (`null` if unknown). */
  readonly url: string | null;
}

/**
 * The full bundle returned by {@link RrwebAnalyzer.analyze}
 * (`AnalyzerResult`, `rrweb_analyzer.py:122-138`).
 */
export interface AnalyzerResult {
  /** Structured `UserAction` records in timestamp order. */
  readonly actions: readonly UserAction[];
  /** Plain-text markdown timeline. */
  readonly markdown_summary: string;
  /** Each Meta navigation as a {@link PageVisit}. */
  readonly pages: readonly PageVisit[];
  /** Console errors emitted during the session. */
  readonly errors: readonly ConsoleError[];
}

/** Debug/info log seam for the module's two `log.*` sites (R9.5). */
export interface AnalyzerLogger {
  /**
   * Record a debug message (the `DOMTracker` max-nodes site).
   *
   * @param message - The formatted text (never vector-compared).
   */
  debug?: (message: string) => void;
  /**
   * Record an info message (the two `analyze` / `analyze_events` sites).
   *
   * @param message - The formatted text (never vector-compared).
   */
  info?: (message: string) => void;
}

// =============================================================================
// DOMTracker
// =============================================================================

/**
 * Pick the stable `data-*` selector attributes from a node's attrs
 * (`_selector_attrs`, `rrweb_analyzer.py:145-165`).
 *
 * These are the test-id-style hooks (`data-testid`, `data-cy`, …) that
 * `selectorLabelFn` reads off `UserAction.metadata`. Capturing every
 * `data-*` attribute keeps the public helper working for whatever
 * convention a project actually uses, rather than a hard-coded
 * allowlist.
 *
 * @param sanitizedAttrs - A node's already-sanitized `{attr: value}` map.
 * @returns The subset whose keys start with `data-` and whose values are
 *   non-empty strings. Empty when the node carries no such attribute.
 */
function selectorAttrs(
  sanitizedAttrs: ReadonlyMap<string, unknown>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of sanitizedAttrs) {
    if (k.startsWith("data-") && typeof v === "string" && v !== "") {
      out.set(k, v);
    }
  }
  return out;
}

/** The per-node record `DOMTracker.nodes` holds (Python `dict[str, Any]`). */
export interface TrackedNode {
  /** The rrweb node `type` discriminator (may be absent → `undefined`). */
  type: unknown;
  /** The parent rrweb node id, or `null`. */
  parent_id: number | null;
  /** Lower-cased tag name (element nodes only). */
  tag?: string;
  /** The descriptive-attribute subset (element nodes only). */
  attributes?: Map<string, unknown>;
  /** The `data-*` selector subset (element nodes only). */
  selectors?: Map<string, string>;
  /** The node's text (interactive elements + text nodes). */
  text?: unknown;
}

/** Constructor options of {@link DOMTracker}. */
export interface DOMTrackerOptions {
  /** Optional debug sink for the max-nodes site (R9.5). */
  readonly logger?: AnalyzerLogger | undefined;
  /** Node-map cap; defaults to {@link DOMTracker.DEFAULT_MAX_NODES}. */
  readonly maxNodes?: number | undefined;
}

/**
 * Lightweight DOM state tracker (`DOMTracker`,
 * `rrweb_analyzer.py:168-518`).
 *
 * Tracks all nodes with metadata needed for user-action descriptions.
 * Walks `FullSnapshot` roots, applies `Mutation.adds` / removes /
 * text-changes / attribute-changes, and exposes
 * {@link getNodeDescription} for human-readable element labels.
 */
export class DOMTracker {
  /** Tags whose direct text children feed the description (`INTERACTIVE_TAGS`). */
  static readonly INTERACTIVE_TAGS: ReadonlySet<string> = new Set([
    "button",
    "a",
    "input",
    "textarea",
    "select",
    "form",
    "video",
    "audio",
    "svg",
    "img",
    "canvas",
  ]);

  /** Description-feeding attributes, in priority order (`DESCRIPTIVE_ATTRS`). */
  static readonly DESCRIPTIVE_ATTRS: readonly string[] = [
    "aria-label",
    "title",
    "alt",
    "placeholder",
    "href",
    "id",
    "type",
  ];

  /** Ancestor-traversal bound (`MAX_ANCESTOR_DEPTH`). */
  static readonly MAX_ANCESTOR_DEPTH = 3;

  /** Default node-map cap (Python `MAX_NODES`). */
  static readonly DEFAULT_MAX_NODES = 50000;

  /** Node-map cap of this tracker (`MAX_NODES`; a constructor option). */
  readonly maxNodes: number;

  /** Ancestor-traversal bound (per-instance mirror of the class attr). */
  MAX_ANCESTOR_DEPTH: number = DOMTracker.MAX_ANCESTOR_DEPTH;

  /** The node map (`self.nodes`). */
  readonly nodes: Map<number, TrackedNode> = new Map();

  /** Memoized descriptions (`self._description_cache`). */
  readonly descriptionCache: Map<number, string> = new Map();

  /** Whether the node cap has been hit at least once. */
  reachedMaxNodes = false;

  /** The `log.debug` sink (R9.5). */
  readonly #logger: AnalyzerLogger | undefined;

  /**
   * Initialize an empty node map + description cache (`__init__`,
   * `rrweb_analyzer.py:203-207`).
   *
   * @param options - Optional debug sink and node-map cap.
   */
  constructor(options: DOMTrackerOptions = {}) {
    this.#logger = options.logger;
    this.maxNodes = options.maxNodes ?? DOMTracker.DEFAULT_MAX_NODES;
  }

  /**
   * Strip / drop trivially uninformative string values (empty, `'none'`)
   * — `_sanitize_value`, `rrweb_analyzer.py:209-217`.
   *
   * @param value - The raw attribute / text value.
   * @returns `""` for blank or `"none"`-ish strings, the stripped string
   *   for other strings, the value unchanged for non-strings.
   */
  static sanitizeValue(value: unknown): unknown {
    if (typeof value === "string") {
      const stripped = pythonStrip(value);
      // Python `.lower()` is full Unicode case folding on the
      // *lowercase* mapping; for the literal comparison against "none"
      // the ASCII fold is exact for every input that can equal it.
      if (stripped === "" || stripped.toLowerCase() === "none") {
        return "";
      }
      return stripped;
    }
    return value;
  }

  /**
   * Walk a FullSnapshot / mutation-add root and record element nodes
   * (`add_node`, `rrweb_analyzer.py:219-296`).
   *
   * @param node - The rrweb node dict to ingest.
   * @param parentId - Optional parent rrweb node id for ancestor
   *   traversal.
   */
  addNode(node: Dict, parentId: number | null = null): void {
    const queue: Array<readonly [Dict, number | null]> = [[node, parentId]];

    // Python `queue.pop(0)` — FIFO breadth-first order. A read cursor
    // stands in for `shift()`, which is O(n) per pop and made the walk
    // quadratic on 50k-node snapshots.
    let head = 0;
  // eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
    while (head < queue.length) {
      const [currentNode, currentParentId] = defined(
        queue[head],
        "DOMTracker BFS queue entry",
      );
      head += 1;
      const rawNodeId = currentNode["id"];
      if (rawNodeId === undefined || rawNodeId === null) {
        continue;
      }
      const nodeId = rawNodeId as number;

      if (!this.nodes.has(nodeId) && this.nodes.size >= this.maxNodes) {
        // Skip every new node once at the cap — and stop descending into
        // its subtree. `reachedMaxNodes` only de-dupes the log; it must
        // NOT gate the skip itself (regression locked by
        // TestDOMTrackerDirect::test_max_nodes_caps_growth_after_trip).
        if (!this.reachedMaxNodes) {
          this.#logger?.debug?.(
            "DOMTracker reached maximum node limit; skipping new nodes",
          );
          this.reachedMaxNodes = true;
        }
        continue;
      }

      const nodeType = currentNode["type"];

      const record: TrackedNode = {
        type: nodeType,
        parent_id: currentParentId,
      };
      this.nodes.set(nodeId, record);

      if (nodeType === NodeType.ELEMENT) {
        const rawTag = currentNode["tagName"];
        // Python `current_node.get("tagName", "").lower()` — a missing
        // key defaults to `""`; a non-str value would raise, which the
        // annotation domain excludes.
        const tagName = (
          typeof rawTag === "string" ? rawTag : ""
        ).toLowerCase();
        const attributes = currentNode["attributes"];
        record.tag = tagName;
        const sanitizedAttrs = new Map<string, unknown>();
        if (isPythonDict(attributes)) {
          for (const [k, v] of Object.entries(attributes)) {
            if (pyTruthyValue(DOMTracker.sanitizeValue(v))) {
              sanitizedAttrs.set(k, v);
            }
          }
        }
        const descriptiveAttrs = new Map<string, unknown>();
        for (const attr of DOMTracker.DESCRIPTIVE_ATTRS) {
            // eslint-disable-next-line max-depth -- mirrors the Python nesting; flattening would reorder the guards
          if (sanitizedAttrs.has(attr)) {
            descriptiveAttrs.set(attr, sanitizedAttrs.get(attr));
          }
        }

        if (descriptiveAttrs.size > 0) {
          record.attributes = descriptiveAttrs;
        }

        const selectors = selectorAttrs(sanitizedAttrs);
        if (selectors.size > 0) {
          record.selectors = selectors;
        }

        if (DOMTracker.INTERACTIVE_TAGS.has(tagName)) {
          record.text = this.#extractText(currentNode);
        }
      } else if (nodeType === NodeType.TEXT) {
        const textContent = DOMTracker.sanitizeValue(
          currentNode["textContent"] ?? "",
        );
        if (pyTruthyValue(textContent)) {
          record.text = textContent;
          const parentRecord =
            currentParentId !== null && currentParentId !== 0
              ? this.nodes.get(currentParentId)
              : undefined;
          if (
            parentRecord !== undefined &&
            Object.hasOwn(parentRecord, "text")
          ) {
            parentRecord.text = textContent;
          }
        }
      }

      const children = currentNode["childNodes"];
      if (Array.isArray(children)) {
        for (const child of children) {
          queue.push([child as Dict, nodeId]);
        }
      }
    }
  }

  /**
   * Concatenate direct text-child content for an interactive element
   * (`_extract_text`, `rrweb_analyzer.py:298-305`).
   *
   * @param node - The element node dict.
   * @returns The space-joined text of its direct text children.
   */
  #extractText(node: Dict): string {
    const texts: string[] = [];
    const children = node["childNodes"];
    if (Array.isArray(children)) {
      for (const child of children) {
        const childDict = child as Dict;
        if (childDict["type"] === NodeType.TEXT) {
          const text = DOMTracker.sanitizeValue(childDict["textContent"] ?? "");
          if (pyTruthyValue(text)) {
            texts.push(String(text));
          }
        }
      }
    }
    return texts.join(" ");
  }

  /**
   * Drop a node + its cached description (mutation remove —
   * `remove_node`, `rrweb_analyzer.py:307-310`).
   *
   * @param nodeId - The rrweb node id.
   */
  removeNode(nodeId: number): void {
    this.nodes.delete(nodeId);
    this.descriptionCache.delete(nodeId);
  }

  /**
   * Update the text of a node + its interactive ancestor, if any
   * (`update_text`, `rrweb_analyzer.py:312-328`).
   *
   * @param nodeId - The rrweb node id.
   * @param text - The new text value.
   */
  updateText(nodeId: number, text: string): void {
    const sanitizedText = DOMTracker.sanitizeValue(text);
    const record = this.nodes.get(nodeId);
    if (record !== undefined) {
      if (pyTruthyValue(sanitizedText)) {
        record.text = sanitizedText;
      } else {
        delete record.text;
      }
      this.descriptionCache.delete(nodeId);
    }

    // Python `self.nodes.get(node_id, {}).get("parent_id")` — absent
    // node yields `None`; then `if parent_id and parent_id in ...`
    // (a `0` parent id is falsy in Python and skips the branch).
    const parentId = record?.parent_id ?? null;
    if (parentId !== null && parentId !== 0) {
      const parent = this.nodes.get(parentId);
      if (parent !== undefined && Object.hasOwn(parent, "text")) {
        if (pyTruthyValue(sanitizedText)) {
          parent.text = sanitizedText;
        } else {
          delete parent.text;
        }
        this.descriptionCache.delete(parentId);
      }
    }
  }

  /**
   * Merge new descriptive attributes onto an existing node
   * (`update_attributes`, `rrweb_analyzer.py:330-346`).
   *
   * @param nodeId - The rrweb node id.
   * @param attributes - The mutation's `{attr: value}` payload.
   */
  updateAttributes(nodeId: number, attributes: Dict): void {
    const sanitizedAttrs = new Map<string, unknown>();
    for (const [k, v] of Object.entries(attributes)) {
      if (pyTruthyValue(DOMTracker.sanitizeValue(v))) {
        sanitizedAttrs.set(k, v);
      }
    }
    const descriptiveAttrs = new Map<string, unknown>();
    for (const attr of DOMTracker.DESCRIPTIVE_ATTRS) {
      if (sanitizedAttrs.has(attr)) {
        descriptiveAttrs.set(attr, sanitizedAttrs.get(attr));
      }
    }
    const record = this.nodes.get(nodeId);
    if (record !== undefined) {
      record.attributes ??= new Map<string, unknown>();
      for (const [k, v] of descriptiveAttrs) {
        record.attributes.set(k, v);
      }
      const selectors = selectorAttrs(sanitizedAttrs);
      if (selectors.size > 0) {
        record.selectors ??= new Map<string, string>();
        for (const [k, v] of selectors) {
          record.selectors.set(k, v);
        }
      }
      this.descriptionCache.delete(nodeId);
    }
  }

  /**
   * Return the node's captured `data-*` selector attributes
   * (`get_node_selectors`, `rrweb_analyzer.py:348-365`).
   *
   * @param nodeId - The rrweb node id.
   * @returns A fresh `{attr: value}` map of the node's `data-*`
   *   attributes; empty when the node was never recorded or carried
   *   none.
   */
  getNodeSelectors(nodeId: number): Map<string, string> {
    const node = this.nodes.get(nodeId);
    if (node === undefined) {
      return new Map();
    }
    const selectors = node.selectors;
    if (selectors === undefined || selectors.size === 0) {
      return new Map();
    }
    const out = new Map<string, string>(selectors);
    return out;
  }

  /**
   * Best-effort human-readable description of a node
   * (`get_node_description`, `rrweb_analyzer.py:367-390`).
   *
   * @param nodeId - The rrweb node id.
   * @returns A description built from the node's own tag / attributes /
   *   text, falling back to ancestor context, then to the literal
   *   `"element"` sentinel.
   */
  getNodeDescription(nodeId: number): string {
    const cached = this.descriptionCache.get(nodeId);
    if (cached !== undefined) {
      return cached;
    }

    const directDesc = this.buildNodeDescription(nodeId);
    if (directDesc !== null && directDesc !== "") {
      this.descriptionCache.set(nodeId, directDesc);
      return directDesc;
    }

    const ancestorDesc = this.getAncestorContext(nodeId);
    if (ancestorDesc !== null && ancestorDesc !== "") {
      this.descriptionCache.set(nodeId, ancestorDesc);
      return ancestorDesc;
    }

    const fallback = "element";
    this.descriptionCache.set(nodeId, fallback);
    return fallback;
  }

  /**
   * Build a description from the node's own metadata, if any
   * (`_build_node_description`, `rrweb_analyzer.py:392-451`). The
   * attribute ladder is ORDER-SENSITIVE (packet §9 Caution #11).
   *
   * @param nodeId - The rrweb node id.
   * @returns The description string, or `null` when the node carries no
   *   meaningful descriptive info (caller falls back to ancestor
   *   traversal).
   */
  buildNodeDescription(nodeId: number): string | null {
    const nodeData = this.nodes.get(nodeId);
    if (nodeData === undefined) {
      return null;
    }

    const tag = nodeData.tag ?? "element";
  // eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
    const attrs = nodeData.attributes ?? new Map<string, unknown>();
    const text = nodeData.text ?? "";
    const parts: string[] = [tag];
    let hasMeaningfulInfo = false;

    // `attrs.get(x) is not None` — a present-but-empty value still
    // counts (the sanitizer already dropped falsy values on ingest).
    const ariaLabel = attrs.get("aria-label");
    const title = attrs.get("title");
    const alt = attrs.get("alt");
    const placeholder = attrs.get("placeholder");
    if (ariaLabel !== undefined && ariaLabel !== null) {
      parts.push(`"${pythonStrOf(ariaLabel)}"`);
      hasMeaningfulInfo = true;
    } else if (title !== undefined && title !== null) {
      parts.push(`"${pythonStrOf(title)}"`);
      hasMeaningfulInfo = true;
    } else if (alt !== undefined && alt !== null) {
      parts.push(`alt="${pythonStrOf(alt)}"`);
      hasMeaningfulInfo = true;
    } else if (pyTruthyValue(text)) {
      parts.push(`"${pythonStrOf(text)}"`);
      hasMeaningfulInfo = true;
    } else if (placeholder !== undefined && placeholder !== null) {
      parts.push(`placeholder="${pythonStrOf(placeholder)}"`);
      hasMeaningfulInfo = true;
    }

    const href = attrs.get("href");
    if (href !== undefined && href !== null && tag === "a") {
      const hrefStr = pythonStrOf(href);
      if (hrefStr.startsWith("http")) {
        const path = urlParsePath(hrefStr);
        if (path !== "" && path !== "/") {
          parts.push(`to ${path}`);
          hasMeaningfulInfo = true;
        }
      }
    }

    const id = attrs.get("id");
    if (id !== undefined && id !== null && !hasMeaningfulInfo) {
      parts.push(`#${pythonStrOf(id)}`);
      hasMeaningfulInfo = true;
    }

    const type_ = attrs.get("type");
    if (tag === "input" && type_ !== undefined && type_ !== null) {
      parts.push(`type=${pythonStrOf(type_)}`);
      hasMeaningfulInfo = true;
    }

    if (hasMeaningfulInfo) {
      return parts.join(" ");
    }
    return null;
  }

  /**
   * Walk up to {@link MAX_ANCESTOR_DEPTH} parents for descriptive
   * context (`_get_ancestor_context`, `rrweb_analyzer.py:453-487`).
   *
   * @param nodeId - The rrweb node id.
   * @returns `"{tag} in {parent_description}"` when a describable
   *   ancestor is reachable; `null` otherwise.
   */
  getAncestorContext(nodeId: number): string | null {
    const nodeData = this.nodes.get(nodeId);
    if (nodeData === undefined) {
      return null;
    }

    const tag = nodeData.tag ?? "element";

    let parentId = nodeData.parent_id;
    let depth = 0;
    const visited = new Set<number>();

    // Python `while parent_id and depth < MAX`: a `None` or `0` parent
    // id terminates the walk.
    while (
      parentId !== null &&
      parentId !== 0 &&
      depth < this.MAX_ANCESTOR_DEPTH
    ) {
      if (visited.has(parentId)) {
        break;
      }
      visited.add(parentId);

      const parentDesc =
        this.descriptionCache.get(parentId) ??
        this.buildNodeDescription(parentId);
      if (parentDesc !== null && parentDesc !== "") {
        return `${tag} in ${parentDesc}`;
      }

      const parentRecord = this.nodes.get(parentId);
      if (parentRecord === undefined) {
        break;
      }
      parentId = parentRecord.parent_id;
      depth += 1;
    }

    return null;
  }
}

// =============================================================================
// EventAnalyzer — emits structured public UserAction + description lines
// =============================================================================

/**
 * Maps `MouseInteractionType` to the human-readable verb used in
 * description strings (`_MOUSE_INTERACTION_NAMES`,
 * `rrweb_analyzer.py:496-502`).
 */
const MOUSE_INTERACTION_NAMES: ReadonlyMap<number, string> = new Map([
  [MouseInteractionType.CLICK, "clicked"],
  [MouseInteractionType.DBL_CLICK, "double-clicked"],
  [MouseInteractionType.CONTEXT_MENU, "right-clicked"],
  [MouseInteractionType.FOCUS, "focused"],
  [MouseInteractionType.TOUCH_START, "tapped"],
]);

/**
 * Maps the human-readable verb to the public `UserAction.action`
 * literal (`_INTERACTION_TO_ACTION`, `rrweb_analyzer.py:504-514`). All
 * click-family interactions collapse to `"click"` so `ReplayBundle`
 * aggregations work uniformly; the original interaction is preserved in
 * `metadata["interaction"]`.
 */
const INTERACTION_TO_ACTION: ReadonlyMap<string, string> = new Map([
  ["clicked", "click"],
  ["double-clicked", "click"],
  ["right-clicked", "click"],
  ["focused", "click"],
  ["tapped", "touch_start"],
]);

/**
 * Single-pass rrweb event walker emitting structured + textual actions
 * (`EventAnalyzer`, `rrweb_analyzer.py:517-819`).
 *
 * Applies per-source debouncing (scroll / input / selection at 1s each)
 * and plugin-event filtering for `rrweb/console@*` console errors.
 */
class EventAnalyzer {
  /** Scroll debounce window in ms (`SCROLL_DEBOUNCE_MS`). */
  static readonly SCROLL_DEBOUNCE_MS = 1000;

  /** Selection debounce window in ms (`SELECTION_DEBOUNCE_MS`). */
  static readonly SELECTION_DEBOUNCE_MS = 1000;

  /** Per-node input debounce window in ms (`INPUT_DEBOUNCE_MS`). */
  static readonly INPUT_DEBOUNCE_MS = 1000;

  /** The DOM tracker this analyzer feeds (`self.dom_tracker`). */
  readonly domTracker: DOMTracker;

  /** Emitted structured actions (`self.user_actions`). */
  readonly userActions: UserAction[] = [];

  /**
   * Parallel `(timestamp_ms, description)` pairs for the markdown
   * reporter (`self.descriptions`) — kept distinct from
   * {@link userActions} so the `{ts}: {desc}` line format renders
   * directly instead of being reverse-engineered.
   */
  readonly descriptions: Array<[number, string]> = [];

  /** Meta navigations seen so far (`self.pages`). */
  readonly pages: PageVisit[] = [];

  /** Console errors seen so far (`self.errors`). */
  readonly errors: ConsoleError[] = [];

  /** The active page URL (`self.current_url`). */
  currentUrl: string | null = null;

  /** Last emitted scroll timestamp (`self.last_scroll_time`). */
  lastScrollTime = 0;

  /** Last emitted selection timestamp (`self.last_selection_time`). */
  lastSelectionTime = 0;

  /** Per-node last-input timestamps (`self.last_input_time`). */
  readonly lastInputTime: Map<number, number> = new Map();

  /**
   * Initialize the analyzer with an optional pre-seeded DOM tracker
   * (`__init__`, `rrweb_analyzer.py:532-546`).
   *
   * @param domTracker - Optional pre-seeded tracker.
   */
  constructor(domTracker?: DOMTracker) {
    this.domTracker = domTracker ?? new DOMTracker();
  }

  /**
   * Append both a structured `UserAction` and a
   * `(timestamp, description)` line (`_emit`,
   * `rrweb_analyzer.py:548-582`).
   *
   * @param timestamp - Unix ms.
   * @param action - One of the public `UserAction.action` literals.
   * @param description - Human-readable text for the markdown line.
   * @param options - Node id / target label / url / metadata extras.
   */
  emit(
    timestamp: number,
    action: string,
    description: string,
    options: {
      targetNodeId?: number | null;
      targetDesc?: string | null;
      url?: string | null;
      metadata?: Record<string, unknown> | null;
    } = {},
  ): void {
    this.descriptions.push([timestamp, description]);
    const targetDesc = options.targetDesc;
    const url = options.url;
    const metadata = options.metadata;
    this.userActions.push(
      new UserAction({
        timestamp,
        action: action as ReplayActionLabel,
        target_node_id: options.targetNodeId ?? null,
        // Python `target_desc or description` — empty label falls back.
        target_desc:
          targetDesc === undefined || targetDesc === null || targetDesc === ""
            ? description
            : targetDesc,
        url: url ?? this.currentUrl,
        metadata: metadata ?? {},
        description,
      }),
    );
  }

  /**
   * Dispatch a single rrweb event to its type-specific handler
   * (`process_event`, `rrweb_analyzer.py:584-597`).
   *
   * @param event - The raw rrweb event dict.
   */
  processEvent(event: Dict): void {
    const eventType = event["type"];
    // `int(event.get("timestamp", 0))` — the default applies ONLY when
    // the key is ABSENT; an explicit `null` reaches `int(None)` and
    // raises `TypeError` (B5-ARB FID-F3).
    const timestamp = pythonIntCoerce(
      Object.hasOwn(event, "timestamp") ? event["timestamp"] : 0,
    );
    const rawData = event["data"];
    const data: Dict = isPythonDict(rawData) ? rawData : {};

    switch (eventType) {
      case EventType.META: {
        this.#processMeta(timestamp, data);

        break;
      }
      case EventType.FULL_SNAPSHOT: {
        this.#processFullSnapshot(data);

        break;
      }
      case EventType.INCREMENTAL_SNAPSHOT: {
        this.#processIncrementalSnapshot(timestamp, data);

        break;
      }
      case EventType.PLUGIN: {
        this.#processPluginEvent(timestamp, data);

        break;
      }
      // No default
    }
  }

  /**
   * Handle navigations (Meta events) — update current URL + emit
   * (`_process_meta`, `rrweb_analyzer.py:599-611`).
   *
   * @param timestamp - Unix ms.
   * @param data - The event's `data` payload.
   */
  #processMeta(timestamp: number, data: Dict): void {
    const url = data["href"];
    if (pyTruthyValue(url)) {
      const urlStr = String(url);
      this.currentUrl = urlStr;
      this.pages.push({ timestamp, url: urlStr });
      this.emit(timestamp, "navigate", `Navigated to ${urlStr}`, {
        url: urlStr,
        metadata: { url: urlStr },
      });
    }
  }

  /**
   * Ingest a FullSnapshot root into the DOM tracker; emit no action
   * (`_process_full_snapshot`, `rrweb_analyzer.py:613-618`).
   *
   * @param data - The event's `data` payload.
   */
  #processFullSnapshot(data: Dict): void {
    const node = data["node"];
    if (pyTruthyValue(node) && isPythonDict(node)) {
      this.domTracker.addNode(node);
    }
  }

  /**
   * Route incremental snapshots by their `data.source` discriminator
   * (`_process_incremental_snapshot`, `rrweb_analyzer.py:620-633`).
   *
   * @param timestamp - Unix ms.
   * @param data - The event's `data` payload.
   */
  #processIncrementalSnapshot(timestamp: number, data: Dict): void {
    const source = data["source"];
    switch (source) {
      case IncrementalSource.MUTATION: {
        this.#processMutation(data);

        break;
      }
      case IncrementalSource.MOUSE_INTERACTION: {
        this.#processMouseInteraction(timestamp, data);

        break;
      }
      case IncrementalSource.SCROLL: {
        this.#processScroll(timestamp);

        break;
      }
      case IncrementalSource.INPUT: {
        this.#processInput(timestamp, data);

        break;
      }
      case IncrementalSource.SELECTION: {
        this.#processSelection(timestamp, data);

        break;
      }
      // No default
    }
  }

  /**
   * Apply Mutation adds / removes / texts / attributes to the DOM
   * tracker (`_process_mutation`, `rrweb_analyzer.py:635-656`).
   *
   * @param data - The event's `data` payload.
   */
  #processMutation(data: Dict): void {
    for (const add of iterList(data["adds"])) {
      const entry = add as Dict;
      const node = entry["node"];
      const parentId = entry["parentId"];
      if (pyTruthyValue(node) && isPythonDict(node)) {
        this.domTracker.addNode(
          node,
          typeof parentId === "number" ? parentId : null,
        );
      }
    }
    for (const remove of iterList(data["removes"])) {
      const nodeId = (remove as Dict)["id"];
      if (pyTruthyValue(nodeId) && typeof nodeId === "number") {
        this.domTracker.removeNode(nodeId);
      }
    }
    for (const textChange of iterList(data["texts"])) {
      const entry = textChange as Dict;
      const nodeId = entry["id"];
      const value = entry["value"];
      if (
        pyTruthyValue(nodeId) &&
        typeof nodeId === "number" &&
        pyTruthyValue(value)
      ) {
        this.domTracker.updateText(nodeId, String(value));
      }
    }
    for (const attrChange of iterList(data["attributes"])) {
      const entry = attrChange as Dict;
      const nodeId = entry["id"];
      const attributes = entry["attributes"];
      if (
        pyTruthyValue(nodeId) &&
        typeof nodeId === "number" &&
        pyTruthyValue(attributes) &&
        isPythonDict(attributes)
      ) {
        this.domTracker.updateAttributes(nodeId, attributes);
      }
    }
  }

  /**
   * Emit click-family / focus / touch-start actions for interactions
   * (`_process_mouse_interaction`, `rrweb_analyzer.py:658-692`).
   *
   * @param timestamp - Unix ms.
   * @param data - The event's `data` payload.
   */
  #processMouseInteraction(timestamp: number, data: Dict): void {
    const interactionType = data["type"];
    const nodeId = data["id"];

    // Python `isinstance(interaction_type, int)` — `bool` IS an int
    // subclass in CPython, and `True == 1` never matches the name map,
    // so the practical domain is plain integers.
    if (
      typeof interactionType !== "number" ||
      !Number.isInteger(interactionType)
    ) {
      return;
    }
    const verb = MOUSE_INTERACTION_NAMES.get(interactionType);
    if (verb === undefined || verb === "") {
      return;
    }

    const nodeDesc =
      nodeId !== undefined && nodeId !== null
        ? this.domTracker.getNodeDescription(nodeId as number)
        : "unknown element";
    if (nodeDesc === "unknown element") {
      return;
    }

    const actionLiteral = INTERACTION_TO_ACTION.get(verb) ?? "click";
    const metadata: Record<string, unknown> = { interaction: verb };
    if (typeof nodeId === "number" && Number.isInteger(nodeId)) {
      // Surface the element's data-* selectors so selectorLabelFn can
      // group by a stable test id instead of falling through to the URL.
      for (const [k, v] of this.domTracker.getNodeSelectors(nodeId)) {
        metadata[k] = v;
      }
    }
    this.emit(timestamp, actionLiteral, `${capitalize(verb)} ${nodeDesc}`, {
      targetNodeId:
        typeof nodeId === "number" && Number.isInteger(nodeId) ? nodeId : null,
      targetDesc: nodeDesc,
      metadata,
    });
  }

  /**
   * Emit a debounced scroll action (`_process_scroll`,
   * `rrweb_analyzer.py:694-699`).
   *
   * @param timestamp - Unix ms.
   */
  #processScroll(timestamp: number): void {
    if (timestamp - this.lastScrollTime > EventAnalyzer.SCROLL_DEBOUNCE_MS) {
      this.emit(timestamp, "scroll", "Scrolled", { targetDesc: "(viewport)" });
    }
    this.lastScrollTime = timestamp;
  }

  /**
   * Emit a debounced input action (per-node) — `_process_input`,
   * `rrweb_analyzer.py:701-742`.
   *
   * @param timestamp - Unix ms.
   * @param data - The event's `data` payload.
   */
  #processInput(timestamp: number, data: Dict): void {
    const nodeId = data["id"];
    const text = data["text"] ?? "";
    const isChecked = data["isChecked"];

    if (nodeId !== undefined && nodeId !== null) {
      const lastTime = this.lastInputTime.get(nodeId as number) ?? 0;
      if (timestamp - lastTime <= EventAnalyzer.INPUT_DEBOUNCE_MS) {
        return;
      }
      this.lastInputTime.set(nodeId as number, timestamp);
    }

    const nodeDesc =
      nodeId !== undefined && nodeId !== null
        ? this.domTracker.getNodeDescription(nodeId as number)
        : "input";

    let description: string;
    if (isChecked !== undefined && isChecked !== null) {
      const state = pyTruthyValue(isChecked) ? "checked" : "unchecked";
      description = `Set ${nodeDesc} to ${state}`;
    } else if (pyTruthyValue(text)) {
      description = `Entered '${pythonStrOf(text)}' in ${nodeDesc}`;
    } else {
      description = `Modified ${nodeDesc}`;
    }

    const metadata: Record<string, unknown> = {
      // Python `len(text) if isinstance(text, str) else 0` — `len` is
      // code points (R11.6).
      text_length: typeof text === "string" ? cpLength(text) : 0,
      is_checked: isChecked === undefined ? null : isChecked,
    };
    if (typeof nodeId === "number" && Number.isInteger(nodeId)) {
      for (const [k, v] of this.domTracker.getNodeSelectors(nodeId)) {
        metadata[k] = v;
      }
    }
    this.emit(timestamp, "input", description, {
      targetNodeId:
        typeof nodeId === "number" && Number.isInteger(nodeId) ? nodeId : null,
      targetDesc: nodeDesc,
      metadata,
    });
  }

  /**
   * Emit a debounced text-selection action (`_process_selection`,
   * `rrweb_analyzer.py:744-786`).
   *
   * @param timestamp - Unix ms.
   * @param data - The event's `data` payload.
   */
  #processSelection(timestamp: number, data: Dict): void {
    const rangesRaw = data["ranges"] ?? [];
    const ranges = iterList(rangesRaw);
    if (!pyTruthyValue(rangesRaw) || ranges.length === 0) {
      return;
    }

    if (
      timestamp - this.lastSelectionTime >
      EventAnalyzer.SELECTION_DEBOUNCE_MS
    ) {
      const selectedTexts: string[] = [];

      for (const rangeRaw of ranges) {
        const rangeData = rangeRaw as Dict;
        const startNodeId = rangeData["start"];
        const endNodeId = rangeData["end"];
        const startOffset = (rangeData["startOffset"] ?? 0) as number;
        const endOffset = (rangeData["endOffset"] ?? 0) as number;

        if (
          startNodeId === endNodeId &&
          pyTruthyValue(startNodeId) &&
          this.domTracker.nodes.has(startNodeId as number)
        ) {
          const nodeData = this.domTracker.nodes.get(
            startNodeId as number,
          ) as TrackedNode;
          if (Object.hasOwn(nodeData, "text")) {
            const textContent = String(nodeData.text);
            // R11.6 — Python slicing is by CODE POINT.
            const text = pythonStrip(
              cpSlice(textContent, startOffset, endOffset),
            );
            if (text !== "") {
              selectedTexts.push(text);
            }
          }
        }
      }

            // eslint-disable-next-line max-depth -- mirrors the Python nesting; flattening would reorder the guards
      const description =
        selectedTexts.length > 0
          ? `Selected '${selectedTexts.join(" ... ")}'`
          : "Selected text";

      this.emit(timestamp, "select", description, {
        targetDesc: "(selection)",
        metadata: { range_count: ranges.length },
      });
    }
    this.lastSelectionTime = timestamp;
  }

  /**
   * Emit `console_error` actions for `rrweb/console@*` plugin payloads
   * (`_process_plugin_event`, `rrweb_analyzer.py:788-819`).
   *
   * @param timestamp - Unix ms.
   * @param data - The event's `data` payload.
   */
  #processPluginEvent(timestamp: number, data: Dict): void {
    const plugin = data["plugin"] ?? "";
    if (typeof plugin !== "string" || !plugin.startsWith("rrweb/console@")) {
      return;
    }

    const payloadRaw = data["payload"] ?? {};
    const payload: Dict = isPythonDict(payloadRaw) ? payloadRaw : {};
    const level = payload["level"] ?? "";
    if (level !== "error") {
      return;
    }

    const messagesRaw = payload["payload"] ?? [];
    if (!pyTruthyValue(messagesRaw)) {
      return;
    }
    const messages = iterList(messagesRaw);

    // Python `" ".join(str(m).strip('"') for m in messages)`.
    const message = messages
      .map((m) => stripQuotes(pythonStr(m as PythonValue)))
      .join(" ");
    if (message === "") {
      return;
    }

    this.errors.push({ timestamp, message, url: this.currentUrl });
    this.emit(timestamp, "console_error", `Console error: ${message}`, {
      targetDesc: message,
      metadata: { message },
    });
  }
}

// =============================================================================
// Markdown reporter
// =============================================================================

/**
 * Render `{ts_seconds}: {description}` lines, collapsing runs
 * (`_collapse_timeline`, `rrweb_analyzer.py:820-846`).
 *
 * Consecutive entries with an identical description coalesce into a
 * single line with a `(×N)` suffix. The timestamp shown is the first in
 * the run.
 *
 * @param lines - `(timestamp_ms, description)` pairs in timeline order.
 * @returns Newline-joined markdown; `""` for empty input.
 */
function collapseTimeline(
  lines: ReadonlyArray<readonly [number, string]>,
): string {
  const out: string[] = [];
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const [ts, desc] = lines[i] as readonly [number, string];
    let j = i + 1;
    while (j < n && (lines[j] as readonly [number, string])[1] === desc) {
      j += 1;
    }
    const run = j - i;
    const suffix = run > 1 ? ` (×${run})` : "";
    // Python `ts // 1000` is FLOOR division (negative timestamps floor
    // toward -inf); `Math.floor` is the exact twin.
    out.push(`${Math.floor(ts / 1000)}: ${desc}${suffix}`);
    i = j;
  }
  return out.join("\n");
}

/**
 * Render `{ts_seconds}: {description}` lines from a description list
 * (`MarkdownReporter`, `rrweb_analyzer.py:849-871`).
 */
export class MarkdownReporter {
  /** The parallel `(timestamp_ms, description)` pairs. */
  readonly descriptions: ReadonlyArray<readonly [number, string]>;

  /**
   * Initialize with parallel `(timestamp_ms, description)` pairs.
   *
   * @param descriptions - The pairs, in timeline order.
   */
  constructor(descriptions: ReadonlyArray<readonly [number, string]>) {
    this.descriptions = descriptions;
  }

  /**
   * Produce the markdown string, collapsing consecutive duplicates.
   *
   * @returns `"No user actions recorded."` for an empty list; otherwise
   *   one line per `(timestamp, description)` run.
   */
  generate(): string {
    if (this.descriptions.length === 0) {
      return "No user actions recorded.";
    }
    return collapseTimeline(this.descriptions);
  }
}

// =============================================================================
// Public entry point
// =============================================================================

/**
 * Convert a raw rrweb event stream into normalized actions + markdown
 * (`RrwebAnalyzer`, `rrweb_analyzer.py:874-921`).
 *
 * Stateless across calls: each {@link analyze} invocation constructs its
 * own {@link DOMTracker} + {@link EventAnalyzer}. Inputs are not
 * mutated; events are sorted by timestamp before processing.
 *
 * @example
 * ```ts
 * const result = new RrwebAnalyzer().analyze(rrwebEvents);
 * for (const action of result.actions) {
 *   // action.timestamp, action.action, action.target_desc
 * }
 * ```
 */
export class RrwebAnalyzer {
  /** The `log.info` sink (R9.5). */
  readonly #logger: AnalyzerLogger | undefined;

  /**
   * Create an analyzer.
   *
   * @param logger - Optional log sink (also threaded to the tracker).
   */
  constructor(logger?: AnalyzerLogger) {
    this.#logger = logger;
  }

  /**
   * Walk `events` once and produce the {@link AnalyzerResult}
   * (`analyze`, `rrweb_analyzer.py:892-921`).
   *
   * @param events - Raw rrweb event dicts. Order doesn't matter — the
   *   analyzer sorts a shallow copy by `timestamp` before walking.
   * @returns The action list, markdown timeline, page visits, and
   *   console errors. Empty on empty input.
   */
  analyze(events: readonly Dict[]): AnalyzerResult {
    if (events.length === 0) {
      return { actions: [], markdown_summary: "", pages: [], errors: [] };
    }

    // Python `sorted(...)` is STABLE; so is `Array.prototype.sort` in
    // every ES2019+ engine. Decorate-sort-undecorate (B5-ARB FID-F3):
    // Python computes `int(e.get("timestamp", 0))` for EVERY element —
    // including single-element lists a JS comparator would never
    // visit — and the default applies only when the key is ABSENT
    // (an explicit `null` raises `int(None)`'s `TypeError`).
    const sortedEvents = events
      .map((event) => ({
        event,
        key: pythonIntCoerce(
          Object.hasOwn(event, "timestamp") ? event["timestamp"] : 0,
        ),
      }))
      .sort((a, b) => a.key - b.key)
      .map((decorated) => decorated.event);

    const domTracker = new DOMTracker({ logger: this.#logger });
    const eventAnalyzer = new EventAnalyzer(domTracker);
    for (const event of sortedEvents) {
      eventAnalyzer.processEvent(event);
    }

    const markdown = new MarkdownReporter(
      eventAnalyzer.descriptions,
    ).generate();
    this.#logger?.info?.(
      `Generated ${String(eventAnalyzer.userActions.length)} user actions`,
    );
    return {
      actions: eventAnalyzer.userActions,
      markdown_summary: markdown,
      pages: eventAnalyzer.pages,
      errors: eventAnalyzer.errors,
    };
  }
}

/**
 * Convenience entry: walk events + return the markdown string
 * (`analyze_events`, `rrweb_analyzer.py:924-949`).
 *
 * @param rrwebEvents - List of rrweb event dicts.
 * @param logger - Optional log sink (R9.5).
 * @returns The markdown timeline string.
 * @throws ValueError - `rrwebEvents` is empty or not a list.
 */
export function analyzeEvents(
  rrwebEvents: readonly Dict[],
  logger?: AnalyzerLogger,
): string {
  // Guard order is SOURCE order: the emptiness check runs FIRST, so a
  // non-list falsy input (e.g. `""`) raises "cannot be empty".
  if (!pyTruthyValue(rrwebEvents)) {
    throw new ValueError("Events list cannot be empty");
  }
  if (!Array.isArray(rrwebEvents)) {
    throw new ValueError("Events must be a list of dictionaries");
  }

  logger?.info?.(`Analyzing ${String(rrwebEvents.length)} rrweb events`);
  return new RrwebAnalyzer(logger).analyze(rrwebEvents).markdown_summary;
}

/**
 * Render a markdown timeline from a structured action list
 * (`_render_markdown`, `rrweb_analyzer.py:952-969`).
 *
 * Renders each action's full `description` (falling back to
 * `target_desc` when empty) and collapses consecutive duplicates via
 * {@link collapseTimeline}, matching the analyzer's `markdown_summary`.
 *
 * @param actions - Structured action list (may be empty).
 * @returns Multi-line markdown string. Empty when `actions` is empty.
 */
export function renderMarkdown(actions: readonly UserAction[]): string {
  if (actions.length === 0) {
    return "";
  }
  return collapseTimeline(
    actions.map(
      (a) =>
        [a.timestamp, a.description === "" ? a.target_desc : a.description] as [
          number,
          string,
        ],
    ),
  );
}

// =============================================================================
// Local helpers (no Python twin — the JS-side plumbing the port needs)
// =============================================================================

/**
 * CPython truthiness for a `dict`-sourced value (Python `if x:`).
 *
 * @param value - The value to test.
 * @returns `true` when CPython would treat the value as truthy.
 */
function pyTruthyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false) {
    return false;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return value.length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value instanceof Map) {
    return value.size > 0;
  }
  if (isPythonDict(value)) {
    return Object.keys(value).length > 0;
  }
  return true;
}

/**
 * Iterate a `for x in (data.get(k, []) or [])` site: a non-list value
 * (or `None`) yields nothing, exactly as the `or []` fallback does.
 *
 * @param value - The raw payload member.
 * @returns The list to walk (empty for non-lists).
 */
function iterList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * `str.capitalize()` — upper-case the first CHARACTER, lower-case the
 * rest (Python's semantics; JS has no builtin twin).
 *
 * @param text - The verb to capitalize.
 * @returns The capitalized text.
 */
function capitalize(text: string): string {
  const chars = codepoints(text);
  if (chars.length === 0) {
    return text;
  }
  return (
    (chars[0] as string).toUpperCase() + chars.slice(1).join("").toLowerCase()
  );
}

/**
 * `str.strip('"')` — drop every leading and trailing double-quote
 * (Python strips the whole character SET, not one occurrence).
 *
 * @param text - The message fragment.
 * @returns The text without surrounding quotes.
 */
function stripQuotes(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === '"') {
    start += 1;
  }
  while (end > start && text[end - 1] === '"') {
    end -= 1;
  }
  return text.slice(start, end);
}

/**
 * `urllib.parse.urlparse(href).path` for the `<a href="http…">` branch
 * (`rrweb_analyzer.py:434-443`) — the analyzer only reads `.path`, and
 * CPython's parser takes everything after the authority up to the
 * first `?` or `#`.
 *
 * The Python site wraps the call in a bare `except Exception: pass`, so
 * an unparseable href degrades to "no path" rather than raising.
 *
 * @param href - The absolute URL.
 * @returns The path component (`""` when absent / unparseable).
 */
function urlParsePath(href: string): string {
  // Strip the scheme (`urlparse` requires `scheme:`; the caller has
  // already checked `startsWith("http")`).
  const schemeAt = href.indexOf(":");
  const afterScheme = schemeAt === -1 ? href : href.slice(schemeAt + 1);
  let rest = afterScheme;
  if (rest.startsWith("//")) {
    // Authority runs to the next `/`, `?` or `#`.
    const authority = rest.slice(2);
    const stopAt = firstIndexOfAny(authority, ["/", "?", "#"]);
    rest = stopAt === -1 ? "" : authority.slice(stopAt);
    if (rest.startsWith("?") || rest.startsWith("#")) {
      return "";
    }
  }
  const cut = firstIndexOfAny(rest, ["?", "#"]);
  return cut === -1 ? rest : rest.slice(0, cut);
}

/**
 * Index of the first occurrence of any of `needles`, or `-1`.
 *
 * @param text - The haystack.
 * @param needles - Single-character needles.
 * @returns The lowest index, or `-1`.
 */
function firstIndexOfAny(text: string, needles: readonly string[]): number {
  let best = -1;
  for (const needle of needles) {
    const at = text.indexOf(needle);
    if (at !== -1 && (best === -1 || at < best)) {
      best = at;
    }
  }
  return best;
}
