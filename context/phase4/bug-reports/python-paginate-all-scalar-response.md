# Python bug: `paginate_all()` silently yields empty on scalar top-level JSON

**Status**: OPEN — queued as R10.7 fix-queue item (e) (`context/phase4/inbound-ledger.md` row 2 addendum)
**Filed**: 2026-08-17, from PR #206 review (copilot-pull-request-reviewer inline thread at `src/mixpanel_headless/_internal/pagination.py:260`), verified against the branch source and ruled "fix post-merge" by the user.
**Severity**: minor (malformed-response handling; no known live trigger)

## The bug

In `_internal/pagination.py::paginate_all`, the extracted-results branch handles
`dict` (with a `results` list check that raises `INVALID_RESPONSE` on non-list
values) and `list` (treated as the results directly). A **scalar top-level JSON
body** (`"foo"`, `42`, `true` — and bare `null`) falls through both
`isinstance` branches:

- `results` stays `[]` → nothing is yielded;
- `pagination` lookup guards on `isinstance(data, dict)` → `next_cursor = None` → loop breaks.

Net effect: a malformed API response silently completes as an empty iteration.
This is inconsistent with the function's own posture three lines up, where a
dict body carrying a scalar `results` raises
`MixpanelHeadlessError(code="INVALID_RESPONSE")` with the comment "corrupt
output dressed up as success." A scalar at the top level is the same corruption
one level higher.

## The fix (Python-first, per R10.7)

Add an `else` arm raising `MixpanelHeadlessError(code="INVALID_RESPONSE")`
for non-dict/non-list top-level JSON, mirroring the message/details shape of
the adjacent `results`-type raise. Red-first test in the pagination unit suite
(scalar string / number / boolean / null bodies).

## Why deferred (not fixed in PR #206)

PR #206 (`fix/latent-bugs-stress-test`) is the base of the reviewed, frozen
port stack (#206 → #207 → #208). The current silent behavior is mirrored
bug-compatibly by the TS twin (B4 `paginateAll`) and pinned by the corpus at
`700db996`. Fixing it in-stack would force a merge-forward + re-record +
re-pin + TS-twin cycle across three open PRs mid-review. User ruling
(2026-08-17): fix post-merge via the standing choreography instead.

## Re-pin choreography when fixed

Same as items (a)–(d) (ledger row 2): Python fix + red-first test on a
post-merge branch → re-record (the new test adds ≥1 wire vector; drift check
must show only that delta) → re-pin → TS twin flip in the same change
(remove the silent-empty mirror in `packages/core/src/client/pagination.ts`
region, flip its regression locks) → differential regression re-run
(`paginate` family) → corpus N+Δ / 0 / 0 both languages.
