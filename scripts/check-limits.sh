#!/bin/bash
set -euo pipefail

# Script to verify Cloudflare Pages deployment limits

echo "Checking Cloudflare Pages deployment limits..."

# Limits
MAX_FILES=20000
MAX_FILE_SIZE_MB=25
MAX_FILE_SIZE_BYTES=$((MAX_FILE_SIZE_MB * 1024 * 1024))

# Directories to check. Defaults to the Cloudflare Pages publish directory.
if [ "$#" -gt 0 ]; then
  DIRS_TO_CHECK=("$@")
else
  DIRS_TO_CHECK=("public")
fi

TOTAL_FILES=0
RAW_TOTAL_FILES=0
LARGE_FILES_FOUND=0

find_uploadable_files() {
  local dir="$1"
  shift

  find "$dir" -type f \
    ! -name ".DS_Store" \
    ! -path "$dir/_worker.js" \
    ! -path "$dir/_redirects" \
    ! -path "$dir/_headers" \
    ! -path "$dir/_routes.json" \
    ! -path "$dir/functions/*" \
    ! -path "*/node_modules/*" \
    ! -path "*/.git/*" \
    ! -path "*/.wrangler/*" \
    "$@"
}

for DIR in "${DIRS_TO_CHECK[@]}"; do
  if [ -d "$DIR" ]; then
    RAW_COUNT=$(find "$DIR" -type f | wc -l | tr -d ' ')
    RAW_TOTAL_FILES=$((RAW_TOTAL_FILES + RAW_COUNT))

    # Match Wrangler Pages' static asset validation ignore list.
    COUNT=$(find_uploadable_files "$DIR" | wc -l | tr -d ' ')
    TOTAL_FILES=$((TOTAL_FILES + COUNT))

    # Find large files
    LARGE_FILES=$(find_uploadable_files "$DIR" -size +"${MAX_FILE_SIZE_BYTES}"c)
    if [ -n "$LARGE_FILES" ]; then
      echo "⚠️  WARNING: Found files larger than ${MAX_FILE_SIZE_MB}MB in $DIR:"
      find_uploadable_files "$DIR" -size +"${MAX_FILE_SIZE_BYTES}"c -exec ls -lh {} +
      LARGE_FILES_FOUND=1
    fi
  fi
done

echo "----------------------------------------"
echo "Uploadable files count: $TOTAL_FILES / $MAX_FILES"
echo "Raw files count: $RAW_TOTAL_FILES"
echo "Ignored like Wrangler: _headers, _redirects, _worker.js, _routes.json, functions, .DS_Store, node_modules, .git, .wrangler"

if [ "$TOTAL_FILES" -gt "$MAX_FILES" ]; then
  echo "❌ ERROR: Total file count exceeds Cloudflare Pages limit of $MAX_FILES files."
  EXIT_CODE=1
else
  echo "✅ File count is within limits."
  EXIT_CODE=0
fi

if [ "$LARGE_FILES_FOUND" -eq 1 ]; then
  echo "❌ ERROR: Found one or more files exceeding the ${MAX_FILE_SIZE_MB}MB limit."
  EXIT_CODE=1
else
  echo "✅ All files are within the size limit."
fi

echo "----------------------------------------"
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "✅ Deployment size/count check passed."
else
  echo "❌ Deployment size/count check failed."
fi

exit $EXIT_CODE
