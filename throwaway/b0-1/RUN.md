# B0-1 R10.9 throwaway differential harness — RUN record

Date: 2026-08-15 (local). Module: pythonCompat completion (P3-4 packet
B0-1). Harness: `conformance/differential/fuzz_harness.py` (Python repo @
f507aba, corpus pin b5c1369), oracle-py (`uv run python -m
conformance.oracle_py`, CPython 3.14.6) vs oracle-ts
(`node scripts/run-oracle.mjs` @ TS commit 96dd73c). Driver:
`throwaway/b0-1/run-fuzz.sh`; raw report: `throwaway/b0-1/fuzz-report.json`.

## Seeds / determinism

Hypothesis `derandomize=True`, no database, no deadline (the harness's
standing settings, `fuzz_harness.py:456-458`) — the run is seedless and
fully deterministic: re-running `run-fuzz.sh` reproduces these counts
exactly. Edge set: the R10.9 mandatory items are the six targets'
`edge_calls` tuples in `conformance/differential/strategies.py`
(PHASE3_TARGETS), attached by the harness as `@example` decorators, so
they run FIRST in every budget. Str-domain omissions (True/None/raw
floats for str-typed inputs) are documented on each target's edge tuple;
`sorted_strings` carries the empty-list item; every reachable error
branch (PY_INT_INVALID_LITERAL, PY_INT_UNSAFE_INTEGER,
PY_FLOAT_INVALID_LITERAL) is in the edge sets and the biased universes.

## Fuzz run (>=500 examples per api family, P2-9 budget)

`--examples 500 --targets python_int,python_float,python_strip,sorted_strings,cp_length,cp_slice`
-> status `ok`, exit 0.

| target (api family)     | examples | skipped | divergences |
| ----------------------- | -------- | ------- | ----------- |
| `compat.python_int`     | 513      | 0       | 0           |
| `compat.python_float`   | 514      | 0       | 0           |
| `compat.python_strip`   | 507      | 0       | 0           |
| `compat.sorted_strings` | 507      | 0       | 0           |
| `compat.cp_length`      | 504      | 0       | 0           |
| `compat.cp_slice`       | 508      | 0       | 0           |
| total                   | 3,053    | 0       | **0**       |

Zero skips: oracle-ts served every probe (no UNPORTED answers). Zero
divergences; no shrunken repros written (the two files in
`conformance/differential/repros/` predate this run — P2-9 artifacts).

## Mechanical registration probe (both bridges)

`throwaway/b0-1/probe_apis.py`: one `oracle.call` per new api against
BOTH bridges; all six answered call DATA (`ok: true`) with identical
outputs on oracle-py and oracle-ts — no "unknown api" on either side.

## Vector replay (Layer 2)

- Python runner: 3,251/3,251 PASS (incl. the 72 authored B0-1 vectors).
- TS runner: 3,251 vectors — 533 PASS / 0 FAIL / 2,718 UNPORTED
  (`npm run conformance` @ corpus b5c1369).

## Disposition

Kept under `throwaway/` per GF6 / P3-2(c): the review pair re-runs
`run-fuzz.sh` and checks these counts; the B0 BATCH GATE task removes
`throwaway/` after arbiter sign-off. RUN record mirrored in the batch
notes (`context/phase3/notes/B0-notes.md`, Python repo).
