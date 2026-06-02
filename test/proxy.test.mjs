// Verifies proxy support restored via undici's EnvHttpProxyAgent:
// HTTP_PROXY routes traffic through the proxy; NO_PROXY bypasses it.
import test, { before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  readFixture,
  makeTempDir,
  rmrf,
  startHttpOrigin,
  startProxy,
  closeServer,
  callDownload,
} from '../test-helpers/index.mjs';

const txtBytes = readFixture('cities_test.txt');

const origin = await startHttpOrigin({
  '/ok.txt': (req, res) => {
    res.writeHead(200);
    res.end(txtBytes);
  },
});
const proxy = await startProxy();

const { default: geocoder } = await import('../index.js');
geocoder._geoNamesUrl = origin.baseUrl;

let tmpDir;
const savedEnv = {};
before(() => {
  tmpDir = makeTempDir();
});
beforeEach(() => {
  savedEnv.HTTP_PROXY = process.env.HTTP_PROXY;
  savedEnv.NO_PROXY = process.env.NO_PROXY;
});
afterEach(() => {
  for (const key of ['HTTP_PROXY', 'NO_PROXY']) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});
after(async () => {
  rmrf(tmpDir);
  await closeServer(origin.server);
  await closeServer(proxy.server);
});

test('HTTP_PROXY routes the download through the proxy', async () => {
  const folder = path.join(tmpDir, 'viaproxy');
  fs.mkdirSync(folder, { recursive: true });
  process.env.HTTP_PROXY = proxy.url;
  delete process.env.NO_PROXY;

  const before = proxy.getRequestCount();
  const out = await callDownload(geocoder, '_downloadFile', [
    'proxy',
    'ok.txt',
    null,
    folder,
    'out.txt',
  ]);

  assert.deepEqual(fs.readFileSync(out), txtBytes);
  assert.ok(
    proxy.getRequestCount() > before,
    'expected the proxy to forward the request'
  );
});

test('NO_PROXY bypasses the proxy for the matching host', async () => {
  const folder = path.join(tmpDir, 'noproxy');
  fs.mkdirSync(folder, { recursive: true });
  process.env.HTTP_PROXY = proxy.url;
  process.env.NO_PROXY = '127.0.0.1';

  const before = proxy.getRequestCount();
  const out = await callDownload(geocoder, '_downloadFile', [
    'noproxy',
    'ok.txt',
    null,
    folder,
    'out.txt',
  ]);

  assert.deepEqual(fs.readFileSync(out), txtBytes);
  assert.equal(
    proxy.getRequestCount(),
    before,
    'expected the proxy to be bypassed'
  );
});
