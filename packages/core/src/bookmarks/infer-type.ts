/**
 * Report-type inference from a bookmark `params` object.
 *
 * Asked for by heads spec 02 §5.3 / §10.1
 * (`mixpanel-desktop-app/docs/specs/heads/02-queryref-and-two-body-identity.md`):
 * when the desktop derives a QueryRef from a bridged query it holds only
 * `body.bookmark`, and it needs the `bookmarkType` that sits beside the
 * hash. §10.1 asks for the classifier to live here rather than being
 * re-derived downstream.
 *
 * ## Why this is not a top-level key check
 *
 * There is **no** `type` / `kind` / `bookmark_type` member in params, and
 * insights and funnels emit an identical top-level key set —
 * `{sections, displayOptions}` — for *every* option combination
 * (`workspace-query-params.ts:513` vs `:919`). Both also POST the same
 * `{bookmark, project_id, queryLimits}` envelope to the same
 * `/query/insights` route, so the wire does not separate them either: in
 * the library the report type is carried purely by which method the caller
 * invoked. `reportLinkInputs` (`workspace.ts:6611-6616`) concedes the same
 * point — handed a bare dict it defaults to `insights` rather than
 * inferring.
 *
 * The one **contract-backed** signal is nested: `sections.show[].behavior.type`
 * is a `MetricType` (`bookmarks/enums.ts` `VALID_METRIC_TYPES`, mirroring
 * `vendor/mixpanel-contracts/bookmark.json`), and the three insights-family
 * builders each stamp a distinct value there — `"event"`/`"cohort"` for
 * insights (`:439`, `:325`), `"funnel"` (`:868`), `"retention"` (`:1196`).
 * Flows is a different shape entirely: a flat dict with `steps` and
 * `date_range` and no `sections` (`:1348-1349`), and its own
 * `/query/arb_funnels` route.
 *
 * ## Deliberately weaker signals, and why they are not used
 *
 * `sections.formula` (absent for insights, `[]` for funnels/retention),
 * `displayOptions.analysis` (insights only) and the
 * `sorting` + `columnWidths` pair (retention only) all separate the
 * families for *builder output*, but the vendored contract makes each of
 * them optional on any insights-family bookmark, so a server round-trip
 * may add or drop them. The behaviour type is the only member whose value
 * the contract ties to the kind of query being asked.
 *
 * ## Failure mode
 *
 * Ambiguity returns `null`, never a guess: a params object with no
 * readable behaviour clause (an empty `show` list, a leading `formula` or
 * `warehouse` clause, an unknown metric type) is genuinely unclassifiable
 * from its shape, and the caller records `bookmarkType: null` — which the
 * spec's `MixpanelQueryRefSchema` explicitly allows. `bookmarkType` is not
 * part of the QueryRef hash, so a `null` here costs identity nothing.
 */

import type { ReportLinkType } from "../types/literals.js";

/**
 * `MetricType` values that pin a behaviour clause to a report type.
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
 * metadata (heads spec 02 §4: `bookmarkType` sits beside the QueryRef hash
 * and is never inside it), so callers must be able to live with `null`.
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
    // Flows: flat params, its own `/query/arb_funnels` route. Require BOTH
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
  // The insights-family builders put the behaviour clause first (funnels
  // and retention emit exactly one; insights appends formula clauses AFTER
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
