// 3-Environment Network-Compatibility Validation (plan section 7).
//
// Drives the REAL geocoder (init download + /geocode response) against a local
// GeoNames mirror under three simulated network conditions:
//   1. Direct internet access (no proxy).
//   2. Outbound proxy required (HTTP(S)_PROXY set; assert traffic flows via it).
//   3. TLS-inspected / private CA (HTTPS mirror with a self-signed CA), via
//      NODE_EXTRA_CA_CERTS, GEOCODER_CA_FILE, and the SHOULD_REJECT_UNAUTHORIZED
//      fallback.
//
// Each scenario runs in its own child process (validation/run-once.mjs) so that
// start-time env vars like NODE_EXTRA_CA_CERTS take effect. The orchestrator
// owns the mirror/proxy servers and asserts proxy routing via request counts.
//
// Run: npm run validate:network   (requires `zip` and `openssl` on PATH)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import {
  makeTempDir,
  rmrf,
  startHttpOrigin,
  startHttpsOrigin,
  startProxy,
  closeServer,
  generateSelfSignedCert,
} from '../test-helpers/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUN_ONCE = path.join(__dirname, 'run-once.mjs');
const SCENARIO_TIMEOUT_MS = 30000;

// Minimal but valid GeoNames-shaped fixture data (same row the golden test uses).
const CITY_ROW =
  [
    '1000001',
    'Testville',
    'Testville',
    'Test Town',
    '10.0',
    '20.0',
    'P',
    'PPL',
    'TC',
    '',
    '01',
    '001',
    '',
    '',
    '1000',
    '100',
    '100',
    'Test/Zone',
    '2020-01-01',
  ].join('\t') + '\n';
const ADMIN1 = 'TC.01\tTest State\tTest State\t2000001\n';
const ADMIN2 = 'TC.01.001\tTest County\tTest County\t2000002\n';
const ALT = '5000001\t1000001\ten\tTest Town Alt\t1\t0\t0\t0\n';

function buildMirror() {
  const dir = makeTempDir();
  const write = (name, contents) => fs.writeFileSync(path.join(dir, name), contents);
  write('cities1000.txt', CITY_ROW);
  write('allCountries.txt', CITY_ROW);
  write('alternateNames.txt', ALT);
  write('admin1CodesASCII.txt', ADMIN1);
  write('admin2Codes.txt', ADMIN2);
  const zip = (zipName, txtName) =>
    execFileSync('zip', ['-j', path.join(dir, zipName), path.join(dir, txtName)], {
      stdio: 'ignore',
    });
  zip('cities1000.zip', 'cities1000.txt');
  zip('allCountries.zip', 'allCountries.txt');
  zip('alternateNames.zip', 'alternateNames.txt');
  return dir;
}

function fileRoute(filePath, contentType) {
  return (req, res) => {
    res.writeHead(200, { 'content-type': contentType });
    fs.createReadStream(filePath).pipe(res);
  };
}

function mirrorRoutes(dir) {
  return {
    '/cities1000.zip': fileRoute(path.join(dir, 'cities1000.zip'), 'application/zip'),
    '/allCountries.zip': fileRoute(path.join(dir, 'allCountries.zip'), 'application/zip'),
    '/alternateNames.zip': fileRoute(
      path.join(dir, 'alternateNames.zip'),
      'application/zip'
    ),
    '/admin1CodesASCII.txt': fileRoute(
      path.join(dir, 'admin1CodesASCII.txt'),
      'text/plain'
    ),
    '/admin2Codes.txt': fileRoute(path.join(dir, 'admin2Codes.txt'), 'text/plain'),
  };
}

function runScenario(mirrorUrl, env) {
  return new Promise((resolve) => {
    const dumpDir = makeTempDir();
    const child = spawn(process.execPath, [RUN_ONCE], {
      env: {
        ...process.env,
        GEOCODER_MIRROR_URL: mirrorUrl,
        GEOCODER_DUMP_DIR: dumpDir,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, SCENARIO_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      rmrf(dumpDir);
      resolve({
        code,
        detail: (out.trim() || err.trim() || '(no output)') + (timedOut ? ' [TIMEOUT]' : ''),
      });
    });
  });
}

async function main() {
  const mirrorDir = buildMirror();
  const httpOrigin = await startHttpOrigin(mirrorRoutes(mirrorDir));
  const cert = generateSelfSignedCert();
  const httpsOrigin = cert
    ? await startHttpsOrigin(mirrorRoutes(mirrorDir), cert)
    : null;
  const proxy = await startProxy();

  const rows = [];
  const record = (name, expectation, pass, detail) =>
    rows.push({ name, expectation, pass, detail });

  // --- Scenario 1: direct internet access ---
  {
    const before = proxy.getRequestCount();
    const r = await runScenario(httpOrigin.baseUrl, {});
    const proxyHits = proxy.getRequestCount() - before;
    record(
      '1. Direct internet',
      'download + geocode succeed, proxy untouched',
      r.code === 0 && proxyHits === 0,
      `${r.detail} (proxyHits=${proxyHits})`
    );
  }

  // --- Scenario 2: outbound proxy required ---
  {
    const before = proxy.getRequestCount();
    const r = await runScenario(httpOrigin.baseUrl, {
      HTTP_PROXY: proxy.url,
      HTTPS_PROXY: proxy.url,
    });
    const proxyHits = proxy.getRequestCount() - before;
    record(
      '2. Outbound proxy required',
      'success AND traffic routed through proxy',
      r.code === 0 && proxyHits > 0,
      `${r.detail} (proxyHits=${proxyHits})`
    );
  }

  // --- Scenario 3: TLS-inspected / private CA ---
  if (cert) {
    const a = await runScenario(httpsOrigin.baseUrl, {});
    record(
      '3a. Private CA, no trust configured',
      'TLS validation fails (error surfaced)',
      a.code !== 0,
      a.detail
    );

    const b = await runScenario(httpsOrigin.baseUrl, {
      NODE_EXTRA_CA_CERTS: cert.certPath,
    });
    record('3b. NODE_EXTRA_CA_CERTS', 'success', b.code === 0, b.detail);

    const c = await runScenario(httpsOrigin.baseUrl, {
      GEOCODER_CA_FILE: cert.certPath,
    });
    record('3c. GEOCODER_CA_FILE', 'success', c.code === 0, c.detail);

    const d = await runScenario(httpsOrigin.baseUrl, {
      SHOULD_REJECT_UNAUTHORIZED: 'false',
    });
    record(
      '3d. SHOULD_REJECT_UNAUTHORIZED=false',
      'success (insecure fallback)',
      d.code === 0,
      d.detail
    );
  } else {
    record(
      '3. TLS-inspected / private CA',
      'success with custom CA',
      false,
      'SKIPPED: openssl not available to generate a test CA'
    );
  }

  // --- Report ---
  const allPass = rows.every((r) => r.pass);
  const lines = [];
  lines.push('# Network-Compatibility Validation Results');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Node: ${process.version}`);
  lines.push('');
  lines.push(
    'Simulated locally against a stand-in GeoNames mirror, exercising the real'
  );
  lines.push('`geocoder.init()` download path and a real `/geocode` response.');
  lines.push('');
  lines.push('| Scenario | Expectation | Result | Detail |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of rows) {
    lines.push(
      `| ${r.name} | ${r.expectation} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.detail} |`
    );
  }
  lines.push('');
  lines.push('## Notes / limitations of the local simulation');
  lines.push(
    '- Scenario 2 asserts positive proxy routing (the proxy saw the traffic).'
  );
  lines.push(
    '  "Direct egress blocked" is an environment property to confirm in the'
  );
  lines.push('  real proxy-only network.');
  lines.push(
    '- Scenario 3 uses an HTTPS origin presenting a private (self-signed) CA as'
  );
  lines.push(
    '  a stand-in for a TLS-inspection proxy; the CA-trust behavior is identical.'
  );
  lines.push('');
  lines.push(`Overall: ${allPass ? 'PASS' : 'FAIL'}`);
  const report = lines.join('\n') + '\n';

  const reportPath = path.join(__dirname, 'RESULTS.md');
  fs.writeFileSync(reportPath, report);
  process.stdout.write(report);
  console.log(`\nWrote ${reportPath}`);

  // --- Cleanup ---
  await closeServer(httpOrigin.server);
  if (httpsOrigin) {
    await closeServer(httpsOrigin.server);
  }
  await closeServer(proxy.server);
  rmrf(mirrorDir);
  if (cert) {
    rmrf(cert.dir);
  }

  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error('Validation harness error:', e);
  process.exit(1);
});
