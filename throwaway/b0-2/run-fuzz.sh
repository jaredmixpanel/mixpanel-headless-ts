#!/usr/bin/env bash
# B0-2 R10.9 throwaway differential harness driver (P3-2 step c).
#
# Two halves:
#   1. Deterministic wire edge set (every _handle_response / retry /
#      app_request branch) replayed through VectorFetch + the real B0
#      internals: run-edge-harness.mjs (this repo, no bridges).
#   2. Oracle-bridge fuzz for the ONE B0-2 api with an oracle call
#      surface (api_client._iter_jsonl_lines): Hypothesis with
#      derandomize=True (no seed database), so this exact command
#      reproduces the RUN.md counts byte-for-byte. The R10.9 edge set
#      rides as the target's edge_calls in
#      conformance/differential/strategies.py (@example decorators).
set -euo pipefail

PY_REPO="${MP_PYTHON_REPO:-/Users/jaredmcfarland/Developer/mixpanel-headless}"
TS_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

node "${TS_REPO}/throwaway/b0-2/run-edge-harness.mjs"

cd "${PY_REPO}"
uv run python -m conformance.differential.fuzz_harness \
  --right "node ${TS_REPO}/scripts/run-oracle.mjs" \
  --targets jsonl_chunks \
  --examples 500 \
  --report json

uv run python "${TS_REPO}/throwaway/b0-2/probe_apis.py"
