#!/usr/bin/env bash
# B3-K2 R10.9 harness runner. Re-runs everything from the recorded seeds.
#
#   bash throwaway/b3-k2/run.sh              # recorded seed sweep
#   bash throwaway/b3-k2/run.sh 4242 600     # one seed / N examples per family
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
  N="${2:-600}"
else
  SEEDS=(20260815 4242 99991 20260816 7)
  N=600
fi

for seed in "${SEEDS[@]}"; do
  echo "== seed $seed (>=${N}/family over 12 families) =="
  $PY "$HERE/gen-cases.py" "$seed" "$N" "$HERE/cases.json"
  node "$HERE/harness.mjs" replay "$HERE/cases.json"
done
