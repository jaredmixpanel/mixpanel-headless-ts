# B2-M3 R10.9 harness — RUN record

**Shard**: V2 — `src/mixpanel_headless/_internal/query/user_validators.py`
**Date**: 2026-08-15 · **Status**: 0 divergences
**THROWAWAY** — the B2 batch gate deletes `throwaway/` after arbiter sign-off
(GF6 / B0 precedent, commit `8f79b67`).

## How to re-run

```bash
bash throwaway/b2-m3/run.sh              # recorded seed 20260815, 700 runs/family
bash throwaway/b2-m3/run.sh 90210 700    # the fresh seed also recorded below
bash throwaway/b2-m3/run.sh 20260815 700 # restores report.json
```

Requires the Python repo as a sibling at `../mixpanel-headless` with
`uv sync --all-extras` already run: the harness spawns
`uv run python -m conformance.oracle_py` there. Exit code is non-zero on any
divergence OR any owned code that oracle-py never emitted.

**Self-test (proves the comparison is not vacuous):**

```bash
node throwaway/b2-m3/harness.mjs --seed 20260815 --runs 30 --break-unwrap
```

`--break-unwrap` disables the PyFloat-carrier unwrap and MUST report
divergences. Recorded result: **3 divergences** at 30 runs
(`edge:float-int/workers` — Python U23, TS `[]`;
`edge:float-int/percentile` — Python `[]`, TS U28; plus one fuzz case).

## Setup

- **Arbiter**: the REAL oracle-py JSON-RPC server, `source_commit`
  `b5c1369824052d97931ff8c4516cbfb24d73a7ad`, protocol 1.1, running under the
  D1.4 frozen clock (`conformance/record/clock.py:27`,
  `RECORD_EPOCH = "2026-01-15T12:00:00Z"`).
- **Port side**: the REAL TS module, esbuild-bundled from
  `packages/core/src/query/user-validators.ts` (+ `user-builders.ts`); the
  `today` clock seam is fed `"2026-01-15"` so both sides read the same
  calendar day. Three explicit boundary edges (`today/-1`, `today/0`,
  `today/+1`) would fail loudly if that assumption were wrong.
- **Diff**: the recorder's `[{code, path, severity}]` encoding
  (`conformance/record/codecs.py::_encode_validation_errors`),
  position-by-position — emission order is contract (b2-packets.md
  Cautions §11).
- Fuzz PRNG: derandomised mulberry32 seeded from the CLI.

## Results

| seed | edge compared | user_args_family | user_params_family | total | codes observed | skips | divergences |
|---|---|---|---|---|---|---|---|
| **20260815** (recorded) | 110/110 | 700 | 700 | **1,510** | 33/33 | 0 | **0** |
| 90210 (fresh) | 110/110 | 700 | 700 | **1,510** | 33/33 | 0 | **0** |

Both families exceed the P2-9 budget (≥500 examples each). Zero skips: every
generated payload decoded on the Python side and returned a list on both
sides.

### Code coverage

The driver asserts that oracle-py actually emitted every code the shard owns.
Observed (33): `U0 U1 U2 U3 U4 U5 U6 U7 U8 U10 U11 U12 U13 U14 U15 U16 U17
U18 U19 U20 U21 U22 U23 U25 U26 U27 U28 U29 U30 UP1 UP2 UP3 UP4`.

There is deliberately **no U9** (the Python docstring records it as "enforced
at call site"; no `U9` literal exists in source — b2-packets.md §V2).

**U24 omission notice** (`strategies.py:253-257` style): U24 fires only when
`CohortDefinition.to_dict()` RAISES. Every definition the conformance codec
can decode is well-formed by construction (its `__post_init__` guards already
ran), so `to_dict()` always succeeds on both sides and the branch is
unreachable from a serialisable input. It is covered by the Layer-3 twins
`test_u24_cohort_definition_to_dict_must_succeed` and
`test_u24_cohort_definition_to_dict_type_error`
(`packages/core/test/query/user-validators.test.ts`).

### Mandatory R10.9 value edges

All seven, per api, with the documented omissions:

| edge | where exercised |
|---|---|
| integral float `18.0` | `limit`, `workers`, `percentile`, `segment_by[0]`, `as_of`, `cohort` (as the `$type:"float"` PyFloat carrier) |
| fractional float `1.5` | `limit`, `workers`, `percentile`, `segment_by[0]`, params value — as a **raw JSON number token**: the `$type:"float"` tag is decode-REJECTED for finite non-integral spellings (`codecs.py:36-44`, D6 rule 3) |
| `True` | `parallel`, `include_all_users`, `limit`, `workers`, `percentile`, `segment_by[0]`, params values |
| `None` | the all-absent call plus one all-`null` call over every `None`-defaulting kwarg, and the four params keys |
| empty list | `where`, `properties`, `distinct_ids`, `segment_by`, `output_properties`, `filter_by_cohort` |
| empty string | `sort_by`, `search`, `as_of`, `where`, `distinct_id`, `properties[0]`, `Filter._property`, and all four params keys |
| non-BMP `"𝒳"` | `sort_by`, `properties[0]`, `as_of`, `search`, `Filter._property`, `sort_order`, and inside a UP4 action expression |

Omissions, all documented in the source comments: list-typed kwargs
(`where`/`properties`/`distinct_ids`/`segment_by`) receive the scalar edges as
list ELEMENTS; the Literal-typed `mode`/`aggregate` are driven by near-miss
strings in the fuzz pools instead; `workers=None` is excluded from the fuzz
domain because CPython raises `TypeError` there (see "Known boundary" below).

Additional targeted edges beyond the mandatory set: the `_DATE_RE` /
`fromisoformat` grammar corners (compact `20260114`, short `2026-1-4`,
trailing newline, Arabic-Indic Nd digits, year `0000`, leap / non-leap
Feb 29), the `today` boundary triple, and 14 `_ACTION_RE` grammar corners
(one/two trailing newlines, TAB / NBSP / U+2028 / U+FEFF between `,` and the
number, Nd digits, dots-only, the greedy-`.+` backtracking case
`percentile(properties["a"], 5"], 7)`, `\r` and `\n` inside the property,
empty property).

## Deferral to the (b′) binding task

The packet routes the fuzz through `conformance/differential/strategies.py`
plus oracle-ts. oracle-ts cannot answer `user_validators.*` until (b′)
registers the bindings, so **no Python-side strategies were added** (they
could not have been exercised); this harness compares against oracle-py
directly, in-process against the real TS module — the same arbiter
comparison. **Formalising `user_args_family` / `user_params_family` in
`strategies.py` is deferred to (b′).** No Python-source or `conformance/`
files were touched by this task, so `just check` was not required.

## Finding handed to (b′): PyFloat-carrier policy for the V2 surface

`user_validators.py` contains **no** `isinstance(x, int)` / `isinstance(x,
float)` test at all (measured 2026-08-15: the only `isinstance` calls are
against `str`, `Filter`, `CohortDefinition`, `dict`, `list`). Every numeric
argument feeds a pure NUMERIC comparison, so the binding MUST unwrap the
PyFloat carrier to a native number for these four — otherwise the comparison
silently flips (proved by `--break-unwrap`):

| unwrap to number | keep as carrier |
|---|---|
| `limit` (U3 `limit <= 0`) | `cohort` (only `is None` / `isinstance(CohortDefinition)`) |
| `percentile` (U28 `0 < p < 100`) | `as_of` (only `isinstance(str)` / `is None`) |
| `workers` (U23 `w < 1 or w > 5`) | |
| `segment_by[i]` — **element-level** (U17 `sid <= 0`) | |

Non-finite spellings always unwrap to the native non-finite numbers
(`vector-codecs.ts:606-611` precedent).

Second (b′) note: `validate_user_args`'s `today` seam must be fed
`context.shims`' record-epoch date (`runner.ts:445,460`;
`differential/oracle/server.ts` `createShims(recordEpoch)`), passed as the
`today` field of the options bag. Without it, U8 answers drift with the wall
clock.

## Known boundary (documented, not a divergence)

`workers`, `mode`, `aggregate`, `parallel`, `include_all_users` and `limit`
have NON-`None` Python defaults, so an explicit `null` is not the same as an
absent key for them; the port spells those six `=== undefined ? default :
value` (not `??`) so `mode=None` / `aggregate=None` compare exactly as Python
does. `workers=None` remains outside BOTH the Python annotation and the TS
`workers?: number` signature — CPython raises `TypeError: '<' not supported
between instances of 'NoneType' and 'int'` while JS coerces. It is excluded
from the fuzz domain rather than emulated (adding a guard Python does not
have would be worse than honest).
