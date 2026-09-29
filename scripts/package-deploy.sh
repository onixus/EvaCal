#!/usr/bin/env bash
# Versioned, source-free deployment bundle. Images are downloaded separately.
set -euo pipefail
umask 022
VERSION="${1:?version required}"; REVISION="${2:?commit SHA required}"
[[ "$VERSION" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] || exit 1
[[ "$REVISION" =~ ^[a-f0-9]{40}$ ]] || exit 1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${3:-$ROOT/dist}"
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
NAME="evacal-$VERSION-deploy"
mkdir -p "$TMP/$NAME/nginx"
cp "$ROOT/deploy/install.sh" "$ROOT/deploy/README.md" "$ROOT"/deploy/docker-compose*.yml "$TMP/$NAME/"
cp "$ROOT/deploy/nginx/http.conf" "$ROOT/deploy/nginx/https.conf" "$TMP/$NAME/nginx/"
printf 'VERSION=%s\nREVISION=%s\n' "$VERSION" "$REVISION" > "$TMP/$NAME/RELEASE"
chmod 755 "$TMP/$NAME/install.sh"
tar -czf "$OUT/$NAME.tar.gz" -C "$TMP" "$NAME"
(cd "$OUT"; if command -v sha256sum >/dev/null 2>&1; then sha256sum "$NAME.tar.gz"; else shasum -a 256 "$NAME.tar.gz"; fi) > "$OUT/$NAME.tar.gz.sha256"
echo "$OUT/$NAME.tar.gz"
