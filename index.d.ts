/**
 * @fileoverview Local reverse geocoder based on GeoNames data.
 * @author Thomas Steiner (tomac@google.com)
 * @license Apache 2.0
 *
 * @example
 * // Initialize first, then look up
 * geocoder.init({}, function() {
 *   // With just one point
 *   const point = { latitude: 42.083333, longitude: 3.1 };
 *   geocoder.lookUp(point, 1, function(err, res) {
 *     console.log(JSON.stringify(res, null, 2));
 *   });
 *
 *   // In batch mode with many points
 *   const points = [
 *     { latitude: 42.083333, longitude: 3.1 },
 *     { latitude: 48.466667, longitude: 9.133333 }
 *   ];
 *   geocoder.lookUp(points, 1, function(err, res) {
 *     console.log(JSON.stringify(res, null, 2));
 *   });
 * });
 */

/**
 * The callback function with the results
 */
export type callback = () => AddressObject[];

export interface InitOptions {
  dumpDirectory?: string;
}

export interface PointsEntry {
  latitude: number | string;
  longitude: number | string;
}

export interface Admin1Code {
  name: string;
  asciiName: string;
  geoNameId: string;
}

export interface AddressObject {
  name: string;
  latitude: string;
  longitude: string;
  countryCode: string;
  admin1Code: Admin1Code | string;
  distance: number;
}

export type lookUpCallback =
  | ((error: Error) => void)
  | ((error: null, addresses: Array<Array<AddressObject>>) => void);

declare const _default: {
  init: (options?: InitOptions, callback?: () => void) => void;
  lookUp(points: PointsEntry | PointsEntry[], callback: lookUpCallback): void;
  lookUp(
    points: PointsEntry | PointsEntry[],
    maxResults: number,
    callback: lookUpCallback
  ): void;
};

export default _default;
