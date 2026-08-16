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
 *
 * Pending batches (Phase 3, per plan §6 / api-map):
 * - `api_client.` / `pagination.` (B4), `workspace.` (B5/B6 split),
 *   `replays.` / `replay_labels.` / `rrweb_analyzer.` (B5),
 *   `region_probe.` (B7), `oauth_flow.` (B8).
 */
export const BATCH_STATUS: ReadonlyMap<string, BatchStatus> = new Map<
  string,
  BatchStatus
>([
  ["compat.", "done"],
  ["wirestub.", "done"],
  ["types.", "done"],
  ["api_client.", "pending"],
  // Phase-3 B0-2 (playbook P3-5 §4): the ONE B0-owned api name — an
  // exact-name entry is still a PREFIX under startsWith matching
  // (longest-prefix wins over the pending `api_client.` row above); the
  // standing collision assertion holds — no other corpus api name starts
  // with this entry.
  ["api_client._iter_jsonl_lines", "done"],
  ["workspace.", "pending"],
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
  ["replays.", "pending"],
  ["replay_labels.", "pending"],
  ["rrweb_analyzer.", "pending"],
  ["oauth_flow.", "pending"],
  ["region_probe.", "pending"],
  ["pagination.", "pending"],
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
