'use strict';

/**
 * Pre-bake geocoder data at build time.
 * Parses CSV files and serializes the k-d tree + lookup tables using V8.
 * Run this during Docker build after downloading/extracting GeoNames data.
 */

const fs = require('fs');
const path = require('path');
const v8 = require('v8');
const zlib = require('zlib');
const parser = require('csv-parse');
const parse = parser.parse;
const kdTree = require('kdt');
const readline = require('readline');
const async = require('async');

const GEONAMES_DUMP = path.join(__dirname, 'geonames_dump');
const PREBAKED_FILE = path.join(GEONAMES_DUMP, 'prebaked.v8');

const CITIES_FILE = 'cities1000';
const ADMIN_1_CODES_FILE = 'admin1CodesASCII';

// Fields to keep in city data (minimal set for actual usage)
const CITY_FIELDS_TO_KEEP = [
  'name',
  'latitude',
  'longitude',
  'countryCode',
  'admin1Code',
];

const GEONAMES_COLUMNS = [
  'geoNameId',
  'name',
  'asciiName',
  'alternateNames',
  'latitude',
  'longitude',
  'featureClass',
  'featureCode',
  'countryCode',
  'cc2',
  'admin1Code',
  'admin2Code',
  'admin3Code',
  'admin4Code',
  'population',
  'elevation',
  'dem',
  'timezone',
  'modificationDate',
];

const GEONAMES_ADMIN_CODES_COLUMNS = [
  'concatenatedCodes',
  'name',
  'asciiName',
  'geoNameId',
];

// Distance function for k-d tree
function distanceFunc(x, y) {
  const toRadians = (num) => (num * Math.PI) / 180;
  const lat1 = x.latitude;
  const lon1 = x.longitude;
  const lat2 = y.latitude;
  const lon2 = y.longitude;

  const R = 6371;
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function findDataFile(folder, baseName) {
  const folderPath = path.join(GEONAMES_DUMP, folder);
  if (!fs.existsSync(folderPath)) {
    throw new Error(`Data folder not found: ${folderPath}`);
  }
  
  const files = fs.readdirSync(folderPath);
  // Look for timestamped file first, then bare file
  const txtFile = files.find(f => f.endsWith('.txt'));
  if (!txtFile) {
    throw new Error(`No .txt file found in ${folderPath}`);
  }
  return path.join(folderPath, txtFile);
}

function parseAdmin1Codes(callback) {
  console.log('Parsing admin1 codes...');
  const pathToCsv = findDataFile('admin1_codes', ADMIN_1_CODES_FILE);
  const admin1Codes = {};
  const lenI = GEONAMES_ADMIN_CODES_COLUMNS.length;
  
  const lineReader = readline.createInterface({
    input: fs.createReadStream(pathToCsv),
  });
  
  lineReader.on('line', (line) => {
    const parts = line.split('\t');
    for (let i = 0; i < lenI; i++) {
      const value = parts[i] || null;
      if (i === 0) {
        admin1Codes[value] = {};
      } else {
        admin1Codes[parts[0]][GEONAMES_ADMIN_CODES_COLUMNS[i]] = value;
      }
    }
  });
  
  lineReader.on('close', () => {
    console.log(`Parsed ${Object.keys(admin1Codes).length} admin1 codes`);
    callback(null, admin1Codes);
  });
}

function parseCities(callback) {
  console.log('Parsing cities...');
  const pathToCsv = findDataFile(CITIES_FILE, CITIES_FILE);
  const data = [];
  const lenI = GEONAMES_COLUMNS.length;
  const content = fs.readFileSync(pathToCsv);

  parse(content, { delimiter: '\t', quote: '' }, (err, lines) => {
    if (err) {
      return callback(err);
    }
    
    lines.forEach((line) => {
      const fullObj = {};
      for (let i = 0; i < lenI; i++) {
        fullObj[GEONAMES_COLUMNS[i]] = line[i] || null;
      }
      // Only keep fields we actually use
      const lineObj = {};
      for (const field of CITY_FIELDS_TO_KEEP) {
        lineObj[field] = fullObj[field];
      }
      data.push(lineObj);
    });

    console.log(`Parsed ${data.length} cities (keeping ${CITY_FIELDS_TO_KEEP.length} fields)`);
    // Return the data array - k-d tree will be built at load time
    // (k-d tree contains functions that can't be serialized with V8)
    callback(null, data);
  });
}

function main() {
  console.log('=== Pre-baking geocoder data ===');
  console.log(`Data directory: ${GEONAMES_DUMP}`);
  console.log(`Output file: ${PREBAKED_FILE}`);
  console.log('');

  async.parallel(
    {
      citiesData: parseCities,
      admin1Codes: parseAdmin1Codes,
    },
    (err, results) => {
      if (err) {
        console.error('Error during prebake:', err);
        process.exit(1);
      }

      console.log('');
      console.log('Serializing data with V8...');

      const prebakedData = {
        citiesData: results.citiesData,
        admin1Codes: results.admin1Codes,
      };

      const serialized = v8.serialize(prebakedData);
      const uncompressedMB = (serialized.length / 1024 / 1024).toFixed(2);
      console.log('Uncompressed size: ' + uncompressedMB + ' MB');

      console.log('Compressing with gzip...');
      const compressed = zlib.gzipSync(serialized, { level: 9 });
      fs.writeFileSync(PREBAKED_FILE, compressed);

      const compressedMB = (compressed.length / 1024 / 1024).toFixed(2);
      const ratio = ((1 - compressed.length / serialized.length) * 100).toFixed(1);
      console.log('Compressed size: ' + compressedMB + ' MB (' + ratio + '% reduction)');
      console.log('Wrote ' + PREBAKED_FILE);
      console.log('');
      console.log('=== Prebake complete ===');
    }
  );
}

main();
