---
"@mixpanel-headless/browser": minor
---

Add `loginInPopup` and `relayPopupReturn`: a popup transport for the PKCE
login so a page embedded in another site (Mixpanel's authorize page sends
`frame-ancestors 'none'`, so a framed page cannot redirect) can sign in from a
top-level window that posts only the return URL back to its opener. Same
`beginLogin` / `completeLogin` protocol; new codes `BROWSER_POPUP_BLOCKED` and
`BROWSER_POPUP_CLOSED`, a timeout of `DEFAULT_POPUP_TIMEOUT_MS` as
`OAUTH_TIMEOUT`, and the `PopupHost` seam for tests.
