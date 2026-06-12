# Local Reverse Geocoder

This library provides a local reverse geocoder for Node.js that is based on
[GeoNames](https://download.geonames.org/export/dump/) data. It is _local_ in
the sense that there are no calls to a remote service like the
[Google Maps API](https://developers.google.com/maps/documentation/javascript/geocoding#ReverseGeocoding),
and in consequence the gecoder is suitable for batch reverse geocoding. It is
_reverse_ in the sense that you give it a (list of) point(s), _i.e._, a
latitude/longitude pair, and it returns the closest city to that point.

## Installation

Requires **Node.js ≥ 22**.

Build and run with Docker:

```bash
$ docker build -t local-reverse-geocoder .
$ docker run -it -e PORT=3000 --rm local-reverse-geocoder
```

The Docker build downloads GeoNames data and pre-bakes it into the image.

## Usage

```bash
$ curl "http://localhost:3000/geocode?latitude=48.466667&longitude=9.133333&latitude=42.083333&longitude=3.1&maxResults=2"
```

## Result Format

An output array that maps each point in the input array to the `maxResults`
closest addresses. The `distance` value is calculated using the
[haversine formula](http://www.movable-type.co.uk/scripts/latlong.html) and is
measured in kilometers.

```javascript
[
  [
    {
      name: 'Gomaringen',
      latitude: '48.45349',
      longitude: '9.09582',
      countryCode: 'DE',
      admin1Code: {
        name: 'Baden-Württemberg',
        asciiName: 'Baden-Wuerttemberg',
        geoNameId: '2953481',
      },
      distance: 3.13,
    },
  ],
  [
    {
      name: 'Albons',
      latitude: '42.10389',
      longitude: '3.08433',
      countryCode: 'ES',
      admin1Code: {
        name: 'Catalonia',
        asciiName: 'Catalonia',
        geoNameId: '3336901',
      },
      distance: 2.63,
    },
  ],
];
```

## License

Copyright 2017 Thomas Steiner (tomac@google.com)

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at

[http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0)

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.

## Acknowledgements

This project was inspired by Richard Penman's Python
[reverse geocoder](https://bitbucket.org/richardpenman/reverse_geocode/). It
uses Ubilabs'
[k-d-tree implementation](https://github.com/ubilabs/kd-tree-javascript) that
was ported to Node.js by [Luke Arduini](https://github.com/luk-/node-kdt).

## Contributors

- [@chriskinsman](https://github.com/chriskinsman)
- [@bloodfire91](https://github.com/bloodfire91)
- [@yjwong](https://github.com/yjwong)
- [@RDIL](https://github.com/RDIL)
- [@tkafka](https://github.com/tkafka)
- [@helloitsm3](https://github.com/helloitsm3)

[![npm](https://nodei.co/npm/local-reverse-geocoder.png?downloads=true)](https://nodei.co/npm/local-reverse-geocoder/)
