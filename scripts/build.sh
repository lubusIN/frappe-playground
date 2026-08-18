#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RUNTIME_ARTIFACTS_DIR="${PROJECT_ROOT}/artifacts/runtime"
VERSION_FILE="${PROJECT_ROOT}/runtime/frappe-version.json"
DECLARED_FRAPPE_VERSION="$(sed -n 's/.*"frappeVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${VERSION_FILE}")"
FRAPPE_VERSION="${FRAPPE_VERSION:-${DECLARED_FRAPPE_VERSION}}"
# Set WITH_ERPNEXT=1 to pre-bake ERPNext into the runtime and site database.
WITH_ERPNEXT="${WITH_ERPNEXT:-0}"
ERPNEXT_VERSION="${ERPNEXT_VERSION:-version-16}"
IMAGE_TAG="frappe-playground"
if [ "${WITH_ERPNEXT}" = "1" ]; then IMAGE_TAG="frappe-playground:erpnext"; fi

rm -rf "${RUNTIME_ARTIFACTS_DIR}"
mkdir -p "${RUNTIME_ARTIFACTS_DIR}"

echo "🛠️  Building compilation image..."
docker build \
    --build-arg "FRAPPE_VERSION=${FRAPPE_VERSION}" \
    --build-arg "INSTALL_ERPNEXT=${WITH_ERPNEXT}" \
    --build-arg "ERPNEXT_VERSION=${ERPNEXT_VERSION}" \
    -t "${IMAGE_TAG}" \
    -f "${PROJECT_ROOT}/runtime/build/Dockerfile" \
    "${PROJECT_ROOT}"

echo "📦 Extracting compiled production runtime targets..."
# Mount the intermediate runtime artifact directory into the container.
docker run --rm \
    -v "$RUNTIME_ARTIFACTS_DIR:/output" \
    "${IMAGE_TAG}"

echo "📂 Extracting frontend assets..."
tar -xzf "${RUNTIME_ARTIFACTS_DIR}/assets.tar.gz" -C "${RUNTIME_ARTIFACTS_DIR}/"
rm "${RUNTIME_ARTIFACTS_DIR}/assets.tar.gz"
node "${PROJECT_ROOT}/scripts/write-runtime-manifest.mjs" \
    "${RUNTIME_ARTIFACTS_DIR}" \
    "${FRAPPE_VERSION}"
echo "📏 Artifact sizes (Cloudflare Pages per-file limit is 25MB):"
CAP_BYTES=$((25 * 1024 * 1024))
OVERSIZED=0
# A temp file rather than process substitution: `done < <(...)` is a bashism and
# this script is also reached through shells that do not support it. Piping into
# the loop instead would run it in a subshell and lose OVERSIZED.
ARTIFACT_LIST="$(mktemp)"
find "${RUNTIME_ARTIFACTS_DIR}" -maxdepth 3 -type f \
    \( -name '*.tar.gz' -o -name '*.db' -o -name '*.zip' \) | sort > "${ARTIFACT_LIST}"

while IFS= read -r artifact; do
    [ -n "${artifact}" ] || continue
    BYTES=$(wc -c < "${artifact}" | tr -d ' ')
    HUMAN=$(echo "${BYTES}" | awk '{printf "%.1fMB", $1/1048576}')
    FLAG="ok"
    if [ "${BYTES}" -gt "${CAP_BYTES}" ]; then FLAG="OVER CAP"; OVERSIZED=1; fi
    printf '   %-42s %10s  %s\n' "$(basename "${artifact}")" "${HUMAN}" "${FLAG}"
done < "${ARTIFACT_LIST}"
rm -f "${ARTIFACT_LIST}"

if [ "${OVERSIZED}" = "1" ]; then
    echo "⚠️  At least one artifact exceeds the 25MB per-file limit."
    echo "    Cloudflare Pages will reject it. The archive must be split across"
    echo "    multiple files and reassembled by packages/server/src/filesystem.js."
fi

echo "✅ Build complete! (ERPNext: ${WITH_ERPNEXT})"
