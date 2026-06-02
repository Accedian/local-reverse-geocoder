// Verifies custom-CA and rejectUnauthorized behavior against a self-signed
// HTTPS origin, confirming parity with the old `request` rejectUnauthorized.
import test, { before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  readFixture,
  makeTempDir,
  rmrf,
  generateSelfSignedCert,
  startHttpsOrigin,
  closeServer,
  callDownload,
} from '../test-helpers/index.mjs';

const txtBytes = readFixture('cities_test.txt');

// Generated at runtime so no private key is committed to the repo.
const tls = generateSelfSignedCert();
const skip = tls ? false : 'openssl is not available to generate a test cert';

let origin;
if (tls) {
  origin = await startHttpsOrigin(
    {
      '/ok.txt': (req, res) => {
        res.writeHead(200);
        res.end(txtBytes);
      },
    },
    tls
  );
}
const { default: geocoder } = await import('../index.js');
if (origin) {
  geocoder._geoNamesUrl = origin.baseUrl;
}

let tmpDir;
const savedEnv = {};
before(() => {
  tmpDir = makeTempDir();
});
beforeEach(() => {
  savedEnv.GEOCODER_CA_FILE = process.env.GEOCODER_CA_FILE;
  savedEnv.SHOULD_REJECT_UNAUTHORIZED = process.env.SHOULD_REJECT_UNAUTHORIZED;
});
afterEach(() => {
  for (const key of ['GEOCODER_CA_FILE', 'SHOULD_REJECT_UNAUTHORIZED']) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});
after(async () => {
  rmrf(tmpDir);
  if (origin) {
    await closeServer(origin.server);
  }
  if (tls) {
    rmrf(tls.dir);
  }
});

function download(name) {
  const folder = path.join(tmpDir, name);
  fs.mkdirSync(folder, { recursive: true });
  return callDownload(geocoder, '_downloadFile', [
    name,
    'ok.txt',
    null,
    folder,
    'out.txt',
  ]);
}

test('self-signed cert with no CA configured fails', { skip }, async () => {
  delete process.env.GEOCODER_CA_FILE;
  delete process.env.SHOULD_REJECT_UNAUTHORIZED;
  await assert.rejects(download('default'), /Error downloading GeoNames/);
});

test('GEOCODER_CA_FILE trusting the cert succeeds', { skip }, async () => {
  process.env.GEOCODER_CA_FILE = tls.certPath;
  delete process.env.SHOULD_REJECT_UNAUTHORIZED;
  const out = await download('cafile');
  assert.deepEqual(fs.readFileSync(out), txtBytes);
});

test(
  'SHOULD_REJECT_UNAUTHORIZED=false succeeds against self-signed',
  { skip },
  async () => {
    delete process.env.GEOCODER_CA_FILE;
    process.env.SHOULD_REJECT_UNAUTHORIZED = 'false';
    const out = await download('rejectfalse');
    assert.deepEqual(fs.readFileSync(out), txtBytes);
  }
);

test(
  'SHOULD_REJECT_UNAUTHORIZED=true fails against self-signed',
  { skip },
  async () => {
    delete process.env.GEOCODER_CA_FILE;
    process.env.SHOULD_REJECT_UNAUTHORIZED = 'true';
    await assert.rejects(download('rejecttrue'), /Error downloading GeoNames/);
  }
);

// NODE_EXTRA_CA_CERTS is read once at process startup, so it cannot be tested
// in-process. We spawn a child with the env var set.
test(
  'NODE_EXTRA_CA_CERTS trusting the cert succeeds (child process)',
  { skip, timeout: 15000 },
  async () => {
    const workerPath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '..', 'test-helpers', 'tls-extra-ca-worker.mjs'
    );
    await new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [workerPath],
        {
          env: {
            ...process.env,
            NODE_EXTRA_CA_CERTS: tls.certPath,
            GEONAMES_TEST_URL: origin.baseUrl,
            GEOCODER_CA_FILE: '',
            SHOULD_REJECT_UNAUTHORIZED: '',
          },
          timeout: 12000,
        },
        (err, stdout, stderr) => {
          if (err) {
            return reject(
              new Error(`Worker failed (code ${err.code}): ${stderr || stdout}`)
            );
          }
          assert.ok(stdout.includes('OK'), 'expected worker to print OK');
          resolve();
        }
      );
    });
  }
);
