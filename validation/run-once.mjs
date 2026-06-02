// Network-validation worker (one scenario per process).
//
// Runs the REAL geocoder end-to-end: geocoder.init() downloads the full file
// set (cities/admin1/admin2/allCountries/alternateNames) from the local mirror
// using the migrated fetch + undici code path, then serves /geocode exactly
// like app.js and self-requests it.
//
// Network behavior is driven entirely by the inherited environment
// (HTTP_PROXY/HTTPS_PROXY/NO_PROXY, NODE_EXTRA_CA_CERTS, GEOCODER_CA_FILE,
// SHOULD_REJECT_UNAUTHORIZED), so the parent orchestrator can exercise each
// scenario by spawning this with a different env.
//
// Output contract: prints `RESULT=OK ...` and exits 0 on success, or
// `RESULT=FAIL ...` and exits 1 on any failure.
import { createRequire } from 'node:module';
import express from 'express';

const require = createRequire(import.meta.url);
const geocoder = require('../index.js');

const MIRROR_URL = process.env.GEOCODER_MIRROR_URL;
const DUMP_DIR = process.env.GEOCODER_DUMP_DIR;
const lat = Number(process.env.GEOCODER_LAT || '10');
const lon = Number(process.env.GEOCODER_LON || '20');

function fail(msg) {
  console.error(`RESULT=FAIL ${msg}`);
  process.exit(1);
}

function describe(e) {
  if (!e) return 'unknown error';
  return e.message || String(e);
}

process.on('uncaughtException', (e) => fail(`uncaughtException: ${describe(e)}`));
process.on('unhandledRejection', (e) =>
  fail(`unhandledRejection: ${describe(e)}`)
);

// Test-only base-URL injection (read at call time); points init at the mirror.
geocoder._geoNamesUrl = MIRROR_URL;

geocoder.init(
  {
    dumpDirectory: DUMP_DIR,
    citiesFileOverride: null,
    load: { admin1: true, admin2: true, admin3And4: true, alternateNames: true },
    countries: [],
  },
  () => {
    // Mirror app.js's /geocode handler and self-request it over real HTTP.
    const app = express();
    app.get('/geocode', (req, res) => {
      const points = [
        { latitude: req.query.latitude, longitude: req.query.longitude },
      ];
      geocoder.lookUp(points, 1, (err, addresses) => {
        if (err) {
          return res.status(500).send(String(err));
        }
        return res.json(addresses);
      });
    });

    const server = app.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      try {
        const response = await fetch(
          `http://127.0.0.1:${port}/geocode?latitude=${lat}&longitude=${lon}`
        );
        if (!response.ok) {
          return fail(`/geocode returned status ${response.status}`);
        }
        const body = await response.json();
        const match = body && body[0] && body[0][0];
        if (!match || !match.name) {
          return fail('/geocode returned no geocode result');
        }
        console.log(`RESULT=OK name=${match.name} country=${match.countryCode}`);
        server.close(() => process.exit(0));
      } catch (e) {
        fail(`/geocode request error: ${describe(e)}`);
      }
    });
  }
);
