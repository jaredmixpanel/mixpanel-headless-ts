#!/usr/bin/env bash
# check-vendor-drift.sh — vendored-contract freshness check.
#
# 1. Always: verify every file listed in vendor/mixpanel-contracts/PROVENANCE.json
#    exists and matches its recorded sha256 (self-integrity of the vendored copy).
# 2. When $ANALYTICS_ROOT points at an analytics checkout: byte-diff each
#    vendored file against its source_path. Any drift fails with a "re-vendor"
#    message. The analytics checkout is read-only: this script only reads
#    from it.
# 3. When $ANALYTICS_ROOT is unset: skip the drift half and exit 0 (the TS
#    repo must build without the checkout mounted). When it is set but does
#    not exist, fail — that is a misconfiguration, not an absent checkout.
#
# Usage:
#   npm run vendor:drift                          # integrity only
#   ANALYTICS_ROOT=/path/to/analytics npm run vendor:drift
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="$REPO_ROOT/vendor/mixpanel-contracts"
PROVENANCE="$VENDOR_DIR/PROVENANCE.json"
ANALYTICS_ROOT="${ANALYTICS_ROOT:-}"

if [[ ! -f "$PROVENANCE" ]]; then
  echo "ERROR: $PROVENANCE not found" >&2
  exit 1
fi

# Emit "path<TAB>source_path<TAB>sha256" per manifest entry.
manifest_rows() {
  node -e '
    const m = require(process.argv[1]);
    for (const f of m.files) {
      process.stdout.write(`${f.path}\t${f.source_path}\t${f.sha256}\n`);
    }
  ' "$PROVENANCE"
}

have_checkout=0
if [[ -z "$ANALYTICS_ROOT" ]]; then
  echo "NOTE: ANALYTICS_ROOT is unset — skipping source drift diff (integrity check only). Set ANALYTICS_ROOT=/path/to/analytics to enable it."
elif [[ -d "$ANALYTICS_ROOT" ]]; then
  have_checkout=1
else
  echo "ERROR: ANALYTICS_ROOT=$ANALYTICS_ROOT is not a directory." >&2
  exit 1
fi

integrity_failures=0
drift_failures=0
checked=0

while IFS=$'\t' read -r rel_path source_path expected_sha; do
  checked=$((checked + 1))
  vendored="$VENDOR_DIR/$rel_path"

  if [[ ! -f "$vendored" ]]; then
    echo "INTEGRITY: missing vendored file: vendor/mixpanel-contracts/$rel_path" >&2
    integrity_failures=$((integrity_failures + 1))
    continue
  fi

  actual_sha="$(shasum -a 256 "$vendored" | cut -d' ' -f1)"
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    echo "INTEGRITY: sha256 mismatch for vendor/mixpanel-contracts/$rel_path (PROVENANCE.json is stale or the copy was edited)" >&2
    integrity_failures=$((integrity_failures + 1))
  fi

  if [[ "$have_checkout" -eq 1 ]]; then
    src="$ANALYTICS_ROOT/$source_path"
    if [[ ! -f "$src" ]]; then
      echo "DRIFT: source file gone upstream: $source_path" >&2
      drift_failures=$((drift_failures + 1))
    elif ! cmp -s "$vendored" "$src"; then
      echo "DRIFT: vendor/mixpanel-contracts/$rel_path differs from $source_path" >&2
      drift_failures=$((drift_failures + 1))
    fi
  fi
done < <(manifest_rows)

echo "Checked $checked vendored files."

if [[ "$integrity_failures" -gt 0 ]]; then
  echo "FAIL: $integrity_failures integrity error(s) — vendored copies do not match PROVENANCE.json." >&2
  exit 1
fi

if [[ "$drift_failures" -gt 0 ]]; then
  echo "FAIL: $drift_failures file(s) drifted from the analytics checkout." >&2
  echo "Re-vendor: copy the changed files byte-for-byte from $ANALYTICS_ROOT and refresh their sha256/vendored_date entries in vendor/mixpanel-contracts/PROVENANCE.json (see vendor/mixpanel-contracts/README.md)." >&2
  exit 1
fi

if [[ "$have_checkout" -eq 1 ]]; then
  echo "OK: no drift against $ANALYTICS_ROOT; PROVENANCE.json integrity verified."
else
  echo "OK: PROVENANCE.json integrity verified (drift half skipped)."
fi
