#!/bin/bash
set -euo pipefail

echo "Assembling runtime files into the publish directory..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RUNTIME_ARTIFACTS_DIR="${PROJECT_ROOT}/artifacts/runtime"
DIST_DIR="${PROJECT_ROOT}/dist"
SERVER_SOURCE_DIR="${PROJECT_ROOT}/playground-server/src"
SERVICE_WORKER_SOURCE_DIR="${PROJECT_ROOT}/service-worker/src"
PYTHON_SOURCE_DIR="${PROJECT_ROOT}/runtime/python"

if [ ! -f "${DIST_DIR}/index.html" ]; then
    echo "Missing client build: ${DIST_DIR}/index.html" >&2
    exit 1
fi

if [ ! -f "${RUNTIME_ARTIFACTS_DIR}/manifest.json" ]; then
    echo "Missing runtime artifacts. Run npm run build:runtime first." >&2
    exit 1
fi

rm -rf "${DIST_DIR}/assets" "${DIST_DIR}/storage" "${DIST_DIR}/python"
rm -f "${DIST_DIR}/sw.js" "${DIST_DIR}/worker.js" "${DIST_DIR}/config.js"
mkdir -p "${DIST_DIR}/storage" "${DIST_DIR}/python"

# Runtime files are fetched by the Web Worker from /storage, excluding assets.
find "${RUNTIME_ARTIFACTS_DIR}" -mindepth 1 -maxdepth 1 ! -name assets -exec cp -R {} "${DIST_DIR}/storage/" \;

# Runtime and Frappe-rendered pages reference browser assets from /assets.
cp -R "${RUNTIME_ARTIFACTS_DIR}/assets" "${DIST_DIR}/assets"

# Authored browser runtime sources retain their stable public URLs.
cp "${SERVICE_WORKER_SOURCE_DIR}/sw.js" "${DIST_DIR}/sw.js"
cp "${SERVER_SOURCE_DIR}/worker.js" "${SERVER_SOURCE_DIR}/config.js" "${DIST_DIR}/"
cp "${PYTHON_SOURCE_DIR}/frappe_mocks.py" "${PYTHON_SOURCE_DIR}/wsgi_server.py" "${DIST_DIR}/python/"

# Static hosting metadata is authored input, never a build destination.
cp "${PROJECT_ROOT}/public/_headers" "${PROJECT_ROOT}/public/_redirects" "${PROJECT_ROOT}/public/favicon.ico" "${DIST_DIR}/"
