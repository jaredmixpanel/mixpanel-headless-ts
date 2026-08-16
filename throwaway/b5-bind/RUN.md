# B5-BIND R10.9 RUN record (fable — P3-2 b′ for batch B5)

Working artifacts for the review pair; the full narrative record lives in
the Python repo at `context/phase3/notes/B5-BIND-notes.md`. Removed at the
batch gate with the rest of `throwaway/` (P3-2 c).

## Oracle fuzz (both bridges, fresh seed)

```bash
uv run python -m conformance.differential.fuzz_harness \
  --right "node /Users/jaredmcfarland/Developer/mixpanel-headless-ts/scripts/run-oracle.mjs" \
  --targets workspace_build_params_family,workspace_build_funnel_params_family,\
workspace_build_flow_params_family,workspace_build_retention_params_family,\
workspace_build_user_params_family,replay_url_normalizer_family,\
replay_default_label_family,replay_selector_label_family,rrweb_analyze_family \
  --examples 500 --seed 822819180 --report json
```

Result (`fuzz-seed822819180.json`): status ok — **4,555 examples /
0 skips / 0 divergences**; every family >= 503. Two bring-up divergences
found and resolved before the clean run (details + strategy-domain notes
in B5-BIND-notes.md §RUN).

## Mechanical both-bridge probe (gate step 3 shape)

One `oracle.call` per builder-kind name (5 `workspace.build_*params` +
3 `replay_labels.*` + `rrweb_analyzer.analyze`): 9/9 non-"unknown api"
responses (`ok`) on BOTH bridges. Wire names exempt (no oracle surface).

## VectorFetch status-branch replay (wire members)

Re-run of the three shard wire-edge matrices against the post-BIND tree:

- `throwaway/b5-s1/wire-edges.ts` — 47 checks / 0 failures
- `throwaway/b5-s2/wire-edges.ts` — 119 checks / 0 failures
- `throwaway/b5-s3/wire-edges.ts` — 70 checks / 0 failures

## Corpus checkpoint (NO batch-status flip — gate owns the flip)

`npm run conformance`: 3,251 vectors — **2,876 PASS / 0 FAIL /
375 UNPORTED** (corpus @ 70c904dc598d). Gate delta +506 exactly; the
P3-1 † carried vector stays UNPORTED (workspace.me unbound — §6.8).
