#!/usr/bin/env bash
# EvaCal: install and lifecycle manager. Bash 3.2+ (Linux, macOS, WSL2).
# No Node.js, git or Python is required when using published images.
set -euo pipefail
umask 077

EVACAL_RAW_BASE="${EVACAL_RAW_BASE:-https://raw.githubusercontent.com/onixus/EvaCal}"
CONF_FILES='docker-compose.yml docker-compose.base.yml docker-compose.postgres.yml docker-compose.tls.yml docker-compose.build.yml nginx/http.conf nginx/https.conf'
HEALTH_TIMEOUT="${EVACAL_HEALTH_TIMEOUT:-300}"
info() { printf '==> %s\n' "$*"; }
warn() { printf '[!] %s\n' "$*" >&2; }
die() { printf '[x] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'HELP'
EvaCal — установка и управление
  bash install.sh install [параметры]
  evacal status | doctor | logs [сервис] | start | stop | restart
  evacal update [--version TAG] [--skip-backup]
  evacal backup | restore ФАЙЛ | passwords | uninstall [--purge]

  --local              локальный стенд: localhost:8080, bind 127.0.0.1, без TLS
  --dir DIR            каталог (/opt/evacal для root, ~/evacal иначе)
  --project NAME       отдельный Compose-проект (по умолчанию evacal)
  --version TAG        одинаковый тег app и migrate; vX.Y.Z также допустим
  --domain HOST        DNS-имя или IPv4 для адреса и сертификата
  --bind IPv4          адрес публикации портов (по умолчанию 0.0.0.0)
  --http-port N        HTTP-порт (80; --local: 8080)
  --https-port N       HTTPS-порт (443; --local: 8443)
  --no-tls | --tls     HTTP за внешним прокси / HTTPS (по умолчанию HTTPS)
  --secure-cookies     Secure-cookie за внешним HTTPS-прокси с --no-tls
  --cert FILE --key FILE  сертификат и ключ; иначе самоподписанный сертификат
  --database-url URL   внешний PostgreSQL, без лишнего контейнера postgres
  --source [PATH]      сборка текущего клона, без автоматических git pull/checkout
  --seed-password P    общий пароль только для тестового стенда
  --skip-backup        явно пропустить бэкап перед обновлением
  --yes, -y           без вопросов; также подтверждает опасные команды
  --help, -h          справка

Переменные: EVACAL_DIR, EVACAL_TAG, EVACAL_DOMAIN, EVACAL_HEALTH_TIMEOUT.
Для update без --version сохраняется выбранный тег/канал, а не переход на latest.
HELP
}

parse_args() {
  COMMAND=''; OPT_DIR="${EVACAL_DIR:-}"; OPT_TAG="${EVACAL_TAG:-}"
  OPT_DOMAIN="${EVACAL_DOMAIN:-}"; OPT_SOURCE=''; OPT_PROJECT=''; OPT_BIND=''
  OPT_HTTP_PORT=''; OPT_HTTPS_PORT=''; OPT_TLS=''; OPT_CERT=''; OPT_KEY=''
  OPT_DATABASE_URL=''; OPT_SEED_PASSWORD=''; OPT_YES=''
  OPT_PURGE=''; OPT_LOCAL=''; OPT_SKIP_BACKUP=''; OPT_SECURE=''; ARGS=()
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --dir|--version|--domain|--project|--bind|--http-port|--https-port|--cert|--key|--database-url|--seed-password)
        [ "$#" -ge 2 ] && [ -n "$2" ] && [ "${2#--}" = "$2" ] || die "Для $1 требуется значение (см. --help)." ;;
    esac
    case "$1" in
      install|update|status|doctor|logs|passwords|backup|restore|start|stop|restart|uninstall)
        if [ -z "$COMMAND" ]; then COMMAND="$1"; else ARGS+=("$1"); fi ;;
      --dir) OPT_DIR="$2"; shift ;; --dir=*) OPT_DIR="${1#*=}" ;;
      --version) OPT_TAG="$2"; shift ;; --version=*) OPT_TAG="${1#*=}" ;;
      --domain) OPT_DOMAIN="$2"; shift ;; --domain=*) OPT_DOMAIN="${1#*=}" ;;
      --project) OPT_PROJECT="$2"; shift ;; --project=*) OPT_PROJECT="${1#*=}" ;;
      --bind) OPT_BIND="$2"; shift ;; --bind=*) OPT_BIND="${1#*=}" ;;
      --http-port) OPT_HTTP_PORT="$2"; shift ;; --http-port=*) OPT_HTTP_PORT="${1#*=}" ;;
      --https-port) OPT_HTTPS_PORT="$2"; shift ;; --https-port=*) OPT_HTTPS_PORT="${1#*=}" ;;
      --cert) OPT_CERT="$2"; shift ;; --cert=*) OPT_CERT="${1#*=}" ;;
      --key) OPT_KEY="$2"; shift ;; --key=*) OPT_KEY="${1#*=}" ;;
      --database-url) OPT_DATABASE_URL="$2"; shift ;; --database-url=*) OPT_DATABASE_URL="${1#*=}" ;;
      --seed-password) OPT_SEED_PASSWORD="$2"; shift ;; --seed-password=*) OPT_SEED_PASSWORD="${1#*=}" ;;
      --source)
        OPT_SOURCE=auto
        if [ "$#" -gt 1 ] && [ "${2#-}" = "$2" ]; then OPT_SOURCE="$2"; shift; fi ;;
      --source=*) OPT_SOURCE="${1#*=}" ;;
      --no-tls) OPT_TLS=no ;; --tls) OPT_TLS=yes ;; --secure-cookies) OPT_SECURE=true ;;
      --local) OPT_LOCAL=yes ;;
      --skip-backup) OPT_SKIP_BACKUP=yes ;; --purge) OPT_PURGE=yes ;;
      --yes|-y) OPT_YES=yes ;; --help|-h) usage; exit 0 ;;
      -*) die "Неизвестный параметр: $1" ;;
      *) ARGS+=("$1") ;;
    esac
    shift
  done
  COMMAND="${COMMAND:-install}"
  [ -z "$OPT_CERT$OPT_KEY" ] || { [ -n "$OPT_CERT" ] && [ -n "$OPT_KEY" ]; } || die '--cert и --key задаются вместе.'
  if [ -n "$OPT_LOCAL" ]; then
    OPT_DOMAIN="${OPT_DOMAIN:-localhost}"; OPT_BIND="${OPT_BIND:-127.0.0.1}"
    OPT_HTTP_PORT="${OPT_HTTP_PORT:-8080}"; OPT_HTTPS_PORT="${OPT_HTTPS_PORT:-8443}"; OPT_TLS="${OPT_TLS:-no}"
  fi
  [[ "$HEALTH_TIMEOUT" =~ ^[1-9][0-9]*$ ]] || die 'EVACAL_HEALTH_TIMEOUT должен быть положительным числом.'
  case "$COMMAND" in
    logs|restore) [ "${#ARGS[@]}" -le 1 ] || die 'Лишние позиционные аргументы.' ;;
    *) [ "${#ARGS[@]}" -eq 0 ] || die "Неизвестная команда/аргумент: ${ARGS[*]}" ;;
  esac
}

resolve_script() {
  local path="${BASH_SOURCE[0]:-}" link count=0
  SCRIPT_PATH=''; SCRIPT_DIR=''; REPO_ROOT=''
  [ -f "$path" ] || return 0
  while [ -L "$path" ]; do
    count=$((count + 1)); [ "$count" -le 40 ] || die 'Циклическая ссылка на установщик.'
    link="$(readlink "$path")"
    case "$link" in /*) path="$link" ;; *) path="$(dirname "$path")/$link" ;; esac
  done
  SCRIPT_DIR="$(cd -P "$(dirname "$path")" && pwd)"
  SCRIPT_PATH="$SCRIPT_DIR/$(basename "$path")"
  [ ! -f "$SCRIPT_DIR/../Dockerfile" ] || REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
}

# Never source .env: values are data, not shell code. Escape dollars explicitly
# for Compose's double-quoted dotenv parser (including passwords containing $).
env_get() {
  local value
  [ -f "$INSTALL_DIR/.env" ] || return 0
  value="$(sed -n "s/^${1}=//p" "$INSTALL_DIR/.env" | tail -n 1)"
  if [[ "$value" == \"*\" ]]; then
    value="${value:1:${#value}-2}"
    value="${value//\\\$/\$}"; value="${value//\\\"/\"}"; value="${value//\\\\/\\}"
  elif [[ "$value" == \'*\' ]]; then
    value="${value:1:${#value}-2}"; value="${value//\\\'/\'}"
  fi
  printf '%s' "$value"
}
env_set() {
  local key="$1" value="$2" tmp
  [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || die 'Недопустимый ключ .env.'
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || die "Перенос строки недопустим в $key."
  tmp="$(mktemp "$INSTALL_DIR/.env.XXXXXX")"
  if [ -f "$INSTALL_DIR/.env" ]; then grep -v "^${key}=" "$INSTALL_DIR/.env" > "$tmp" || true; fi
  value="${value//\\/\\\\}"; value="${value//\"/\\\"}"; value="${value//\$/\\\$}"
  printf '%s="%s"\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"; mv -f "$tmp" "$INSTALL_DIR/.env"
}
env_unset() {
  local key="$1" tmp
  [ -f "$INSTALL_DIR/.env" ] || return 0
  tmp="$(mktemp "$INSTALL_DIR/.env.XXXXXX")"
  grep -v "^${key}=" "$INSTALL_DIR/.env" > "$tmp" || true
  chmod 600 "$tmp"; mv -f "$tmp" "$INSTALL_DIR/.env"
}
# Upgrade guard only: the historical provider flag must never silently select
# a new empty server. Normal configuration has no provider switch anymore.
validate_database_config() {
  case "$(env_get DATABASE_PROVIDER)" in
    ''|postgresql) ;;
    *) die 'Поддерживается только PostgreSQL. Сначала перенесите данные отдельно; текущая установка не изменена.' ;;
  esac
  case "$(env_get DATABASE_URL)" in
    ''|postgresql://*|postgres://*) ;;
    *) die 'DATABASE_URL должен указывать на PostgreSQL. Сначала перенесите данные отдельно; текущая установка не изменена.' ;;
  esac
}
env_default() { [ -n "$(env_get "$1")" ] || env_set "$1" "$2"; }
random_hex() { od -An -N"${1:-32}" -tx1 /dev/urandom | tr -d ' \n'; }
confirm() {
  local answer
  [ -z "$OPT_YES" ] || return 0
  if ! ( : < /dev/tty ) 2>/dev/null; then warn 'Нужно явное подтверждение: повторите с --yes.'; return 1; fi
  printf '%s [y/N] ' "$1" > /dev/tty
  read -r answer < /dev/tty || return 1
  case "$answer" in y|Y|yes|да) return 0 ;; *) return 1 ;; esac
}
compose() (
  # Explicit local configuration wins over unrelated exported developer settings.
  local key rest
  local unset_args=(-u COMPOSE_FILE -u COMPOSE_PROJECT_NAME -u COMPOSE_PROFILES)
  while IFS='=' read -r key rest; do
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] && unset_args+=(-u "$key")
  done < "$INSTALL_DIR/.env"
  # Also clear variables absent from .env but referenced by optional services.
  while IFS= read -r key; do unset_args+=(-u "$key"); done < <(
    grep -hEo '\$\{[A-Z_][A-Z0-9_]*' "$INSTALL_DIR"/docker-compose*.yml | sed 's/^${//' | sort -u
  )
  cd "$INSTALL_DIR"
  env "${unset_args[@]}" docker compose --project-directory "$INSTALL_DIR" --env-file "$INSTALL_DIR/.env" "$@"
)
check_docker() {
  local version major minor
  command -v docker >/dev/null 2>&1 || die 'Установите Docker Engine + Compose v2 (Linux) либо запустите Docker Desktop (macOS/Windows с WSL2).'
  version="$(docker compose version --short 2>/dev/null)" || die 'Нужен docker compose v2.20+, не docker-compose v1.'
  version="${version#v}"; major="${version%%.*}"; minor="${version#*.}"; minor="${minor%%.*}"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] || die "Не удалось определить версию Compose: $version"
  (( major > 2 || (major == 2 && minor >= 20) )) || die "Нужен Compose v2.20+, установлен $version."
  docker info >/dev/null 2>&1 || die 'Docker недоступен. Запустите демон/Desktop и проверьте права пользователя; на macOS не запускайте установщик через sudo.'
}
require_installed() {
  [ -f "$INSTALL_DIR/.env" ] && [ -f "$INSTALL_DIR/docker-compose.yml" ] || die "В $INSTALL_DIR нет установки EvaCal. Укажите --dir."
  check_docker
}
valid_port() { [[ "$1" =~ ^[0-9]{1,5}$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535)); }
normalize_tag() {
  local tag="$1"
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]] && tag="${tag#v}"
  [[ "$tag" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] || die "Недопустимый Docker-тег: $tag"
  printf '%s' "$tag"
}

configure() {
  validate_database_config
  local tag="$1" source="$2" domain tls http https project old_project bind files octet
  old_project="$(env_get COMPOSE_PROJECT_NAME)"; project="${OPT_PROJECT:-${old_project:-evacal}}"
  [[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die 'Имя проекта: строчные латинские буквы, цифры, _ и -.'
  [ -z "$old_project" ] || [ "$old_project" = "$project" ] || die 'Нельзя менять проект существующей установки: это подключит другие тома.'
  domain="${OPT_DOMAIN:-$(env_get EVACAL_DOMAIN)}"; domain="${domain:-$(hostname)}"
  [[ "$domain" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || die 'В --domain укажите только DNS-имя или IPv4, без протокола и порта.'
  tls="${OPT_TLS:-$(env_get EVACAL_TLS)}"; tls="${tls:-yes}"
  http="${OPT_HTTP_PORT:-$(env_get EVACAL_HTTP_PORT)}"; http="${http:-80}"
  https="${OPT_HTTPS_PORT:-$(env_get EVACAL_HTTPS_PORT)}"; https="${https:-443}"
  valid_port "$http" && valid_port "$https" || die 'Порты должны быть числами от 1 до 65535.'
  [ "$tls" != yes ] || [ "$http" != "$https" ] || die 'HTTP и HTTPS требуют разных портов.'
  bind="${OPT_BIND:-$(env_get EVACAL_BIND_ADDRESS)}"; bind="${bind:-0.0.0.0}"
  [[ "$bind" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die '--bind должен быть IPv4-адресом (например, 127.0.0.1).'
  for octet in ${bind//./ }; do
    [[ "$octet" =~ ^[0-9]{1,3}$ ]] && ((10#$octet <= 255)) || die 'Некорректный IPv4 в --bind.'
  done
  env_set COMPOSE_PROJECT_NAME "$project"; env_set EVACAL_TAG "$tag"
  env_set EVACAL_DOMAIN "$domain"; env_set EVACAL_TLS "$tls"; env_set EVACAL_BIND_ADDRESS "$bind"
  env_set EVACAL_HTTP_PORT "$http"; env_set EVACAL_HTTPS_PORT "$https"; env_set EVACAL_SOURCE "$source"
  env_default EVACAL_IMAGE ghcr.io/onixus/evacal; env_default EVACAL_MIGRATE_IMAGE ghcr.io/onixus/evacal-migrate
  env_default SESSION_SECRET "$(random_hex)"; env_default SHARE_TOKEN_SECRET "$(random_hex)"
  if [ -n "$OPT_DATABASE_URL" ]; then
    case "$OPT_DATABASE_URL" in postgresql://*|postgres://*) ;; *) die '--database-url должен указывать на PostgreSQL.' ;; esac
    env_set DATABASE_URL "$OPT_DATABASE_URL"
  fi
  env_unset DATABASE_PROVIDER
  files=docker-compose.base.yml
  if [ -z "$(env_get DATABASE_URL)" ]; then
    env_default POSTGRES_DB evacal; env_default POSTGRES_USER evacal; env_default POSTGRES_PASSWORD "$(random_hex 24)"
    files="$files:docker-compose.postgres.yml"
  fi
  [ "$tls" != yes ] || files="$files:docker-compose.tls.yml"
  [ -z "$source" ] || files="$files:docker-compose.build.yml"
  env_set COMPOSE_FILE "$files"
  # Explicit opt-in for standalone's internal 0.0.0.0 URL behind local nginx.
  env_set EVACAL_LOCAL_HTTP false
  if [ "$bind" = 127.0.0.1 ] && [ "$tls" != yes ]; then env_set EVACAL_LOCAL_HTTP true; fi
  if [ -n "$OPT_SECURE" ]; then env_set FORCE_SECURE_COOKIES true
  elif [ -n "$OPT_TLS" ] || [ -z "$(env_get FORCE_SECURE_COOKIES)" ]; then
    if [ "$tls" = yes ]; then env_set FORCE_SECURE_COOKIES true; else env_set FORCE_SECURE_COOKIES false; fi
  fi
  [ -z "$OPT_SEED_PASSWORD" ] || env_set SEED_DEFAULT_PASSWORD "$OPT_SEED_PASSWORD"
}

fetch_config() {
  local ref="$1" source="$2" file bundle=''
  if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/RELEASE" ] && [ "$(sed -n 's/^REVISION=//p' "$SCRIPT_DIR/RELEASE")" = "$ref" ]; then bundle="$SCRIPT_DIR"; fi
  mkdir -p "$INSTALL_DIR/nginx"
  for file in $CONF_FILES; do
    if [ -n "$source" ]; then
      cp "$source/deploy/$file" "$INSTALL_DIR/$file"
    elif [ -n "$bundle" ]; then
      cp "$bundle/$file" "$INSTALL_DIR/$file"
    else
      command -v curl >/dev/null 2>&1 || die 'Для загрузки конфигурации нужен curl (либо используйте полный deploy-архив версии).'
      curl --fail --silent --show-error --location --retry 3 --connect-timeout 10 --max-time 120 \
        "$EVACAL_RAW_BASE/$ref/deploy/$file" -o "$INSTALL_DIR/$file" || die "Не удалось загрузить deploy/$file для $ref. Текущая установка не изменена."
    fi
  done
  # Atomic replacement later: never truncate the script that Bash is executing.
  if [ -n "$source" ]; then cp "$source/deploy/install.sh" "$INSTALL_DIR/evacal"
  elif [ -n "$bundle" ]; then cp "$bundle/install.sh" "$INSTALL_DIR/evacal"
  else
    curl --fail --silent --show-error --location --retry 3 --connect-timeout 10 --max-time 120 \
      "$EVACAL_RAW_BASE/$ref/deploy/install.sh" -o "$INSTALL_DIR/evacal"
  fi
  bash -n "$INSTALL_DIR/evacal"
  chmod 755 "$INSTALL_DIR/evacal"
}
prepare_tls() {
  local domain suffix='' certdir="$INSTALL_DIR/certs"
  mkdir -p "$certdir"
  if [ "$(env_get EVACAL_TLS)" != yes ]; then
    cp "$INSTALL_DIR/nginx/http.conf" "$INSTALL_DIR/nginx/nginx.conf"; return
  fi
  domain="$(env_get EVACAL_DOMAIN)"
  [ "$(env_get EVACAL_HTTPS_PORT)" = 443 ] || suffix=":$(env_get EVACAL_HTTPS_PORT)"
  sed "s/__HTTPS_PORT_SUFFIX__/$suffix/g" "$INSTALL_DIR/nginx/https.conf" > "$INSTALL_DIR/nginx/nginx.conf"
  if [ -n "$OPT_CERT" ]; then
    cp "$OPT_CERT" "$certdir/fullchain.pem"; cp "$OPT_KEY" "$certdir/privkey.pem"
  elif [ ! -f "$certdir/fullchain.pem" ] || [ ! -f "$certdir/privkey.pem" ]; then
    command -v openssl >/dev/null 2>&1 || die 'Нужен openssl, либо --cert/--key, либо --local/--no-tls.'
    local san="DNS:$domain,DNS:localhost,IP:127.0.0.1"
    [[ "$domain" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && san="IP:$domain,DNS:localhost,IP:127.0.0.1"
    openssl req -x509 -nodes -newkey rsa:2048 -days 365 -keyout "$certdir/privkey.pem" \
      -out "$certdir/fullchain.pem" -subj "/CN=$domain/O=EvaCal" -addext "subjectAltName=$san" >/dev/null 2>&1
    warn 'Создан самоподписанный сертификат: браузер покажет предупреждение.'
  fi
  # nginx master runs as root; the private key need not be world-readable.
  chmod 600 "$certdir/privkey.pem"; chmod 644 "$certdir/fullchain.pem"
}

pull_pair() {
  local tag="$1" image revision='' previous='' digest index=0
  for image in "$(env_get EVACAL_IMAGE)" "$(env_get EVACAL_MIGRATE_IMAGE)"; do
    docker pull "$image:$tag" || die "Не удалось скачать $image:$tag. Проверьте тег, доступность пакета GHCR и архитектуру; либо используйте --source."
    revision="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image:$tag")"
    [[ "$revision" =~ ^[a-f0-9]{40}$ ]] || revision='legacy'
    if [ "$index" -eq 0 ]; then previous="$revision"
    else [ "$revision" = "$previous" ] || die 'app и migrate относятся к разным коммитам. Обновление прервано; повторите после завершения публикации.'; fi
    digest="$(docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$image:$tag" | grep -F "$image@sha256:" | head -n 1)"
    [[ "${digest##*@sha256:}" =~ ^[a-f0-9]{64}$ ]] || die "Не удалось закрепить digest образа $image:$tag."
    if [ "$index" -eq 0 ]; then env_set EVACAL_APP_REF "$digest"; else env_set EVACAL_MIGRATE_REF "$digest"; fi
    index=$((index + 1))
  done
  if [ "$revision" = legacy ]; then
    warn 'Старые образы без OCI revision: совместимость пары проверить нельзя. Перепубликуйте их обновлённым Jenkinsfile.publish.'
    case "$tag" in latest) CONFIG_REF=main ;; [0-9]*) CONFIG_REF="v$tag" ;; *) CONFIG_REF="$tag" ;; esac
  else CONFIG_REF="$revision"; fi
  env_set EVACAL_CONFIG_REF "$CONFIG_REF"
}

service_state() {
  local id
  id="$(compose ps -a -q "$1" 2>/dev/null | head -n 1)"
  [ -n "$id" ] || { printf 'absent'; return; }
  docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id"
}
print_address() {
  local scheme=http port domain
  domain="$(env_get EVACAL_DOMAIN)"; port="$(env_get EVACAL_HTTP_PORT)"
  if [ "$(env_get EVACAL_TLS)" = yes ]; then scheme=https; port="$(env_get EVACAL_HTTPS_PORT)"; fi
  info "Адрес: $scheme://$domain:$port   каталог: $INSTALL_DIR"
}
diagnostics() {
  compose ps -a >&2 || true
  compose logs --no-color --tail=40 app web migrate >&2 || true
}
wait_healthy() {
  local waited=0 app web
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    app="$(service_state app)"; web="$(service_state web)"
    if [ "$app" = 'running healthy' ] && [ "$web" = 'running healthy' ]; then return 0; fi
    case "$app/$web" in *exited*|*dead*) break ;; esac
    sleep 3; waited=$((waited + 3))
  done
  diagnostics
  die "Нет готовности app и web. Проверьте: $INSTALL_DIR/evacal doctor и logs."
}
start_stack() {
  if ! compose up -d --remove-orphans; then diagnostics; die 'Запуск не завершён. Данные не удалялись; проверьте логи миграции.'; fi
  # nginx resolves app at startup; recreate it after app gets a new IP.
  compose up -d --no-deps --force-recreate web
  wait_healthy; print_address
}
print_credentials() {
  local banner
  banner="$(compose logs --no-color migrate 2>/dev/null | sed 's/^[^|]*| //' | awk '/^=======/{f=!f; next} f')"
  if [ -n "$banner" ]; then
    printf '%s\n' "$banner" > "$INSTALL_DIR/credentials.txt"; chmod 600 "$INSTALL_DIR/credentials.txt"
    printf '%s\n' "$banner"
    warn "Пароли: $INSTALL_DIR/credentials.txt (600). Смените их при первом входе и удалите файл."
  fi
}

# Download/build/validate in a private staging directory. Failed preparation never
# overwrites live .env, nginx config or installer, and never stops existing services.
cmd_install() (
  validate_database_config
  check_docker
  local target="$INSTALL_DIR" stage source tag fresh=yes file rollback='' owner_dir project
  local resume_old=no old_running='' backup_image='' old_app=''
  local EVACAL_BACKUP_IMAGE=''
  [ ! -f "$target/.env" ] || fresh=no
  mkdir -p "$target"; target="$(cd -P "$target" && pwd)"; INSTALL_DIR="$target"
  source="${OPT_SOURCE:-$(env_get EVACAL_SOURCE)}"
  if [ "$source" = auto ]; then source="$REPO_ROOT"; [ -n "$source" ] || die '--source без пути доступен только из клона EvaCal.'; fi
  if [ -n "$source" ]; then
    source="$(cd "$source" && pwd)"; [ -f "$source/Dockerfile" ] || die 'В --source нет Dockerfile.'
    info "Сборка текущих исходников: $source (git pull/checkout не выполняется)."
  fi
  tag="${OPT_TAG:-$(env_get EVACAL_TAG)}"
  if [ -z "$tag" ] && [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/RELEASE" ]; then
    tag="$(sed -n 's/^VERSION=//p' "$SCRIPT_DIR/RELEASE")"
  fi
  tag="$(normalize_tag "${tag:-latest}")"
  stage="$(mktemp -d "$target/.prepare.XXXXXX")"
  trap 'code=$?; rm -rf "$stage"; [ -z "$backup_image" ] || docker image rm "$backup_image" >/dev/null 2>&1 || true; if [ "$resume_old" = yes ] && [ -n "$old_running" ]; then docker start $old_running || code=1; fi; exit "$code"' EXIT
  if [ "$fresh" = no ]; then cp "$target/.env" "$stage/.env"; fi
  if [ -d "$target/certs" ]; then cp -R "$target/certs" "$stage/certs"; fi
  INSTALL_DIR="$stage"; configure "$tag" "$source"
  project="$(env_get COMPOSE_PROJECT_NAME)"
  owner_dir="$(docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.Label "com.docker.compose.project.working_dir"}}' | head -n 1)"
  [ -z "$owner_dir" ] || [ "$owner_dir" = "$target" ] || die "Проект $project уже используется в $owner_dir. Выберите другой --project и --dir."
  # Keep the old runtime image addressable while build/pull replaces its tag.
  # Preparation still happens before stopping writers; failures leave them running.
  if [ "$fresh" = no ] && [ "$COMMAND" = update ] && [ -z "$OPT_SKIP_BACKUP" ]; then
    INSTALL_DIR="$target"
    old_app="$(compose ps -a -q app | head -n 1)"
    [ -n "$old_app" ] || die 'Для backup нужен существующий контейнер app.'
    backup_image="evacal-backup:${project}-$(basename "$stage" | tr '[:upper:]' '[:lower:]')-$$"
    docker image tag "$(docker inspect -f '{{.Image}}' "$old_app")" "$backup_image"
    EVACAL_BACKUP_IMAGE="$backup_image"
    INSTALL_DIR="$stage"
  fi
  if [ -n "$source" ]; then
    CONFIG_REF=source
  else
    pull_pair "$tag"
  fi
  fetch_config "$CONFIG_REF" "$source"; prepare_tls
  compose config --quiet
  if [ -n "$source" ]; then
    compose build app migrate
    compose pull web
    case "$(env_get COMPOSE_FILE)" in *docker-compose.postgres.yml*) compose pull postgres ;; esac
  else
    compose pull
  fi
  # Run backup against the OLD config, before replacing it or applying migrations.
  INSTALL_DIR="$target"
  if [ "$fresh" = no ]; then
    rollback="$(mktemp -d "$target/.rollback.XXXXXX")"
    cp "$target/.env" "$rollback/.env"
    for file in $CONF_FILES evacal; do
      if [ -f "$target/$file" ]; then mkdir -p "$rollback/$(dirname "$file")"; cp "$target/$file" "$rollback/$file"; fi
    done
    [ ! -f "$target/nginx/nginx.conf" ] || cp "$target/nginx/nginx.conf" "$rollback/nginx/nginx.conf"
    if [ "$COMMAND" = update ] && [ -z "$OPT_SKIP_BACKUP" ]; then
      old_running="$(running_container_ids)"
      cmd_backup keep-stopped
      resume_old=yes
    else
      compose stop app web
    fi
    info "Предыдущая конфигурация: $rollback. Откат схемы БД автоматически НЕ выполняется."
  fi
  mkdir -p "$target/nginx" "$target/certs"
  # After the first live file changes, do not restart an old app automatically:
  # migration/config errors require operator recovery with the saved backup.
  resume_old=no
  for file in $CONF_FILES nginx/nginx.conf evacal .env; do mv -f "$stage/$file" "$target/$file"; done
  if [ -f "$stage/certs/privkey.pem" ]; then
    mv -f "$stage/certs/privkey.pem" "$target/certs/privkey.pem"
    mv -f "$stage/certs/fullchain.pem" "$target/certs/fullchain.pem"
  fi
  printf 'EvaCal\n' > "$target/.evacal-installation"
  # A completed old migrate container must not suppress migrations on reinstall/update.
  compose rm -sf migrate
  start_stack; print_credentials
  local bin="${EVACAL_BIN_DIR:-$HOME/.local/bin}"
  if [ "$(id -u)" -eq 0 ] && [ -z "${EVACAL_BIN_DIR:-}" ]; then bin=/usr/local/bin; fi
  mkdir -p "$bin" 2>/dev/null || true
  if [ -w "$bin" ] && [ ! -e "$bin/evacal" ]; then ln -s "$target/evacal" "$bin/evacal"; fi
  info "Управление: $target/evacal --help"
)

# Inspect actual mounts: works for custom project names and older installations
# where migrate did not mount the artifact storage.
volume_info() {
  local container="$1" destination="$2"
  docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$destination\"}}{{.Name}}{{end}}{{end}}" "$container"
}
app_volume() {
  local volume
  volume="$(volume_info "$APP_CONTAINER" "$1")"
  [ -n "$volume" ] || die "Не найден именованный том приложения для $1. Для bind-mount нужен отдельный бэкап."
  printf '%s' "$volume"
}

# Start/stop exactly these containers, never resolve a mutable image tag via up.
running_container_ids() {
  local service id
  for service in app web; do
    id="$(compose ps -a -q "$service" | head -n 1)"
    [ -n "$id" ] || continue
    if [ "$(docker inspect -f '{{.State.Running}}' "$id")" = true ]; then printf '%s\n' "$id"; fi
  done
}

# Strip only Prisma's application/pool options, retaining libpq options byte for
# byte (notably sslmode, certificates, options and percent-encoded credentials).
# Unknown/TLS-specific options are NOT silently discarded: psql preflight must
# accept them before any running service is stopped. The application URL is kept.
postgres_cli_url() {
  local url="$1" base query part key kept=''
  case "$url" in postgresql://*|postgres://*) ;; *) die 'Для PostgreSQL CLI нужен postgresql:// URL.' ;; esac
  [[ "$url" != *$'\n'* && "$url" != *$'\r'* ]] || die 'Перенос строки в URL недопустим.'
  if [[ "$url" != *'?'* ]]; then printf '%s' "$url"; return; fi
  base="${url%%\?*}"; query="${url#*\?}"
  while [ -n "$query" ]; do
    part="${query%%&*}"
    if [[ "$query" == *'&'* ]]; then query="${query#*&}"; else query=''; fi
    key="${part%%=*}"
    [[ "$key" =~ ^[a-z_][a-z0-9_]*$ && "$part" == *'='* ]] || die 'Некорректный query-параметр PostgreSQL URL.'
    case "$key" in
      schema|connection_limit|pool_timeout|pgbouncer|statement_cache_size|socket_timeout) ;;
      *) kept="${kept}${kept:+&}${part}" ;;
    esac
  done
  printf '%s%s' "$base" "${kept:+?$kept}"
}

# A fresh client container in the application's network also supports legacy
# stacks without db-tools. Pass the URL through the environment, not host argv.
pg_tools() (
  local container network
  container="$(compose ps -a -q app | head -n 1)"
  [ -n "$container" ] || die 'Для внешней БД нужен существующий контейнер app и его сеть.'
  network="$(docker inspect -f '{{range $name, $value := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$container" | head -n 1)"
  [ -n "$network" ] || die 'Не удалось определить Docker-сеть внешней БД.'
  export EVACAL_PG_URL
  EVACAL_PG_URL="$(postgres_cli_url "$(env_get DATABASE_URL)")" || return 1
  docker run --rm -i --network "$network" --env EVACAL_PG_URL --env PGCONNECT_TIMEOUT=10 \
    postgres:16-alpine sh -c 'exec "$@" --dbname="$EVACAL_PG_URL"' pg-tools "$@"
)
pg_preflight() {
  pg_tools psql -X --no-password --set=ON_ERROR_STOP=1 -Atc 'SELECT 1' >/dev/null \
    || die 'PostgreSQL CLI не смог подключиться. Проверьте URL/TLS/права; сервисы ещё не остановлены.'
}

cmd_backup() (
  require_installed
  validate_database_config
  [ -z "$(env_get S3_BUCKET)" ] && [ "$(env_get GOST_PACKAGE_STORAGE)" != s3 ] || die 'S3 не входит в локальный backup. Сделайте согласованный бэкап БД и S3 отдельно; для update затем явно задайте --skip-backup.'
  local tmp out running='' APP_CONTAINER image storage_volume
  local resume="${1:-resume}"
  APP_CONTAINER="$(compose ps -a -q app | head -n 1)"
  [ -n "$APP_CONTAINER" ] || die 'Для backup нужен существующий контейнер app (может быть остановлен).'
  image="${EVACAL_BACKUP_IMAGE:-$(docker inspect -f '{{.Image}}' "$APP_CONTAINER")}"
  storage_volume="$(app_volume /app/storage)"
  if [ -n "$(env_get DATABASE_URL)" ]; then pg_preflight; fi
  mkdir -p "$INSTALL_DIR/backups"
  tmp="$(mktemp -d "$INSTALL_DIR/backups/.partial.XXXXXX")"
  out="$INSTALL_DIR/backups/evacal-$(date +%Y%m%d-%H%M%S)-$$.tar.gz"
  # Quiesce this application's writers so DB and local artifacts belong to one backup.
  running="$(running_container_ids)"
  trap 'code=$?; rm -rf "$tmp"; if [ -n "$running" ] && { [ "$resume" != keep-stopped ] || [ "$code" -ne 0 ]; }; then docker start $running || code=1; fi; exit "$code"' EXIT
  [ -z "$running" ] || docker stop $running
  if [ -z "$(env_get DATABASE_URL)" ]; then
    compose exec -T postgres pg_dump -U "$(env_get POSTGRES_USER)" -d "$(env_get POSTGRES_DB)" -Fc > "$tmp/db.dump"
  else
    pg_tools pg_dump --no-password -Fc > "$tmp/db.dump"
  fi
  docker run --rm --entrypoint tar --mount "type=volume,source=$storage_volume,target=/data,readonly" "$image" -czf - -C /data . > "$tmp/storage.tgz"
  cp "$INSTALL_DIR/.env" "$tmp/env"; printf '%s\n' postgresql > "$tmp/PROVIDER"
  tar -czf "$tmp/backup.tar.gz" -C "$tmp" env PROVIDER storage.tgz db.dump
  mv "$tmp/backup.tar.gz" "$out"; chmod 600 "$out"
  info "Бэкап: $out. Содержит секреты .env; храните в защищённом месте."
)

validate_archive() {
  # Reject traversal and symlinks before extracting on the host or into a volume.
  tar -tzf "$1" | awk '/^\// || /(^|\/)\.\.(\/|$)/ {bad=1} END {exit bad}' || die 'Небезопасные пути в архиве.'
  tar -tvzf "$1" | awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {bad=1} END {exit bad}' || die 'Ссылки/специальные файлы в архиве запрещены.'
}
cmd_restore() (
  require_installed
  validate_database_config
  local file="${ARGS[0]:-}" tmp
  [ -f "$file" ] || die 'Укажите существующий архив: evacal restore ФАЙЛ.'
  [ -z "$(env_get S3_BUCKET)" ] && [ "$(env_get GOST_PACKAGE_STORAGE)" != s3 ] || die 'Восстановление S3 требует отдельной согласованной процедуры.'
  validate_archive "$file"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  tar -xzf "$file" -C "$tmp"
  [ -f "$tmp/PROVIDER" ] && [ -f "$tmp/storage.tgz" ] || die 'Это не полный архив EvaCal.'
  [ "$(cat "$tmp/PROVIDER")" = postgresql ] || die 'Поддерживаются только архивы PostgreSQL.'
  validate_archive "$tmp/storage.tgz"
  [ -s "$tmp/db.dump" ] || die 'Дамп PostgreSQL отсутствует или пуст.'
  if [ -n "$(env_get DATABASE_URL)" ]; then pg_preflight; fi
  confirm 'Текущая БД и локальные артефакты будут ЗАМЕНЕНЫ. Продолжить?' || exit 1
  compose stop app web
  if [ -z "$(env_get DATABASE_URL)" ]; then
    compose up -d --wait --wait-timeout "$HEALTH_TIMEOUT" postgres
    compose exec -T postgres pg_restore -U "$(env_get POSTGRES_USER)" -d "$(env_get POSTGRES_DB)" --clean --if-exists --no-owner --exit-on-error --single-transaction < "$tmp/db.dump"
  else
    pg_tools pg_restore --no-password --clean --if-exists --no-owner --exit-on-error --single-transaction < "$tmp/db.dump"
  fi
  compose run --rm --no-deps -T migrate sh -c 'find /app/storage -mindepth 1 -maxdepth 1 -exec rm -rf {} +; exec tar -xzf - -C /app/storage' < "$tmp/storage.tgz"
  start_stack
  info 'Восстановлено. Текущие параметры подключения и .env не перезаписывались.'
)

cmd_uninstall() {
  require_installed
  if [ -n "$OPT_PURGE" ]; then
    [ -f "$INSTALL_DIR/.evacal-installation" ] || die 'Нет маркера установки; автоматическое удаление каталога запрещено.'
    case "$INSTALL_DIR" in /|/opt|/usr|/usr/local|/home|/root|"$HOME") die 'Небезопасный каталог для удаления.' ;; esac
    confirm "Удалить контейнеры, тома и $INSTALL_DIR (включая backups)?" || return 1
    compose down -v --remove-orphans
    local bin="${EVACAL_BIN_DIR:-$HOME/.local/bin}"
    if [ "$(id -u)" -eq 0 ] && [ -z "${EVACAL_BIN_DIR:-}" ]; then bin=/usr/local/bin; fi
    if [ -L "$bin/evacal" ] && [ "$(readlink "$bin/evacal")" = "$INSTALL_DIR/evacal" ]; then rm "$bin/evacal"; fi
    rm -rf "$INSTALL_DIR"
  else
    confirm 'Удалить контейнеры, сохранив данные и конфигурацию?' || return 1
    compose down --remove-orphans
  fi
  # Never prune global Docker images or remove another installation's command.
}

main() {
  parse_args "$@"; resolve_script
  INSTALL_DIR="$OPT_DIR"
  if [ -z "$INSTALL_DIR" ]; then
    if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/.env" ]; then INSTALL_DIR="$SCRIPT_DIR"
    elif [ "$(id -u)" -eq 0 ]; then INSTALL_DIR=/opt/evacal
    else INSTALL_DIR="$HOME/evacal"; fi
  fi
  case "$INSTALL_DIR" in /*) ;; *) INSTALL_DIR="$PWD/$INSTALL_DIR" ;; esac
  [ ! -d "$INSTALL_DIR" ] || INSTALL_DIR="$(cd -P "$INSTALL_DIR" && pwd)"
  case "$COMMAND" in
    install) cmd_install ;;
    update) require_installed; cmd_install ;;
    backup) cmd_backup ;; restore) cmd_restore ;; uninstall) cmd_uninstall ;;
    *)
      require_installed
      case "$COMMAND" in
        doctor) compose config --quiet; docker compose version; compose ps -a; compose config --images; print_address ;;
        status) compose ps -a; printf 'app: %s\nweb: %s\n' "$(service_state app)" "$(service_state web)"; print_address ;;
        logs) compose logs -f --tail=200 "${ARGS[0]:-app}" ;;
        start) validate_database_config; start_stack ;;
        stop) compose stop; info 'Остановлено.' ;;
        restart) validate_database_config; compose stop app web; compose up -d --force-recreate app web; wait_healthy; print_address ;;
        passwords)
          validate_database_config
          confirm 'Выдать новые пароли всем стендовым учёткам?' || return 1
          compose run --rm --no-deps -T migrate npx --no-install tsx reset-all.ts --all ;;
      esac ;;
  esac
}

# Sourceable for dependency-free regression tests; still supports bash -s over stdin.
if [ -z "${BASH_SOURCE[0]:-}" ] || [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
