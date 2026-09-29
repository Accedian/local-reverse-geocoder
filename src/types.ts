export interface PointsEntry {
  latitude: number | string;
  longitude: number | string;
}

export interface InitOptions {
  dumpDirectory?: string;
}

export type InitCallback = (error: Error | null) => void;

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

export type LookUpCallback = (
  error: Error | null,
  addresses?: Array<Array<AddressObject>>
) => void;
