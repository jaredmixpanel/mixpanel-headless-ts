# B6-W4 — R10.9 throwaway harness RUN record

Throwaway. The B6 gate (`b6-packets.md` §12) deletes `throwaway/b6-w4/`;
this record is mirrored into `context/phase3/notes/B6-W4-notes.md` §4
(Python repo), which survives.

## Shape

W4's 23 members are FACADE delegations over the B4-C4 flag/experiment
wire methods — all-wire, no oracle-callable surface (§11.5), so there is
no `py-side.py` differential half. One file:

| file            | role                                                         |
| --------------- | ------------------------------------------------------------ |
| `wire-edges.ts` | delegation equivalence + status branches + edge set + errors |

Run:

```
npx vite-node throwaway/b6-w4/wire-edges.ts
```

Deterministic (no RNG, no seed): every case is a hand-built canned
interaction over the injected-fetch seam.

## Counts

```
checks 53   failures 0
```

## Coverage

| group                      | cases                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (i) delegation equivalence | `list_feature_flags`, `get_feature_flag`, `get_flag_history`, `get_flag_limits`, `list_experiments`, `get_experiment`, `list_erf_experiments` — facade result === direct client result re-validated through the SAME model seam (7)                                                                                                                                                                          |
| (ii) wire status branches  | `get_feature_flag` 200 / 404 (`QueryError/QUERY_FAILED`) / 500 (`ServerError/SERVER_ERROR`); `decide_experiment` 200 / 400 / 422 (both `QueryError/QUERY_FAILED`) / 204-empty (`ResponseValidationError/RESPONSE_VALIDATION_ERROR`) (7)                                                                                                                                                                      |
| (iii) edge set             | `18.0`, `1.5`, `true`, `null`, `[]`, `""`, `"𝒳"` pushed through the flag `ruleset` dict (7) and the experiment `settings` dict (7) — the two `dict[str, Any]` annotations in the shard; plus the exclude-none drop and the #12 integral-float wire-spelling record (16)                                                                                                                                      |
| (iv) W4-local branches     | the six `API returned empty response for X` guards; the `get_flag_history` query-dict assembly (neither / page / page_size / both / explicit nulls = 5); `conclude_experiment` body (`{}` default, params dump, empty-params dump = 3); `set_flag_test_users` bare-`model_dump` spelling (2); `duplicate_experiment` positional dump; four `RESPONSE_VALIDATION_ERROR` shapes; both void-member batches (23) |

## Observations

1. **#12 class (recorded, not a failure)** — an integral float inside a
   `dict[str, Any]` param renders `18` on the wire where CPython's
   `json.dumps(18.0)` writes `18.0`. NO W4 corpus vector asserts a
   request body (every `expect.interactions[].request.body` is `null` —
   measured 2026-08-16), so no vector is exposed. Same class W2 recorded
   for `ids=`.
2. **404 and 422 collapse to the same coded error** (`QueryError` /
   `QUERY_FAILED`) — the B0 status mapping, unchanged by the facade.
3. **The empty-response guards are unreachable through the wire** — the
   B4 client raises for a non-dict envelope before `None` can reach the
   facade (the same finding W3 recorded); they are probed at the member
   seam.
