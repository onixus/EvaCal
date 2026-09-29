#!/usr/bin/env bash
# Historical updater fixture, copied from deploy/install.sh at
# dcef45b33d0be2142053a4003a3c20add3a9da02 (blob b5bb512e72121ac72b4a73de2f1f6b336f9ab077).
# Only the update path and its dotenv/download functions are retained. The test
# supplies presentation/health stubs and blocks the global symlink operation.
# Do not replace these functions with the current manager in regression tests.
CONF_FILES="docker-compose.yml docker-compose.tls.yml docker-compose.build.yml nginx/http.conf nginx/https.conf"
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
