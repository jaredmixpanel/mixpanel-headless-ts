# B7-A2 — R10.9 throwaway harness RUN record

Throwaway. The B7 gate (`b7-packets.md` §4.6) deletes `throwaway/b7-a2/`;
this record is mirrored into `context/phase3/notes/B7-A2-notes.md`
(Python repo), which survives.

## Shape

Auth has NO oracle surface (playbook Risk 7 — no cross-language fuzz
bridge), so the harness is the packet §2.6 posture: exhaustive local
truth tables + branch enumeration + fast-check fuzz against independent
mini-models, seeds recorded.

| file                | role                                                                  |
| ------------------- | --------------------------------------------------------------------- |
| `resolver-truth.ts` | exhaustive precedence bitmaps + error rows + edge set + resolver fuzz |
| `probe-branches.ts` | every probe branch + credential-wrapper branches + probe fuzz         |

Run:

```
npx vite-node throwaway/b7-a2/resolver-truth.ts
npx vite-node throwaway/b7-a2/probe-branches.ts
```

## Counts (2026-08-16)

```
resolver-truth: checks 788 (incl. 600 fuzz runs, seed 20260816)  failures 0  fuzz-divergences 0
probe-branches: checks 660 (incl. 600 fuzz runs, seed 20260817)  failures 0  fuzz-divergences 0
```

| group                                                                   | checks |
| ------------------------------------------------------------------------ | -----: |
| account-axis bitmap 2^6 vs `firstPresent` mini-model                      |     64 |
| project-axis 2^4 × 3 account states                                       |     48 |
| workspace-axis 2^5 (incl. all-absent → null terminal)                     |     32 |
| resolver error rows + rule locks (§2.6 list, incl. Nd/No two-stage)       |     32 |
| resolver mandatory edge set (`""`/`"𝒳"`/`18.0`/`1.5` per admitted param) |     12 |
| resolver fast-check fuzz (seed **20260816**, 600 runs ≥ 500 budget)       |    600 |
| probe branches (items 1-9: positions, statuses, net, order, cap, timeout) |     47 |
| `probe_region_for_credential` branches + `probeBaseUrl` shapes (item 10)  |     13 |
| probe fast-check fuzz (seed **20260817**, 600 runs ≥ 500 budget)          |    600 |
| **total**                                                                 | **1448** |

Zero divergences in both fuzz families (zero-divergence table: empty).

## Layer-2 / Layer-3 state at record time

- `npm run conformance`: **3,251 vectors — 3,244 passed, 0 failed,
  7 unported** (corpus @ `70c904dc598d`) — the §2.8 pre-flip checkpoint
  (3,230 baseline + 14 `region_probe.probe_region` passing-while-pending;
  remaining 7 = `oauth_flow.refresh_tokens`, B8).
- `npm run check`: green (typecheck ×5 workspaces, eslint incl. the R9.1
  purity boundary, prettier, 9,213 vitest tests, browser-bundle smoke).

## Disclosures (also in B7-A2-notes.md — review-pair input)

1. **Packet §2.2 Nd example corrected by live probe** (uv CPython
   3.14.6, 2026-08-16): `MP_PROJECT_ID="٤٢"` (Arabic-Indic Nd digits)
   passes `str.isdigit()` AND `Project(id=...)` (pydantic-core Rust
   regex `\d` is Unicode) — Python RESOLVES with `project.id == "٤٢"`.
   TS matches (guard `/^\p{Nd}+$/u`, `parseProject` `/^\p{Nd}+$/u`).
   The packet's claimed two-stage failure for Nd does NOT exist; the
   two-stage split is real only for `Numeric_Type=Digit` codepoints
   outside Nd (e.g. `"²"`): Python guard passes → `Project` rejects →
   ConfigError "Invalid project ID"; TS has no Numeric_Type regex
   property, so `"²"` fails the GUARD → ConfigError "must be a digit
   string". Same class + code (`ConfigError`/`CONFIG_ERROR`), message +
   details differ. `TODO(port)` at the guard (`resolver.ts`); escalated
   to the shard arbiter per packet §2.2's "match CPython" instruction —
   not fully matchable without a pinned Numeric_Type table (a B0-1-style
   generated-table job if the arbiter wants byte-parity).
2. **`MP_WORKSPACE_ID` beyond 2^53−1** → `pythonInt`
   `PY_INT_UNSAFE_INTEGER` mapped to the SAME ConfigError
   ("not a positive integer" shape) where CPython parses the big int and
   (if > 0) USES it. Packet §2.2 pre-sanctions the coded-error mapping
   (Discrepancy #6/#7 family; not vector-observable). Harness row:
   `"9007199254740993"` → ConfigError.
3. **Network-error rendering reverse table** (packet Caution #8):
   committed `ECONNREFUSED → ConnectError`,
   `UND_ERR_CONNECT_TIMEOUT → ConnectTimeout`, `UND_ERR_SOCKET →
   ReadError`, fallback = inner cause `name` (a fired TS timeout clock
   renders `TimeoutError: ...` vs httpx's `ConnectTimeout/ReadTimeout`
   split — best-effort, vector-locked for `ECONNREFUSED` only).
4. **Pending-exemplar re-anchors pulled forward from the gate spec**
   (§4.3): binding `region_probe.probe_region` breaks bound-name
   anchors at BIND time, not flip time — `runner.test.ts` (2 tests) and
   `differential/test/oracle-protocol.test.ts` (2 tests) re-anchored to
   `oauth_flow.refresh_tokens` in this commit (the B6-BIND precedent).
   `batch-status.test.ts:86-87,240-243` anchors still hold (they assert
   PENDING STATUS, unchanged until the gate flip) — the gate keeps that
   §4.3 duty.
5. **Determinism seams**: none injected — no sleep/random/now in the
   probe or resolver paths (`timeoutSeconds` is plumbed but not
   vector-observable). Both harness files are deterministic apart from
   the seeded fc runs.
