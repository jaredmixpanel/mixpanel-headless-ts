# B3-K3 R10.9 differential harness — RUN record

Module task: **B3-K3** (`segfilter.py` + `expressions.py` + `transforms.py`).
Harness lives here per P3-2 step (c) ("the harness is NOT deleted by the module
task … the BATCH GATE task removes `throwaway/` after arbiter sign-off").

## 1. What it compares

| side | how |
|---|---|
| Python | `gen-cases.py` imports and calls the REAL `mixpanel_headless._internal.{segfilter,expressions,transforms}` functions (support-branch HEAD, CPython 3.14.6 via `uv run --project <py-repo>`) |
| TS | `harness.mjs` calls the REAL `packages/core/src/query/{segfilter,expressions,transforms}.ts` through an esbuild bundle of `entry.ts` — no re-implementation, no shortcut (P3-5 rule 3 in spirit) |

Comparison is **byte-exact** (`canon` sorts dict KEYS only; strings, arrays and
error `{class, code}` pairs are diffed verbatim). This is deliberately
STRICTER than the conformance canonicalizer, which would normalize numeric
strings at the two R10.11 operand positions — the harness therefore proves the
operand renderings agree without that rescue.

Determinism seams: `transform_event`'s `uuid.uuid4` is stubbed on the Python
side to `00000000-0000-4000-8000-{index:012d}` and the same value is injected
into the TS call via the `uuid` option (twin of `clock.py:30` ↔ `shims.ts:107`).
`event_time` is compared as `{"$dt": <isoformat>}` on both sides: Python's
`datetime` encodes that way in the generator, and the harness wraps the TS
library's iso TEXT identically to the binding's `PyDatetime` encode
(b3-packets.md §Binding-shapes).

Float-ness crosses the boundary as `{"__f__": repr(value)}` and is rebuilt on
the TS side as a `PyFloat` CLASS instance — the rig's real carrier shape, which
`isFloatCarrier` accepts and `isPythonDict` rejects (B2 arbiter fix F1).

## 2. Recorded sweep

`bash throwaway/b3-k3/run.sh` — seeds `20260815, 4242, 99991, 20260816, 7`;
600 draws per family over 4 families (≥500 mandated) plus the mandatory edge
block prepended to every seed.

| seed | compared | divergences | class-only error spellings |
|---|---|---|---|
| 20260815 | 2,594 | **0** | 0 |
| 4242 | 2,594 | **0** | 0 |
| 99991 | 2,594 | **0** | 0 |
| 20260816 | 2,594 | **0** | 0 |
| 7 | 2,594 | **0** | 0 |
| **Σ** | **12,970** | **0** | **0** |

Per-api counts (identical every seed): `build_segfilter_entry` 731 ·
`normalize_on_expression` 634 · `transform_event` 626 · `transform_profile`
603 (each ≥ the 500 budget; the surplus over 600 is the shared edge block).

Outcome tally (seed 7, representative — every K3-owned guard code fires, and
each agreed on both sides):

```
OK                                1,910
SG4_UNSUPPORTED_PROPERTY_TYPE       252
TypeError (builtin twin)            174
SG3_UNKNOWN_DATETIME_OPERATOR        78
SG1_UNKNOWN_STRING_OPERATOR          66
ValueError (builtin twin)            64
SG2_UNKNOWN_NUMBER_OPERATOR          49
AttributeError (builtin twin)         1
```

## 2b. Offline vector pre-check

Independently of the fuzz, the 83 K3 corpus vectors were replayed offline
through the same bundle and byte-compared against `expect.output` /
`expect.error`: **83 checked, 0 failures**. This is a pre-check only — the
authoritative replay is the (b′) binding task's `npm run conformance` run.

## 3. Mandatory edge set (verbatim, prepended to every seed)

Every R10.9 fixed item — integral float `18.0`, fractional `1.5`, `True`,
`None`, empty list, empty string, non-BMP `"𝒳"` — is pushed through FIVE
segfilter branches (string-equals, number `>`, number range, datetime absolute,
datetime relative) and through `normalize_on_expression`, plus:

- **every K3 error branch**: SG1, SG2, SG3, SG4 (`list`/`object`/`weird`),
  `_convert_date_format` arity on `"2026-1-5"`, `"01/15/2026"`, `"junk"`,
  `""`, `"2026-01-15-01"`, `"a-b-c-d"` (both the single-date and the range
  branch), the non-string range element (`AttributeError`), the non-iterable
  range value (`TypeError`);
- **boolean** filters for `true`/`false`/unknown operators;
- **resource-type** rows `events/people/cohorts/other/unmapped` (fallback-to-self);
- **setness ops on the number path** and a relative datetime op with
  `date_unit=None`;
- **systematic operator-row sweep**: every row of `STRING_OPERATOR_MAP`,
  `NUMBER_OPERATOR_MAP` and `DATETIME_OPERATOR_MAP` on its matching property
  type, with `date_unit` ∈ {None, day, hour, week, month, ""} for the datetime
  rows (the packet's `filter_strategy()` coverage audit — verified 0 missing
  rows by the coverage probe in the K3 notes);
- **expressions**: lone/trailing/doubled backslashes, `"`/`\"`/`\\"` compounds,
  the literal accessor fragments (`properties["`, `user["`, `event["` —
  selector-injection shape), `' or '`, newline/tab/CR, U+FEFF/U+200B,
  combining marks, non-BMP and emoji, plus the three Python-test literals
  (`path\to\"file`, `my"property`, `a\\b`);
- **transforms**: `transform_event` with `time` ∈ {0, ±1, 1704067200, 18.0
  (PyFloat carrier), 1.5, -1.5, ±0.5, 1.0000005, 2.5e-6, 5e-7, -1.5e-6, True,
  False, 253402300799, -62135596800, 1e11, "x", None, [1], {"a":1}}, the empty
  dict, a non-BMP event name + property key, and `transform_profile` with the
  empty dict / missing `$distinct_id` / non-dict `$properties`.

## 4. Findings

One divergence was found and FIXED at its owning layer during the run (red →
green, first 30-draw calibration run, seed 20260815):

> `transform_profile({"$properties": "ab"})` — CPython's `dict("ab")` raises
> **ValueError** (`dictionary update sequence element #0 has length 1; 2 is
> required`), while the first TS draft raised `TypeError` for every non-dict.
> `properties` is a `dict[str, Any]` INTERIOR value, i.e. in-annotation under
> ratified Discrepancy #8, so CPython's behavior is contract. Fix:
> `pythonDictCopy` now reproduces `dict(iterable-of-pairs)` branch for branch
> (probe transcript in the K3 notes §5) — non-iterable → `TypeError`,
> non-iterable element → `TypeError`, wrong-length element → `ValueError`,
> unhashable key → the shared `requireHashable` guard, pair mapping otherwise.

No repros written to `conformance/differential/repros/` (zero unexplained
divergences remain).

## 5. Re-run instructions (for the review pair, P3-2 step d item 5)

```bash
cd /Users/jaredmcfarland/Developer/mixpanel-headless-ts
bash throwaway/b3-k3/run.sh            # full recorded sweep (5 seeds)
bash throwaway/b3-k3/run.sh 4242 600   # single seed
```

Requires `uv` and the Python repo at `/Users/jaredmcfarland/Developer/mixpanel-headless`
(override with `PY_ROOT=…`). The runner rebuilds `.build/entry.mjs` with
esbuild on every invocation, so it always exercises the CURRENT sources.
