#!/bin/sh
# Verify the library actually used by Alpine's shared-Brotli Node build.
set -eu

apk info --exists 'brotli-libs>=1.2.1-r0' >/dev/null
ldd "$(command -v node)" | grep -F 'libbrotlidec.so.1 => /usr/lib/libbrotlidec.so.1' >/dev/null
apk info --who-owns /usr/lib/libbrotlidec.so.1

node <<'NODE'
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

assert.equal(process.versions.node.split('.')[0], '24');
assert.equal(process.config.variables.node_shared_brotli, true);
const input = Buffer.from('Brotli runtime verification');
assert.deepEqual(zlib.brotliDecompressSync(zlib.brotliCompressSync(input)), input);
console.log(JSON.stringify({ node: process.version, sharedBrotli: true }));
NODE
