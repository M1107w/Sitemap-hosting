#!/usr/bin/env bash
# One-time setup on a fresh Oracle Cloud "Always Free" Ubuntu VM (ARM, A1.Flex).
# Run from the planner folder:  bash deploy/oracle-setup.sh
# Safe to run again; it skips what's already done.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

say "0/5 Basic tools (Oracle's minimal Ubuntu image leaves these out)"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git curl cron iptables iptables-persistent ca-certificates

say "1/5 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
else
  echo "already installed"
fi
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"

say "2/5 Firewall: open ports 80 + 443 (Oracle's Ubuntu image blocks them by default)"
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 6 -p tcp -m state --state NEW --dport "$port" -j ACCEPT
  fi
done
if command -v netfilter-persistent >/dev/null 2>&1; then
  sudo netfilter-persistent save
else
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent && sudo netfilter-persistent save
fi
echo "Remember: also add ingress rules for 80 and 443 in the Oracle web console (see MORNING_REPORT step 2)."

say "3/5 Swap (a safety net for builds)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
else
  echo "already on"
fi

say "4/5 Settings (.env)"
if [ ! -f .env ]; then
  cp .env.example .env
  read -rp "Your DuckDNS domain (e.g. myplanner.duckdns.org): " dom
  sed -i "s/^DOMAIN=.*/DOMAIN=${dom}/" .env
fi
grep '^DOMAIN=' .env
mkdir -p data

say "Nightly backup at 04:00"
{ crontab -l 2>/dev/null | grep -v planner-backup || true; echo "0 4 * * * $(pwd)/deploy/backup.sh >/dev/null 2>&1 # planner-backup"; } | crontab - || echo "(couldn't set up the backup job; skipping)"

say "5/5 Build + start everything (first time: ~10–20 min, downloads the AI model ~2.5 GB)"
$DOCKER compose up -d --build
echo
$DOCKER compose ps
DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)
cat <<MSG

Done. In a few minutes open:  https://${DOMAIN}
  • iPhone: open in Safari → Share → Add to Home Screen → open it from the home screen
  • Laptop: open in Edge or Chrome → click the "Install app" icon in the address bar

Watch the AI model download:   $DOCKER compose logs -f ollama-pull
Check everything is healthy:   curl -s https://${DOMAIN}/api/health
Update later:                  git pull && $DOCKER compose up -d --build
MSG
