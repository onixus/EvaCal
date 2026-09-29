#!/bin/sh
set -eu
# Only the artifact directory is mutable; schemas/migrations remain in the image.
mkdir -p /app/storage
chown nextjs:nodejs /app/storage
exec su-exec nextjs:nodejs /usr/local/bin/docker-entrypoint.sh "$@"
