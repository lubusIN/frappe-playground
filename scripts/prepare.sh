#!/bin/bash
set -euo pipefail

echo "Preparing Cloudflare Pages publish directory..."

rm -rf public/storage public/assets

# Runtime files are fetched by the Web Worker from /storage.
cp -R storage public/storage

# Frappe-rendered pages reference browser assets from /assets.
cp -R storage/assets public/assets
