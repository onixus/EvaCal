#!/bin/sh
# Поднимает одноразовый PostgreSQL внутри CI-контейнера и печатает DATABASE_URL.
#
# Jenkins-агент — контейнер (node:alpine или playwright:noble), и сайдкар с БД
# ему не по сети: агент живёт в своей bridge-сети, а линковать контейнеры из
# declarative-пайплайна нельзя. Локальный сервер в том же контейнере снимает
# вопрос целиком: ни портов наружу, ни гонок за имя, ни чужого состояния.
#
# Использование (в sh-шаге под root):
#   export DATABASE_URL=$(sh scripts/ci-postgres.sh)
#
# Данные лежат в /tmp и исчезают вместе с контейнером.
set -eu

PGDATA=${CI_PGDATA:-/tmp/evacal-pg}
PGPORT=${CI_PGPORT:-5432}
DB=evacal
USER_=evacal
PASS=evacal

log() { echo "[ci-postgres] $*" >&2; }

if command -v apk >/dev/null 2>&1; then
  # alpine 3.21: postgresql16 и 17; берём 16 — как в docker-compose.
  apk add --no-cache postgresql16 postgresql16-contrib su-exec >/dev/null
  BIN=/usr/libexec/postgresql16
  [ -d "$BIN" ] || BIN=$(dirname "$(command -v initdb)")
  RUNAS="su-exec postgres"
elif command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null
  apt-get install -y -qq postgresql postgresql-contrib >/dev/null
  BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
  # setpriv из util-linux передаёт аргументы как есть; `su -c` склеивал бы их
  # в одну строку и терял кавычки вокруг опций pg_ctl -o.
  RUNAS="setpriv --reuid=postgres --regid=postgres --init-groups"
else
  log "не знаю, как поставить PostgreSQL в этом образе (нет apk и apt-get)"
  exit 1
fi

mkdir -p "$PGDATA" /run/postgresql
chown -R postgres:postgres "$PGDATA" /run/postgresql

run_pg() { $RUNAS "$@"; }

run_pg "$BIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
# fsync выключен: база одноразовая, а диск CI-контейнера медленный.
run_pg "$BIN/pg_ctl" -D "$PGDATA" -o "-p $PGPORT -k /run/postgresql -c fsync=off -c listen_addresses=127.0.0.1" -l "$PGDATA/log" -w start >/dev/null
run_pg "$BIN/psql" -p "$PGPORT" -h /run/postgresql -U postgres -v ON_ERROR_STOP=1 -q \
  -c "CREATE USER $USER_ WITH PASSWORD '$PASS';" \
  -c "CREATE DATABASE $DB OWNER $USER_;" >/dev/null

log "готов: postgresql://$USER_@127.0.0.1:$PGPORT/$DB"
echo "postgresql://$USER_:$PASS@127.0.0.1:$PGPORT/$DB?schema=public"
