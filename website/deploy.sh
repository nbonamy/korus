#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="${APP_WEBSITE_HOST:?Set APP_WEBSITE_HOST to the operator SSH host}"
DOMAIN="$(node -p "new URL(require('$ROOT_DIR/../core/src/product.json').websiteUrl).hostname")"
REMOTE_ROOT="${APP_WEBSITE_ROOT:-$(node -p "require('$ROOT_DIR/../core/src/product.json').deploymentRoot")}"
NGINX_CONFIG="${APP_NGINX_CONFIG:-/etc/nginx/sites-available/$DOMAIN.conf}"
NGINX_BOOTSTRAP_CONFIG="/etc/nginx/sites-available/$DOMAIN.bootstrap.conf"
TEMP_DIR="$(mktemp -d)"
trap 'rm -f "$TEMP_DIR/nginx.conf" "$TEMP_DIR/nginx-bootstrap.conf"; rmdir "$TEMP_DIR"' EXIT

# Keep generated server configuration outside the public website artifact.
for template in nginx.conf nginx-bootstrap.conf; do
  node --input-type=module - "$ROOT_DIR/$template" "$TEMP_DIR/$template" "$DOMAIN" "$REMOTE_ROOT" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [source, target, domain, root] = process.argv.slice(2);
if (!/^[a-z0-9.-]+$/.test(domain) || !/^\/[a-zA-Z0-9/_-]+$/.test(root)) {
  throw new Error('Invalid website host or deployment root');
}
writeFileSync(target, readFileSync(source, 'utf8')
  .replaceAll('__WEBSITE_HOST__', domain)
  .replaceAll('__DEPLOYMENT_ROOT__', root));
NODE
done

# Validate the exact GitHub release/asset links before touching the server.
# Stable aliases follow future releases without a website version pin.
APP_WEBSITE_VERIFY_DOWNLOADS=1 npm --prefix "$ROOT_DIR/.." run build:website

echo "Deploying website to ${HOST}:${REMOTE_ROOT}"
ssh "$HOST" "sudo mkdir -p '$REMOTE_ROOT/site' && sudo chown -R \"\$(id -un):\$(id -gn)\" '$REMOTE_ROOT/site'"
tar -czf - -C "$ROOT_DIR/../dist/website" . | ssh "$HOST" "tar -xzf - -C '$REMOTE_ROOT/site'"
if ! ssh "$HOST" "sudo test -f '/etc/letsencrypt/live/$DOMAIN/fullchain.pem'"; then
  echo "No TLS certificate found; provisioning one with Certbot"
  scp "$TEMP_DIR/nginx-bootstrap.conf" "$HOST:/tmp/$DOMAIN.bootstrap.conf"
  ssh "$HOST" "sudo install -m 0644 '/tmp/$DOMAIN.bootstrap.conf' '$NGINX_BOOTSTRAP_CONFIG' && sudo ln -sfn '$NGINX_BOOTSTRAP_CONFIG' '/etc/nginx/sites-enabled/$DOMAIN.conf' && sudo nginx -t && sudo systemctl reload nginx && sudo certbot certonly --webroot -w '$REMOTE_ROOT/site' -d '$DOMAIN' --non-interactive --agree-tos --register-unsafely-without-email"
fi
scp "$TEMP_DIR/nginx.conf" "$HOST:/tmp/$DOMAIN.conf"
ssh "$HOST" "sudo install -m 0644 '/tmp/$DOMAIN.conf' '$NGINX_CONFIG' && sudo ln -sfn '$NGINX_CONFIG' '/etc/nginx/sites-enabled/$DOMAIN.conf' && sudo nginx -t && sudo systemctl reload nginx && sudo rm -f '/tmp/$DOMAIN.conf' '/tmp/$DOMAIN.bootstrap.conf' '$NGINX_BOOTSTRAP_CONFIG'"
echo "Deployed: https://$DOMAIN"
