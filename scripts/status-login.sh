#!/usr/bin/env bash
# status-login.sh — Bootstrap login for status-backend after it starts.
# Called by status-login.service (oneshot, after status-backend.service).
set -euo pipefail

PORT="${STATUS_PORT:-21405}"
BASE="http://127.0.0.1:${PORT}"

# Source .env for credentials
ENV_FILE="${STATUS_ENV_FILE:-$(cd "$(dirname "$0")/.." && pwd)/.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

KEY_UID="${STATUS_KEY_UID:?STATUS_KEY_UID not set}"
PASSWORD="${STATUS_PASSWORD:?STATUS_PASSWORD not set}"
DATA_DIR="${STATUS_DATA_DIR:-$HOME/.status-backend/data}"

echo "Waiting for status-backend to be ready..."
for i in $(seq 1 30); do
  if curl -sf "${BASE}/health" >/dev/null 2>&1; then
    echo "status-backend is healthy"
    break
  fi
  if [[ "$i" -eq 30 ]]; then
    echo "ERROR: status-backend not healthy after 30 retries" >&2
    exit 1
  fi
  sleep 2
done

echo "Initializing application..."
curl -sf -X POST "${BASE}/statusgo/InitializeApplication" \
  -H 'Content-Type: application/json' \
  -d "{\"dataDir\": \"${DATA_DIR}\"}"
echo

echo "Logging in..."
curl -sf -X POST "${BASE}/statusgo/LoginAccount" \
  -H 'Content-Type: application/json' \
  -d "{\"keyUID\": \"${KEY_UID}\", \"password\": \"${PASSWORD}\"}"
echo

echo "Starting messenger..."
messenger_started=false
for i in $(seq 1 30); do
  resp="$(curl -s -X POST "${BASE}/statusgo/CallRPC" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"wakuext_startMessenger","params":[],"id":1}' || true)"

  if [[ "${resp}" == *'"result"'* ]]; then
    messenger_started=true
    break
  fi

  # Some status-go builds auto-start messenger and do not expose this method.
  if [[ "${resp}" == *'"code":-32601'* ]]; then
    echo "wakuext_startMessenger not available; continuing"
    messenger_started=true
    break
  fi

  sleep 2
done

if [[ "${messenger_started}" != "true" ]]; then
  echo "ERROR: failed to start messenger after retries" >&2
  exit 1
fi

echo "Login complete"
