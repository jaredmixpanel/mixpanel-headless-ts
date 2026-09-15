/**
 * Declarative port-batch status table.
 *
 * Done-ness is data rather than prose so a straggler cannot hide: an unbound
 * api name whose batch is `done` replays as `FAIL_ERROR` instead of the
 * counted-but-passing `UNPORTED`. Lookup is longest-matching-prefix; names
 * matching no prefix are `pending`. Every corpus family is done today, so the
 * shipped table has no pending row and tests inject synthetic pending tables
 * through `RunnerDeps.batchStatuses`. Current numbers: `conformance-runner/GATE.md`.
 */

/** Whether a port batch has been declared complete. */
export type BatchStatus = "pending" | "done";

/**
 * The api-prefix to batch-status table.
 *
 * Prefixes cover every api-name family in the corpus (recorded api-index
 * plus the authored `compat.*`/`wirestub.*` supplements). Lookup is
 * longest-matching-prefix, so a finer-grained prefix can override a
 * coarser one; names matching no prefix default to `pending` (the
 * `UNMAPPED_API` gate already fails names outside every mapping source
 * before this table is consulted).
 */
export const BATCH_STATUS: ReadonlyMap<string, BatchStatus> = new Map<
  string,
  BatchStatus
>([
  ["compat.", "done"],
  ["wirestub.", "done"],
  ["types.", "done"],
  ["api_client.", "done"],
  // An exact name is still a prefix under startsWith matching: this row
  // shadows the `api_client.` row above and agrees with it.
  ["api_client._iter_jsonl_lines", "done"],
  ["workspace.", "done"],
  ["validation.", "done"],
  ["user_validators.", "done"],
  ["user_builders.", "done"],
  ["expressions.", "done"],
  ["transforms.", "done"],
  ["bookmark_builders.", "done"],
  ["segfilter.", "done"],
  ["bookmark_schema.", "done"],
  ["replays.", "done"],
  ["replay_labels.", "done"],
  ["rrweb_analyzer.", "done"],
  ["oauth_flow.", "done"],
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
 * @example
 * ```typescript
 * batchStatusFor("types.Filter.on");
 * // "done"
 * batchStatusFor("oauth_flow.refresh_tokens");
 * // "done" (every corpus api name resolves done)
 * ```
 */
export function batchStatusFor(
  api: string,
  statuses: ReadonlyMap<string, BatchStatus> = BATCH_STATUS,
): BatchStatus {
  let bestLength = -1;
  let best: BatchStatus = "pending";
  for (const [prefix, status] of statuses) {
    if (!(api.startsWith(prefix) && prefix.length > bestLength)) {
      continue;
    }

    bestLength = prefix.length;
    best = status;
  }
  return best;
}
