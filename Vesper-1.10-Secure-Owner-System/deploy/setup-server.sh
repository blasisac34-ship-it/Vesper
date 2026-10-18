#!/usr/bin/env bash
# Vesper server setup for a free always-on Linux server (tested target: Oracle Cloud "Always Free"
# Ubuntu 22.04/24.04, Ampere/ARM or x86). Run once on the server, from the unzipped Vesper folder:
#
#   sudo bash deploy/setup-server.sh your-name.duckdns.org you@example.com
#
# It installs Node.js, yt-dlp (kept updated daily), Caddy (free automatic HTTPS), copies Vesper to
# /opt/vesper, keeps everyone's data in /var/lib/vesper (outside the app, so updates never touch it),
# and runs Vesper as a service that restarts itself and starts when the server boots.
set -euo pipefail
DOMAIN="${1:-}"; EMAIL="${2:-}"
if [[ -z "$DOMAIN" ]]; then echo "Usage: sudo bash deploy/setup-server.sh <your-domain> [email]"; exit 1; fi
if [[ $EUID -ne 0 ]]; then echo "Run with sudo."; exit 1; fi
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/vesper; DATA=/var/lib/vesper

echo "==> Installing system packages"
apt-get update -y
apt-get install -y curl unzip ca-certificates python3 debian-keyring debian-archive-keyring apt-transport-https gnupg

echo "==> Installing Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Installing yt-dlp (and a daily auto-update)"
curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp
cat > /etc/cron.daily/yt-dlp-update <<'CRON'
#!/bin/sh
/usr/local/bin/yt-dlp -U >/dev/null 2>&1 || true
CRON
chmod +x /etc/cron.daily/yt-dlp-update

echo "==> Installing Caddy (HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "==> Copying Vesper to $APP (data stays in $DATA)"
id vesper >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin vesper
mkdir -p "$APP" "$DATA"
# If you're moving from your Mac, put your old data folder next to this script as ../data first.
if [[ -d "$SRC/data" && ! -f "$DATA/vesper.json" ]]; then cp -a "$SRC/data/." "$DATA/"; echo "   Copied your existing data."; fi
cp -a "$SRC/." "$APP/"; rm -rf "$APP/data"
[[ -f "$APP/.env" ]] || cp "$APP/.env.example" "$APP/.env"

# A fresh public server must never start with a predictable owner password. Prompt without echo
# and write the secret only to the server's private .env file (never to source control).
if ! grep -Eq '^[[:space:]]*VESPER_OWNER_PASSWORD=.{12,}$' "$APP/.env"; then
  echo "==> Set up the Vesper owner account"
  read -r -p "Owner username [Isaac]: " OWNER_USERNAME
  OWNER_USERNAME="${OWNER_USERNAME:-Isaac}"
  if [[ ! "$OWNER_USERNAME" =~ ^[a-zA-Z0-9_.-]{3,32}$ ]]; then echo "Owner username must be 3-32 letters, numbers, dots, dashes or underscores."; exit 1; fi
  while true; do
    read -r -s -p "Create a unique owner password (12+ characters, no spaces): " OWNER_PASSWORD; echo
    if [[ ${#OWNER_PASSWORD} -ge 12 && "$OWNER_PASSWORD" != *[[:space:]]* ]]; then break; fi
    echo "Password must be at least 12 characters and contain no spaces. Try again."
  done
  touch "$APP/.env"
  sed -i '/^[[:space:]]*VESPER_OWNER_USERNAME=/d; /^[[:space:]]*VESPER_OWNER_PASSWORD=/d' "$APP/.env"
  printf '\nVESPER_OWNER_USERNAME=%s\nVESPER_OWNER_PASSWORD=%s\n' "$OWNER_USERNAME" "$OWNER_PASSWORD" >> "$APP/.env"
  unset OWNER_PASSWORD
  chmod 600 "$APP/.env"
fi
chown -R vesper:vesper "$APP" "$DATA"
chmod 600 "$APP/.env"

echo "==> Creating the Vesper service"
cat > /etc/systemd/system/vesper.service <<UNIT
[Unit]
Description=Vesper music server
After=network-online.target
Wants=network-online.target

[Service]
User=vesper
WorkingDirectory=$APP
Environment=PORT=5177
Environment=HOST=127.0.0.1
Environment=VESPER_DATA_DIR=$DATA
Environment=VESPER_SELF_UPDATE=1
Environment=VESPER_REQUIRE_OWNER=1
Environment=ALLOW_REMOTE_GUESTS=0
Environment=YT_DLP_PATH=/usr/local/bin/yt-dlp
Environment=YT_DLP_COOKIES=$DATA/cookies.txt
EnvironmentFile=-$APP/.env
ExecStart=/usr/bin/node server/server.mjs
Restart=always
RestartSec=2
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now vesper

echo "==> HTTPS for $DOMAIN"
cat > /etc/caddy/Caddyfile <<CADDY
{
  ${EMAIL:+email $EMAIL}
}
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:5177 {
    flush_interval -1
  }
}
CADDY
systemctl restart caddy

echo "==> Opening ports 80 and 443 in the server firewall"
if command -v iptables >/dev/null; then
  for P in 80 443; do iptables -C INPUT -p tcp --dport $P -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp --dport $P -j ACCEPT; done
  command -v netfilter-persistent >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent || true
  netfilter-persistent save || true
fi
command -v ufw >/dev/null && ufw status | grep -q active && { ufw allow 80/tcp; ufw allow 443/tcp; } || true

sleep 2
if curl -fsS http://127.0.0.1:5177/api/health >/dev/null; then
  echo; echo "Vesper is running. Open https://$DOMAIN on any device."
  echo "The first account that adds a sign-in becomes the owner (Settings → Your Vesper server)."
else
  echo "Vesper didn't start. See: sudo journalctl -u vesper -n 50"
fi
