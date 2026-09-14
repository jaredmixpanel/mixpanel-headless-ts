# Phase-4 inbound ledger — the SINGLE collection point Phase-4 planning reads

**Status**: v1.0 · 2026-08-16 · Written by the B9 gate (task B9-GATE, Phase-3
TERMINAL gate) per `context/phase3/design/b9-packets.md` §5.5 (as amended by
the §10 errata) and the gate dispatch. Every row was re-verified against its
source of record before writing (the mechanical sweep covered every
`context/phase3/notes/B*-notes.md` outbound section — B0–B4 gate notes carry
none; B5's outbound ledger was closed at B6, B7's at B8, B8's at B9, each
closure audited by the successor gate — plus the B9 shard/spike notes and all
four B9 review resolutions).

Ground state Phase 4 inherits: TypeScript repo `main`, full conformance
corpus **3,251 PASS / 0 FAIL / 0 UNPORTED** @ corpus pin `70c904dc`
(terminal gate report `context/phase3/reports/2026-08-16-b9-gate.json`);
Python repo branch `ts-port/phase2-contract-support`; oracle surface 55
families, differential regression clean at 10 seeds (fresh + all nine prior
gate seeds); Phase-3 summary block in `context/phase3/notes/B9-notes.md`.

> **GROUND-STATE UPDATE (2026-08-17, R10.7 four-bug batch gate)**: after the
> rows-1/2 fix batch below, the corpus is **3,262 PASS / 0 FAIL / 0 UNPORTED**
> @ pin `700db996cc952e02aa5a23db1f3c68a3e7251b5b` in BOTH languages (Python
> branch `ts-port/python-bugfix-batch`, TS `main`). The 3,251 @ `70c904dc`
> figures above are the historical Phase-3 close-out state. Gate record:
> `context/phase4/notes/bugfix-batch-gate.md`.

## 1. O1 — OAuth error details carry the full 200 token payload (ESCALATED to the R10.7 fix queue)

RE-SCOPED at B9 (packet §10 erratum 5 — the original `flow.ts:898` citation
is stale post-hoist): core `packages/core/src/auth/oauth-http.ts`
`postTokenRequest` missing-required-fields branch (`oauth-http.ts:245`
region) puts `response_data` — the FULL 200 token payload, potentially
including an `access_token` — into refresh/exchange error details. This is
verbatim `flow.py:596-605` parity (Python does the same), shared by node
refresh AND browser exchange. Pair-B FB-3 escalated it from "re-examine" to
the **R10.7 Python-first fix queue** — it is item (d) of row 2. Bug report:
`context/phase3/bug-reports/python-oauth-error-details-token-payload.md`.
README/JSDoc caveats landed at B9 (TS `de08f1f`). Sources:
`b8-reviewB-resolution.md` O1 → `b9-reviewB-resolution.md` FB-3 →
`b9-packets.md` §10.5.

**STATUS: FIXED (2026-08-16/17, R10.7 batch — row 2 item (d))**. Python
`flow.py` `_post_token_request` now redacts token-bearing values (FIX-2
`57c5e16`), hardened by both arbiters: ARB-A `20c7d6b` (non-dict-200 record
guard) and ARB-B `db8a33e` (allowlist redaction — only primitive
`token_type`/`expires_in`/`scope`/`error`/`error_description` values render;
non-JSON 200 bodies never embedded; non-object 200 bodies render a fixed
placeholder). TS twin retired same-change per R10.7: `2b72ce1` (TS-FOLLOW)
+ `b7152da` (ARB-A twin locks) + `da68958` (ARB-B twin); browser README /
JSDoc caveats rewritten to the closed-channel wording (scrub-before-telemetry
advice retained for non-200 IdP error bodies, which remain embedded by
design). R10.9 spot-harness 17/0 (TS-FOLLOW notes step 6).

## 2. The R10.7 Python-fix queue (Python-first fix → re-record → re-pin → TS follows)

NONE fixed during Phase 3 by design (R10.7 bug-compatibility: TS ports the
buggy behavior verbatim until Python fixes land). Queue:

| # | Bug | Source of record |
|---|---|---|
| (a) | Frequency-filter clause shape (the 2 standing referee-(b) deep REJECTs — true positives, disclosed since Phase 1) | `context/phase1/addendum/frequency-filter-probe.md` |
| (b) | `dataGroupId` int-vs-string threading (the pinned expected-and-disclosed referee-(a) REJECT set) | `context/phase3/bug-reports/mixpanel-headless-datagroupid-int-clause.md` |
| (c) | `_handle_response` 403 `TypeError` on truthy non-dict/non-str JSON bodies | `context/phase3/bug-reports/python-handle-response-403-typeerror.md` |
| (d) | OAuth error details carry the full 200 token payload (row 1 above) | `context/phase3/bug-reports/python-oauth-error-details-token-payload.md` |

**Re-pin choreography per fix (playbook P3-7 trigger 3, normative)**: fix on
the Python support branch → re-record/re-extract the affected vectors →
re-pin the corpus (`scripts/sync-corpus.sh` re-sync + D8/D9 drift check —
UNAFFECTED vectors must be byte-identical, only stamps move) → re-run the
P3-0 vector-count measurement and update expectations → TS follows (remove
the bug-compat twin, tests + vectors flip to the fixed behavior in the same
change) → referee re-runs where the fix touches bookmark payloads ((a) and
(b) retire the standing disclosed REJECT sets — after them, both referees
must run fully clean). Batch the four fixes into as few re-pin events as
practical; each re-pin re-establishes 3,251+Δ / 0 / 0 before burn-in nights
count.

**STATUS: ALL FOUR FIXED (2026-08-16/17) — queue EMPTY.** Executed as ONE
batch / ONE re-pin event on Python branch `ts-port/python-bugfix-batch`
(stacked on `ts-port/phase2-contract-support` @ c2a25c5), Python-first,
strict red-first TDD throughout:

| # | Bug | Python fix commit | TS twin retirement |
|---|---|---|---|
| (a) | Frequency-filter clause shape | `bddc576` (FIX-1) | `2b72ce1` (same-change flip) |
| (b) | dataGroupId int-vs-string (clause + interior cohort + sections `globalDataGroupId`) | `bddc576` (FIX-1) | `2b72ce1` |
| (c) | 403 sniff TypeError on truthy non-dict/non-str bodies | `57c5e16` (FIX-2) | `2b72ce1` |
| (d) | OAuth error-details token payload (row 1) | `57c5e16` (FIX-2) + ARB-A `20c7d6b` + ARB-B `db8a33e` hardening | `2b72ce1` + `b7152da` + `da68958` |

Re-pin executed once: corpus re-extracted @ new pin
`700db996cc952e02aa5a23db1f3c68a3e7251b5b` (RE-PIN commit `a1d43a5`; D8/D9
drift accounting CLEAN — 20 disclosed modified + 11 added + 0 removed +
0 unexplained; totals 3,251 → **3,262**). Both languages hold
**3,262 / 0 / 0** at the pin. Both referees now run **FULLY CLEAN**: the 2
standing referee-(b) deep frequency-filter REJECTs and the 5 pinned
referee-(a) ajv dataGroupId disclosures are RETIRED (disclosure pins
deleted, no allowlists kept — any future REJECT is a NEW finding). Gate
record + review convergence: `context/phase4/notes/bugfix-batch-gate.md`;
per-fix notes `bugfix-batch-notes.md`, arbiter resolutions
`bugfix-reviewA-resolution.md` / `bugfix-reviewB-resolution.md`.
Burn-in expectation from here: **3,262 / 0 / 0 @ 700db996**.

**ADDENDUM 2026-08-17 — item (e) OPEN (queue no longer empty).** PR #206
review (Copilot inline thread, verified real) found `paginate_all()` silently
yields an empty iteration on scalar top-level JSON bodies — inconsistent with
the adjacent `results`-must-be-a-list `INVALID_RESPONSE` raise. User ruling:
fix **post-merge** via the standing choreography (the TS twin mirrors the
silent behavior bug-compatibly; an in-stack fix would force a mid-review
merge-forward + re-pin across all three open PRs). Report:
`context/phase4/bug-reports/python-paginate-all-scalar-response.md`.

| # | Bug | Source of record |
|---|---|---|
| (e) | `paginate_all()` silent-empty on scalar top-level JSON (`pagination.py:260` region) | `context/phase4/bug-reports/python-paginate-all-scalar-response.md` |

**ADDENDUM 2026-08-17d — first-real-CI shakeout: RESOLVED (corpus now
3,264 @ `af999c9`).** The stack's first genuine GitHub Actions runs
surfaced three latent issues, all fixed same-day: (1) `mkdocs build
--strict` failed on 5 griffe warnings from coding-pass Raises
docstrings with under-indented continuation lines (fixed on #207,
`b13dbad` — `just check` never ran mkdocs, a real superset-claim gap);
(2) the conformance CI job ran Python 3.12 while the manifest records
its extraction interpreter 3.14.6, guaranteeing D8 manifest drift — the
job now reads its interpreter pin FROM the manifest (`jq` + `uv python
pin`, self-synchronizing); (3) the drift check correctly demanded the 2
ARB refresh-path vectors queued for "the next re-pin event" — that
re-pin executed on #208 (`9ea3790`): corpus **3,262 → 3,264**, stamps →
`af999c9` (2026-08-17), TS re-synced and green at **3,264/0/0**
(`e052119`; sync-corpus now sources the api-map from this repo's
`context/`, its post-relocation home). Bonus: a live Hypothesis flake
(`list_contains` kwargs collision on a generated key named `property`)
fixed by excluding the three reserved parameter names from the strategy
(`af999c9`). This SUPERSEDES the provenance concern in 2026-08-17c —
the pin is post-restack and branch-reachable again. Residual: #206's
outage-killed CodeQL analysis can't be re-run via API (default-setup
restriction); re-trigger from the UI or let the next push/merge heal
it — #207's composite "CodeQL" check failure is derived (missing base
analysis) and clears with it.

**ADDENDUM 2026-08-21 — PR #215 follow (row 2a below): corpus now
3,272 @ `390c6e7f`.** Re-pinned `af999c9` → `390c6e7fe794…` (Python
`main` squash `6f26131`, +8 schema-graph/timeout vectors; manifest
3,044 → 3,052; runner total incl. authored/enums 3,264 → 3,272). Both
languages green at the pin. The pin was BELIEVED to name a branch-reachable `main` commit —
WRONG, corrected 2026-09-03: `390c6e7f` was the pre-squash tip of the
PR #215 branch (`main` holds the squash `6f26131`); see row 2b's
provenance repair.

**ADDENDUM 2026-08-17c — corpus-pin provenance after the stack restack.**
GitHub's Stacked-PR rebase (user-initiated; completed locally after the
GitHub outage broke the built-in flow) rewrote the #207/#208 branch
history onto the #206 review commit `3c9e265`: new tips #207 `c3dfeaf`,
#208 `26d9d27`; **zero conflicts** (old-vs-new tip diff = exactly the
12-line docstring insertion). Consequence: the corpus pin
`700db996cc95…` now names a PRE-rebase commit no longer on any branch
(content identical at rebased SHA `7219fdb`; old tips kept as local tags
`pre-restack-207`/`pre-restack-208`). Nothing breaks mechanically —
stamps are injected strings, so the Python D8 drift check and the TS
snapshot replay are content-based and stay green — but provenance
resolution of the pin SHA requires the tags/reflog until the **next
re-pin event** (item (e) fix, post-merge), which refreshes stamps to a
then-current SHA per the standing choreography. Expect further SHA churn
at every future restack (e.g. when #206 merges); same posture applies.

**ADDENDUM 2026-08-17b — first live QA pass (pre-burn-in evidence + follow-ups).**
An independent Claude session ran the full mixpanelyst/dashboard-expert
workflow live through the TS packages (OAuth account, project 3). Headline:
**every live failure reproduced byte-for-byte in Python** — the first
real-world cross-language parity evidence ahead of Layer-4 burn-in. Three
port gaps found and FIXED same-day (all red-first, corpus HELD 3,262/0/0):
core barrel now exports `Workspace` (+ A1-deferral barrel lock in
`index.test.ts`), `createNodeWorkspace()` added as the Python `Workspace()`
zero-config twin (README recipes updated), and `PropertyInput` gained the
Python-dataclass eager missing-`name` `TypeError`. Follow-ups:

- **Burn-in probe candidates** (both languages fail identically; determine
  server-vs-library fault): behavioral `createCohort` → 500;
  `deleteBookmark` → 500 while `bulkDeleteBookmarks` succeeds (suspicious —
  possible library-side endpoint/params bug, frequency-filter-style);
  `schemaGraph`/Lexicon 500/timeout.
- **Known/expected, document**: `streamEvents` under an OAuth bearer →
  "must pass API secret" (Export API is secret-auth + Node-only per the D2
  spike table); `listBookmarks*` timeout on multi-thousand-bookmark
  projects; dashboard delete cascades inline-created bookmarks but NOT
  `createBookmark` ones (verified live — orphan probe).
- **TS-side sweep candidate**: eager required-field `TypeError` guards
  across the other dataclass-twin constructors (PropertyInput is the
  pattern; untyped-JS callers otherwise crash lazily in compat helpers).
- **Phase-5 skills note**: the three README translation rules held live
  (camelCase methods, snake_case option keys, `toRows()` for `.df`); add a
  fourth — TS constructors take a single fields object where Python
  accepts positionals.

## 2a. Inbound divergence — Python PR #215 `schema_graph` timeouts (query-API per-event gather + server-deadline timeouts)

**OPENED AND CLOSED 2026-08-21.** Python PR #215 (squash `6f26131` on
`main`, "fix: schema_graph timeouts on large projects") moved ahead of
the port: (A) the schema-graph edge gather left the App API's
`includeEvents=true` join (server-killed at ~120 s on large projects)
for a new query-API client method `list_per_event_properties()`
(`GET /api/query/data_definitions/events?fetch_per_event_properties=true`,
sent under the EXPORT timeout, inverted client-side event→properties ⇒
property→events); (B) route-aware default timeouts sized to outlast the
server deadlines (`DEFAULT_APP_TIMEOUT_S` 135.0 / `DEFAULT_QUERY_TIMEOUT_S`
503.0 = deadline + 15 s margin; explicit constructor timeout always wins;
constructor type widened to `float | None`), including the
`pagination.py` guard (`client._default_timeout(url)`, never the raw —
now nullable — client timeout); (C) corpus re-pin +8 vectors.

**CLOSED via the standing choreography, strict order held:**

- **Re-pin first**: corpus `af999c9` → `390c6e7fe79485d3844c75af78fb5fe90142af68`
  (manifest 3,044 → **3,052**, extraction 2026-08-21; runner total incl.
  authored/enums 3,264 → **3,272**). Delta exactly the 8 disclosed
  vectors (entities/test_api_client +2, entities/test_schema_graph +3,
  pagination/test_pagination +1, segmentation/test_api_client +2), all
  other bundles stamp-only. TS commit `6fe206d`.
- **Red state recorded**: 3,269/3,272 — 3 `FAIL_ERROR` on the
  `api_client.list_per_event_properties` vectors (unbound api). The 5
  timeout-routing vectors passed PRE-port: the extraction rig does not
  record `request.extensions["timeout"]` into wire vectors (timeout is
  not vector-observable — `wire-auth.ts` header), so their wire shapes
  were already identical. **R10.9 honesty note**: the
  explicit-wins / null / 135-503 byte-parity is therefore enforced by
  the transport-capture twin suite
  (`packages/core/test/client/server-deadline.test.ts`, a
  `createRequestExecutor` wrap — the `extensions["timeout"]["read"]`
  analog), not by the corpus.
- **Port red-first** (TS commit `7c7d776`): twins written and observed
  failing (12 red), then `listPerEventProperties` (query-host path,
  results-envelope unwrap, export timeout), the discovery-service
  per-event gather + `invertPerEventProperties`, route-aware
  `_default_timeout` on `ClientCore` (constants live in `url.ts` beside
  `ENDPOINTS`), threaded through `executeWithRetry` / `appRequest` /
  `paginateAll` / both lookup-table raw-transport sites. api-map row
  auto-generated (regular snake→camel, no naming exception).
- **Green**: corpus **3,272 / 0 FAIL / 0 UNPORTED** @ `390c6e7f`; full
  `npm run check` green (10,016 tests, browser smoke OK).
- **Gate**: fresh seed **879279927** + replay of the ENTIRE bugfix-gate
  11-seed set — see `differential/oracle/RUN.md` (this repo) for the
  per-seed table; referee (a) ajv 9/9 green, 0 REJECT.

**Sanctioned deviations / no-op notes (all pre-existing shapes):**

1. `uploadToSignedUrl` — Python swapped `self._timeout` →
   `self._default_timeout(url)` on its fresh `httpx.Client`; the TS twin
   deliberately carries NO timeout clock on that fresh-fetch path
   (`lookup-tables.ts` fresh-request semantics), so the swap is
   unobservable in the port. Unchanged.
2. Python's `_ensure_client` pool-level timeout fallback
   (`DEFAULT_QUERY_TIMEOUT_S` when unset) has no TS twin — the
   `HttpHandle` pool token has no timeout concept and EVERY TS request
   site passes a per-request timeout, which is exactly the guarantee
   Python's own comment claims for the fallback ("unreachable").
3. `tests/pbt/test_schema_graph_pbt.py` had no TS twin before this
   change (Phase-3 B5 scope: covered by the unit twins) and still has
   none; its mock-shape change is reflected in the updated
   `schema-graph.test.ts` stubs.
4. `invertPerEventProperties`: a truthy NON-list `properties` value
   (e.g. a number) yields no edges in TS where Python would raise a raw
   `TypeError` (non-iterable). Dict/string values yield no edges in
   BOTH. Outside the wire contract (the recorded shape is a list);
   documented at the code site.

## 2b. Inbound feature — Python PR #223 report links (045: create / resolve / run Mixpanel report links)

**OPENED AND CLOSED 2026-09-03.** Python PR #223 (squash `c9991d1` on
`main`, "feat(report-links): create, resolve, and run Mixpanel report
links (045)") moved ahead of the port with a whole feature: (A) a pure
`_internal/report_links.py` module (URL grammar parser `parse_report_link`,
builders `build_slug_url` / `build_bookmark_url`, `generate_slug`, the
host/app/hash tables); (B) three new client methods —
`create_bookmark_url` / `get_bookmark_url` (project-scoped
`/bookmark-urls/` slug records, 404 → `REPORT_LINK_SLUG_NOT_FOUND`) and
`resolve_short_link` (one authenticated GET with `follow_redirects=False`,
`Location` header OR the 200 `window.location.href` script, `/login`
targets → `AuthenticationError`, its own 429 backoff loop); (C) kw-only
`workspace_id` / `inject_workspace_id` on `insights_query` /
`arb_funnels_query`, threaded through the four inline `LiveQueryService`
methods; (D) four `Workspace` members — `create_report_link`,
`resolve_report_link`, `query_report_link`, `saved_report_link`; (E) six
new exception classes under `ReportLinkError`, six new `RL1..RL6`
`ParamValidationError` guard codes, the `ReportLinkType` literal, the
`BookmarkUrl` Pydantic model, and the `ReportLink` / `ResolvedReport`
dataclasses; (F) a CLI surface (`mp reports ...`, `mp query --link`) that
has no TS twin by standing posture (the port ships no CLI).

**CLOSED via the standing choreography, strict order held:**

- **Corpus re-sync first** (TS commit: this change). The Python
  `main` manifest at `c9991d1` STILL stamps `source_commit
  390c6e7fe79485d3844c75af78fb5fe90142af68` — the PR's extraction did
  not move the stamp — so the TS pin is UNCHANGED and `sync-corpus`
  accepted the copy from the clean `main` working tree @ `c9991d1`.
  Provenance note: the pin therefore names the commit BEFORE the
  vectors it now pins were added; content-addressed drift checks are
  unaffected, but the next Python extraction should re-stamp
  (`manifest.source_commit` → a `main` SHA ≥ `c9991d1`). Delta:
  manifest 3,052 → **3,120** (+68: bookmarks +30, entities +30, flows
  +2, funnels +5, retention +1); runner total incl. authored/enums
  3,272 → **3,340**. Contract artifacts regenerated Python-side @
  `4504f3e3`: error-codes 28 → 34 classes / 120 → 126 registry codes,
  literal-aliases 37 → 38 (`ReportLinkType`), model-coverage 125 → 126
  (`BookmarkUrl`, authored-fixture row → `authored-fixtures.test.ts`).
  `errors-codes.gen.ts` + `api-map.gen.ts` regenerated (api-map +4
  rows, all mechanical snake→camel, no naming exception: the newly
  indexed `arb_funnels_query`, `create_bookmark_url`, `get_bookmark_url`,
  `resolve_short_link`; `insights_query` gains the two kwonly names).
- **Red state recorded**: **3,289 / 3,340** — 47 `FAIL_ERROR` (the
  four unbound api names) + 4 `FAIL_REQUEST` (`insights_query` vectors
  carrying `workspace_id` / `inject_workspace_id`; the binding dropped
  them). The 10 `workspace.build_params` report-link seam vectors and
  the 6 `build_{funnel,flow,retention}_params` ones passed PRE-port
  (pure builder seam hits, shapes unchanged).
- **Port**: `packages/core/src/report-links.ts` (+ `compat/urllib.ts`:
  CPython `urlsplit` / `urljoin` / `urlunsplit` / `.hostname` twins —
  the WHATWG `URL` class re-serializes and is not a substitute),
  `types/report-links.ts` (`ReportLink`, `ResolvedReport`,
  `ReportLinkQueryResult`), `types/entities/bookmarks.ts` (`BookmarkUrl`),
  `types/literals.ts` (`ReportLinkType`), `errors.ts` (six classes,
  `new.target` default-code pattern), `services/entities/bookmark-urls.ts`
  (`createBookmarkUrl` / `getBookmarkUrl` over B0 `appRequest`;
  `resolveShortLink` over the raw `RequestExecutor` — already
  `redirect: "manual"` per R2.11 — with the backoff trio),
  `services/queries/query-host.ts` (`InlineQueryOptions`),
  `services/live-query.ts` (`InlineQueryScope`, always forwards both
  keywords like Python), `workspace.ts` (the four members + the
  `generateSlug` constructor seam replacing Python's `@patch`), runner
  bindings in `wire-queries.ts` / `wire-entities.ts`.
- **Green**: corpus **3,340 / 0 FAIL / 0 UNPORTED** @ `390c6e7f` (content
  `c9991d1`); browser-bundle smoke OK (the CSPRNG slug minter uses
  `globalThis.crypto.getRandomValues`, no Node import).
- **Gate**: fresh seed **906568853**, 55 families, **28,091 examples /
  0 skips / 0 divergences** (no new oracle families — the Python PR
  added none); referee (a) ajv green incl. the 10 new
  `workspace.build_params` report-link payloads (feed count 115 → 125),
  0 REJECT. Record: `differential/oracle/RUN.md`.
- **Twins**: Python `tests/unit/test_report_links.py`,
  `test_report_links_pbt.py`, `test_api_client_bookmark_urls.py`,
  `test_query_workspace_scoping.py` (the two new classes),
  `test_live_query_workspace.py`, `test_workspace_report_links.py`,
  `test_exceptions_report_links.py`, `test_types_report_links.py` →
  `packages/core/test/report-links{,.pbt}.test.ts`,
  `client/client-bookmark-urls.test.ts`,
  `client/client-inline-query-scope.test.ts`,
  `services/live-query-workspace.test.ts`,
  `workspace/workspace-report-links.test.ts`,
  `errors-report-links.test.ts`, `types/report-links.test.ts`.
  Twin census: 150 + 18 (parser + fast-check PBT), 45 + 7 + 15
  (client, inline-query scope, live-query passthrough), 103 (workspace),
  45 + 19 (exceptions, types) — 402 tests. Translation posture per
  R5.4 (message text → class/code/details), `@patch(generate_slug)` →
  the `generateSlug` constructor seam, `MagicMock(spec=...)` → local
  stub clients, `caplog` → the injected logger. ONE real gap the
  twins found and this change fixed: `BookmarkUrl.params` accepted a
  non-dict (Python's `dict[str, Any]` rejects it) — the entity
  field-spec vocabulary has no bare dict guard, so the check lives in
  the model's `afterValidate` hook (also covers `overrides`). ONE
  documented skip, a STANDING posture rather than a new gap: Python's
  `BookmarkUrl` is `frozen=True`, the TS `EntityModel` base never
  `Object.freeze`s (compile-time `readonly` only) — true of every
  entity model in the port since Phase 2.

**Sanctioned deviations / no-op notes:**

1. **Browser `resolveShortLink` 3xx**: a browser `fetch` with
   `redirect: "manual"` yields an opaque-redirect response (status 0,
   no headers), so header-redirect shortlinks resolve only on
   Node/undici and read as `SHORT_LINK_UNEXPECTED_RESPONSE` (status 0)
   in a browser; the 200-with-script form works everywhere. Documented
   at the module header and in the README; no code twin possible.
2. **`urljoin` `;params`**: CPython's `urlparse` splits `;params` off
   the last path segment before joining; the TS twin keeps `;` in the
   path. Unobservable for Mixpanel targets (never carry path params).
3. **`urlsplit` bracketed-host validation** uses a local IPv6/IPvFuture
   validator instead of `ipaddress.ip_address`; both reject
   `https://[::1/...` (unbalanced) as `REPORT_LINK_UNPARSEABLE`, both
   accept `[::1]` as a non-Mixpanel host.
4. **Ids > 2^53** in parsed paths/hashes go through `Number(...)` where
   CPython keeps the exact int — the standing discrepancy #6/#7 class
   (row 3 / row 6); live project/bookmark ids are far below the band.
5. **No CLI twin** for `mp reports create|resolve|run|link` and
   `mp query --link` (standing posture: the TS port ships no CLI; the
   library members are the public surface, README recipe added).
6. **Message text** (incl. the `hint` strings, which ARE asserted by
   vectors through `details_contain`) copied verbatim; other message
   text out of contract per R5.4.
7. **Informational**: oracle-py reports `library_version 0.2.1` while
   Python `main` is at 0.2.2; irrelevant to the run (the harness
   compares `source_commit`, and both bridges agree) — noted so nobody
   reads it as a bridge mismatch.

**Follow-ups (not blocking):** `parse_report_link` / `build_*_url` are
ideal differential-fuzz families (pure, total, cross-language) — propose
`report_link_parse_family` / `report_link_build_family` on the Python
oracle side when the next oracle-surface change lands; and ask Python to
re-stamp `manifest.source_commit` at the next extraction (see the
provenance note above).

**ADDENDUM 2026-09-03 — provenance repaired, pin moved to `c9991d1`.**
Investigating the stamp lag showed the problem was systemic, not a
PR-#223 one-off: NO stamp in the Python corpus was reachable from
`main` (`390c6e7f` = pre-squash PR #215 branch tip; the contract
`generated_from` `4504f3e3` = a pre-implementation "[Spec Kit] Add
tasks" commit on the PR #223 branch; the authored bundles' `52696743` /
`b5c1369` likewise pre-squash). The CI drift check re-injects the
manifest's own stamp, so it could never notice. Python PR #224 (squash
`1c29b97`) re-extracted with `--mp-record-commit=c9991d1…` (7,647
record-run tests, 165 stamp-only diffs, contract `generated_from` →
`c9991d1…`, D8 drift CLEAN), added `conformance/record/check_stamps.py`
+ a CI step (rule 1: every extracted/contract stamp must be an
ancestor of `origin/main` and equal the manifest; rule 2: in-scope
vector content may not move without the manifest stamp moving — the
exact PR #223 failure mode; authored bundles allow-listed by name),
and documented the two-step protocol (library PR first, then a re-pin
PR stamped with the library PR's squash SHA) in
`conformance/record/README.md` "Which SHA to stamp". TS follow: pin
`390c6e7f` → **`c9991d1eed03fec1830b6e460091724b9263b8aa`**,
`sync:corpus` re-run (169 stamp-only diffs: 164 bundle headers +
manifest + 4 contract artifacts, 0 content lines), `errors-codes.gen.ts`
regenerated for the new `generated_from`, api-map byte-identical.
Burn-in expectation from here: **3,340 / 0 / 0 @ c9991d1**, both
bridges reporting `c9991d1…`. Row 2a's "branch-reachable" claim is
corrected in place above.

## 2c. Inbound re-pin — Python PRs #225 / #235 / #236 (corpus `c9991d1` → `0dde506`, TS twin of #236)

**2026-09-14.** Python PR #237 (squash `4438a1c`) re-pinned the corpus to
the library squash `0dde50608a6af026e94cdb75bacbcebe5ce105db` (two-step
protocol, step 2). Three library PRs had landed on Python `main` since
the `c9991d1` pin:

| Python PR | Change | Corpus footprint | TS disposition |
|---|---|---|---|
| #225 (`b61b94c`) | `limit=` on `query*` + new `run_*_params` methods | +5 bundles of builder seam hits (`test_query_limit` ×3 → `workspace.build_params` ×2 / `build_funnel_params` / `build_retention_params`; `test_run_flow_user_params` ×2 → `build_flow_params` ×8 / `build_user_params` ×4) — all hit UNCHANGED builders | **OPEN — feature port not started.** The seam hits pass against the existing builders; `limit` / `run_*_params` are not corpus-locked. Linear AIE-924 (child of AIE-908). |
| #235 (`c93b00c`) | `MP_API_BASE_URL` / `MP_APP_BASE_URL` route every API family at one alternate host; region probe collapses to one region | +2 bundles (`test_api_base_url_override` discovery ×3 / engage ×1) — the 4 override-UNSET tests; the 31 override-SET nodeids are in the new `env_base_url_override` exclusion bucket (no TS manifest schema validates bucket names, so nothing to add here) | **PORTED — branch `feat/api-base-url-override` (PR #10, AIE-925).** Split per R9.1: `packages/core` takes an injected `MixpanelClientOptions.endpointOverrides` (a static `{apiBaseUrl, appBaseUrl}` bag or a per-call provider) and routes every `ENDPOINTS` read through `endpointsFor(region, overrides)` + longest-prefix `apiFamilyFor(url, endpoints)` (App-vs-Query timeout, `WORKSPACE_SCOPED_FAMILIES` `workspace_id` injection, `core.buildUrl`, `appRequest`); the region probe takes the single-region order / override narration / path-prefix-preserving `probeBaseUrl` from the same bag, falling back to its existing `getEnv` seam (`MP_API_BASE_URL` / `MP_APP_BASE_URL` / `MP_REGION`) exactly where Python reads `os.environ`; `packages/node` wires `createNodeEndpointOverrides()` (a `process.env` reader consulted on EVERY request — Python's per-request semantics preserved, not construction-time) into `createNodeWorkspace()`, and the `/me` clients in `accounts-ops` read it through `effects.env.get`. Browser: config-only via `clientOptions.endpointOverrides` (the Export-API CORS guard still keys on the LIVE export origins). Tests: 66 new vitest cases — `api-base-url-override.test.ts` (32, the 10 non-CLI Python classes), `api-base-url-override.pbt.test.ts` (4 fast-check properties, the `_pbt.py` twin), `region-probe-override.test.ts` (21: the 11 `TestRegionProbeUnderApiBaseUrlOverride` cases × getEnv/injected arms + docstring examples), `packages/node/test/endpoint-overrides.test.ts` (9, env resolution + `createNodeWorkspace` inheritance). `TestCliInheritsOverride` has no TS twin (no CLI). Conformance unchanged at 3,453/0/0 (unset ⇒ byte-identical live hosts). |
| #236 (`0dde506`) | `Filter.__post_init__` validates `_operator` on direct construction, normalizes the 25 factory-name aliases + `"is equal to"`, collapses boolean `equals`/`does not equal` + bool to `true`/`false`, rejects value-bearing `true`/`false`; `_filter_unchecked` for the codec | +93 `filters` vectors (`test_query_types` +88 incl. `TestFilterDirectConstruction`'s LC1-after-normalization case; `test_segfilter` +8/−2), and ONE pre-existing body change: `test_is_equal_to_number` now records `_operator: "equals"`. The 50 plain-`ValueError` construction cases are `uncoded_raise`-excluded (contract still pins 126 codes). | **PORTED this change (Linear AIE-923).** `Filter` constructor (`packages/core/src/types/query-params/filter.ts`) runs the `__post_init__` sequence in Python source order; `FilterOperatorInput` literal added to `literals.ts`; `FILTER_OPERATOR_ALIASES` typed `Record<Exclude<FilterOperatorInput, FilterOperator>, FilterOperator>` so the compiler holds table and literal in lockstep; `filterUnchecked()` is the `_filter_unchecked` twin and the contract codec (`vector-codecs.ts`) rehydrates `$type: Filter` through it (the SG1/SG2/SG3 + ES13 vectors carry `magical_unicorn` / `unknown_op` operators the constructor now rejects). Test probes that drove those builder guards through `new Filter(...)` moved to `filterUnchecked` (segfilter, user-builders, query-user ×2), mirroring Python's `make_unchecked_filter`. 82 new direct-construction tests translated from `TestFilterDirectConstruction`. |

**Sync shape**: pin `c9991d1` → `0dde506`; `sync:corpus` from the clean
Python working tree @ `07bfe57` (`main`; 185 bundles, 5 contract
artifacts). 176 corpus paths touched: 7 new bundles, 167 stamp-only
header diffs, 2 content diffs (both `filters/`), manifest (`3,120` →
`3,233` extracted) + 4 contract artifacts (`generated_from` only;
`tag-universe` `Filter` 409 → 501, `InlineCustomProperty` 35 → 36,
`PropertyInput` 45 → 46). Regenerated: `errors-codes.gen.ts` (stamp
only), `bridge-allowlist.gen.json` (pin + digests); api-map
byte-identical (api-index unchanged — the override tests are excluded).
Referee-(a) feed now carries 127 `workspace.build_params` payloads (125 +
the 2 `test_query_limit` seam hits; `bookmark-referee-feed.test.ts`
count updated).

**Gate**: corpus **3,453 / 0 / 0 @ `0dde506`** (3,340 before; +113 =
+93 filters, +5 #225 seam bundles' 16 vectors, +4 override-unset, ...),
`npm run check` green, referee (a) 0 REJECT. Differential fuzz: fresh
seed **403581649**, 55 families, **28,091 examples / 0 skips / 0
divergences**, both bridges reporting `source_commit 0dde506…` (RUN.md
2026-09-14 entry). Burn-in expectation from here: **3,453 / 0 / 0 @
0dde506**.

## 3. The JsonNumber facade round-trip gap

In the LIBRARY result path a >2^53 integer token collapses at
`JsonNumber.toNumber()` before any consumer sees it (TS imprecise/±Infinity
where CPython keeps the exact int) — the sanctioned Discrepancy #6/#7 class,
disclosed at `B6-notes.md:190` region (the `pythonFloatCoerce` domain notes).
Re-examine if Phase-4 burn-in ever sees live event counts or ids beyond
2^53. A code fix would require a `JsonNumber`-preserving (or bigint) result
surface — a public-API decision, not a port-fidelity one. Sources:
`B6-notes.md:190`; playbook discrepancies #6/#7.

## 4. Live-parity Layer-4 setup (plan §6 Phase 4 / Layer 4 — the burn-in gate)

- **Corpus + fuzz nightly**: full corpus replay (BOTH languages), fresh-seed
  differential fuzz (≥500/family over the 55 families), referee checks;
  **≥4 consecutive green nights**; failure clusters → upstream fixes →
  regenerate → reset the counter (plan "Phase 4 — Burn-in").
- **Live suite**: parameterize the 503 live-test scenarios; run against a
  dedicated demo project from BOTH implementations nightly;
  **rate-limit-aware: the 60 q/hr per-project budget requires sharding
  across nights or across projects**; responses cached and diffed after
  canonicalization (plan "Layer 4" — the anti-ScanCode layer).
- **Live-auth scenarios with no Phase-3 oracle** (playbook Risk 7
  compensating control): real IdP refresh, real browser login (callback
  server + paste fallback), real DCR, and the **browser PKCE e2e triple**
  (`b9-packets.md` §4.5 / `B9-spike.md` §4): (1) authorize-time
  `redirect_uri_allowed` enforcement for the registered third-party URI;
  (2) the consent screen issuing a code to that redirect; (3) a
  browser-origin `token/` POST succeeding cross-origin (token-endpoint CORS
  was never probed).
- **Implementer cautions carried forward**: `/api/app/me` is minutes-slow
  live — never on an interactive path (plan §4.3 note); one observed
  HTTP/2 flake against `/api/app`.

## 5. Sanctioned TOCTOU residue of the R9.2 fd-hardening drop

`packages/node/src/io-utils.ts` header documents the residual
symlink-swap window left by dropping Python's fd-flag hardening (R9.2
sanctioned drop; symlink refusal kept). Re-examine only if burn-in surfaces
a practical exploit path. Source: `B8-notes.md` Phase-4 ledger line 2 +
`B8-N1-notes.md`.

## 6. Standing discrepancy-class re-examine triggers

Playbook discrepancy log, classes with live-observability triggers:
**#6/#7** (>2^53 Retry-After / `safeInt` — re-examine on a live >2^53
header or count), **#11** (gmtime overflow band OSError-vs-ValueError —
live timestamp in the band), **#12** (integral-float spelling narrowing —
a wire body where the spelling is contract), **#14** (`\d` ASCII narrowing
at the B8 bridge `project` twins — a live Nd-digit bridge artifact),
**#15** (config default path import-time vs call-time — a scenario
depending on the frozen path). Plus the **#9/#10 residual-site
HUMAN-CALL** (order-insensitive comparison for integer-like-key emission
ordering) — still open, OPTIONAL, non-blocking (#13 was CLOSED-FIXED at B8
by user ratification; the remaining #9/#10 mechanism sites are unaffected).

## 7. D2 spike posture + residue

**CLASSIFICATION: ACCEPTED** (2026-08-16, `B9-spike.md` — budget: creds
1/1, DCR 1/2, Query-API 0/2). DCR accepts third-party https redirect URIs;
**Tier C ships PKCE-in-browser ENABLED** alongside first-class
`oauth_token`. Docs carry the ARB-A-corrected wording ("…consent/exchange
**to be verified** in Phase-4 live burn-in") — never a completed-e2e claim.
Residue for Phase 4:

- Registered client residue: `client_id
  ClI8BeFoFjq1Vn1SbdpiufvxvRvCwAbFtaMaXRvo` (redirect
  `https://spike-b9.example.com/oauth/callback`, no management fields
  returned) — **clean up if a DCR management API ever exists**; the client
  is public-metadata-only and unusable without the unverified consent path.
- Regional posture (eu/in) ASSUMED uniform — only us was probed; verify
  opportunistically during burn-in DCR scenarios.
- Free signal (recorded, NOT evidence about `token/`): the DCR endpoint
  answered a third-party `Origin` with `access-control-allow-origin: *`.
- The e2e triple itself is row 4's browser-PKCE scenario.

## 8. Browser refresh surface (deferred out of v1 — now on the D2-ACCEPTED branch)

`refreshTokens`-over-`CredentialStore` (Python twin `flow.py:442-498`, TS
core `postTokenRequest` already hoisted and shared) deferred out of browser
v1 (`b9-packets.md` §2.2/§3.4 disposition). Precondition: the row-4/row-7
browser-PKCE e2e lands green in burn-in. Until then browser sessions
re-login on expiry (`createBrowserWorkspaceFromStore` refuses
expired-with-no-refresh with `OAUTH_TOKEN_ERROR`).

## 9. Packaging + awareness items (accumulated, non-blocking)

- **`exports` asymmetry** (B9-ARB-A ASR-O4, LEAVE-AS-IS ruling):
  `packages/browser/package.json` carries `"exports"`, core/node carry
  none; functionally inert today (all cross-package imports are relative).
  Phase-4/5 packaging (entry-point maps, types conditions, ESM
  conditional exports per plan Phase 5) starts from this known asymmetry.
- **Arbiter judgment-call defaults, trivially adjustable** (B9-ARB-B,
  flagged for awareness, not decision): `completeLogin` pending-record TTL
  default 30 min (`DEFAULT_MAX_PENDING_AGE_MS`); `beginLogin` redirectUri
  gate allows http on loopback per RFC 8252 §7.3.
- **Cross-tab `completeLogin` races are a documented non-goal** (FB-6
  disposition: same-realm in-flight dedup only; no atomic ops exist on the
  3-method `CredentialStore` interface). Re-examine if a real multi-tab
  consumer workflow needs it.
- **`repros/` state**: exactly the two RESOLVED P2-9 triage records —
  historical, non-blocking.
- **SA-refusal path table** now has 7 enumerated rows (packet §2.3 + §10.1
  paths 6–7); if Phase 4 surfaces a third gate-bypass shape, pair-B's
  arbiter recommends promoting the browser guard into a core seam rather
  than extending the wrapper (`b9-reviewB-resolution.md`).
