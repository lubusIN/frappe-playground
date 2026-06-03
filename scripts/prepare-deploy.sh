#!/bin/bash
set -euo pipefail

echo "Preparing deploy assets..."

bash scripts/build.sh
bash scripts/prepare.sh
npm run build
bash scripts/check-limits.sh public
