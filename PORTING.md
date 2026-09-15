# Porting notes

How this TypeScript port relates to the Python `mixpanel_headless` library it
mirrors: the revision it tracks, the naming rules, every known behavioural
divergence, and what the verification rig does and does not prove. Process
history (why a decision was taken, by whom, when) lives in
[`docs/history/`](docs/history/README.md); this file is the living record.

## Pinned Python revision

| What                                                                | Value                                                                                                                                   |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Corpus pin (`conformance-runner/corpus.config.json` `sourceCommit`) | `0dde50608a6af026e94cdb75bacbcebe5ce105db` — Python `main`, 2026-09-11, "fix(types): validate Filter operator on direct construction …" |
| Python `__version__` at the pin                                     | `0.2.2` (`pyproject.toml` declares `dynamic = ["version"]`; the value lives in `src/mixpanel_headless/__init__.py`)                     |
| Python `requires-python`                                            | `>= 3.10`; the compat tables and canonical fixtures were generated with **CPython 3.14.6 / Unicode 16.0.0** (recorded in their headers) |
| Corpus record epoch (frozen clock)                                  | `2026-01-15T12:00:00Z`                                                                                                                  |
| Python `main` at the time of writing                                | `07bfe57` (2026-09-14, "Bump version to 0.2.3") — two commits past the pin: the version bump and the Python-side corpus re-pin          |
| TS package versions                                                 | `@mixpanel-headless/{core,node,browser}` `0.1.0`, private                                                                               |

Python-side changes that arrive after the pin are absorbed by re-pinning the
corpus (procedure in [`CONTRIBUTING.md`](CONTRIBUTING.md#refreshing-the-corpus))
and porting the change; the two features from Python PRs #225 (`limit=` /
`run_*_params`) and #235 (`MP_API_BASE_URL` / `MP_APP_BASE_URL` overrides) are
ported but not corpus-locked (their Python tests do not go through the
extraction seams).

## Naming

Python `snake_case` methods and static builders become `camelCase`
(`ws.query_funnel` → `ws.queryFunnel`, `Filter.starts_with` →
`Filter.startsWith`); keyword arguments become one options object whose keys
**stay `snake_case`** when they mirror Python keywords or wire fields
(`{ math: "dau", last: 90 }`, entity-model fields, bookmark params, error
`details`); constructor/config option bags are `camelCase`. The rule and its
enforcement are described in the README's "Naming" section.
<!-- TODO(final-pass): the README "Naming" section is being written by the naming-convention lane; confirm the anchor once it lands. -->

The Python→TS name of every corpus entry point is resolved through the
generated `conformance-runner/src/api-map.gen.ts`; exceptions to the
mechanical transform live in `conformance-runner/src/naming-exceptions.json`
and the generator fails on any name with no rule (no fuzzy matching).

## Known behavioural divergences

Contract for all of these: error **class and code** are contract, error
message text is not; integers are contract up to ±(2^53 − 1). Each item names
the TypeScript symbol that carries it. Divergences introduced deliberately are
marked `// Divergence:` at the site.

### Numbers beyond 2^53 (by design)

- CPython ints are arbitrary precision; the port returns JS `number` and
  rejects anything beyond ±(2^53 − 1) with `PY_INT_UNSAFE_INTEGER` —
  `pythonInt` (`compat/python-int.ts`).
- A `Retry-After` header beyond 2^53 − 1 reads as absent (`retry_after: null`);
  CPython parses it, sleeps the capped 60 s and reports it — `retryWaitSeconds`
  (`client/backoff.ts`).
- Workspace `id` tokens beyond 2^53 − 1 read as unusable (`null`); Python
  returns the exact big int — `metadataWorkspaceId` (`client/me.ts`).
- `safeInt` on a numeric string beyond 2^53 − 1 returns the default; Python
  parses it — `safeInt` (`types/results/query-engine.ts`).
- Pydantic's Python-object lax mode accepts `True → 1` for int/float fields;
  the port (like pydantic's JSON mode) rejects booleans — `coerceInt` /
  `coerceFloat` (`coerce.ts`).

### Integer-like object keys (JS hoists them to the front)

- Iterating `SchemaGraphResult.event_to_properties` / `property_to_events`
  lists integer-like event/property names first; Python keeps insertion order.
  `toGraph()` rebuilds its order from `events` / `properties` and is
  unaffected — `SchemaGraphResult` (`types/results/discovery.ts`, `TODO(port)`).
- Pydantic error emission order flips for integer-like unknown chart-type keys
  and for `extra="forbid"` violations on integer-like keys; unreachable
  because `S4_UNKNOWN_CHART_TYPE` filters such keys first — `validateModel`
  (`bookmarks/schema-sorting.ts`).
- Closed: the "first organization" pick from `/me` now matches Python even
  when organizations arrive out of id order, because `MeResponse.organizations`
  is an insertion-ordered `ReadonlyMap` from the lossless JSON layer
  (`accounts/naming.ts`).

### Error class or message only

- `MP_PROJECT_ID` is gated by `/^\p{Nd}+$/u`; Python's `str.isdigit()` also
  accepts `Numeric_Type=Digit` codepoints (e.g. `"²"`) and then rejects them at
  `Project(id=…)`. Same `ConfigError` / `CONFIG_ERROR`, different message —
  `resolveProjectAxis` (`auth/resolver.ts`).
- `{"computed_at": null}` in schema-audit metadata: Python leaks a bare
  `pydantic.ValidationError`; the port raises `ResponseValidationError` /
  `RESPONSE_VALIDATION_ERROR` — `listSchemaRegistry` and siblings
  (`workspace-members/schemas-audit.ts`).
- Additive hardening: non-positive-integer entity ids are rejected up front
  with Python's own `RL6_INVALID_ID`; Python would send
  `/annotations/[object Object]/` and surface the server's 404 —
  `requireEntityId` (`workspace-members/shared.ts`).
- A non-object schema response body raises a JS `TypeError` where Python
  raises `AttributeError` — `dictGet` (`services/entities/schemas.ts`,
  `TODO(port)`).
- Timestamps beyond `datetime.max` raise `ValueError` everywhere in TS;
  CPython raises `OSError` (errno 84) across most of that span (platform
  dependent) and `OverflowError` past 2^63. Both sides always raise —
  `fromTimestampUtcIso` (`query/transforms.ts`, `TODO(port)`).
- When a retry-from window cannot be computed, Python raises `OverflowError`
  from date subtraction; the port re-throws the original error. Out of reach
  for real values — `createQueryHostMethods` (`services/queries/query-host.ts`).
- The `ConfigError` raised when an account swap resolves no project has a
  shorter, static message; Python's enumerates four config-dependent fixes.
  Same class and code — `noProjectError` (`workspace-members/lifecycle.ts`,
  `TODO(port)`).
- Closed in favour of bug-compatibility: `x in frozenset` with a list/dict
  raises `TypeError` in Python; the port raises at the same sixteen sites —
  `requireHashable` (`query/validation-shared.ts`).
- Out-of-annotation scalars (a value that violates a validator's declared
  type): CPython raises, the port returns. Unspecified by the contract.

### Clocks, timeouts and IO seams

- httpx timeouts are per-read; `fetch` has none, so the port arms one wall
  clock for headers plus a buffered body. Streaming bodies are not
  clock-bounded after headers — `rawFetch` / `RawFetchResult.stopTimeout`
  (`client/transport.ts`); the same shape for replay CDN fetches —
  `CDN_TIMEOUT_SECONDS` (`services/replays.ts`).
- The lookup-upload poll deadline rides `Date.now()` by default; Python uses
  `time.monotonic()`. Node may inject a monotonic source —
  `LookupUploadSeams.monotonic` (`workspace-members/governance-data.ts`).
- Default date windows ("today", "last N days") are computed in UTC from the
  injected clock; Python reads the host's local calendar. They can differ by
  one day near local midnight — `services/queries/py-dates.ts` (`TODO(port)`).
- After `Workspace.close()`, Python's recreated httpx client forgets a runtime
  `set_workspace_id()` pin and re-applies the initial one; the port keeps the
  current pin — `Workspace.close` (`workspace.ts`).
- No inline `ConfigManager()` / bridge defaults in core: the caller passes
  `ResolverSources`; `@mixpanel-headless/node` supplies Python's defaults —
  `resolveSession` (`auth/resolver.ts`).
- `Workspace` logging is an injected seam with a no-op default
  (`NOOP_LOGGER`, `workspace-members/options.ts`); Python's default
  `logging.lastResort` prints WARNING and above to stderr. So that
  `fetch_replays`' per-replay failure isolation is never silent, the skipped
  replays are also recorded on the result — `ReplayBundle.failures`
  (`types/results/replays.ts`), a TS-only additive getter that `toJSON()` and
  the conformance codec never see (Python only logs them; the precedent is the
  parallel user query's `failed_pages` meta).
- Replay `$time` parsing accepts ISO-8601 (and unix seconds) only; Python's
  `pd.Timestamp` also accepts free-form dates. Anything else yields `0`
  ("skip row") — `toUnixMs` (`services/replays.ts`, `TODO(port)`).
- A `/me` organization with `name: null` crashes Python with
  `AttributeError`; the port sorts it as an empty name —
  `resolveProjectForLogin` (`accounts/login-unified.ts`, `TODO(port)`).

### Node file system and OAuth callback (`@mixpanel-headless/node`)

- Python's `O_NOFOLLOW` / `O_CLOEXEC` / dirfd-walk + fstat-pinned invariant
  layer is replaced by `lstat` symlink refusal plus `stat` regular-file /
  mode / size checks. Caller-visible refusals are preserved; a TOCTOU window
  between probe and read is the accepted deviation, and tmp-file naming
  differs — `io-utils.ts`, `auth/storage.ts` (`OAuthStorage`).
- `// Divergence:` Python chmods the config file's parent to `0o700` on every
  write whatever the path; the port tightens only the default `~/.mp` and
  leaves a custom `configPath` / `MP_CONFIG_PATH` parent alone —
  `ConfigManager` (`config.ts`). _Upstream candidate: the Python behaviour
  chmods unrelated directories such as a repo `config/` or `/tmp`._
- The default config path is captured at import time in Python and at
  `ConfigManager` construction in TS, so a mid-process `HOME` change is
  followed only by TS (with `MP_CONFIG_PATH` unset) — `ConfigManager`
  (`config.ts`).
- `// Divergence:` on an OAuth `state` mismatch Python puts `expected_state`
  in `OAuthError.details`; the port keeps only `received_state` so logged
  errors never carry the nonce — `startCallbackServer`
  (`auth/callback-server.ts`).
- `// Divergence:` Python's callback handler consumes the one-shot on a GET to
  any path; the port answers 404 to non-`/callback` GETs (port probes, a
  stray tab) and keeps waiting — `startCallbackServer`
  (`auth/callback-server.ts`). Non-GET stray requests still consume it, as in
  Python.
- `startCallbackServer({ port: 0 })` reports the ephemeral port actually
  bound; Python reports the requested `0` — `startCallbackServer`
  (`auth/callback-server.ts`). _Upstream candidate: `callback_server.py`
  returns `bound_port = port`._
- Token-endpoint bodies are parsed with the lossless parser's Python-constants
  superset (`NaN` / `Infinity` tokens accepted, as `response.json()` would) —
  `auth/flow.ts`.
- The browser launcher on Windows uses `rundll32 url.dll,FileProtocolHandler`
  instead of `start` (which needs a shell) — `browserLaunchArgv`
  (`auth/flow.ts`).

### Wire and encoding

- A UTF-8 BOM is kept, matching Python's `utf-8` codec; a BOM-only JSONL line
  is yielded, not skipped; undecodable bytes become U+FFFD like
  `errors="replace"` — `iterJsonlLines` (`client/jsonl.ts`).
- The `paginate*` helpers exist for parity but are wired into no client
  method, use literal `Authorization`-only headers and their own unjittered
  429 loop — exactly like Python's `pagination.py`, which the client equally
  does not use (`client/pagination.ts`). Numeric `next_cursor` values are
  re-spelled with CPython float repr; only string cursors are ever observed —
  `cursorParamValue` (`TODO(port)`).
- JS `$` does not match before a trailing `\n`, so `"2025-04-23\n"` is
  rejected one step earlier than in Python; both classify it `"string"` —
  `DATE_PATTERN` (`services/discovery.ts`).
- Non-string dict keys are stringified with `json.dumps` spelling (`true`,
  `18.0`, `null`); Python keeps typed keys until serialization. Reachable
  only through a `dict(iterable-of-pairs)` branch no Mixpanel response
  produces — `dictKeyText` (`query/transforms.ts`, `TODO(port)`).
- Pydantic-shaped `type` / `msg` strings for validation errors other than
  `missing` are transcribed, not vector-verified — `client/response-validation.ts`
  header (`TODO(port)`).
- Pydantic / CPython `\d` matches Unicode `Nd`; the JS `/^\d+$/` gates
  (`ProjectId` pattern, `Project.id`, the bridge project pin, the
  `\d{4}-\d{2}-\d{2}` date gates) are ASCII-only.
- Anywhere a float-typed value is interpolated into library output text,
  the port spells it with `pythonFloatStr` so `18.0` stays `18.0`
  (`compat/python-float-str.ts`); a new interpolation site that forgets this
  regresses to `18`.
- Blankness and stripping use the CPython whitespace table (`pythonStrip`),
  not JS `trim()` — U+001C..U+001F and U+0085 are whitespace to Python,
  U+FEFF is not (`compat/python-strip.ts`, `validateEventName`).

### Browser (`@mixpanel-headless/browser`)

- No refresh-token grant: an expired stored token raises `OAuthError` /
  `OAUTH_TOKEN_ERROR` asking for a fresh login. Python and
  `@mixpanel-headless/node` refresh — `client.ts` (`TODO(port)`).
- Header-redirect shortlinks resolve only on Node: browser `fetch` with
  `redirect: "manual"` returns an opaque redirect with no `Location` —
  `services/entities/bookmark-urls.ts`.
- Service-account (Basic) credentials are refused at runtime with
  `BROWSER_SERVICE_ACCOUNT_REFUSED`, and Export-API hosts with
  `BROWSER_EXPORT_UNSUPPORTED` (they serve no CORS headers); Python has no
  such guard.

### Runtime immutability

- Python `BookmarkUrl` is `model_config(frozen=True)`; `EntityModel` never
  calls `Object.freeze`, so every entity instance is mutable at runtime and
  read-only only at the type level — `EntityModel`
  (`types/entities/model-base.ts`); the Python `test_frozen` assertion is
  recorded as `it.todo` in `test/types/report-links.test.ts`.

### A JS-only hazard the port had and fixed

- `obj["__proto__"] = v` on a plain object sets its prototype instead of
  storing a key, so a response property literally named `__proto__` was
  silently dropped where Python's dict keeps it. All dict-building writes now
  go through `setOwn` (`compat/python-dict.ts`), which defines an own property
  for that key. Python was never affected; the note stays because a new
  `record[key] = value` site regresses it.

### Not observable at runtime

- Four result classes whose Python `.df` is not the uniform rows pattern
  expose `toRows()` variants instead (`types/results/live-query.ts`,
  `query-engine.ts`).
- `ReplayBundle.sample(n, seed)` reproduces CPython's `random.Random(seed)`
  (full MT19937 parity, `compat/python-random.ts`) precisely so there is no
  divergence to list.
- Printability for `repr()` uses a generated CPython 3.14.6 / Unicode 16.0
  table rather than the host engine's Unicode version (`compat/non-printable.ts`).

<!-- lane 5A -->

### Facade layer (lane 5A additions)

- `requireInt64Id` (`workspace-members/shared.ts`) is the `data_group_id`
  twin of the additive `requireEntityId` guard above: it accepts a non-zero
  `number | bigint` of either sign and rejects a `number` beyond
  ±(2^53 − 1) as already rounded, with the same `RL6_INVALID_ID`; Python
  sends whatever it is given.
- Sites that now carry a `// Divergence:` marker for entries already
  listed above: `Workspace.close` (`workspace.ts`, the workspace-id pin);
  `noProjectError` (`workspace-members/lifecycle.ts` — its `TODO(port)` is
  gone, so that entry's `TODO(port)` parenthetical is stale);
  `auditResponseFrom` (`workspace-members/schemas-audit.ts` — the
  `{"computed_at": null}` entry's trigger is the audit metadata, so
  `runAudit` / `auditResponseFrom` name it more precisely than
  `listSchemaRegistry`); `requireEntityId` (`workspace-members/shared.ts`).

<!-- /lane 5A -->

<!-- lane 5C -->

### Added by the comment pass over types, query, bookmarks, compat, replays and errors

- `InvalidArgumentError` constructed with a `violation` outside the three
  documented values: Python raises a bare `ValueError`; the port raises
  `ParamValidationError` / `VALIDATION_ERROR` (the site has no registry code)
  — `InvalidArgumentError` (`errors.ts`).
- A `dict(iterable-of-pairs)` whose pair carries a non-string key (int,
  float, bool, `None`) stores it under its JSON spelling (`"18.0"`,
  `"true"`, `"null"`); Python keeps the typed key. Only reachable through the
  pair-list branch of `dict(properties)`, which no Mixpanel response produces
  — `dictKeyText` (`query/transforms.ts`).
- `ReplayBundle.failures` is TS-only: Python's `fetch_replays` only logs
  skipped replay ids (`logger.warning`); the port records `{replay_id, error}`
  on a prototype getter so a partial bundle is never silently short. It is
  not an own property, so `toJSON()` and the codec still see the Python shape
  — `ReplayBundle.failures` (`types/results/replays.ts`).
- Corrections to entries above (sites now carry `// Divergence:` markers):
  the `SchemaGraphResult` integer-key bullet no longer has a `TODO(port)`
  (`types/results/discovery.ts`), and `safeInt` now lives in
  `types/results/flow-graph.ts`, not `query-engine.ts`.

<!-- lane 5B (client, services, accounts, auth): merge each bullet into the section named in parentheses -->

### Lane 5B additions

- (Error class or message only) `session.use({ target, … })` combined with
  any axis option raises `ParamValidationError` /
  `WS1_TARGET_MUTUALLY_EXCLUSIVE`; Python raises a bare `ValueError` —
  `createSessionNamespace` (`accounts/session-namespace.ts`) and
  `resolveSession` (`auth/resolver.ts`).
- (Error class or message only) `ReplaysService.discover` / `eventsFor` on a
  service constructed without a `queryFn` raise `MixpanelHeadlessError` /
  `REPLAYS_QUERY_FN_REQUIRED`; Python raises a bare `RuntimeError` —
  `ReplaysService` (`services/replays.ts`).
- (Error class or message only) The "account directory already exists"
  `ConfigError` in the browser login flow names the account; Python prints
  the directory path (the in-memory staging seam has no path). Same class
  and code — `loginUnifiedNewBrowser` (`accounts/login-unified.ts`).
- (Wire and encoding) `slugify` NFKD-normalizes with the host engine's
  Unicode tables; CPython 3.14.6 pins Unicode 16.0. A name containing a
  codepoint whose compatibility decomposition differs between the two may
  slug differently — `slugify` (`accounts/naming.ts`).

Corrections to existing bullets, for the final pass to apply in place:

- "A non-object schema response body raises a JS `TypeError`…": the TS
  symbol is `resultDictGet` (`services/entities/schemas.ts`), not `dictGet`.
- "A `Retry-After` header beyond 2^53 − 1 reads as absent": the behaviour
  lives in `parseRetryAfter` (`client/backoff.ts`), not `retryWaitSeconds`.
- "Pydantic / CPython `\d` matches Unicode `Nd`; the JS `/^\d+$/` gates …":
  `Project.id` (`auth/session.ts`) and `default_project` (`auth/account.ts`)
  gate with `/^\p{Nd}+$/u` and are not ASCII-only; the entities `ProjectId`
  pattern (`types/entities/accounts.ts`), the node bridge pin and the date
  gates still are.
- "A `/me` organization with `name: null` crashes Python with
  `AttributeError`; the port sorts it as an empty name": unreachable as
  stated — `MeOrgInfo.name` is a required `str` in both `me.py` and
  `client/me.ts`, so a null name is rejected at parse before any sort.
  Drop the bullet, or restate it as a parse-time error-class difference if
  one is confirmed.
- Every `TODO(port)` in these four directories is now a `// Divergence:`
  marker; the "(`TODO(port)`)" parentheticals on the pagination, schemas,
  py-dates and replays bullets can be dropped.

<!-- lane 5D -->

### Platform site markers (`@mixpanel-headless/node`, `@mixpanel-headless/browser`)

Marker updates and additions from the platform comment pass; the final pass
folds them into the sections above.

- `// Divergence:` markers now sit at every node deviation listed under
  "Node file system and OAuth callback": `defaultConfigPath`
  (`config/blocks.ts`, the `HOME` capture), the tmp-sibling naming of
  `atomicWriteBytes` and the lstat→read window of `readCredentialText`
  (`io-utils.ts`), the `~/.mp` parent chmod scope (`config/manager.ts`) and
  both callback-server entries (`auth/callback-server.ts`).
- New: `OAuthStorage` replaces Python's `_fchmod_no_follow` inode pin with an
  `lstat` probe followed by `chmodSync` by path; the probe→chmod window is
  the same accepted TOCTOU class as the read path — `auth/storage.ts`.
- New (not observable): when the callback server and the pasted-redirect
  reader race during `login`, the loser is cancelled through an
  `AbortSignal`; Python leaves its daemon thread running. The loser's
  outcome is discarded in both runtimes — `OAuthFlow.login` (`auth/flow.ts`).
- Browser: the refresh-grant gap listed under "Browser" is now marked
  `// Divergence:` in `client.ts` (the store-backed token resolver) and in
  the `redirect-flow.ts` module header; that entry's `(TODO(port))` tag is
  stale.

## What the rig proves — and does not

**Corpus** (`conformance-runner/`, replayed by `corpus.test.ts` and
`npm run conformance`). Each vector is a recorded Python call: inputs, the
expected output or error class/code, and for wire vectors the exact HTTP
requests Python made with canned responses. Verdicts
(`conformance-runner/src/runner.ts`): `PASS`; `FAIL_OUTPUT` (value differs
after canonicalization); `FAIL_REQUEST` (the port issued different
method/url/params/headers/body); `FAIL_ERROR` (error class or code differs, or
a batch declared done still has an unbound api); `PRECISION_LOSS` (the only
difference is rounding of integers beyond 2^53); `UNPORTED` (mapped but not
bound — counted, never failing); `UNMAPPED_API` (no api-map row — fail-fast).

**Oracle** (`differential/oracle/`, driven by the Python fuzz harness):
Hypothesis-generated inputs are fed to oracle-py and oracle-ts over a stdio
line protocol and compared through the shared canonicalizer; 55 families.

**Not proven**: anything outside the recorded input domain — error message
text; out-of-annotation inputs; integers beyond 2^53 (canonicalizer policy);
object-key order (the canonicalizer sorts keys, so integer-key hoisting is
invisible); local-clock behaviour (runners freeze a UTC clock); real
network timing, timeouts and retries (injected `sleep` / `now` / `random`
seams); file-system security properties on Node; browser-only behaviour; and
the fuzz domain's documented exclusions (timestamps beyond `datetime.max`,
integer-like unknown keys, big ints), so "0 divergences" is relative to
those.

## Current numbers

| Measure                        | Value                                                                                    | Source                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Conformance corpus @ `0dde506` | **3,453 vectors — 3,453 passed, 0 failed, 0 unported**                                   | `npm run conformance -- --report json`, 2026-09-14; `conformance-runner/GATE.md` |
| Differential oracle            | **28,091 examples / 0 skips / 0 divergences**, seed 403581649, both bridges at `0dde506` | `differential/oracle/RUN.md`, entry dated 2026-09-14                             |
| Bookmark-schema referee (ajv)  | green, 0 rejects over 127 recorded `build_params` payloads                               | same RUN.md entry (`npm run referee:bookmark`)                                   |

<!-- TODO(final-pass): refresh these three rows after the last corpus re-pin or oracle run before the branch merges. -->
