# @mixpanel-headless/node

Node.js surface of Mixpanel Headless: TOML config-file and environment
accounts, OAuth (PKCE) login with a localhost callback, token storage, the
Cowork bridge file, streaming export, and a ready-wired `Workspace`
factory over `@mixpanel-headless/core`.

```ts
import { Workspace, createNodeWorkspace } from "@mixpanel-headless/node";
```

See the repository README for configuration and the auth model.

Published as `"private": true` until the release process lands; flipping
that flag is the owner's one-line change.
