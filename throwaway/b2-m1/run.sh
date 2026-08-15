#!/usr/bin/env bash
# THROWAWAY (R10.9) — derandomised, re-runnable driver for the B2-M1
# (validation.py shard V1a) differential harness. Deleted by the B2
# batch gate after arbiter sign-off (GF6 / B0-1 precedent).
#
# Requires: the Python repo checked out as a sibling at
# ../mixpanel-headless with `uv sync --all-extras` already run (the
# harness spawns `uv run python -m conformance.oracle_py` there).
#
# The review pair replays with the recorded seed below; a fresh seed is
# passed as $1.
set -euo pipefail
cd "$(dirname "$0")/../.."
SEED="${1:-20260815}"
RUNS="${2:-700}"
node throwaway/b2-m1/harness.mjs --seed "$SEED" --runs "$RUNS" \
  >/dev/null 2>throwaway/b2-m1/harness-stderr.log
node -e '
const r = require("./throwaway/b2-m1/report.json");
console.log(JSON.stringify({
  seed: r.seed,
  runs_per_family: r.runs_per_family,
  oracle_info: r.oracle_info,
  edge_compared: r.edge_compared + "/" + r.edge_calls,
  fuzz_compared_per_family: r.fuzz_compared_per_family,
  total_compared: r.total_compared,
  skips: r.skips,
  divergences: r.divergences,
}, null, 2));
process.exit(r.divergences === 0 ? 0 : 1);
'
