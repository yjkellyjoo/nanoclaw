#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo "$0" "$@"
fi

services=(status-backend nanoclaw)

pkill -f '^/usr/local/bin/status-backend --address 127.0.0.1:21405$' || true
pkill -f 'tsx src/index.ts' || true

echo "Restarting services: ${services[*]}"
for svc in "${services[@]}"; do
  systemctl restart "${svc}"
done

echo
echo "Current service states:"
for svc in "${services[@]}"; do
  active="$(systemctl is-active "${svc}" || true)"
  enabled="$(systemctl is-enabled "${svc}" || true)"
  printf "  %-14s active=%-8s enabled=%s\n" "${svc}" "${active}" "${enabled}"
done
