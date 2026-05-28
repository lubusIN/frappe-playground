#!/bin/bash
set -euo pipefail

PROJECT_NAME="${CLOUDFLARE_PAGES_PROJECT:-frappe-playground}"
BRANCH_NAME="${CLOUDFLARE_PAGES_BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)}"

echo "Preparing Cloudflare Pages deploy for ${PROJECT_NAME} (${BRANCH_NAME})..."

bash scripts/bundle.sh
bash scripts/build.sh
bash scripts/prepare.sh
bash scripts/check-limits.sh public

echo "Deploying to Cloudflare Pages..."
npx wrangler pages deploy public \
  --project-name="${PROJECT_NAME}" \
  --branch="${BRANCH_NAME}"
