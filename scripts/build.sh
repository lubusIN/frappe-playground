#!/bin/bash
set -e

# Clear older outputs and ensure folder exists
STORAGE_DIR="$(pwd)/storage"
rm -rf storage && mkdir -p storage

echo "🛠️  Building compilation image..."
docker build -t frappe-wasm-compiler -f Dockerfile.build .

echo "📦 Extracting compiled production runtime targets..."
# Mount host storage directory into container execution folder
docker run --rm \
    -v "$STORAGE_DIR:/output" \
    frappe-wasm-compiler:latest \
    /bin/sh -c "cp -r /workspace/test-bench/env/lib/python3.14/site-packages/pypika /workspace/archive_root/ && tar -czf /output/frappe_runtime.tar.gz -C /workspace/archive_root . && tar -czhf /output/assets.tar.gz -C /workspace/test-bench/sites assets && cp /workspace/test-bench/sites/playground.local/db/*.db /output/site1.db && echo '🎉 Compilation Complete!'"

echo "📂 Extracting frontend assets..."
tar -xzf storage/assets.tar.gz -C storage/
rm storage/assets.tar.gz
echo "✅ Build complete!"
