# @mixpanel-headless/core

Isomorphic core of Mixpanel Headless: the `Workspace` facade, query
builders, result models and the coded error hierarchy, with zero Node
dependencies. Verified against the Python `mixpanel_headless` conformance
corpus.

```ts
import { Workspace } from "@mixpanel-headless/core";
```

Node users want `@mixpanel-headless/node` (config files, env, OAuth login);
browser users want `@mixpanel-headless/browser`. See the repository README.

The `./internal` subpath is not semver-stable; it exists for the platform
packages and the verification rig.

Published as `"private": true` until the release process lands; flipping
that flag is the owner's one-line change.
