# B8-MAPFIX R10.9 RUN record — org-ordering fix verification

User ratification `context/phase3/design/user-ratifications.md:14-22`
(2026-08-16); supersedes the B7-ARB-A R2 exclusion. The former
ascending-id fuzz-domain exclusion is REMOVED: both runs below draw
out-of-order org/workspace key orders (integer-like + non-integer
mixes). No oracle bridge surface exists for naming (auth posture,
playbook Risk 7) — part 2 substitutes a direct CPython differential,
which is strictly stronger than a mini-model for this site.

## Part 1 — fast-check vs mini-model (b8-packets.md §2.5 row 6)

```
npx vite-node throwaway/b8-mapfix/org-order-fuzz.ts
org-order-fuzz: examples 1000 (>=500 budget) divergences 0 seed 20260816
```

Domain: 0..6 orgs, keys 70% integer-like (0..999999) / 30%
`team-x`-style, SHUFFLED source order rendered into JSON text and fed
through the real wire path (`parseLossless` → `toNativeJson` →
`MeResponse.fromDict`); names include empty, `---` (org-{key}
fallback), unicode (é), non-BMP (edge-set `"𝒳"` via part 2); existing
sets up to 5 names (collision suffix arms).

## Part 2 — CPython differential (Python = behavior arbiter)

```
npx vite-node throwaway/b8-mapfix/org-order-py-diff.ts > /tmp/b8-mapfix-cases.jsonl
org-order-py-diff: emitted 1000 cases (naming 600, workspace 400) seed 20260816

(Python repo, ts-port/phase2-contract-support @ fd91a81)
uv run python throwaway/b8-mapfix/py_driver.py < /tmp/b8-mapfix-cases.jsonl
py-diff: naming 600 workspace 400 divergences 0
```

- naming family (600): TS `defaultAccountName` vs Python
  `default_account_name` over `MeResponse.model_validate(json.loads(...))`
  — insertion-order first pick, empty-slug `org-{key}` fallback,
  collision suffixes; org names include the R10.9 edge-set members
  `""`, `"𝒳 labs"`, whitespace-wrapped, unicode.
- workspace family (400): TS `MeService.resolveWorkspace("1")` (warm
  in-memory cache) vs the `me.py:905-915` view comprehension +
  `select_workspace_id` — insertion-order tie-breaks in the selection
  ladder over shuffled integer-like workspace keys with random
  global/default/visible flags and "All Project Data" names.
  Disclosure: the Python side reproduces the 3-line comprehension of
  `MeService.resolve_workspace` verbatim rather than instantiating
  MeService/MeCache (I/O scaffolding with no effect on the pick).

## Deterministic Layer-3 locks (kept, not throwaway)

- `packages/core/test/accounts/naming-order.test.ts` (9 tests)
- `packages/core/test/client/lossless-json.test.ts` ordered-entries
  describe block (7 tests)

Red run (pre-fix, TS main 9fb09ef): naming-order.test.ts 8 failed /
1 passed — the #13 divergence reproduced.

Cleanup: this directory is removed by the B8 batch-gate task after
arbiter sign-off (P3-2c).
