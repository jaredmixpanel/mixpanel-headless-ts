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

---

# P2-9 Phase-2 differential gate — run record (2026-08-15)

Spec: phase2-design C9/C10 + oracle-protocol.md §8 (protocol 1.1 addendum).
Harness: `conformance/differential/fuzz_harness.py` (Python repo, branch
`ts-port/phase2-contract-support`), oracle-py (library 0.2.1) vs oracle-ts
(`node scripts/run-oracle.mjs`), both pinned to corpus source_commit
8ae76314a0a6d2420812473181b509364417a243, both reporting protocol 1.1.

## Surface

- oracle-ts now serves the 44 `types.*` contract apis by reusing the SAME
  bindings module as the conformance runner (`createRunnerDeps`), plus the
  new `codec.roundtrip` method (decode → encode through the full rich
  codec table). `wirestub.*` and everything else stays UNPORTED (skip).
- Output parity transforms (measured against oracle-py's encoders):
  `toExpectEncoding` for `oracle.call` (rich `$type` members stripped,
  float tags → raw tokens) and `toInputEncoding` for `codec.roundtrip`
  (float tags kept inside rich payloads, raw in plain positions);
  `tagIntegralFloatTokens` on the input side preserves Python float-ness
  of integral-float tokens (D13 / Risk #3 carrier: `PyFloat`).
- Oracle-only codecs for `ReplaySummary`/`ReplayEvent`/`ReplayBundle`
  (zero corpus `$type` occurrences — deliberately unregistered in
  `vector-codecs.ts` for P2-8 sweep honesty; the oracle registers them on
  its own registry instance).

## Gate run (≥500 examples per family + full edge set)

`--examples 500`, 8 Phase-2 targets. Edge set: R10.9 scalar items per
family (dispositions in `conformance/differential/phase2-edge-coverage.json`)
plus one corpus-harvested probe per Phase-2 guard code (81/81) and per
`types.*` api (44/44), attached as Hypothesis `@example`s.

| target                | examples | skipped | divergences |
| --------------------- | -------- | ------- | ----------- |
| filter_family         | 529      | 0       | 0           |
| metric_group_family   | 523      | 0       | 0           |
| cohort_family         | 533      | 0       | 0           |
| funnel_family         | 508      | 0       | 0           |
| retention_flow_family | 507      | 0       | 0           |
| frequency_family      | 515      | 0       | 0           |
| replay_family         | 524      | 0       | 0           |
| codec_roundtrip       | 512      | 0       | 0           |
| total                 | 4151     | 0       | **0**       |

Full-suite regression (`--examples 200`, all 15 targets incl. Phase-1):
status ok, 3,217 examples, 0 divergences; the six non-compat Phase-1
targets still skip (UNPORTED) per protocol §4.2. Machine-readable gate
record: `conformance/differential/phase2-gate.json` (Python repo).

## Real findings fixed during the run (2 library bugs, then 0 divergences)

1. `CohortCriteria.hasProperty` with an operator outside
   `_PROPERTY_OPERATOR_MAP`: Python raises a bare `KeyError` (uncoded,
   R5.5); the TS port silently constructed a selector node with an
   `undefined` operator. Fixed: file-local `KeyError` mirror in
   `cohort.ts` thrown after the CD7 guard (Python check order);
   translated tests added. Repro:
   `conformance/differential/repros/2026-08-15-types-CohortCriteria-has_property-keyerror.json`.
2. `Filter.inCohort`/`notInCohort` with an inline `CohortDefinition`
   still threw the P2-5a `TODO(port, P2-5b)` stub — P2-5b landed
   `toDict`/`sanitizeRawCohort` but never closed the branch (no recorded
   vector reaches it). Fixed: `buildCohortFilter` embeds
   `sanitizeRawCohort(cohort.toDict())` like Python's
   `_build_cohort_filter`; translated tests added. Repro:
   `conformance/differential/repros/2026-08-15-types-Filter-in_cohort.json`.

Oracle-infrastructure gaps fixed during bring-up (not library bugs):
expect-vs-tagged output encoding, integral-float token fidelity, and the
unregistered-replay-tag encode path — see the Python repo P2-9 notes
(`context/phase2/notes/p2-9-notes.md`) triage log.
