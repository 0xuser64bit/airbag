#!/usr/bin/env bash
# Deploys the committed HEAD to the VM as Airbag's public simulation demo (docs/DEPLOY.md):
# ships the tree with git archive, then provision.sh builds it on the VM and switches to it.
#
#   deploy/vm/deploy.sh
#
# Overrides: AIRBAG_VM (ssh target), AIRBAG_VM_KEY (ssh key), AIRBAG_DOMAIN (the public
# hostname, any name pointing at the VM; the engine is served under /engine on it).
set -euo pipefail

VM=${AIRBAG_VM:-ubuntu@92.4.67.109}
KEY=${AIRBAG_VM_KEY:-$HOME/.ssh/ssh-key-2026-02-26.key}
DOMAIN=${AIRBAG_DOMAIN:-airbag.user64bit.world}
NODE_VERSION=24.21.0

cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain)" ]; then
  echo "Commit first: the deploy ships HEAD, not the working tree." >&2
  exit 1
fi
SHA=$(git rev-parse --short=12 HEAD)
vm() { ssh -i "$KEY" -o BatchMode=yes "$VM" "$@"; }

echo "Shipping $SHA to $VM"
git archive --format=tar HEAD |
  vm "sudo rm -rf /opt/airbag/releases/$SHA &&
    sudo mkdir -p /opt/airbag/releases/$SHA &&
    sudo tar -x -C /opt/airbag/releases/$SHA"

vm "sudo SHA=$SHA DOMAIN=$DOMAIN NODE_VERSION=$NODE_VERSION \
  bash /opt/airbag/releases/$SHA/deploy/vm/provision.sh"

# From outside, through Caddy and its certificates.
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "https://$DOMAIN/engine/ready" 2>/dev/null &&
    curl -fsS -o /dev/null "https://$DOMAIN/" 2>/dev/null && break
  sleep 2
done
curl -fsS "https://$DOMAIN/engine/ready"
echo
echo "Live: https://$DOMAIN"
