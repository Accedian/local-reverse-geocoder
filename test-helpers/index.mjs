// Shared helpers for the regression test suite.
// Kept outside the `test/` directory so the node:test runner does not treat it
// as a test file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.join(__dirname, '..', 'test', 'fixtures');

export function fixturePath(name) {
  return path.join(FIXTURES_DIR, name);
}

export function readFixture(name) {
  return fs.readFileSync(fixturePath(name));
}

export function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lrg-test-'));
}

export function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Start an HTTP origin server. `routes` maps a pathname to a handler
// (req, res). A default handler responds 404.
export async function startHttpOrigin(routes) {
  const server = http.createServer((req, res) => {
    const handler = routes[req.url];
    if (handler) {
      return handler(req, res);
    }
    res.writeHead(404);
    res.end('not found');
  });
  await listen(server);
  const { port } = server.address();
  return { server, port, baseUrl: `http://127.0.0.1:${port}/` };
}

// Generate a throwaway self-signed cert for 127.0.0.1 into a temp dir using
// openssl. Returns null if openssl is unavailable (callers should skip TLS
// tests in that case). Generated at runtime so no private key is committed.
export function generateSelfSignedCert() {
  const dir = makeTempDir();
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '3650',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
      ],
      { stdio: 'ignore' }
    );
  } catch (e) {
    rmrf(dir);
    return null;
  }
  return {
    dir,
    keyPath,
    certPath,
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

// Start an HTTPS origin server with the provided key/cert.
export async function startHttpsOrigin(routes, tls) {
  const server = https.createServer(
    {
      key: tls.key,
      cert: tls.cert,
    },
    (req, res) => {
      const handler = routes[req.url];
      if (handler) {
        return handler(req, res);
      }
      res.writeHead(404);
      res.end('not found');
    }
  );
  await listen(server);
  const { port } = server.address();
  return { server, port, baseUrl: `https://127.0.0.1:${port}/` };
}

// Start a minimal forward HTTP proxy. Tracks how many requests it handled.
// Supports both absolute-form forwarding (HTTP) and CONNECT tunneling, which
// is what undici's proxy agent uses.
export async function startProxy() {
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    requestCount += 1;
    let target;
    try {
      target = new URL(req.url);
    } catch (e) {
      res.writeHead(400);
      return res.end('bad request');
    }
    const proxyReq = http.request(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on('error', () => {
      res.writeHead(502);
      res.end('proxy error');
    });
    req.pipe(proxyReq);
  });
  // CONNECT tunneling (used by undici's proxy agent).
  server.on('connect', (req, clientSocket, head) => {
    requestCount += 1;
    const [host, port] = req.url.split(':');
    const upstream = net.connect(Number(port), host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) {
        upstream.write(head);
      }
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    const onError = () => {
      clientSocket.destroy();
      upstream.destroy();
    };
    upstream.on('error', onError);
    clientSocket.on('error', onError);
  });
  await listen(server);
  const { port } = server.address();
  return {
    server,
    port,
    url: `http://127.0.0.1:${port}`,
    getRequestCount: () => requestCount,
  };
}

export function closeServer(server) {
  return new Promise((resolve) => {
    // undici keep-alive sockets would otherwise keep `close` pending forever.
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    server.close(resolve);
  });
}

// Promisified wrapper around the geocoder callback-style download helpers.
export function callDownload(geocoder, method, args) {
  return new Promise((resolve, reject) => {
    geocoder[method](...args, (err, result) => {
      if (err) {
        return reject(err);
      }
      resolve(result);
    });
  });
}
