#!/usr/bin/env bash
# Build both production targets from an isolated committed tree with fake local data.
# Usage: bash scripts/test-docker-data-exclusion.sh [commit-or-ref]
# Requires git, Docker Engine and tar. Never publishes images or mounts real data.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REVISION="$(git -C "$ROOT" rev-parse --verify "${1:-HEAD}^{commit}")"
docker info >/dev/null
WORK="$(mktemp -d)"
PREFIX="evacal-data-check-$(date +%s)-$$"
cleanup() {
  local code=$?
  trap - EXIT
  for target in runner migrate; do
    docker image rm "$PREFIX:$target" >/dev/null 2>&1 || true
  done
  rm -rf "$WORK"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$WORK/context"
git -C "$ROOT" archive "$REVISION" | tar -xf - -C "$WORK/context"
# Inject untracked canaries after export; a clean checkout alone cannot catch leaks.
for directory in prisma prisma/nested; do
  mkdir -p "$WORK/context/$directory"
  for suffix in sqlite sqlite-wal sqlite-shm sqlite-journal db db-wal db-shm db-journal; do
    printf 'FAKE DATABASE: data exclusion regression probe\n' > "$WORK/context/$directory/customer.$suffix"
  done
done
for target in runner migrate; do
  docker build --target "$target" --tag "$PREFIX:$target" "$WORK/context"
  # Bypass entrypoints: no application, migrations, network, host mounts or DB access.
  docker run --rm --network none --entrypoint sh "$PREFIX:$target" -eu -c '
    for directory in /app/prisma /app/prisma/nested; do
      for suffix in sqlite sqlite-wal sqlite-shm sqlite-journal db db-wal db-shm db-journal; do
        if [ -e "$directory/customer.$suffix" ]; then
          echo "DATA_EXCLUSION_FAILED: $directory/customer.$suffix" >&2
          exit 1
        fi
      done
    done
    test -s /app/prisma/schema.prisma
    test -s /app/prisma/migrations/migration_lock.toml
    test -s /app/prisma/migrations/20260914120000_init/migration.sql
    test -s /app/prisma/seed.ts
  '
  printf 'Data exclusion passed: %s (%s)\n' "$target" "$REVISION"
done
