#!/bin/sh
# Повторяет команду, которая ходит в сеть, при сбое.
#
# Сеть у контейнеров-агентов Jenkins обрывается посреди загрузки: 2026-10-05
# `npm ci` падал с ECONNRESET в 7 прогонах подряд, `apk add` — с «network
# connection aborted». Собственные ретраи npm такой обрыв не покрывают: они
# повторяют запрос, но не оборванную на середине распаковку tarball'а, и
# `npm ci` целиком выходит с ошибкой. Поэтому повторяется вся команда.
#
# Использование:
#   sh scripts/ci-retry.sh npm ci
#   CI_RETRY_ATTEMPTS=5 sh scripts/ci-retry.sh apk add --no-cache bash
#
# Оборачивать только идемпотентные установки: npm ci сам сносит node_modules,
# apk/apt-get доустанавливают недостающее.
set -u

attempts=${CI_RETRY_ATTEMPTS:-4}
delay=${CI_RETRY_DELAY:-10}

n=1
while :; do
  "$@" && exit 0
  status=$?
  if [ "$n" -ge "$attempts" ]; then
    echo "[ci-retry] «$*» не прошла за $attempts попыток (код $status)" >&2
    exit "$status"
  fi
  echo "[ci-retry] «$*» упала (код $status), попытка $((n + 1))/$attempts через ${delay}с" >&2
  sleep "$delay"
  n=$((n + 1))
  delay=$((delay * 2))
done
