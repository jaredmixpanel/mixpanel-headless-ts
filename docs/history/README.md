# docs/history — the port's process record

This directory is the archived working record of the Python → TypeScript port
of `mixpanel_headless`: the master plan, the porting rulebook, the Python↔TS
API map, and the per-phase design documents, task packets, review resolutions,
probe notes, bug reports and gate reports that the port was executed against.
It was relocated verbatim from the repository root (`context/`) in September
2026; internal cross-references still spell paths as `context/...`.

**It is frozen and not maintained.** Nothing here is updated when the code
changes. The live specification is the code itself together with
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) (conventions, gate, generated files)
and [`PORTING.md`](../../PORTING.md) (pinned Python revision, known
divergences, what the corpus and oracle prove). Current gate-run records live
in [`conformance-runner/GATE.md`](../../conformance-runner/GATE.md) and
[`differential/oracle/RUN.md`](../../differential/oracle/RUN.md).

The repository's 2026-09 cleanup plan, executed on branch `cleanup/2026-09`, is
archived here too: [`cleanup-plan-2026-09.md`](cleanup-plan-2026-09.md).

## Reading order

1. [`typescript-port-plan.md`](typescript-port-plan.md) — the master plan:
   target architecture, the five verification layers and three referees, the
   phase breakdown.
2. [`typescript-port-rulebook.md`](typescript-port-rulebook.md) — the porting
   rules (`R<section>.<n>`), including the semantic-trap watchlist (§8) and the
   platform boundaries (§9).
3. [`phase1/design/phase1-design.md`](phase1/design/phase1-design.md) sections
   **D11–D16** — the design of this repository: scaffold, conformance runner,
   hello-world gate, differential bridges, referee harnesses, branch plan.
4. [`typescript-port-api-map.md`](typescript-port-api-map.md) (and the
   machine-readable [`typescript-port-api-map.json`](typescript-port-api-map.json),
   still read by `scripts/sync-corpus.sh`) — the Python→TS naming map.
5. The phase packets, in order: [`phase2/design/phase2-design.md`](phase2/design/phase2-design.md)
   (contract layer, `P2-n` packets), [`phase3/design/phase3-playbook.md`](phase3/design/phase3-playbook.md)
   plus `phase3/design/b<n>-packets.md` (the module port, batches B0–B9),
   [`phase4/notes/`](phase4/notes/) (the bug-fix batch).
6. [`phase4/inbound-ledger.md`](phase4/inbound-ledger.md) — the running
   ledger of Python-side changes that arrived after the port and how each was
   absorbed (re-pins, feature ports, open items).

Each `phase<n>/` directory also holds `notes/` (per-shard implementation and
probe notes), `bug-reports/` (bugs found in the Python library or Mixpanel's
API while porting), `audit/` / `recon/` (Phase 1 source surveys) and
`reports/` (raw gate outputs).

## Glossary of identifiers

Older commit messages and source comments cite these. They resolve only inside
this archive.

| Identifier                                  | Meaning                                                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R<s>.<n>` (e.g. `R9.1`, `R5.4`, `R10.9`)   | A rule in `typescript-port-rulebook.md`, section `<s>`; `[ST]` marks rules that came out of the Phase 0 stress test. `R9.1` is core purity, `R5.4` "error text is not contract". |
| `D<n>` (e.g. `D6`, `D11–D16`)               | A section of `phase1/design/phase1-design.md`. D11–D16 define this repository; D6 is the canonicalization algorithm.                                                              |
| `TS-<n>`, `PR-<n>`                          | Phase 1 TS-side tasks and the planned pull-request sequence (phase1-design D16/D18).                                                                                              |
| `C<n>`, `P2-<n>`                            | Phase 2 design sections and task packets (`phase2/design/phase2-design.md`, C10 work breakdown).                                                                                  |
| `B<n>`, `B<n>-<X><m>` (e.g. `B6-W2`, `B5-S3`) | Phase 3 port batch `<n>` (B0–B9) and a shard within it; each batch has a `phase3/design/b<n>-packets.md` and per-shard `phase3/notes/B<n>-<X><m>-notes.md`.                      |
| `P3-<n>`                                    | A section of `phase3/design/phase3-playbook.md`.                                                                                                                                  |
| `reviewA` / `reviewB`, `ARB-A` / `ARB-B`, `FB-<n>`, `FID-F<n>` | The two-reviewer + arbiter review cycle run per batch (`b<n>-review*-*.md`); `FB`/`FID` number individual findings.                                                          |
| `<shard>-D<n>` (e.g. `W8-D2`, `S3-D1`)      | A decision or recorded divergence in that shard's notes file.                                                                                                                     |
| `Discrepancy #<n>`                          | An entry in the phase3 playbook's discrepancy log (`phase3-playbook.md` §P3-8); the behavioural ones are restated in `PORTING.md`.                                                |
| `watchlist #<n>`                            | An entry in the rulebook's semantic-trap watchlist (§8).                                                                                                                          |
| ledger row `2a` / `2b` / `2c`, `O1`         | Sections of `phase4/inbound-ledger.md`.                                                                                                                                           |
| `D2 spike`                                  | The browser PKCE feasibility spike (`phase3/design/b9-packets.md` §4, `phase4/inbound-ledger.md` §7) — unrelated to the phase1 `D2`.                                              |
| `AIE-<nnn>`                                 | An issue in the Linear tracker used during the port.                                                                                                                              |
| `heads`, `mixpanel-desktop-app`             | The desktop-app repository whose `docs/specs/heads/` documents are the external spec for the bridge allowlist and bookmark canonicalization.                                      |

The convention going forward (see `CONTRIBUTING.md`, "Comments and
docstrings") is that none of these identifiers appear in new code or commit
messages; Python provenance is given by dotted symbol name only.
