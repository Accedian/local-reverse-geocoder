#!/bin/sh
# Verifies the package-manager bootstrap invariants for the Docker build.
#
# Deliberately POSIX shell with no Node dependency: this runs as a prerequisite
# of the Docker/release targets, and the CircleCI release job is a Docker-only
# machine executor that provisions helm but not Node.
#
# Scope note: this checks security properties, not formatting. It does not
# assert exact line text, indentation or occurrence counts, so it survives
# harmless edits while still failing on a real regression.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DOCKERFILE="$ROOT/Dockerfile"
PACKAGE_JSON="$ROOT/package.json"

fail() {
  printf 'verify-pins failed: %s\n' "$*" >&2
  exit 1
}

# Executable (non-comment, non-blank) Dockerfile lines only, so a comment
# mentioning corepack can never satisfy or break a check.
exec_lines() {
  sed -e 's/^[[:space:]]*//' "$DOCKERFILE" | grep -v '^#' | grep -v '^$'
}

# ---------------------------------------------------------------------------
# 1. Corepack is fetched at an exact pinned version.
# ---------------------------------------------------------------------------
exec_lines | grep -Eq 'COREPACK_VERSION=[0-9]+\.[0-9]+\.[0-9]+([[:space:]]|$|&)' ||
  fail "Dockerfile must pin COREPACK_VERSION to an exact x.y.z version"
corepack_url=$(exec_lines | grep -oE 'https://registry\.npmjs\.org/corepack/-/corepack-(\$\{COREPACK_VERSION\}|[0-9][0-9.]*)\.tgz' || true)
[ -n "$corepack_url" ] ||
  fail "Dockerfile must fetch Corepack from the pinned registry tarball URL"
[ "$(printf '%s\n' "$corepack_url" | wc -l | tr -d ' ')" = "1" ] ||
  fail "expected exactly one Corepack tarball URL"

# A bare `npm install -g corepack` (no version, or a range/tag) is the original
# finding. Reject any Corepack install that is not the verified local tarball.
! exec_lines | grep -Eq 'npm[[:space:]]+install[^|&]*-g[^|&]*corepack(@|[[:space:]]|$)' ||
  fail "Corepack must be installed from the verified local tarball, not resolved by npm"

# ---------------------------------------------------------------------------
# 2. The tarball is verified, and verified BEFORE it is installed.
# ---------------------------------------------------------------------------
# Scoped to the Corepack bootstrap RUN block, so a checksum elsewhere in the
# file cannot satisfy these checks. Comment lines are stripped, so commenting
# the verifier out fails rather than passing.
bootstrap=$(exec_lines | awk '/^RUN COREPACK_VERSION=/, /corepack install/')
[ -n "$bootstrap" ] ||
  fail "could not locate the Corepack bootstrap RUN block"

printf '%s\n' "$bootstrap" | grep -Eq '[0-9a-f]{128}' ||
  fail "the Corepack bootstrap must contain a literal 128-hex SHA-512"
printf '%s\n' "$bootstrap" | grep -q 'sha512sum' ||
  fail "the Corepack bootstrap must compute a SHA-512 of the downloaded tarball"
# The comparison must abort the build. Note GNU's --strict is deliberately not
# required here: this base is Alpine, where sha512sum is BusyBox and rejects it.
printf '%s\n' "$bootstrap" | grep -q 'exit 1' ||
  fail "the Corepack digest comparison must abort the build on mismatch"

# first_active_line reports the line number of the first non-comment match.
first_active_line() {
  grep -nE "$1" "$DOCKERFILE" | grep -v ':[[:space:]]*#' | head -1 | cut -d: -f1
}
check_line=$(first_active_line 'sha512sum')
install_line=$(first_active_line 'npm install -g')
[ -n "$check_line" ] && [ -n "$install_line" ] && [ "$check_line" -lt "$install_line" ] ||
  fail "Corepack verification must precede 'npm install -g'"

# ---------------------------------------------------------------------------
# 3. Lifecycle scripts must not run as root during the bootstrap. This is the
#    execution primitive LOCREVGE-0002's proof-of-concept used.
# ---------------------------------------------------------------------------
exec_lines | grep -Eq 'npm[[:space:]]+install[^|&]*--ignore-scripts' ||
  fail "'npm install -g' must pass --ignore-scripts"

# ---------------------------------------------------------------------------
# 4. The pnpm hop is integrity-pinned. Without the +<algo>.<hex> suffix,
#    `corepack install` downloads pnpm with no verification at all, so a pinned
#    Corepack would just hand off to an unverified package manager.
# ---------------------------------------------------------------------------
grep -Eq '"packageManager"[[:space:]]*:[[:space:]]*"pnpm@[0-9][0-9.]*\+sha(224|256|384|512)\.[0-9a-f]+"' "$PACKAGE_JSON" ||
  fail "package.json packageManager must pin pnpm with an integrity suffix (pnpm@<version>+sha512.<hex>); regenerate with 'corepack use pnpm@<version>'"

# ---------------------------------------------------------------------------
# 5. Dependencies still come from the lockfile.
# ---------------------------------------------------------------------------
exec_lines | grep -q 'pnpm install --frozen-lockfile' ||
  fail "dependencies must be installed with 'pnpm install --frozen-lockfile'"

printf 'verify-pins: package-manager bootstrap pins verified\n'
