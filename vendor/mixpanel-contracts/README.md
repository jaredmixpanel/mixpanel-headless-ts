# vendor/mixpanel-contracts

Verbatim byte copies of the machine-readable API contracts from the internal
`analytics` repository (a read-only local checkout; its path is supplied via
`$ANALYTICS_ROOT`, see `scripts/check-vendor-drift.sh`). See `PROVENANCE.json` for the
per-file `sha256` / `source_path` / `vendored_date` manifest and the known
coverage holes (webhooks iron-only, cohorts none, alerts custom-only).

Copy-not-reference: this repo must build without the analytics checkout
mounted. When the checkout IS present, `scripts/check-vendor-drift.sh`
byte-diffs every vendored file against its source and fails with a
"re-vendor" message on drift (phase1-design D15a/D15c).

## Contents

| Artifact | Source | Notes |
| --- | --- | --- |
| `bookmark.json` | `lib/common/mxpnl/report/bookmarks/generated/bookmark.json` | Insights-only bookmark schema (root `InsightsBookmarkParams`). No `$schema` key; requires draft 2020-12 semantics (`prefixItems`, `const`) — validate with ajv `Ajv2020`, `strict: false` (11 nonstandard `tsType` keywords). |
| `openapi.internal.json` | `webapp/app_api/v1/generated/openapi.internal.json` | Mixpanel Platform API 1, OpenAPI 3.1.0, 7 paths only (event/property-definition merge+unmerge, org audit logs, audit-log streams, global token revocation). Does NOT cover dashboards/bookmarks/flags/alerts/replays/webhooks. |
| `webapp/app_api/**/types.d.ts` | same relative paths | 45 schema4api-generated declaration files — the only machine-readable contract for the legacy Django app_api entity-CRUD surface. Regeneration requires Mixpanel's Django env; vendored verbatim. |
| `iron/common/types/schema4api/**` | same relative paths | 10 files: 9 `webapp/**/types.d.ts` mirrors + `admin-permissions.d.ts`. Webhook types live ONLY here (`webapp/project_webhooks/types.d.ts`). |

## Regeneration recipes

### bookmark.ts (ACTIVE — run via `npm run generate`)

`json-schema-to-typescript@15.0.0` (EXACT pin, matching analytics
`package.json`), same flags as analytics `tools/generate_schema.sh`:

```sh
json2ts vendor/mixpanel-contracts/bookmark.json \
  differential/src/generated/reports/bookmark.ts \
  --no-enableConstEnums --no-unknownAny --unreachableDefinitions
```

Output is committed as generated content; CI freshness check is
`npm run generate && git diff --exit-code differential/src/generated/`.

### Platform v1 client (DEFERRED per phase1-design D15c)

Do NOT generate in Phase 1. When a port batch actually needs the 7 Platform-v1
endpoints (data-governance merge/unmerge, audit logs, token revocation):

1. `npm i -D --save-exact @hey-api/openapi-ts@0.99.0` (pin matches analytics
   `package.json:150`).
2. Config mirrors analytics repo-root `openapi-ts.platform.config.cjs`:
   - input: `vendor/mixpanel-contracts/openapi.internal.json`
   - output: `src/generated/platform/v1/`
   - plugins: `@hey-api/typescript` (+ `@hey-api/client-fetch` /
     `@hey-api/sdk` only if a runtime client is wanted; DROP
     `@tanstack/react-query`).
   - postProcess: prettier (analytics also seds `return;` →
     `return undefined;`).
3. Add the same `git diff --exit-code` freshness check over the output dir.

## Re-vendoring

Re-vendoring is a deliberate, diffed act: copy the changed files byte-for-byte
from the analytics checkout, refresh their `sha256`/`vendored_date` entries in
`PROVENANCE.json` (and `file_count`), and commit the vendor refresh separately
from hand-written code.
