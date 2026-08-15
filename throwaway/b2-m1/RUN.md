# B2-M1 R10.9 RUN record — validation.py shard V1a

**Date**: 2026-08-15 · **Task**: B2-M1 (packet `context/phase3/design/b2-packets.md` §V1a)
**Status**: 0 divergences. Deleted by the B2 batch gate after arbiter sign-off (GF6).

## What it runs

`throwaway/b2-m1/harness.mjs` is a two-sided differential:

- **Arbiter (Python)**: spawns the REAL oracle-py JSON-RPC server,
  `uv run python -m conformance.oracle_py`, in the sibling Python repo
  (`../mixpanel-headless`) and issues `oracle.call` for the six V1a apis.
  Registered via the existing `_validator_entries()` registry — no
  Python-side change was needed.
- **Port (TS)**: esbuild-bundles `throwaway/b2-m1/entry.ts` (the real
  `packages/core/src/query/validation.ts` + `validation-shared.ts`) and
  calls the functions in-process.
- **Diff**: both sides are reduced to the recorder codec's
  `[{code, path, severity}]` shape (`conformance/record/codecs.py:720-748`)
  and compared with `JSON.stringify` — position-by-position, because
  emission order is contract (packet Cautions §11).

**Deviation from the packet, recorded**: the packet routes the fuzz through
`conformance/differential/strategies.py` + oracle-ts. oracle-ts cannot answer
`validation.*` until the (b′) binding commit lands, so this harness talks to
oracle-py directly instead of adding Python-side strategies that could not be
exercised yet. Formalising the five new `*_args_family` targets in
`strategies.py` is therefore **deferred to the (b′) binding task**; the
comparison performed here is the same one those targets would perform.

## Replay

```bash
# recorded seed
bash throwaway/b2-m1/run.sh
# fresh seed
bash throwaway/b2-m1/run.sh 987654321 700
```

Exit status is non-zero on any divergence. `report.json` is rewritten each run.

## Recorded run

| field | value |
|---|---|
| seed | `20260815` (mulberry32, fully derandomised) |
| runs per family | 700 |
| oracle-py | python / lib 0.2.1 / protocol 1.1 / source_commit `b5c1369` |
| edge calls | **134 / 134 compared** |
| fuzz compared | time 700 · group_by 552 · query 567 · funnel 511 · retention 664 · flow 700 |
| total compared | **3,828** |
| skips | **506, all explained** (see below) |
| **divergences** | **0** |

Per-family compared counts all clear the P2-9 ≥500 budget.

### Skips (all bilateral, all explained)

| count | family | reason |
|---|---|---|
| 148 | `validate_group_by_args` | ctor guard `V18_BUCKET_ORDER` — python decode also rejects |
| 133 | `validate_query_args` | ctor guard `V18_BUCKET_ORDER` — python decode also rejects |
| 104 | `validate_funnel_args` | ctor guard `V18_BUCKET_ORDER` — python decode also rejects |
| 85 | `validate_funnel_args` | ctor guard `EX2_STEP_ORDER` — python decode also rejects |
| 36 | `validate_retention_args` | ctor guard `V18_BUCKET_ORDER` — python decode also rejects |

A skip is only recorded after the harness **also** sends the payload to
oracle-py and observes a decode failure (`decode_value` builds the real
dataclasses, so the same `__post_init__` guard fires). If Python had accepted a
payload the TS constructor rejected, it would be logged as a divergence, not a
skip.

## Mandatory edge set (R10.9) — 134 explicit calls

- **Per-api value edges** (38 calls): integral float `18.0`/`14.0`/`3.0`/`7.0`
  (as the rig's `$type: float` carrier), fractional `1.5`, `True`, `None`,
  empty list, empty string, and the non-BMP string `𝒳` — one call per api per
  edge where the parameter domain admits it.
- **Every corpus-present code** in the §V1a inventory: one explicit call each
  (V7/V8×2/V9/V10/V15/V20, V11/V12B/V12C, V0/V1/V2/V3/V3B/V4/V5/V6/V16/V21/V23/DG1,
  F1_MIN/F1_MAX/F2×3/F3×3/F4×2/F7×2/F8/F9×2/F10/F11/F12,
  R1×3/R2×3/R5×3/R6/R7/R8/R9/R10/R11/R12/R13/CB3,
  FL1/FL2×3/FL3/FL4/FL5/FL6/FL7×2/FL9/FL10/FL_COUNT_TYPE/FL_MODE/FL_WINDOW_UNIT/FL_TIME_COMPARISON).
- **Every source-only code** in the §V1a "not corpus-exercised" list, with the
  unreachable ones documented **in the edge-call comment** exactly as
  `conformance/differential/strategies.py:253-257` documents out-of-domain
  items. Post-Phase-2 the following are unreachable from the validators because
  a `types.py` constructor guard fires first, in BOTH languages — the calls are
  kept and pin the reachable arm of the same branch:
  `V12_BUCKET_SIZE_POSITIVE`, `V18_BUCKET_ORDER` (GroupBy guards),
  `V13_METRIC_MATH_PROPERTY` (Metric guard), `CM5_INLINE_COHORT_METRIC`
  (CohortMetric guard), `F4_CONTROL_CHAR_EXCLUSION`,
  `F4_EMPTY_EXCLUSION_EVENT`, `F4_EXCLUSION_NEGATIVE_STEP` (Exclusion guards).
  Reachable source-only codes ARE exercised for real:
  `V14`, `V17`, `V19`, `V22_CONTROL_CHAR_EVENT`, `V22_INVISIBLE_EVENT`,
  `V24`, `V26`, `V27`, `CP1`–`CP6`, `F8_EMPTY_HOLDING_CONSTANT_PROPERTY`.

## Findings for the (b′) binding task — PyFloat carrier policy

The harness's first run produced 9 divergences, ALL of one class, and they are
a genuine binding-design finding rather than a port bug. Recorded here so the
binding does not rediscover it:

> A `$type: float` payload must reach TS as the **PyFloat carrier** exactly
> where the Python source performs an `isinstance(…, int)` / `isinstance(…,
> float)` test, and as a **native number** everywhere else (where Python only
> compares numerically — Python's `30.0 == 30` is true, but a carrier object
> `!== 30` in TS).

Measured split for the V1a surface (encoded as `UNWRAP` in `harness.mjs`):

| unwrap to number | keep as carrier |
|---|---|
| `last` (all five apis) | funnel `conversion_window` → `F3_CONVERSION_WINDOW_TYPE` |
| query `rolling` | retention `bucket_sizes[i]` → `R5_BUCKET_SIZES_INTEGER` |
| flow `forward` / `reverse` / `cardinality` / `conversion_window` | `data_group_id` (all apis) → `DG1_INVALID_DATA_GROUP_ID` |
| `GroupBy.bucket_size` / `bucket_min` / `bucket_max` | |

Non-finite spellings (`Infinity` / `-Infinity` / `NaN`) always unwrap to the
native non-finite numbers — the `vector-codecs.ts:606-611` precedent the packet
cites (Caution §8).

## Other cautions confirmed clean by this run

- §4 `_INVISIBLE_RE`: the fuzz event pool includes U+200B/U+200C/U+200D/
  U+00AD/U+2060 and `\t`; all agree with Python.
- §9 R11.6 codepoint lengths: `CP5_FORMULA_TOO_LONG` is exercised with a
  20,001-codepoint **non-BMP** formula (40,002 UTF-16 units) — a `.length`
  bound would have fired at the wrong threshold.
- §10 dates: the date pool includes `2024-02-29`, `2023-02-29`, `0000-01-01`,
  `9999-12-31`, a trailing-newline spelling, a non-BMP digit spelling, and
  Arabic-Indic digits `٢٠٢٤-٠١-٠١` (Unicode Nd — Python `\d` matches, ASCII JS
  `\d` would not). All agree.
