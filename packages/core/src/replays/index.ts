/**
 * `replays` module of @mixpanel-headless/core (D11 layout) — the
 * session-replay pure layer, ported at Phase-3 batch B5 shard S3
 * (`context/phase3/design/b5-packets.md` §5).
 *
 * Contents:
 * - {@link module:replay-labels} — the three PUBLIC label helpers
 *   (`mixpanel_headless/replay_labels.py`; re-exported from the package
 *   barrel, closing three phase2-audit A1 deferrals).
 * - {@link module:rrweb-analyzer} — the vendored rrweb analyzer
 *   (`_internal/replays/rrweb_analyzer.py`, pure stdlib).
 * - {@link module:aggregators} — the bundle-level aggregations
 *   (`_internal/replays/aggregators.py`; pandas frames → row arrays).
 *
 * The analyzer and aggregators mirror Python `_internal` and are NOT
 * re-exported from `src/index.ts`; `replay-labels` is.
 */
export {
  defaultLabelFn,
  selectorLabelFn,
  urlNormalizer,
} from "./replay-labels.js";
export {
  DOMTracker,
  EventAnalyzer,
  EventType,
  IncrementalSource,
  MarkdownReporter,
  MouseInteractionType,
  NodeType,
  RrwebAnalyzer,
  analyzeEvents,
  collapseTimeline,
  renderMarkdown,
  selectorAttrs,
} from "./rrweb-analyzer.js";
export type {
  AnalyzerLogger,
  AnalyzerResult,
  ConsoleError,
  EventTypeValue,
  IncrementalSourceValue,
  MouseInteractionTypeValue,
  NodeTypeValue,
  PageVisit,
  TrackedNode,
} from "./rrweb-analyzer.js";
export {
  errorSessions,
  longPauses,
  longPausesRowColumns,
  rageClicks,
  rageClicksRowColumns,
  realClicks,
  topClicks,
  topClicksRowColumns,
} from "./aggregators.js";
export type { LongPauseRow, RageClickRow, TopClickRow } from "./aggregators.js";
