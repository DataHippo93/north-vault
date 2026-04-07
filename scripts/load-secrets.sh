#!/usr/bin/env bash
# Pull north-vault secrets from Bitwarden Secrets Manager into .env.local
# Requires: bws on PATH, BWS_ACCESS_TOKEN set in environment

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.local"
BWS="${HOME}/.local/bin/bws"

if [[ -z "${BWS_ACCESS_TOKEN:-}" ]]; then
  echo "Error: BWS_ACCESS_TOKEN is not set" >&2
  exit 1
fi

if [[ ! -x "$BWS" ]]; then
  echo "Error: bws not found at $BWS" >&2
  exit 1
fi

echo "Fetching secrets from Bitwarden..."

SECRETS=$("$BWS" secret list --output json)

get_secret() {
  echo "$SECRETS" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const s = d.find(x => x.key === process.argv[1]);
    process.stdout.write(s ? s.value : '');
  " "$1"
}

cat > "$ENV_FILE" <<EOF
NEXT_PUBLIC_SUPABASE_URL=$(get_secret SUPABASE_URL)
NEXT_PUBLIC_SUPABASE_ANON_KEY=$(get_secret SUPABASE_ANON_KEY)
SUPABASE_SERVICE_ROLE_KEY=$(get_secret SUPABASE_SERVICE_ROLE_KEY)
ANTHROPIC_API_KEY=$(get_secret ANTHROPIC_API_KEY)
AZURE_TENANT_ID=$(get_secret AZURE_TENANT_ID)
AZURE_CLIENT_ID=$(get_secret AZURE_CLIENT_ID)
AZURE_CLIENT_SECRET=$(get_secret AZURE_CLIENT_SECRET)
NEXT_PUBLIC_SITE_URL=http://localhost:3005
EOF

echo ".env.local updated successfully."
