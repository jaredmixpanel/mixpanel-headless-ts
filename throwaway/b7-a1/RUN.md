# B7-A1 — R10.9 throwaway harness RUN record

Throwaway. The B7 gate (`b7-packets.md` §4.6) deletes `throwaway/b7-a1/`;
this record is mirrored into `context/phase3/notes/B7-A1-notes.md`
(Python repo), which survives.

## Shape

Auth has NO oracle surface (playbook Risk 7 — no cross-language fuzz
bridge), so the harness is the packet §3.6 posture: A1-local error-branch
enumeration, the login_unified state-machine sweep, the mandatory edge
set, the sentinel-secret redaction sweep folded into EVERY captured
error, and fast-check fuzz over namespace op sequences against an
independent mini-model of config state.

| file                    | role                                                                        |
| ----------------------- | --------------------------------------------------------------------------- |
| `namespace-branches.ts` | §3.6 items 1-4: error branches + state sweep + edge set + secret leak sweep |
| `ops-fuzz.ts`           | §3.6 item 5: ≥500 op sequences vs the independent config mini-model         |

Run:

```
npx vite-node throwaway/b7-a1/namespace-branches.ts
npx vite-node throwaway/b7-a1/ops-fuzz.ts
```

## Counts (2026-08-16)

```
namespace-branches: checks 352  failures 0  captured-errors 72
ops-fuzz: sequences 600 (>=500 budget)  ops 3676  divergences 0  seed 20260818
```

## Row groups (namespace-branches)

| group                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | rows |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| §3.6 item 1 error branches: unknown account ×6 (show/update/remove/use/login/token), duplicate add (`ACCOUNT_EXISTS`), `derive_name` ParamTypeError twins ×2, region-null refusals, derive-for-browser, derive missing SA/OT credentials, type-incompatible update, login-on-SA, remove-referenced (`ACCOUNT_IN_USE`) + force-remove orphans + active-cleared, unknown target, target-with-deleted-account, `session.use` WS1 guard, E-2 region mismatch + no-tokens-persisted, `login_unified` flag matrix ×4 (`INVALID_ARGUMENT` violations), missing env credentials ×2, relogin E-3/E-4, E-6 `PROJECT_NOT_FOUND`, E-8 no-picker, stale `MP_PROJECT_ID` | ~90  |
| every `UNPORTED_AUTH_SEAM` default (35 members incl. all six env getters + `env.get` + `readSecretStdin` + `persistActive`), `details.seam` asserted; `narrate` no-op; `UNPORTED_AUTH_SEAMS` names committed                                                                                                                                                                                                                                                                                                                                                                                                                                               | 37   |
| the ONE remaining unported path through REAL seams: `use({persist: true})` with the B8-absent `persistActive` → `UNPORTED_AUTH_SEAM`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 2    |
| §3.6 item 2 state-machine sweep: detect ×3 (env-SA / env-OT / browser) × region explicit/probed(us→eu ladder; browser never probes) × project explicit/picked/single/none = 24 runs × 4-6 asserts (region / active / meCache / project / picker-called / tokens-written) + relogin arms (SA secret rotation, OT env-ref mode preservation + E-5 narration, browser re-PKCE fresh tokens)                                                                                                                                                                                                                                                                   | ~130 |
| §3.6 item 3 edge set: `""`/`"𝒳"`(NFKD compat → "x", CPython-verified)/`"🎉"`/`"18.0"` through slugify + `defaultAccountName` fallback; account names 1/64/65-char + `""` + astral; workspace `18.0` → 18, `1.5` → coded reject; empty project reject                                                                                                                                                                                                                                                                                                                                                                                                       | ~15  |
| §3.6 item 4 secret sweep: sentinel `ZZ-SENTINEL-SECRET-99` seeded through SA secrets / OT bearers / PKCE tokens across every branch above; 72 captured errors × (message + `toDict()` JSON) sentinel-free                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 144  |

## ops-fuzz model

Independent ~50-line mini-model of ConfigManager state
(accounts+default_project / [active] / targets) replaying
addAccount(first-promote) / useAccount(workspace-clear) /
removeAccount(referenced guard + active-clear) / addTarget /
removeTarget / useTarget(wholesale [active] replace + default_project
write) / session.use(workspace|project). Per-op outcome parity +
post-sequence full-state comparison + invariants (dangling-active,
target atomicity). Zero divergences (zero-divergence table: empty).
