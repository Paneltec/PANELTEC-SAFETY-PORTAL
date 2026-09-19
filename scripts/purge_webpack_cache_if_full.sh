#!/bin/bash
# v58.13.132it — Paneltec /app disk hygiene (expanded).
#
# Purge regeneratable caches when /app usage exceeds THRESHOLD (default
# 80% as of .132it, tightened from 85% because the .132is outage
# showed 85→100% can happen inside a single cron interval).
#
# Purges (in order, only when threshold breached):
#   1. Static TARGETS  — obvious cache dirs, wiped entirely.
#   2. FIND_TARGETS    — pattern sweeps (__pycache__, .pytest_cache).
#   3. TMP_TARGETS     — /tmp scratch dirs & Playwright temp dirs.
#   4. LOG_TARGETS     — rotated supervisor archives.
#   5. git gc          — reap unreferenced objects in /app/.git.
#
# Non-destructive to source, tests, or dev workflow.
# Logged (with per-target MB freed) to /var/log/paneltec-disk-hygiene.log.
set -u

THRESHOLD=${THRESHOLD:-75}
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

free_kb() {
  df -P /app | awk 'NR==2 { print $4 }'
}

# Sum + delete a directory tree; echoes KB freed (0 if missing).
purge_dir() {
  local t="$1"
  if [ -d "$t" ]; then
    local size
    size=$(du -sk "$t" 2>/dev/null | awk '{print $1}')
    rm -rf "$t" 2>/dev/null
    echo "${size:-0}"
    return
  fi
  echo "0"
}

# Sum + delete a glob of files; echoes KB freed.
purge_glob() {
  local pattern="$1"
  local total=0
  local f size
  # shellcheck disable=SC2086
  for f in $pattern; do
    if [ -e "$f" ]; then
      size=$(du -sk "$f" 2>/dev/null | awk '{print $1}')
      rm -rf "$f" 2>/dev/null && total=$((total + ${size:-0}))
    fi
  done
  echo "$total"
}

# Find + delete matching dirs; echoes KB freed.
purge_find_dirs() {
  local root="$1"
  local name="$2"
  local total=0
  local d size
  while IFS= read -r d; do
    size=$(du -sk "$d" 2>/dev/null | awk '{print $1}')
    rm -rf "$d" 2>/dev/null && total=$((total + ${size:-0}))
  done < <(find "$root" -type d -name "$name" 2>/dev/null)
  echo "$total"
}

fmt_mb() { awk -v k="$1" 'BEGIN { printf "%.1f", k/1024 }'; }

pct=$(usage_pct)
if [ -z "$pct" ]; then
  log "SKIP could not read /app usage"
  exit 0
fi

if [ "$pct" -lt "$THRESHOLD" ]; then
  # Below threshold — silent no-op (cron runs every 5 min).
  exit 0
fi

before_free=$(free_kb)
log "TRIGGER /app usage=${pct}% >= threshold=${THRESHOLD}% free_before=$(fmt_mb "$before_free")MB"

grand_total=0

# 1. Static targets (whole-dir wipes)
for t in "${TARGETS[@]}"; do
  freed=$(purge_dir "$t")
  if [ "$freed" -gt 0 ]; then
    log "  purged $t ($(fmt_mb "$freed")MB)"
    grand_total=$((grand_total + freed))
  fi
done

# 2. Pattern sweeps — every __pycache__ and .pytest_cache under /app
freed=$(purge_find_dirs /app __pycache__)
if [ "$freed" -gt 0 ]; then
  log "  purged __pycache__/* under /app ($(fmt_mb "$freed")MB)"
  grand_total=$((grand_total + freed))
fi
freed=$(purge_find_dirs /app .pytest_cache)
if [ "$freed" -gt 0 ]; then
  log "  purged .pytest_cache/* under /app ($(fmt_mb "$freed")MB)"
  grand_total=$((grand_total + freed))
fi

# 3. /tmp scratch dirs — full-dir wipes for the well-known ones
for t in "${TMP_TARGETS[@]}"; do
  if [ -e "$t" ]; then
    freed=$(du -sk "$t" 2>/dev/null | awk '{print $1}')
    rm -rf "${t:?}"/* 2>/dev/null
    if [ -n "$freed" ] && [ "$freed" -gt 0 ]; then
      log "  swept $t/* ($(fmt_mb "$freed")MB)"
      grand_total=$((grand_total + freed))
    fi
  fi
done

# 3b. Playwright + generic /tmp temp dirs (glob)
freed=$(purge_glob "/tmp/.pw-*")
if [ "$freed" -gt 0 ]; then
  log "  purged /tmp/.pw-* ($(fmt_mb "$freed")MB)"
  grand_total=$((grand_total + freed))
fi

# 4. Rotated supervisor log archives
freed=$(purge_glob "/var/log/supervisor/*.log.*")
if [ "$freed" -gt 0 ]; then
  log "  purged /var/log/supervisor/*.log.* ($(fmt_mb "$freed")MB)"
  grand_total=$((grand_total + freed))
fi
freed=$(purge_glob "/var/log/supervisor/*.gz")
if [ "$freed" -gt 0 ]; then
  log "  purged /var/log/supervisor/*.gz ($(fmt_mb "$freed")MB)"
  grand_total=$((grand_total + freed))
fi

# 5. git gc on /app/.git — only run if still >= threshold after the
# cheap steps above, since gc is expensive (CPU + IO) and rewrites the
# pack file. Fast-exit if the earlier steps already got us under water.
# v58.13.132iw — SKIP_GIT_GC=1 makes on-demand panic mode return fast
# (git gc can take ~70s and blocks the HTTP response beyond CF's edge
# timeout). The cron path leaves SKIP_GIT_GC unset so gc still fires
# there.
mid_pct=$(usage_pct)
if [ "$mid_pct" -ge "$THRESHOLD" ] && [ -d /app/.git ] && [ "${SKIP_GIT_GC:-0}" != "1" ]; then
  gc_before=$(du -sk /app/.git 2>/dev/null | awk '{print $1}')
  # Timeout gc after 120s to avoid stalling cron; --prune=now reaps
  # dangling objects immediately (no 2-week grace period).
  timeout 120 git -C /app gc --aggressive --prune=now --quiet 2>/dev/null || true
  gc_after=$(du -sk /app/.git 2>/dev/null | awk '{print $1}')
  gc_freed=$((gc_before - gc_after))
  if [ "$gc_freed" -gt 0 ]; then
    log "  git gc /app/.git ($(fmt_mb "$gc_freed")MB reclaimed, ${gc_before}K → ${gc_after}K)"
    grand_total=$((grand_total + gc_freed))
  else
    log "  git gc /app/.git (no reclaim, ${gc_before}K stable)"
  fi
fi

after_pct=$(usage_pct)
after_free=$(free_kb)
log "DONE /app usage=${after_pct}% free_after=$(fmt_mb "$after_free")MB total_freed=$(fmt_mb "$grand_total")MB"
exit 0
