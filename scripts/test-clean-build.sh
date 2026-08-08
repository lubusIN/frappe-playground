#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DIST_DIR="${PROJECT_ROOT}/dist"

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"
touch "${DIST_DIR}/.stale-build-sentinel"

npm run build

if [ -e "${DIST_DIR}/.stale-build-sentinel" ]; then
    echo "Stale publish output survived a clean build." >&2
    exit 1
fi

npm run verify:build
