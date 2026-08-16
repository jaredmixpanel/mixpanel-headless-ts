#!/usr/bin/env bash
# B3-K4 R10.9 harness runner. Re-runs everything from the recorded seeds.
#
#   bash throwaway/b3-k4/run.sh               # recorded seed sweep
#   bash throwaway/b3-k4/run.sh 4242 1100     # one seed / N draws per selector family
#
# Budget note (packet K4, P3-6): N is the per-family draw count for the TWO
# selector entry points (>= 1,000 mandated — doubled); `extract_cohort_filter`
# and the `_format_value` probe draw N/2 (>= 500).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS_ROOT="$(cd "$HERE/../.." && pwd)"
PY_ROOT="${PY_ROOT:-/Users/jaredmcfarland/Developer/mixpanel-headless}"
PY="uv run --project $PY_ROOT python"

cd "$TS_ROOT"
mkdir -p "$HERE/.build"
npx esbuild "$HERE/entry.ts" --bundle --platform=node --format=esm \
  --outfile="$HERE/.build/entry.mjs" --log-level=error

if [ "$#" -ge 1 ]; then
  SEEDS=("$1")
  N="${2:-1100}"
else
  SEEDS=(20260815 4242 99991 20260816 7)
  N=1100
fi

for seed in "${SEEDS[@]}"; do
  echo "== seed $seed (>=${N}/selector family, >=$((N / 2))/extract) =="
  $PY "$HERE/gen-cases.py" "$seed" "$N" "$HERE/cases.json"
  node "$HERE/harness.mjs" replay "$HERE/cases.json"
done
