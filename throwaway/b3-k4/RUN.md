# B3-K4 R10.9 differential harness — RUN record

Module task: **B3-K4** (`query/user_builders.py` builders half — the
`filter_to_selector` selector path, semantic-trap watchlist #2). Harness lives
here per P3-2 step (c) ("the harness is NOT deleted by the module task … the
BATCH GATE task removes `throwaway/` after arbiter sign-off").

## 1. What it compares

| side | how |
|---|---|
| Python | `gen-cases.py` imports and calls the REAL `mixpanel_headless._internal.query.user_builders` functions — `filter_to_selector`, `filters_to_selector`, `extract_cohort_filter` and `_format_value` (support-branch HEAD, CPython via `uv run --project <py-repo>`) |
| TS | `harness.mjs` calls the REAL `packages/core/src/query/user-builders.ts` through an esbuild bundle of `entry.ts` — no re-implementation, no shortcut (P3-5 rule 3 in spirit) |

Comparison is **byte-exact string equality** for the selector outputs. That is
the right strictness here and not merely a bonus: the rig's `selector_str`
codec compares selector strings VERBATIM, and R10.11's numeric-string
canonicalizer rule covers the segfilter number-operand positions ONLY — nothing
in this module gets a rescue. `extract_cohort_filter`'s 2-tuple is compared as
the binding will encode it: a 2-element array of structurally-encoded Filters
(Python-spelled `_`-fields) with `null` for "no cohort".

Float-ness crosses the boundary as `{"__f__": repr(value)}` and is rebuilt on
the TS side as a `PyFloat` CLASS instance — the rig's real carrier shape, which
`isFloatCarrier` accepts and `isPythonDict` rejects (B2 arbiter fix F1). This
is what proves `str(18.0)` renders `"18.0"` (not `"18"`) inside a selector and
that a carrier counts as a number for ES8/ES9/ES11/ES12.

Errors compare as `{class, code}` pairs — class AND code, both directions.

## 2. Oracle-bridge status (P3-2 step c)

The oracle families `filter_to_selector` (`strategies.py:167-170`) and
`filters_to_selector` (`:190-206`) exist on oracle-py but are Phase-1
pending-skips on oracle-ts: the `user_builders.*` names are not registered in
`conformance-runner/src/bindings.ts` yet, because binding + oracle registration
is the SEPARATE fable (b′) task for volume-tier batches (P3-6 step 3), which
this module task is explicitly forbidden to do. The through-the-bridge fuzz is
therefore **deferred to (b′)**, and this direct CPython ↔ Node harness stands in
at the doubled budget meanwhile (K3 precedent). `extract_cohort_filter` has no
oracle family at all yet — the packet assigns that NEW family to (b′) as well.

## 3. Recorded sweep (2026-08-15)

`bash throwaway/b3-k4/run.sh` — seeds `20260815, 4242, 99991, 20260816, 7`;
**1,100 draws per selector family** (the packet's DOUBLED ≥1,000 budget) and
550 for `extract_cohort_filter` / `_format_value`, plus the mandatory edge
block prepended to every seed.

| seed | compared | divergences | class-only error spellings |
|---|---|---|---|
| 20260815 | 3,531 | **0** | 0 |
| 4242 | 3,531 | **0** | 0 |
| 99991 | 3,531 | **0** | 0 |
| 20260816 | 3,531 | **0** | 0 |
| 7 | 3,531 | **0** | 0 |
| **Σ** | **17,655** | **0** | **0** |

Per-api counts (identical every seed — the surplus over the draw count is the
shared edge block):

| api | per seed | budget |
|---|---|---|
| `filter_to_selector` | 1,260 | ≥1,000 (doubled) ✓ |
| `filters_to_selector` | 1,136 | ≥1,000 (doubled) ✓ |
| `extract_cohort_filter` | 559 | ≥500 ✓ |
| `_format_value` (direct probe) | 576 | — |

Outcome tally (seed 7, representative — **all 13 K4-owned ES codes fire**, and
every one agreed on both sides):

```
OK                                1,926
ES13_UNSUPPORTED_OPERATOR           917
ES1_PROPERTY_NOT_STRING             376
ES5_NOT_EQUALS_NO_TERMS              41
ES2_EQUALS_EXPECTS_LIST              35
ES3_EQUALS_NO_TERMS                  35
ES4_NOT_EQUALS_EXPECTS_LIST          35
ES8_GT_EXPECTS_NUMBER                35
ES10_BETWEEN_EXPECTS_PAIR            31
ES9_LT_EXPECTS_NUMBER                31
ES6_CONTAINS_EXPECTS_STR             25
ES7_NOT_CONTAINS_EXPECTS_STR         22
ES12_BETWEEN_UPPER_NOT_NUMBER        14
ES11_BETWEEN_LOWER_NOT_NUMBER         8
```

Zero divergences ⇒ no repros were written to
`conformance/differential/repros/`.

## 4. Coverage of the packet's mandatory edge set

| requirement | where |
|---|---|
| verbatim R10.9 items (`18.0` as PyFloat carrier, `1.5`, `True`, `None`, `[]`, `""`, `"𝒳"`) | `edge_cases()` — each replayed through 11 slots: equals element, bare equals value, not-equals element, contains, gt, lt, between-lo, between-hi, bare between, the PROPERTY name, and `_format_value` directly |
| one probe per ES code per entry point | `ES_PROBES` × {`filter_to_selector`, `filters_to_selector`} (14 probes — ES1 twice, scalar and list property) |
| `filters_to_selector([])` → `""` | `edge/filters/empty` |
| two-element list where the SECOND filter errors (generator-order lock) | `edge/order/second-errors`; `edge/order/both-error` locks first-error-wins |
| adversarial escaping alphabet (lone/trailing/doubled backslash, `"`, `\"`, `\\"`, single quotes, `\n\t\r\0`, non-BMP `𝒳`, emoji + variation selector, combining marks, U+FEFF/U+200B, the literal `properties["` accessor, `' or '` / `' and '` injection fragments) | `FRAGMENTS` (drawn) + `ESCAPE_STRINGS` (19 verbatim edge strings × property / equals-element / contains / not-contains / `_format_value` / two-filter seam) |
| numeric bias: integral floats (carrier), `-0.0`, `1e16`, `1e-5`, booleans in equals lists | `NUMBERS` |
| `extract_cohort_filter`: 0/1/2/3 cohorts, position/order preservation, empty list, malformed `_value` shapes | `edge/extract/*` + `draw_extract_list` |

## 5. Documented domain omissions

- `_operator = "list_contains"` is excluded from the drawn operator alphabet:
  `Filter.__post_init__` (`types.py:7209`, LC1/LC2) rejects it without
  `_list_item_filters`, so the case would fail at CONSTRUCTION on both sides and
  never reach the code under test. Its selector behavior is plain ES13
  fallthrough, covered by the other unknown spellings.
- `_property` / value domains stay inside the Python annotations plus the
  in-annotation `Any` interiors (ratified Discrepancy #8): `dict`/`list`
  interiors are drawn freely, but no `undefined`, no class instances other than
  the PyFloat carrier.
