# mixpanel-headless-ts

TypeScript port of [`mixpanel_headless`](../mixpanel-headless) — Phase 1
verification-rig scaffold.

Spec of record: `context/phase1/design/phase1-design.md` in the Python repo
(sections D11–D15 define this repo; D16 defines the commit plan). The repo is
local-only in Phase 1: no remote, no publishing.

## Layout (npm workspaces)

| Workspace            | Purpose                                                         |
| -------------------- | --------------------------------------------------------------- |
| `packages/core`      | Isomorphic core — zero Node deps (R9.1, lint + bundle enforced) |
| `packages/node`      | Node-specific surface (config files, OAuth callback, env)       |
| `packages/browser`   | Browser-specific surface (CredentialStore, redirect PKCE)       |
| `conformance-runner` | Replays the Python-extracted conformance corpus (D12)           |
| `differential`       | oracle-ts JSON-RPC bridge (D14) + referee harnesses (D15a)      |

## Development

Node >= 20 required.

```bash
npm ci          # install (lockfile-exact)
npm run check   # typecheck (per package) + eslint + prettier --check
                # + vitest run + core browser-bundle smoke
```

`npm run check` is the repo gate; `.github/workflows/ci.yml` runs the same
commands once a remote exists.
