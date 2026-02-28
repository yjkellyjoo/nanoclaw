#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
NANOCLAW_MATCH="${PROJECT_DIR}/node_modules/.bin/tsx src/index.ts"
STATUS_SERVICES_CSV="${STATUS_SERVICES:-status-backend,status-login}"
IFS=',' read -r -a status_services <<< "${STATUS_SERVICES_CSV}"

has_systemctl=false
if command -v systemctl >/dev/null 2>&1; then
  has_systemctl=true
fi

restart_with_systemctl() {
  local svc="$1"
  if systemctl restart "${svc}" >/dev/null 2>&1; then
    echo "Restarted ${svc} (system)"
    return 0
  fi
  if systemctl --user restart "${svc}" >/dev/null 2>&1; then
    echo "Restarted ${svc} (user)"
    return 0
  fi
  return 1
}

if [[ "${has_systemctl}" == "true" ]]; then
  echo "Restarting Status services: ${status_services[*]}"
  for svc in "${status_services[@]}"; do
    if ! restart_with_systemctl "${svc}"; then
      echo "Skipping ${svc}: no restartable systemd unit found"
    fi
  done
else
  echo "systemctl not available; skipping service-manager restarts"
fi

if [[ "${has_systemctl}" == "true" ]] && restart_with_systemctl nanoclaw; then
  nanoclaw_mode="service"
else
  echo "Restarting NanoClaw as a background process from ${PROJECT_DIR}"
  pkill -f "${NANOCLAW_MATCH}" || true
  (
    cd "${PROJECT_DIR}"
    nohup npm run dev >/tmp/nanoclaw-dev.log 2>&1 &
  )
  nanoclaw_mode="process"
fi

echo
if [[ "${has_systemctl}" == "true" ]]; then
  echo "Current service states (where available):"
  for svc in "${status_services[@]}"; do
    if systemctl is-active "${svc}" >/dev/null 2>&1; then
      active="active"
      enabled="$(systemctl is-enabled "${svc}" || true)"
      printf "  %-14s active=%-8s enabled=%s\n" "${svc}" "${active}" "${enabled}"
      continue
    fi
    if systemctl --user is-active "${svc}" >/dev/null 2>&1; then
      active="active"
      enabled="$(systemctl --user is-enabled "${svc}" || true)"
      printf "  %-14s active=%-8s enabled=%s (user)\n" "${svc}" "${active}" "${enabled}"
      continue
    fi
    printf "  %-14s active=%-8s\n" "${svc}" "unknown"
  done
fi

if [[ "${nanoclaw_mode}" == "service" ]]; then
  if systemctl is-active nanoclaw >/dev/null 2>&1; then
    enabled="$(systemctl is-enabled nanoclaw || true)"
    printf "  %-14s active=%-8s enabled=%s\n" "nanoclaw" "active" "${enabled}"
  else
    enabled="$(systemctl --user is-enabled nanoclaw || true)"
    printf "  %-14s active=%-8s enabled=%s (user)\n" "nanoclaw" "active" "${enabled}"
  fi
else
  pids="$(pgrep -f "${NANOCLAW_MATCH}" | tr '\n' ' ' || true)"
  if [[ -n "${pids// }" ]]; then
    printf "  %-14s active=%-8s pids=%s\n" "nanoclaw" "running" "${pids}"
  else
    printf "  %-14s active=%-8s pids=%s\n" "nanoclaw" "not-found" "-"
    exit 1
  fi
fi
