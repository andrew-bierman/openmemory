#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

CONFIG="${OPENMEMORY_WRANGLER_CONFIG:-wrangler.jsonc}"
R2_BUCKET="${OPENMEMORY_R2_BUCKET:-openmemory-exports}"
POLICY_FILE="${OPENMEMORY_R2_LIFECYCLE_FILE:-infra/cloudflare/r2-lifecycle.json}"

if [[ ! -f "${POLICY_FILE}" ]]; then
  echo "Lifecycle policy file not found: ${POLICY_FILE}" >&2
  exit 1
fi

echo "Applying R2 lifecycle policy ${POLICY_FILE} to bucket ${R2_BUCKET}..."
bun --cwd apps/api wrangler r2 bucket lifecycle set "${R2_BUCKET}" \
  --file "../../${POLICY_FILE}" \
  --config "../../${CONFIG}" \
  --force

echo
echo "Configured lifecycle rules for ${R2_BUCKET}:"
bun --cwd apps/api wrangler r2 bucket lifecycle list "${R2_BUCKET}" \
  --config "../../${CONFIG}"
