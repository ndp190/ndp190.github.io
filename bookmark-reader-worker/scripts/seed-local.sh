#!/bin/bash
set -euo pipefail

# Seed local R2 storage with mock data
# Runs before npm run dev so the local bookmark reader has mock data.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MOCK_DATA_DIR="$SCRIPT_DIR/mock-data"
PERSIST_DIR="$PROJECT_DIR/.wrangler/state"
MANIFEST_OBJECT="local-nikk/bookmark/manifest.json"

if [[ "${FORCE_SEED:-0}" != "1" ]]; then
  CHECK_FILE="$(mktemp)"
  if npx wrangler r2 object get "$MANIFEST_OBJECT" \
    --file="$CHECK_FILE" \
    --local --env local --persist-to "$PERSIST_DIR" >/dev/null 2>&1; then
    rm -f "$CHECK_FILE"
    echo "Local bookmark manifest already exists. Skipping mock seed."
    echo "Use FORCE_SEED=1 npm run seed:local to overwrite mock data."
    exit 0
  fi
  rm -f "$CHECK_FILE"
fi

echo "Seeding local R2 storage with mock data..."

# Seed manifest
npx wrangler r2 object put "$MANIFEST_OBJECT" \
  --file="$MOCK_DATA_DIR/manifest.json" \
  --local --env local --persist-to "$PERSIST_DIR"

# Seed individual bookmarks
npx wrangler r2 object put local-nikk/bookmark/example-article-one.json \
  --file="$MOCK_DATA_DIR/example-article-one.json" \
  --local --env local --persist-to "$PERSIST_DIR"

npx wrangler r2 object put local-nikk/bookmark/example-article-two.json \
  --file="$MOCK_DATA_DIR/example-article-two.json" \
  --local --env local --persist-to "$PERSIST_DIR"

npx wrangler r2 object put local-nikk/bookmark/example-article-three.json \
  --file="$MOCK_DATA_DIR/example-article-three.json" \
  --local --env local --persist-to "$PERSIST_DIR"

echo "Done! Mock data seeded successfully."
echo "Start the worker with: npm run dev"
echo "Then visit: http://localhost:8787"
