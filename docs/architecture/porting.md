---
title: Porting
description: "The Python revision the port tracks, what the conformance corpus and the differential oracle prove (and do not), the naming rules, and the categories of known behavioral divergence."
---

# Porting

This is a behavior-for-behavior port of the Python
[`mixpanel_headless`](https://github.com/mixpanel/mixpanel-headless) library.
"Behavior-for-behavior" is a claim that is checked, not asserted: a corpus
of test vectors extracted from the Python implementation is replayed against
the port on every run of the repository gate, and a cross-language
differential oracle fuzzes the two implementations against each other. This
page records what is pinned, what the rig proves, and where the port knowingly
differs. The authoritative, always-current list of divergences is
[`PORTING.md`](https://github.com/jaredmixpanel/mixpanel-headless-ts/blob/main/PORTING.md)
in the repository; this page summarizes its categories and does not repeat
its entries.

## Pinned Python revision

| What                               | Value                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Corpus pin (`sourceCommit`)        | `0dde50608a6af026e94cdb75bacbcebe5ce105db` — Python `main`, 2026-09-11                                                              |
| Python `__version__` at the pin    | `0.2.2`                                                                                                                             |
| Python `requires-python`           | `>= 3.10`; the compat tables and canonical fixtures were generated with CPython 3.14.6 / Unicode 16.0.0 (recorded in their headers) |
| Corpus record epoch (frozen clock) | `2026-01-15T12:00:00Z`                                                                                                              |
| TS package versions                | `@mixpanel-headless/{core,node,browser}` `0.1.0`, released in lockstep                                                              |

Python-side changes that land after the pin are absorbed by re-pinning the
corpus and porting the change. Two features from later Python pull requests —
the `limit` option with its `run*Params` companions, and the `MP_API_BASE_URL`
/ `MP_APP_BASE_URL` host overrides — are ported but not corpus-locked, because
their Python tests do not pass through the extraction seams.

## Naming

Python `snake_case` methods and static builders become `camelCase`
(`ws.query_funnel` → `ws.queryFunnel`, `Filter.starts_with` →
`Filter.startsWith`). Keyword arguments become one options object whose keys
**stay `snake_case`** when they mirror Python keywords or wire fields
(`{ math: "dau", last: 90 }`, entity-model fields, bookmark params, error
`details`); constructor and config option bags are `camelCase`
(`new Workspace({ session, clientOptions })`).

The Python → TypeScript name of every corpus entry point is resolved through
a generated API map; the few exceptions to the mechanical transform live in a
checked-in exceptions file, and the generator fails on any name with no rule
— there is no fuzzy matching. The [API overview](/api/#naming) has the
user-facing version of the rule; [Coming from Python](/guide/coming-from-python)
has the translation table.

## The conformance corpus

Each vector is a recorded Python call: the inputs, the expected output or
error class and code, and — for wire vectors — the exact HTTP requests Python
made, with canned responses. The corpus is a committed snapshot pinned to the
revision above; it is replayed by the test suite and by a CLI that reports one
verdict per vector:

| Verdict          | Meaning                                                                        |
| ---------------- | ------------------------------------------------------------------------------ |
| `PASS`           | Output (after canonicalization), requests and error class/code all match       |
| `FAIL_OUTPUT`    | The value differs after canonicalization                                       |
| `FAIL_REQUEST`   | The port issued a different method, URL, params, headers or body               |
| `FAIL_ERROR`     | The error class or code differs                                                |
| `PRECISION_LOSS` | The only difference is the rounding of an integer beyond 2^53                  |
| `UNPORTED`       | The entry point is mapped but not bound in the runner — counted, never failing |
| `UNMAPPED_API`   | No API-map row for the Python name — fails fast                                |

The gate requires zero `FAIL_*` verdicts.

## The differential oracle

The Python repository's fuzz harness generates inputs with Hypothesis and
feeds them to two oracles over a stdio line protocol — the Python one and
`oracle-ts`, a bridge over the same bindings the conformance runner uses —
and compares the answers through a shared canonicalizer. It covers 55 input
families, from the Python-parity string and float helpers to the filter and
bookmark builders, the validators and the model codecs. A separate
JSON-schema referee checks every recorded `build_params` payload against the
bookmark schema.

## What the rig proves — and does not

**Proven**, within the recorded input domain: output values, the exact
requests on the wire, and the error class and code for every corpus vector;
agreement with Python on every fuzzed family.

**Not proven**: anything outside that domain —

- error message text (class and code are the contract, the message is not);
- inputs that violate a validator's declared type;
- integers beyond 2^53 (a canonicalizer policy: integers are contract up to
  ±(2^53 − 1));
- object-key order (the canonicalizer sorts keys, so JavaScript's hoisting of
  integer-like keys is invisible to it);
- local-clock behavior (the runners freeze a UTC clock);
- real network timing, timeouts and retries (the `sleep`, `now` and `random`
  seams are injected);
- file-system security properties on Node;
- browser-only behavior;
- the fuzz domain's documented exclusions (timestamps beyond `datetime.max`,
  integer-like unknown keys, big integers).

"0 divergences" is relative to those.

## Known divergence categories

Every known behavioral difference is listed in
[`PORTING.md`](https://github.com/jaredmixpanel/mixpanel-headless-ts/blob/main/PORTING.md)
with the TypeScript symbol that carries it; differences introduced
deliberately are also marked `// Divergence:` at the site in the source. The
contract for all of them: error class and code are contract, message text is
not; integers are contract up to ±(2^53 − 1). The categories:

| Category                            | One line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numbers beyond 2^53                 | CPython integers are arbitrary precision; the port returns `number` and rejects anything beyond ±(2^53 − 1) with `PY_INT_UNSAFE_INTEGER` ([`pythonInt`](/reference/core/functions/pythonInt)) rather than rounding silently. A handful of parse sites read such values as absent.                                                                                                                                                                                                                                                         |
| Integer-like object keys            | JavaScript iterates integer-like keys first; where a result exposes a plain object keyed by event or property names, iteration order can differ from Python's insertion order (derived views rebuild the right order).                                                                                                                                                                                                                                                                                                                    |
| Error class or message only         | Same failure, different wrapper or text: a bare Python `ValueError` / `RuntimeError` becomes a coded `MixpanelHeadlessError` subclass, or the same class and code carries a shorter message.                                                                                                                                                                                                                                                                                                                                              |
| Clocks, timeouts and IO seams       | `fetch` has no per-read timeout, so streaming bodies are not clock-bounded after headers; default date windows are computed in UTC from the injected clock rather than the host's local calendar; logging is an injected seam with a no-op default.                                                                                                                                                                                                                                                                                       |
| Node file system and OAuth callback | Python's `O_NOFOLLOW` / `fstat`-pinned invariant layer is replaced by `lstat` symlink refusal plus mode and size checks (a small TOCTOU window is the accepted deviation); the callback server ignores stray non-`/callback` GETs and never logs the expected `state`.                                                                                                                                                                                                                                                                    |
| Wire and encoding                   | The User-Agent runtime tag, BOM handling on JSONL, Unicode-aware versus ASCII digit classes at a few gates, NFKD with the host's Unicode tables in `slugify`.                                                                                                                                                                                                                                                                                                                                                                             |
| Browser                             | No refresh-token grant (an expired token means a fresh login); header-redirect shortlinks resolve only on Node; service-account credentials and the Export API are refused at runtime; no `User-Agent` header is sent (a Fetch forbidden request header that Safari forwards into the CORS preflight, where Mixpanel rejects it). Login has a popup transport for embedded pages next to redirect and paste, where Python has a loopback server and a paste reader; `BROWSER_POPUP_BLOCKED` / `BROWSER_POPUP_CLOSED` have no Python twin. |
| Runtime immutability                | Python freezes `BookmarkUrl`; the port's entity instances are read-only at the type level only. The type-level half is pinned by a compile-time test.                                                                                                                                                                                                                                                                                                                                                                                     |
| Not observable at runtime           | Result classes whose Python `.df` is not the uniform rows pattern expose `toRows()` variants; [`ReplayBundle`](/reference/core/classes/ReplayBundle)`.sample()` reproduces CPython's Mersenne Twister exactly; `repr()` printability uses a generated CPython table.                                                                                                                                                                                                                                                                      |

`PORTING.md` also records one JavaScript-only hazard the port had and fixed
(a response property literally named `__proto__` was silently dropped; every
dict-building write now defines an own property) so that a new
`record[key] = value` site does not regress it.

## Current numbers

As recorded in `PORTING.md` and the run records it cites:

| Measure                        | Value                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------- |
| Conformance corpus @ `0dde506` | 3,453 vectors — 3,453 passed, 0 failed, 0 unported (2026-09-14)                   |
| Differential oracle            | 28,091 examples / 0 skips / 0 divergences, both bridges at `0dde506` (2026-09-14) |
| Bookmark-schema referee        | green, 0 rejects over 127 recorded `build_params` payloads                        |

The gate replays the whole corpus on every run and in CI on Node 22 and 24;
the oracle is run by hand against the Python repository when a shared builder
changes, and its record lives next to the corpus gate record in the
repository.
