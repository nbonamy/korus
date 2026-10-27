#!/bin/sh
set -eu
for name in "${API_HOST:-}" "${CONSOLE_HOST:-}"; do
  case "$name" in ''|*[!a-zA-Z0-9.-]*) exit 1;; esac
done
[ "$API_HOST" != "$CONSOLE_HOST" ] || exit 1
READ_TOKEN=$(cat /run/secrets/read_access)
case "$READ_TOKEN" in ''|*[!a-zA-Z0-9_-]*) exit 1;; esac
[ "${#READ_TOKEN}" -ge 32 ] && [ "${#READ_TOKEN}" -le 256 ] || exit 1
export READ_TOKEN
umask 077
envsubst '${API_HOST} ${CONSOLE_HOST} ${READ_TOKEN}' < /ops/nginx.conf.template > /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
