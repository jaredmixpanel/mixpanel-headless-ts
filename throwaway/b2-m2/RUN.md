# B2-M2 (validation.py shard V1b) — R10.9 harness RUN record

THROWAWAY. Deleted by the B2 batch gate after arbiter sign-off (GF6 /
B0-1 precedent). The review pair re-runs from the recorded seed below.

## How to replay

```bash
# TS repo root; the Python repo must be the sibling ../mixpanel-headless
bash throwaway/b2-m2/run.sh            # recorded seed 20260815, 600 runs/family
bash throwaway/b2-m2/run.sh 777001     # fresh seed (also recorded below)
```

`run.sh` exits non-zero on any divergence and prints the summary block.
Full detail (including every skip's input) lands in
`throwaway/b2-m2/report.json`.

Files: `harness.mjs` (driver), `entry.ts` (esbuild bundle entry),
`run.sh`, plus the three CPython probe scripts
(`probe-sorting.py`, `probe-sorting2.py`, `probe-int-grammar.py`) whose
findings are transcribed into `context/phase3/notes/B2-M2-notes.md`
§"CPython pydantic probe".

## Setup

- **Arbiter**: the REAL oracle-py server
  (`uv run python -m conformance.oracle_py`, protocol 1.1,
  `library_version 0.2.1`, `source_commit b5c1369824052d97931ff8c4516cbfb24d73a7ad`).
- **Port side**: the REAL TS modules, esbuild-bundled from
  `packages/core/src` (`query/validation.ts` +
  `bookmarks/schema-sorting.ts`), called in-process.
- **Comparison**: the recorder's `validation_errors` codec shape
  (`[{code, path, severity}]`, `conformance/record/codecs.py:720-748`),
  diffed position-by-position — emission order is contract
  (b2-packets.md Caution §11).
- **Deferral (packet §V1b)**: the packet routes fuzz through
  `conformance/differential/strategies.py` + oracle-ts. oracle-ts cannot
  answer `validation.*` until the (b′) binding lands, so the harness
  talks to oracle-py directly. Formalising `bookmark_family`,
  `flow_bookmark_family` and `sorting_family` in `strategies.py` is
  **deferred to (b′)** — same call as B2-M1 made for its five families.
  No Python-repo files were touched by this task outside
  `context/phase3/`.

## Results

| Run | Seed | Runs/family | Compared | Skips | Divergences |
|---|---|---|---|---|---|
| recorded | 20260815 | 600 | **1,921** | 8 | **0** |
| fresh | 777001 | 600 | **1,924** | 5 | **0** |

Breakdown at the recorded seed:

- **Edge set: 129/129 compared** (every edge call reached both sides).
- Fuzz compared: `validate_bookmark` 592 · `validate_flow_bookmark` 600
  · `validate_sorting_block` 600 — all ≥ the P2-9 500-example budget.
- **Total compared 1,921 · divergences 0.**

### Skips — one class only (recorded in full)

**CORRECTION (B2 arbiter, 2026-08-15 — b2-review-resolution.md F5; the
paragraph below this note is the ORIGINAL pre-fix record and its skip
classification is stale).** After the B2-BIND commit `2015565` landed
the R10.7 `requireHashable` adjudication, the same 8 recorded-seed
skips (and the fresh-seed skips) are **BILATERAL**: report.json
`skip_reasons` now read "ts threw + python errored" — the TS port
raises the same `TypeError` CPython raises at the 16 frozenset-
membership sites. The counts are unchanged (1,921 compared / 8 skips /
0 divergences at seed 20260815, re-verified post-arbiter-fixes); only
the class description below is superseded. The batch notes file
(`context/phase3/notes/B2-M2-notes.md`) carries the surviving record.

All 8 skips (5 at the fresh seed) are
`validation.validate_bookmark :: python raised: {"class":"TypeError"}`.
Every one is a fuzz input carrying an **unhashable** value (`[]` / `{}`)
at a key whose Python guard is `value not in FROZENSET` — e.g.
`sections.show[0].measurement.math: []`, which makes CPython raise
`TypeError: unhashable type: 'list'` out of `validate_bookmark`. The TS
port returns the enum error instead of throwing. This is the deviation
documented at the top of `packages/core/src/query/validation-bookmark.ts`
(`TODO(port)`, 12 affected guards) and flagged for the arbiter; it is
NOT hidden by the skip accounting — the harness records these as
`unilateral: true` with the full input and the TS answer, and any skip
class other than this one would be a finding.

Zero bilateral skips at the original (pre-`2015565`) run: no input was
refused by both sides.

### Mandatory edge set (R10.9), per api

Value edges per api — integral float (PyFloat carrier `18.0`/`5.0`/`2.0`),
fractional `1.5`, `True`, `None`, empty list, empty string, non-BMP
`"𝒳"` — are present for all three apis (25 calls), plus:

- **Every corpus-present V1b code**: B1, B2, B3, B4, B5, B6, B7, B8, B9,
  B10, B11, B12, B13, B14, B15, B16, B17, B18, B18B, B19, B20, B20B,
  B21, B22_COHORT_BEHAVIOR_ID, B22_COHORT_MISSING_IDENTIFIER, B23, B24,
  B25, B26; S1–S9; FLB1–FLB6 (plus the `bookmark_type` funnels/retention
  dispatch and the not-a-dict variants of B1/B6/B12/B14/B17/S5).
- **Every source-present, corpus-silent code** the packet lists:
  `B0_WRONG_TYPE` (string_type / int_parsing / int_type),
  `B0_INVALID_LITERAL`, `VALIDATION_ERROR` (int_from_float and
  finite_number — both unmapped pydantic types).
  `B0_MISSING_FIELD` and `B0_VALIDATOR_ERROR` are **unreachable** through
  `validate_sorting_block` (proof in the notes, §probe finding 5); the
  two `nearest-reachable` edge calls pin their neighbouring branches,
  documented in the edge-call comment exactly as
  `conformance/differential/strategies.py:253-257` does.
- **28 lax `str → int` coercion probes** (the pydantic-core grammar) and
  **4 emission-order pins** (top-level field order vs extras, nested
  `colSortAttrs`, all-sections bookmark).

## Divergence history during development

One divergence found and fixed before the recorded run:
`schema-sorting.ts` `optionalInt` compared `Number.isInteger(value)` on
the raw value instead of the carrier-unwrapped `numeric`, so an integral
float `5.0` at `viewNLimit` produced a spurious `VALIDATION_ERROR`
(`int_from_float`) where pydantic accepts it. Fixed; re-run clean.
