# Security policy

## Supported versions

The packages in this repository are pre-1.0. Only the latest published minor
release line receives security fixes; older minors are not patched. Once 1.0
ships, this section will list the supported major lines.

## Reporting a vulnerability

Please do **not** open a public issue for security reports. Use GitHub's
private vulnerability reporting for this repository:

https://github.com/jaredmixpanel/mixpanel-headless-ts/security/advisories/new

Include the affected package (`@mixpanel-headless/core`, `node`, or
`browser`), a minimal reproduction, and the impact you believe it has.

## What to expect

- Acknowledgement within 3 business days.
- An initial assessment (confirmed / not a vulnerability / need more info)
  within 10 business days.
- Confirmed issues are fixed in a new release and disclosed through a GitHub
  Security Advisory that credits the reporter (unless you prefer otherwise).

## Scope

This library handles Mixpanel credentials on the user's machine: it reads and
writes a local config file under `~/.mp`, runs an OAuth loopback (PKCE)
callback flow in Node, and keeps tokens in an injected storage in the browser
build. Reports about credential handling — storage permissions, leakage into
logs or error messages, redirect/state validation in the OAuth flow, token
lifetime handling — are in scope, as are request-forgery or injection issues in
the query and payload builders.

Out of scope: vulnerabilities in the Mixpanel service itself (report those to
Mixpanel), and issues that require an already-compromised local machine.
