#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VECTOR_INDEX="${OPENMEMORY_VECTOR_INDEX:-openmemory-vectors}"
CONFIG="${OPENMEMORY_WRANGLER_CONFIG:-wrangler.jsonc}"

ensure_vector_metadata_index() {
  local property_name="$1"
  local property_type="$2"

  if bun --cwd apps/api wrangler vectorize list-metadata-index "${VECTOR_INDEX}" \
    --config "${CONFIG}" | grep -q "${property_name}"; then
    echo "Vectorize metadata index ${property_name} already exists."
    return
  fi

  echo "Creating Vectorize metadata index ${property_name} (${property_type})..."
  bun --cwd apps/api wrangler vectorize create-metadata-index "${VECTOR_INDEX}" \
    --propertyName "${property_name}" \
    --type "${property_type}" \
    --config "${CONFIG}"
}

ensure_vector_metadata_index tenantId string
ensure_vector_metadata_index status string
ensure_vector_metadata_index isLatest boolean
