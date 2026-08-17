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
 *   P3-1 † carried vector waited on its `workspace.me` setup until B6).
 * - `workspace.` — the ENTIRE facade, collapsed at the B6 gate
 *   (playbook P3-5 §4 B6-gate rule / b6-packets.md §12.1): the B5 gate
 *   had flipped 44 exact-name `workspace.<member>` entries over a
 *   `workspace.` → `pending` row (plus a `workspace.list_bookmarks_v2`
 *   → `pending` override shielding the B6 member's 7 vectors from the
 *   B5 `workspace.list_bookmarks` exact-name prefix-capture); with the
 *   158 B6 members done (353 vectors + the P3-1 † carried
 *   `api_client.resolve_workspace_id` vector = gate delta 354), the
 *   exact names, the override, and the pending row all collapse to
 *   this single prefix — longest-prefix keeps the states equivalent
 *   for every B5 name, and the override removal is the B5-gate forward
 *   note landing here. Collision assertion re-run over the FINAL
 *   table at the gate: the only still-pending corpus api names are
 *   `region_probe.probe_region` ×14 and `oauth_flow.refresh_tokens`
 *   ×7, neither prefixed by any `done` entry.
 * - `replays.` / `replay_labels.` / `rrweb_analyzer.` — the Phase-3
 *   B5 services (playbook P3-5 §4 B5-gate flip; 506 vectors with the
 *   B5 facade members).
 * - `region_probe.` — the Phase-3 B7 auth resolver/probe batch
 *   (playbook P3-5 §4 B7-gate flip / b7-packets.md §4; 14 vectors,
 *   all `region_probe.probe_region`, bound at B7-A2 and passing
 *   while pending).
 * - `oauth_flow.` — the Phase-3 B8 node/auth batch (playbook P3-5 §4
 *   B8-gate flip / b8-packets.md §5.1; 7 vectors, all
 *   `oauth_flow.refresh_tokens`, bound at B8-N2 and passing while
 *   pending). This was the LAST pending prefix.
 *
 * TERMINAL STATE (B8 gate, 2026-08-16): the table contains ZERO
 * `'pending'` entries — every corpus api name (measured and setup)
 * resolves `'done'`, and the full-corpus report reads
 * 3,251 PASS / 0 FAIL / 0 UNPORTED (corpus pin `70c904dc`). Collision
 * assertion re-run over the FINAL table at the gate: the only corpus
 * api name matching the freshly flipped prefix is
 * `oauth_flow.refresh_tokens` ×7, and NO still-pending corpus api name
 * remains (there are no pending entries left to shadow). The
 * UNPORTED-probe corpus-name anchor pattern is retired per
 * b8-packets.md §5.3 / b6-packets.md §12.5: the runner's UNPORTED path
 * stays covered by SYNTHETIC batch tables injected through
 * `RunnerDeps.batchStatuses` inside the tests — a pending entry never
 * re-enters this shipped table.
 *
 * ADDENDUM (ARB-A R1, 2026-08-17): the TERMINAL STATE paragraph above
 * is a dated historical record of the B8 gate, not current corpus
 * state — the R10.7 four-bug maintenance batch subsequently re-pinned
 * the corpus (pin `70c904dc` -> `700db996`, 3,251 -> 3,262 vectors;
 * still 0 FAIL / 0 UNPORTED, zero pending entries).
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
  // Phase-3 B6 gate collapse (playbook P3-5 §4 / b6-packets.md §12.1):
  // the whole facade is done — the B5-era 44 exact-name entries, the
  // `workspace.list_bookmarks_v2` pending override, and the
  // `workspace.` pending row all collapse to this single prefix;
  // stragglers under any `workspace.*` name now FAIL instead of
  // skipping.
  ["workspace.", "done"],
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
  // Phase-3 B8 gate flip (playbook P3-5 §4 / b8-packets.md §5.1): the
  // node/auth batch is done — stragglers under `oauth_flow.` now FAIL
  // instead of skipping. This flip closes the ENTIRE corpus: zero
  // pending entries remain (terminal state, header comment above).
  ["oauth_flow.", "done"],
  // Phase-3 B7 gate flip (playbook P3-5 §4 / b7-packets.md §4): the
  // auth resolver/region-probe batch is done — stragglers under
  // `region_probe.` now FAIL instead of skipping.
  ["region_probe.", "done"],
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
 * batchStatusFor("oauth_flow.refresh_tokens");
 * // "done" (terminal state — every corpus api name resolves done)
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
