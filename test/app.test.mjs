import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';

import appModule from '../app.js';

const { createApp } = appModule;

async function startServer(app) {
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}` };
}

async function stopServer(server) {
  server.close();
  await once(server, 'close');
}

test('geocode route maps repeated query parameters into a batch lookup', async () => {
  const calls = [];
  const geocoder = {
    lookUp(points, maxResults, callback) {
      calls.push({ points, maxResults });
      callback(null, points);
    },
  };
  const { server, url } = await startServer(
    createApp(geocoder, { isGeocodeInitialized: true })
  );

  try {
    const response = await fetch(
      `${url}/geocode?latitude=10&latitude=11&longitude=20&longitude=21&maxResults=2`
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [
      { latitude: '10', longitude: '20' },
      { latitude: '11', longitude: '21' },
    ]);
    assert.deepEqual(calls, [
      {
        points: [
          { latitude: '10', longitude: '20' },
          { latitude: '11', longitude: '21' },
        ],
        maxResults: '2',
      },
    ]);
  } finally {
    await stopServer(server);
  }
});

test('geocode route passes scalar query parameters to the geocoder', async () => {
  const calls = [];
  const geocoder = {
    lookUp(points, maxResults, callback) {
      calls.push({ points, maxResults });
      callback(null, [{ name: 'Testville' }]);
    },
  };
  const { server, url } = await startServer(
    createApp(geocoder, { isGeocodeInitialized: true })
  );

  try {
    const response = await fetch(`${url}/geocode?latitude=10.0&longitude=20.0`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{ name: 'Testville' }]);
    assert.deepEqual(calls, [
      {
        points: [{ latitude: '10.0', longitude: '20.0' }],
        maxResults: 1,
      },
    ]);
  } finally {
    await stopServer(server);
  }
});
