# B6-W2 — R10.9 throwaway harness RUN record

Throwaway. The B6 gate (`b6-packets.md` §12) deletes `throwaway/b6-w2/`;
this record is mirrored into `context/phase3/notes/B6-W2-notes.md` §4
(Python repo), which survives.

## Shape

W2's 22 members are FACADE delegations over the B4-C3 dashboard wire
methods — all-wire, no oracle-callable surface (§11.5), so there is no
`py-side.py` differential half. One file:

| file            | role                                                         |
| --------------- | ------------------------------------------------------------ |
| `wire-edges.ts` | delegation equivalence + status branches + edge set + errors |

Run:

```
npx vite-node throwaway/b6-w2/wire-edges.ts
```

Deterministic (no RNG, no seed): every case is a hand-built canned
interaction over the injected-fetch seam.

## Counts

```
checks 55   failures 0
```

| group                                                | checks |
| ---------------------------------------------------- | -----: |
| (i) delegation equivalence (12 members)              |     14 |
| (ii) wire status branches                            |      7 |
| (iii) mandatory edge set (7 × ids + 7 × 2 params +1) |     22 |
| (iv) facade-local error branches                     |     12 |
| **total**                                            | **55** |

## Defects found

None in the W2 bodies: the first full run was green except for three
harness-side expectation typos (`QUERY_ERROR` → the real
`QUERY_FAILED`) and the two rows recorded below.

## Recorded (not defects) — measured against the Python arbiter

`uv run python`, 2026-08-16, corpus pin `70c904dc`.

### 1. `ids=` (plain kwarg — no pydantic layer, `api_client.py:3678`)

Python does `",".join(str(i) for i in ids)` and skips the param entirely
when `if ids:` is falsy.

| element  | Python `ids=` param | TS port | verdict                        |
| -------- | ------------------- | ------- | ------------------------------ |
| `18.0`   | `18.0`              | `18`    | **out of annotation** (#8/#12) |
| `1.5`    | `1.5`               | `1.5`   | match                          |
| `True`   | `True`              | `True`  | match                          |
| `None`   | `None`              | `None`  | match                          |
| `[]`     | `[]`                | `[]`    | match                          |
| `""`     | `` (empty)          | ``      | match                          |
| `"𝒳"`    | `𝒳`                 | `𝒳`     | match                          |
| `ids=[]` | param omitted       | omitted | match                          |

The `18.0` row: `ids: list[int] | None`, so a float element is outside
the declared annotation (ratified Discrepancy #8) and JS cannot spell an
integral float distinctly (Discrepancy #12's class). `pythonStr` is
already the R11.7-correct renderer for every in-annotation value.

### 2. `CreateDashboardParams` fields (pydantic-validated)

| value  | `title: str`       | `duplicate: int \| None` | TS `duplicate` | verdict   |
| ------ | ------------------ | ------------------------ | -------------- | --------- |
| `18.0` | `ValidationError`  | ok → `18`                | ok → `18`      | match     |
| `1.5`  | `ValidationError`  | `ValidationError`        | error          | match     |
| `True` | `ValidationError`  | ok → `1`                 | **error**      | **R4.12** |
| `None` | `ValidationError`  | dropped (exclude_none)   | dropped        | match     |
| `[]`   | `ValidationError`  | `ValidationError`        | error          | match     |
| `""`   | ok → `{title: ""}` | `ValidationError`        | error          | match     |
| `"𝒳"`  | ok                 | `ValidationError`        | error          | match     |

The `True` row is the ratified port-wide rule R4.12 (`coerce.ts:121`:
booleans are never ints), not a W2 decision — identical to the W1
`organization_id=True` row.

### 3. Phase-2 model gap: `BlueprintConfig.variables`

Python declares `variables: dict[str, str]` and rejects a scalar / a
non-str value (`ValidationError`, measured). The Phase-2 TS spec
(`types/entities/dashboards.ts:709`) declares the field with no
`kind`/`container`, so `{"variables": 7}` validates clean and
`get_blueprint_config` returns a model whose `variables` is `7`.

NOT a W2 body defect (the facade composes the shared model seam — R10.8)
and NOT vector-observable today (`get_blueprint_config` has 0 corpus
vectors). Left as-is by W2 to avoid a cross-shard edit to a Phase-2
model; recorded in `B6-W2-notes.md` §5 as an outbound finding for the
review pair / arbiter to place.
