#!/bin/sh
# Put the real web address (PUBLIC_URL) into the built website at start-up.
set -e
PLACEHOLDER="https://paneltec-public-url.invalid"
URL="${PUBLIC_URL%/}"
if [ -z "$URL" ]; then
  echo "[paneltec] PUBLIC_URL is not set - set it in the stack settings (e.g. http://192.168.3.15:3951)" >&2
  exit 1
fi
find /usr/share/nginx/html -type f \( -name '*.js' -o -name '*.html' -o -name '*.json' \) \
  -exec grep -l "$PLACEHOLDER" {} + 2>/dev/null | while read -r f; do
  sed -i "s#${PLACEHOLDER}#${URL}#g" "$f"
done
echo "[paneltec] web address set to ${URL}"
