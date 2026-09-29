/**
 * Local reverse geocoder based on GeoNames data.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as v8 from 'node:v8';
import * as zlib from 'node:zlib';
import type {
  AddressObject,
  Admin1Code,
  InitCallback,
  InitOptions,
  LookUpCallback,
  PointsEntry,
} from './types.js';

const async = require('async');
const kdTree = require('kdt');

interface KdPoint {
  latitude: number | string;
  longitude: number | string;
}

interface CityRecord {
  name: string;
  latitude: string;
  longitude: string;
  countryCode: string;
  admin1Code: string;
}

interface KdTree {
  nearest(point: KdPoint, maxResults: number): Array<[CityRecord, number]>;
}

interface PrebakedData {
  citiesData: CityRecord[];
  admin1Codes: Record<string, Admin1Code>;
}

type SeriesCallback = (error: Error | null, result?: AddressObject[]) => void;

interface Geocoder {
  _kdTree: KdTree | null;
  _admin1Codes: Record<string, Admin1Code> | null;
  _distanceFunc(x: KdPoint, y: KdPoint): number;
  _loadPrebaked(callback: InitCallback): void;
  init(options?: InitOptions, callback?: InitCallback): void;
  lookUp(points: PointsEntry | PointsEntry[], callback: LookUpCallback): void;
  lookUp(
    points: PointsEntry | PointsEntry[],
    maxResults: number,
    callback: LookUpCallback
  ): void;
  _lookUp(
    points: PointsEntry | PointsEntry[],
    maxResults: number,
    callback: LookUpCallback
  ): void;
}

const defaultGeonamesDump = path.resolve(__dirname, '..', 'geonames_dump');
let GEONAMES_DUMP = defaultGeonamesDump;
let PREBAKED_FILE = path.join(GEONAMES_DUMP, 'prebaked.v8');

const geocoder: Geocoder = {
  _kdTree: null,
  _admin1Codes: null,

  // Distance function taken from
  // http://www.movable-type.co.uk/scripts/latlong.html
  _distanceFunc(x, y) {
    const toRadians = (num: number) => (num * Math.PI) / 180;
    const lat1 = Number(x.latitude);
    const lon1 = Number(x.longitude);
    const lat2 = Number(y.latitude);
    const lon2 = Number(y.longitude);

    const R = 6371; // km
    const φ1 = toRadians(lat1);
    const φ2 = toRadians(lat2);
    const Δφ = toRadians(lat2 - lat1);
    const Δλ = toRadians(lon2 - lon1);
    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  _loadPrebaked(callback) {
    if (!fs.existsSync(PREBAKED_FILE)) {
      callback(
        new Error(
          'Pre-baked geocoder data not found at ' +
            PREBAKED_FILE +
            '. Run "pnpm run prebake" during build to generate it.'
        )
      );
      return;
    }

    console.log('Loading pre-baked geocoder data from ' + PREBAKED_FILE);
    const startTime = Date.now();

    try {
      const compressed = new Uint8Array(fs.readFileSync(PREBAKED_FILE));
      console.log('Decompressing...');
      const buffer = zlib.gunzipSync(compressed);
      const data = v8.deserialize(
        buffer as unknown as Uint8Array<ArrayBuffer>
      ) as PrebakedData;

      console.log(
        'Building k-d tree from ' + data.citiesData.length + ' cities...'
      );
      const dimensions = ['latitude', 'longitude'];
      this._kdTree = kdTree.createKdTree(
        data.citiesData,
        this._distanceFunc,
        dimensions
      ) as KdTree;
      this._admin1Codes = data.admin1Codes;

      const elapsed = Date.now() - startTime;
      console.log('Loaded pre-baked geocoder data in ' + elapsed + 'ms');
      callback(null);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      callback(new Error('Failed to load pre-baked geocoder data: ' + message));
    }
  },

  init(options = {}, callback) {
    if (options.dumpDirectory) {
      GEONAMES_DUMP = options.dumpDirectory;
      PREBAKED_FILE = path.join(GEONAMES_DUMP, 'prebaked.v8');
    }

    console.log(
      'Initializing local reverse geocoder using dump directory: ' +
        GEONAMES_DUMP
    );

    this._loadPrebaked((error) => {
      if (callback) {
        callback(error);
      }
    });
  },

  lookUp(
    points: PointsEntry | PointsEntry[],
    arg2: number | LookUpCallback,
    arg3?: LookUpCallback
  ) {
    let callback: LookUpCallback;
    let maxResults: number;
    if (typeof arg2 === 'function') {
      maxResults = 1;
      callback = arg2;
    } else {
      maxResults = arg2;
      callback = arg3!;
    }

    this._lookUp(points, maxResults, callback);
  },

  _lookUp(points, maxResults, callback) {
    if (!this._kdTree) {
      callback(new Error('Geocoder not initialized. Call init() first.'));
      return;
    }

    const pointList = Array.isArray(points) ? points : [points];
    const functions = pointList.map((point) => (innerCallback: SeriesCallback) => {
      const normalizedPoint: KdPoint = {
        latitude:
          typeof point.latitude === 'number'
            ? point.latitude
            : parseFloat(point.latitude),
        longitude:
          typeof point.longitude === 'number'
            ? point.longitude
            : parseFloat(point.longitude),
      };
      console.log(
        'Look-up request for point ' + JSON.stringify(normalizedPoint)
      );

      const result = this._kdTree!.nearest(normalizedPoint, maxResults);
      result.reverse();
      const addresses: AddressObject[] = [];

      result.forEach(([rawAddress, distance], index) => {
        if (!rawAddress) {
          return;
        }

        const address = rawAddress as unknown as AddressObject;
        const countryCode = address.countryCode || '';
        const admin1Code = address.admin1Code || '';
        if (this._admin1Codes) {
          const admin1CodeKey = countryCode + '.' + admin1Code;
          address.admin1Code =
            this._admin1Codes[admin1CodeKey] || address.admin1Code;
        }
        address.distance = distance;
        addresses[index] = address;
      });

      console.log(
        'Found result(s) for point ' +
          JSON.stringify(normalizedPoint) +
          addresses.map((subResult, index) => {
            return (
              '\n  (' +
              (index + 1) +
              ') {"name":"' +
              subResult.name +
              '"}'
            );
          })
      );
      innerCallback(null, addresses);
    });

    async.series(
      functions,
      (error: Error | null, results: AddressObject[][]) => {
        console.log('Delivering joint results');
        callback(error, results);
      }
    );
  },
};

export = geocoder;
