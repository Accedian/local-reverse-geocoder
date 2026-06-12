// End-to-end golden test: initialize the geocoder from a pre-baked V8 fixture
// and assert lookUp output, protecting the kdtree + admin-code/alternate-name
// enrichment path that weld-api depends on.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import zlib from 'node:zlib';
import { makeTempDir, rmrf } from '../test-helpers/index.mjs';

const { default: geocoder } = await import('../index.js');

let dumpDir;

before(() => {
  dumpDir = makeTempDir();

  // Build test data with minimal fields (matching actual usage)
  const cityData = [{
    name: 'Testville',
    latitude: '10.0',
    longitude: '20.0',
    countryCode: 'TC',
    admin1Code: '01',
  }];

  const prebakedData = {
    citiesData: cityData,
    admin1Codes: {
      'TC.01': { name: 'Test State', asciiName: 'Test State', geoNameId: '2000001' },
    },
  };

  const serialized = v8.serialize(prebakedData);
  const compressed = zlib.gzipSync(serialized);
  fs.writeFileSync(path.join(dumpDir, 'prebaked.v8'), compressed);
});

after(() => {
  rmrf(dumpDir);
});

function init() {
  return new Promise((resolve, reject) => {
    geocoder.init({ dumpDirectory: dumpDir }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function lookUp(point, maxResults) {
  return new Promise((resolve) => {
    geocoder.lookUp(point, maxResults, (err, res) => resolve(res));
  });
}

test('golden lookUp returns enriched result for known coordinates', async () => {
  await init();
  const results = await lookUp({ latitude: 10.0, longitude: 20.0 }, 1);

  assert.ok(Array.isArray(results) && results.length === 1);
  const match = results[0][0];

  assert.equal(match.name, 'Testville');
  assert.equal(match.countryCode, 'TC');
  assert.equal(match.latitude, '10.0');
  assert.equal(match.longitude, '20.0');
  assert.equal(match.admin1Code.name, 'Test State');
  assert.equal(Math.round(match.distance), 0);
});
