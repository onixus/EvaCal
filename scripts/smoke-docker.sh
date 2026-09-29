#!/usr/bin/env bash
# Real native-platform smoke test of candidate images, before mutable tag promotion.
set -euo pipefail
umask 077
APP="${1:?app image required}"; MIGRATE="${2:?migrate image required}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$(mktemp -d)"
PROJECT="evacal-smoke-$(date +%s)-$$"
compose() (
  local key
  local args=(-u COMPOSE_FILE -u COMPOSE_PROFILES -u COMPOSE_PROJECT_NAME)
  while IFS= read -r key; do args+=(-u "$key"); done < <(
    grep -hEo '\$\{[A-Z_][A-Z0-9_]*' "$DIR"/docker-compose*.yml | sed 's/^${//' | sort -u
  )
  env "${args[@]}" docker compose --project-name "$PROJECT" --project-directory "$DIR" --env-file "$DIR/.env" "$@"
)
cleanup() {
  local code=$?
  if [ "$code" -ne 0 ]; then compose ps -a >&2 || true; compose logs --tail=80 >&2 || true; fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$DIR"
  exit "$code"
}
trap cleanup EXIT
mkdir -p "$DIR/nginx" "$DIR/certs"
cp "$ROOT"/deploy/docker-compose*.yml "$DIR/"
cp "$ROOT/deploy/nginx/http.conf" "$DIR/nginx/nginx.conf"
cat > "$DIR/.env" <<ENV
COMPOSE_FILE=docker-compose.base.yml:docker-compose.postgres.yml
EVACAL_APP_REF=$APP
EVACAL_MIGRATE_REF=$MIGRATE
EVACAL_BIND_ADDRESS=127.0.0.1
EVACAL_HTTP_PORT=0
SESSION_SECRET=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
POSTGRES_PASSWORD=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
ENV
# Do not inherit application/database settings from the publisher's shell.
unset DATABASE_URL DATABASE_PROVIDER COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_NAME SESSION_SECRET POSTGRES_PASSWORD
compose config --quiet
compose pull
compose up -d --wait --wait-timeout 300
[ "$(compose exec -T app id -u)" = 1001 ]
compose exec -T web wget -qO- http://127.0.0.1/api/health
compose exec -T app node -e "const fs=require('fs'); fs.writeFileSync('/app/storage/.smoke','ok'); fs.unlinkSync('/app/storage/.smoke')"
# Deliberately put obsolete code-shaped files in the data volume. They must not
# shadow the schema or seed from the next image on migration rerun.
compose run --rm --no-deps -T migrate sh -c 'mkdir -p /app/data/postgresql; echo obsolete > /app/data/postgresql/schema.prisma; ! grep -q obsolete /app/prisma/postgresql/schema.prisma'
compose stop app web
compose rm -sf migrate
compose up -d --wait --wait-timeout 300
compose exec -T web wget -qO- http://127.0.0.1/api/health
# Verify that nginx can read a private key with mode 600 and the HTTP health probe
# still works when HTTPS redirects are enabled.
openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj /CN=localhost \
  -keyout "$DIR/certs/privkey.pem" -out "$DIR/certs/fullchain.pem" >/dev/null 2>&1
chmod 600 "$DIR/certs/privkey.pem"
sed 's/__HTTPS_PORT_SUFFIX__//g' "$ROOT/deploy/nginx/https.conf" > "$DIR/nginx/nginx.conf"
printf '\nCOMPOSE_FILE=docker-compose.base.yml:docker-compose.postgres.yml:docker-compose.tls.yml\nEVACAL_HTTPS_PORT=0\n' >> "$DIR/.env"
compose up -d --no-deps --force-recreate --wait --wait-timeout 120 web
compose exec -T web wget -qO- http://127.0.0.1/api/health
printf '\nDocker smoke passed: migration rerun, non-root app, writable storage, HTTP/TLS nginx.\n'
