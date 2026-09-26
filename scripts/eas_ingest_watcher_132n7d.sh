#!/usr/bin/env bash
# v58.13.132n7d — background poller that waits for a specific EAS build
# to reach FINISHED, then calls the admin `ingest-from-eas` endpoint
# so the fresh APK is published on /api/mobile/downloads/android/latest.apk.
#
# Emits progress + result to /tmp/eas_ingest_132n7d.log so the agent can
# tail it after the build finishes.
set -uo pipefail

BUILD_ID="${1:-cf70a770-e7fa-4c6b-87d4-38a533946d98}"
API_URL="https://whs-compliance.preview.emergentagent.com"
LOG=/tmp/eas_ingest_132n7d.log

# Environment
export EXPO_TOKEN="$(grep '^EXPO_TOKEN=' /app/backend/.env | cut -d= -f2)"
export PATH="$PATH:$(yarn global bin 2>/dev/null)"

echo "== eas_ingest_watcher.sh started $(date -u -Iseconds) build=$BUILD_ID ==" >>"$LOG"

# Poll every 30s for up to 40 min.
for i in $(seq 1 80); do
    STATUS=$(cd /app/mobile && eas build:view "$BUILD_ID" --json 2>/dev/null \
             | python3 -c "import sys,json;print(json.load(sys.stdin).get('status'))" \
             2>/dev/null)
    ARTIFACT=$(cd /app/mobile && eas build:view "$BUILD_ID" --json 2>/dev/null \
               | python3 -c "import sys,json;d=json.load(sys.stdin);a=d.get('artifacts') or {};print(a.get('applicationArchiveUrl') or '')" \
               2>/dev/null)
    echo "poll $i @ $(date -u '+%H:%M:%S')  status=$STATUS  artifact=${ARTIFACT:-none}" >>"$LOG"
    if [[ "$STATUS" == "FINISHED" && -n "$ARTIFACT" ]]; then
        echo ">>> build FINISHED — calling ingest endpoint" >>"$LOG"
        break
    fi
    if [[ "$STATUS" == "ERRORED" || "$STATUS" == "CANCELED" ]]; then
        echo ">>> build FAILED — aborting watcher" >>"$LOG"
        exit 1
    fi
    sleep 30
done

# Ingest via the admin endpoint. Use the admin credential
# (test_credentials.md: stephen@paneltec.com.au / Paneltec2026!).
TOKEN=$(curl -sS -X POST "$API_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d '{"email":"stephen@paneltec.com.au","password":"Paneltec2026!"}' \
        | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])" 2>/dev/null)
if [[ -z "$TOKEN" ]]; then
    echo "!!! login failed — cannot ingest" >>"$LOG"
    exit 2
fi
echo "== calling POST /api/mobile/downloads/android/ingest-from-eas ==" >>"$LOG"
INGEST_RES=$(curl -sS -w "\nHTTP=%{http_code}\n" -X POST \
             "$API_URL/api/mobile/downloads/android/ingest-from-eas" \
             -H "Authorization: Bearer $TOKEN" -H "Content-Length: 0")
echo "$INGEST_RES" >>"$LOG"

# Verify the new metadata surface.
echo "== verifying GET /api/mobile/downloads/android/version ==" >>"$LOG"
curl -sS "$API_URL/api/mobile/downloads/android/version" \
     -H "Authorization: Bearer $TOKEN" >>"$LOG" 2>&1
echo "" >>"$LOG"
echo "== HEAD /api/mobile/downloads/android/latest.apk ==" >>"$LOG"
curl -sS -I "$API_URL/api/mobile/downloads/android/latest.apk" \
     -H "Authorization: Bearer $TOKEN" >>"$LOG" 2>&1

echo "== eas_ingest_watcher.sh done $(date -u -Iseconds) ==" >>"$LOG"
