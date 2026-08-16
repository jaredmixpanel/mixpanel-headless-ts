# B5-S2 — R10.9 throwaway harness RUN record

Throwaway. Packet §7.5 deletes `throwaway/b5-s2/` at the batch gate; this
record is mirrored into `context/phase3/notes/B5-S2-notes.md` §4 (which
survives).

## Part 1 — differential (Python arbiter vs TS port)

| file         | role                                                                            |
| ------------ | ------------------------------------------------------------------------------- |
| `py-side.py` | seeded recipe generation + Python arbiter outputs (`cases.json`, `py-out.json`) |
| `ts-side.ts` | the same recipes rebuilt as TS objects, through the port (`ts-out.json`)        |
| `compare.ts` | canonical-JSON comparator (sorted object keys, `-0` preserved)                  |

Run:

```
uv run python <ts-repo>/throwaway/b5-s2/py-side.py     # from the PYTHON repo
npx vite-node throwaway/b5-s2/ts-side.ts               # from the TS repo
npx vite-node throwaway/b5-s2/compare.ts
```

Seed `20260816`, `PER_FAMILY = 520`.

Both sides interpret ONE JSON recipe language into the same typed
objects, so the corpus is not TS-shaped or Python-shaped. Recipe
interpretation runs INSIDE the guard, and positional arguments are built
BEFORE the keyword bag, because CPython evaluates positionals first — a
constructor guard reached through `events` must beat one reached through
`where` (this is why case `build_params[81]` first reported `CF2_…`
instead of `CM2_…`; harness bug, fixed).

### Counts

| family                   |     cases |  raised | diverged |
| ------------------------ | --------: | ------: | -------: |
| `build_params`           |       520 |     117 |        0 |
| `build_funnel_params`    |       520 |     142 |        0 |
| `build_flow_params`      |       520 |     271 |    **2** |
| `build_retention_params` |       520 |     319 |        0 |
| `build_user_params`      |       520 |     115 |   **10** |
| `transforms`             |        78 |       2 |        0 |
| **total**                | **2,678** | **966** |   **12** |

**966 error branches** exercised across **36 distinct registry codes**,
every one class-and-code identical to the arbiter:

```
B20_EMPTY_FILTER_VALUE CF2_COHORT_NAME_EMPTY CM2_COHORT_NAME_EMPTY
EV1_EMPTY_EVENT F1_MIN_STEPS F3_CONVERSION_WINDOW_MAX
F3_CONVERSION_WINDOW_POSITIVE F4_EXCLUSION_STEP_BOUNDS
F4_EXCLUSION_STEP_ORDER F7_SECOND_MIN_WINDOW
F9_SESSION_WINDOW_REQUIRES_ONE FL10_SESSION_WINDOW_REQUIRES_ONE
FL5_NO_DIRECTION FL7_CONVERSION_WINDOW_MAX
FL9_SESSION_REQUIRES_SESSION_WINDOW FS1_SESSION_EVENT_MISMATCH
R11_INVALID_UNIT R8_INVALID_ALIGNMENT SG4_UNSUPPORTED_PROPERTY_TYPE
U12 U14 U19 U2 U22 U23 U26 U29 U3 U30 U5 U9 UP1 U_FILTER V0_NO_EVENTS
V17_EMPTY_EVENT V7_LAST_POSITIVE
```

### Edge set

The mandated set — `18.0`, `1.5`, `True`, `None`, `[]`, `""`, `"𝒳"` —
appears verbatim in `EDGE_SCALARS` / `FILTER_VALUES` (`py-side.py:72,76`)
and is drawn into every position a recipe exposes: event names, property
names, `Filter.equals` values, cohort names, group-by buckets, labels,
`sort_by`, `search`, `as_of`, funnel/flow step fields, and the transform
response bodies. Domains are annotation-constrained (Discrepancy #8):
each keyword only draws from its own `Literal` union, and unknown-param
keys are never integer-like (#9/#10).

### Transform-math corpus (78 cases)

Every case carries the raw response as JSON **text**; the TS side routes
it through `parseLossless(..., {pythonConstants: true})` + `toNativeJson`
— the production wire path (B0-1 F1) — while the arbiter uses
`json.loads`. Result objects are projected through Python `to_dict()` /
TS `toJSON()`, which mirror each other by construction
(`types/results/live-query.ts:12`).

Shapes covered, all named by the packet's harness spec:

- zero-denominator funnel (`steps[0].count == 0` → overall `0.0`);
- `prev_count == 0` → step rate `0.0` while step 0 stays the literal `1.0`;
- single-step funnel; empty-steps funnel; empty `data`;
- segmented `$overall` funnels; `$overall`-absent segmented shape
  (no first-segment fallback — `[]`, `live_query.py:76`);
- integral-float counts (`18.0`) through `parseLossless`;
- empty-cohort retention (all-`0.0`, never `NaN`); mixed empty/live
  cohorts; code-point key ordering with `""` and `"𝒳"` keys;
- negative cohort size; missing `first`; missing `counts`;
- non-dict retention series member;
- cohort-date normalization (15 keys incl. `""`, `"𝒳"`, `"18.0"`,
  `"None"`, `"$average"`, `"2025-01-01T"`, `"T00:00:00"`);
- `extractFunnelStepsFromSeries` step-prefix parsing incl. tab and
  double-space separators, prefix-less keys, non-dict members, and the
  multi-metric warning path;
- `extractCohortsAndAverage` with non-dict `$average` / members.

### Divergence table

| #      | family              |  cases | delta                                                                                                         | verdict                                                                 |
| ------ | ------------------- | -----: | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| T1     | `transforms`        |      1 | `transformFunnel({data: null})` raised `TypeError`; CPython raises `AttributeError` (`None.items()`)          | **FIXED** — `pyMapping()` guard, `live-query-transforms.ts`             |
| T2     | `transforms`        |      1 | `transformRetention({"d": "notadict"})` returned a size-0 cohort; CPython raises `AttributeError` (`str.get`) | **FIXED** — same guard, `live_query.py:198` site                        |
| T3     | `transforms`        |     29 | `_df_cache` present in the arbiter projection                                                                 | harness bug — arbiter switched from `dataclasses.asdict` to `to_dict()` |
| H1     | `build_params`      |      2 | `CF2_…` instead of `CM2_…`                                                                                    | harness bug — positional args must be built before the kwarg bag        |
| H2     | `build_params`      |    187 | `TypeError: CohortMetric is not a constructor`                                                                | harness bug — wrong import module                                       |
| **F1** | `build_flow_params` |  **2** | flow `property_filter_params_list[].filter.operand` renders `"18.0"` vs `"18"`                                | **known narrowing, NOT fixed** — see below                              |
| **F1** | `build_user_params` | **10** | engage `where` expression renders `18.0` vs `18`                                                              | **known narrowing, NOT fixed** — see below                              |

T1/T2 were fixed red-first at the owning layer, with regression tests in
`packages/core/test/services/transform-funnel.test.ts` (describe
`R10.9: AttributeError fidelity on non-mapping members`, 4 tests). After
the fix the whole `transforms` family is byte-identical.

### F1 — the one residual divergence class (integral-float spelling)

All 12 remaining divergences are one thing: a Python `float` whose value
is integral (`18.0`) renders as `"18.0"`, while the JS number `18` — the
only thing a TS caller can pass — renders as `"18"`. It only surfaces at
the two sites that render a filter value **into a string**:

- `build_flow_params` → `steps[].property_filter_params_list[].filter.operand`
- `build_user_params` → the engage `where` expression

Everywhere else the value lands as a JSON number, where the narrowing is
erased by contract (`json-value.ts:108-112`). Non-integral floats (`1.5`)
are byte-identical on both sides, which pins the cause precisely.

This is the established `$type: float` **carrier** situation already
modelled in the tree (`types/vector-codecs.ts:580,605-613,675`;
`bookmarks/schema-sorting.ts:65-72,476,496`;
`compat/python-json-dumps.ts:133-134`). It is NOT fixable inside the
transform/param code, because JS has no runtime distinction to consult —
it has to be carried in.

**Outbound note for the vector-binding / oracle task (which this shard is
explicitly not allowed to write):** the `b′` bindings for
`workspace.build_flow_params` and `workspace.build_user_params` must
either (a) keep integral floats as PyFloat carriers all the way to the
two string-render sites and make those sites carrier-aware, or (b)
exclude integral floats from filter-value domains for those two
families, the same way Discrepancy #8 constrains other domains. Option
(b) matches the measured corpus (`python-json-dumps.ts:134` — zero
`$type:float` inputs across the 317 vectors).

## Part 2 — wire edge set

`wire-edges.ts` — **119 checks / 0 failures**.

```
npx vite-node throwaway/b5-s2/wire-edges.ts
```

The 22 wire members have no oracle family, so the edge set is replayed
through canned responses on the injected fetch seam
(`createMockClient` / `makeSession`, the `httpx.MockTransport` twin).

1. **Status branches** — every consumed status (`400 401 403 404 429 500
502 503`) through five members of different families
   (`segmentation`, `funnel`, `retention`, `Workspace.query`,
   `Workspace.queryUser`), asserting pure passthrough of the B4 mapping.
   `403` is `QueryError`, not `AuthenticationError` (`api_client.py:521`)
   — the harness's first guess was wrong, the port was right.
2. **Error-as-200** — all 7 edge values through the `raw["error"]` slot
   on `query` / `queryFunnel` / `queryRetention`; every one is
   `QueryError`.
3. **Transform math through the members** — the shapes listed above,
   asserted on the computed numbers (`[1.0, 0.0]`, `[1.0, 0.5]`,
   all-`0.0` rows, code-point cohort order `["", "2025-01-01",
"2025-01-02", "𝒳"]`, `$average` excluded from `cohorts`,
   `"2025-01-01T00:00:00+00:00"` normalized to `"2025-01-01"`).
4. **Owned error branches with no wire call** — `V0_NO_EVENTS`,
   `V21_INVALID_EVENT_TYPE`, `V25_INVALID_FILTER_TYPE`, `F1_MIN_STEPS`
   (×2), `U26`, `U19`, `U9`, plus the two `ParamValidationError` ctor
   guards (`queryRetention("")`, `queryFlow("")`), each paired with a
   `calls.length === 0` assertion. Every expected code here is
   arbiter-verified: the same inputs are anchored in the differential
   `build_user_params` corpus (cases 8-14) rather than guessed.
5. **Edge set as argument values** — all 7 through `Filter.equals`
   (`[]` is the one rejection, `B20_EMPTY_FILTER_VALUE`, arbiter-
   confirmed) and three `on` spellings through `segmentation`.
6. **Notes (not assertions)** — non-JSON 200 and transport failure both
   normalize to `MixpanelHeadlessError` in the B4 adapter, i.e. the
   service does not re-handle them.

## Findings summary

| id  | fixed at                                                                               | artifact           |
| --- | -------------------------------------------------------------------------------------- | ------------------ |
| T1  | `packages/core/src/services/live-query-transforms.ts` (`pyMapping`, `transformFunnel`) | 2 regression tests |
| T2  | `packages/core/src/services/live-query-transforms.ts` (`transformRetention`)           | 2 regression tests |
| F1  | not fixable in this shard — outbound note to the vector-binding task                   | this record        |
