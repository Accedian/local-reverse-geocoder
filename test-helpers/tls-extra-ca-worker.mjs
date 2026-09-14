// Worker script for testing NODE_EXTRA_CA_CERTS.
// Spawned as a child process so Node picks up the env var at startup.
// Expects two env vars:
//   GEONAMES_TEST_URL – HTTPS origin base URL
//   NODE_EXTRA_CA_CERTS – path to the CA cert file
//
// Exits 0 on successful download, 1 on failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const baseUrl = process.env.GEONAMES_TEST_URL;
if (!baseUrl) {
  console.error('GEONAMES_TEST_URL is required');
  process.exit(1);
}

const { default: geocoder } = await import('../index.js');
geocoder._geoNamesUrl = baseUrl;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lrg-tlsworker-'));
const folder = path.join(tmpDir, 'dl');
fs.mkdirSync(folder, { recursive: true });

try {
  await new Promise((resolve, reject) => {
    geocoder._downloadFile('test', 'ok.txt', null, folder, 'out.txt', (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
  console.log('OK');
  process.exit(0);
} catch (err) {
  console.error(String(err));
  process.exit(1);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
