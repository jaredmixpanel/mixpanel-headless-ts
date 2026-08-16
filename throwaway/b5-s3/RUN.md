# B5-S3 — R10.9 throwaway harness RUN record

Throwaway. Packet §7.5 deletes `throwaway/b5-s3/` at the batch gate; this
record is mirrored into `context/phase3/notes/B5-S3-notes.md` §R10.9
(which survives).

## Part 1 — differential (Python arbiter vs TS port)

| file         | role                                                                            |
| ------------ | ------------------------------------------------------------------------------- |
| `py-side.py` | seeded recipe generation + Python arbiter outputs (`cases.json`, `py-out.json`) |
| `ts-side.ts` | the same recipes rebuilt as TS objects, through the port (`ts-out.json`)        |
| `compare.ts` | canonical-JSON comparator (sorted object keys, `-0` preserved)                  |

Run:

```
uv run python <ts-repo>/throwaway/b5-s3/py-side.py   # from the PYTHON repo
npx vite-node throwaway/b5-s3/ts-side.ts             # from the TS repo
npx vite-node throwaway/b5-s3/compare.ts
```

Seed `20260816`, `PER_FAMILY = 520` (packet §5 requires ≥500 per family).

### Counts

| family                   |     cases |  raised | diverged |
| ------------------------ | --------: | ------: | -------: |
| `url_normalizer`         |       520 |       0 |        0 |
| `default_label_fn`       |       520 |       0 |        0 |
| `selector_label_fn`      |       520 |       0 |   **14** |
| `rrweb_analyzer.analyze` |       520 |     109 |    **6** |
| **total**                | **2,080** | **109** |   **20** |

The 109 raises are all `ParamValidationError` /
`UA1_TIMESTAMP_NOT_POSITIVE` — the analyzer's downstream `UserAction`
constructor guard, reached when a drawn stream carries a `timestamp` of
`0` or `-1.9` (the mandated edge set puts both in the domain). Class and
code are identical on both sides for all 109.

### Divergences — all 20 are the documented int/float narrowing

`cases.json` is JSON, so a Python `18.0` arrives in JS as `18`: the two
runtimes then render `str(18.0) == "18.0"` vs `String(18) === "18"`. This
is the SAME narrowing `compare.ts`'s header documents and `toNativeJson`
erases by contract (`json-value.ts:108-112`). Verified mechanically —
stripping the CPython integral-float spelling from the PY side makes all
20 byte-identical, and **0 divergences of any other class remain**:

```
divergences 20   int/float-narrowing 20   other 0
```

Both affected surfaces are f-string interpolations of a `dict[str, Any]`
value (`selector_label_fn`'s `{candidate}` and the analyzer's
`" ".join(str(m) …)` console-message join); no vector reaches a float
there.

### Defect found and fixed: `selectorLabelFn` used `String()`

The first differential run reported **29** divergences, 9 of which were a
REAL fork: Python's f-string is `str(candidate)`, so a boolean metadata
value renders `True` while `String(true)` renders `true` (and `None` vs
`null`, `[1, 2]` vs `1,2`). Fixed by routing the interpolation through
`pythonStr` (`packages/core/src/replays/replay-labels.ts`), which dropped
the count to the 20 transport-narrowing cases above.

## Part 2 — CDN-walker wire edges (`wire-edges.ts`)

```
npx vite-node throwaway/b5-s3/wire-edges.ts
→ 70 checks / 0 failures
```

Every scenario the packet §5 harness spec names, plus every owned error
branch:

**404 sentinel** — 404 at absolute file 0 → `REPLAY_NOT_FOUND` (+ all
three `details` fields); mid-batch 404 with survivors AFTER it in the
SAME batch (pre-sentinel files yield, post-sentinel files are dropped,
and the whole batch was still ISSUED — the `asyncio.gather` twin); 404
exactly at a batch boundary (clean terminate, batch 0 preserved).

**403 re-sign** — 403-then-success (exactly ONE re-sign, whole batch
refetched); 403-re-sign-then-403 → `SIGNED_URL_EXPIRED` whose details
carry the ORIGINAL `signed_at` / `expired_at` (packet §9 Caution #4) and
`statusCode` 403; `reSignOnExpiry=false` → raise with ZERO sign calls.

**Bounds + concurrency** — `maxFiles` CLAMPS the batch (3 requests
issued, not 50-then-truncate); `concurrency: 1` vs `50` produce
byte-identical output on an identical interaction set, with the observed
in-flight peak 1 vs >1 proving the two paths really differ.

**Body handling / mandated edge set** — 200 `[]` continues the walk (not
a terminator); 200 non-list bodies (`42`, `"text"`, `{}`, `null`,
`true`, `NaN`) are EMPTY files, not errors (Caution #5); `NaN` inside a
200 body parses (`parseLossless` + `pythonConstants`); float / string /
bool timestamps order through the CPython `int()` LADDER — `18.9`
truncates to `18`, NOT `19` (Caution #3); non-BMP body content survives
byte-for-byte.

**Mobile detection** — non-rrweb first event →
`UNSUPPORTED_REPLAY_FORMAT` with `details.format`; the check skips
leading EMPTY files (fires on the first YIELDED file); it is once-only
(a later non-rrweb event does not re-fire it).

**Transport + status** — transport failure → `CDN_FETCH_ERROR` with the
credential scrubbed from both the message and the serialized details
(`<redacted>` present, `Signature=SECRET` absent); non-JSON 200 →
`CDN_INVALID_RESPONSE`; 500 / 502 / 429 / 301 / 418 →
`CDN_UNEXPECTED_STATUS`.

**Workspace guards** — all 10 `WR1` / `WR4` / `WR5` sites
(`TestCodedReplayGuardCodes` plus the `fetchReplay` / `fetchReplays` /
`replaysForUser` WR1 seams the Python file does not reach), each PAIRED
with a "makes no wire call" assertion; exactly-5 properties is allowed
(inclusive cap). Plus `fetchReplay`'s own zero-event `REPLAY_NOT_FOUND`
(distinct from the walker's first-file branch) and an R6.6 proof that
`streamReplay` yields its first event before the walk is exhausted and
closes cleanly on early `return()`.

## Error-code coverage (S3-owned branches)

| code                            | exercised in                                     |
| ------------------------------- | ------------------------------------------------ |
| `REPLAY_NOT_FOUND`              | walker first-file 404; `fetchReplay` zero events |
| `SIGNED_URL_EXPIRED`            | 403×2; `reSignOnExpiry=false`                    |
| `UNSUPPORTED_REPLAY_FORMAT`     | 3 mobile-detection scenarios                     |
| `CDN_FETCH_ERROR`               | transport failure (+ redaction)                  |
| `CDN_INVALID_RESPONSE`          | non-JSON 200                                     |
| `CDN_UNEXPECTED_STATUS`         | 5 statuses                                       |
| `WR1_TOO_MANY_EVENT_PROPERTIES` | 5 facade seams                                   |
| `WR4_REPLAY_SELECTOR_REQUIRED`  | 3 selector shapes                                |
| `WR5_DATE_RANGE_REQUIRED`       | 2 window shapes                                  |
| `UA1_TIMESTAMP_NOT_POSITIVE`    | 109 differential cases                           |
| `PY_RANDOM_SAMPLE_RANGE`        | `test/compat/python-random.test.ts`              |
