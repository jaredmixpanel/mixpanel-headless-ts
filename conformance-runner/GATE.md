# Phase-1 TS Gate Run (design D13, task TS-6)

Date: 2026-08-14. This file records the six D13 pass criteria — the
Phase-1 TS-side gate ("TS runner passes on a hand-written hello-world
module", plan §6) — as executed against the committed corpus snapshot.

## Corpus pin

| What                                                              | Value                                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| `corpus.config.json` `sourceCommit` (= `manifest.source_commit`)  | `52696743b913a0c4c152deb48af987ae412b5aee`                |
| Python rig commit snapshotted (`ts-port/phase1-verification-rig`) | `e73f303` (`conformance: authored seed vectors …`, PR-7)  |
| Record epoch                                                      | `2026-01-15T12:00:00Z`                                    |
| Snapshot size                                                     | 144 bundles / 2603 vectors (2530 extracted + 73 authored) |

Snapshot refreshed with `scripts/sync-corpus.sh` (clean-source rule: the
Python working tree was clean in all copied paths at sync time; copy taken
from the working tree at rig HEAD `e73f303`).

Note: minutes after the sync, a parallel Python-track task began writing
new UNCOMMITTED authored bundles (`authored/funnels/live-query-transforms.jsonl`,
`authored/retention/live-query-transforms.jsonl`, 6 vectors) into the
Python working tree. They are not part of PR-7 or this snapshot; the
Python full-corpus run below therefore reports 2609 vectors (2603 + 6),
all passing.

## Criteria

### 1. Python corpus runner passes all authored compat vectors — PASS

```
cd /Users/jaredmcfarland/Developer/mixpanel-headless
uv run python -m conformance.runner --vectors conformance/vectors --filter 'compat/*' --report json
```

Result: `{"total": 42, "passed": 42, "failed": 0, "status": "ok"}` — the
34 `compat/pythoncompat.jsonl` builder vectors plus the 8
`compat/wirestub.jsonl` wire vectors (the latter replayed through
`VectorTransport`, which also discharges the Python half of criterion 5).
Full-corpus control run: `2609/2609 passed` (includes the 6 uncommitted
parallel-task vectors noted above; the committed-at-`e73f303` corpus is
the 2603 subset).

### 2. TS runner replays all compat vectors green — PASS

```
npm run conformance -- --report json --filter "compat/"
```

Result: `42 passed, 0 failed, 0 unported` (34 `compat.*` + 8
`wirestub.*`). Also green as vitest corpus assertions
(`conformance-runner/test/corpus.test.ts`: 2603 tests, 42 executed live,
2561 skipped `UNPORTED`). Full-corpus CLI: `2603 vectors — 42 passed,
0 failed, 2561 unported`.

Enablement shipped with this gate: `compat.*` bound to the real
`packages/core/src/compat` port; `wirestub.*` bound to the
`conformance-runner/src/wirestub.ts` test double; api names mapped via the
new `authored-apis.json` generator supplement (the recorded-vector
api-index cannot carry authored-only apis); `InvocationContext.rawInput`
added so `compat.python_str` can recover Python's float-vs-int `str()`
branch from the raw JSON token (`18.0` vs `18`).

### 3. Canonicalizer selftest green in both languages — PASS

- Python: `uv run pytest conformance/tests/test_canonical_selftest.py -q`
  → `61 passed`.
- TS: `npx vitest run conformance-runner/test/canonical-selftest.test.ts`
  → `59 passed`.

Both suites are driven by the same
`corpus/canonical-selftest.json` contract artifact (incl. the `-0.0` and
float-exponent-window cases).

### 4. Deliberate break, builder path (zfill sign handling) — PASS

Sabotage: removed the sign-aware branch from
`packages/core/src/compat/zfill.ts` (naive `padding + value`, zeros
inserted BEFORE the sign).

```
npm run conformance -- --report json --filter "compat/compat.zfill"
```

Result: `12 vectors — 7 passed, 5 failed`, all `FAIL_OUTPUT`, e.g.
`compat/compat.zfill/authored-neg-one-width-3`:
`output "0-1" != expected "-01"` (also `authored-neg-42-width-5`,
`authored-plus-seven-width-3`, `authored-sign-only-minus`,
`authored-sign-only-plus`). Reverted via `git checkout`; post-revert rerun:
`12 passed, 0 failed`.

### 5. All authored wire-stub vectors replay green through VectorFetch — PASS

TS: the 8 `compat/wirestub.jsonl` vectors pass in the criterion-2 runs
(single interaction, multi-interaction sequence, `transport_error`
rejection→`WireStubTransportError(ConnectError)` surfacing, `body_stream`
chunk reassembly with boundaries preserved, `headers_contain` pattern +
ignored-unlisted-header, `params_absent`, 2-member `unordered_group` with
keyed serving). Python: the same 8 vectors pass through `VectorTransport`
in the criterion-1 run (42 = 34 + 8).

### 6. Deliberate break, wire path (stub client sabotage) — PASS

Sabotage (both applied to `conformance-runner/src/wirestub.ts`, then
reverted): (a) drop the first query param before issuing the request;
(b) swallow the fetch rejection and return `{status: 0, body: null}`
instead of classifying it.

```
npm run conformance -- --report json --filter "compat/wirestub"
```

Result: `8 vectors — 5 passed, 3 failed`:

- `compat/wirestub.request/authored-single-interaction` →
  `FAIL_REQUEST` (`params null != recorded {"q":"1"}`) — break (a).
- `compat/wirestub.request/authored-params-absent` → `FAIL_REQUEST`
  (`params null != recorded {"unit":"day"}`) — break (a).
- `compat/wirestub.request/authored-transport-error` → `FAIL_ERROR`
  (`expected raise {"class":"ConnectError"} but the call returned`) —
  break (b).

Reverted via `git checkout`; post-revert rerun: `42 passed, 0 failed`
over the full `compat/` filter.

## Verdict

All six D13 criteria met. **The Phase-1 TS gate is GREEN.**
