#!/bin/sh
set -eu
# Reject unsupported/missing runtime configuration before executing the command.
case "${DATABASE_URL:-}" in
  postgresql://*|postgres://*) ;;
  *) echo 'DATABASE_URL must be a PostgreSQL connection URL.' >&2; exit 1 ;;
esac
exec "$@"
