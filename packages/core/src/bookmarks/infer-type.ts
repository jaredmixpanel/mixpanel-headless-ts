/**
 * Report-type inference from a bookmark `params` object, for callers
 * that hold only a query body's `bookmark` member and need the
 * `bookmarkType` that belongs beside it (the desktop app's QueryRef).
 *
 * This is not a top-level key check: there is no `type` / `kind` /
 * `bookmark_type` member in params, and insights and funnels emit an
 * identical `{sections, displayOptions}` key set for every option
 * combination (`buildParams` vs `buildFunnelParams`) and POST the same
 * envelope to the same `/query/insights` route — in the library the
 * report type is carried purely by which method the caller invoked, and
 * `reportLinkInputs`, handed a bare dict, likewise defaults to
 * `insights` rather than inferring.
 *
 * The one contract-backed signal is nested: `sections.show[].behavior.type`
 * is a `MetricType` (`VALID_METRIC_TYPES` in `bookmarks/enums.ts`,
 * mirroring `vendor/mixpanel-contracts/bookmark.json`), and the three
 * insights-family builders each stamp a distinct value there —
 * `"event"` / `"cohort"` for insights, `"funnel"`, `"retention"`. Flows
 * is a different shape entirely: a flat dict with `steps` and
 * `date_range` and no `sections`, and its own `/query/arb_funnels` route.
 *
 * Deliberately weaker signals, not used: `sections.formula` (absent for
 * insights, `[]` for funnels/retention), `displayOptions.analysis`
 * (insights only) and the `sorting` + `columnWidths` pair (retention
 * only) separate the families for builder output, but the vendored
 * contract makes each optional on any insights-family bookmark, so a
 * server round-trip may add or drop them.
 *
 * Ambiguity returns `null`, never a guess: a params object with no
 * readable behavior clause (an empty `show` list, a leading `formula`
 * or `warehouse` clause, an unknown metric type) is unclassifiable from
 * its shape, and callers record `bookmarkType: null`; it is not part of
 * the QueryRef hash, so a `null` costs identity nothing.
 */

import type { ReportLinkType } from "../types/literals.js";

/**
 * `MetricType` values that pin a behavior clause to a report type.
 * `"formula"` and `"warehouse"` are deliberately absent: they describe the
 * clause, not the query family.
 */
const BEHAVIOR_TYPE_TO_REPORT: ReadonlyMap<string, ReportLinkType> = new Map([
  ["event", "insights"],
  ["simple", "insights"],
  ["custom-event", "insights"],
  ["cohort", "insights"],
  ["people", "insights"],
  ["funnel", "funnels"],
  ["retention", "retention"],
  ["retention-frequency", "retention"],
]);

/**
 * Narrow an unknown to a plain, index-readable record.
 *
 * @param value - The candidate.
 * @returns The value as a record, or `undefined` when it is not a non-array
 *   object.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

/**
 * Infer the report type of a bookmark `params` object from its shape.
 *
 * Only the members the vendored bookmark contract ties to a query family
 * are consulted; anything else yields `null`. The result is advisory
 * metadata (`bookmarkType` sits beside the QueryRef hash and is never
 * inside it), so callers must be able to live with `null`.
 *
 * @param params - A bookmark params object, as produced by
 *   {@link Workspace.buildParams}, `buildFunnelParams`,
 *   `buildRetentionParams` or `buildFlowParams`, or as received on the
 *   wire in a query body's `bookmark` member.
 * @returns The report type, or `null` when the shape does not determine one.
 * @example
 * ```typescript
 * inferBookmarkType(await ws.buildFunnelParams(["Signup", "Purchase"]));
 * // "funnels"
 * inferBookmarkType({ foo: "bar" });
 * // null
 * ```
 */
export function inferBookmarkType(params: unknown): ReportLinkType | null {
  const root = asRecord(params);
  if (root === undefined) {
    return null;
  }

  if (!("sections" in root)) {
    // Flows: flat params, its own `/query/arb_funnels` route. Require both
    // structural members so an arbitrary dict with a `steps` key (a funnel
    // request body, say) cannot be mistaken for one.
    const isFlows = Array.isArray(root["steps"]) && "date_range" in root;
    return isFlows ? "flows" : null;
  }

  const sections = asRecord(root["sections"]);
  if (sections === undefined) {
    return null;
  }
  const show = sections["show"];
  if (!Array.isArray(show)) {
    return null;
  }
  // The insights-family builders put the behavior clause first (funnels
  // and retention emit exactly one; insights appends formula clauses after
  // its event clauses), so read clause 0 and refuse rather than hunting —
  // a params object whose first clause is a formula or a warehouse query
  // is not one this classifier can speak for.
  const behavior = asRecord(asRecord(show[0])?.["behavior"]);
  const behaviorType = behavior?.["type"];
  if (typeof behaviorType !== "string") {
    return null;
  }
  return BEHAVIOR_TYPE_TO_REPORT.get(behaviorType) ?? null;
}
