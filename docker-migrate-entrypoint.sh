#!/bin/sh
set -eu
# Только изменяемые данные, не рекурсивный chown всего приложения/node_modules.
mkdir -p /app/data /app/storage
chown nextjs:nodejs /app/data /app/storage
for file in /app/data/dev.db /app/data/dev.db-wal /app/data/dev.db-shm /app/data/dev.db-journal; do
  [ ! -f "$file" ] || chown nextjs:nodejs "$file"
done
exec su-exec nextjs:nodejs /usr/local/bin/docker-entrypoint.sh "$@"
