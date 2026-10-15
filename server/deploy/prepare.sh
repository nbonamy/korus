#!/usr/bin/env bash
# Prepare the Korus API on the existing host. Does not configure any application reporter.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_HOST="${API_DEPLOY_HOST:-joshua}"
npm --prefix "$ROOT_DIR" run build:server
RENDER_DIR="$(mktemp -d)"
trap 'rm -rf -- "$RENDER_DIR"' EXIT
node --input-type=module - "$ROOT_DIR" "$RENDER_DIR" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [root, output] = process.argv.slice(2);
const product = JSON.parse(readFileSync(path.join(root, 'core/src/product.json'), 'utf8'));
const host = 'api.' + new URL(product.websiteUrl).hostname;
const service = product.slug + '-api';
if (!/^[a-z0-9.-]+$/.test(host) || !/^[a-z0-9-]+$/.test(service) || !/^[a-zA-Z0-9 -]+$/.test(product.name)) throw Error('Invalid API deployment identity');
writeFileSync(path.join(output, 'identity'), [service, host, ''].join(String.fromCharCode(10)));
for (const file of ['api.service', 'api.env', 'nginx.conf', 'nginx-bootstrap.conf', 'activate.sh']) {
  const source = readFileSync(path.join(root, 'server/deploy', file), 'utf8');
  writeFileSync(path.join(output, file), source.replaceAll('__API_HOST__', host).replaceAll('__API_SERVICE__', service).replaceAll('__API_ZONE__', service.replaceAll('-', '_')).replaceAll('__PRODUCT_NAME__', product.name));
}
NODE
DEPLOY_SERVICE="$(sed -n '1p' "$RENDER_DIR/identity")"
DEPLOY_DOMAIN="$(sed -n '2p' "$RENDER_DIR/identity")"
STAGING_DIR="$(ssh -o BatchMode=yes "$DEPLOY_HOST" 'mktemp -d /tmp/app-api-deploy.XXXXXXXX')"
if [[ ! "$STAGING_DIR" =~ ^/tmp/app-api-deploy\.[A-Za-z0-9]+$ ]]; then
  echo 'Invalid remote staging directory' >&2
  exit 1
fi
trap 'rm -rf -- "$RENDER_DIR"; ssh -o BatchMode=yes "$DEPLOY_HOST" "rm -rf -- '\''$STAGING_DIR'\''"' EXIT
scp "$ROOT_DIR/server/dist/api.mjs" "$RENDER_DIR/api.service" "$RENDER_DIR/api.env" "$RENDER_DIR/nginx.conf" "$RENDER_DIR/nginx-bootstrap.conf" "$RENDER_DIR/activate.sh" "$DEPLOY_HOST:$STAGING_DIR/"
ssh -o BatchMode=yes "$DEPLOY_HOST" bash -s -- "$STAGING_DIR" "$DEPLOY_SERVICE" "$DEPLOY_DOMAIN" <<'REMOTE'
set -euo pipefail
stage="$1"
api_service="$2"
api_host="$3"
sudo -n systemctl is-active nginx >/dev/null
sudo -n ss -lnt | grep -q '127.0.0.1:47810' && ! sudo -n systemctl is-active --quiet $api_service && { echo 'API port is already occupied' >&2; exit 1; }
if ! id $api_service >/dev/null 2>&1; then sudo -n useradd --system --no-create-home --shell /usr/sbin/nologin $api_service; fi
sudo -n install -d -m 0755 /opt/$api_service /opt/$api_service/releases /var/lib/$api_service-acme
sudo -n install -d -m 0750 -o root -g $api_service /etc/$api_service
if ! sudo -n test -f /etc/$api_service/operator-token; then
  sudo -n sh -c 'umask 077; openssl rand -hex 32 > "$1/operator-token"' _ "/etc/$api_service"
  sudo -n chown "root:$api_service" /etc/$api_service/operator-token
  sudo -n chmod 0640 /etc/$api_service/operator-token
fi
release="$(sha256sum "$stage/api.mjs" | cut -d' ' -f1)"
sudo -n install -d -m 0755 "/opt/$api_service/releases/$release"
sudo -n install -m 0644 "$stage/api.mjs" "/opt/$api_service/releases/$release/api.mjs"
sudo -n ln -sfn "releases/$release" /opt/$api_service/current
sudo -n install -m 0640 -o root -g $api_service "$stage/api.env" /etc/$api_service/api.env
sudo -n install -m 0644 "$stage/api.service" /etc/systemd/system/$api_service.service
sudo -n install -m 0644 "$stage/nginx.conf" /opt/$api_service/nginx.conf
sudo -n install -m 0755 "$stage/activate.sh" /opt/$api_service/activate.sh
if ! sudo -n test -f /etc/letsencrypt/live/$api_host/fullchain.pem; then
  sudo -n install -m 0644 "$stage/nginx-bootstrap.conf" /etc/nginx/sites-available/$api_host.bootstrap.conf
  sudo -n ln -sfn /etc/nginx/sites-available/$api_host.bootstrap.conf /etc/nginx/sites-enabled/$api_host.conf
fi
sudo -n systemd-analyze verify /etc/systemd/system/$api_service.service
sudo -n systemctl daemon-reload
sudo -n systemctl enable $api_service
sudo -n systemctl restart $api_service
sudo -n nginx -t
sudo -n systemctl reload nginx
for attempt in {1..30}; do
  if curl --fail --silent http://127.0.0.1:47810/health; then break; fi
  sleep 0.2
done
curl --fail --silent http://127.0.0.1:47810/health >/dev/null
printf '\nAPI prepared. Artifact SHA-256: %s\nAfter DNS: sudo /opt/%s/activate.sh\n' "$release" "$api_service"
REMOTE
