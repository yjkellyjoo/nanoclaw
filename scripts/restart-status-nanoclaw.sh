#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo "$0" "$@"
fi

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NANOCLAW_MATCH="tsx src/index.ts"
status_services=(status-backend status-login)

echo "Restarting Status services: ${status_services[*]}"
for svc in "${status_services[@]}"; do
  systemctl restart "${svc}"
done

if systemctl list-unit-files --type=service | rg -q '^nanoclaw\.service'; then
  echo "Restarting NanoClaw via systemd service"
  systemctl restart nanoclaw
  nanoclaw_mode="service"
else
  echo "Restarting NanoClaw as a background process"
  pkill -f "${NANOCLAW_MATCH}" || true
  runuser -u "$(logname)" -- bash -lc \
    "cd '${PROJECT_DIR}' && nohup npm run dev >/tmp/nanoclaw-dev.log 2>&1 &"
  nanoclaw_mode="process"
fi

echo
echo "Current service states:"
for svc in "${status_services[@]}"; do
  active="$(systemctl is-active "${svc}" || true)"
  enabled="$(systemctl is-enabled "${svc}" || true)"
  printf "  %-14s active=%-8s enabled=%s\n" "${svc}" "${active}" "${enabled}"
done

if [[ "${nanoclaw_mode}" == "service" ]]; then
  active="$(systemctl is-active nanoclaw || true)"
  enabled="$(systemctl is-enabled nanoclaw || true)"
  printf "  %-14s active=%-8s enabled=%s\n" "nanoclaw" "${active}" "${enabled}"
else
  pids="$(pgrep -f "${NANOCLAW_MATCH}" | tr '\n' ' ' || true)"
  if [[ -n "${pids// }" ]]; then
    printf "  %-14s active=%-8s pids=%s\n" "nanoclaw" "running" "${pids}"
  else
    printf "  %-14s active=%-8s pids=%s\n" "nanoclaw" "not-found" "-"
    exit 1
  fi
fi
