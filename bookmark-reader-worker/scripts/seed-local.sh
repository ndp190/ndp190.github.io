#!/bin/bash

# Seed local R2 storage with mock data
# Run this AFTER starting wrangler dev with --persist

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOCK_DATA_DIR="$SCRIPT_DIR/mock-data"

echo "Seeding local R2 storage with mock data..."

# Seed manifest
npx wrangler r2 object put local-nikk/bookmark/manifest.json \
  --file="$MOCK_DATA_DIR/manifest.json" \
  --local --env local

# Seed individual bookmarks
npx wrangler r2 object put local-nikk/bookmark/example-article-one.json \
  --file="$MOCK_DATA_DIR/example-article-one.json" \
  --local --env local

npx wrangler r2 object put local-nikk/bookmark/example-article-two.json \
  --file="$MOCK_DATA_DIR/example-article-two.json" \
  --local --env local

npx wrangler r2 object put local-nikk/bookmark/example-article-three.json \
  --file="$MOCK_DATA_DIR/example-article-three.json" \
  --local --env local

echo "Done! Mock data seeded successfully."
echo "Start the worker with: npx wrangler dev --env local --persist"
echo "Then visit: http://localhost:8787"
