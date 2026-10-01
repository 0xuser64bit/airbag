#!/usr/bin/env bash
# Runs on the VM as root, from deploy.sh, after the release is unpacked in
# /opt/airbag/releases/$SHA. Builds it as the airbag user and only then switches to it, so a
# failed install or build leaves the running release alone. The VM is shared: this touches
# nothing outside /opt/airbag, /var/lib/airbag, /etc/airbag, its two systemd units and its own
# marked block in /etc/caddy/Caddyfile.
set -euo pipefail
: "${SHA:?}" "${DOMAIN:?}" "${ENGINE_DOMAIN:?}" "${NODE_VERSION:?}"
REL=/opt/airbag/releases/$SHA
NODE=/opt/airbag/node

id airbag >/dev/null 2>&1 ||
  useradd --system --home-dir /var/lib/airbag --create-home --shell /usr/sbin/nologin airbag
install -d -o airbag -g airbag -m 750 /var/lib/airbag
chown -R airbag:airbag "$REL"

# Node 24 for Airbag alone; the system Node belongs to the VM's other apps.
if [ "$("$NODE/bin/node" -v 2>/dev/null)" != "v$NODE_VERSION" ]; then
  arch=$(uname -m | sed 's/aarch64/arm64/; s/x86_64/x64/')
  tarball=node-v$NODE_VERSION-linux-$arch.tar.xz
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/$tarball" "https://nodejs.org/dist/v$NODE_VERSION/$tarball"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf "$NODE.new" && mkdir -p "$NODE.new"
  tar -xJf "$tmp/$tarball" -C "$NODE.new" --strip-components=1
  rm -rf "$NODE" && mv "$NODE.new" "$NODE" && rm -rf "$tmp"
fi

# Install and build the release as airbag. The public URLs are baked into the web build.
sudo -u airbag env HOME=/var/lib/airbag PATH="$NODE/bin:$PATH" COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  NEXT_TELEMETRY_DISABLED=1 \
  NEXT_PUBLIC_ENGINE_URL="https://$ENGINE_DOMAIN" NEXT_PUBLIC_SITE_URL="https://$DOMAIN" \
  bash -c "cd '$REL' &&
    corepack pnpm install --frozen-lockfile --filter '@airbag/engine...' --filter '@airbag/web...' &&
    corepack pnpm --filter @airbag/web build"

# Engine configuration, written once so later edits (say, live mode) survive deploys.
install -d -m 755 /etc/airbag
if [ ! -f /etc/airbag/engine.env ]; then
  cat >/etc/airbag/engine.env <<EOF
# The public simulation demo. ENGINE_MODE=live also needs MASTER_KEY; see docs/DEPLOY.md.
ENGINE_MODE=simulation
PERPL_NETWORK=testnet
HOST=127.0.0.1
PORT=8789
DATABASE_PATH=/var/lib/airbag/airbag-simulation-testnet.db
WEB_ORIGIN=https://$DOMAIN
CLIENT_IP_HEADER=x-real-ip
LOG_LEVEL=info
EOF
  chown root:airbag /etc/airbag/engine.env
  chmod 640 /etc/airbag/engine.env
fi

# Switch to the new release and restart.
install -m 644 "$REL/deploy/vm/airbag-engine.service" "$REL/deploy/vm/airbag-web.service" \
  /etc/systemd/system/
ln -sfn "$REL" /opt/airbag/app
systemctl daemon-reload
systemctl enable --quiet airbag-engine airbag-web
systemctl restart airbag-engine airbag-web

# Airbag's Caddy block, between its markers; the other sites stay as they are.
cf=/etc/caddy/Caddyfile
block=$(sed -n '/^# >>> airbag/,/^# <<< airbag/p' "$REL/deploy/vm/Caddyfile" |
  sed "s/AIRBAG_ENGINE_DOMAIN/$ENGINE_DOMAIN/; s/AIRBAG_DOMAIN/$DOMAIN/")
others=$(awk '/^# >>> airbag/{skip=1} !skip{print} /^# <<< airbag/{skip=0}' "$cf")
printf '%s\n\n%s\n' "$others" "$block" >"$cf.airbag"
if cmp -s "$cf" "$cf.airbag"; then
  rm "$cf.airbag"
else
  caddy validate --adapter caddyfile --config "$cf.airbag" >/dev/null
  cp -a "$cf" "$cf.bak-airbag-$(date +%Y%m%d%H%M%S)"
  mv "$cf.airbag" "$cf"
  systemctl reload caddy
fi

# Ready means the engine has fresh blocks and the web app answers.
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null http://127.0.0.1:8789/ready 2>/dev/null &&
    curl -fsS -o /dev/null http://127.0.0.1:3089/ 2>/dev/null && break
  sleep 1
done
curl -fsS -o /dev/null http://127.0.0.1:3089/
curl -fsS http://127.0.0.1:8789/ready
echo
# Keep the three newest releases for rollback.
ls -1dt /opt/airbag/releases/* | tail -n +4 | xargs -r rm -rf
