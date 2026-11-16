#!/usr/bin/env bash
# Nightly backup of your tasks database (keeps the last 14). Installed as a cron job by oracle-setup.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/backups
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
$DOCKER compose exec -T app node -e "require('better-sqlite3')('/data/planner.db').backup('/data/backups/planner-$(date +%F).db').then(()=>console.log('backup ok'))"
ls -1t data/backups/planner-*.db | tail -n +15 | xargs -r rm --
