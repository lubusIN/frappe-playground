#!/bin/bash
set -euo pipefail

echo "Assembling runtime files into the publish directory..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RUNTIME_ARTIFACTS_DIR="${PROJECT_ROOT}/artifacts/runtime"
DIST_DIR="${PROJECT_ROOT}/dist"
SERVER_SOURCE_DIR="${PROJECT_ROOT}/packages/server/src"
SERVICE_WORKER_SOURCE_DIR="${PROJECT_ROOT}/packages/service-worker/src"
PROTOCOL_SOURCE_DIR="${PROJECT_ROOT}/packages/protocol/src"
RUNTIME_CONFIG_DIR="${PROJECT_ROOT}/runtime/config"
STATIC_DIR="${PROJECT_ROOT}/static"
GENERATED_SOURCE_DIR="${PROJECT_ROOT}/artifacts/generated"

if [ ! -f "${DIST_DIR}/index.html" ]; then
    echo "Missing client build: ${DIST_DIR}/index.html" >&2
    exit 1
fi

if [ ! -f "${RUNTIME_ARTIFACTS_DIR}/manifest.json" ]; then
    echo "Missing runtime artifacts. Run npm run build:runtime first." >&2
    exit 1
fi

rm -rf "${DIST_DIR}/assets" "${DIST_DIR}/storage" "${DIST_DIR}/python" "${DIST_DIR}/protocol" "${DIST_DIR}/runtime-config" "${DIST_DIR}/service-worker" "${DIST_DIR}/server" "${DIST_DIR}/generated"
rm -f "${DIST_DIR}/sw.js" "${DIST_DIR}/worker.js" "${DIST_DIR}/config.js"
mkdir -p "${DIST_DIR}/storage" "${DIST_DIR}/protocol" "${DIST_DIR}/runtime-config" "${DIST_DIR}/service-worker" "${DIST_DIR}/server" "${DIST_DIR}/generated"

# Runtime files are fetched by the Web Worker from /storage, excluding assets.
find "${RUNTIME_ARTIFACTS_DIR}" -mindepth 1 -maxdepth 1 ! -name assets -exec cp -R {} "${DIST_DIR}/storage/" \;

# Runtime and Frappe-rendered pages reference browser assets from /assets.
cp -R "${RUNTIME_ARTIFACTS_DIR}/assets" "${DIST_DIR}/assets"

# Authored browser runtime sources retain their stable public URLs.
cp "${SERVICE_WORKER_SOURCE_DIR}/index.js" "${DIST_DIR}/sw.js"
cp "${SERVICE_WORKER_SOURCE_DIR}/backend-proxy.js" \
   "${SERVICE_WORKER_SOURCE_DIR}/cache.js" \
   "${SERVICE_WORKER_SOURCE_DIR}/instance-registry.js" \
   "${SERVICE_WORKER_SOURCE_DIR}/routing.js" \
   "${DIST_DIR}/service-worker/"
cp "${SERVER_SOURCE_DIR}/index.js" "${DIST_DIR}/worker.js"
cp "${SERVER_SOURCE_DIR}/config.js" "${DIST_DIR}/config.js"
cp "${SERVER_SOURCE_DIR}/filesystem.js" \
   "${SERVER_SOURCE_DIR}/persistence.js" \
   "${SERVER_SOURCE_DIR}/request-handler.js" \
   "${SERVER_SOURCE_DIR}/boot.js" \
   "${DIST_DIR}/server/"
cp "${GENERATED_SOURCE_DIR}/python-sources.js" "${DIST_DIR}/generated/python-sources.js"
cp "${PROTOCOL_SOURCE_DIR}/messages.js" \
   "${PROTOCOL_SOURCE_DIR}/request.js" \
   "${PROTOCOL_SOURCE_DIR}/version.js" \
   "${DIST_DIR}/protocol/"
cp "${RUNTIME_CONFIG_DIR}/packages.js" "${RUNTIME_CONFIG_DIR}/site.js" "${DIST_DIR}/runtime-config/"

# Static hosting metadata is authored input, never a build destination.
cp "${STATIC_DIR}/_headers" "${STATIC_DIR}/_redirects" "${STATIC_DIR}/favicon.ico" "${DIST_DIR}/"
