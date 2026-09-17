/**
 * Pre-bake geocoder data at build time.
 * Parses CSV files and serializes the lookup tables using V8.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import * as v8 from 'node:v8';
import * as zlib from 'node:zlib';
import { parse } from 'csv-parse';

const GEONAMES_DUMP = path.resolve(__dirname, '..', 'geonames_dump');
const PREBAKED_FILE = path.join(GEONAMES_DUMP, 'prebaked.v8');

const CITIES_FILE = 'cities1000';
const ADMIN_1_CODES_FILE = 'admin1CodesASCII';

type CityField = 'name' | 'latitude' | 'longitude' | 'countryCode' | 'admin1Code';

interface CityRecord {
  [field: string]: string | null;
}

interface Admin1CodeRecord {
  [field: string]: string | null;
}

interface PrebakedData {
  citiesData: CityRecord[];
  admin1Codes: Record<string, Admin1CodeRecord>;
}

const CITY_FIELDS_TO_KEEP: CityField[] = [
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

function findDataFile(folder: string): string {
  const folderPath = path.join(GEONAMES_DUMP, folder);
  if (!fs.existsSync(folderPath)) {
    throw new Error(`Data folder not found: ${folderPath}`);
  }

  const txtFile = fs.readdirSync(folderPath).find((file) => file.endsWith('.txt'));
  if (!txtFile) {
    throw new Error(`No .txt file found in ${folderPath}`);
  }
  return path.join(folderPath, txtFile);
}

function parseAdmin1Codes(): Promise<Record<string, Admin1CodeRecord>> {
  return new Promise((resolve, reject) => {
    console.log('Parsing admin1 codes...');
    const pathToCsv = findDataFile('admin1_codes');
    const admin1Codes: Record<string, Admin1CodeRecord> = {};
    const lineReader = readline.createInterface({
      input: fs.createReadStream(pathToCsv),
    });

    lineReader.on('line', (line) => {
      const parts = line.split('\t');
      const key = parts[0] || '';
      const entry = (admin1Codes[key] ||= {});
      for (let i = 1; i < GEONAMES_ADMIN_CODES_COLUMNS.length; i++) {
        entry[GEONAMES_ADMIN_CODES_COLUMNS[i]] = parts[i] || null;
      }
    });
    lineReader.on('error', reject);
    lineReader.on('close', () => {
      console.log(`Parsed ${Object.keys(admin1Codes).length} admin1 codes`);
      resolve(admin1Codes);
    });
  });
}

function parseCities(): Promise<CityRecord[]> {
  return new Promise((resolve, reject) => {
    console.log('Parsing cities...');
    const pathToCsv = findDataFile(CITIES_FILE);
    const content = fs.readFileSync(pathToCsv);

    parse(content, { delimiter: '\t', quote: '' }, (error, lines) => {
      if (error) {
        reject(error);
        return;
      }

      const data = (lines as string[][]).map((line) => {
        const fullObject: Record<string, string | null> = {};
        for (let i = 0; i < GEONAMES_COLUMNS.length; i++) {
          fullObject[GEONAMES_COLUMNS[i]] = line[i] || null;
        }

        const city: CityRecord = {};
        for (const field of CITY_FIELDS_TO_KEEP) {
          city[field] = fullObject[field];
        }
        return city;
      });

      console.log(
        'Parsed ' +
          data.length +
          ' cities (keeping ' +
          CITY_FIELDS_TO_KEEP.length +
          ' fields)'
      );
      resolve(data);
    });
  });
}

async function main(): Promise<void> {
  console.log('=== Pre-baking geocoder data ===');
  console.log(`Data directory: ${GEONAMES_DUMP}`);
  console.log(`Output file: ${PREBAKED_FILE}`);
  console.log('');

  const [citiesData, admin1Codes] = await Promise.all([
    parseCities(),
    parseAdmin1Codes(),
  ]);

  console.log('');
  console.log('Serializing data with V8...');

  const prebakedData: PrebakedData = { citiesData, admin1Codes };
  const serialized = new Uint8Array(v8.serialize(prebakedData));
  const uncompressedMB = (serialized.length / 1024 / 1024).toFixed(2);
  console.log('Uncompressed size: ' + uncompressedMB + ' MB');

  console.log('Compressing with gzip...');
  const compressed = zlib.gzipSync(serialized, { level: 9 });
  fs.writeFileSync(PREBAKED_FILE, new Uint8Array(compressed));

  const compressedMB = (compressed.length / 1024 / 1024).toFixed(2);
  const ratio = ((1 - compressed.length / serialized.length) * 100).toFixed(1);
  console.log(
    'Compressed size: ' + compressedMB + ' MB (' + ratio + '% reduction)'
  );
  console.log('Wrote ' + PREBAKED_FILE);
  console.log('');
  console.log('=== Prebake complete ===');
}

main().catch((error: unknown) => {
  console.error('Error during prebake:', error);
  process.exitCode = 1;
});
