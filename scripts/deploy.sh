#!/bin/bash
set -euo pipefail

PROJECT_NAME="${CLOUDFLARE_PAGES_PROJECT:-frappe-playground}"
BRANCH_NAME="${CLOUDFLARE_PAGES_BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)}"

echo "Deploying to Cloudflare Pages..."
if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  npx wrangler pages deploy public \
    --project-name="${PROJECT_NAME}" \
    --branch="${BRANCH_NAME}" \
    --account-id="${CLOUDFLARE_ACCOUNT_ID}"
else
  npx wrangler pages deploy public \
    --project-name="${PROJECT_NAME}" \
    --branch="${BRANCH_NAME}"
fi
