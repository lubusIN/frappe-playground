#!/bin/bash
set -euo pipefail

echo "Preparing Cloudflare Pages publish directory..."

rm -rf public/storage public/assets
mkdir -p public/storage

# Runtime files are fetched by the Web Worker from /storage, excluding assets.
find storage -mindepth 1 -maxdepth 1 ! -name assets -exec cp -R {} public/storage/ \;

# Runtime and Frappe-rendered pages reference browser assets from /assets.
cp -R storage/assets public/assets
