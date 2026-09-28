#!/bin/sh
set -eu
# Совместимость со старым .env. Том сохраняет прежнее имя и dev.db в корне,
# но больше не перекрывает каталог схемы/миграций, поставляемый в образе.
case "${DATABASE_URL:-}" in
  file:./prisma/dev.db|file:./dev.db|file:dev.db)
    export DATABASE_URL=file:/app/data/dev.db ;;
esac
exec "$@"
