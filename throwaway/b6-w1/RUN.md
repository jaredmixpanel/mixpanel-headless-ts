# B6-W1 — R10.9 throwaway harness RUN record

Throwaway. The B6 gate (`b6-packets.md` §12) deletes `throwaway/b6-w1/`;
this record is mirrored into `context/phase3/notes/B6-W1-notes.md` §R10.9
(Python repo), which survives.

## Shape

W1's members are FACADE delegations: they have no oracle-callable
surface, so there is no `py-side.py` differential half (packet §3: "wire
members have no oracle-call surface — edge set through `VectorFetch`
with hand-built interactions"). The single file is the wire/edge
harness.

| file            | role                                                         |
| --------------- | ------------------------------------------------------------ |
| `wire-edges.ts` | delegation equivalence + status branches + edge set + errors |

Run:

```
npx vite-node throwaway/b6-w1/wire-edges.ts
```

Deterministic (no RNG, no seed): every case is a hand-built canned
interaction over the injected-fetch seam.

## Counts

```
checks 61   failures 0
```

| group                                          | checks |
| ---------------------------------------------- | -----: |
| (i) delegation equivalence                     |     12 |
| (ii) wire status branches                      |     11 |
| (iii) mandatory edge set (7 values × 3 params) |     21 |
| (iv) W1-local error branches + R6.2 identity   |     17 |
| **total**                                      | **61** |

## Defect found and fixed

**`MeService.fetch()` validated the LOSSLESS tree.** The first run died
with `ResponseValidationError: Expected int, got object` from
`MeProjectInfo.organization_id`: `client.me()` returns the
lossless-parsed body, and the port fed it straight to
`MeResponse.fromDict`. Python validates the plain `json.loads` output
(`me.py:762`). Fixed by normalizing with `toNativeJson(...)` first — the
same step every B4 model site performs (`client.ts:879`). No Layer-3
test caught it because the translated `test_me.py` cases construct their
payloads as plain objects, exactly as the Python fixtures do.

## Recorded (not defects) — the Discrepancy #8 boundary

The edge set is `18.0, 1.5, true, null, [], "", "𝒳"`. Measured against
the Python arbiter (`uv run python`, 2026-08-16):

| input                        | Python                             | TS port                   | verdict               |
| ---------------------------- | ---------------------------------- | ------------------------- | --------------------- |
| `organization_id=18.0`       | ok (int 18)                        | ok (18)                   | match                 |
| `organization_id=1.5`        | `ValidationError`                  | `ResponseValidationError` | match                 |
| `organization_id=True`       | ok (bool is an int)                | `ResponseValidationError` | **R4.12**             |
| `organization_id=""/[]/"𝒳"`  | `ValidationError`                  | `ResponseValidationError` | match                 |
| `set_business_context(18.0)` | `TypeError` (`len(float)`)         | `TypeError`-shaped throw  | match                 |
| `use(workspace=1.5/""/[])`   | `ValidationError` (`WorkspaceRef`) | forwarded verbatim        | **out of annotation** |

- The `True` row is the ratified port-wide rule R4.12 (`coerce.ts:121`:
  booleans are never ints), not a W1 decision.
- The `use(workspace=…)` row: Python's `WorkspaceRef` is a Pydantic
  model that validates on construction; TS's is a plain interface, so an
  out-of-annotation value rides through to the client. Both are outside
  the declared `int | None` annotation, i.e. unspecified per ratified
  Discrepancy #8. Recorded here so the review pair sees it was measured.
