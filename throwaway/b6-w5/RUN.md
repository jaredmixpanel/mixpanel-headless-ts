# B6-W5 — R10.9 throwaway harness RUN record

Throwaway. The B6 gate (`b6-packets.md` §12) deletes `throwaway/b6-w5/`;
this record is mirrored into `context/phase3/notes/B6-W5-notes.md` §3
(Python repo), which survives.

## Shape

W5's 23 members are FACADE delegations over the B4-C4
annotation/webhook/alert wire methods — all-wire, no oracle-callable
surface (§11.5), so there is no `py-side.py` differential half. One
file:

| file            | role                                                         |
| --------------- | ------------------------------------------------------------ |
| `wire-edges.ts` | delegation equivalence + status branches + edge set + errors |

Run:

```
npx vite-node throwaway/b6-w5/wire-edges.ts
```

Deterministic (no RNG, no seed): every case is a hand-built canned
interaction over the injected-fetch seam.

## Counts

```
checks 62   failures 0
```

## Coverage

| group                      | cases                                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (i) delegation equivalence | `list_annotations`, `get_annotation`, `list_annotation_tags`, `list_webhooks`, `test_webhook`, `list_alerts`, `get_alert_count`, `get_alert_history`, `get_alert_screenshot_url`, `test_alert` — facade result === direct client result re-validated through the SAME model seam (10)                                                  |
| (ii) wire status branches  | `create_annotation` 200 / 400 (`QueryError/QUERY_FAILED`); `test_webhook` 200 / 429-exhausted (`RateLimitError/RATE_LIMITED` + retry-count assertion) / 500 (`ServerError/SERVER_ERROR`) (6)                                                                                                                                           |
| (iii) edge set             | `18.0`, `1.5`, `true`, `null`, `[]`, `""`, `"𝒳"` pushed through the alert `condition` dict (7) and the `bookmark_params` dict (7) — the shard's two `dict[str, Any]` param annotations; plus the watchlist-#5 date-string checks on `list_annotations` query params and `CreateAnnotationParams.date` (2)                              |
| (iv) W5-local branches     | the four option-bag `?? null` forwards, each in default + populated arms, incl. the explicit-`false` `skip_user_filter` arm (8); `exclude_none` drop on all nine dumping members (9); `RESPONSE_VALIDATION_ERROR` for eleven malformed-200 shapes (11); the four void members (1 batched check); `test_alert` verbatim passthrough (1) |

## Observations

1. **Zero empty-response guards in the shard.** `workspace.py:6462-7196`
   contains NO `if raw is None: raise MixpanelHeadlessError(...)` — grep
   verified. The shared `requireResponse` helper is therefore
   deliberately NOT used in `annotations-webhooks-alerts.ts`; inventing
   the guard would add a branch Python does not have. (W2/W3/W4 all had
   such guards; W5 is the first shard without any.)
2. **The packet's "more-than-forward bodies" note did not survive
   re-measurement.** §7 Scope predicted composite bodies for
   `test_alert`, `get_alert_screenshot_url` and
   `validate_alerts_for_bookmark`; at HEAD all three are pure forwards
   (`:7118-7119`, `:7146-7149`, `:7179-7183`). All 23 W5 members are
   pure forwards — no conditional query assembly, no multi-step
   orchestration, no decision-payload shaping anywhere in the range.
3. **`ValidateAlertsForBookmarkResponse` accepts `{}`** — both declared
   fields carry defaults (`alert_validations=[]`, `invalid_count=0`), so
   the malformed-200 probe uses a type violation
   (`{"invalid_count": "nope"}`) instead of an empty body.
4. **`test_alert` is the shard's one opaque passthrough** — Python
   returns `client.test_alert(body)` with a `dict[str, Any]` annotation
   and no `validate_response_model` call, so the TS twin returns the
   native-valued record (the W4 `list_erf_experiments` precedent). Its
   single corpus vector expects `{"status": "sent"}` — no float in the
   payload, so the #12 class does not bite here.
5. **`skip_user_filter=false` must not collapse to `None`.** Python
   forwards the raw kwarg and the CLIENT owns the `is not None` gate
   (which sends `"false"`), so the facade uses `?? null`, never a
   truthiness drop (watchlist #6).
