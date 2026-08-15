#!/usr/bin/env bash
# sync-corpus.sh — snapshot the Python conformance corpus into this repo
# (design D12 / task TS-4).
#
# Copies, from the Python repo's rig branch:
#   conformance/vectors/**                    -> conformance-runner/corpus/
#   conformance/schema/canonical-selftest.json -> conformance-runner/corpus/
#   context/typescript-port-api-map.json       -> conformance-runner/corpus/
#   conformance/contract/*.json                -> conformance-runner/corpus/contract/
#
# The contract/*.json copies are the Phase-2 P2-1 extension (phase2-design
# C3): the generated contract artifacts (error-codes, literal-aliases,
# tag-universe, model-coverage) ride the same snapshot pipeline as the
# vectors. They carry their own generated_from SHA for provenance; the
# corpus provenance gate below stays keyed on manifest.source_commit.
#
# The api-map.json copy is a deliberate extension over the D12 minimum list:
# scripts/generate-api-map.mjs consumes it alongside corpus/api-index.json,
# and snapshotting it keeps api-map generation hermetic (no live dependency
# on the mutable Python checkout).
#
# Clean-source rule (TS-4): the copy source must be CLEAN. If the Python
# working tree is dirty in any copied path (the Python track may still be
# committing later work), the script copies from a temporary read-only git
# worktree of the rig branch HEAD instead, then removes it.
#
# Provenance gate (D12): the source manifest's source_commit must equal the
# sourceCommit pinned in conformance-runner/corpus.config.json BEFORE any
# bytes are written; mismatch aborts. Corpus refresh = update the pin,
# re-run this script, commit.
#
# Environment overrides:
#   MP_PYTHON_REPO  path to the Python repo checkout
#   MP_RIG_BRANCH   rig branch name for the dirty-tree worktree fallback
set -euo pipefail

PY_REPO="${MP_PYTHON_REPO:-/Users/jaredmcfarland/Developer/mixpanel-headless}"
# Phase 2: the corpus + contract artifacts live on the Phase-2 support
# branch (phase2-design C3 branch discipline); the rig branch remains
# overridable via MP_RIG_BRANCH for historical re-syncs.
RIG_BRANCH="${MP_RIG_BRANCH:-ts-port/phase2-contract-support}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${REPO_ROOT}/conformance-runner/corpus"
CONFIG="${REPO_ROOT}/conformance-runner/corpus.config.json"

# Repo-relative paths this script snapshots (also the dirty-check scope).
VECTORS_REL="conformance/vectors"
SELFTEST_REL="conformance/schema/canonical-selftest.json"
API_MAP_REL="context/typescript-port-api-map.json"
CONTRACT_REL="conformance/contract"
CONTRACT_GLOB="${CONTRACT_REL}/*.json"

if [[ ! -d "${PY_REPO}/.git" && ! -f "${PY_REPO}/.git" ]]; then
  echo "sync-corpus: Python repo not found at ${PY_REPO}" >&2
  exit 1
fi
if [[ ! -f "${CONFIG}" ]]; then
  echo "sync-corpus: missing ${CONFIG} (create it with the pinned sourceCommit first)" >&2
  exit 1
fi

PINNED_COMMIT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).sourceCommit)' "${CONFIG}")"
if [[ -z "${PINNED_COMMIT}" || "${PINNED_COMMIT}" == "undefined" ]]; then
  echo "sync-corpus: corpus.config.json carries no sourceCommit pin" >&2
  exit 1
fi

WORKTREE=""
cleanup() {
  if [[ -n "${WORKTREE}" ]]; then
    git -C "${PY_REPO}" worktree remove --force "${WORKTREE}" >/dev/null 2>&1 || true
    rm -rf "${WORKTREE}"
  fi
}
trap cleanup EXIT

DIRTY="$(git -C "${PY_REPO}" status --porcelain -- "${VECTORS_REL}" "${SELFTEST_REL}" "${API_MAP_REL}" "${CONTRACT_GLOB}")"
if [[ -z "${DIRTY}" ]]; then
  SRC="${PY_REPO}"
  echo "sync-corpus: source tree clean; copying from working tree @ $(git -C "${PY_REPO}" rev-parse --short HEAD) (${RIG_BRANCH})"
else
  echo "sync-corpus: source paths dirty in ${PY_REPO}; using read-only worktree of ${RIG_BRANCH} HEAD"
  WORKTREE="$(mktemp -d /tmp/mp-corpus-sync.XXXXXX)"
  rmdir "${WORKTREE}"
  git -C "${PY_REPO}" worktree add --detach "${WORKTREE}" "${RIG_BRANCH}" >/dev/null
  SRC="${WORKTREE}"
fi

for rel in "${VECTORS_REL}" "${SELFTEST_REL}" "${API_MAP_REL}" "${CONTRACT_REL}"; do
  if [[ ! -e "${SRC}/${rel}" ]]; then
    echo "sync-corpus: missing ${rel} under ${SRC}" >&2
    exit 1
  fi
done
CONTRACT_COUNT="$(find "${SRC}/${CONTRACT_REL}" -maxdepth 1 -name '*.json' | wc -l | tr -d ' ')"
if [[ "${CONTRACT_COUNT}" -eq 0 ]]; then
  echo "sync-corpus: no contract artifacts under ${SRC}/${CONTRACT_REL} (run generate_contract first)" >&2
  exit 1
fi

MANIFEST_COMMIT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).source_commit)' "${SRC}/${VECTORS_REL}/manifest.json")"
if [[ "${MANIFEST_COMMIT}" != "${PINNED_COMMIT}" ]]; then
  echo "sync-corpus: manifest.source_commit (${MANIFEST_COMMIT}) != corpus.config.json sourceCommit (${PINNED_COMMIT}); refusing to write" >&2
  exit 1
fi

rm -rf "${DEST}"
mkdir -p "${DEST}"
cp -R "${SRC}/${VECTORS_REL}/." "${DEST}/"
cp "${SRC}/${SELFTEST_REL}" "${DEST}/"
cp "${SRC}/${API_MAP_REL}" "${DEST}/"
mkdir -p "${DEST}/contract"
find "${SRC}/${CONTRACT_REL}" -maxdepth 1 -name '*.json' -exec cp {} "${DEST}/contract/" \;

BUNDLES="$(find "${DEST}" -name '*.jsonl' | wc -l | tr -d ' ')"
ARTIFACTS="$(find "${DEST}/contract" -name '*.json' | wc -l | tr -d ' ')"
echo "sync-corpus: snapshot written to ${DEST} (${BUNDLES} bundles, ${ARTIFACTS} contract artifacts, source_commit ${MANIFEST_COMMIT})"
