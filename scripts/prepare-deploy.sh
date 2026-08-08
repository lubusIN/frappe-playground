#!/bin/bash
set -euo pipefail

echo "Preparing deploy assets..."

bash scripts/build.sh
npm run build
bash scripts/check-limits.sh dist
npm run verify:build
