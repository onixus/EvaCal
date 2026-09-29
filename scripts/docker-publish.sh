#!/usr/bin/env bash
# Shared by Jenkins and the manual GitHub Actions fallback. Login is caller-owned.
set -euo pipefail

publication_tag() {
  local ref="${1#refs/tags/}" tag
  ref="${ref#refs/heads/}"
  [[ "$ref" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$ ]] || { echo 'Invalid REF' >&2; return 1; }
  if [[ "$ref" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9][a-zA-Z0-9.-]*)?$ ]]; then
    tag="${ref#v}"
  else tag="${ref//\//-}"; fi
  # Validate the final registry name, not the pre-normalized Git ref.
  # In particular sha/<revision> must not become a reserved sha-<revision>.
  case "$tag" in latest|sha-*) echo 'Reserved publication tag' >&2; return 1 ;; esac
  [[ "$tag" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] || { echo 'Invalid Docker tag' >&2; return 1; }
  printf '%s' "$tag"
}

publish() {
  local ref="${REF:?Set REF to the checked-out tag or branch}" tag revision image builder platforms target suffix candidate alias
  local dry="${DRY_RUN:-true}" multi="${MULTIARCH:-true}"
  image="${EVACAL_PUBLISH_IMAGE:-ghcr.io/onixus/evacal}"
  builder="${EVACAL_BUILDER:-evacal-publisher}"
  tag="$(publication_tag "$ref")"; [ "${#tag}" -le 128 ] || { echo 'REF is too long for a Docker tag' >&2; return 1; }
  revision="$(git rev-parse HEAD)"
  if [[ "$tag" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9][a-zA-Z0-9.-]*)?$ ]]; then
    # A branch named like a release must not silently replace latest.
    [ "$(git rev-parse "refs/tags/${ref#refs/tags/}^{commit}")" = "$revision" ] || return 1
  fi
  node --test deploy/tests/*.check.mjs
  if [ "$multi" = true ]; then platforms=linux/amd64,linux/arm64
  else
    case "$(uname -m)" in arm64|aarch64) platforms=linux/arm64 ;; x86_64|amd64) platforms=linux/amd64 ;; *) echo 'Unsupported build host' >&2; return 1 ;; esac
  fi
  docker buildx inspect "$builder" >/dev/null 2>&1 || docker buildx create --name "$builder" --driver docker-container --bootstrap
  local output=()
  [ "$dry" = true ] || output=(--push)
  for target in runner migrate; do
    suffix=''; [ "$target" != migrate ] || suffix=-migrate
    candidate="$image$suffix:sha-$revision"
    docker buildx build --builder "$builder" --platform "$platforms" --target "$target" \
      --build-arg "VCS_REF=$revision" -t "$candidate" ${output[@]+"${output[@]}"} .
  done
  if [ "$dry" = true ]; then
    echo 'DRY_RUN: both targets built into the builder cache. Nothing was published or promoted.'
    return 0
  fi
  # Candidates exist, but release/latest aliases are untouched until runtime checks pass.
  bash scripts/smoke-docker.sh "$image:sha-$revision" "$image-migrate:sha-$revision"
  local aliases=("$tag")
  [[ ! "$tag" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || aliases+=(latest)
  for alias in "${aliases[@]}"; do
    for suffix in '' -migrate; do
      docker buildx imagetools create -t "$image$suffix:$alias" "$image$suffix:sha-$revision"
    done
  done
  # Registry aliases cannot be changed atomically as a pair. The installer rejects
  # a mismatched revision during that short window and pins both resolved digests.
  bash scripts/package-deploy.sh "$tag" "$revision"
  printf 'Published app + migrate: %s (%s)\n' "$tag" "$revision"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then publish; fi
