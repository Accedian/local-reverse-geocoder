#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
version_script="${script_dir}/determine-version.sh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/determine-version-test.XXXXXX")
trap 'rm -rf -- "$test_root"' EXIT

tests_run=0

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

new_repository() {
  local repository=$1

  git init -q -b main "$repository"
  git -C "$repository" config user.email ci-test@example.invalid
  git -C "$repository" config user.name ci-test
  git -C "$repository" config commit.gpgsign false
  git -C "$repository" config tag.gpgSign false
  git -C "$repository" commit --allow-empty -qm initial
}

run_success_case() {
  local name=$1
  local branch=$2
  local expected=$3
  shift 3

  local repository="${test_root}/${name}"
  local bash_env="${repository}/bash_env"
  local service_tag="${repository}/service-tag.txt"
  new_repository "$repository"

  local tag
  for tag in "$@"; do
    git -C "$repository" tag "$tag"
  done

  : > "$bash_env"
  (
    cd "$repository"
    CIRCLE_BRANCH="$branch" \
      BASH_ENV="$bash_env" \
      SERVICE_TAG_FILE="$service_tag" \
      bash "$version_script"
  ) >/dev/null

  local exported_version
  exported_version=$(bash -c 'source "$1"; printf "%s" "$DOCKER_VER"' _ "$bash_env")
  [[ "$exported_version" == "$expected" ]] || fail "${name}: exported ${exported_version}, expected ${expected}"
  [[ "$(< "$service_tag")" == "$expected" ]] || fail "${name}: service tag does not match"
  [[ "$(< "$bash_env")" == "export DOCKER_VER=${expected}" ]] || fail "${name}: unsafe BASH_ENV serialization"

  tests_run=$((tests_run + 1))
  printf 'ok - %s\n' "$name"
}

run_failure_case() {
  local name=$1
  local branch=$2

  local repository="${test_root}/${name}"
  local bash_env="${repository}/bash_env"
  local service_tag="${repository}/service-tag.txt"
  new_repository "$repository"
  : > "$bash_env"

  if (
    cd "$repository"
    CIRCLE_BRANCH="$branch" \
      BASH_ENV="$bash_env" \
      SERVICE_TAG_FILE="$service_tag" \
      bash "$version_script"
  ) >/dev/null 2>&1; then
    fail "${name}: invalid branch was accepted"
  fi

  [[ ! -s "$bash_env" ]] || fail "${name}: invalid branch was written to BASH_ENV"
  [[ ! -e "$service_tag" ]] || fail "${name}: invalid branch produced a service tag"

  tests_run=$((tests_run + 1))
  printf 'ok - %s\n' "$name"
}

run_success_case main_without_tags main 1.0.0
run_success_case main_with_tags main 1.2.4 \
  1.2.3 \
  '9.9.9$(printf${IFS}TAG_POC)'
run_success_case release_with_tags release/1.2.3 1.2.3-10 \
  1.2.3-1 \
  1.2.3-9 \
  '1.2.3-99$(printf${IFS}TAG_POC)'
run_failure_case command_substitution_branch 'release/$(printf${IFS}BRANCH_POC)'
run_failure_case semicolon_branch 'release/1.2.3;printf${IFS}BRANCH_POC'
run_failure_case incomplete_release_branch release/1.2
run_failure_case unexpected_branch feature/not-a-release

printf '1..%d\n' "$tests_run"
