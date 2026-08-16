# B6-W3 — R10.9 throwaway harness RUN record

Throwaway. The B6 gate (`b6-packets.md` §12) deletes `throwaway/b6-w3/`;
this record is mirrored into `context/phase3/notes/B6-W3-notes.md`
§R10.9 (Python repo), which survives.

## Shape

W3's 16 members are FACADE delegations over the B4-C3 bookmark/cohort
wire methods — all-wire, no oracle-callable surface (§11.5), so there is
no `py-side.py` differential half. One file:

| file            | role                                                         |
| --------------- | ------------------------------------------------------------ |
| `wire-edges.ts` | delegation equivalence + status branches + edge set + errors |

Run:

```
npx vite-node throwaway/b6-w3/wire-edges.ts
```

Deterministic (no RNG, no seed): every case is a hand-built canned
interaction over the injected-fetch seam.

## Counts

```
checks 45   failures 0
```

## Coverage

| group                        | cases                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (i) delegation equivalence   | `list_bookmarks_v2`, `get_bookmark`, `get_bookmark_history`, `list_cohorts_full`, `get_cohort`, `bookmark_linked_dashboard_ids` (facade result === direct client result re-validated through the same model seam)                                                                                                                                                                                                                       |
| (ii) wire status branches    | `get_bookmark` 200 / 404 (`QueryError/QUERY_FAILED`) / 500 (`ServerError/SERVER_ERROR`); `create_cohort` 200 / 400 (`QueryError/QUERY_FAILED`) / empty-body (`MixpanelHeadlessError/INVALID_RESPONSE`)                                                                                                                                                                                                                                  |
| (iii) edge set               | `18.0`, `1.5`, `true`, `null`, `[]`, `""`, `"𝒳"` pushed through the cohort `definition` dict (7) and the bookmark `params` dict in partial-update mode (7), plus the falsy-`{}`-definition drop. NO integer-like unknown keys (#9/#10).                                                                                                                                                                                                 |
| (iv) W3-local error branches | six `API returned empty response for X` guards (`create_bookmark`, `get_bookmark`, `update_bookmark`, `get_cohort`, `create_cohort`, `update_cohort`), the `dashboard_id is required` guard, the create-path schema gate (error → `BookmarkValidationError/BOOKMARK_VALIDATION_ERROR`; warning → logged + continues), the update-path partial gate (error + the `params is None` skip), and `RESPONSE_VALIDATION_ERROR` on four members |
| bulk dumps                   | `bulk_update_bookmarks` exclude-none shape; `bulk_update_cohorts` per-entry `definition` flattening                                                                                                                                                                                                                                                                                                                                     |

## Findings

Zero harness failures. The shard's ONE latent defect
(`response-validation.ts` `collectModelErrors` was alias-blind, so
`Bookmark.bookmark_type` ← `"type"` reported a spurious `missing`) was
caught by the Layer-3 translation before the harness ran; see
`B6-W3-notes.md` §[4].
