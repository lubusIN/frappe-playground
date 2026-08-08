#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RUNTIME_ARTIFACTS_DIR="${PROJECT_ROOT}/artifacts/runtime"
FRAPPE_VERSION="${FRAPPE_VERSION:-v16.30.0}"

rm -rf "${RUNTIME_ARTIFACTS_DIR}"
mkdir -p "${RUNTIME_ARTIFACTS_DIR}"

echo "🛠️  Building compilation image..."
docker build \
    --build-arg "FRAPPE_VERSION=${FRAPPE_VERSION}" \
    -t frappe-playground \
    -f "${PROJECT_ROOT}/runtime/build/Dockerfile" \
    "${PROJECT_ROOT}"

echo "📦 Extracting compiled production runtime targets..."
# Mount the intermediate runtime artifact directory into the container.
docker run --rm \
    -v "$RUNTIME_ARTIFACTS_DIR:/output" \
    frappe-playground:latest

echo "📂 Extracting frontend assets..."
tar -xzf "${RUNTIME_ARTIFACTS_DIR}/assets.tar.gz" -C "${RUNTIME_ARTIFACTS_DIR}/"
rm "${RUNTIME_ARTIFACTS_DIR}/assets.tar.gz"
node "${PROJECT_ROOT}/scripts/write-runtime-manifest.mjs" \
    "${RUNTIME_ARTIFACTS_DIR}" \
    "${FRAPPE_VERSION}"
echo "✅ Build complete!"
