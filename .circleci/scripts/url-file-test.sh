#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "${script_dir}/../.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/url-file-test.XXXXXX")
trap 'rm -rf -- "$test_root"' EXIT

fail() {
	printf 'not ok - %s\n' "$1" >&2
	exit 1
}

run_url_file() {
	make -C "$test_root" -f "$repo_root/Makefile" url-file
}

printf '1.2.3-1\n' > "${test_root}/service-tag.txt"
run_url_file >/dev/null
[[ "$(< "${test_root}/urlname.txt")" == 'gcr.io/npav-172917/weld-reverse-geocoder:1.2.3-1' ]] || \
	fail 'valid service tag was not written to urlname.txt'

rm -f "${test_root}/urlname.txt"
marker="${test_root}/marker"
printf 'safe$(touch %q)\n' "$marker" > "${test_root}/service-tag.txt"
if run_url_file >/dev/null 2>&1; then
	fail 'shell syntax in service-tag.txt was accepted'
fi
[[ ! -e "$marker" ]] || fail 'shell syntax in service-tag.txt was executed'
[[ ! -e "${test_root}/urlname.txt" ]] || fail 'urlname.txt was written for an invalid service tag'

printf 'ok - url-file validates service tags as data\n'
