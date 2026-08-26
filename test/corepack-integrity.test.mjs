import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Docker build pins the package-manager bootstrap', () => {
  const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
  );
  const executableLines = dockerfile
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const corepackLines = executableLines.filter((line) =>
    /corepack/i.test(line)
  );

  assert.equal(corepackLines.length, 1);
  assert.equal(
    corepackLines[0],
    'RUN npm install -g corepack@0.34.7 && corepack enable && corepack install'
  );
  assert.equal(packageJson.packageManager, 'pnpm@10.17.0');
  assert.ok(executableLines.includes('RUN pnpm install --frozen-lockfile'));
});
