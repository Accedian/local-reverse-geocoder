// End-to-end golden test: initialize the geocoder from a local fixture dump
// (no network) and assert lookUp output, protecting the parse + kdtree +
// admin-code/alternate-name enrichment path that weld-api depends on.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir, rmrf } from '../test-helpers/index.mjs';

const { default: geocoder } = await import('../index.js');

const CITY_ROW = [
  '1000001', // geoNameId
  'Testville', // name
  'Testville', // asciiName
  'Test Town', // alternateNames
  '10.0', // latitude
  '20.0', // longitude
  'P', // featureClass
  'PPL', // featureCode
  'TC', // countryCode
  '', // cc2
  '01', // admin1Code
  '001', // admin2Code
  '', // admin3Code
  '', // admin4Code
  '1000', // population
  '100', // elevation
  '100', // dem
  'Test/Zone', // timezone
  '2020-01-01', // modificationDate
].join('\t');

let dumpDir;

before(() => {
  dumpDir = makeTempDir();
  const write = (rel, contents) => {
    const full = path.join(dumpDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };
  write('cities1000/cities1000.txt', CITY_ROW + '\n');
  write('admin1_codes/admin1CodesASCII.txt', 'TC.01\tTest State\tTest State\t2000001\n');
  write('admin2_codes/admin2Codes.txt', 'TC.01.001\tTest County\tTest County\t2000002\n');
  write('all_countries/allCountries.txt', CITY_ROW + '\n');
  write('alternate_names/alternateNames.txt', '5000001\t1000001\ten\tTest Town Alt\t1\t0\t0\t0\n');
});

after(() => {
  rmrf(dumpDir);
});

function init() {
  return new Promise((resolve) => {
    geocoder.init(
      {
        dumpDirectory: dumpDir,
        citiesFileOverride: 'cities1000',
        load: { admin1: true, admin2: true, admin3And4: true, alternateNames: true },
        countries: [],
      },
      resolve
    );
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

  assert.equal(match.geoNameId, '1000001');
  assert.equal(match.name, 'Testville');
  assert.equal(match.countryCode, 'TC');
  assert.equal(match.latitude, '10.0');
  assert.equal(match.longitude, '20.0');
  assert.equal(match.admin1Code.name, 'Test State');
  assert.equal(match.admin2Code.name, 'Test County');
  assert.equal(match.alternateName.en.altName, 'Test Town Alt');
  assert.equal(Math.round(match.distance), 0);
});
