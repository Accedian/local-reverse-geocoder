// Guard test: fails if the deprecated `request` package reappears anywhere
// (package.json, lockfiles, or installed node_modules).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('package.json declares no `request` dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json')));
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    assert.ok(
      !(pkg[field] && Object.prototype.hasOwnProperty.call(pkg[field], 'request')),
      `package.json ${field} must not contain "request"`
    );
  }
});

test('package-lock.json contains no `request` package', () => {
  const lockPath = path.join(ROOT, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    return;
  }
  const lock = JSON.parse(fs.readFileSync(lockPath));
  if (lock.packages) {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(lock.packages, 'node_modules/request'),
      'package-lock.json must not contain node_modules/request'
    );
  }
  if (lock.dependencies) {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(lock.dependencies, 'request'),
      'package-lock.json must not contain a "request" dependency'
    );
  }
});

test('yarn.lock contains no top-level `request` entry', () => {
  const yarnPath = path.join(ROOT, 'yarn.lock');
  if (!fs.existsSync(yarnPath)) {
    return;
  }
  const contents = fs.readFileSync(yarnPath, 'utf8');
  assert.ok(
    !/^"?request@/m.test(contents),
    'yarn.lock must not contain a top-level request@ entry'
  );
});

test('node_modules/request is not installed', () => {
  const installed = path.join(ROOT, 'node_modules', 'request', 'package.json');
  assert.equal(
    fs.existsSync(installed),
    false,
    'node_modules/request/package.json must not exist'
  );
});
