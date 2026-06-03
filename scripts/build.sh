#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
STORAGE_DIR="${PROJECT_ROOT}/storage"

rm -rf "${STORAGE_DIR}"
mkdir -p "${STORAGE_DIR}"

echo "🛠️  Building compilation image..."
docker build -t frappe-playground -f "${PROJECT_ROOT}/Dockerfile.build" "${PROJECT_ROOT}"

echo "📦 Extracting compiled production runtime targets..."
# Mount host storage directory into container execution folder
docker run --rm \
    -v "$STORAGE_DIR:/output" \
    frappe-playground:latest

echo "📂 Extracting frontend assets..."
tar -xzf "${STORAGE_DIR}/assets.tar.gz" -C "${STORAGE_DIR}/"
rm "${STORAGE_DIR}/assets.tar.gz"
echo "✅ Build complete!"
