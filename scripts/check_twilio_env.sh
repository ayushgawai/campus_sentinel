#!/usr/bin/env bash
# One-shot: after you verify a phone + buy a Twilio number, fill FROM/TO here
# or export them, then restart api.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV="$ROOT/.env"
if [[ ! -f "$ENV" ]]; then
  echo "missing $ENV — copy .env.example first" >&2
  exit 1
fi

need() {
  local k="$1"
  if ! grep -q "^${k}=.\+" "$ENV" 2>/dev/null; then
    echo "FILL: $k" >&2
    return 1
  fi
  return 0
}

ok=0
need TWILIO_ACCOUNT_SID || ok=1
need TWILIO_AUTH_TOKEN || ok=1
need TWILIO_FROM || ok=1
need CS_DEMO_TO_NUMBER || ok=1
need CS_PUBLIC_BASE || ok=1
grep -q '^CS_TWILIO_ENABLED=1' "$ENV" || { echo "FILL: CS_TWILIO_ENABLED=1"; ok=1; }

if [[ "$ok" -ne 0 ]]; then
  echo ""
  echo "Trial account checklist:"
  echo "  1. https://console.twilio.com → Verify a Caller ID (your cell)"
  echo "  2. Phone Numbers → Buy a number with Voice"
  echo "  3. Put that number in TWILIO_FROM= and your cell in CS_DEMO_TO_NUMBER="
  echo "  4. Expose ZGX :8080 with HTTPS (tailscale funnel / ngrok) → CS_PUBLIC_BASE="
  exit 1
fi
echo "Twilio env looks complete. Restart: python -m services.api"
