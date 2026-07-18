#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

CONFIG="apps/api/wrangler.jsonc"
DB_NAME="${OPENMEMORY_D1_NAME:-openmemory-auth}"
VECTOR_INDEX="${OPENMEMORY_VECTOR_INDEX:-openmemory-vectors}"
R2_BUCKET="${OPENMEMORY_R2_BUCKET:-openmemory-exports}"
SOURCE_QUEUE="${OPENMEMORY_SOURCE_QUEUE:-openmemory-source-ingestion}"
SOURCE_DLQ="${OPENMEMORY_SOURCE_DLQ:-openmemory-source-ingestion-dlq}"
EXTRACTION_QUEUE="${OPENMEMORY_EXTRACTION_QUEUE:-openmemory-memory-extraction}"
EXTRACTION_DLQ="${OPENMEMORY_EXTRACTION_DLQ:-openmemory-memory-extraction-dlq}"
VECTOR_PRESET="${OPENMEMORY_VECTOR_PRESET:-@cf/baai/bge-small-en-v1.5}"

echo "Checking Wrangler account access..."
bun --cwd apps/api wrangler whoami

echo "Creating D1 database ${DB_NAME} and updating ${CONFIG}..."
bun --cwd apps/api wrangler d1 create "${DB_NAME}" \
  --binding AUTH_DB \
  --update-config \
  --config wrangler.jsonc

echo "Creating Vectorize index ${VECTOR_INDEX}..."
bun --cwd apps/api wrangler vectorize create "${VECTOR_INDEX}" \
  --preset "${VECTOR_PRESET}" \
  --config wrangler.jsonc

echo "Creating R2 bucket ${R2_BUCKET}..."
bun --cwd apps/api wrangler r2 bucket create "${R2_BUCKET}" \
  --config wrangler.jsonc

echo "Applying R2 lifecycle policy to ${R2_BUCKET}..."
OPENMEMORY_R2_BUCKET="${R2_BUCKET}" OPENMEMORY_WRANGLER_CONFIG="${CONFIG}" bash scripts/apply-r2-lifecycle.sh

echo "Creating async processing Queues..."
bun --cwd apps/api wrangler queues create "${EXTRACTION_QUEUE}" \
  --config wrangler.jsonc
bun --cwd apps/api wrangler queues create "${EXTRACTION_DLQ}" \
  --config wrangler.jsonc
bun --cwd apps/api wrangler queues create "${SOURCE_QUEUE}" \
  --config wrangler.jsonc
bun --cwd apps/api wrangler queues create "${SOURCE_DLQ}" \
  --config wrangler.jsonc

echo "Applying D1 migrations..."
bun run db:migrate:remote

cat <<'NEXT'

Cloudflare resources are created. Set production secrets next:

  bun --cwd apps/api wrangler secret put BETTER_AUTH_SECRET
  bun --cwd apps/api wrangler secret put BETTER_AUTH_URL
  bun --cwd apps/api wrangler secret put GITHUB_CLIENT_ID
  bun --cwd apps/api wrangler secret put GITHUB_CLIENT_SECRET
  bun --cwd apps/api wrangler secret put GOOGLE_CLIENT_ID
  bun --cwd apps/api wrangler secret put GOOGLE_CLIENT_SECRET

Optional machine-token fallback for trusted service-to-service local or preview environments:

  bun --cwd apps/api wrangler secret put OPENMEMORY_API_TOKEN
NEXT
