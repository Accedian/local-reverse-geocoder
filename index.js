/**
 * @fileoverview Local reverse geocoder based on GeoNames data.
 * @author Thomas Steiner (tomac@google.com)
 * @license Apache 2.0
 *
 * @example
 * // Initialize first, then look up
 * geocoder.init({}, function() {
 *   // With just one point
 *   var point = {latitude: 42.083333, longitude: 3.1};
 *   geocoder.lookUp(point, 1, function(err, res) {
 *     console.log(JSON.stringify(res, null, 2));
 *   });
 *
 *   // In batch mode with many points
 *   var points = [
 *     {latitude: 42.083333, longitude: 3.1},
 *     {latitude: 48.466667, longitude: 9.133333}
 *   ];
 *   geocoder.lookUp(points, 1, function(err, res) {
 *     console.log(JSON.stringify(res, null, 2));
 *   });
 * });
 */

'use strict';

const fs = require('fs');
const path = require('path');
const async = require('async');
const kdTree = require('kdt');
const v8 = require('v8');
const zlib = require('zlib');

let GEONAMES_DUMP = __dirname + '/geonames_dump';
let PREBAKED_FILE = GEONAMES_DUMP + '/prebaked.v8';


const geocoder = {
  _kdTree: null,
  _admin1Codes: null,

  // Distance function taken from
  // http://www.movable-type.co.uk/scripts/latlong.html
  _distanceFunc: function distance(x, y) {
    const toRadians = (num) => (num * Math.PI) / 180;
    const lat1 = x.latitude;
    const lon1 = x.longitude;
    const lat2 = y.latitude;
    const lon2 = y.longitude;

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

  _loadPrebaked: function (callback) {
    const prebakedFile = PREBAKED_FILE;

    if (!fs.existsSync(prebakedFile)) {
      return callback(
        new Error(
          'Pre-baked geocoder data not found at ' +
            prebakedFile +
            '. Run "node prebake.js" during build to generate it.'
        )
      );
    }

    console.log('Loading pre-baked geocoder data from ' + prebakedFile);
    const startTime = Date.now();

    try {
      const compressed = fs.readFileSync(prebakedFile);
      console.log('Decompressing...');
      const buffer = zlib.gunzipSync(compressed);
      const data = v8.deserialize(buffer);

      // Build k-d tree from pre-parsed cities data
      // (k-d tree contains functions that can't be serialized with V8)
      console.log(
        'Building k-d tree from ' + data.citiesData.length + ' cities...'
      );
      const dimensions = ['latitude', 'longitude'];
      this._kdTree = kdTree.createKdTree(
        data.citiesData,
        this._distanceFunc,
        dimensions
      );

      this._admin1Codes = data.admin1Codes;

      const elapsed = Date.now() - startTime;
      console.log('Loaded pre-baked geocoder data in ' + elapsed + 'ms');

      return callback(null);
    } catch (err) {
      return callback(
        new Error('Failed to load pre-baked geocoder data: ' + err.message)
      );
    }
  },

  init: function (options, callback) {
    options = options || {};

    if (options.dumpDirectory) {
      GEONAMES_DUMP = options.dumpDirectory;
      PREBAKED_FILE = GEONAMES_DUMP + '/prebaked.v8';
    }

    console.log(
      'Initializing local reverse geocoder using dump directory: ' +
        GEONAMES_DUMP
    );

    this._loadPrebaked((err) => {
      if (err) {
        if (callback) {
          return callback(err);
        }
        return;
      }
      if (callback) {
        return callback();
      }
    });
  },

  lookUp: function (points, arg2, arg3) {
    let callback;
    let maxResults;
    if (arguments.length === 2) {
      maxResults = 1;
      callback = arg2;
    } else {
      maxResults = arg2;
      callback = arg3;
    }
    this._lookUp(points, maxResults, (err, results) => {
      return callback(err, results);
    });
  },

  _lookUp: function (points, maxResults, callback) {
    // Require initialization before lookUp
    if (!this._kdTree) {
      return callback(
        new Error('Geocoder not initialized. Call init() first.')
      );
    }
    // Make sure we have an array of points
    if (!Array.isArray(points)) {
      points = [points];
    }
    const functions = [];
    points.forEach((point, i) => {
      point = {
        latitude:
          typeof point.latitude === 'number'
            ? point.latitude
            : parseFloat(point.latitude),
        longitude:
          typeof point.longitude === 'number'
            ? point.longitude
            : parseFloat(point.longitude),
      };
      console.log('Look-up request for point ' + JSON.stringify(point));
      functions[i] = (innerCallback) => {
        const result = this._kdTree.nearest(point, maxResults);
        result.reverse();
        for (let j = 0, lenJ = result.length; j < lenJ; j++) {
          if (result && result[j] && result[j][0]) {
            const countryCode = result[j][0].countryCode || '';
            const admin1Code = result[j][0].admin1Code || '';
            // Look-up of admin 1 code
            if (this._admin1Codes) {
              const admin1CodeKey = countryCode + '.' + admin1Code;
              result[j][0].admin1Code =
                this._admin1Codes[admin1CodeKey] || result[j][0].admin1Code;
            }
            // Pull in the k-d tree distance in the main object
            result[j][0].distance = result[j][1];
            // Simplify the output by not returning an array
            result[j] = result[j][0];
          }
        }
        console.log(
          'Found result(s) for point ' +
          JSON.stringify(point) +
          result.map((subResult, idx) => {
            return (
              '\n  (' +
              (idx + 1) +
              ') {"name":"' +
              subResult.name +
              '"}'
            );
          })
        );
        return innerCallback(null, result);
      };
    });
    async.series(functions, (err, results) => {
      console.log('Delivering joint results');
      return callback(null, results);
    });
  },
};

module.exports = geocoder;
