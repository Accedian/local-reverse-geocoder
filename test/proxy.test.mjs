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
  generateSelfSignedCert,
  startHttpsOrigin,
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

// Self-signed HTTPS origin for the CONNECT tunnel test.
const tlsCert = generateSelfSignedCert();
const tlsSkip = tlsCert ? false : 'openssl unavailable';
let httpsOrigin;
if (tlsCert) {
  httpsOrigin = await startHttpsOrigin(
    {
      '/ok.txt': (req, res) => {
        res.writeHead(200);
        res.end(txtBytes);
      },
    },
    tlsCert
  );
}

const { default: geocoder } = await import('../index.js');
geocoder._geoNamesUrl = origin.baseUrl;

let tmpDir;
const savedEnv = {};
before(() => {
  tmpDir = makeTempDir();
});
beforeEach(() => {
  savedEnv.HTTP_PROXY = process.env.HTTP_PROXY;
  savedEnv.HTTPS_PROXY = process.env.HTTPS_PROXY;
  savedEnv.NO_PROXY = process.env.NO_PROXY;
  savedEnv.SHOULD_REJECT_UNAUTHORIZED = process.env.SHOULD_REJECT_UNAUTHORIZED;
  savedEnv.GEOCODER_CA_FILE = process.env.GEOCODER_CA_FILE;
});
afterEach(() => {
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'SHOULD_REJECT_UNAUTHORIZED', 'GEOCODER_CA_FILE']) {
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
  if (httpsOrigin) await closeServer(httpsOrigin.server);
  if (tlsCert) rmrf(tlsCert.dir);
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

test('HTTPS_PROXY tunnels through proxy to HTTPS origin via CONNECT', { skip: tlsSkip }, async () => {
  const folder = path.join(tmpDir, 'httpsproxy');
  fs.mkdirSync(folder, { recursive: true });
  process.env.HTTPS_PROXY = proxy.url;
  delete process.env.HTTP_PROXY;
  delete process.env.NO_PROXY;
  // Trust the self-signed cert so the TLS handshake succeeds after tunnel.
  process.env.GEOCODER_CA_FILE = tlsCert.certPath;
  delete process.env.SHOULD_REJECT_UNAUTHORIZED;

  geocoder._geoNamesUrl = httpsOrigin.baseUrl;
  const before = proxy.getRequestCount();
  try {
    const out = await callDownload(geocoder, '_downloadFile', [
      'httpsproxy',
      'ok.txt',
      null,
      folder,
      'out.txt',
    ]);

    assert.deepEqual(fs.readFileSync(out), txtBytes);
    assert.ok(
      proxy.getRequestCount() > before,
      'expected the proxy CONNECT tunnel to be used'
    );
  } finally {
    geocoder._geoNamesUrl = origin.baseUrl;
  }
});
