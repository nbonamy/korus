#!/bin/sh
set -eu
for name in "${API_HOST:-}" "${CONSOLE_HOST:-}"; do
  case "$name" in ''|*[!a-zA-Z0-9.-]*) exit 1;; esac
done
[ "$API_HOST" != "$CONSOLE_HOST" ] || exit 1
envsubst '${API_HOST} ${CONSOLE_HOST}' < /ops/nginx.conf.template > /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
