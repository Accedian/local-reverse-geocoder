#!/usr/bin/env bash

set -euo pipefail

: "${BASH_ENV:?BASH_ENV must point to the CircleCI environment file}"

circle_branch="${CIRCLE_BRANCH:-}"
service_tag_file="${SERVICE_TAG_FILE:-service-tag.txt}"
docker_ver=""

# CIRCLE_BRANCH is later persisted through BASH_ENV, so accept only the release
# grammar used by this workflow before deriving any shell-visible value from it.
if [[ "$circle_branch" =~ ^release/([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  release_base="${BASH_REMATCH[1]}"
  release_tag_pattern="^${release_base//./\\.}-([0-9]+)$"
  current_patch=0

  while IFS= read -r tag; do
    # Only numeric suffixes may reach arithmetic evaluation.
    if [[ "$tag" =~ $release_tag_pattern ]]; then
      patch_number="${BASH_REMATCH[1]}"
      patch_value=$((10#$patch_number))
      if (( patch_value > current_patch )); then
        current_patch=$patch_value
      fi
    fi
  done < <(git tag -l "${release_base}-*")

  docker_ver="${release_base}-$((current_patch + 1))"
elif [[ "$circle_branch" == "main" ]]; then
  latest_tag=""
  while IFS= read -r tag; do
    if [[ "$tag" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      latest_tag="$tag"
      break
    fi
  done < <(git tag -l --sort=-v:refname)

  if [[ -z "$latest_tag" ]]; then
    docker_ver="1.0.0"
  else
    IFS=. read -r major minor patch <<< "$latest_tag"
    docker_ver="${major}.${minor}.$((10#$patch + 1))"
  fi
else
  printf 'Unsupported release branch: %q\n' "$circle_branch" >&2
  exit 1
fi

printf 'DOCKER_VER=%s\n' "$docker_ver"
# CircleCI sources BASH_ENV in later steps; %q keeps the version as shell data.
printf 'export DOCKER_VER=%q\n' "$docker_ver" >> "$BASH_ENV"
printf '%s\n' "$docker_ver" > "$service_tag_file"
