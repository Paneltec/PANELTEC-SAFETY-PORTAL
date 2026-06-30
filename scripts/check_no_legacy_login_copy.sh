#!/usr/bin/env bash
# Phase 4.10.4 (paneltec-v119) — repo guard against legacy login copy.
#
# Run this before every deploy. Exits non-zero if any of the known-bad
# placeholder phrases that used to live on the Login.jsx right panel
# have crept back into the source tree (commit messages, code, comments,
# changelog blocks — anywhere). When the guard fires, fix the file it
# names rather than silencing the script.
#
# The single source of truth for the hero block lives in
# /app/frontend/src/components/marketing/PaneltecHero.jsx. Editing copy
# anywhere else is wrong — this script will spot it.

set -u

# Paths excluded from the sweep (vendored / generated / unrelated).
EXCLUDE=(
  --exclude-dir=node_modules
  --exclude-dir=.git
  --exclude-dir=build
  --exclude-dir=dist
  --exclude-dir=.cache
  --exclude=yarn.lock
  --exclude=package-lock.json
  --exclude="$(basename "$0")"
)

# Phrases the v118+v119 cleanup eradicated. If ANY of these match again,
# someone has re-introduced placeholder copy — block the deploy.
PATTERNS=(
  'One platform for SWMS, sign-ons, hazards and compliance intelligence'
  'need oversight without the spreadsheets'
  'AI SWMS.*8 active'
  'Pre-starts.*12 captured'
  'Hazards.*6 flagged'
  'Inspections.*6 passed'
)

FAIL=0
for p in "${PATTERNS[@]}"; do
  HITS=$(grep -rnE "${EXCLUDE[@]}" "$p" /app/ 2>/dev/null || true)
  if [ -n "$HITS" ]; then
    echo "✗ legacy login copy reappeared — pattern: $p"
    echo "$HITS" | sed 's/^/    /'
    FAIL=1
  fi
done

if [ $FAIL -eq 0 ]; then
  echo "✓ no legacy login copy detected — auth surfaces clean"
  exit 0
fi
echo ""
echo "Fix: edit the offending file. Authoritative hero copy lives only in"
echo "  /app/frontend/src/components/marketing/PaneltecHero.jsx"
exit 1
