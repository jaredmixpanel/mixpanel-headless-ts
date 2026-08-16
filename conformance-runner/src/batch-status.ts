/**
 * Declarative port-batch status table (phase2-design C7 item 4 / packet
 * P2-8, R10.5/D12).
 *
 * Before this module existed, "declared done" lived only in prose: an
 * unbound api name always replayed as `UNPORTED` (counted, never
 * failing), so a straggler in a finished batch could hide forever. The
 * table below makes done-ness data: when a vector's api name matches a
 * `'done'` prefix but has no bound implementation, the verdict path
 * (`runner.ts` gate) returns `FAIL_ERROR` instead of `UNPORTED` — no
 * silent skips once a batch is declared complete.
 *
 * Flipping a batch is a one-line change here, made in the same commit
 * that declares the packet done.
 */

/** Whether a port batch has been declared complete (R10.5). */
export type BatchStatus = "pending" | "done";

/**
 * The api-prefix → batch-status table.
 *
 * Prefixes cover every api-name family in the corpus (recorded
 * api-index + authored `compat.*`/`wirestub.*` supplements). Lookup is
 * longest-matching-prefix, so a finer-grained prefix can later override
 * a coarser one; names matching NO prefix default to `'pending'`
 * (`UNPORTED` semantics — the UNMAPPED_API gate already fails names
 * outside every mapping source before this table is consulted).
 *
 * Done batches:
 * - `compat.` / `wirestub.` — the Phase-1 D13 gate slice (the 42).
 * - `types.` — the Phase-2 contract layer (P2-5a..c query params,
 *   P2-6 results/replays; 44 api-index entry points).
 * - `validation.` / `user_validators.` — the Phase-3 B2 validators
 *   (playbook P3-5 §4 B2-gate flip; 690 vectors).
 * - `bookmark_builders.` / `segfilter.` / `user_builders.` /
 *   `expressions.` / `transforms.` / `bookmark_schema.` — the
 *   Phase-3 B3 builders (playbook P3-5 §4 B3-gate flip; 299 vectors;
 *   `bookmark_schema.` is count-neutral — zero corpus vectors, added
 *   so the two oracle-probed schema apis are explicitly B3-owned).
 * - `api_client.` / `pagination.` — the Phase-3 B4 wire client
 *   (playbook P3-5 §4 B4-gate flip; 843 vectors, gate delta 842 — the
 *   P3-1 † carried vector waits on its `workspace.me` setup until B6).
 * - The 44 exact-name `workspace.<member>` entries + `replays.` /
 *   `replay_labels.` / `rrweb_analyzer.` — the Phase-3 B5 services +
 *   facade query half (playbook P3-5 §4 B5-gate flip; 506 vectors).
 *   The 44 names are jq-generated from the api-map
 *   (`.workspace_members[] | select(.batch=="B5")`); an exact name is
 *   still a PREFIX under startsWith matching, so the standing collision
 *   assertion was re-run at the gate: the ONLY cross-batch capture is
 *   `workspace.list_bookmarks` (zero corpus vectors) prefix-capturing
 *   the B6 member `workspace.list_bookmarks_v2` (7 vectors) — resolved
 *   by the longer `workspace.list_bookmarks_v2` → `pending` override
 *   below (REMOVED at the B6 gate when the whole `workspace.` prefix
 *   collapses to `done`); `workspace.query`/`workspace.segmentation`
 *   capture only same-batch B5 names (flipping together, harmless).
 *
 * Pending batches (Phase 3, per plan §6 / api-map):
 * - `workspace.` (the 158 B6 members — the B5 members carry exact-name
 *   `done` overrides above the prefix),
 *   `region_probe.` (B7), `oauth_flow.` (B8).
 */
export const BATCH_STATUS: ReadonlyMap<string, BatchStatus> = new Map<
  string,
  BatchStatus
>([
  ["compat.", "done"],
  ["wirestub.", "done"],
  ["types.", "done"],
  // Phase-3 B4 gate flip (playbook P3-5 §4): the wire client is done —
  // stragglers under `api_client.`/`pagination.` (bottom of table) now
  // FAIL instead of skipping.
  ["api_client.", "done"],
  // Phase-3 B0-2 (playbook P3-5 §4): the ONE B0-owned api name — an
  // exact-name entry is still a PREFIX under startsWith matching
  // (longest-prefix wins over the `api_client.` row above; both read
  // `done` since the B4 gate flip — shadowed-but-consistent, kept per
  // the b4-packets flip spec); the standing collision assertion holds —
  // no other corpus api name starts with this entry.
  ["api_client._iter_jsonl_lines", "done"],
  ["workspace.", "pending"],
  // Phase-3 B5 gate flip (playbook P3-5 §4): the 44 B5-member exact
  // names — longest-prefix wins over the `workspace.` pending row above;
  // stragglers under these names now FAIL instead of skipping.
  ["workspace.activity_feed", "done"],
  ["workspace.analyze_replay", "done"],
  ["workspace.build_flow_params", "done"],
  ["workspace.build_funnel_params", "done"],
  ["workspace.build_params", "done"],
  ["workspace.build_retention_params", "done"],
  ["workspace.build_user_params", "done"],
  ["workspace.clear_discovery_cache", "done"],
  ["workspace.cohorts", "done"],
  ["workspace.event_counts", "done"],
  ["workspace.events", "done"],
  ["workspace.events_for_replay", "done"],
  ["workspace.events_for_replays", "done"],
  ["workspace.fetch_replay", "done"],
  ["workspace.fetch_replays", "done"],
  ["workspace.frequency", "done"],
  ["workspace.funnel", "done"],
  ["workspace.funnels", "done"],
  ["workspace.lexicon_schema", "done"],
  ["workspace.lexicon_schemas", "done"],
  ["workspace.list_bookmarks", "done"],
  // The B5-gate pending override (playbook P3-5 §4, REMOVED at B6):
  // `workspace.list_bookmarks` (B5, zero corpus vectors) would
  // prefix-capture the B6 member's 7 vectors and flip them to
  // FAIL_ERROR; this longer entry wins longest-prefix and keeps them
  // UNPORTED until the B6 gate.
  ["workspace.list_bookmarks_v2", "pending"],
  ["workspace.list_replays", "done"],
  ["workspace.properties", "done"],
  ["workspace.property_counts", "done"],
  ["workspace.property_values", "done"],
  ["workspace.query", "done"],
  ["workspace.query_flow", "done"],
  ["workspace.query_funnel", "done"],
  ["workspace.query_retention", "done"],
  ["workspace.query_saved_flows", "done"],
  ["workspace.query_saved_report", "done"],
  ["workspace.query_user", "done"],
  ["workspace.replays_for_user", "done"],
  ["workspace.retention", "done"],
  ["workspace.schema_graph", "done"],
  ["workspace.segmentation", "done"],
  ["workspace.segmentation_average", "done"],
  ["workspace.segmentation_numeric", "done"],
  ["workspace.segmentation_sum", "done"],
  ["workspace.sign_replay", "done"],
  ["workspace.sign_replays", "done"],
  ["workspace.stream_replay", "done"],
  ["workspace.subproperties", "done"],
  ["workspace.top_events", "done"],
  // Phase-3 B2 gate flip (playbook P3-5 §4): validators are done —
  // stragglers under these prefixes now FAIL instead of skipping.
  ["validation.", "done"],
  ["user_validators.", "done"],
  // Phase-3 B3 gate flip (playbook P3-5 §4): builders are done —
  // stragglers under these prefixes now FAIL instead of skipping.
  // `bookmark_schema.` carries zero corpus vectors (its two apis are
  // oracle/Layer-3-locked, packet b3-packets.md §Batch-status).
  ["user_builders.", "done"],
  ["expressions.", "done"],
  ["transforms.", "done"],
  ["bookmark_builders.", "done"],
  ["segfilter.", "done"],
  ["bookmark_schema.", "done"],
  // Phase-3 B5 gate flip (playbook P3-5 §4): the replays-family
  // prefixes are done — stragglers now FAIL instead of skipping.
  ["replays.", "done"],
  ["replay_labels.", "done"],
  ["rrweb_analyzer.", "done"],
  ["oauth_flow.", "pending"],
  ["region_probe.", "pending"],
  ["pagination.", "done"],
]);

/**
 * Resolve the batch status for a Python dotted api name.
 *
 * @param api - The api name exactly as vectors carry it (e.g.
 *   `types.Filter.on`).
 * @param statuses - The status table (defaults to {@link BATCH_STATUS};
 *   injectable for tests).
 * @returns The status of the longest matching prefix, or `'pending'`
 *   when no prefix matches.
 *
 * @example
 * ```typescript
 * batchStatusFor("types.Filter.on");
 * // "done"
 * batchStatusFor("workspace.build_funnel_params");
 * // "pending"
 * ```
 */
export function batchStatusFor(
  api: string,
  statuses: ReadonlyMap<string, BatchStatus> = BATCH_STATUS,
): BatchStatus {
  let bestLength = -1;
  let best: BatchStatus = "pending";
  for (const [prefix, status] of statuses) {
    if (api.startsWith(prefix) && prefix.length > bestLength) {
      bestLength = prefix.length;
      best = status;
    }
  }
  return best;
}
