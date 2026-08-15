#!/usr/bin/env bash
# B0-1 R10.9 throwaway differential harness driver (P3-2 step c).
#
# Re-runnable by the review pair: the harness runs Hypothesis with
# derandomize=True (no seed database), so this exact command reproduces
# the RUN.md counts and the zero-divergence claim byte-for-byte.
#
# The R10.9 mandatory edge set rides as the six targets' edge_calls in
# conformance/differential/strategies.py (attached as @example decorators,
# so every generated corpus provably contains them).
set -euo pipefail

PY_REPO="${MP_PYTHON_REPO:-/Users/jaredmcfarland/Developer/mixpanel-headless}"
TS_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "${PY_REPO}"
uv run python -m conformance.differential.fuzz_harness \
  --right "node ${TS_REPO}/scripts/run-oracle.mjs" \
  --targets python_int,python_float,python_strip,sorted_strings,cp_length,cp_slice \
  --examples 500 \
  --report json

uv run python "${TS_REPO}/throwaway/b0-1/probe_apis.py"
