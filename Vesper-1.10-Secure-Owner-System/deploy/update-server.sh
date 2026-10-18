#!/usr/bin/env bash
# Update Vesper on the server from a zip, without the browser:
#   sudo bash /opt/vesper/deploy/update-server.sh /path/to/Vesper-x.y.zip
# Backs up data first, keeps the previous version in /opt/vesper-previous, restarts Vesper,
# and switches back automatically if the new version doesn't start.
set -euo pipefail
ZIP="${1:?Give the path to the new Vesper .zip}"; APP=/opt/vesper; DATA=/var/lib/vesper; PREV=/opt/vesper-previous
TMP=$(mktemp -d); unzip -q "$ZIP" -d "$TMP"
NEW=$(dirname "$(find "$TMP" -maxdepth 3 -path '*/server/server.mjs' | head -1)")/..; NEW=$(cd "$NEW" && pwd)
[[ -f "$NEW/package.json" ]] || { echo "Not a Vesper zip."; exit 1; }
node --check "$NEW/server/server.mjs"
mkdir -p "$DATA/backups"; cp -a "$DATA/vesper.json" "$DATA/backups/vesper-$(date +%Y-%m-%dT%H-%M-%S)-before-update.json" 2>/dev/null || true
rm -rf "$PREV"; cp -a "$APP" "$PREV"
rsync -a --exclude data --exclude .env --exclude node_modules "$NEW/" "$APP/" 2>/dev/null || (cd "$NEW" && tar --exclude=./data --exclude=./.env -cf - . | tar -xf - -C "$APP")
chown -R vesper:vesper "$APP"
systemctl restart vesper; sleep 3
if curl -fsS http://127.0.0.1:5177/api/health >/dev/null; then echo "Updated to $(node -p "require('$APP/package.json').version")."
else echo "New version didn't start; switching back."; rm -rf "$APP"; cp -a "$PREV" "$APP"; systemctl restart vesper; exit 1; fi
rm -rf "$TMP"
