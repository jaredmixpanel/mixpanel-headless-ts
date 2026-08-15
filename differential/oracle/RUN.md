# TS-7 oracle-ts — cross-language differential run record

Date: 2026-08-15 (local). Spec: design D14 + `conformance/schema/oracle-protocol.md`
(Python repo, normative). Harness: `conformance/differential/fuzz_harness.py`
(PR-10), spawning oracle-py (`uv run python -m conformance.oracle_py`, library
0.2.1, source_commit 52696743b913a0c4c152deb48af987ae412b5aee) against
oracle-ts (`node scripts/run-oracle.mjs`, same pinned corpus sourceCommit).

## Compat-target run (design done-criterion: 200+ examples per target, zero divergences)

Driver: harness `run_target` machinery with per-api counting wrappers,
`--targets pythoncompat`, budget 1500 generated examples (Hypothesis
`derandomize=True`; the 17 R10.9 edge `@example` calls run first).

| api                       | examples | skipped | divergences |
| ------------------------- | -------- | ------- | ----------- |
| `compat.zfill`            | 306      | 0       | 0           |
| `compat.python_str`       | 886      | 0       | 0           |
| `compat.python_float_str` | 325      | 0       | 0           |
| total                     | 1517     | 0       | **0**       |

## Full-surface run (all 7 Phase-1 targets, `--examples 200`)

`python -m conformance.differential.fuzz_harness --right "node .../scripts/run-oracle.mjs" --examples 200`
→ status `ok`, exit 0, total_examples 1466, total_divergences 0. The six
non-compat targets (`filter_to_selector`, `filters_to_selector`,
`build_segfilter_entry`, `build_filter_entry`, `validators_by_code`,
`normalize_on_expression`) each ran 205-210 probes, every one answered
`UNPORTED` by oracle-ts and counted as skip per protocol §4.2 — proving the
skip path and that scope is checked before `$type` decoding (their inputs
carry `Filter`/datetime tags the Phase-1 TS codec table cannot decode).

## Real finding fixed during the run (1 divergence, then 0)

First 900-example run diverged on `compat.python_str` with the shrunken
repro input `["𲎰"]` (U+323B0): CPython 3.14.6 (Unicode 16.0)
classifies U+323B0 as `Cn` and renders `['\U000323b0']`, while V8 (Node 24,
Unicode 17.0, which assigned U+323B0 in CJK Extension J) treated it as
printable and rendered it verbatim — exactly the "Cn follows the JS engine's
Unicode database" caveat previously documented in `python-str.ts`. Fix:
`pythonRepr` now classifies printability via a generated, CPython-derived
range table (`packages/core/src/compat/non-printable.gen.ts`, 737 ranges,
provenance: CPython 3.14.6 / Unicode 16.0.0, generator
`scripts/generate-non-printable.py`), making escape decisions independent of
the host engine's Unicode version. Regression test:
`packages/core/test/compat/python-str.test.ts` ("pinned CPython table").

## Protocol notes

- oracle-ts parses request lines with its own order-preserving lossless
  JSON model (`raw-json.ts`): plain JS objects reorder integer-like keys
  (`{"1":..,"0":..}`), which would corrupt `python_str` dict rendering, and
  nested float tokens (`[18.0]`) survive only as raw tokens.
- Framing verified ASCII-safe (all response lines < U+0080; lone-surrogate
  and astral outputs `\uXXXX`-escaped); EOF on stdin and `oracle.shutdown`
  both exit 0.
