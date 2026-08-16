#!/usr/bin/env bash
# B3-K1 R10.9 harness runner. Re-runs everything from the recorded seeds.
#
#   bash throwaway/b3-k1/run.sh            # default seed sweep
#   bash throwaway/b3-k1/run.sh 4242 600   # one seed / N examples per model
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS_ROOT="$(cd "$HERE/../.." && pwd)"
PY_ROOT="${PY_ROOT:-/Users/jaredmcfarland/Developer/mixpanel-headless}"
PY="uv run --project $PY_ROOT python"

cd "$TS_ROOT"
mkdir -p "$HERE/.build"
npx esbuild "$HERE/entry.ts" --bundle --platform=node --format=esm \
  --outfile="$HERE/.build/entry.mjs" --log-level=error

echo "== enums parity audit (bookmark_enums.py vs enums.ts) =="
$PY "$HERE/dump-enums.py" > "$HERE/enums-py.json"
node "$HERE/harness.mjs" enums > "$HERE/enums-ts.json"
$PY "$HERE/diff-enums.py"

echo
echo "== root-model dispatch probe =="
node "$HERE/harness.mjs" dispatch

echo
echo "== probe-transcript replay (389 recorded CPython cases) =="
$PY "$HERE/dump-cases.py"
node "$HERE/harness.mjs" replay "$HERE/oracle-cases.json" || true

echo
echo "== differential fuzz =="
if [ "$#" -ge 1 ]; then
  SEEDS=("$1")
  N="${2:-600}"
else
  SEEDS=(20260815 4242 99991 20260816 7)
  N=600
fi
for seed in "${SEEDS[@]}"; do
  $PY "$HERE/fuzz-cases.py" "$seed" "$N"
  node "$HERE/harness.mjs" replay "$HERE/fuzz-cases.json"
done
