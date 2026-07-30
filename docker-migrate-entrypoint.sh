#!/bin/sh
# Runs as root so it can fix ownership of the mounted db-data volume (which Docker
# creates as root-owned on first use), then drops to the same uid the app container
# runs as before executing prisma/seed — otherwise the app can't open the db file.
set -e
chown -R nextjs:nodejs /app
exec su-exec nextjs:nodejs "$@"
