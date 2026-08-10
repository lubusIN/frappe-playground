#!/bin/bash
set -euo pipefail

echo "Preparing deploy assets..."

npm run validate:apps
if [ ! -f "artifacts/runtime/frappe_runtime.tar.gz" ]; then
    bash scripts/build.sh
else
    echo "Runtime artifacts already cached, skipping docker build."
fi
npm run build
bash scripts/check-limits.sh dist
npm run verify:build
