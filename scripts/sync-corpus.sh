#!/usr/bin/env bash
# sync-corpus.sh — snapshot the Python conformance corpus into this repo.
#
# Usage:
#   MP_PYTHON_REPO=/path/to/mixpanel-headless npm run sync:corpus
#   MP_PYTHON_REPO=... MP_RIG_BRANCH=<branch> npm run sync:corpus
#
# Environment:
#   MP_PYTHON_REPO  (required) path to the Python mixpanel-headless checkout
#   MP_RIG_BRANCH   (optional) branch used for the read-only worktree when
#                   the Python working tree is dirty in a copied path
#                   (default: main)
#
# Copies, from the Python repo:
#   conformance/vectors/**                     -> conformance-runner/corpus/
#   conformance/schema/canonical-selftest.json -> conformance-runner/corpus/
#   conformance/contract/*.json                -> conformance-runner/corpus/contract/
# and, from this repo:
#   docs/history/typescript-port-api-map.json  -> conformance-runner/corpus/
#
# Rules:
# - Clean-source: if the Python working tree is dirty in any copied path,
#   the copy is taken from a temporary read-only worktree of
#   MP_RIG_BRANCH's HEAD instead, then the worktree is removed.
# - Provenance gate: the source manifest's source_commit must equal the
#   sourceCommit pinned in conformance-runner/corpus.config.json BEFORE any
#   bytes are written; a mismatch aborts. Corpus refresh = update the pin,
#   re-run this script, commit.
set -euo pipefail

if [[ -z "${MP_PYTHON_REPO:-}" ]]; then
  echo "sync-corpus: MP_PYTHON_REPO is not set." >&2
  echo "  Point it at your Python mixpanel-headless checkout, e.g." >&2
  echo "    MP_PYTHON_REPO=../mixpanel-headless npm run sync:corpus" >&2
  exit 1
fi
PY_REPO="${MP_PYTHON_REPO}"
RIG_BRANCH="${MP_RIG_BRANCH:-main}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${REPO_ROOT}/conformance-runner/corpus"
CONFIG="${REPO_ROOT}/conformance-runner/corpus.config.json"

# Repo-relative paths this script snapshots (also the dirty-check scope).
VECTORS_REL="conformance/vectors"
SELFTEST_REL="conformance/schema/canonical-selftest.json"
# The api-map lives in this repo (under docs/history/, the port's archived
# process record; the Python repo keeps only conformance/ + bug reports).
# It is sourced locally, not from the Python checkout.
API_MAP_LOCAL="${REPO_ROOT}/docs/history/typescript-port-api-map.json"
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

DIRTY="$(git -C "${PY_REPO}" status --porcelain -- "${VECTORS_REL}" "${SELFTEST_REL}" "${CONTRACT_GLOB}")"
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

for rel in "${VECTORS_REL}" "${SELFTEST_REL}" "${CONTRACT_REL}"; do
  if [[ ! -e "${SRC}/${rel}" ]]; then
    echo "sync-corpus: missing ${rel} under ${SRC}" >&2
    exit 1
  fi
done
if [[ ! -f "${API_MAP_LOCAL}" ]]; then
  echo "sync-corpus: missing ${API_MAP_LOCAL} (relocated spec of record)" >&2
  exit 1
fi
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
cp "${API_MAP_LOCAL}" "${DEST}/"
mkdir -p "${DEST}/contract"
find "${SRC}/${CONTRACT_REL}" -maxdepth 1 -name '*.json' -exec cp {} "${DEST}/contract/" \;

BUNDLES="$(find "${DEST}" -name '*.jsonl' | wc -l | tr -d ' ')"
ARTIFACTS="$(find "${DEST}/contract" -name '*.json' | wc -l | tr -d ' ')"
echo "sync-corpus: snapshot written to ${DEST} (${BUNDLES} bundles, ${ARTIFACTS} contract artifacts, source_commit ${MANIFEST_COMMIT})"
