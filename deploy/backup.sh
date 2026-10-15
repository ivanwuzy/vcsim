#!/bin/sh
set -eu
# Run from the repository root; uses container credentials, never prints secrets.
mkdir -p backups
task_stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T postgres pg_dump -U vcgame -d vcgame -Fc > "backups/vcgame-$task_stamp.dump"
test -s "backups/vcgame-$task_stamp.dump"
printf 'Backup saved: backups/vcgame-%s.dump\n' "$task_stamp"
