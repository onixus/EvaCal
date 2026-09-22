#!/usr/bin/env bash
#
# EvaCal — установщик и утилита управления стендом.
#
#   Установка одной командой (готовые образы из ghcr.io):
#     curl -fsSL https://raw.githubusercontent.com/onixus/EvaCal/main/deploy/install.sh | sudo bash
#
#   Из клона репозитория (те же образы либо сборка из исходников):
#     ./deploy/install.sh install [--source]
#
#   Дальше стендом управляет тот же скрипт (копия кладётся в каталог установки
#   как ./evacal и, если есть права, в /usr/local/bin/evacal):
#     evacal status | logs | update | passwords | backup | restore <файл> | stop | start | uninstall
#
# Поддерживаются Linux (Debian/Ubuntu/RHEL-семейство/Astra/РЕД ОС) и macOS
# (для локального стенда). Нужны docker и docker compose v2; на Linux скрипт
# предложит поставить Docker официальным скриптом get.docker.com.
#
set -euo pipefail

EVACAL_REPO="${EVACAL_REPO:-onixus/EvaCal}"
EVACAL_RAW_BASE="${EVACAL_RAW_BASE:-https://raw.githubusercontent.com/${EVACAL_REPO}}"
DEFAULT_IMAGE="ghcr.io/onixus/evacal"
DEFAULT_MIGRATE_IMAGE="ghcr.io/onixus/evacal-migrate"
CONF_FILES="docker-compose.yml docker-compose.tls.yml docker-compose.build.yml nginx/http.conf nginx/https.conf"
HEALTH_TIMEOUT="${EVACAL_HEALTH_TIMEOUT:-300}"

# --- вывод ------------------------------------------------------------------
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_DIM=$'\033[2m'
else
  C_RESET=''; C_BOLD=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_DIM=''
fi
info()  { printf '%s==>%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn()  { printf '%s[!]%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()   { printf '%s[x]%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }
step()  { printf '\n%s%s%s\n' "$C_BOLD" "$*" "$C_RESET"; }

usage() {
  cat <<EOF
${C_BOLD}EvaCal — установщик${C_RESET}

Использование: $(basename "$0") [команда] [параметры]

Команды:
  install            установить и запустить (по умолчанию)
  update             обновить до версии --version (по умолчанию latest) и перезапустить
  status             состояние контейнеров и адрес стенда
  logs [сервис]      логи (по умолчанию app), Ctrl+C для выхода
  passwords          выдать всем стендовым учёткам новые пароли
  backup             дамп PostgreSQL + архив хранилища артефактов в ./backups
  restore <файл>     восстановить из архива, созданного backup
  start | stop       запустить / остановить стенд
  restart            перезапустить (например, после замены сертификата)
  uninstall          остановить и удалить контейнеры (--purge: вместе с данными)

Параметры установки:
  --dir DIR          каталог установки (по умолчанию /opt/evacal для root, ~/evacal иначе)
  --version TAG      тег образа: latest (по умолчанию), 0.5.0, main …
  --domain HOST      имя хоста для сертификата и адреса (по умолчанию имя машины)
  --http-port N      порт HTTP (80)
  --https-port N     порт HTTPS (443)
  --no-tls           без HTTPS: только HTTP (TLS терминирует внешний прокси)
  --cert FILE        свой сертификат (fullchain.pem); без --cert выпускается самоподписанный
  --key FILE         ключ к сертификату (privkey.pem)
  --sqlite           встроенный SQLite вместо PostgreSQL (один небольшой стенд)
  --database-url URL внешний PostgreSQL вместо встроенного контейнера
  --source [PATH]    собрать образы из исходников (PATH — клон репозитория;
                     по умолчанию — репозиторий, из которого запущен скрипт)
  --seed-password P  один известный пароль на все учётки (только тестовый стенд)
  --yes, -y          без вопросов (неинтерактивный режим)
  --help, -h         эта справка

Переменные окружения с тем же смыслом: EVACAL_DIR, EVACAL_TAG, EVACAL_DOMAIN.
EOF
}

# --- параметры ---------------------------------------------------------------
COMMAND=""
OPT_DIR="${EVACAL_DIR:-}"
OPT_TAG="${EVACAL_TAG:-}"
OPT_DOMAIN="${EVACAL_DOMAIN:-}"
OPT_HTTP_PORT=""
OPT_HTTPS_PORT=""
OPT_TLS=""            # yes | no | '' (взять из .env либо yes)
OPT_CERT=""
OPT_KEY=""
OPT_SQLITE=""
OPT_DATABASE_URL=""
OPT_SOURCE=""         # '' — образы; путь — сборка из исходников
OPT_SEED_PASSWORD=""
OPT_YES=""
OPT_PURGE=""
ARGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    install|update|status|logs|passwords|backup|restore|start|stop|restart|uninstall)
      COMMAND="$1" ;;
    --dir)          OPT_DIR="$2"; shift ;;
    --dir=*)        OPT_DIR="${1#*=}" ;;
    --version)      OPT_TAG="$2"; shift ;;
    --version=*)    OPT_TAG="${1#*=}" ;;
    --domain)       OPT_DOMAIN="$2"; shift ;;
    --domain=*)     OPT_DOMAIN="${1#*=}" ;;
    --http-port)    OPT_HTTP_PORT="$2"; shift ;;
    --http-port=*)  OPT_HTTP_PORT="${1#*=}" ;;
    --https-port)   OPT_HTTPS_PORT="$2"; shift ;;
    --https-port=*) OPT_HTTPS_PORT="${1#*=}" ;;
    --no-tls)       OPT_TLS="no" ;;
    --tls)          OPT_TLS="yes" ;;
    --cert)         OPT_CERT="$2"; shift ;;
    --cert=*)       OPT_CERT="${1#*=}" ;;
    --key)          OPT_KEY="$2"; shift ;;
    --key=*)        OPT_KEY="${1#*=}" ;;
    --sqlite)       OPT_SQLITE="yes" ;;
    --database-url) OPT_DATABASE_URL="$2"; shift ;;
    --database-url=*) OPT_DATABASE_URL="${1#*=}" ;;
    --source)
      if [ $# -gt 1 ] && [ "${2#-}" = "$2" ]; then OPT_SOURCE="$2"; shift; else OPT_SOURCE="auto"; fi ;;
    --source=*)     OPT_SOURCE="${1#*=}" ;;
    --seed-password) OPT_SEED_PASSWORD="$2"; shift ;;
    --seed-password=*) OPT_SEED_PASSWORD="${1#*=}" ;;
    --purge)        OPT_PURGE="yes" ;;
    -y|--yes)       OPT_YES="yes" ;;
    -h|--help)      usage; exit 0 ;;
    -*)             die "Неизвестный параметр: $1 (см. --help)" ;;
    *)              ARGS+=("$1") ;;
  esac
  shift
done
COMMAND="${COMMAND:-install}"

# --- общие функции ------------------------------------------------------------
SCRIPT_PATH="${BASH_SOURCE[0]:-}"
SCRIPT_DIR=""
REPO_ROOT=""
if [ -n "$SCRIPT_PATH" ] && [ -f "$SCRIPT_PATH" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
  # Запущен из клона репозитория: deploy/install.sh рядом с Dockerfile.
  if [ -f "$SCRIPT_DIR/../Dockerfile" ] && [ -f "$SCRIPT_DIR/docker-compose.yml" ]; then
    REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  fi
fi

is_root() { [ "$(id -u)" -eq 0 ]; }

confirm() {
  # confirm "вопрос" [default=y|n]
  local q="$1" def="${2:-y}" ans
  if [ -n "$OPT_YES" ]; then return 0; fi
  if [ ! -t 0 ] && [ ! -r /dev/tty ]; then return 0; fi
  if [ "$def" = "y" ]; then q="$q [Y/n] "; else q="$q [y/N] "; fi
  printf '%s' "$q" >&2
  read -r ans < /dev/tty || ans=""
  ans="$(printf '%s' "$ans" | tr '[:upper:]' '[:lower:]')"
  case "$ans" in
    y|yes|д|да) return 0 ;;
    n|no|н|нет) return 1 ;;
    "") [ "$def" = "y" ] ;;
    *) return 1 ;;
  esac
}

ask() {
  # ask VAR "подсказка" "значение по умолчанию"
  local var="$1" prompt="$2" def="$3" ans=""
  if [ -n "$OPT_YES" ] || { [ ! -t 0 ] && [ ! -r /dev/tty ]; }; then
    printf -v "$var" '%s' "$def"; return 0
  fi
  printf '%s [%s]: ' "$prompt" "$def" >&2
  read -r ans < /dev/tty || ans=""
  printf -v "$var" '%s' "${ans:-$def}"
}

random_hex() {
  local n="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$n"
  else
    od -An -N"$n" -tx1 /dev/urandom | tr -d ' \n'
  fi
}

random_password() {
  # 24 символа [A-Za-z0-9] — совместимо с URL PostgreSQL без экранирования.
  # head закрывает канал раньше tr — при pipefail это ненулевой статус, гасим.
  LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24 || true
}

default_dir() {
  if [ -n "$OPT_DIR" ]; then printf '%s' "$OPT_DIR"
  elif is_root; then printf '/opt/evacal'
  else printf '%s/evacal' "$HOME"
  fi
}

# .env: чтение/запись отдельных ключей без потери остальных
env_get() { # env_get KEY
  [ -f "$INSTALL_DIR/.env" ] || return 0
  sed -n "s/^${1}=//p" "$INSTALL_DIR/.env" | tail -n1 | sed -e 's/^"\(.*\)"$/\1/'
}
env_set() { # env_set KEY VALUE
  local key="$1" value="$2" file="$INSTALL_DIR/.env" tmp
  touch "$file"
  tmp="$(mktemp)"
  grep -v "^${key}=" "$file" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}
env_set_if_empty() { # env_set_if_empty KEY VALUE
  [ -n "$(env_get "$1")" ] || env_set "$1" "$2"
}

compose() {
  (cd "$INSTALL_DIR" && "${COMPOSE_CMD[@]}" "$@")
}

detect_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
  else
    die "Не найден docker compose v2. Установите Docker Engine с плагином compose: https://docs.docker.com/engine/install/"
  fi
}

check_docker() {
  step "Проверка окружения"
  if ! command -v docker >/dev/null 2>&1; then
    case "$(uname -s)" in
      Linux)
        warn "Docker не установлен."
        if command -v curl >/dev/null 2>&1 && confirm "Установить Docker официальным скриптом get.docker.com?"; then
          if is_root; then
            curl -fsSL https://get.docker.com | sh
          elif command -v sudo >/dev/null 2>&1; then
            curl -fsSL https://get.docker.com | sudo sh
            sudo usermod -aG docker "$USER" || true
            warn "Пользователь $USER добавлен в группу docker — перезайдите в систему и запустите установку снова."
            exit 0
          else
            die "Нужны права root для установки Docker."
          fi
          command -v systemctl >/dev/null 2>&1 && systemctl enable --now docker >/dev/null 2>&1 || true
        else
          die "Установите Docker: https://docs.docker.com/engine/install/ и запустите снова."
        fi ;;
      Darwin)
        die "Docker не найден. Установите Docker Desktop или OrbStack и запустите снова." ;;
      *)
        die "Неподдерживаемая ОС: $(uname -s)" ;;
    esac
  fi
  if ! docker info >/dev/null 2>&1; then
    if is_root || [ "$(uname -s)" = "Darwin" ]; then
      die "Docker установлен, но демон недоступен. Запустите Docker и повторите."
    fi
    die "Нет доступа к Docker. Запустите с sudo или добавьте пользователя в группу docker: sudo usermod -aG docker $USER"
  fi
  detect_compose
  info "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?'), $("${COMPOSE_CMD[@]}" version --short 2>/dev/null | sed 's/^/compose /')"
}

fetch_conf_files() {
  # Раскладывает compose-файлы и шаблоны nginx в каталог установки:
  # из клона (если запущен из него) либо с raw.githubusercontent.com по тегу.
  local ref="$1" f src from
  mkdir -p "$INSTALL_DIR/nginx"
  # Источник конфигурации: клон, из которого запущен скрипт; клон из EVACAL_SOURCE
  # (стенд «из исходников»); иначе — GitHub по тегу.
  from="$REPO_ROOT"
  [ -z "$from" ] && [ -f "$(env_get EVACAL_SOURCE)/deploy/install.sh" ] && from="$(env_get EVACAL_SOURCE)"
  if [ -n "$from" ]; then
    for f in $CONF_FILES; do cp "$from/deploy/$f" "$INSTALL_DIR/$f"; done
    cp "$from/deploy/install.sh" "$INSTALL_DIR/evacal"
    info "Конфигурация скопирована из $from/deploy"
  else
    command -v curl >/dev/null 2>&1 || die "Нужен curl для загрузки конфигурации."
    case "$ref" in latest) ref="main" ;; [0-9]*) ref="v$ref" ;; esac
    for f in $CONF_FILES install.sh; do
      src="$EVACAL_RAW_BASE/$ref/deploy/$f"
      if [ "$f" = "install.sh" ]; then
        curl -fsSL "$src" -o "$INSTALL_DIR/evacal" || die "Не удалось загрузить $src"
      else
        curl -fsSL "$src" -o "$INSTALL_DIR/$f" || die "Не удалось загрузить $src"
      fi
    done
    info "Конфигурация загружена из $EVACAL_RAW_BASE/$ref/deploy"
  fi
  chmod +x "$INSTALL_DIR/evacal"
  if [ -d /usr/local/bin ] && [ -w /usr/local/bin ] && [ "$INSTALL_DIR/evacal" != "/usr/local/bin/evacal" ]; then
    ln -sf "$INSTALL_DIR/evacal" /usr/local/bin/evacal
  fi
}

write_tls() {
  local domain="$1" certdir="$INSTALL_DIR/certs"
  mkdir -p "$certdir"
  if [ -n "$OPT_CERT" ] || [ -n "$OPT_KEY" ]; then
    [ -n "$OPT_CERT" ] && [ -n "$OPT_KEY" ] || die "--cert и --key задаются вместе."
    [ -f "$OPT_CERT" ] || die "Сертификат не найден: $OPT_CERT"
    [ -f "$OPT_KEY" ]  || die "Ключ не найден: $OPT_KEY"
    cp "$OPT_CERT" "$certdir/fullchain.pem"
    cp "$OPT_KEY"  "$certdir/privkey.pem"
    info "Сертификат: $OPT_CERT"
  elif [ -f "$certdir/fullchain.pem" ] && [ -f "$certdir/privkey.pem" ]; then
    info "Сертификат уже есть в $certdir — оставляю."
  else
    command -v openssl >/dev/null 2>&1 || die "Нужен openssl для выпуска самоподписанного сертификата (или задайте --cert/--key, или --no-tls)."
    local san="DNS:${domain},DNS:localhost,IP:127.0.0.1"
    if printf '%s' "$domain" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then san="IP:${domain},DNS:localhost,IP:127.0.0.1"; fi
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
      -keyout "$certdir/privkey.pem" -out "$certdir/fullchain.pem" \
      -subj "/CN=${domain}/O=EvaCal" -addext "subjectAltName=${san}" >/dev/null 2>&1 \
      || die "openssl не смог выпустить сертификат."
    warn "Выпущен самоподписанный сертификат на ${domain} (браузер покажет предупреждение)."
    warn "Боевой сертификат: положите fullchain.pem и privkey.pem в $certdir и выполните: evacal restart"
  fi
  # nginx в контейнере читает ключ от пользователя nginx — root-only права ему не подходят.
  chmod 644 "$certdir/privkey.pem" "$certdir/fullchain.pem"
}

render_nginx() {
  local tls="$1" suffix="" https_port
  https_port="$(env_get EVACAL_HTTPS_PORT)"
  [ -n "$https_port" ] && [ "$https_port" != "443" ] && suffix=":$https_port"
  if [ "$tls" = "yes" ]; then
    sed -e "s/__HTTPS_PORT_SUFFIX__/${suffix}/g" "$INSTALL_DIR/nginx/https.conf" > "$INSTALL_DIR/nginx/nginx.conf"
  else
    cp "$INSTALL_DIR/nginx/http.conf" "$INSTALL_DIR/nginx/nginx.conf"
  fi
}

reload_nginx() {
  # Конфиг nginx меняется без пересоздания контейнера — перечитываем; если не
  # вышло (контейнер не поднят, конфиг с ошибкой), пересоздаём web.
  if ! compose exec -T web nginx -s reload >/dev/null 2>&1; then
    compose up -d --force-recreate web >/dev/null 2>&1 || true
  fi
}

migrate_exit_code() {
  local id
  id="$(compose ps -a -q migrate 2>/dev/null | head -n1)"
  [ -n "$id" ] || { echo "?"; return; }
  docker inspect -f '{{.State.ExitCode}}' "$id" 2>/dev/null || echo "?"
}

app_health() {
  local id
  id="$(compose ps -q app 2>/dev/null | head -n1)"
  [ -n "$id" ] || { echo "absent"; return; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo "?"
}

wait_healthy() {
  step "Ожидание запуска (до ${HEALTH_TIMEOUT} с)"
  local waited=0 h
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    h="$(app_health)"
    case "$h" in
      healthy) info "Приложение отвечает."; return 0 ;;
      exited|dead) break ;;
    esac
    if [ "$(migrate_exit_code)" != "?" ] && [ "$(migrate_exit_code)" != "0" ]; then break; fi
    sleep 3; waited=$((waited + 3))
    printf '.' >&2
  done
  printf '\n' >&2
  warn "Приложение не поднялось. Состояние: app=$(app_health), migrate exit=$(migrate_exit_code)"
  warn "Логи миграции:"; compose logs --no-color --tail=40 migrate >&2 || true
  warn "Логи приложения:"; compose logs --no-color --tail=40 app >&2 || true
  die "Установка не завершена. Исправьте причину и запустите: $INSTALL_DIR/evacal start"
}

print_credentials() {
  # Баннер сида: между строками из 70 знаков «=». В логах compose у строк
  # префикс «migrate-1  | », его снимаем.
  local banner
  banner="$(compose logs --no-color migrate 2>/dev/null | sed -e 's/^[^|]*| //' | awk '/^=======/{f=!f; next} f')"
  if [ -n "$banner" ]; then
    step "Учётные записи"
    printf '%s\n' "$banner"
    printf '%s\n' "$banner" > "$INSTALL_DIR/credentials.txt"
    chmod 600 "$INSTALL_DIR/credentials.txt"
    warn "Пароли сохранены в $INSTALL_DIR/credentials.txt — удалите файл после их смены."
    info "При первом входе система потребует сменить пароль."
  else
    info "Учётные записи уже существовали — пароли не менялись. Новые: $INSTALL_DIR/evacal passwords"
  fi
}

print_address() {
  local tls domain http https url
  tls="$(env_get EVACAL_TLS)"; domain="$(env_get EVACAL_DOMAIN)"
  http="$(env_get EVACAL_HTTP_PORT)"; https="$(env_get EVACAL_HTTPS_PORT)"
  if [ "$tls" = "yes" ]; then
    url="https://${domain}"; [ "${https:-443}" != "443" ] && url="${url}:${https}"
  else
    url="http://${domain}"; [ "${http:-80}" != "80" ] && url="${url}:${http}"
  fi
  printf '\n%sEvaCal доступен: %s%s\n' "$C_BOLD" "$url" "$C_RESET"
  printf '%sКаталог: %s   управление: %s/evacal --help%s\n' "$C_DIM" "$INSTALL_DIR" "$INSTALL_DIR" "$C_RESET"
}

require_installed() {
  [ -f "$INSTALL_DIR/.env" ] && [ -f "$INSTALL_DIR/docker-compose.yml" ] \
    || die "В $INSTALL_DIR нет установки EvaCal (укажите --dir или выполните install)."
  detect_compose
}

# --- команды ------------------------------------------------------------------
cmd_install() {
  step "Установка EvaCal"
  check_docker

  local fresh="yes"
  [ -f "$INSTALL_DIR/.env" ] && fresh=""
  mkdir -p "$INSTALL_DIR"
  chmod 750 "$INSTALL_DIR" 2>/dev/null || true

  # Источник образов
  local tag source
  tag="${OPT_TAG:-$(env_get EVACAL_TAG)}"; tag="${tag:-latest}"
  source=""
  if [ -n "$OPT_SOURCE" ]; then
    if [ "$OPT_SOURCE" = "auto" ]; then
      [ -n "$REPO_ROOT" ] || die "--source без пути работает только при запуске из клона репозитория."
      source="$REPO_ROOT"
    else
      source="$(cd "$OPT_SOURCE" && pwd)" || die "Каталог не найден: $OPT_SOURCE"
    fi
    [ -f "$source/Dockerfile" ] || die "В $source нет Dockerfile — это не клон EvaCal."
  elif [ -z "$fresh" ]; then
    source="$(env_get EVACAL_SOURCE)"
  fi

  # Параметры стенда (интерактивно только при первой установке)
  local domain tls http_port https_port
  domain="${OPT_DOMAIN:-$(env_get EVACAL_DOMAIN)}"
  if [ -z "$domain" ]; then
    ask domain "Имя хоста (DNS-имя или IP, под него выпускается сертификат)" "$(hostname -f 2>/dev/null || hostname)"
  fi
  tls="${OPT_TLS:-$(env_get EVACAL_TLS)}"; tls="${tls:-yes}"
  http_port="${OPT_HTTP_PORT:-$(env_get EVACAL_HTTP_PORT)}"; http_port="${http_port:-80}"
  https_port="${OPT_HTTPS_PORT:-$(env_get EVACAL_HTTPS_PORT)}"; https_port="${https_port:-443}"

  step "Конфигурация → $INSTALL_DIR"
  fetch_conf_files "$tag"

  # .env: секреты генерируются один раз и не перезаписываются
  env_set COMPOSE_PROJECT_NAME "evacal"
  env_set EVACAL_TAG "$tag"
  env_set EVACAL_DOMAIN "$domain"
  env_set EVACAL_TLS "$tls"
  env_set EVACAL_HTTP_PORT "$http_port"
  env_set EVACAL_HTTPS_PORT "$https_port"
  env_set_if_empty EVACAL_IMAGE "$DEFAULT_IMAGE"
  env_set_if_empty EVACAL_MIGRATE_IMAGE "$DEFAULT_MIGRATE_IMAGE"
  env_set_if_empty SESSION_SECRET "$(random_hex 32)"
  env_set_if_empty SHARE_TOKEN_SECRET "$(random_hex 32)"

  if [ -n "$OPT_DATABASE_URL" ]; then
    env_set DATABASE_PROVIDER "postgresql"
    env_set DATABASE_URL "\"$OPT_DATABASE_URL\""
    env_set_if_empty POSTGRES_PASSWORD "unused-external-db"
    info "База: внешний PostgreSQL"
  elif [ -n "$OPT_SQLITE" ] || [ "$(env_get DATABASE_PROVIDER)" = "sqlite" ]; then
    env_set DATABASE_PROVIDER "sqlite"
    env_set DATABASE_URL "file:./prisma/dev.db"
    env_set_if_empty POSTGRES_PASSWORD "unused-sqlite"
    if [ -z "$source" ]; then
      warn "Опубликованные образы собраны под PostgreSQL; для SQLite нужна сборка из исходников (--source)."
      die "Либо уберите --sqlite, либо укажите --source <клон репозитория>."
    fi
    info "База: встроенный SQLite (том db-data)"
  else
    env_set DATABASE_PROVIDER "postgresql"
    env_set_if_empty POSTGRES_DB "evacal"
    env_set_if_empty POSTGRES_USER "evacal"
    env_set_if_empty POSTGRES_PASSWORD "$(random_password)"
    # URL собирается в compose из POSTGRES_*; явный DATABASE_URL нужен только внешнему серверу.
    [ -n "$(env_get DATABASE_URL)" ] && [ "$(env_get DATABASE_URL)" != "file:./prisma/dev.db" ] || env_set DATABASE_URL ""
    info "База: встроенный PostgreSQL 16 (том pg-data)"
  fi
  [ -n "$OPT_SEED_PASSWORD" ] && env_set SEED_DEFAULT_PASSWORD "\"$OPT_SEED_PASSWORD\""
  [ "$tls" = "yes" ] && env_set_if_empty FORCE_SECURE_COOKIES "true"

  local files="docker-compose.yml"
  [ "$tls" = "yes" ] && files="$files:docker-compose.tls.yml"
  if [ -n "$source" ]; then
    files="$files:docker-compose.build.yml"
    env_set EVACAL_SOURCE "$source"
    info "Образы: сборка из $source"
  else
    env_set EVACAL_SOURCE ""
    info "Образы: ${DEFAULT_IMAGE}:${tag}, ${DEFAULT_MIGRATE_IMAGE}:${tag}"
  fi
  env_set COMPOSE_FILE "$files"
  chmod 600 "$INSTALL_DIR/.env"

  render_nginx "$tls"
  if [ "$tls" = "yes" ]; then write_tls "$domain"; fi

  # Образы
  if [ -n "$source" ]; then
    step "Сборка образов (несколько минут)"
    compose build
  else
    step "Загрузка образов"
    compose pull || die "Не удалось загрузить образы. Проверьте доступ к ghcr.io или соберите из исходников: --source <клон>."
  fi

  step "Запуск"
  compose up -d --remove-orphans
  wait_healthy
  print_credentials
  print_address
}

cmd_update() {
  require_installed
  local tag
  tag="${OPT_TAG:-$(env_get EVACAL_TAG)}"; tag="${tag:-latest}"
  step "Обновление EvaCal до ${tag}"
  env_set EVACAL_TAG "$tag"
  fetch_conf_files "$tag"
  render_nginx "$(env_get EVACAL_TLS)"
  if [ -n "$(env_get EVACAL_SOURCE)" ]; then
    local src; src="$(env_get EVACAL_SOURCE)"
    if [ -d "$src/.git" ] && command -v git >/dev/null 2>&1; then
      info "git pull в $src"; (cd "$src" && git pull --ff-only) || warn "git pull не удался, собираю то, что есть."
    fi
    compose build
  else
    compose pull
  fi
  # migrate пересоздаётся и применяет новые миграции до старта app.
  compose up -d --remove-orphans
  wait_healthy
  reload_nginx
  docker image prune -f >/dev/null 2>&1 || true
  info "Обновлено."
  print_address
}

cmd_status() {
  require_installed
  compose ps
  printf 'Версия: %s   app: %s\n' "$(env_get EVACAL_TAG)" "$(app_health)"
  print_address
}

cmd_logs() {
  require_installed
  compose logs -f --tail=200 "${ARGS[0]:-app}"
}

cmd_passwords() {
  require_installed
  step "Сброс паролей всех стендовых учёток"
  confirm "Всем стендовым учёткам (admin, architect, gap, techwriter, presale, reviewer) будут выданы новые пароли. Продолжить?" || exit 0
  # В образе migrate клиент Prisma генерируется на старте CMD, а `run` с другой
  # командой его обходит — генерируем явно.
  compose run --rm migrate sh -c 'npx prisma generate >/dev/null 2>&1 && npx tsx reset-all.ts --all'
  warn "Пароли выше показаны один раз; при следующем входе система потребует их сменить."
}

cmd_backup() {
  require_installed
  local dir="$INSTALL_DIR/backups" stamp tmp out provider
  stamp="$(date +%Y%m%d-%H%M%S)"
  provider="$(env_get DATABASE_PROVIDER)"
  mkdir -p "$dir"; tmp="$(mktemp -d)"
  step "Резервная копия → $dir/evacal-${stamp}.tar.gz"
  if [ "$provider" = "sqlite" ]; then
    docker run --rm -v evacal_db-data:/data:ro -v "$tmp":/out alpine \
      sh -c 'cp /data/dev.db /out/dev.db' || die "Не удалось скопировать SQLite-базу."
  elif [ -n "$(env_get DATABASE_URL)" ]; then
    warn "Внешний PostgreSQL: дамп снимается с сервера из DATABASE_URL."
    docker run --rm postgres:16-alpine pg_dump -Fc "$(env_get DATABASE_URL)" > "$tmp/db.dump" \
      || die "pg_dump внешней базы не удался."
  else
    compose exec -T postgres pg_dump -U "$(env_get POSTGRES_USER)" -d "$(env_get POSTGRES_DB)" -Fc > "$tmp/db.dump" \
      || die "pg_dump не удался (стенд запущен?)."
  fi
  docker run --rm -v evacal_storage-data:/data:ro -v "$tmp":/out alpine \
    sh -c 'cd /data && tar czf /out/storage.tgz .' || die "Не удалось заархивировать хранилище артефактов."
  cp "$INSTALL_DIR/.env" "$tmp/env"
  printf '%s\n' "$provider" > "$tmp/PROVIDER"
  out="$dir/evacal-${stamp}.tar.gz"
  tar czf "$out" -C "$tmp" .
  rm -rf "$tmp"
  chmod 600 "$out"
  info "Готово: $out ($(du -h "$out" | cut -f1)). В архиве .env с секретами — храните как пароль."
}

cmd_restore() {
  require_installed
  local file="${ARGS[0]:-}" tmp provider
  [ -n "$file" ] && [ -f "$file" ] || die "Укажите файл резервной копии: evacal restore backups/evacal-….tar.gz"
  file="$(cd "$(dirname "$file")" && pwd)/$(basename "$file")"
  step "Восстановление из $file"
  confirm "Текущая база и хранилище артефактов будут ЗАМЕНЕНЫ содержимым архива. Продолжить?" n || exit 0
  tmp="$(mktemp -d)"; tar xzf "$file" -C "$tmp"
  provider="$(cat "$tmp/PROVIDER" 2>/dev/null || echo postgresql)"
  compose stop app web migrate >/dev/null 2>&1 || true
  if [ "$provider" = "sqlite" ]; then
    docker run --rm -v evacal_db-data:/data -v "$tmp":/in alpine sh -c 'cp /in/dev.db /data/dev.db && chown 1001:1001 /data/dev.db'
  else
    compose up -d postgres
    local u d; u="$(env_get POSTGRES_USER)"; d="$(env_get POSTGRES_DB)"
    sleep 3
    compose exec -T postgres pg_restore -U "$u" -d "$d" --clean --if-exists --no-owner < "$tmp/db.dump" \
      || warn "pg_restore завершился с предупреждениями (обычно это нормально для --clean)."
  fi
  docker run --rm -v evacal_storage-data:/data -v "$tmp":/in alpine \
    sh -c 'rm -rf /data/* && tar xzf /in/storage.tgz -C /data && chown -R 1001:1001 /data'
  rm -rf "$tmp"
  compose up -d
  wait_healthy
  info "Восстановлено."
}

cmd_start() { require_installed; compose up -d; wait_healthy; print_address; }
cmd_stop()  { require_installed; compose stop; info "Остановлено."; }
cmd_restart() { require_installed; compose stop; compose up -d --force-recreate web; wait_healthy; print_address; }

cmd_uninstall() {
  require_installed
  step "Удаление EvaCal из $INSTALL_DIR"
  if [ -n "$OPT_PURGE" ]; then
    confirm "Будут удалены контейнеры, ОБРАЗЫ, ВСЕ ДАННЫЕ (база, артефакты) и каталог $INSTALL_DIR. Продолжить?" n || exit 0
    compose down -v --rmi all --remove-orphans || true
    [ -L /usr/local/bin/evacal ] && rm -f /usr/local/bin/evacal
    cd /; rm -rf "$INSTALL_DIR"
    info "Удалено полностью."
  else
    confirm "Контейнеры будут удалены; данные (тома) и каталог $INSTALL_DIR останутся. Продолжить?" || exit 0
    compose down --remove-orphans
    info "Контейнеры удалены. Данные сохранены; полное удаление: evacal uninstall --purge"
  fi
}

# --- точка входа ----------------------------------------------------------------
INSTALL_DIR="$(default_dir)"
# Управляющие команды из копии скрипта в каталоге установки работают без --dir.
if [ "$COMMAND" != "install" ] && [ -z "$OPT_DIR" ] && [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/.env" ] && [ -f "$SCRIPT_DIR/docker-compose.yml" ]; then
  INSTALL_DIR="$SCRIPT_DIR"
fi
case "$COMMAND" in
  install)   cmd_install ;;
  update)    cmd_update ;;
  status)    cmd_status ;;
  logs)      cmd_logs ;;
  passwords) cmd_passwords ;;
  backup)    cmd_backup ;;
  restore)   cmd_restore ;;
  start)     cmd_start ;;
  stop)      cmd_stop ;;
  restart)   cmd_restart ;;
  uninstall) cmd_uninstall ;;
esac
