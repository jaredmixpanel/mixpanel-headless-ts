#!/usr/bin/env bash
# B4-C2 R10.9 harness runner (deterministic — hand-built branch matrix,
# no fuzz seeds: wire methods have no oracle bridge, P3-2 c).
#
#   bash throwaway/b4-c2/run.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS_ROOT="$(cd "$HERE/../.." && pwd)"

cd "$TS_ROOT"
mkdir -p "$HERE/.build"
npx esbuild "$HERE/harness.ts" --bundle --platform=node --format=esm \
  --outfile="$HERE/.build/harness.mjs" --log-level=error
node "$HERE/.build/harness.mjs"
