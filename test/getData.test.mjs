// Tests for _getData caching logic: timestamped cache hit, bare-file cache hit,
// directory creation, and download fallthrough.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir, rmrf } from '../test-helpers/index.mjs';

const { default: geocoder } = await import('../index.js');

let tmpDir;
before(() => {
  tmpDir = makeTempDir();
});
after(() => {
  rmrf(tmpDir);
});

const today = new Date().toISOString().substr(0, 10);

test('_getData: returns timestamped file when it exists (no download)', (t, done) => {
  const folder = path.join(tmpDir, 'ts_hit');
  fs.mkdirSync(folder, { recursive: true });
  const tsFile = path.join(folder, `data_${today}.txt`);
  fs.writeFileSync(tsFile, 'cached');

  geocoder._getData(
    'test',
    'data',
    'data.zip',
    'data.txt',
    folder,
    () => { done(new Error('download should not be called')); },
    (err, result) => {
      assert.equal(err, null);
      assert.equal(result, tsFile);
      done();
    }
  );
});

test('_getData: returns bare file when it exists and no timestamped file', (t, done) => {
  const folder = path.join(tmpDir, 'bare_hit');
  fs.mkdirSync(folder, { recursive: true });
  const bareFile = path.join(folder, 'data.txt');
  fs.writeFileSync(bareFile, 'bare');

  geocoder._getData(
    'test',
    'data',
    'data.zip',
    'data.txt',
    folder,
    () => { done(new Error('download should not be called')); },
    (err, result) => {
      assert.equal(err, null);
      assert.equal(result, bareFile);
      done();
    }
  );
});

test('_getData: creates directory and calls download when no cached file', (t, done) => {
  const folder = path.join(tmpDir, 'miss', 'nested');
  assert.equal(fs.existsSync(folder), false, 'folder should not exist yet');

  const expectedOutput = `data_${today}.txt`;
  geocoder._getData(
    'test',
    'data',
    'data.zip',
    'data.txt',
    folder,
    // Mock download: just verify args and call back.
    (dataName, zipName, innerName, outFolder, outName, cb) => {
      assert.equal(dataName, 'test');
      assert.equal(zipName, 'data.zip');
      assert.equal(innerName, 'data.txt');
      assert.equal(outFolder, folder);
      assert.equal(outName, expectedOutput);
      cb(null, `${outFolder}/${outName}`);
    },
    (err, result) => {
      assert.equal(err, null);
      assert.equal(result, `${folder}/${expectedOutput}`);
      assert.ok(fs.existsSync(folder), 'directory should have been created');
      done();
    }
  );
});

test('_getData: timestamped file takes priority over bare file', (t, done) => {
  const folder = path.join(tmpDir, 'ts_priority');
  fs.mkdirSync(folder, { recursive: true });
  const tsFile = path.join(folder, `data_${today}.txt`);
  const bareFile = path.join(folder, 'data.txt');
  fs.writeFileSync(tsFile, 'timestamped');
  fs.writeFileSync(bareFile, 'bare');

  geocoder._getData(
    'test',
    'data',
    'data.zip',
    'data.txt',
    folder,
    () => { done(new Error('download should not be called')); },
    (err, result) => {
      assert.equal(err, null);
      assert.equal(result, tsFile);
      done();
    }
  );
});
