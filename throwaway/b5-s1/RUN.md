# B5-S1 R10.9 harness — RUN record

Throwaway (removed at the B5 gate, packet §7.5). Mirror of this record
lands in `context/phase3/notes/B5-S1-notes.md` §3 (Python repo).

## Parts

| Part              | Script                                      | What it does                                                                                        |
| ----------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1 — differential  | `py-side.py` + `ts-side.ts` + `compare.mjs` | Same seeded case corpus through the Python arbiter and the TS port; canonical-JSON diff             |
| 2 — wire edge set | `wire-edges.ts`                             | The mandated edge set + every error branch through the DiscoveryService over canned fetch responses |

Reproduce:

```bash
cd /Users/jaredmcfarland/Developer/mixpanel-headless && \
  uv run python /Users/jaredmcfarland/Developer/mixpanel-headless-ts/throwaway/b5-s1/py-side.py
cd /Users/jaredmcfarland/Developer/mixpanel-headless-ts
npx vite-node throwaway/b5-s1/ts-side.ts
node throwaway/b5-s1/compare.mjs
npx vite-node throwaway/b5-s1/wire-edges.ts
```

## Part 1 — differential (seed 20260816, ≥500 examples/family)

Final run, 2026-08-16:

```
infer_subproperties          503 compared     0 diverged
infer_scalar_type            510 compared     0 diverged
is_valid_iso                 507 compared     0 diverged
iter_dict_rows               501 compared     0 diverged
parse_lexicon_metadata       500 compared     0 diverged
parse_lexicon_property       500 compared     0 diverged
parse_lexicon_definition     500 compared     0 diverged
parse_lexicon_schema         500 compared     0 diverged
parse_bookmark_info          500 compared     0 diverged
find_similar_events          501 compared     0 diverged
schema_graph                 500 compared     0 diverged

TOTAL 5522 compared / 0 divergences
```

Edge set (R10.9 mandate) — present verbatim in the corpus: `18.0`,
`1.5`, `True`, `None`, `[]`, `""`, `"𝒳"` (U+1D4B3), plus `-0.0`,
`False`, `0`, integer-like keys (`"0"`, `"1"`), the empty key, the
ISO-boundary strings (`2025-13-99`, `2024-02-29`, `2023-02-29`,
`2025-04-23T24:00:00`, `T24:00:01`, `+0530`, `+00:60`, `+24:00`,
`0000-01-01`, `9999-12-31`, 10-digit fractions), and unparseable /
non-dict raw values.

Comparison normalization: both sides are compared as PARSED JSON with
object keys sorted. That erases exactly ONE documented narrowing — the
CPython int/float SPELLING (`18.0` vs `18`), which `toNativeJson`
erases by contract (`json-value.ts:108-112`). Negative zero is NOT
normalized (the TS side serializes it as `-0.0` on purpose); nothing
else is.

### Divergences found and fixed (red → green)

1. **`sample_values` de-duplication used JS `Set` semantics** (5/503
   `infer_subproperties` cases). CPython hashes by value across the
   numeric tower and `bool` is a subclass of `int`, so `{0}` already
   contains `False` and `{1}` already contains `True`: Python samples
   `[0]` where the port sampled `[0, false]`. Fixed with `pySetKey`
   (`services/discovery.ts`), which folds `false`/`0`/`-0` and
   `true`/`1` and leaves each parsed `NaN` distinct (CPython compares
   `NaN` by identity inside a `set`).
2. **`toGraph()` edge order** (88/500 `schema_graph` cases). `networkx`
   stores edges in a per-source adjacency dict, so `G.edges` yields
   them grouped by SOURCE NODE in node-insertion order — not in global
   edge-insertion order. Fixed with a two-level adjacency map flattened
   in node order.
3. **`toGraph()` node order** (67/500 after fix 2). The first Python
   loop walks `event_to_properties`, and `Object.keys()` on the TS twin
   hoists integer-like keys (`"1"`) to the front (watchlist #10). Fixed
   by rebuilding the same key sequence from `events` / `properties`
   directly. The underlying plain-object field-order gap is disclosed as
   a `TODO(port)` on the constructor (no vector sees it — the
   conformance canonicalizer sorts object keys, `canonical.ts:13`).

Two harness-only artifacts were corrected before the final run:
`JSON.stringify(-0)` erasing negative zero on the TS side (439 → 93
reported divergences), and the first PBT translation asserting
`[...names].sort()` (UTF-16) instead of `sortedByCodepoint`.

## Part 2 — wire edge set

```
note: non-JSON 200 -> MixpanelHeadlessError
note: transport failure -> MixpanelHeadlessError

47 checks / 0 failures
```

Covered: empty collections through all nine list members; non-BMP names
under code-point sorting (`""` < `"b"` < U+FF61 < U+1D4B3 — JS default
sort inverts the last pair); integral floats (`18.0`) through
`parseLossless` for `TopEvent.count`, `FunnelInfo.funnel_id` and
`sample_values` (including the CPython `18.0`/`18` dedupe); cache
hit/miss/clear per member, per-triple keys, the copy-on-return contract,
the uncached `list_top_events` and `list_bookmarks`; schema-graph call
count (3 vs 2), `includeDensity` toggle, `force_refresh`, `params`
echo; the three `list_bookmarks` response shapes; the `KeyError` twin on
three missing-required-key paths; and the error branches 401
`AuthenticationError`, 403 `QueryError`, 429 `RateLimitError`,
500/503 `ServerError`, 400 → `EventNotFoundError` on `list_properties`
(with the second, suggestion-fetch call asserted) and 400 →
`QueryError` everywhere else — code passthrough, never re-handled.
