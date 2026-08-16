# B3-K2 R10.9 harness — RUN record

**Task**: `context/phase3/design/b3-packets.md` §"Packet K2" (`bookmark_builders.py`, whole file).
**Date**: 2026-08-15. **Model**: opus.
**Python source of record**: `src/mixpanel_headless/_internal/bookmark_builders.py`
(904 LOC, whole file) at `ts-port/phase2-contract-support` HEAD.
**TS home**: `packages/core/src/bookmarks/builders.ts` (NEW).
**Vectors**: 134 (replayed at the (b′) binding task, not here).

Re-run everything from the recorded seeds:

```bash
bash throwaway/b3-k2/run.sh              # recorded 5-seed sweep, 600/family
bash throwaway/b3-k2/run.sh 4242 600     # one seed
```

---

## 1. What the harness actually compares

| half | driver | target |
|---|---|---|
| CPython | `gen-cases.py` | the REAL `mixpanel_headless._internal.bookmark_builders` functions — the same call targets `conformance/record/registry.py::_builder_entries()` (`:194-289`) resolves for the oracle bridge |
| TS | `harness.mjs` via `entry.ts` → esbuild `.build/entry.mjs` | the REAL `packages/core/src/bookmarks/builders.ts` (no re-implementation is reachable from the driver) |

Objects cross as `{"$": ClassName, "f": {python_field: value}}` field dicts —
the same Python-spelled field vocabulary the Phase-2 contract codecs use — so
**both sides reconstruct through their real constructors**. A `__post_init__`
guard that fires on one side but not the other therefore shows up as a
divergence rather than being silently normalised away. Inline
`CohortDefinition`s cross as an index into a two-entry table built
identically on both sides (`COHORT_DEFS` / `gen-cases.py::COHORT_DEFS`).

**Oracle-bridge posture (P3-6 step 3).** The TS bindings do not exist yet —
they are the (b′) task's — so the harness drives the ported functions
directly rather than through `oracle.call`. That is the same posture K1 used
(`throwaway/b3-k1/RUN.md` §4) and it targets the identical Python callables.
Bridge servability of the eight `bookmark_builders.*` registry names is
verified by the gate's oracle probe, and the 134 corpus vectors replay at (b′).

## 2. Recorded sweep

`bash throwaway/b3-k2/run.sh` — seeds `20260815, 4242, 99991, 20260816, 7`,
600 draws per family over 12 entry points (≥500 mandated; the eight
oracle-named apis and the four unregistered helpers alike), plus the
verbatim R10.9 mandatory edge block prepended to every seed.

| seed | compared | divergences | class-only error spellings | construction skips |
|---|---|---|---|---|
| 20260815 | 7,250 | **0** | 0 | 15 |
| 4242 | 7,250 | **0** | 0 | 21 |
| 99991 | 7,250 | **0** | 0 | 18 |
| 20260816 | 7,250 | **0** | 0 | 13 |
| 7 | 7,250 | **0** | 0 | 23 |
| **Σ** | **36,250** | **0** | **0** | 90 |

Per-api counts are printed by every run (≈601-611 each; the surplus over 600
is the shared edge block). "Construction skips" are draws whose *Python*
constructor guard fired before the builder was reached (e.g. `V18_BUCKET_ORDER`
on an inverted bucket pair); they are dropped by the generator, never
compared.

Outcome tally over all 36,250 cases — **every K2-owned guard code is
exercised**, and each one agreed on both sides:

```
OK                                31,656
BB1_GROUP_BY_ELEMENT_TYPE            476
BB2_FLOW_PROPERTY_FILTER_EMPTY       781
BB3_FLOW_PROPERTY_FILTER_TYPE      1,257
BB4_FLOW_COHORT_FILTER_TYPE          547
BB5_FLOW_MULTIPLE_COHORT_FILTERS     630
BB6_COHORT_VALUE_NOT_LIST            422
BB7_COHORT_VALUE_NOT_DICT            174
BB8_COHORT_KEY_MISSING               307
```

## 3. Mandatory edge set (verbatim, prepended to every seed)

Every R10.9 fixed item — integral float `18.0`, fractional `1.5`, `True`,
`None`, empty list `[]`, empty string `""`, non-BMP `"𝒳"` (U+1D4B3) — appears
as (i) a `Filter._value` (the R10.12 pass-through position), and (ii) a
property name / group-by string / label. The block also carries:

- **every conditional-key branch**: `filterDateUnit`;
  `customBucket` with size-only / +`min` / +`max`; `dateRange`;
  `eventFilters` present-but-EMPTY (the `is not None` guard);
  top-level `label`; `id` vs `raw_cohort` on the flow-cohort result.
- **every owned code**: BB1 … BB8, one probe each (plus the BB6 pair
  `"oops"` / `[]`, the BB7 pair `[42]` / `["cohort"]` and the BB8 pair
  `[{}]` / `[{"cohort": "nope"}]` mirroring the corpus vector ids).
- **the silent-skip branch** of `build_filter_section`
  (`bookmark_builders.py:200-204`, no `else`): a list mixing Filters with
  `42`, `None`, `{}`.
- **the `build_time_section` clock seam**: from-only against the frozen
  record epoch `2026-01-15` (Python via a `date` subclass whose `today()`
  is frozen, TS via the injected `options.today`), plus the three
  non-clock branches.
- the four unregistered helpers (`build_time_comparison`,
  `build_frequency_group_entry`,
  `patch_custom_property_filters_for_transform`,
  `_build_composed_properties`) — see §5.

Also covered by the random domains, not just the edge block: adversarial
property/value strings (`a\b`, `q"q`, U+FEFF-prefixed `"1"`,
zero-width-joined `Sign​Up`, `"𝒳"`), `-0.0`, `1e16`, `1e-5`, booleans
in numeric positions, all 25 `FilterOperator` spellings, all six
`FilterPropertyType`s, both resource types, all five date units, and
`list_contains` filters with 1-3 nested inner filters.

## 4. Disclosed limitation (read before trusting a "0")

**int-vs-float-ness of a pass-through value is NOT diffed here.** Python
floats encode as `{"__f__": repr(v)}` and ints as JSON integers, but the
comparator collapses both to the numeric value, because JS has one number
type and this throwaway does not carry the lossless-JSON codec. That
distinction is carried by the REAL conformance codecs and is checked by the
134 K2 vector replays at (b′). It is a narrow gap by construction: every
number in a K2 output arrives by *pass-through* of an input the two sides
decoded from the same JSON token (`filterValue`, `bucketSize`, `window.value`,
`dataGroupId`, `id`), so there is no arithmetic anywhere in the module that
could change a number's type.

Two smaller, deliberate normalizations, both matching the real conformance
canonicalizer: dict KEY ORDER is sorted before comparison (key PRESENCE is
fully diffed, and array emission order is fully diffed); and `-0` is compared
as a distinct token from `0`.

**Harness self-test** (proof the comparator can fail): mutating three
`build_filter_entry` expected outputs and one expected error code in a
recorded corpus produced exactly `divergences: 4` with the four cases named.

## 5. Coverage the oracle cannot reach (documented omission, packet §K2)

`build_time_comparison`, `build_frequency_group_entry`,
`patch_custom_property_filters_for_transform` and
`_build_composed_properties` have NO registry name, so they can never be
differential-fuzzed through the oracle bridge. Because this harness calls
the Python functions directly it *can* drive them, and does — 600 draws per
seed each, 0 divergences — so they are locked here in addition to the
translated Layer-3 suite (and, later, the B5 `workspace.build_*params`
vectors). The mirror note is recorded on
`conformance/differential/strategies.py::PHASE3_B3_K2_TARGETS`.

The two `build_time_comparison` `AssertionError` branches
(`bookmark_builders.py:892-903`, `pragma: no cover`) are unreachable by
`TimeComparison.__post_init__` rules TC1/TC2. They are ported as unreachable
throws and are deliberately NOT fuzzed for.

## 6. Files

| file | role |
|---|---|
| `gen-cases.py` | CPython half: seeded generator + real-builder driver + JSON encoder |
| `entry.ts` | the only `packages/core` surface the Node driver may touch |
| `harness.mjs` | Node half: decode → call the real TS builders → canonical diff |
| `run.sh` | re-runnable driver (esbuild bundle + seed sweep) |
| `cases.json`, `.build/` | regenerated artifacts (last run's corpus/bundle) |

The batch gate deletes `throwaway/` after arbiter sign-off (GF6).
