---
"@mixpanel-headless/core": patch
"@mixpanel-headless/browser": patch
---

Stop sending `User-Agent` from the browser package: it is a Fetch forbidden
request header, and Safari forwards it into the CORS preflight, where Mixpanel
rejects it and every bearer-authenticated call fails. `MixpanelClientOptions`
gains `getUserAgent` (`UserAgentSource`; `null` omits the header) — Node keeps
sending the library value.
