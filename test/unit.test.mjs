// Unit tests for _getRejectUnauthorized, _getDispatcher, and _housekeepingSync.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EnvHttpProxyAgent, Agent } from 'undici';
import { makeTempDir, rmrf } from '../test-helpers/index.mjs';

const { default: geocoder } = await import('../index.js');

// ── _getRejectUnauthorized ──────────────────────────────────────────────

const rejectEnvKey = 'SHOULD_REJECT_UNAUTHORIZED';
let savedReject;
beforeEach(() => {
  savedReject = process.env[rejectEnvKey];
});
afterEach(() => {
  if (savedReject === undefined) {
    delete process.env[rejectEnvKey];
  } else {
    process.env[rejectEnvKey] = savedReject;
  }
});

test('_getRejectUnauthorized: returns undefined when env var is unset', () => {
  delete process.env[rejectEnvKey];
  assert.equal(geocoder._getRejectUnauthorized(), undefined);
});

test('_getRejectUnauthorized: "false" returns false', () => {
  process.env[rejectEnvKey] = 'false';
  assert.equal(geocoder._getRejectUnauthorized(), false);
});

test('_getRejectUnauthorized: "FALSE" returns false (case-insensitive)', () => {
  process.env[rejectEnvKey] = 'FALSE';
  assert.equal(geocoder._getRejectUnauthorized(), false);
});

test('_getRejectUnauthorized: "False" returns false (mixed case)', () => {
  process.env[rejectEnvKey] = 'False';
  assert.equal(geocoder._getRejectUnauthorized(), false);
});

test('_getRejectUnauthorized: "true" returns true', () => {
  process.env[rejectEnvKey] = 'true';
  assert.equal(geocoder._getRejectUnauthorized(), true);
});

test('_getRejectUnauthorized: "True" returns true', () => {
  process.env[rejectEnvKey] = 'True';
  assert.equal(geocoder._getRejectUnauthorized(), true);
});

test('_getRejectUnauthorized: arbitrary string returns true', () => {
  process.env[rejectEnvKey] = 'yes';
  assert.equal(geocoder._getRejectUnauthorized(), true);
});

// ── _getDispatcher ──────────────────────────────────────────────────────

const dispatcherEnvKeys = [
  'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy',
  'GEOCODER_CA_FILE', rejectEnvKey,
];
let savedDispatcherEnv;
beforeEach(() => {
  savedDispatcherEnv = {};
  for (const k of dispatcherEnvKeys) {
    savedDispatcherEnv[k] = process.env[k];
  }
});
afterEach(() => {
  for (const k of dispatcherEnvKeys) {
    if (savedDispatcherEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = savedDispatcherEnv[k];
    }
  }
});

function clearDispatcherEnv() {
  for (const k of dispatcherEnvKeys) {
    delete process.env[k];
  }
}

test('_getDispatcher: returns undefined when no overrides are set', () => {
  clearDispatcherEnv();
  assert.equal(geocoder._getDispatcher(), undefined);
});

test('_getDispatcher: returns Agent when GEOCODER_CA_FILE is set', () => {
  clearDispatcherEnv();
  // Write a dummy CA file so readFileSync does not throw.
  const tmpDir = makeTempDir();
  const caPath = path.join(tmpDir, 'ca.pem');
  fs.writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n');
  process.env.GEOCODER_CA_FILE = caPath;

  const dispatcher = geocoder._getDispatcher();
  assert.ok(dispatcher instanceof Agent, 'expected an Agent instance');
  assert.ok(!(dispatcher instanceof EnvHttpProxyAgent), 'should not be a proxy agent');

  rmrf(tmpDir);
});

test('_getDispatcher: returns Agent when SHOULD_REJECT_UNAUTHORIZED is set', () => {
  clearDispatcherEnv();
  process.env[rejectEnvKey] = 'false';

  const dispatcher = geocoder._getDispatcher();
  assert.ok(dispatcher instanceof Agent, 'expected an Agent instance');
});

test('_getDispatcher: returns EnvHttpProxyAgent when HTTP_PROXY is set', () => {
  clearDispatcherEnv();
  process.env.HTTP_PROXY = 'http://127.0.0.1:9999';

  const dispatcher = geocoder._getDispatcher();
  assert.ok(dispatcher instanceof EnvHttpProxyAgent, 'expected an EnvHttpProxyAgent instance');
});

test('_getDispatcher: returns EnvHttpProxyAgent when HTTPS_PROXY is set', () => {
  clearDispatcherEnv();
  process.env.HTTPS_PROXY = 'http://127.0.0.1:9999';

  const dispatcher = geocoder._getDispatcher();
  assert.ok(dispatcher instanceof EnvHttpProxyAgent, 'expected an EnvHttpProxyAgent instance');
});

test('_getDispatcher: proxy + CA returns EnvHttpProxyAgent (proxy takes priority)', () => {
  clearDispatcherEnv();
  const tmpDir = makeTempDir();
  const caPath = path.join(tmpDir, 'ca.pem');
  fs.writeFileSync(caPath, '-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n');
  process.env.HTTP_PROXY = 'http://127.0.0.1:9999';
  process.env.GEOCODER_CA_FILE = caPath;

  const dispatcher = geocoder._getDispatcher();
  assert.ok(dispatcher instanceof EnvHttpProxyAgent, 'proxy takes precedence');

  rmrf(tmpDir);
});

// ── _housekeepingSync ───────────────────────────────────────────────────

test('_housekeepingSync: removes all files except the named output', () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'keep');
  fs.writeFileSync(path.join(dir, 'old1.txt'), 'old');
  fs.writeFileSync(path.join(dir, 'old2.txt'), 'old');

  geocoder._housekeepingSync(dir, 'keep.txt');

  assert.deepEqual(fs.readdirSync(dir).sort(), ['keep.txt']);
  rmrf(dir);
});

test('_housekeepingSync: no-op when only the output file exists', () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'only.txt'), 'data');

  geocoder._housekeepingSync(dir, 'only.txt');

  assert.deepEqual(fs.readdirSync(dir), ['only.txt']);
  rmrf(dir);
});
