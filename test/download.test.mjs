// Regression tests for the fetch-based download helpers (_downloadFile and
// _downloadAndExtractFileFromZip), replacing the old `request` implementation.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  readFixture,
  makeTempDir,
  rmrf,
  startHttpOrigin,
  closeServer,
  callDownload,
} from '../test-helpers/index.mjs';

const zipBytes = readFixture('cities_test.zip');
const txtBytes = readFixture('cities_test.txt');

// Start the origin server and point the geocoder at it BEFORE importing.
const origin = await startHttpOrigin({
  '/ok.txt': (req, res) => {
    res.writeHead(200);
    res.end(txtBytes);
  },
  '/boom.txt': (req, res) => {
    res.writeHead(500);
    res.end('server error');
  },
  '/drop.txt': (req, res) => {
    res.writeHead(200, { 'Content-Length': '1000' });
    res.write('partial');
    req.socket.destroy();
  },
  '/cities_test.zip': (req, res) => {
    res.writeHead(200);
    res.end(zipBytes);
  },
  '/missing.zip': (req, res) => {
    // A valid (different) zip that does not contain the expected entry.
    res.writeHead(200);
    res.end(zipBytes);
  },
});

const { default: geocoder } = await import('../index.js');
geocoder._geoNamesUrl = origin.baseUrl;

let tmpDir;
before(() => {
  tmpDir = makeTempDir();
});
after(async () => {
  rmrf(tmpDir);
  await closeServer(origin.server);
});

test('_downloadFile: happy path writes bytes and runs housekeeping', async () => {
  const folder = path.join(tmpDir, 'happy');
  fs.mkdirSync(folder, { recursive: true });
  // Stray file that housekeeping should remove.
  fs.writeFileSync(path.join(folder, 'stale.txt'), 'old');

  const out = await callDownload(geocoder, '_downloadFile', [
    'happy',
    'ok.txt',
    null,
    folder,
    'ok_out.txt',
  ]);

  assert.equal(out, `${folder}/ok_out.txt`);
  assert.deepEqual(fs.readFileSync(out), txtBytes);
  assert.deepEqual(fs.readdirSync(folder), ['ok_out.txt']);
});

test('_downloadFile: non-200 fires error callback and leaves no file', async () => {
  const folder = path.join(tmpDir, 'boom');
  fs.mkdirSync(folder, { recursive: true });

  await assert.rejects(
    callDownload(geocoder, '_downloadFile', [
      'boom',
      'boom.txt',
      null,
      folder,
      'boom_out.txt',
    ]),
    /response 500/
  );
  assert.equal(fs.existsSync(path.join(folder, 'boom_out.txt')), false);
});

test('_downloadFile: stream error / dropped connection fires error callback', async () => {
  const folder = path.join(tmpDir, 'drop');
  fs.mkdirSync(folder, { recursive: true });

  await assert.rejects(
    callDownload(geocoder, '_downloadFile', [
      'drop',
      'drop.txt',
      null,
      folder,
      'drop_out.txt',
    ]),
    /Error downloading GeoNames/
  );
});

test('_downloadAndExtractFileFromZip: extracts the named entry', async () => {
  const folder = path.join(tmpDir, 'zip');
  fs.mkdirSync(folder, { recursive: true });

  const out = await callDownload(geocoder, '_downloadAndExtractFileFromZip', [
    'cities',
    'cities_test.zip',
    'cities_test.txt',
    folder,
    'cities_out.txt',
  ]);

  assert.equal(out, `${folder}/cities_out.txt`);
  assert.deepEqual(fs.readFileSync(out), txtBytes);
});

test('_downloadAndExtractFileFromZip: missing entry triggers the file-count guard', async () => {
  const folder = path.join(tmpDir, 'zipmissing');
  fs.mkdirSync(folder, { recursive: true });

  await assert.rejects(
    callDownload(geocoder, '_downloadAndExtractFileFromZip', [
      'cities',
      'missing.zip',
      'does_not_exist.txt',
      folder,
      'cities_out.txt',
    ]),
    /found 0 file\(s\)/
  );
});
