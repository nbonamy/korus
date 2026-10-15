#!/usr/bin/env bash
# Run on Joshua after both public hostnames resolve to this host.
set -euo pipefail
sudo certbot certonly --webroot -w /var/lib/__API_SERVICE__-acme -d __API_HOST__ --non-interactive --agree-tos --register-unsafely-without-email
sudo certbot certonly --webroot -w /var/lib/__API_SERVICE__-acme -d __CONSOLE_HOST__ --non-interactive --agree-tos --register-unsafely-without-email
sudo install -m 0644 /opt/__API_SERVICE__/nginx.conf /etc/nginx/sites-available/__API_HOST__.conf
sudo ln -sfn /etc/nginx/sites-available/__API_HOST__.conf /etc/nginx/sites-enabled/__API_HOST__.conf
sudo install -m 0644 /opt/__API_SERVICE__/console-nginx.conf /etc/nginx/sites-available/__CONSOLE_HOST__.conf
sudo ln -sfn /etc/nginx/sites-available/__CONSOLE_HOST__.conf /etc/nginx/sites-enabled/__CONSOLE_HOST__.conf
sudo nginx -t
sudo systemctl reload nginx
curl --fail --silent --show-error https://__API_HOST__/health
