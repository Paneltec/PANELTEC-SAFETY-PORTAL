#!/bin/bash
# v58.13.132hma — Paneltec /app disk hygiene.
# Purge `/app/frontend/node_modules/.cache` (CRA/babel/webpack) when
# the /app volume usage exceeds 85%. Cron-driven belt to the
# supervisor prestart braces in scripts/prestart-hygiene.js.
#
# Non-destructive to source, tests, or dev workflow — only removes
# regeneratable build caches. LibreOffice scratch is bounded by
# LibreOffice itself; we clean the /tmp remnants here as bonus.
#
# Logged (with timestamp + freed bytes) to /var/log/paneltec-disk-hygiene.log.
# Rotated by /etc/logrotate.d/paneltec-disk-hygiene.
set -u

THRESHOLD=${THRESHOLD:-85}
LOG=/var/log/paneltec-disk-hygiene.log
TARGETS=(
  /app/frontend/node_modules/.cache
  /app/mobile/node_modules/.cache
)
TMP_TARGETS=(
  /tmp/lo_scratch
  /tmp/metro-cache
)

now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "$(now) $1" >>"$LOG" 2>/dev/null; }

usage_pct() {
  df -P /app | awk 'NR==2 { sub("%","",$5); print $5 }'
}

pct=$(usage_pct)
if [ -z "$pct" ]; then
  log "SKIP could not read /app usage"
  exit 0
fi

if [ "$pct" -lt "$THRESHOLD" ]; then
  # Below threshold — silent no-op (cron runs every 5 min).
  exit 0
fi

before=$(df -P /app | awk 'NR==2 { print $3 }')
log "TRIGGER /app usage=${pct}% >= threshold=${THRESHOLD}%"

freed_bytes=0
for t in "${TARGETS[@]}"; do
  if [ -d "$t" ]; then
    size=$(du -sk "$t" 2>/dev/null | awk '{print $1}')
    rm -rf "$t" 2>/dev/null && {
      freed_bytes=$((freed_bytes + size))
      log "  purged $t (~${size}K)"
    }
  fi
done

for t in "${TMP_TARGETS[@]}"; do
  if [ -e "$t" ]; then
    rm -rf "${t:?}"/* 2>/dev/null
    log "  swept $t/*"
  fi
done

after_pct=$(usage_pct)
log "DONE /app usage now=${after_pct}% (freed ~${freed_bytes}K)"
exit 0
